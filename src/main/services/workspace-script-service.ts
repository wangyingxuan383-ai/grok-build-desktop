import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  WorkspaceScript,
  WorkspaceScriptIcon,
  WorkspaceScriptListResult,
  WorkspaceScriptRunInput,
  WorkspaceScriptRunReceipt,
  WorkspaceScriptSaveInput,
  WorkspaceScriptSource,
} from "../../shared/workspace-tools";
import type { GitService } from "./git-service";
import { JsonStore } from "./json-store";
import { resolveProjectIdentity } from "./project-identity";
import type { WorkspaceTerminalService } from "./workspace-terminal-service";

const execFileAsync = promisify(execFile);
const MAX_REPO_CONFIG_BYTES = 256 * 1024;
const MAX_USER_SCRIPTS_PER_PROJECT = 64;
const MAX_REPO_SCRIPTS_PER_FILE = 64;
const SCRIPT_ICONS: readonly WorkspaceScriptIcon[] = ["play", "test", "lint", "configure", "build", "debug"];
const LOCAL_PREVIEW_URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d{2,5}(?:\/[^\s\u001b"'<>]*)?/i;

interface StoredUserScript {
  id: string;
  name: string;
  command: string;
  icon: WorkspaceScriptIcon;
  async?: boolean;
  autoOpenPreview?: boolean;
  previewUrl?: string;
  runOnWorktreeCreate?: boolean;
  stopOnSettle?: boolean;
  runOnSettle?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface RepoScriptApproval {
  commandHash: string;
  repositoryRoot?: string;
  approvedAt: string;
}

interface WorkspaceScriptsState {
  version: 1;
  projects: Record<string, StoredUserScript[]>;
  approvals: Record<string, Record<string, RepoScriptApproval>>;
}

interface ActiveScriptRun {
  receipt: WorkspaceScriptRunReceipt;
  previewOpened: boolean;
  completion: Promise<number>;
  resolveExit: (code: number) => void;
}

export interface WorkspaceScriptServiceOptions {
  gitPath?: string;
  onOpenPreview?: (url: string, context: { sessionId?: string; workspace: string }) => void | Promise<unknown>;
  hasOtherLiveSessionInWorktree?: (worktreeId: string, excludingSessionId?: string, executionCwd?: string) => boolean;
}

export interface ScriptLifecycleContext {
  projectWorkspacePath: string;
  executionCwd: string;
  worktreeId?: string;
  sessionId?: string;
}

export class WorkspaceScriptService {
  private readonly store: JsonStore<WorkspaceScriptsState>;
  private readonly activeRuns = new Map<string, ActiveScriptRun>();
  private readonly gitPath: string;
  private readonly onOpenPreview?: WorkspaceScriptServiceOptions["onOpenPreview"];
  private readonly hasOtherLiveSessionInWorktree?: WorkspaceScriptServiceOptions["hasOtherLiveSessionInWorktree"];
  private disposed = false;

  constructor(
    userDataPath: string,
    private readonly git: GitService,
    private readonly terminals: WorkspaceTerminalService,
    options: WorkspaceScriptServiceOptions = {},
  ) {
    this.store = new JsonStore<WorkspaceScriptsState>(join(userDataPath, "workspace-scripts.json"), {
      version: 1,
      projects: {},
      approvals: {},
    });
    this.gitPath = options.gitPath ?? "git";
    this.onOpenPreview = options.onOpenPreview;
    this.hasOtherLiveSessionInWorktree = options.hasOtherLiveSessionInWorktree;
  }

  async list(workspacePath: string, discoveryCwd?: string): Promise<WorkspaceScriptListResult> {
    const project = await resolveProjectIdentity(workspacePath);
    if (!project.exists) throw new Error("项目路径不存在或不可访问");
    const trustInfo = await this.resolveTrustInfo(project.canonicalPath);
    const effectiveDiscoveryCwd = discoveryCwd ? await realpath(discoveryCwd).catch(() => resolve(discoveryCwd)) : undefined;
    const discoveryRoot = effectiveDiscoveryCwd ?? trustInfo.repositoryRoot ?? project.canonicalPath;

    const [state, grokRepoScripts, t3RepoScripts] = await Promise.all([
      this.store.get(),
      this.discoverRepoFile(project.id, discoveryRoot, join(discoveryRoot, ".grok", "project.json"), "grok-project", true),
      this.discoverRepoFile(project.id, discoveryRoot, join(discoveryRoot, "t3.json"), "t3", false),
    ]);

    const userScripts: WorkspaceScript[] = (state.projects[project.id] ?? []).map((item) => ({
      ...item,
      projectId: project.id,
      source: "user" as const,
      trusted: true,
      commandHash: hashScriptCommand(item.command),
    }));

    const projectApprovals = state.approvals[project.id] ?? {};
    const repoScripts: WorkspaceScript[] = [...grokRepoScripts, ...t3RepoScripts].map((script) => {
      const approval = projectApprovals[script.id];
      const repoRootMatches = !trustInfo.repositoryRoot || !approval?.repositoryRoot || samePath(approval.repositoryRoot, trustInfo.repositoryRoot);
      const trusted = trustInfo.repositoryTrusted && Boolean(approval && approval.commandHash === script.commandHash && repoRootMatches);
      return { ...script, trusted };
    });

    return {
      projectId: project.id,
      workspacePath: project.canonicalPath,
      repositoryTrusted: trustInfo.repositoryTrusted,
      repositoryTrustRequired: trustInfo.repositoryTrustRequired,
      ...(trustInfo.repositoryRoot ? { repositoryRoot: trustInfo.repositoryRoot } : {}),
      scripts: [...userScripts, ...repoScripts],
    };
  }

  async saveUserScript(input: WorkspaceScriptSaveInput): Promise<WorkspaceScript> {
    const project = await resolveProjectIdentity(input.workspacePath);
    if (!project.exists) throw new Error("项目路径不存在或不可访问");
    const name = validateScriptName(input.name);
    const command = validateScriptCommand(input.command);
    const icon = validateScriptIcon(input.icon);
    const previewUrl = validatePreviewUrl(input.previewUrl);
    if (input.id?.startsWith("repo:")) throw new Error("仓库发现脚本为只读，无法直接覆盖；请新建用户脚本");

    const now = new Date().toISOString();
    const id = input.id?.trim() || `user-${randomUUID()}`;
    let saved!: StoredUserScript;

    await this.store.mutate((state) => {
      state.projects ??= {};
      const list = state.projects[project.id] ?? [];
      const existingIndex = list.findIndex((item) => item.id === id);
      if (existingIndex < 0 && list.length >= MAX_USER_SCRIPTS_PER_PROJECT) {
        throw new Error(`每个项目最多保存 ${MAX_USER_SCRIPTS_PER_PROJECT} 个自定义脚本`);
      }
      const existing = existingIndex >= 0 ? list[existingIndex] : undefined;
      saved = {
        id,
        name,
        command,
        icon,
        ...(input.async !== undefined ? { async: Boolean(input.async) } : {}),
        ...(input.autoOpenPreview !== undefined ? { autoOpenPreview: Boolean(input.autoOpenPreview) } : {}),
        ...(previewUrl ? { previewUrl } : {}),
        ...(input.runOnWorktreeCreate !== undefined ? { runOnWorktreeCreate: Boolean(input.runOnWorktreeCreate) } : {}),
        ...(input.stopOnSettle !== undefined ? { stopOnSettle: Boolean(input.stopOnSettle) } : {}),
        ...(input.runOnSettle !== undefined ? { runOnSettle: Boolean(input.runOnSettle) } : {}),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      if (existingIndex >= 0) list[existingIndex] = saved;
      else list.push(saved);
      state.projects[project.id] = list;
    });

    return {
      ...saved,
      projectId: project.id,
      source: "user",
      trusted: true,
      commandHash: hashScriptCommand(saved.command),
    };
  }

  async deleteUserScript(workspacePath: string, scriptId: string): Promise<void> {
    if (scriptId.startsWith("repo:")) throw new Error("仓库配置文件中的脚本为只读，无法从桌面端删除");
    const project = await resolveProjectIdentity(workspacePath);
    await this.store.mutate((state) => {
      const list = state.projects?.[project.id];
      if (!list) return;
      const next = list.filter((item) => item.id !== scriptId);
      if (next.length) state.projects[project.id] = next;
      else delete state.projects[project.id];
    });
  }

  async approveRepoScript(
    workspacePath: string,
    scriptId: string,
    expectedCommandHash: string,
    trusted: boolean,
    discoveryCwd?: string,
  ): Promise<WorkspaceScript> {
    if (!scriptId.startsWith("repo:")) throw new Error("仅仓库发现脚本需要信任审批");
    const current = await this.list(workspacePath, discoveryCwd);
    const target = current.scripts.find((item) => item.id === scriptId);
    if (!target) throw new Error("找不到指定的仓库脚本，请刷新后重试");
    if (trusted) {
      if (!current.repositoryTrusted) {
        throw new Error(`请先确认 Git 仓库范围信任：${current.repositoryRoot ?? current.workspacePath}`);
      }
      if (target.commandHash !== expectedCommandHash) {
        throw new Error("脚本命令内容已发生变化（SHA-256 不一致），请重新审查后再授权");
      }
    }

    await this.store.mutate((state) => {
      state.approvals ??= {};
      const map = (state.approvals[current.projectId] ??= {});
      if (trusted) {
        map[scriptId] = {
          commandHash: target.commandHash,
          ...(current.repositoryRoot ? { repositoryRoot: current.repositoryRoot } : {}),
          approvedAt: new Date().toISOString(),
        };
      } else {
        delete map[scriptId];
        if (!Object.keys(map).length) delete state.approvals[current.projectId];
      }
    });

    const refreshed = await this.list(workspacePath, discoveryCwd);
    const updated = refreshed.scripts.find((item) => item.id === scriptId);
    if (!updated) throw new Error("脚本状态刷新失败");
    return updated;
  }

  async run(input: WorkspaceScriptRunInput, waitForCompletion = false): Promise<WorkspaceScriptRunReceipt> {
    if (this.disposed) throw new Error("脚本服务已关闭");
    const executionCwd = await realpath(input.executionCwd ?? input.workspacePath);
    const catalog = await this.list(input.workspacePath, executionCwd);
    const script = catalog.scripts.find((item) => item.id === input.scriptId);
    if (!script) throw new Error("找不到要运行的项目脚本");
    if (!script.trusted) {
      throw new Error(`仓库脚本“${script.name}”尚未获得信任授权（或命令已变更），请先审查并确认信任`);
    }

    this.terminals.removeExited(executionCwd);
    const runId = `script-run-${randomUUID()}`;
    let resolveExit!: (code: number) => void;
    const completion = new Promise<number>((resolvePromise) => { resolveExit = resolvePromise; });

    const receipt: WorkspaceScriptRunReceipt = {
      runId,
      terminalId: "",
      scriptId: script.id,
      scriptName: script.name,
      projectId: catalog.projectId,
      cwd: executionCwd,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.worktreeId ? { worktreeId: input.worktreeId } : {}),
      status: "running",
      ...(script.previewUrl ? { previewUrl: script.previewUrl } : {}),
      stopOnSettle: Boolean(script.stopOnSettle),
      startedAt: new Date().toISOString(),
    };

    const record: ActiveScriptRun = { receipt, previewOpened: false, completion, resolveExit };
    const maybeOpenPreview = (url: string): void => {
      if (record.previewOpened || !script.autoOpenPreview || this.disposed) return;
      record.previewOpened = true;
      record.receipt.previewUrl = url;
      if (this.onOpenPreview) {
        void Promise.resolve(this.onOpenPreview(url, { sessionId: input.sessionId, workspace: executionCwd })).catch(() => undefined);
      }
    };

    let outputBuffer = "";
    const terminal = await this.terminals.create(executionCwd, {
      title: `${iconLabel(script.icon)} · ${script.name}`,
      command: script.command,
      ...(waitForCompletion ? { env: { CI: "1" } } : {}),
      onData: (chunk) => {
        if (record.previewOpened || !script.autoOpenPreview) return;
        outputBuffer = `${outputBuffer}${chunk}`.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").slice(-8192);
        const match = LOCAL_PREVIEW_URL_PATTERN.exec(outputBuffer);
        if (match?.[0]) maybeOpenPreview(match[0]);
      },
      onExit: (exitCode) => {
        record.receipt.status = "exited";
        record.receipt.exitCode = exitCode;
        resolveExit(exitCode);
      },
    });

    receipt.terminalId = terminal.id;
    this.activeRuns.set(runId, record);

    if (script.autoOpenPreview && script.previewUrl) {
      maybeOpenPreview(script.previewUrl);
    }

    if (waitForCompletion && !script.async) {
      let timeoutHandle: NodeJS.Timeout | undefined;
      const timedOut = await Promise.race([
        completion.then(() => false),
        new Promise<boolean>((r) => {
          timeoutHandle = setTimeout(() => r(true), 5 * 60_000);
          timeoutHandle.unref?.();
        }),
      ]);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (timedOut && record.receipt.status === "running") {
        this.stop(runId);
      }
    }

    return { ...record.receipt };
  }

  async listRunning(workspacePath: string): Promise<WorkspaceScriptRunReceipt[]> {
    const key = pathKey(workspacePath);
    const project = await resolveProjectIdentity(workspacePath).catch(() => undefined);
    const results: WorkspaceScriptRunReceipt[] = [];
    for (const [runId, entry] of this.activeRuns) {
      if (entry.receipt.status === "exited") {
        this.activeRuns.delete(runId);
        continue;
      }
      if ((project?.id && entry.receipt.projectId === project.id) || pathKey(entry.receipt.cwd) === key) {
        results.push({ ...entry.receipt });
      }
    }
    return results;
  }

  stop(runIdOrTerminalId: string): void {
    for (const [runId, entry] of this.activeRuns) {
      if (runId === runIdOrTerminalId || entry.receipt.terminalId === runIdOrTerminalId) {
        entry.receipt.status = "exited";
        entry.receipt.exitCode ??= -1;
        entry.resolveExit(-1);
        this.activeRuns.delete(runId);
        this.terminals.close(entry.receipt.terminalId);
        return;
      }
    }
    this.terminals.close(runIdOrTerminalId);
  }

  async runWorktreeCreateHooks(context: ScriptLifecycleContext): Promise<WorkspaceScriptRunReceipt[]> {
    const catalog = await this.list(context.projectWorkspacePath, context.executionCwd);
    const receipts: WorkspaceScriptRunReceipt[] = [];
    for (const script of catalog.scripts) {
      if (!script.runOnWorktreeCreate || !script.trusted) continue;
      receipts.push(await this.run({
        workspacePath: context.projectWorkspacePath,
        scriptId: script.id,
        executionCwd: context.executionCwd,
        sessionId: context.sessionId,
        worktreeId: context.worktreeId,
      }, !script.async));
    }
    return receipts;
  }

  /**
   * Executes settle lifecycle hooks:
   * 1) Stops any active runs with `stopOnSettle: true` scoped to this session/worktree/cwd.
   * 2) HARD SAFETY CHECK: `runOnSettle` ONLY executes when `Boolean(context.worktreeId)` is true
   *    AND `executionCwd` is a verified linked Git worktree (NEVER on the main root checkout!).
   */
  async onSessionSettled(context: ScriptLifecycleContext): Promise<WorkspaceScriptRunReceipt[]> {
    const otherSessionActiveInWorktree = Boolean(
      context.worktreeId && this.hasOtherLiveSessionInWorktree?.(context.worktreeId, context.sessionId, context.executionCwd),
    );
    for (const [runId, entry] of [...this.activeRuns.entries()]) {
      if (entry.receipt.status !== "running" || !entry.receipt.stopOnSettle) continue;
      const matchesSession = Boolean(context.sessionId && entry.receipt.sessionId === context.sessionId);
      const matchesWorktree = Boolean(context.worktreeId && entry.receipt.worktreeId === context.worktreeId);
      const matchesCwd = Boolean(context.worktreeId && samePath(entry.receipt.cwd, context.executionCwd));
      if (matchesSession || (!otherSessionActiveInWorktree && (matchesWorktree || matchesCwd))) {
        this.stop(runId);
      }
    }

    // HARD SAFETY INVARIANT: NEVER run settle scripts on main root checkout!
    if (!Boolean(context.worktreeId) || otherSessionActiveInWorktree) {
      return [];
    }
    if (!context.executionCwd || samePath(context.executionCwd, context.projectWorkspacePath)) {
      return [];
    }
    if (!await this.isLinkedGitWorktree(context.executionCwd)) {
      return [];
    }

    const catalog = await this.list(context.projectWorkspacePath, context.executionCwd);
    const receipts: WorkspaceScriptRunReceipt[] = [];
    for (const script of catalog.scripts) {
      if (!script.runOnSettle || !script.trusted) continue;
      receipts.push(await this.run({
        workspacePath: context.projectWorkspacePath,
        scriptId: script.id,
        executionCwd: context.executionCwd,
        sessionId: context.sessionId,
        worktreeId: context.worktreeId,
      }, !script.async));
    }
    return receipts;
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.activeRuns.values()) {
      entry.receipt.status = "exited";
      entry.receipt.exitCode ??= -1;
      entry.resolveExit(-1);
      try { this.terminals.close(entry.receipt.terminalId); } catch { /* ignore shutdown errors */ }
    }
    this.activeRuns.clear();
  }

  private async resolveTrustInfo(cwd: string): Promise<{
    repositoryTrusted: boolean;
    repositoryTrustRequired: boolean;
    repositoryRoot?: string;
  }> {
    const capability = await this.git.capability(cwd);
    if (!capability.available || !capability.repositoryRoot) {
      return { repositoryTrusted: true, repositoryTrustRequired: false };
    }
    try {
      const trust = await this.git.getRepositoryTrust(cwd);
      return {
        repositoryTrusted: trust.trusted,
        repositoryTrustRequired: trust.required,
        repositoryRoot: trust.repositoryRoot,
      };
    } catch {
      return { repositoryTrusted: false, repositoryTrustRequired: true, repositoryRoot: capability.repositoryRoot };
    }
  }

  private async isLinkedGitWorktree(cwd: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync(
        this.gitPath,
        ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"],
        { windowsHide: true, shell: false, encoding: "utf8", timeout: 10_000 },
      );
      const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const gitDir = lines[0];
      const commonDir = lines[1];
      if (!gitDir || !commonDir) return false;
      return !samePath(gitDir, commonDir);
    } catch {
      return false;
    }
  }

  private async discoverRepoFile(
    projectId: string,
    discoveryRoot: string,
    filePath: string,
    source: Exclude<WorkspaceScriptSource, "user">,
    checkDotGrokDir: boolean,
  ): Promise<WorkspaceScript[]> {
    try {
      if (checkDotGrokDir) {
        const dotGrokStat = await lstat(join(discoveryRoot, ".grok")).catch(() => undefined);
        if (!dotGrokStat || dotGrokStat.isSymbolicLink() || !dotGrokStat.isDirectory()) return [];
      }
      const info = await lstat(filePath).catch(() => undefined);
      if (!info || info.isSymbolicLink() || !info.isFile() || info.size > MAX_REPO_CONFIG_BYTES) return [];
      const raw = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
      return parseRepoConfigScripts(projectId, source, raw);
    } catch {
      return [];
    }
  }
}

export function hashScriptCommand(command: string): string {
  return createHash("sha256").update(command.replace(/\r\n/g, "\n").trim(), "utf8").digest("hex");
}

function parseRepoConfigScripts(
  projectId: string,
  source: Exclude<WorkspaceScriptSource, "user">,
  raw: Record<string, unknown>,
): WorkspaceScript[] {
  const results: WorkspaceScript[] = [];
  const seenIds = new Set<string>();
  const pushCandidate = (keyHint: string, candidate: unknown): void => {
    if (results.length >= MAX_REPO_SCRIPTS_PER_FILE) return;
    const normalized = normalizeRepoScriptCandidate(projectId, source, keyHint, candidate);
    if (!normalized || seenIds.has(normalized.id)) return;
    seenIds.add(normalized.id);
    results.push(normalized);
  };

  if (source === "t3" && typeof raw.setupScript === "string" && raw.setupScript.trim()) {
    pushCandidate("setup", {
      name: "Worktree Setup",
      command: raw.setupScript,
      icon: "configure",
      runOnWorktreeCreate: true,
    });
  }

  for (const field of ["scripts", "actions"] as const) {
    const container = raw[field];
    if (Array.isArray(container)) {
      container.forEach((item, index) => pushCandidate(`${field}-${index}`, item));
    } else if (container && typeof container === "object") {
      for (const [name, value] of Object.entries(container as Record<string, unknown>)) {
        pushCandidate(name, typeof value === "string" ? { name, command: value } : { name, ...(value && typeof value === "object" ? value as Record<string, unknown> : {}) });
      }
    }
  }
  return results;
}

function normalizeRepoScriptCandidate(
  projectId: string,
  source: Exclude<WorkspaceScriptSource, "user">,
  keyHint: string,
  value: unknown,
): WorkspaceScript | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const rawName = typeof row.name === "string" && row.name.trim() ? row.name.trim() : keyHint.trim();
  const rawCommand = typeof row.command === "string" ? row.command.trim() : "";
  if (!rawName || !rawCommand || rawName.length > 120 || Buffer.byteLength(rawCommand, "utf8") > 16_384 || rawCommand.includes("\0")) {
    return undefined;
  }
  const rawKey = typeof row.id === "string" && row.id.trim() ? row.id.trim() : rawName;
  const slug = rawKey.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "script";
  const keyDigest = createHash("sha256").update(rawKey).digest("hex").slice(0, 8);
  const icon = SCRIPT_ICONS.includes(row.icon as WorkspaceScriptIcon) ? (row.icon as WorkspaceScriptIcon) : inferScriptIcon(rawName, rawCommand);
  let previewUrl: string | undefined;
  try { previewUrl = validatePreviewUrl(typeof row.previewUrl === "string" ? row.previewUrl : undefined); } catch { previewUrl = undefined; }

  return {
    id: `repo:${source}:${slug}-${keyDigest}`,
    projectId,
    name: rawName,
    command: rawCommand,
    icon,
    source,
    trusted: false,
    commandHash: hashScriptCommand(rawCommand),
    ...(typeof row.async === "boolean" ? { async: row.async } : {}),
    ...(typeof row.autoOpenPreview === "boolean" ? { autoOpenPreview: row.autoOpenPreview } : {}),
    ...(previewUrl ? { previewUrl } : {}),
    ...(typeof row.runOnWorktreeCreate === "boolean" ? { runOnWorktreeCreate: row.runOnWorktreeCreate } : {}),
    ...(typeof row.stopOnSettle === "boolean" ? { stopOnSettle: row.stopOnSettle } : {}),
    ...(typeof row.runOnSettle === "boolean" ? { runOnSettle: row.runOnSettle } : {}),
  };
}

function inferScriptIcon(name: string, command: string): WorkspaceScriptIcon {
  const text = `${name} ${command}`.toLowerCase();
  if (/\b(test|vitest|jest|pytest|cargo test)\b/.test(text)) return "test";
  if (/\b(lint|eslint|biome|clippy|typecheck|tsc)\b/.test(text)) return "lint";
  if (/\b(build|compile|bundle)\b/.test(text)) return "build";
  if (/\b(install|setup|configure|bootstrap|codegen)\b/.test(text)) return "configure";
  if (/\b(debug|inspect)\b/.test(text)) return "debug";
  return "play";
}

function iconLabel(icon: WorkspaceScriptIcon): string {
  return ({ play: "运行", test: "测试", lint: "检查", configure: "配置", build: "构建", debug: "调试" } as const)[icon];
}

function validateScriptName(value: string): string {
  const trimmed = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed.length > 80) throw new Error("脚本名称不能为空且不得超过 80 个字符");
  return trimmed;
}

function validateScriptCommand(value: string): string {
  const trimmed = value.replace(/\r\n/g, "\n").trim();
  if (!trimmed || trimmed.includes("\0") || Buffer.byteLength(trimmed, "utf8") > 16_384) {
    throw new Error("脚本命令不能为空且不得超过 16 KiB");
  }
  return trimmed;
}

function validateScriptIcon(value: string): WorkspaceScriptIcon {
  if (!SCRIPT_ICONS.includes(value as WorkspaceScriptIcon)) throw new Error("脚本图标类型无效");
  return value as WorkspaceScriptIcon;
}

function validatePreviewUrl(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  let parsed: URL;
  try { parsed = new URL(trimmed); } catch { throw new Error("预览地址必须是有效的 HTTP/HTTPS URL"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("预览地址仅支持 HTTP/HTTPS");
  return parsed.toString();
}

function pathKey(value: string): string {
  const normalized = resolve(value).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function samePath(left: string, right: string): boolean {
  return pathKey(left) === pathKey(right);
}
