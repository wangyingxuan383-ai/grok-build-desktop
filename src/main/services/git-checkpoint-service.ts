import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { GitDiffSnapshot, GitFileChange, GitFileChangeKind, GitTurnCheckpoint } from "../../shared/workbench-types";
import { buildGitReviewSnapshot, type ParsedReviewFile } from "./git-review";
import { resolveWorkspaceRoot } from "./workspace-path-policy";

const execFileAsync = promisify(execFile);
const GIT_OUTPUT_LIMIT = 20 * 1024 * 1024;
export const MAX_CHECKPOINTS_PER_SESSION = 30;
export const CHECKPOINT_REF_PREFIX = "refs/grok-build/checkpoints";

const CHECKPOINT_GIT_IDENTITY_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: "Grok Build Checkpoint",
  GIT_AUTHOR_EMAIL: "checkpoint@example.invalid",
  GIT_COMMITTER_NAME: "Grok Build Checkpoint",
  GIT_COMMITTER_EMAIL: "checkpoint@example.invalid",
  GIT_OPTIONAL_LOCKS: "0",
};

interface GitExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class GitCheckpointService {
  private readonly gitPath: string;
  private readonly queues = new Map<string, Promise<void>>();
  private readonly preTurnCommits = new Map<string, string>();

  constructor(options: { gitPath?: string } = {}) {
    this.gitPath = options.gitPath ?? "git";
  }

  /**
   * Captures the pre-turn working-tree baseline before tools mutate files.
   * Also writes an initial `pre` ref so `turnDiff` works live mid-turn.
   */
  async capturePreTurn(cwd: string, sessionId: string, turnOrdinal: number, turnId?: string): Promise<string | undefined> {
    if (!cwd.trim() || !Number.isInteger(turnOrdinal) || turnOrdinal < 0) return undefined;
    const repoRoot = await this.resolveRepositoryRoot(cwd);
    if (!repoRoot) return undefined;
    const sanitized = sanitizeCheckpointSessionId(sessionId);
    const turnKey = `${pathKey(repoRoot)}::${sanitized}::${turnOrdinal}`;

    return this.enqueue(`${pathKey(repoRoot)}::${sanitized}`, async () => {
      const existing = this.preTurnCommits.get(turnKey);
      if (existing) return existing;
      const treeOid = await this.snapshotWorkingTree(repoRoot);
      const headOid = await this.resolveHeadCommit(repoRoot);
      const message = `grok-checkpoint:pre\nsession:${sessionId}\nturn:${turnOrdinal}\n${turnId ? `turnId:${turnId}\n` : ""}`;
      const preCommit = await this.commitTree(repoRoot, treeOid, headOid ? [headOid] : [], message);
      this.preTurnCommits.set(turnKey, preCommit);
      while (this.preTurnCommits.size > 512) {
        const oldest = this.preTurnCommits.keys().next().value;
        if (!oldest) break;
        this.preTurnCommits.delete(oldest);
      }
      const refName = checkpointRefName(sessionId, turnOrdinal);
      await this.run(["update-ref", refName, preCommit], repoRoot);
      await this.pruneExcessCheckpoints(repoRoot, sanitized);
      return preCommit;
    });
  }

  /**
   * Captures the post-turn working-tree state and updates
   * `refs/grok-build/checkpoints/<sanitizedSessionId>/<turnOrdinal>` with `-p <preCommit>`.
   */
  async captureTurnCheckpoint(
    cwd: string,
    sessionId: string,
    turnOrdinal: number,
    turnId?: string,
  ): Promise<GitTurnCheckpoint | undefined> {
    if (!cwd.trim() || !Number.isInteger(turnOrdinal) || turnOrdinal < 0) return undefined;
    const repoRoot = await this.resolveRepositoryRoot(cwd);
    if (!repoRoot) return undefined;
    const sanitized = sanitizeCheckpointSessionId(sessionId);
    const turnKey = `${pathKey(repoRoot)}::${sanitized}::${turnOrdinal}`;

    return this.enqueue(`${pathKey(repoRoot)}::${sanitized}`, async () => {
      const refName = checkpointRefName(sessionId, turnOrdinal);
      let beforeCommit = this.preTurnCommits.get(turnKey);
      this.preTurnCommits.delete(turnKey);
      if (!beforeCommit && turnOrdinal > 0) {
        const prevRef = checkpointRefName(sessionId, turnOrdinal - 1);
        beforeCommit = await this.resolveRefCommit(repoRoot, prevRef);
      }
      if (!beforeCommit) {
        beforeCommit = await this.resolveHeadCommit(repoRoot);
      }

      const afterTree = await this.snapshotWorkingTree(repoRoot);
      const message = `grok-checkpoint:turn\nsession:${sessionId}\nturn:${turnOrdinal}\n${turnId ? `turnId:${turnId}\n` : ""}`;
      const afterCommit = await this.commitTree(repoRoot, afterTree, beforeCommit ? [beforeCommit] : [], message);
      await this.run(["update-ref", refName, afterCommit], repoRoot);
      await this.pruneExcessCheckpoints(repoRoot, sanitized);

      const summary = await this.summarizeCommitDelta(repoRoot, beforeCommit, afterCommit);
      return {
        sessionId,
        turnOrdinal,
        ...(turnId ? { turnId } : {}),
        refName,
        ...(beforeCommit ? { beforeCommit } : {}),
        afterCommit,
        repositoryRoot: repoRoot,
        createdAt: new Date().toISOString(),
        ...summary,
      };
    });
  }

  async listCheckpoints(cwd: string, sessionId: string): Promise<GitTurnCheckpoint[]> {
    const repoRoot = await this.resolveRepositoryRoot(cwd);
    if (!repoRoot) return [];
    const sanitized = sanitizeCheckpointSessionId(sessionId);
    const prefix = `${CHECKPOINT_REF_PREFIX}/${sanitized}/`;
    const listed = await this.run(
      ["for-each-ref", "--format=%(refname)%09%(objectname)%09%(creatordate:iso-strict)", prefix],
      repoRoot,
    );
    const rows = listed.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        const [refName = "", afterCommit = "", createdAt = ""] = line.split("\t");
        const ordinalText = refName.slice(prefix.length);
        const turnOrdinal = Number.parseInt(ordinalText, 10);
        if (!refName || !afterCommit || !Number.isInteger(turnOrdinal) || turnOrdinal < 0) return [];
        return [{ refName, afterCommit, createdAt: createdAt || new Date().toISOString(), turnOrdinal }];
      })
      .sort((a, b) => a.turnOrdinal - b.turnOrdinal);

    return Promise.all(rows.map(async (row): Promise<GitTurnCheckpoint> => {
      const meta = await this.readCommitMeta(repoRoot, row.afterCommit);
      const summary = await this.summarizeCommitDelta(repoRoot, meta.beforeCommit, row.afterCommit);
      return {
        sessionId,
        turnOrdinal: row.turnOrdinal,
        ...(meta.turnId ? { turnId: meta.turnId } : {}),
        refName: row.refName,
        ...(meta.beforeCommit ? { beforeCommit: meta.beforeCommit } : {}),
        afterCommit: row.afterCommit,
        repositoryRoot: repoRoot,
        createdAt: meta.createdAt || row.createdAt,
        ...summary,
      };
    }));
  }

  async turnDiff(cwd: string, sessionId: string, turnOrdinal: number): Promise<GitDiffSnapshot> {
    if (!Number.isInteger(turnOrdinal) || turnOrdinal < 0) throw new Error("回合序号无效");
    const repoRoot = await this.resolveRepositoryRoot(cwd);
    if (!repoRoot) throw new Error("当前工作区不是可用的 Git 仓库");
    const refName = checkpointRefName(sessionId, turnOrdinal);
    const storedCommit = await this.resolveRefCommit(repoRoot, refName);
    if (!storedCommit) throw new Error(`未找到第 ${turnOrdinal + 1} 回合的 Git 检查点快照`);

    const meta = await this.readCommitMeta(repoRoot, storedCommit);
    let beforeCommit: string | undefined;
    let afterCommit: string;

    if (meta.phase === "pre") {
      beforeCommit = storedCommit;
      const liveTree = await this.snapshotWorkingTree(repoRoot);
      afterCommit = await this.commitTree(repoRoot, liveTree, [beforeCommit], "grok-checkpoint:live");
    } else {
      beforeCommit = meta.beforeCommit;
      afterCommit = storedCommit;
    }

    let patch: string;
    let nameStatusOut: string;
    if (beforeCommit) {
      const [diffRes, namesRes] = await Promise.all([
        this.run(["-c", "core.quotepath=false", "diff", "--default-prefix", "-M", "--no-ext-diff", "--no-color", beforeCommit, afterCommit], repoRoot),
        this.run(["-c", "core.quotepath=false", "diff", "--name-status", "-M", "-z", beforeCommit, afterCommit], repoRoot),
      ]);
      patch = diffRes.stdout;
      nameStatusOut = namesRes.stdout;
    } else {
      const [diffRes, namesRes] = await Promise.all([
        this.run(["-c", "core.quotepath=false", "diff-tree", "--root", "-p", "--default-prefix", "-M", "--no-commit-id", "--no-ext-diff", "--no-color", afterCommit], repoRoot),
        this.run(["-c", "core.quotepath=false", "diff-tree", "--root", "--no-commit-id", "--name-status", "-M", "-r", "-z", afterCommit], repoRoot),
      ]);
      patch = diffRes.stdout;
      nameStatusOut = namesRes.stdout;
    }

    const changes = parseCheckpointNameStatus(nameStatusOut);
    const createdAt = meta.createdAt || new Date().toISOString();
    const review = buildGitReviewSnapshot({
      repositoryRoot: repoRoot,
      scope: { kind: "commit", revision: afterCommit },
      patch,
      changes,
      readOnly: true,
      createdAt,
    });
    const binary = review.files.some((file) => file.binary)
      || /(?:^|\n)(?:Binary files .* differ|GIT binary patch)(?:\n|$)/m.test(patch);

    return {
      id: review.id,
      repositoryRoot: repoRoot,
      sessionId,
      turnOrdinal,
      ...(beforeCommit ? { beforeCommit } : {}),
      afterCommit,
      patch,
      binary,
      readOnly: true,
      files: (review.files as ParsedReviewFile[]).map(({ patchHeader: _ph, hunks, ...file }) => ({
        ...file,
        hunks: hunks.map(({ patch: _hp, ...hunk }) => hunk),
      })),
      additions: review.additions,
      deletions: review.deletions,
      createdAt: review.createdAt,
    };
  }

  async deleteSessionCheckpoints(cwd: string, sessionId: string): Promise<void> {
    const repoRoot = await this.resolveRepositoryRoot(cwd);
    if (!repoRoot) return;
    const sanitized = sanitizeCheckpointSessionId(sessionId);
    await this.enqueue(`${pathKey(repoRoot)}::${sanitized}`, async () => {
      const prefix = `${CHECKPOINT_REF_PREFIX}/${sanitized}/`;
      const listed = await this.run(["for-each-ref", "--format=%(refname)", prefix], repoRoot);
      const refs = listed.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      for (const ref of refs) {
        await this.run(["update-ref", "-d", ref], repoRoot, [1, 128]);
      }
    });
  }

  /**
   * Stages all tracked + untracked working tree files into a temporary index in
   * `os.tmpdir()` and returns the resulting `git write-tree` SHA.
   * Never touches `.git/index`, `HEAD`, `git status`, or `git log`.
   */
  private async snapshotWorkingTree(repoRoot: string): Promise<string> {
    const tempDir = await mkdtemp(join(tmpdir(), "grok-ckpt-"));
    const tempIndex = join(tempDir, "index");
    try {
      const realIndexPath = await this.resolveRealIndexPath(repoRoot);
      if (realIndexPath && await stat(realIndexPath).then((info) => info.isFile()).catch(() => false)) {
        await copyFile(realIndexPath, tempIndex).catch(() => undefined);
      }
      const env = { ...process.env, ...CHECKPOINT_GIT_IDENTITY_ENV, GIT_INDEX_FILE: tempIndex };
      const untracked = await this.run(
        ["-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard", "-z"],
        repoRoot,
        [128],
        env,
      ).catch(() => ({ stdout: "", stderr: "", exitCode: -1 }));
      const untrackedPaths = untracked.stdout.split("\0").filter(Boolean);
      const oversizedUntracked: string[] = [];
      const addableUntracked: string[] = [];
      for (const rel of untrackedPaths) {
        const info = await stat(join(repoRoot, rel)).catch(() => undefined);
        if (info && info.isFile() && info.size > 10 * 1024 * 1024) oversizedUntracked.push(rel);
        else addableUntracked.push(rel);
      }
      if (oversizedUntracked.length === 0) {
        await this.run(
          ["-c", "core.autocrlf=false", "-c", "core.safecrlf=false", "add", "-A", "--", "."],
          repoRoot,
          [],
          env,
        );
      } else {
        await this.run(
          ["-c", "core.autocrlf=false", "-c", "core.safecrlf=false", "add", "-u", "--", "."],
          repoRoot,
          [],
          env,
        );
        for (let offset = 0; offset < addableUntracked.length; offset += 64) {
          const batch = addableUntracked.slice(offset, offset + 64).map((p) => `:(literal)${p}`);
          await this.run(
            ["-c", "core.autocrlf=false", "-c", "core.safecrlf=false", "add", "--", ...batch],
            repoRoot,
            [],
            env,
          );
        }
      }
      const tree = await this.run(["write-tree"], repoRoot, [], env);
      const oid = tree.stdout.trim();
      if (!/^[0-9a-f]{40,64}$/i.test(oid)) throw new Error("Git write-tree 未返回有效对象哈希");
      return oid;
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async commitTree(repoRoot: string, treeOid: string, parents: string[], message: string): Promise<string> {
    const args = ["commit-tree", treeOid];
    for (const parent of parents) args.push("-p", parent);
    args.push("-m", message);
    const result = await this.run(args, repoRoot, [], { ...process.env, ...CHECKPOINT_GIT_IDENTITY_ENV });
    const oid = result.stdout.trim();
    if (!/^[0-9a-f]{40,64}$/i.test(oid)) throw new Error("Git commit-tree 未返回有效提交哈希");
    return oid;
  }

  private async pruneExcessCheckpoints(repoRoot: string, sanitizedSessionId: string): Promise<void> {
    const prefix = `${CHECKPOINT_REF_PREFIX}/${sanitizedSessionId}/`;
    const listed = await this.run(["for-each-ref", "--format=%(refname)", prefix], repoRoot);
    const refs = listed.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((refName) => ({ refName, ordinal: Number.parseInt(refName.slice(prefix.length), 10) }))
      .sort((a, b) => (Number.isFinite(a.ordinal) ? a.ordinal : -1) - (Number.isFinite(b.ordinal) ? b.ordinal : -1));
    if (refs.length <= MAX_CHECKPOINTS_PER_SESSION) return;
    const stale = refs.slice(0, refs.length - MAX_CHECKPOINTS_PER_SESSION);
    for (const item of stale) {
      await this.run(["update-ref", "-d", item.refName], repoRoot, [1, 128]);
    }
  }

  private async summarizeCommitDelta(
    repoRoot: string,
    beforeCommit: string | undefined,
    afterCommit: string,
  ): Promise<{ filesChanged: number; additions: number; deletions: number }> {
    const args = beforeCommit
      ? ["-c", "core.quotepath=false", "diff", "--numstat", "-M", "-z", beforeCommit, afterCommit]
      : ["-c", "core.quotepath=false", "diff-tree", "--root", "--no-commit-id", "--numstat", "-M", "-r", "-z", afterCommit];
    const stats = await this.run(args, repoRoot);
    let filesChanged = 0;
    let additions = 0;
    let deletions = 0;
    const tokens = stats.stdout.split("\0");
    for (let index = 0; index < tokens.length; index += 1) {
      const entry = tokens[index];
      if (!entry) continue;
      const [added = "0", deleted = "0", path = ""] = entry.split("\t");
      if (!path && tokens[index + 2] !== undefined) index += 2;
      filesChanged += 1;
      if (added !== "-") additions += Number(added) || 0;
      if (deleted !== "-") deletions += Number(deleted) || 0;
    }
    return { filesChanged, additions, deletions };
  }

  private async readCommitMeta(
    repoRoot: string,
    commitOid: string,
  ): Promise<{ beforeCommit?: string; createdAt?: string; phase: "pre" | "turn"; turnId?: string }> {
    const res = await this.run(["show", "-s", "--format=%P%x00%cI%x00%B", commitOid], repoRoot);
    const [parentLine = "", createdAt = "", body = ""] = res.stdout.split("\0");
    const beforeCommit = parentLine.trim().split(/\s+/).filter(Boolean)[0];
    const phase = body.startsWith("grok-checkpoint:pre") ? "pre" : "turn";
    const turnId = /^turnId:(.+)$/m.exec(body)?.[1]?.trim();
    return {
      ...(beforeCommit ? { beforeCommit } : {}),
      ...(createdAt.trim() ? { createdAt: createdAt.trim() } : {}),
      phase,
      ...(turnId ? { turnId } : {}),
    };
  }

  private async resolveRealIndexPath(repoRoot: string): Promise<string | undefined> {
    const res = await this.run(["rev-parse", "--git-path", "index"], repoRoot, [128]);
    if (res.exitCode !== 0 || !res.stdout.trim()) return undefined;
    const raw = res.stdout.trim();
    return isAbsolute(raw) ? raw : resolve(repoRoot, raw);
  }

  private async resolveHeadCommit(repoRoot: string): Promise<string | undefined> {
    const res = await this.run(["rev-parse", "--verify", "--end-of-options", "HEAD^{commit}"], repoRoot, [128]);
    const oid = res.stdout.trim();
    return res.exitCode === 0 && /^[0-9a-f]{40,64}$/i.test(oid) ? oid : undefined;
  }

  private async resolveRefCommit(repoRoot: string, refName: string): Promise<string | undefined> {
    const res = await this.run(["rev-parse", "--verify", "--end-of-options", `${refName}^{commit}`], repoRoot, [128]);
    const oid = res.stdout.trim();
    return res.exitCode === 0 && /^[0-9a-f]{40,64}$/i.test(oid) ? oid : undefined;
  }

  private async resolveRepositoryRoot(cwd: string): Promise<string | undefined> {
    let canonical: string;
    try { canonical = await resolveWorkspaceRoot(cwd); } catch { return undefined; }
    try {
      const res = await this.run(["rev-parse", "--show-toplevel"], canonical, [128]);
      if (res.exitCode !== 0 || !res.stdout.trim()) return undefined;
      return await realpath(res.stdout.trim());
    } catch {
      return undefined;
    }
  }

  private enqueue<R>(key: string, action: () => Promise<R>): Promise<R> {
    const prev = this.queues.get(key) ?? Promise.resolve();
    const result = prev.catch(() => undefined).then(action);
    const tracked = result.then(() => undefined, () => undefined).finally(() => {
      if (this.queues.get(key) === tracked) this.queues.delete(key);
    });
    this.queues.set(key, tracked);
    return result;
  }

  private async run(
    args: string[],
    cwd: string,
    acceptedExitCodes: number[] = [],
    env: NodeJS.ProcessEnv = { ...process.env, ...CHECKPOINT_GIT_IDENTITY_ENV },
  ): Promise<GitExecResult> {
    try {
      const res = await execFileAsync(this.gitPath, args, {
        cwd,
        env,
        windowsHide: true,
        shell: false,
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: GIT_OUTPUT_LIMIT,
      });
      return { stdout: res.stdout, stderr: res.stderr, exitCode: 0 };
    } catch (error) {
      const value = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: string | number };
      const exitCode = typeof value.code === "number" ? value.code : -1;
      if (acceptedExitCodes.includes(exitCode)) {
        return { stdout: value.stdout ?? "", stderr: value.stderr ?? "", exitCode };
      }
      throw new Error(`Git 检查点操作失败（${exitCode}）：${(value.stderr || value.message || "").trim().slice(0, 600)}`);
    }
  }
}

export function sanitizeCheckpointSessionId(sessionId: string): string {
  const trimmed = sessionId.trim();
  if (!trimmed) throw new Error("会话 ID 不能为空");
  if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(trimmed)) return trimmed;
  const clean = trimmed.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96) || "session";
  const digest = createHash("sha256").update(trimmed).digest("hex").slice(0, 10);
  return `${clean}-${digest}`;
}

export function checkpointRefName(sessionId: string, turnOrdinal: number): string {
  if (!Number.isInteger(turnOrdinal) || turnOrdinal < 0) throw new Error("回合序号必须是非负整数");
  return `${CHECKPOINT_REF_PREFIX}/${sanitizeCheckpointSessionId(sessionId)}/${turnOrdinal}`;
}

function parseCheckpointNameStatus(output: string): GitFileChange[] {
  const tokens = output.split("\0").filter(Boolean);
  const changes: GitFileChange[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const rawStatus = tokens[index] ?? "";
    const code = rawStatus[0] ?? "M";
    const kind: GitFileChangeKind = code === "A" ? "added"
      : code === "D" ? "deleted"
        : code === "R" ? "renamed"
          : code === "C" ? "copied"
            : code === "M" || code === "T" ? "modified"
              : "unknown";
    if (/^[RC]\d*$/.test(rawStatus)) {
      const oldPath = tokens[++index] ?? "";
      const path = tokens[++index] ?? "";
      if (path) changes.push({ path, ...(oldPath ? { oldPath } : {}), kind, staged: false, workingTree: false });
    } else {
      const path = tokens[++index] ?? "";
      if (path) changes.push({ path, kind, staged: false, workingTree: false });
    }
  }
  return changes;
}

function pathKey(value: string): string {
  const normalized = resolve(value).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}
