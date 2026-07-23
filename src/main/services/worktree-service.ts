import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, realpath, rm, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { GrokWorktreeSummary, WorktreeApplyPreview, WorktreeApplyResult, WorktreeCreateInput, WorktreeGcPreview } from "../../shared/types";
import { GitService } from "./git-service";
import { JsonStore } from "./json-store";

const execFileAsync = promisify(execFile);
const OUTPUT_LIMIT = 20 * 1024 * 1024;

type ExtensionRequest = (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown> | undefined>;

interface WorktreeMetadata {
  id: string;
  repositoryRoot: string;
  path: string;
  name: string;
  branch?: string;
  baseRef?: string;
  sourceSessionId?: string;
  agentId?: string;
  official: boolean;
  createdAt: string;
  lastUsedAt: string;
}

interface WorktreeMetadataState {
  entries: WorktreeMetadata[];
}

export interface WorktreeServiceOptions {
  gitPath?: string;
  requestExtension?: ExtensionRequest;
}

export class WorktreeService {
  private readonly gitPath: string;
  private readonly requestExtension?: ExtensionRequest;
  private readonly store: JsonStore<WorktreeMetadataState>;
  private readonly worktreeRoot: string;

  constructor(userDataPath: string, private readonly git: GitService, options: WorktreeServiceOptions = {}) {
    this.gitPath = options.gitPath ?? "git";
    this.requestExtension = options.requestExtension;
    this.store = new JsonStore(join(userDataPath, "worktrees.json"), { entries: [] });
    this.worktreeRoot = join(userDataPath, "worktrees");
  }

  async list(workspacePath: string): Promise<GrokWorktreeSummary[]> {
    const target = await this.git.status(workspacePath);
    const official = await this.tryOfficial("x.ai/git/worktree/list", { workspacePath: target.repositoryRoot });
    if (official) await this.mergeOfficialMetadata(target.repositoryRoot, official);
    const result = await this.run(["-C", target.repositoryRoot, "worktree", "list", "--porcelain", "-z"]);
    const records = parseWorktreeList(result.stdout);
    const state = await this.store.get();
    const relevant = state.entries.filter((entry) => samePath(entry.repositoryRoot, target.repositoryRoot));
    const summaries: GrokWorktreeSummary[] = await Promise.all(records.filter((record) => !samePath(record.path, target.repositoryRoot)).map(async (record) => {
      const recordPath = await realpath(record.path).catch(() => resolve(record.path));
      const metadata = relevant.find((entry) => samePath(entry.path, recordPath));
      const exists = await stat(recordPath).then((value) => value.isDirectory()).catch(() => false);
      let changedFiles = 0;
      let conflicted = false;
      if (exists) {
        const status = await this.run(["-C", recordPath, "status", "--porcelain=v2", "-z"], [128]);
        if (status.exitCode === 0) {
          const entries = status.stdout.split("\0").filter(Boolean);
          changedFiles = entries.filter((value) => !value.startsWith("# ") && !value.startsWith("! ")).length;
          conflicted = entries.some((value) => value.startsWith("u "));
        }
      }
      const pathId = createHash("sha256").update(pathKey(recordPath)).digest("hex").slice(0, 24);
      return {
        id: metadata?.id ?? pathId,
        name: metadata?.name ?? basename(recordPath),
        path: recordPath,
        branch: shortBranch(record.branch) || metadata?.branch,
        baseRef: metadata?.baseRef,
        head: record.head,
        sourceSessionId: metadata?.sourceSessionId,
        agentId: metadata?.agentId,
        changedFiles,
        state: !exists ? "missing" as const : record.prunable ? "stale" as const : conflicted ? "conflicted" as const : metadata ? "ready" as const : "orphaned" as const,
        official: metadata?.official ?? false,
        createdAt: metadata?.createdAt,
        lastUsedAt: metadata?.lastUsedAt,
      };
    }));
    for (const metadata of relevant) {
      if (summaries.some((value) => value.id === metadata.id || samePath(value.path, metadata.path))) continue;
      summaries.push({ id: metadata.id, name: metadata.name, path: metadata.path, branch: metadata.branch, baseRef: metadata.baseRef, sourceSessionId: metadata.sourceSessionId, agentId: metadata.agentId, changedFiles: 0, state: "missing", official: metadata.official, createdAt: metadata.createdAt, lastUsedAt: metadata.lastUsedAt });
    }
    return summaries.sort((left, right) => (right.lastUsedAt ?? right.createdAt ?? "").localeCompare(left.lastUsedAt ?? left.createdAt ?? ""));
  }

  async create(input: WorktreeCreateInput): Promise<GrokWorktreeSummary> {
    const trust = await this.git.getRepositoryTrust(input.workspacePath);
    if (trust.required && !trust.trusted) throw new Error(`创建 Worktree 前需要确认仓库范围：${trust.repositoryRoot}`);
    const name = validateName(input.name);
    const baseRef = input.baseRef?.trim() || "HEAD";
    const baseCommit = await this.resolveCommit(trust.repositoryRoot, baseRef);
    const official = await this.tryOfficial("x.ai/git/worktree/create", { workspacePath: trust.repositoryRoot, name, baseRef: baseCommit, sourceSessionId: input.sourceSessionId, agentId: input.agentId });
    const officialPath = readString(official, ["path", "worktreePath", "worktree_path"]);
    if (officialPath) {
      const canonical = await realpath(officialPath);
      const branch = await this.run(["-C", canonical, "branch", "--show-current"]).then((value) => value.stdout.trim());
      const metadata = await this.recordMetadata({ repositoryRoot: trust.repositoryRoot, path: canonical, name, branch, baseRef, sourceSessionId: input.sourceSessionId, agentId: input.agentId, official: true });
      return (await this.list(input.workspacePath)).find((value) => value.id === metadata.id) ?? metadataToSummary(metadata);
    }

    const id = randomUUID();
    const folder = `${slug(name)}-${id.slice(0, 8)}`;
    const path = join(this.worktreeRoot, createHash("sha256").update(pathKey(trust.repositoryRoot)).digest("hex").slice(0, 16), folder);
    const branch = `grok/${folder}`;
    await mkdir(resolve(path, ".."), { recursive: true });
    try {
      await this.run(["-C", trust.repositoryRoot, "worktree", "add", "-b", branch, path, baseCommit]);
    } catch (error) {
      await rm(path, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    const metadata = await this.recordMetadata({ id, repositoryRoot: trust.repositoryRoot, path: await realpath(path), name, branch, baseRef, sourceSessionId: input.sourceSessionId, agentId: input.agentId, official: false });
    return (await this.list(input.workspacePath)).find((value) => value.id === metadata.id) ?? metadataToSummary(metadata);
  }

  async previewApply(workspacePath: string, worktreeId: string): Promise<WorktreeApplyPreview> {
    const target = await this.git.status(workspacePath);
    const worktree = await this.requireWorktree(workspacePath, worktreeId);
    if (!await stat(worktree.path).then((value) => value.isDirectory()).catch(() => false)) return emptyPreview(worktree, target.repositoryRoot, false, "Worktree 路径不存在");
    const sourceStatus = await this.run(["-C", worktree.path, "status", "--porcelain=v2", "-z"]);
    if (sourceStatus.stdout.split("\0").some((value) => value && !value.startsWith("# ") && !value.startsWith("! "))) return emptyPreview(worktree, target.repositoryRoot, target.clean, "Worktree 仍有未提交修改");
    const targetHead = await this.resolveCommit(target.repositoryRoot, "HEAD");
    const sourceHead = await this.resolveCommit(worktree.path, "HEAD");
    const commits = await this.run(["-C", target.repositoryRoot, "log", "--format=%H%x00%s", "-z", `${targetHead}..${sourceHead}`]).then((value) => parseCommitPairs(value.stdout));
    const names = await this.run(["-C", target.repositoryRoot, "-c", "core.quotepath=false", "diff", "--name-status", "-M", "-z", `${targetHead}...${sourceHead}`]);
    const stats = await this.run(["-C", target.repositoryRoot, "-c", "core.quotepath=false", "diff", "--numstat", "-M", "-z", `${targetHead}...${sourceHead}`]);
    const files = mergeDiffFiles(names.stdout, stats.stdout);
    const additions = files.reduce((sum, file) => sum + (file.additions ?? 0), 0);
    const deletions = files.reduce((sum, file) => sum + (file.deletions ?? 0), 0);
    const reason = !target.clean ? "目标工作区存在未提交修改" : targetHead === sourceHead ? "Worktree 没有可应用的新提交" : commits.length === 0 ? "Worktree 提交不在目标分支前方" : undefined;
    return {
      worktreeId: worktree.id,
      sourcePath: worktree.path,
      targetPath: target.repositoryRoot,
      baseRef: worktree.baseRef,
      headRef: sourceHead,
      commits,
      files,
      additions,
      deletions,
      targetClean: target.clean,
      canApply: !reason,
      reason,
      confirmationToken: previewToken(targetHead, sourceHead, files),
    };
  }

  async apply(workspacePath: string, worktreeId: string, confirmationToken: string, confirmed: boolean, cleanup = false): Promise<WorktreeApplyResult> {
    if (!confirmed) throw new Error("应用 Worktree 前需要明确确认预览");
    await this.assertMutationTrusted(workspacePath);
    const preview = await this.previewApply(workspacePath, worktreeId);
    if (!preview.canApply) throw new Error(preview.reason || "当前无法应用 Worktree");
    if (!confirmationToken || confirmationToken !== preview.confirmationToken) throw new Error("Worktree 预览已变化，请重新预览");
    const worktree = await this.requireWorktree(workspacePath, worktreeId);
    if (worktree.official) {
      const result = await this.tryOfficial("x.ai/git/worktree/apply", { worktreeId, sourcePath: worktree.path, targetPath: preview.targetPath, headRef: preview.headRef });
      if (result) {
        const verified = await this.verifyApplied(preview.targetPath, preview.headRef!);
        if (!verified.applied && !verified.conflicted) throw new Error("官方 Worktree Apply 未能通过结果验证");
        const cleaned = cleanup && verified.applied ? await this.remove(workspacePath, worktreeId, true).then(() => true).catch(() => false) : false;
        return { worktreeId, ...verified, cleaned, message: verified.conflicted ? "应用发生冲突，已保留目标修改和 Worktree" : cleaned ? "应用成功并已清理 Worktree" : "应用成功，Worktree 已保留" };
      }
    }
    const merged = await this.run(["-C", preview.targetPath, "merge", "--no-ff", "--no-edit", preview.headRef!], [1]);
    if (merged.exitCode !== 0) {
      const status = await this.git.status(preview.targetPath);
      if (status.conflicts.length) return { worktreeId, applied: false, conflicted: true, cleaned: false, message: "应用发生冲突，已停止且保留目标修改和 Worktree" };
      throw new Error("Git Worktree 合并失败");
    }
    const verified = await this.verifyApplied(preview.targetPath, preview.headRef!);
    if (!verified.applied) throw new Error("Worktree 合并后验证失败");
    const cleaned = cleanup ? await this.remove(workspacePath, worktreeId, true).then(() => true).catch(() => false) : false;
    return { worktreeId, applied: true, conflicted: false, cleaned, message: cleaned ? "应用成功并已清理 Worktree" : "应用成功，Worktree 已保留" };
  }

  async remove(workspacePath: string, worktreeId: string, confirmed: boolean): Promise<void> {
    if (!confirmed) throw new Error("删除 Worktree 前需要明确确认");
    await this.assertMutationTrusted(workspacePath);
    const target = await this.git.status(workspacePath);
    const worktree = await this.requireWorktree(workspacePath, worktreeId);
    if (await stat(worktree.path).then((value) => value.isDirectory()).catch(() => false)) {
      const status = await this.run(["-C", worktree.path, "status", "--porcelain=v2", "-z"]);
      if (status.stdout.split("\0").some((value) => value && !value.startsWith("# ") && !value.startsWith("! "))) throw new Error("Worktree 仍有未提交修改，不能清理");
      const head = await this.resolveCommit(worktree.path, "HEAD");
      const applied = await this.run(["-C", target.repositoryRoot, "merge-base", "--is-ancestor", head, "HEAD"], [1]);
      if (applied.exitCode !== 0) throw new Error("Worktree 仍有未应用提交，不能清理");
      if (worktree.official) {
        const result = await this.tryOfficial("x.ai/git/worktree/remove", { worktreeId, path: worktree.path, workspacePath: target.repositoryRoot });
        if (!result) await this.run(["-C", target.repositoryRoot, "worktree", "remove", worktree.path]);
      } else await this.run(["-C", target.repositoryRoot, "worktree", "remove", worktree.path]);
    }
    if (worktree.branch) await this.run(["-C", target.repositoryRoot, "branch", "-d", worktree.branch], [1]);
    const state = await this.store.get();
    state.entries = state.entries.filter((entry) => entry.id !== worktreeId);
    await this.store.set(state);
  }

  async previewGc(workspacePath: string): Promise<WorktreeGcPreview> {
    const target = await this.git.status(workspacePath);
    const result = await this.run(["-C", target.repositoryRoot, "worktree", "prune", "--expire=now", "--dry-run", "--verbose"]);
    const candidates = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const match = line.match(/^Removing worktrees\/([^:]+):\s*(.*)$/i);
      return { path: match?.[1] ?? line, reason: match?.[2] ?? "Git 标记为可清理" };
    });
    return { repositoryRoot: target.repositoryRoot, candidates, confirmationToken: createHash("sha256").update(JSON.stringify(candidates)).digest("hex") };
  }

  async gc(workspacePath: string, confirmationToken: string, confirmed: boolean): Promise<WorktreeGcPreview> {
    if (!confirmed) throw new Error("GC 前需要明确确认预览");
    await this.assertMutationTrusted(workspacePath);
    const preview = await this.previewGc(workspacePath);
    if (preview.confirmationToken !== confirmationToken) throw new Error("GC 预览已变化，请重新预览");
    const official = await this.tryOfficial("x.ai/git/worktree/gc", { workspacePath: preview.repositoryRoot });
    if (!official) await this.run(["-C", preview.repositoryRoot, "worktree", "prune", "--expire=now", "--verbose"]);
    const state = await this.store.get();
    state.entries = state.entries.filter((entry) => entry.repositoryRoot !== preview.repositoryRoot || !preview.candidates.some((candidate) => candidate.path.includes(basename(entry.path))));
    await this.store.set(state);
    return this.previewGc(workspacePath);
  }

  private async requireWorktree(workspacePath: string, worktreeId: string): Promise<GrokWorktreeSummary> {
    const value = (await this.list(workspacePath)).find((entry) => entry.id === worktreeId);
    if (!value) throw new Error("找不到指定 Worktree");
    return value;
  }

  private async assertMutationTrusted(workspacePath: string): Promise<void> {
    const trust = await this.git.getRepositoryTrust(workspacePath);
    if (trust.required && !trust.trusted) throw new Error(`修改前需要确认仓库范围：${trust.repositoryRoot}`);
  }

  private async verifyApplied(targetPath: string, sourceHead: string): Promise<{ applied: boolean; conflicted: boolean }> {
    const status = await this.git.status(targetPath);
    if (status.conflicts.length) return { applied: false, conflicted: true };
    const ancestor = await this.run(["-C", targetPath, "merge-base", "--is-ancestor", sourceHead, "HEAD"], [1]);
    return { applied: ancestor.exitCode === 0, conflicted: false };
  }

  private async resolveCommit(cwd: string, revision: string): Promise<string> {
    const result = await this.run(["-C", cwd, "rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`], [128]);
    if (result.exitCode !== 0 || !/^[0-9a-f]{40,64}$/i.test(result.stdout.trim())) throw new Error("找不到 Worktree 基础提交");
    return result.stdout.trim();
  }

  private async recordMetadata(input: Omit<WorktreeMetadata, "id" | "createdAt" | "lastUsedAt"> & { id?: string }): Promise<WorktreeMetadata> {
    const now = new Date().toISOString();
    const metadata: WorktreeMetadata = { ...input, id: input.id ?? randomUUID(), createdAt: now, lastUsedAt: now };
    const state = await this.store.get();
    state.entries = [...state.entries.filter((entry) => entry.id !== metadata.id && !samePath(entry.path, metadata.path)), metadata];
    await this.store.set(state);
    return metadata;
  }

  private async mergeOfficialMetadata(repositoryRoot: string, result: Record<string, unknown>): Promise<void> {
    const raw = Array.isArray(result.worktrees) ? result.worktrees : Array.isArray(result.items) ? result.items : [];
    for (const value of raw) {
      if (!value || typeof value !== "object") continue;
      const item = value as Record<string, unknown>;
      const path = readString(item, ["path", "worktreePath", "worktree_path"]);
      if (!path) continue;
      await this.recordMetadata({ id: readString(item, ["id", "worktreeId", "worktree_id"]), repositoryRoot, path, name: readString(item, ["name"]) || basename(path), branch: readString(item, ["branch"]), baseRef: readString(item, ["baseRef", "base_ref"]), sourceSessionId: readString(item, ["sourceSessionId", "source_session_id"]), agentId: readString(item, ["agentId", "agent_id"]), official: true });
    }
  }

  private async tryOfficial(method: string, params: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    if (!this.requestExtension) return undefined;
    try { return await this.requestExtension(method, params); }
    catch (error) { if (isMethodMissing(error)) return undefined; throw error; }
  }

  private async run(args: string[], acceptedExitCodes: number[] = []): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      const result = await execFileAsync(this.gitPath, args, { windowsHide: true, shell: false, encoding: "utf8", maxBuffer: OUTPUT_LIMIT });
      return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
    } catch (error) {
      const value = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: string | number };
      const exitCode = typeof value.code === "number" ? value.code : -1;
      if (acceptedExitCodes.includes(exitCode)) return { stdout: value.stdout ?? "", stderr: value.stderr ?? "", exitCode };
      if (value.code === "ENOENT") throw new Error("未找到系统 Git");
      throw new Error(`Worktree Git 操作失败（${exitCode}）`);
    }
  }
}

function parseWorktreeList(output: string): Array<{ path: string; head?: string; branch?: string; prunable?: boolean }> {
  const result: Array<{ path: string; head?: string; branch?: string; prunable?: boolean }> = [];
  let current: { path: string; head?: string; branch?: string; prunable?: boolean } | undefined;
  for (const field of output.split("\0")) {
    if (!field) { if (current) result.push(current); current = undefined; continue; }
    const split = field.indexOf(" ");
    const key = split < 0 ? field : field.slice(0, split);
    const value = split < 0 ? "" : field.slice(split + 1);
    if (key === "worktree") { if (current) result.push(current); current = { path: value }; }
    else if (current && key === "HEAD") current.head = value;
    else if (current && key === "branch") current.branch = value;
    else if (current && key === "prunable") current.prunable = true;
  }
  if (current) result.push(current);
  return result;
}

function mergeDiffFiles(namesOutput: string, statsOutput: string): WorktreeApplyPreview["files"] {
  const names = namesOutput.split("\0").filter(Boolean);
  const stats = parseStats(statsOutput);
  const files: WorktreeApplyPreview["files"] = [];
  for (let index = 0; index < names.length; index += 1) {
    const status = names[index] ?? "";
    const kind = status.startsWith("A") ? "added" : status.startsWith("D") ? "deleted" : status.startsWith("R") ? "renamed" : status.startsWith("C") ? "copied" : "modified";
    if (/^[RC]\d*/.test(status)) index += 1;
    const path = names[++index] ?? "";
    files.push({ path, kind, ...stats.get(path) });
  }
  return files;
}

function parseStats(output: string): Map<string, { additions?: number; deletions?: number }> {
  const values = output.split("\0");
  const result = new Map<string, { additions?: number; deletions?: number }>();
  for (let index = 0; index < values.length; index += 1) {
    const [added, deleted, path = ""] = (values[index] ?? "").split("\t");
    let target = path;
    if (!target && values[index + 2]) { target = values[index + 2] ?? ""; index += 2; }
    if (target) result.set(target, { additions: added === "-" ? undefined : Number(added), deletions: deleted === "-" ? undefined : Number(deleted) });
  }
  return result;
}

function parseCommitPairs(output: string): Array<{ hash: string; subject: string }> {
  const values = output.split("\0").map((value) => value.replace(/^\r?\n|\r?\n$/g, "")).filter(Boolean);
  const result: Array<{ hash: string; subject: string }> = [];
  for (let index = 0; index < values.length; index += 2) result.push({ hash: values[index] ?? "", subject: values[index + 1] ?? "" });
  return result;
}

function emptyPreview(worktree: GrokWorktreeSummary, targetPath: string, targetClean: boolean, reason: string): WorktreeApplyPreview {
  return { worktreeId: worktree.id, sourcePath: worktree.path, targetPath, baseRef: worktree.baseRef, headRef: worktree.head, commits: [], files: [], additions: 0, deletions: 0, targetClean, canApply: false, reason };
}

function previewToken(targetHead: string, sourceHead: string, files: WorktreeApplyPreview["files"]): string {
  return createHash("sha256").update(JSON.stringify({ targetHead, sourceHead, files })).digest("hex");
}

function validateName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 80 || /[\\/:*?"<>|\0]/.test(name) || name === "." || name === "..") throw new Error("Worktree 名称无效");
  return name;
}

function slug(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 48) || "worktree";
}

function shortBranch(value?: string): string | undefined { return value?.replace(/^refs\/heads\//, ""); }
function pathKey(value: string): string { const normalized = resolve(value).replace(/[\\/]+$/, ""); return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized; }
function samePath(left: string, right: string): boolean { return pathKey(left) === pathKey(right); }
function isMethodMissing(error: unknown): boolean { return /(?:method not found|-32601|not supported|unsupported)/i.test(error instanceof Error ? error.message : String(error)); }
function readString(value: Record<string, unknown> | undefined, keys: string[]): string | undefined { for (const key of keys) if (typeof value?.[key] === "string" && value[key]) return value[key] as string; return undefined; }
function metadataToSummary(value: WorktreeMetadata): GrokWorktreeSummary { return { id: value.id, name: value.name, path: value.path, branch: value.branch, baseRef: value.baseRef, sourceSessionId: value.sourceSessionId, agentId: value.agentId, changedFiles: 0, state: "ready", official: value.official, createdAt: value.createdAt, lastUsedAt: value.lastUsedAt }; }

export const worktreeInternals = { parseWorktreeList, mergeDiffFiles, validateName };
