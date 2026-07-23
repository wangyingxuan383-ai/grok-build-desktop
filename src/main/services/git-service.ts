import { execFile, spawn, type ChildProcess } from "node:child_process";
import { realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type {
  GitBranchSummary,
  GitCommitDetails,
  GitCommitSummary,
  GitDiscardInput,
  GitDiffResult,
  GitFileChange,
  GitFileChangeKind,
  GitOperationResult,
  GitRepositoryStatus,
  GitRepositoryTrust,
  GitWorkspaceCapability,
  GitHunkActionInput,
  GitReviewScope,
  GitReviewSnapshot,
  GitReviewIndex,
  GitReviewFileDetail,
} from "../../shared/types";
import { JsonStore } from "./json-store";
import { buildGitReviewSnapshot, type ParsedReviewFile, type ParsedReviewHunk } from "./git-review";
import { resolveWorkspaceRoot } from "./workspace-path-policy";

const execFileAsync = promisify(execFile);
const GIT_OUTPUT_LIMIT = 20 * 1024 * 1024;
const NETWORK_TIMEOUT_MS = 5 * 60 * 1000;

interface GitTrustState {
  repositories: Record<string, { workspacePath: string; trustedAt: string }>;
}

interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GitServiceOptions {
  gitPath?: string;
  networkTimeoutMs?: number;
}

export class GitService {
  private readonly gitPath: string;
  private readonly networkTimeoutMs: number;
  private readonly trustStore: JsonStore<GitTrustState>;
  private readonly operations = new Map<string, ChildProcess>();
  private readonly cancelledOperations = new Set<string>();

  constructor(userDataPath: string, options: GitServiceOptions = {}) {
    this.gitPath = options.gitPath ?? "git";
    this.networkTimeoutMs = options.networkTimeoutMs ?? NETWORK_TIMEOUT_MS;
    this.trustStore = new JsonStore(resolve(userDataPath, "git-repository-trust.json"), { repositories: {} });
  }

  async capability(workspacePath: string): Promise<GitWorkspaceCapability> {
    if (!workspacePath.trim()) return { available: false, cwd: "", reason: "no-workspace", message: "请选择工作区后再查看变更" };
    let canonicalWorkspace: string;
    try { canonicalWorkspace = await resolveWorkspaceRoot(workspacePath); }
    catch { return { available: false, cwd: workspacePath, reason: "invalid-workspace", message: "工作区不可用" }; }
    try {
      const result = await this.run(["rev-parse", "--show-toplevel"], canonicalWorkspace, [128]);
      if (result.exitCode !== 0 || !result.stdout.trim()) return { available: false, cwd: canonicalWorkspace, reason: "not-repository", message: "此工作区不是 Git 仓库" };
      const repositoryRoot = await realpath(result.stdout.trim());
      if (!isWithin(repositoryRoot, canonicalWorkspace)) return { available: false, cwd: canonicalWorkspace, reason: "invalid-workspace", message: "Git 仓库范围与工作区不一致" };
      return { available: true, cwd: canonicalWorkspace, repositoryRoot, message: "Git 审核可用" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { available: false, cwd: canonicalWorkspace, reason: message.includes("未找到系统 Git") ? "git-unavailable" : "not-repository", message: message.includes("未找到系统 Git") ? "未找到系统 Git" : "此工作区不是 Git 仓库" };
    }
  }

  async getRepositoryTrust(workspacePath: string): Promise<GitRepositoryTrust> {
    const context = await this.repositoryContext(workspacePath);
    const required = !samePath(context.workspacePath, context.repositoryRoot);
    const state = await this.trustStore.get();
    return {
      ...context,
      required,
      trusted: !required || Boolean(state.repositories[pathKey(context.repositoryRoot)]),
    };
  }

  async setRepositoryTrust(workspacePath: string, repositoryRoot: string, trusted: boolean): Promise<GitRepositoryTrust> {
    const context = await this.repositoryContext(workspacePath);
    if (!samePath(context.repositoryRoot, await realpath(repositoryRoot))) throw new Error("仓库范围已变化，请刷新后重试");
    const state = await this.trustStore.get();
    const key = pathKey(context.repositoryRoot);
    if (trusted) state.repositories[key] = { workspacePath: context.workspacePath, trustedAt: new Date().toISOString() };
    else delete state.repositories[key];
    await this.trustStore.set(state);
    return this.getRepositoryTrust(workspacePath);
  }

  async status(workspacePath: string): Promise<GitRepositoryStatus> {
    const context = await this.repositoryContext(workspacePath);
    const result = await this.run(["-c", "core.quotepath=false", "status", "--porcelain=v2", "--branch", "-z"], context.repositoryRoot);
    const parsed = parsePorcelainV2(result.stdout);
    const remoteName = parsed.branch.upstream?.split("/")[0] || (await this.firstRemote(context.repositoryRoot));
    const remoteUrl = remoteName
      ? await this.run(["remote", "get-url", remoteName], context.repositoryRoot, [2]).then((value) => value.exitCode === 0 ? sanitizeRemoteUrl(value.stdout.trim()) : "")
      : "";
    return {
      workspacePath: context.workspacePath,
      repositoryRoot: context.repositoryRoot,
      branch: parsed.branch,
      remote: remoteName && remoteUrl ? { name: remoteName, displayUrl: remoteUrl } : undefined,
      clean: parsed.changes.length === 0,
      changes: parsed.changes,
      conflicts: parsed.changes.filter((value) => value.kind === "conflicted").map((value) => value.path),
      checkedAt: new Date().toISOString(),
    };
  }

  async diff(workspacePath: string, staged: boolean, path?: string): Promise<GitDiffResult> {
    const context = await this.repositoryContext(workspacePath);
    const relativePath = path ? normalizeRepoPath(context.repositoryRoot, path) : undefined;
    let result: GitCommandResult;
    if (relativePath && !staged) {
      const status = await this.status(workspacePath);
      const change = status.changes.find((value) => value.path === relativePath);
      if (change?.kind === "untracked") {
        result = await this.run(["-c", "core.quotepath=false", "diff", "--no-index", "--no-color", "--", "/dev/null", relativePath], context.repositoryRoot, [1]);
      } else {
        result = await this.run(diffArgs(false, relativePath), context.repositoryRoot);
      }
    } else {
      result = await this.run(diffArgs(staged, relativePath), context.repositoryRoot);
    }
    return {
      repositoryRoot: context.repositoryRoot,
      path: relativePath,
      staged,
      patch: result.stdout,
      binary: /(?:^|\n)(?:Binary files .* differ|GIT binary patch)(?:\n|$)/m.test(result.stdout),
    };
  }

  async review(workspacePath: string, scope: GitReviewScope): Promise<GitReviewSnapshot> {
    const context = await this.repositoryContext(workspacePath);
    const status = await this.status(workspacePath);
    let patch = "";
    if (scope.kind === "unstaged") {
      patch = (await this.run(diffArgs(false), context.repositoryRoot)).stdout;
      const untracked = status.changes.filter((change) => change.kind === "untracked");
      for (const change of untracked) {
        const result = await this.run(["-c", "core.quotepath=false", "diff", "--no-index", "--no-color", "--", "/dev/null", change.path.replace(/\\/g, "/")], context.repositoryRoot, [1]);
        patch += `${patch && !patch.endsWith("\n") ? "\n" : ""}${result.stdout}`;
      }
    } else if (scope.kind === "staged") {
      patch = (await this.run(diffArgs(true), context.repositoryRoot)).stdout;
    } else if (scope.kind === "commit") {
      const commit = await this.resolveCommit(context.repositoryRoot, scope.revision);
      patch = (await this.run(["-c", "core.quotepath=false", "show", "--format=", "--no-ext-diff", "--no-color", commit], context.repositoryRoot)).stdout;
    } else if (scope.kind === "branch") {
      const base = await this.resolveCommit(context.repositoryRoot, scope.base);
      const head = await this.resolveCommit(context.repositoryRoot, "HEAD");
      const mergeBase = (await this.run(["merge-base", base, head], context.repositoryRoot)).stdout.trim();
      patch = (await this.run(["-c", "core.quotepath=false", "diff", "--no-ext-diff", "--no-color", `${mergeBase}..${head}`], context.repositoryRoot)).stdout;
    } else {
      const paths = normalizePathList(context.repositoryRoot, scope.paths);
      if (paths.length) {
        const hasHead = (await this.run(["rev-parse", "--verify", "HEAD"], context.repositoryRoot, [128])).exitCode === 0;
        patch = (await this.run(["-c", "core.quotepath=false", "diff", "--no-ext-diff", "--no-color", ...(hasHead ? ["HEAD"] : []), "--", ...paths.map(literalPathspec)], context.repositoryRoot)).stdout;
        for (const change of status.changes.filter((value) => value.kind === "untracked" && paths.includes(value.path))) {
          const result = await this.run(["-c", "core.quotepath=false", "diff", "--no-index", "--no-color", "--", "/dev/null", change.path.replace(/\\/g, "/")], context.repositoryRoot, [1]);
          patch += `${patch && !patch.endsWith("\n") ? "\n" : ""}${result.stdout}`;
        }
      }
    }
    return buildGitReviewSnapshot({ repositoryRoot: context.repositoryRoot, scope, patch, changes: status.changes });
  }

  async reviewIndex(workspacePath: string, scope: GitReviewScope): Promise<GitReviewIndex> {
    return toReviewIndex(await this.review(workspacePath, scope));
  }

  async reviewFileDetail(workspacePath: string, scope: GitReviewScope, snapshotId: string, fileId: string): Promise<GitReviewFileDetail> {
    const snapshot = await this.review(workspacePath, scope);
    if (snapshot.id !== snapshotId) throw new Error("变更已更新，请刷新审核面板后重试");
    const file = snapshot.files.find((value) => value.id === fileId);
    if (!file) throw new Error("所选文件已不在当前审核范围内");
    return { snapshotId: snapshot.id, file };
  }

  async applyReviewHunk(workspacePath: string, input: GitHunkActionInput): Promise<GitReviewSnapshot> {
    if (input.action === "revert" && !input.confirmed) throw new Error("恢复区块需要明确确认");
    if (input.scope.kind === "unstaged" && input.action === "unstage") throw new Error("未暂存区块不能取消暂存");
    if (input.scope.kind === "staged" && input.action !== "unstage") throw new Error("暂存区块只支持取消暂存");
    const context = await this.assertMutationTrusted(workspacePath);
    const snapshot = await this.review(workspacePath, input.scope) as GitReviewSnapshot & { files: ParsedReviewFile[] };
    if (snapshot.id !== input.snapshotId) throw new Error("变更已更新，请刷新审核面板后重试");
    const file = snapshot.files.find((value) => value.id === input.fileId);
    const hunk = file?.hunks.find((value) => value.id === input.hunkId) as ParsedReviewHunk | undefined;
    if (!file || !hunk || !hunk.mutable) throw new Error("审核区块已不存在或不支持此操作");
    const args = ["apply", "--recount", "--whitespace=nowarn"];
    if (input.action === "stage") args.push("--cached");
    if (input.action === "unstage") args.push("--cached", "--reverse");
    if (input.action === "revert") args.push("--reverse");
    args.push("-");
    await this.runWithStdin(args, context.repositoryRoot, hunk.patch);
    return this.review(workspacePath, input.scope);
  }

  async stage(workspacePath: string, paths?: string[]): Promise<GitRepositoryStatus> {
    const context = await this.assertMutationTrusted(workspacePath);
    const pathspecs = normalizePathList(context.repositoryRoot, paths);
    await this.run(pathspecs.length ? ["add", "--", ...pathspecs.map(literalPathspec)] : ["add", "-A", "--", "."], context.repositoryRoot);
    return this.status(workspacePath);
  }

  async unstage(workspacePath: string, paths?: string[]): Promise<GitRepositoryStatus> {
    const context = await this.assertMutationTrusted(workspacePath);
    const pathspecs = normalizePathList(context.repositoryRoot, paths);
    const hasHead = (await this.run(["rev-parse", "--verify", "HEAD"], context.repositoryRoot, [128])).exitCode === 0;
    if (hasHead) await this.run(pathspecs.length ? ["reset", "--", ...pathspecs.map(literalPathspec)] : ["reset", "--", "."], context.repositoryRoot);
    else await this.run(pathspecs.length ? ["rm", "--cached", "--ignore-unmatch", "--", ...pathspecs.map(literalPathspec)] : ["rm", "--cached", "-r", "--ignore-unmatch", "--", "."], context.repositoryRoot);
    return this.status(workspacePath);
  }

  async commit(workspacePath: string, message: string): Promise<GitCommitSummary> {
    const context = await this.assertMutationTrusted(workspacePath);
    const normalized = message.replace(/\r\n/g, "\n").trim();
    if (!normalized) throw new Error("提交信息不能为空");
    if (Buffer.byteLength(normalized, "utf8") > 64 * 1024) throw new Error("提交信息过长");
    await this.runWithStdin(["commit", "-F", "-"], context.repositoryRoot, `${normalized}\n`);
    const [created] = await this.history(workspacePath, 1);
    if (!created) throw new Error("提交已完成，但无法读取提交详情");
    return created;
  }

  async listBranches(workspacePath: string): Promise<GitBranchSummary[]> {
    const context = await this.repositoryContext(workspacePath);
    const status = await this.status(workspacePath);
    const result = await this.run(["for-each-ref", "--format=%(refname:short)%09%(objectname)%09%(upstream:short)%09%(upstream:track)", "refs/heads"], context.repositoryRoot);
    return result.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const [name = "", commit = "", upstream = "", track = ""] = line.split("\t");
      const counts = parseUpstreamTrack(track ?? "");
      return { name, current: status.branch?.name === name, upstream: upstream || undefined, commit, ...counts };
    });
  }

  async createBranch(workspacePath: string, name: string, startPoint?: string): Promise<GitRepositoryStatus> {
    const context = await this.assertMutationTrusted(workspacePath);
    await this.validateBranchName(context.repositoryRoot, name);
    const args = ["switch", "-c", name];
    if (startPoint) args.push(await this.resolveCommit(context.repositoryRoot, startPoint));
    await this.run(args, context.repositoryRoot);
    return this.status(workspacePath);
  }

  async switchBranch(workspacePath: string, name: string): Promise<GitRepositoryStatus> {
    const context = await this.assertMutationTrusted(workspacePath);
    await this.validateBranchName(context.repositoryRoot, name);
    await this.run(["switch", name], context.repositoryRoot);
    return this.status(workspacePath);
  }

  async history(workspacePath: string, limit = 50): Promise<GitCommitSummary[]> {
    const context = await this.repositoryContext(workspacePath);
    const count = Math.min(200, Math.max(1, Math.trunc(limit)));
    const result = await this.run(["log", `-${count}`, "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e"], context.repositoryRoot, [128]);
    if (result.exitCode === 128) return [];
    return result.stdout.split("\x1e").map((record) => record.replace(/^\r?\n|\r?\n$/g, "")).filter(Boolean).map((record) => {
      const [hash = "", shortHash = "", author = "", authoredAt = "", subject = ""] = record.split("\x1f");
      return { hash, shortHash, author, authoredAt, subject };
    });
  }

  async commitDetails(workspacePath: string, hash: string): Promise<GitCommitDetails> {
    const context = await this.repositoryContext(workspacePath);
    const commit = await this.resolveCommit(context.repositoryRoot, hash);
    const metadata = await this.run(["show", "-s", "--format=%H%x00%h%x00%an%x00%aI%x00%s%x00%b%x00%P", commit], context.repositoryRoot);
    const [fullHash = "", shortHash = "", author = "", authoredAt = "", subject = "", body = "", parentText = ""] = metadata.stdout.trimEnd().split("\0");
    const names = await this.run(["-c", "core.quotepath=false", "diff-tree", "--root", "--no-commit-id", "--name-status", "-M", "-r", "-z", commit], context.repositoryRoot);
    const stats = await this.run(["-c", "core.quotepath=false", "diff-tree", "--root", "--no-commit-id", "--numstat", "-M", "-r", "-z", commit], context.repositoryRoot);
    const files = parseNameStatus(names.stdout);
    const additions = parseNumStat(stats.stdout);
    return {
      hash: fullHash,
      shortHash,
      author,
      authoredAt,
      subject,
      body: body.trim(),
      parents: parentText.trim() ? parentText.trim().split(/\s+/) : [],
      files: files.map((file) => ({ ...file, ...additions.get(file.path) })),
    };
  }

  async discard(workspacePath: string, input: GitDiscardInput): Promise<GitRepositoryStatus> {
    const context = await this.assertMutationTrusted(workspacePath);
    const tracked = normalizePathList(context.repositoryRoot, input.trackedPaths);
    const untracked = normalizePathList(context.repositoryRoot, input.untrackedPaths);
    const confirmed = normalizePathList(context.repositoryRoot, input.confirmedPaths);
    const requested = [...tracked, ...untracked].sort();
    if (!requested.length || !sameStringList(requested, confirmed.sort())) throw new Error("丢弃文件清单未被完整确认");
    const current = await this.status(workspacePath);
    const byPath = new Map(current.changes.map((change) => [change.path, change]));
    if (tracked.some((path) => !byPath.has(path) || byPath.get(path)?.kind === "untracked")) throw new Error("已跟踪文件状态已变化，请刷新后重试");
    if (untracked.some((path) => byPath.get(path)?.kind !== "untracked")) throw new Error("未跟踪文件状态已变化，请刷新后重试");
    if (tracked.length) await this.run(["restore", "--source=HEAD", "--staged", "--worktree", "--", ...tracked.map(literalPathspec)], context.repositoryRoot);
    if (untracked.length) await this.run(["clean", "-fd", "--", ...untracked.map(literalPathspec)], context.repositoryRoot);
    return this.status(workspacePath);
  }

  async pull(workspacePath: string, operationId: string): Promise<GitOperationResult> {
    return this.runNetworkOperation(workspacePath, operationId, ["pull", "--ff-only"], "Pull 完成");
  }

  async push(workspacePath: string, operationId: string): Promise<GitOperationResult> {
    return this.runNetworkOperation(workspacePath, operationId, ["push"], "Push 完成");
  }

  cancelOperation(operationId: string): boolean {
    const child = this.operations.get(operationId);
    if (!child) return false;
    this.cancelledOperations.add(operationId);
    const killed = child.kill();
    if (!killed) this.cancelledOperations.delete(operationId);
    return killed;
  }

  private async runNetworkOperation(workspacePath: string, operationId: string, args: string[], successSummary: string): Promise<GitOperationResult> {
    if (!/^[a-zA-Z0-9._-]{8,128}$/.test(operationId)) throw new Error("Git 操作标识无效");
    if (this.operations.has(operationId)) throw new Error("Git 操作标识已在使用");
    const context = await this.assertMutationTrusted(workspacePath);
    const child = spawn(this.gitPath, args, { cwd: context.repositoryRoot, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    this.operations.set(operationId, child);
    child.stdout.resume();
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < 16_384) stderr += chunk.toString("utf8"); });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, this.networkTimeoutMs);
    try {
      const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolvePromise, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolvePromise({ code, signal }));
      });
      const cancelled = !timedOut && (this.cancelledOperations.delete(operationId) || outcome.signal !== null);
      if (timedOut) throw new Error("Git 网络操作超过五分钟，已取消");
      if (cancelled) return { operationId, completed: false, cancelled: true, summary: "操作已取消" };
      if (outcome.code !== 0) throw new Error(safeGitError(stderr, outcome.code ?? -1));
      return { operationId, completed: true, cancelled: false, summary: successSummary };
    } finally {
      clearTimeout(timer);
      this.operations.delete(operationId);
      this.cancelledOperations.delete(operationId);
    }
  }

  private async assertMutationTrusted(workspacePath: string): Promise<{ workspacePath: string; repositoryRoot: string }> {
    const trust = await this.getRepositoryTrust(workspacePath);
    if (trust.required && !trust.trusted) throw new Error(`修改前需要确认仓库范围：${trust.repositoryRoot}`);
    return { workspacePath: trust.workspacePath, repositoryRoot: trust.repositoryRoot };
  }

  private async repositoryContext(workspacePath: string): Promise<{ workspacePath: string; repositoryRoot: string }> {
    const canonicalWorkspace = await resolveWorkspaceRoot(workspacePath);
    const result = await this.run(["rev-parse", "--show-toplevel"], canonicalWorkspace, [128]);
    if (result.exitCode !== 0 || !result.stdout.trim()) throw new Error("当前工作区不在 Git 仓库中");
    const repositoryRoot = await realpath(result.stdout.trim());
    if (!isWithin(repositoryRoot, canonicalWorkspace)) throw new Error("Git 返回的仓库范围不包含当前工作区");
    return { workspacePath: canonicalWorkspace, repositoryRoot };
  }

  private async firstRemote(repositoryRoot: string): Promise<string | undefined> {
    const result = await this.run(["remote"], repositoryRoot);
    return result.stdout.split(/\r?\n/).map((value) => value.trim()).find(Boolean);
  }

  private async validateBranchName(repositoryRoot: string, name: string): Promise<void> {
    if (!name || name.length > 255 || name.startsWith("-")) throw new Error("分支名称无效");
    const result = await this.run(["check-ref-format", "--branch", name], repositoryRoot, [1, 128]);
    if (result.exitCode !== 0) throw new Error("分支名称无效");
  }

  private async resolveCommit(repositoryRoot: string, revision: string): Promise<string> {
    if (!revision || revision.includes("\0")) throw new Error("提交引用无效");
    const result = await this.run(["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`], repositoryRoot, [128]);
    if (result.exitCode !== 0 || !/^[0-9a-f]{40,64}$/i.test(result.stdout.trim())) throw new Error("找不到指定提交");
    return result.stdout.trim();
  }

  private async run(args: string[], cwd: string, acceptedExitCodes: number[] = []): Promise<GitCommandResult> {
    try {
      const result = await execFileAsync(this.gitPath, args, { cwd, windowsHide: true, shell: false, encoding: "utf8", maxBuffer: GIT_OUTPUT_LIMIT });
      return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
    } catch (error) {
      const value = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: string | number };
      const exitCode = typeof value.code === "number" ? value.code : -1;
      if (acceptedExitCodes.includes(exitCode)) return { stdout: value.stdout ?? "", stderr: value.stderr ?? "", exitCode };
      if (value.code === "ENOENT") throw new Error("未找到系统 Git");
      throw new Error(safeGitError(value.stderr || value.message, exitCode));
    }
  }

  private async runWithStdin(args: string[], cwd: string, input: string): Promise<void> {
    const child = spawn(this.gitPath, args, { cwd, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stdout.resume();
    child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < 16_384) stderr += chunk.toString("utf8"); });
    child.stdin.end(input, "utf8");
    const code = await new Promise<number | null>((resolvePromise, reject) => {
      child.once("error", reject);
      child.once("close", resolvePromise);
    });
    if (code !== 0) throw new Error(safeGitError(stderr, code ?? -1));
  }
}

function parsePorcelainV2(output: string): { branch: GitBranchSummary; changes: GitFileChange[] } {
  const records = output.split("\0");
  let oid = "";
  let head = "";
  let upstream = "";
  let ahead = 0;
  let behind = 0;
  const changes: GitFileChange[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.startsWith("# branch.oid ")) oid = record.slice(13);
    else if (record.startsWith("# branch.head ")) head = record.slice(14);
    else if (record.startsWith("# branch.upstream ")) upstream = record.slice(18);
    else if (record.startsWith("# branch.ab ")) {
      const match = record.match(/\+(\d+)\s+-(\d+)/);
      ahead = Number(match?.[1] ?? 0); behind = Number(match?.[2] ?? 0);
    } else if (record.startsWith("1 ")) {
      const fields = record.split(" ");
      changes.push(changeFromXY(fields[1] ?? "..", fields.slice(8).join(" ")));
    } else if (record.startsWith("2 ")) {
      const fields = record.split(" ");
      const path = fields.slice(9).join(" ");
      const oldPath = records[index + 1] || undefined;
      index += 1;
      changes.push(changeFromXY(fields[1] ?? "..", path, oldPath));
    } else if (record.startsWith("u ")) {
      const fields = record.split(" ");
      const xy = fields[1] ?? "UU";
      changes.push({ path: fields.slice(10).join(" "), kind: "conflicted", staged: true, workingTree: true, conflict: conflictKind(xy) });
    } else if (record.startsWith("? ")) {
      changes.push({ path: record.slice(2), kind: "untracked", staged: false, workingTree: true });
    }
  }
  return {
    branch: {
      name: head === "(detached)" ? oid.slice(0, 12) : head,
      current: true,
      detached: head === "(detached)",
      upstream: upstream || undefined,
      ahead,
      behind,
      commit: oid && oid !== "(initial)" ? oid : undefined,
    },
    changes,
  };
}

function changeFromXY(xy: string, path: string, oldPath?: string): GitFileChange {
  const x = xy[0] ?? ".";
  const y = xy[1] ?? ".";
  const conflict = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(xy);
  return {
    path,
    oldPath,
    kind: conflict ? "conflicted" : changeKind(x !== "." ? x : y),
    staged: conflict || x !== ".",
    workingTree: conflict || y !== ".",
    conflict: conflict ? conflictKind(xy) : undefined,
  };
}

function changeKind(code: string): GitFileChangeKind {
  if (code === "A") return "added";
  if (code === "D") return "deleted";
  if (code === "R") return "renamed";
  if (code === "C") return "copied";
  if (code === "M" || code === "T") return "modified";
  return "unknown";
}

function conflictKind(xy: string): GitFileChange["conflict"] {
  return ({ DD: "both-deleted", AU: "added-by-us", UD: "deleted-by-them", UA: "added-by-them", DU: "deleted-by-us", AA: "both-added", UU: "both-modified" } as const)[xy as "DD"] ?? "both-modified";
}

function diffArgs(staged: boolean, path?: string): string[] {
  const args = ["-c", "core.quotepath=false", "diff", "--no-ext-diff", "--no-color"];
  if (staged) args.push("--cached");
  if (path) args.push("--", literalPathspec(path));
  return args;
}

function parseNameStatus(output: string): Array<{ path: string; oldPath?: string; kind: GitFileChangeKind }> {
  const values = output.split("\0").filter(Boolean);
  const files: Array<{ path: string; oldPath?: string; kind: GitFileChangeKind }> = [];
  for (let index = 0; index < values.length; index += 1) {
    const status = values[index] ?? "";
    if (/^[RC]\d*$/.test(status)) {
      const oldPath = values[++index] ?? ""; const path = values[++index] ?? "";
      files.push({ path, oldPath, kind: changeKind(status[0] ?? "") });
    } else {
      files.push({ path: values[++index] ?? "", kind: changeKind(status[0] ?? "") });
    }
  }
  return files;
}

function parseNumStat(output: string): Map<string, { additions?: number; deletions?: number }> {
  const map = new Map<string, { additions?: number; deletions?: number }>();
  const values = output.split("\0");
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value) continue;
    const [added, deleted, path] = value.split("\t");
    let target = path ?? "";
    if (!target && values[index + 2]) { target = values[index + 2] ?? ""; index += 2; }
    if (!target) continue;
    map.set(target, { additions: added === "-" ? undefined : Number(added), deletions: deleted === "-" ? undefined : Number(deleted) });
  }
  return map;
}

function parseUpstreamTrack(value: string): Pick<GitBranchSummary, "ahead" | "behind"> {
  return {
    ahead: Number(value.match(/ahead (\d+)/)?.[1] ?? 0),
    behind: Number(value.match(/behind (\d+)/)?.[1] ?? 0),
  };
}

function sanitizeRemoteUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.includes("://") && /^[^/\s]+@[^/\s]+:/.test(trimmed)) return trimmed.slice(trimmed.indexOf("@") + 1);
  try {
    const url = new URL(trimmed);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return trimmed.replace(/^(?:[^/@\s]+(?::[^@\s]*)?@)(?=[^/\s]+:)/, "");
  }
}

function safeGitError(stderr: string, exitCode: number): string {
  const sanitized = stderr.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, "$1").replace(/([?&](?:token|access_token|password|key)=)[^&\s]+/gi, "$1[REDACTED]").replace(/[\r\n]+/g, " ").trim().slice(0, 1200);
  return sanitized ? `Git 操作失败（${exitCode}）：${sanitized}` : `Git 操作失败（${exitCode}）`;
}

function normalizePathList(repositoryRoot: string, paths?: string[]): string[] {
  if (!paths) return [];
  return [...new Set(paths.map((path) => normalizeRepoPath(repositoryRoot, path)))];
}

function normalizeRepoPath(repositoryRoot: string, path: string): string {
  if (!path || path.includes("\0")) throw new Error("Git 文件路径无效");
  const absolute = isAbsolute(path) ? resolve(path) : resolve(repositoryRoot, path);
  const rel = relative(repositoryRoot, absolute);
  if (!rel || rel === ".") throw new Error("请选择仓库中的具体文件");
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Git 文件路径超出仓库范围");
  return rel.split(sep).join("/");
}

function literalPathspec(path: string): string {
  return `:(literal)${path}`;
}

function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function samePath(left: string, right: string): boolean {
  return pathKey(left) === pathKey(right);
}

function pathKey(path: string): string {
  const normalized = resolve(path).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function sameStringList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function toReviewIndex(snapshot: GitReviewSnapshot): GitReviewIndex {
  return {
    ...snapshot,
    files: snapshot.files.map(({ hunks, ...file }) => ({ ...file, hunkCount: hunks.length })),
  };
}

export const gitInternals = { parsePorcelainV2, sanitizeRemoteUrl, normalizeRepoPath, toReviewIndex };
