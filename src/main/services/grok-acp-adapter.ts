import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { methods as acpMethods, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { createInterface, type Interface } from "node:readline";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REASONING_EFFORTS,
  type Attachment,
  type CliBtwReceipt,
  type CliSessionInfo,
  type CliSessionListItem,
  type CliSessionListResult,
  type CliSessionUsage,
  type ChatEvent,
  type CliRuntimeHandshake,
  type RuntimeEventEnvelope,
  type SessionAttachPolicy,
  type SessionCompactReceipt,
  type SessionCloseOutcome,
  type SessionCloseReceipt,
  type CommandInfo,
  type ModelInfo,
  type PermissionOption,
  type PlanDecisionReceipt,
  type PromptMeta,
  type PromptQueueEntry,
  type QueueOperationReceipt,
  type RewindPoint,
  type ReasoningEffort,
  type SessionMode,
  type ToolCallState,
  type TurnFailure,
  type TurnOutcome,
  type TurnPresentation,
  type UserMessageAttachmentPreview,
} from "../../shared/types";
import { PROVIDER_THINKING_END, PROVIDER_THINKING_START } from "../../shared/provider-gateway-markers";
import { classifyTurnFailure } from "../../shared/turn-failure";
import { isCurrentSessionPlanFile, shouldBlockCommand } from "./plan-gate";
import { resolveModeAfterResume, selectAllowPermissionOption, shouldAutoApproveToolPermissions } from "./permission-policy";
import { TerminalService, type TerminalCreateParams } from "./terminal-service";
import type { LogService } from "./log-service";
import { rejectSymbolicLink, resolveExistingWorkspacePath, resolveNewWorkspacePath } from "./workspace-path-policy";

type JsonRpcId = string | number;
// Interactive turns intentionally have no Desktop wall-clock ceiling. Users
// retain explicit Stop/cancel controls, while Provider idle timeouts continue
// to detect a genuinely silent upstream connection.
export const INTERACTIVE_PROMPT_TIMEOUT_MS: null = null;
export const FIRST_EVENT_WAIT_MS = 20_000;
export const FIRST_EVENT_DIAGNOSTIC_MS = 60_000;

interface PendingRequest {
  method: string;
  turnId?: string;
  promptId?: string;
  resolve(value: unknown): void;
  reject(error: Error & { data?: unknown }): void;
  timer?: NodeJS.Timeout;
}

interface PromptTerminalResult {
  _grokDesktopTerminalOutcome: TurnOutcome;
  _meta?: Record<string, unknown>;
}

interface PendingEffortChange {
  effort: Exclude<ReasoningEffort, "">;
  finish(confirmed: boolean): void;
  timer: NodeJS.Timeout;
}

interface BackgroundTask {
  toolCallId: string;
  title: string;
  command?: string;
}

interface PendingQueueOperation {
  operationId: string;
  description: string;
  confirms(entries: PromptQueueEntry[], runningPromptId?: string): boolean;
  onConfirmed?(): void;
  /** Restore only the optimistic fields owned by this operation. */
  onTimeout?(): void;
  /** Authoritative queue notifications supersede any local rollback. */
  queueRevision: number;
  timer: NodeJS.Timeout;
}

export interface AcpToolDiff {
  path?: string;
  oldText?: string;
  newText?: string;
  additions?: number;
  deletions?: number;
}

export interface ProviderThinkingDemuxState {
  pending: string;
  thought: boolean;
}

export interface ProviderThinkingChunk {
  role: "assistant" | "thought";
  text: string;
}

/**
 * Restores unsigned Anthropic thinking that the loopback gateway had to carry
 * through the CLI as marker-delimited text. Markers may be split at arbitrary
 * ACP chunk boundaries, so the longest possible marker prefix stays buffered.
 */
export function demuxProviderThinkingText(
  state: ProviderThinkingDemuxState,
  text: string,
  flush = false,
): { state: ProviderThinkingDemuxState; chunks: ProviderThinkingChunk[] } {
  let pending = state.pending + text;
  let thought = state.thought;
  const chunks: ProviderThinkingChunk[] = [];
  const emit = (value: string): void => {
    if (!value) return;
    const role = thought ? "thought" : "assistant";
    const previous = chunks.at(-1);
    if (previous?.role === role) previous.text += value;
    else chunks.push({ role, text: value });
  };
  for (;;) {
    const marker = thought ? PROVIDER_THINKING_END : PROVIDER_THINKING_START;
    const index = pending.indexOf(marker);
    if (index >= 0) {
      emit(pending.slice(0, index));
      pending = pending.slice(index + marker.length);
      thought = !thought;
      continue;
    }
    if (flush) {
      emit(pending);
      pending = "";
    } else {
      let held = 0;
      const max = Math.min(marker.length - 1, pending.length);
      for (let size = max; size > 0; size -= 1) {
        if (marker.startsWith(pending.slice(-size))) {
          held = size;
          break;
        }
      }
      emit(held ? pending.slice(0, -held) : pending);
      pending = held ? pending.slice(-held) : "";
    }
    break;
  }
  return { state: { pending, thought }, chunks };
}

/**
 * Grok Build 0.2.x publishes file edits as ACP content blocks such as
 * `{ type: "diff", path, oldText, newText }`. Older Desktop builds only read
 * the non-standard top-level fields, so the conversation said a file changed
 * while the non-Git review index stayed empty. Normalize both wire shapes.
 */
export function extractAcpToolDiff(update: Record<string, any>): AcpToolDiff {
  const blocks = (Array.isArray(update.content) ? update.content : []).flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, any>;
    return value.type === "content" && value.content && typeof value.content === "object"
      ? [value.content as Record<string, any>]
      : [value];
  });
  const block = blocks.find((value) => value.type === "diff" || typeof value.oldText === "string" || typeof value.newText === "string");
  const oldText = stringOrUndefined(update.oldText) ?? stringOrUndefined(update.diff?.oldText) ?? stringOrUndefined(block?.oldText);
  const newText = stringOrUndefined(update.newText) ?? stringOrUndefined(update.diff?.newText) ?? stringOrUndefined(block?.newText)
    ?? (isEditLike(update.kind, update.rawInput?.variant) ? stringOrUndefined(update.rawInput?.content) : undefined);
  const path = stringOrUndefined(block?.path)
    ?? stringOrUndefined(update.diff?.path)
    ?? stringOrUndefined(update.rawInput?.file_path)
    ?? stringOrUndefined(update.rawInput?.target_file);
  const stats = oldText !== undefined && newText !== undefined ? countChangedLines(oldText, newText) : undefined;
  return { path, oldText, newText, ...(stats ?? {}) };
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isEditLike(kind: unknown, variant: unknown): boolean {
  return /^(?:edit|write|create|patch)(?:_file)?$/i.test(String(kind || variant || ""));
}

/** Line-level LCS for ordinary diffs, with a bounded fallback for huge files. */
function countChangedLines(before: string, after: string): { additions: number; deletions: number } {
  if (before === after) return { additions: 0, deletions: 0 };
  const oldLines = before ? before.replace(/\r\n/g, "\n").split("\n") : [];
  const newLines = after ? after.replace(/\r\n/g, "\n").split("\n") : [];
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > prefix && newEnd > prefix && oldLines[oldEnd - 1] === newLines[newEnd - 1]) { oldEnd -= 1; newEnd -= 1; }
  const oldMiddle = oldLines.slice(prefix, oldEnd);
  const newMiddle = newLines.slice(prefix, newEnd);
  if (!oldMiddle.length || !newMiddle.length) return { additions: newMiddle.length, deletions: oldMiddle.length };
  if (oldMiddle.length * newMiddle.length > 4_000_000) {
    return { additions: newMiddle.length, deletions: oldMiddle.length };
  }
  let previous = new Uint32Array(newMiddle.length + 1);
  for (const oldLine of oldMiddle) {
    const current = new Uint32Array(newMiddle.length + 1);
    for (let index = 1; index <= newMiddle.length; index += 1) {
      current[index] = oldLine === newMiddle[index - 1]
        ? previous[index - 1]! + 1
        : Math.max(previous[index]!, current[index - 1]!);
    }
    previous = current;
  }
  const unchanged = previous[newMiddle.length] ?? 0;
  return { additions: newMiddle.length - unchanged, deletions: oldMiddle.length - unchanged };
}

export interface SessionProcessOptions {
  agentProfilePath?: string;
  sessionMeta?: Record<string, unknown>;
  alwaysApprove?: boolean;
  /** In-memory execution-profile overrides retained across controlled respawns. */
  environmentOverride?: NodeJS.ProcessEnv;
  permissionDecider?: (toolCall: unknown) => Promise<boolean | undefined>;
}

interface AdapterOptions extends SessionProcessOptions {
  cliPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  effort: ReasoningEffort;
  modelId?: string;
  /** Stable managed-provider model id shown by Desktop and persisted across resumes. */
  localModelId?: string;
  mode: SessionMode;
  log: LogService;
  sessionMcpServers?: unknown[];
  pluginDirs?: string[];
  extensionLeaseId?: string;
  effortFlag?: "--effort" | "--reasoning-effort";
  providerScopeId?: string;
  initialPromptQueue?: PromptQueueEntry[];
  onPromptQueueChanged?: (sessionId: string, entries: PromptQueueEntry[]) => void | Promise<void>;
  onPromptQueueTerminal?: (sessionId: string, entry: PromptQueueEntry) => void | Promise<void>;
  onRuntimeChanged?: (sessionId: string, patch: { modelId?: string; effort?: ReasoningEffort; mode?: SessionMode }) => void | Promise<void>;
  sessionAttachPolicy?: SessionAttachPolicy;
}

export interface UserPromptPresentation {
  clientMessageId?: string;
  attachments?: UserMessageAttachmentPreview[];
}

export const DEFAULT_SESSION_ATTACH_POLICY: SessionAttachPolicy = {
  nonInteractive: false,
  deliveryTools: [],
};

export function buildSessionAttachMeta(
  sessionMeta: Record<string, unknown> | undefined,
  pluginDirs: string[] | undefined,
  policy: SessionAttachPolicy = DEFAULT_SESSION_ATTACH_POLICY,
): Record<string, unknown> {
  return {
    ...(sessionMeta ?? {}),
    ...(pluginDirs?.length ? { pluginDirs: [...pluginDirs] } : {}),
    startupHints: {
      nonInteractive: policy.nonInteractive,
      deliveryTools: [...policy.deliveryTools],
    },
  };
}

interface SessionResponse {
  sessionId: string;
  models?: {
    currentModelId?: string;
    availableModels?: Array<{
      modelId: string;
      name: string;
      description?: string;
      _meta?: {
        totalContextTokens?: number;
        acceptsImages?: boolean;
        inputModalities?: unknown[];
        supportsReasoningEffort?: boolean;
        reasoningEfforts?: Array<{
          value?: unknown;
          label?: unknown;
          description?: unknown;
          default?: unknown;
        }>;
      };
    }>;
  };
  modes?: { currentModeId?: string; availableModes?: unknown[] };
}
type SessionModel = NonNullable<NonNullable<SessionResponse["models"]>["availableModels"]>[number];

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".m4v"]);
const MEDIA_PATH = /(?:\\\\\?\\)?(?:[A-Za-z]:[\\/]|\/|\\\\)[^\r\n"'<>|?*]*?\.(?:png|jpe?g|gif|webp|bmp|svg|mp4|mov|webm|m4v)(?=$|[\s.,;:)"'\]])/gi;

export class LiveEffortUnsupportedError extends Error {
  override readonly name = "LiveEffortUnsupportedError";
}

export function buildGrokAgentArgs(effort: ReasoningEffort, pluginDirs: string[] = [], effortFlag: "--effort" | "--reasoning-effort" = "--reasoning-effort", options: SessionProcessOptions & { modelId?: string } = {}): string[] {
  return [
    "--no-auto-update",
    "agent",
    ...(options.modelId ? ["--model", options.modelId] : []),
    ...(effort ? [effortFlag, effort] : []),
    ...(options.alwaysApprove ? ["--always-approve"] : []),
    ...(options.agentProfilePath ? ["--agent-profile", options.agentProfilePath] : []),
    ...pluginDirs.flatMap((path) => ["--plugin-dir", path]),
    "stdio",
  ];
}

export class GrokAcpAdapter extends EventEmitter {
  private process?: ChildProcessWithoutNullStreams;
  private lines?: Interface;
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly terminal: TerminalService;
  private readonly terminalCommands = new Map<string, string>();
  private readonly mediaToolIds = new Set<string>();
  /** Prevent MCP/image replay from rendering the same artifact twice. */
  private readonly emittedMediaKeys = new Set<string>();
  private readonly backgroundTasks = new Map<string, BackgroundTask>();
  private readonly completedBackgroundTasks = new Map<string, { update: Record<string, any>; at: number }>();
  private readonly recapHashes = new Set<string>();
  private readonly pendingRecaps = new Map<string, { turnId?: string; text: string; contentHash: string }>();
  private readonly ownedQueuedPromptIds = new Set<string>();
  private promptQueue: PromptQueueEntry[] = [];
  private activeQueuedPromptId?: string;
  private activeQueuedPrompt?: PromptQueueEntry;
  private pendingQueuedTurn?: PromptQueueEntry;
  private restoredQueueTimer?: NodeJS.Timeout;
  private readonly restoredQueueIds = new Set<string>();
  private readonly restoredQueueSeenIds = new Set<string>();
  private readonly pendingQueueOperations = new Map<string, PendingQueueOperation>();
  private queueRevision = 0;
  private pendingEffortChange?: PendingEffortChange;
  private pendingPlanRequest?: JsonRpcId;
  private readonly pendingPermissionRequests = new Set<string>();
  private readonly pendingQuestionRequests = new Set<string>();
  private readonly pendingInteractionRequestIds = new Map<string, JsonRpcId>();
  private readonly resolvedPlanRequests = new Map<string, PlanDecisionReceipt>();
  private activeTurn?: TurnPresentation & { monotonicStartedAt: number };
  private readonly settledTurns = new Map<string, TurnPresentation>();
  private readonly turnsAwaitingAuthoritativeTerminal = new Set<string>();
  private nextTurnOrdinal = 0;
  private cancelRequested = false;
  private providerThinking: ProviderThinkingDemuxState = { pending: "", thought: false };
  private closedEmitted = false;
  private disposed = false;
  private currentEffort: ReasoningEffort;
  private requestedModelId = "";
  private providerLocalModelId?: string;
  private upstreamModelId = "";
  private suspendModelRuntimePersistence = false;
  private planGateReleased = false;
  private firstEventTurnId?: string;
  private firstEventWaitTimer?: ReturnType<typeof setTimeout>;
  private firstEventDiagnosticTimer?: ReturnType<typeof setTimeout>;
  sessionId = "";
  models: ModelInfo[] = [];
  commands: CommandInfo[] = [];
  registeredTools: string[] = [];
  currentModelId = "";
  mode: SessionMode;
  planActive = false;
  autoApprove = false;
  lastTouched = Date.now();
  working = false;
  needsUser = false;
  readonly extensionLeaseId?: string;
  runtimeHandshake?: CliRuntimeHandshake;
  lastCloseReceipt?: SessionCloseReceipt;

  get cwd(): string { return this.options.cwd; }
  get effort(): ReasoningEffort { return this.currentEffort; }
  get currentUpstreamModelId(): string { return this.upstreamModelId; }
  get processOptions(): SessionProcessOptions {
    return {
      agentProfilePath: this.options.agentProfilePath,
      sessionMeta: this.options.sessionMeta ? structuredClone(this.options.sessionMeta) : undefined,
      // Mode is the source of truth. Retaining the launch-time boolean made an
      // Auto profile stay --always-approve after the conversation switched to
      // Agent or Plan and was later respawned.
      alwaysApprove: this.mode === "auto",
      environmentOverride: this.options.environmentOverride ? { ...this.options.environmentOverride } : undefined,
      permissionDecider: this.options.permissionDecider,
    };
  }
  queuedPrompts(): PromptQueueEntry[] { return this.promptQueue.map((entry) => ({ ...entry })); }
  get activeTurnId(): string | undefined { return this.activeTurn?.turnId; }
  /** Official Grok allows a model change while the Plan decision card is
   * waiting. This is deliberately narrower than `needsUser`, which also
   * covers permission/question prompts that must remain locked. */
  get planDecisionPending(): boolean { return this.pendingPlanRequest !== undefined; }
  setNextTurnOrdinal(value: number): void { this.nextTurnOrdinal = Math.max(this.nextTurnOrdinal, Math.max(0, Math.floor(value))); }

  async waitForCommands(timeoutMs = 2_000): Promise<CommandInfo[]> {
    if (this.commands.length) return this.commands;
    return new Promise((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        this.off("commands-changed", finish);
        resolve(this.commands);
      };
      const timer = setTimeout(finish, timeoutMs);
      this.once("commands-changed", finish);
    });
  }

  mediaCapabilityEvidence(): { commands: CommandInfo[]; tools: string[] } {
    return {
      commands: this.commands.map((command) => ({ ...command })),
      tools: [...this.registeredTools],
    };
  }

  constructor(private readonly options: AdapterOptions) {
    super();
    this.currentEffort = options.effort;
    this.requestedModelId = options.modelId ?? "";
    this.providerLocalModelId = options.localModelId;
    this.terminal = new TerminalService(options.env);
    this.mode = options.mode;
    this.planActive = options.mode === "plan";
    this.autoApprove = options.mode === "auto";
    this.extensionLeaseId = options.extensionLeaseId;
    this.promptQueue = (options.initialPromptQueue ?? [])
      .filter((entry) => !["completed", "failed", "cancelled"].includes(entry.state))
      .slice(0, 128)
      .map((entry, position) => ({ ...entry, position }));
    for (const entry of this.promptQueue) {
      this.ownedQueuedPromptIds.add(entry.id);
      this.restoredQueueIds.add(entry.id);
    }
  }

  async start(resumeSessionId?: string): Promise<{ sessionId: string }> {
    await this.launchAndInitialize();
    const sessionParams = {
      ...(resumeSessionId ? { sessionId: resumeSessionId } : {}),
      cwd: this.options.cwd,
      mcpServers: this.options.sessionMcpServers ?? [],
      _meta: buildSessionAttachMeta(this.options.sessionMeta, this.options.pluginDirs, this.options.sessionAttachPolicy),
    };
    let response: SessionResponse;
    if (!resumeSessionId) {
      response = await this.request(acpMethods.agent.session.new, sessionParams, 120_000) as SessionResponse;
    } else if (this.runtimeHandshake?.sessionCapabilities?.resume) {
      // `session/resume` re-attaches without replaying the complete transcript.
      // This is important for a second Desktop window and for long sessions;
      // the local projection remains the source of visible history.
      try {
        const resumed = await this.request(acpMethods.agent.session.resume, sessionParams, 120_000) as SessionResponse | undefined;
        // ACP 0.2.120 currently returns only modes/configuration for resume;
        // tolerate an empty result and keep the requested identity rather than
        // turning a successful re-attach into a renderer-visible crash.
        response = { ...(resumed ?? {}), sessionId: resumed?.sessionId || resumeSessionId };
      } catch (error) {
        // A rolling CLI may advertise the capability before its worker is
        // upgraded. Only method/parameter capability failures fall back to
        // load; timeouts and transport errors are not retried against another
        // session method because the server may already have resumed it.
        if (!isAcpCapabilityError(error)) throw error;
        await this.options.log.log(`session/resume 不可用，回退 session/load：${error instanceof Error ? error.message : String(error)}`);
        response = await this.request(acpMethods.agent.session.load, sessionParams, 120_000) as SessionResponse;
      }
    } else {
      response = await this.request(acpMethods.agent.session.load, sessionParams, 120_000) as SessionResponse;
    }
    if (resumeSessionId) this.sessionId = resumeSessionId;
    this.sessionId = response.sessionId || resumeSessionId || "";
    await this.completeSessionAttach(response, resumeSessionId);
    return { sessionId: this.sessionId };
  }

  /**
   * Create an official cross-working-directory fork without first creating a
   * disposable blank session. This is used when a project's old path no
   * longer exists: the source identity stays explicit and code restoration is
   * never requested implicitly.
   */
  async forkExternal(sourceSessionId: string, sourceCwd: string, newCwd: string): Promise<Record<string, unknown>> {
    await this.launchAndInitialize();
    if (!this.runtimeHandshake?.sessionCapabilities?.fork) {
      throw new Error("当前 Grok CLI 未声明会话分叉能力；请使用 Desktop 项目重新绑定，它会先复制并验证会话再切换路径");
    }
    const result = await this.request(acpMethods.agent.session.fork, {
      sessionId: sourceSessionId,
      cwd: newCwd,
      mcpServers: this.options.sessionMcpServers ?? [],
      _meta: buildSessionAttachMeta(this.options.sessionMeta, this.options.pluginDirs, this.options.sessionAttachPolicy),
    }, 120_000) as Record<string, unknown>;
    return result;
  }

  private async launchAndInitialize(): Promise<void> {
    if (this.process) throw new Error("Grok ACP 进程已经启动");
    const args = buildGrokAgentArgs(this.options.effort, this.options.pluginDirs, this.options.effortFlag, { modelId: this.options.modelId, agentProfilePath: this.options.agentProfilePath, alwaysApprove: this.options.alwaysApprove });
    await this.options.log.log(`spawn ${this.options.cliPath} ${args.join(" ")} cwd=${this.options.cwd}`);
    const batch = process.platform === "win32" && /\.(cmd|bat)$/i.test(this.options.cliPath);
    const executable = batch ? (this.options.env.ComSpec || process.env.ComSpec || "cmd.exe") : this.options.cliPath;
    const processArgs = batch ? ["/d", "/s", "/c", windowsBatchCommand(this.options.cliPath, args)] : args;
    this.process = spawn(executable, processArgs, {
      cwd: this.options.cwd,
      env: this.options.env,
      shell: false,
      windowsVerbatimArguments: batch,
      windowsHide: true,
    });
    this.lines = createInterface({ input: this.process.stdout });
    this.lines.on("line", (line) => void this.onLine(line));
    this.process.stderr.on("data", (data) => void this.options.log.log(`[grok stderr] ${data.toString()}`));
    this.process.stdin.on("error", (error) => void this.options.log.log(`[grok stdin] ${error.message}`));
    this.process.on("error", (error) => this.failAll(error));
    this.process.on("exit", (code) => {
      const activeTurnId = this.activeTurn?.turnId;
      const terminalOutcome: TurnOutcome = this.cancelRequested ? "cancelled" : "failed";
      this.working = false;
      this.needsUser = false;
      this.finishTurn(terminalOutcome);
      this.persistActiveQueueTerminal(terminalOutcome);
      if (activeTurnId) this.settlePromptRequestFromTerminal(activeTurnId, terminalOutcome);
      if (!this.disposed) {
        const message = `Grok 进程已退出（代码 ${String(code)}）`;
        this.emitEvent({ type: "error", sessionId: this.sessionId || undefined, message, failure: this.buildFailure(message, { processExitCode: code ?? undefined, cancelled: this.cancelRequested }) });
      }
      this.failAll(new Error(`Grok process exited (${String(code)})`));
      this.emitClosed();
    });

    const initializeResult = await this.request(acpMethods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    }, 120_000) as Record<string, unknown>;
    this.runtimeHandshake = normalizeRuntimeHandshake(initializeResult);
    this.emit("runtime-handshake", this.runtimeHandshake);
  }

  private async completeSessionAttach(response: SessionResponse, resumeSessionId?: string): Promise<void> {
    const availableModels: SessionModel[] = response.models?.availableModels?.length
      ? response.models.availableModels
      : ((this.runtimeHandshake?.models ?? []).map((model) => ({
        modelId: model.modelId,
        name: model.name ?? model.modelId,
        ...(model.reasoningEfforts?.length ? { _meta: { supportsReasoningEffort: true, reasoningEfforts: model.reasoningEfforts.map((value) => ({ value })) } } : {}),
      })) as SessionModel[]);
    this.models = availableModels.map((model) => {
      const reasoningEfforts = (model._meta?.reasoningEfforts ?? []).flatMap((item) => {
        const effort = normalizeReasoningEffort(item.value);
        if (!effort) return [];
        return [{
          value: effort,
          label: typeof item.label === "string" && item.label.trim() ? item.label : effort,
          ...(typeof item.description === "string" && item.description.trim() ? { description: item.description } : {}),
          ...(typeof item.default === "boolean" ? { default: item.default } : {}),
        }];
      });
      return {
        modelId: model.modelId,
        name: model.name,
        description: model.description,
        totalContextTokens: model._meta?.totalContextTokens,
        ...normalizeImageInputCapability(model._meta),
        supportsReasoningEffort: model._meta?.supportsReasoningEffort === true && reasoningEfforts.length > 0,
        reasoningEfforts,
      };
    });
    const reportedModelId = response.models?.currentModelId ?? this.runtimeHandshake?.currentModelId;
    this.upstreamModelId = reportedModelId || "";
    this.currentModelId = this.providerLocalModelId ?? resolveModelId(reportedModelId, this.models, this.requestedModelId) ?? "";
    if (this.runtimeHandshake) {
      this.runtimeHandshake.currentModelId = reportedModelId;
      this.runtimeHandshake.models = this.models.map((model) => ({
        modelId: model.modelId,
        name: model.name,
        ...(model.reasoningEfforts?.length ? { reasoningEfforts: model.reasoningEfforts.map((item) => item.value) } : {}),
        ...(model.acceptsImages !== undefined ? { acceptsImages: model.acceptsImages } : {}),
        ...(model.inputModalities?.length ? { inputModalities: model.inputModalities } : {}),
      }));
    }
    if (resumeSessionId) this.currentEffort = await readPersistedEffort(this.options.cwd, this.sessionId) ?? this.currentEffort;
    // Persisted sessions store the upstream route id, not the local provider
    // configuration id. Compare the raw ACP value here so resuming a custom
    // model really reapplies its route instead of silently using the official
    // model while the renderer still shows the provider-prefixed alias.
    if (this.options.modelId && this.options.modelId !== reportedModelId) {
      await this.setModel(this.options.modelId, { localModelId: this.providerLocalModelId });
    }
    const reportedModeId = response.modes?.currentModeId;
    if (resumeSessionId && (reportedModeId || this.mode === "auto")) {
      // CLI only reports plan vs default. Desktop Auto is a local overlay and
      // must survive resume; otherwise the composer shows 自动批准 while the
      // adapter silently falls back to asking for every tool.
      this.mode = resolveModeAfterResume(this.mode, reportedModeId);
      this.autoApprove = this.mode === "auto";
      this.planActive = this.mode === "plan";
      this.planGateReleased = false;
      this.persistRuntimePatch({ mode: this.mode });
      this.emitEvent({ type: "mode", sessionId: this.sessionId, mode: this.mode });
    } else {
      await this.applyMode(this.mode, false);
    }
    this.emitEvent({
      type: "session-ready",
      sessionId: this.sessionId,
      models: this.models,
      currentModelId: this.currentModelId,
      effort: this.effort,
      modes: response.modes?.availableModes,
    });
    if (this.promptQueue.length) {
      this.promptQueue = this.promptQueue.map((entry, position) => ({ ...entry, sessionId: this.sessionId, position }));
      this.emitEvent({ type: "prompt-queue", sessionId: this.sessionId, entries: this.promptQueue });
      // A resumed Grok session may replay its private queue during
      // session/load. Give that authoritative notification a short head start;
      // any Desktop-owned IDs it does not replay are re-submitted with the
      // original promptId. This restores queued work without inventing a new
      // user message or changing its ordering.
      this.restoredQueueTimer = setTimeout(() => void this.reconcileRestoredQueue(), 500);
    }
    // Some CLIs publish available commands while session/new is still in
    // flight, before the response assigns sessionId. Re-emit the snapshot with
    // the final id so the renderer does not lose slash/media capabilities.
    if (this.commands.length) this.emitEvent({ type: "commands", sessionId: this.sessionId, commands: this.commands });
    if (resumeSessionId) {
      const persistedMeta = await readPersistedPromptMeta(this.options.cwd, this.sessionId);
      if (persistedMeta) this.emitEvent({ type: "meta", sessionId: this.sessionId, meta: persistedMeta });
    }
    this.emitStatus("idle", "已连接");
  }

  async extension(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (!this.sessionId) throw new Error("会话尚未就绪");
    const result = await this.request(method, { sessionId: this.sessionId, ...params }) as Record<string, unknown>;
    this.observeRuntimeExtension(method);
    return result;
  }

  /**
   * Submit a non-blocking side question through the official x.ai/btw
   * extension.  The command is only exposed after the runtime advertises it
   * (or a previous observed event proved it); older CLIs return an explicit
   * unsupported receipt instead of silently turning it into a queue item.
   */
  async btw(text: string): Promise<CliBtwReceipt> {
    const value = text.trim();
    if (!value) throw new Error("旁路提问不能为空");
    if (!this.runtimeSupportsExtension("x.ai/btw")) {
      return { accepted: false, sessionId: this.sessionId, source: "unsupported", message: "当前 Grok CLI 未声明 /btw 旁路提问能力" };
    }
    // The official CLI calls this a side question and requires the owning
    // session id plus `question`; `text` is not a recognized wire field.
      const result = await this.extension("x.ai/btw", { sessionId: this.sessionId, question: value });
    const payload = unwrapExtResult(result);
    return {
      accepted: payload.accepted !== false && payload.ok !== false && payload.success !== false,
      sessionId: this.sessionId,
      requestId: firstNonEmptyString(payload.requestId, payload.request_id, payload.id),
      // 0.2.119+ returns the side answer as `answer`. Keep it in the
      // receipt so the renderer can show the result without creating a fake
      // assistant turn or queue entry.
      message: firstNonEmptyString(payload.answer, payload.message, payload.status),
      source: "acp",
    };
  }

  /** Official ACP session/list, when advertised by initialize. */
  async officialSessionList(cwd?: string, cursor?: string): Promise<CliSessionListResult> {
    if (!this.runtimeHandshake?.sessionCapabilities?.list) {
      return { supported: false, sessions: [], source: "unsupported" };
    }
    try {
      const result = await this.request(acpMethods.agent.session.list, {
        ...(cwd ? { cwd } : {}),
        ...(cursor ? { cursor } : {}),
      }, 20_000) as Record<string, unknown>;
      return normalizeCliSessionList(result);
    } catch (error) {
      if (isAcpCapabilityError(error)) return { supported: false, sessions: [], source: "unsupported" };
      throw error;
    }
  }

  /** x.ai/session/info is an optional read-only extension. */
  async sessionInfo(): Promise<CliSessionInfo> {
    try {
      // Grok Build 1.0 implements this extension without requiring clients to
      // infer it from a version number. An actual successful request is the
      // capability proof; method-not-found remains the fail-closed path.
      return normalizeCliSessionInfo(this.sessionId, unwrapExtResult(await this.extension("x.ai/session/info", { sessionId: this.sessionId })));
    } catch (error) {
      if (isAcpCapabilityError(error)) return { supported: false, sessionId: this.sessionId, source: "unsupported" };
      throw error;
    }
  }

  /** x.ai/session/usage is optional; never infer token detail when absent. */
  async sessionUsage(): Promise<CliSessionUsage> {
    try {
      return normalizeCliSessionUsage(this.sessionId, unwrapExtResult(await this.extension("x.ai/session/usage", { sessionId: this.sessionId })));
    } catch (error) {
      if (isAcpCapabilityError(error)) return { supported: false, sessionId: this.sessionId, source: "unsupported" };
      throw error;
    }
  }

  /**
   * Rename through the official session authority when the attached CLI
   * implements x.ai/session/rename. Older builds remain a supported local-only
   * fallback; any other failure is surfaced rather than creating two titles.
   */
  async renameSession(title: string): Promise<"official" | "unsupported"> {
    const normalized = title.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    if (!normalized) throw new Error("会话名称不能为空");
    if ([...normalized].length > 100) throw new Error("会话名称不能超过 100 个字符");
    try {
      await this.extension("x.ai/session/rename", {
        title: normalized,
        cwd: this.cwd,
        kind: "build",
      });
      return "official";
    } catch (error) {
      if (isAcpCapabilityError(error)) return "unsupported";
      throw error;
    }
  }

  /** Grok Build 1.0 changed include_untracked to false by default. Never rely on wire defaults. */
  async officialGitStatus(gitRoot?: string): Promise<Record<string, unknown> | undefined> {
    try {
      const result = await this.extension("x.ai/git/status", {
        sessionId: this.sessionId,
        ...(gitRoot ? { gitRoot } : {}),
        includeUntracked: true,
        includeStats: true,
        includePatches: false,
        ignoreSubmodules: true,
      });
      return unwrapExtResult(result);
    } catch (error) {
      if (isAcpCapabilityError(error)) return undefined;
      throw error;
    }
  }

  async compact(): Promise<SessionCompactReceipt> {
    if (!this.sessionId) throw new Error("会话尚未就绪");
    if (this.working || this.needsUser) throw new Error("当前会话正在运行或等待操作，请先停止或处理当前请求");
    const startedAt = new Date().toISOString();
    const before = await this.sessionUsage().catch(() => undefined);
    const beforeTokens = before?.supported ? before.totalTokens : undefined;
    this.emitEvent({ type: "compact-status", sessionId: this.sessionId, status: "started", trigger: "manual", beforeTokens });
    try {
      let source: SessionCompactReceipt["source"];
      if (this.runtimeSupportsExtension("x.ai/session/compact")) {
        await this.extension("x.ai/session/compact", { sessionId: this.sessionId });
        source = "extension";
      } else if (this.commands.some((command) => command.name.replace(/^\//, "").toLowerCase() === "compact")) {
        await this.prompt("/compact", [], INTERACTIVE_PROMPT_TIMEOUT_MS, { clientMessageId: `compact-${crypto.randomUUID()}` });
        source = "slash-command";
      } else {
        this.emitEvent({ type: "compact-status", sessionId: this.sessionId, status: "failed", trigger: "manual", beforeTokens, message: "当前 CLI 未声明 /compact" });
        return { sessionId: this.sessionId, accepted: false, source: "unsupported", startedAt, beforeTokens, message: "当前 Grok CLI 未声明手动压缩能力" };
      }
      const after = await this.sessionUsage().catch(() => undefined);
      const afterTokens = after?.supported ? after.totalTokens : undefined;
      const completedAt = new Date().toISOString();
      this.emitEvent({ type: "compact-status", sessionId: this.sessionId, status: "completed", trigger: "manual", beforeTokens, afterTokens });
      return { sessionId: this.sessionId, accepted: true, source, startedAt, completedAt, beforeTokens, afterTokens, message: "会话压缩已完成" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitEvent({ type: "compact-status", sessionId: this.sessionId, status: "failed", trigger: "manual", beforeTokens, message });
      throw error;
    }
  }

  feedbackCapability(): import("../../shared/types").OfficialFeedbackCapability {
    const available = (this.commands || []).some((command) => command.name.replace(/^\//, "").toLowerCase() === "feedback");
    return available
      ? { available: true, sessionId: this.sessionId, source: "available-command" }
      : { available: false, sessionId: this.sessionId, source: "unavailable", reason: "当前 CLI 会话未发布 /feedback；可能是版本不支持或官方反馈功能未启用。" };
  }

  async submitOfficialFeedback(text: string): Promise<import("../../shared/types").OfficialFeedbackReceipt> {
    const normalized = text.trim();
    if (!normalized) throw new Error("反馈内容不能为空");
    if (Buffer.byteLength(normalized, "utf8") > 64 * 1024) throw new Error("反馈内容超过 64 KiB 限制");
    const capability = this.feedbackCapability();
    if (!capability.available) throw new Error(capability.reason || "当前 CLI 不支持官方反馈");
    const result = unwrapExtResult(await this.extension("x.ai/feedback", {
      session_id: this.sessionId,
      feedback_text: normalized,
    }));
    if (result.success === false) throw new Error(firstNonEmptyString(result.message, result.error) || "官方反馈提交失败");
    return { sessionId: this.sessionId, submitted: true, message: "反馈已通过当前 Grok Build CLI 提交。" };
  }

  async prompt(text: string, attachments: Attachment[] = [], timeoutMs: number | null = INTERACTIVE_PROMPT_TIMEOUT_MS, presentation: UserPromptPresentation = {}): Promise<void> {
    if (!this.sessionId) throw new Error("会话尚未就绪");
    const clientMessageId = presentation.clientMessageId || crypto.randomUUID();
    this.lastTouched = Date.now();
    this.working = true;
    const startedTurn = this.beginTurn(clientMessageId);
    this.emitEvent({ type: "user-message", sessionId: this.sessionId, id: clientMessageId, clientMessageId, text, attachments: presentation.attachments, delivery: "sending" });
    this.emitStatus("working", "Grok 正在处理…");
    try {
      const prompt: unknown[] = [{ type: "text", text: buildPromptText(text, attachments) }];
      for (const attachment of attachments) {
        if (attachment.kind === "image") {
          const data = attachment.data ?? (attachment.path ? await readFile(attachment.path).then((value) => value.toString("base64")) : undefined);
          if (data) prompt.push({ type: "image", data, mimeType: attachment.mimeType || mimeForPath(attachment.path || attachment.name) });
        }
      }
      const result = await this.request(
        acpMethods.agent.session.prompt,
        {
          sessionId: this.sessionId,
          prompt,
          // Pin the mode to this request as well as session/set_mode. Current
          // Grok Build explicitly consumes _meta.mode and reconciles its Plan
          // state from it, which prevents a resumed session or late mode
          // replay from silently executing the turn as Agent mode.
          _meta: { mode: this.mode === "plan" ? "plan" : "agent", clientIdentifier: "grok-build-desktop" },
        },
        timeoutMs,
        () => this.emitEvent({ type: "user-message-status", sessionId: this.sessionId, clientMessageId, delivery: "sent" }),
        startedTurn.turnId,
      ) as { _meta?: Record<string, unknown> } & Partial<PromptTerminalResult>;
      // Cancellation is a notification and older CLIs may resolve the
      // original prompt RPC before publishing their authoritative terminal
      // update.  Never let that race turn an acknowledged Stop into a
      // completed turn.  A terminal result synthesized from turn_completed
      // still wins when it is present.
      const terminalOutcome = result._grokDesktopTerminalOutcome ?? (this.cancelRequested ? "cancelled" : undefined);
      const meta = extractPromptMeta(result);
      this.emitEvent({ type: "meta", sessionId: this.sessionId, meta });
      const completed = this.finishTurn(terminalOutcome ?? "completed", hasUsage(meta) ? { ...meta, modelId: meta.modelId ?? this.currentModelId, source: terminalOutcome ? "acp-turn" : "prompt-result", exact: true } : undefined, startedTurn.turnId);
      if (completed && !terminalOutcome) this.turnsAwaitingAuthoritativeTerminal.add(completed.turnId);
      this.activatePendingQueuedTurn();
      this.working = Boolean(this.activeTurn);
      this.needsUser = false;
      this.flushPendingRecapsIfIdle();
      const terminalStatus = terminalOutcome === "failed" ? "error" : "idle";
      const terminalText = terminalOutcome === "cancelled" ? "已取消" : terminalOutcome === "failed" ? "执行失败" : "已完成";
      this.emitStatus(this.activeTurn ? "working" : terminalStatus, this.activeTurn ? "正在处理已提交的跟进消息…" : terminalText);
    } catch (error) {
      this.working = false;
      this.needsUser = false;
      this.emitEvent({ type: "user-message-status", sessionId: this.sessionId, clientMessageId, delivery: "failed" });
      const failureMessage = error instanceof Error ? error.message : String(error);
      this.emitEvent({ type: "error", sessionId: this.sessionId, message: failureMessage, failure: this.buildFailure(failureMessage, { error }) });
      const failed = this.finishTurn(this.cancelRequested ? "cancelled" : "failed", undefined, startedTurn.turnId);
      if (failed) this.turnsAwaitingAuthoritativeTerminal.add(failed.turnId);
      this.activatePendingQueuedTurn();
      // The structured error event above owns the visible card. A text-bearing
      // status event would append a second unstructured "Internal error" card.
      this.working = Boolean(this.activeTurn);
      this.flushPendingRecapsIfIdle();
      this.emitStatus(this.activeTurn ? "working" : "error", this.activeTurn ? "上一回合失败；正在处理已提交的跟进消息…" : undefined);
      throw error;
    }
  }

  async queuePrompt(text: string, attachments: Attachment[] = [], sendNow = false, presentation: UserPromptPresentation = {}): Promise<QueueOperationReceipt> {
    if (!this.sessionId) throw new Error("会话尚未就绪");
    const id = crypto.randomUUID();
    const clientMessageId = presentation.clientMessageId || id;
    const prompt = await buildPromptBlocks(text, attachments);
    const entry: PromptQueueEntry = { id, sessionId: this.sessionId, clientMessageId, attachmentPreviews: presentation.attachments, text, position: this.promptQueue.length, createdAt: new Date().toISOString(), state: sendNow ? "interjected" : "queued" };
    this.ownedQueuedPromptIds.add(id);
    this.promptQueue = sendNow ? [entry, ...this.promptQueue] : [...this.promptQueue, entry];
    this.emitEvent({ type: "prompt-queue", sessionId: this.sessionId, entries: this.promptQueue });
    // A queued ACP prompt request is intentionally answered only after that
    // prompt eventually runs. Do not keep the Renderer composer blocked while
    // it waits; x.ai/queue/changed remains the authoritative visible state.
    void this.submitQueuedRequest(entry, prompt, sendNow).catch((error) => {
      // Process replacement is a recovery boundary, not a queue failure. The
      // durable entry will be reconciled by the replacement adapter.
      if (this.disposed) return;
      this.ownedQueuedPromptIds.delete(id);
      this.promptQueue = this.promptQueue.filter((value) => value.id !== id);
      this.emitEvent({ type: "prompt-queue", sessionId: this.sessionId, entries: this.promptQueue });
      this.emitEvent({ type: "user-message", sessionId: this.sessionId, id: clientMessageId, clientMessageId, text, attachments: presentation.attachments, delivery: "failed" });
      this.emitEvent({ type: "user-message-status", sessionId: this.sessionId, clientMessageId, delivery: "failed" });
      const failureMessage = error instanceof Error ? error.message : String(error);
      this.emitEvent({ type: "error", sessionId: this.sessionId, message: failureMessage, failure: this.buildFailure(failureMessage, { error }) });
    });
    return {
      operationId: crypto.randomUUID(),
      entryId: id,
      state: sendNow ? "interjected" : "queued",
      message: sendNow ? "插话已置顶并提交" : "消息已加入队列",
      fallback: sendNow,
    };
  }

  async interjectPrompt(text: string, attachments: Attachment[] = [], presentation: UserPromptPresentation = {}): Promise<QueueOperationReceipt> {
    if (!this.sessionId) throw new Error("会话尚未就绪");
    const id = crypto.randomUUID();
    const clientMessageId = presentation.clientMessageId || id;
    const content = await buildPromptBlocks(text, attachments);
    const entry: PromptQueueEntry = {
      id,
      sessionId: this.sessionId,
      clientMessageId,
      attachmentPreviews: presentation.attachments,
      text,
      position: 0,
      createdAt: new Date().toISOString(),
      state: "interjected",
    };
    this.ownedQueuedPromptIds.add(id);
    // Keep the submitted interjection visible until the CLI reports it as the
    // running prompt. It is already accepted at this point and must never be
    // presented with a misleading removable "x" action.
    this.promptQueue = [entry, ...this.promptQueue].map((value, position) => ({ ...value, position }));
    this.emitEvent({ type: "prompt-queue", sessionId: this.sessionId, entries: this.promptQueue });
    try {
      unwrapExtResult(await this.extension("x.ai/interject", { text, interjectionId: id, content }));
      return { operationId: crypto.randomUUID(), entryId: id, state: "interjected", message: "插话已提交；它会在当前步骤收束后作为同一会话的下一回合执行，已提交后不能撤回" };
    } catch (error) {
      this.ownedQueuedPromptIds.delete(id);
      this.promptQueue = this.promptQueue.filter((value) => value.id !== id).map((value, position) => ({ ...value, position }));
      this.emitEvent({ type: "prompt-queue", sessionId: this.sessionId, entries: this.promptQueue });
      // Older CLIs do not expose x.ai/interject. Their closest compatible
      // behavior is the official sendNow prompt metadata path.
      if (!isMethodNotFound(error)) {
        this.emitEvent({ type: "user-message", sessionId: this.sessionId, id: clientMessageId, clientMessageId, text, attachments: presentation.attachments, delivery: "failed" });
        this.emitEvent({ type: "user-message-status", sessionId: this.sessionId, clientMessageId, delivery: "failed" });
        throw error;
      }
      return this.queuePrompt(text, attachments, true, { ...presentation, clientMessageId });
    }
  }

  async editQueuedPrompt(id: string, text: string): Promise<QueueOperationReceipt> {
    const entry = this.promptQueue.find((value) => value.id === id);
    if (!entry || entry.state !== "queued") throw new Error("仅等待中的队列消息可以编辑");
    const operationId = crypto.randomUUID();
    const previousText = entry.text;
    this.awaitQueueConfirmation(
      operationId,
      "编辑队列消息",
      (entries) => entries.some((value) => value.id === id && value.text === text),
      undefined,
      () => {
        this.promptQueue = this.promptQueue.map((value) => value.id === id && value.state === "queued" && value.text === text
          ? { ...value, text: previousText }
          : value);
        this.emitEvent({ type: "prompt-queue", sessionId: this.sessionId, entries: this.promptQueue });
      },
    );
    try { this.queueNotification("x.ai/queue/edit", { id, newText: text }); }
    catch (error) { this.cancelQueueConfirmation(operationId); throw error; }
    this.promptQueue = this.promptQueue.map((value) => value.id === id ? { ...value, text } : value);
    this.emitEvent({ type: "prompt-queue", sessionId: this.sessionId, entries: this.promptQueue });
    return { operationId, entryId: id, state: "updated", message: "编辑已写入 CLI，等待队列刷新确认", acknowledgement: "transport" };
  }
  async removeQueuedPrompt(id: string): Promise<QueueOperationReceipt> {
    const entry = this.promptQueue.find((value) => value.id === id);
    if (!entry || entry.state !== "queued") throw new Error("仅等待中的队列消息可以删除");
    const operationId = crypto.randomUUID();
    const previousPosition = this.promptQueue.findIndex((value) => value.id === id);
    this.awaitQueueConfirmation(
      operationId,
      "撤回队列消息",
      (entries) => !entries.some((value) => value.id === id),
      () => this.ownedQueuedPromptIds.delete(id),
      () => {
        if (this.promptQueue.some((value) => value.id === id)) return;
        const restored = [...this.promptQueue];
        restored.splice(Math.max(0, Math.min(previousPosition, restored.length)), 0, entry);
        this.promptQueue = restored.map((value, position) => ({ ...value, position }));
        this.emitEvent({ type: "prompt-queue", sessionId: this.sessionId, entries: this.promptQueue });
      },
    );
    try { this.queueNotification("x.ai/queue/remove", { id, expectedVersion: entry?.version ?? 0 }); }
    catch (error) { this.cancelQueueConfirmation(operationId); throw error; }
    this.promptQueue = this.promptQueue.filter((value) => value.id !== id).map((value, position) => ({ ...value, position }));
    this.emitEvent({ type: "prompt-queue", sessionId: this.sessionId, entries: this.promptQueue });
    return { operationId, entryId: id, state: "removed", message: "撤回请求已写入 CLI，等待队列刷新确认", acknowledgement: "transport" };
  }
  async reorderQueuedPrompt(id: string, position: number): Promise<QueueOperationReceipt> {
    const ordered = [...this.promptQueue].sort((a, b) => a.position - b.position);
    const current = ordered.findIndex((value) => value.id === id);
    if (current < 0) throw new Error("排队消息已不存在，请等待队列刷新");
    if (ordered[current]?.state !== "queued") throw new Error("已提交或发送中的消息不能重新排序");
    const [moved] = ordered.splice(current, 1);
    ordered.splice(Math.max(0, Math.min(position, ordered.length)), 0, moved!);
    const operationId = crypto.randomUUID();
    const orderedIds = ordered.map((value) => value.id);
    const previousIds = this.promptQueue.slice().sort((a, b) => a.position - b.position).map((value) => value.id);
    this.awaitQueueConfirmation(
      operationId,
      "调整队列顺序",
      (entries) => entries.map((value) => value.id).join("\0") === orderedIds.join("\0"),
      undefined,
      () => {
        const positions = new Map(previousIds.map((value, index) => [value, index]));
        this.promptQueue = this.promptQueue.slice()
          .sort((a, b) => (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER))
          .map((value, nextPosition) => ({ ...value, position: nextPosition }));
        this.emitEvent({ type: "prompt-queue", sessionId: this.sessionId, entries: this.promptQueue });
      },
    );
    try { this.queueNotification("x.ai/queue/reorder", { orderedIds }); }
    catch (error) { this.cancelQueueConfirmation(operationId); throw error; }
    this.promptQueue = ordered.map((value, nextPosition) => ({ ...value, position: nextPosition }));
    this.emitEvent({ type: "prompt-queue", sessionId: this.sessionId, entries: this.promptQueue });
    return { operationId, entryId: id, state: "reordered", message: "顺序调整已写入 CLI，等待队列刷新确认", acknowledgement: "transport" };
  }
  async clearPromptQueue(): Promise<QueueOperationReceipt> {
    const removable = this.promptQueue.filter((entry) => entry.state === "queued");
    const operationId = crypto.randomUUID();
    const removableIds = new Set(removable.map((entry) => entry.id));
    if (removable.length) this.awaitQueueConfirmation(
      operationId,
      "撤回全部等待消息",
      (entries) => entries.every((entry) => !removableIds.has(entry.id)),
      () => { for (const id of removableIds) this.ownedQueuedPromptIds.delete(id); },
      () => {
        const byId = new Map(this.promptQueue.map((entry) => [entry.id, entry]));
        for (const entry of removable) if (!byId.has(entry.id)) byId.set(entry.id, entry);
        this.promptQueue = [...byId.values()].sort((a, b) => a.position - b.position).map((value, position) => ({ ...value, position }));
        this.emitEvent({ type: "prompt-queue", sessionId: this.sessionId, entries: this.promptQueue });
      },
    );
    try {
      for (const entry of removable) {
        this.queueNotification("x.ai/queue/remove", { id: entry.id, expectedVersion: entry.version ?? 0 });
      }
    } catch (error) {
      this.cancelQueueConfirmation(operationId);
      throw error;
    }
    this.promptQueue = this.promptQueue.filter((entry) => entry.state !== "queued").map((value, position) => ({ ...value, position }));
    this.emitEvent({ type: "prompt-queue", sessionId: this.sessionId, entries: this.promptQueue });
    return {
      operationId,
      state: "cleared",
      message: removable.length ? `已向 CLI 提交撤回 ${removable.length} 条等待消息，正在确认` : "没有可撤回的等待消息；已提交的插话不能撤回",
      acknowledgement: removable.length ? "transport" : "cli",
    };
  }
  async interjectQueuedPrompt(id: string, text?: string): Promise<QueueOperationReceipt> {
    const entry = this.promptQueue.find((value) => value.id === id);
    if (!entry || entry.state !== "queued") throw new Error("该消息已不在等待队列中");
    const operationId = crypto.randomUUID();
    const nextText = text?.trim() || entry.text;
    this.awaitQueueConfirmation(
      operationId,
      "置顶插话",
      (entries, runningPromptId) => runningPromptId === id || entries.some((value) => value.id === id && value.state !== "queued"),
      undefined,
      () => {
        this.promptQueue = this.promptQueue.map((value) => value.id === id && value.state === "interjected"
          ? { ...value, state: "queued", text: entry.text }
          : value);
        this.emitEvent({ type: "prompt-queue", sessionId: this.sessionId, entries: this.promptQueue });
      },
    );
    try { this.queueNotification("x.ai/queue/interject", { id, expectedVersion: entry?.version ?? 0, ...(text?.trim() ? { newText: nextText } : {}) }); }
    catch (error) { this.cancelQueueConfirmation(operationId); throw error; }
    this.promptQueue = this.promptQueue.map((value) => value.id === id ? { ...value, state: "interjected", text: nextText } : value);
    this.emitEvent({ type: "prompt-queue", sessionId: this.sessionId, entries: this.promptQueue });
    return { operationId, entryId: id, state: "interjected", message: "插话已写入 CLI；确认后会作为同一会话的下一回合执行", acknowledgement: "transport" };
  }
  async fork(targetPromptIndex?: string, newCwd = this.cwd): Promise<Record<string, unknown>> {
    const parsed = targetPromptIndex === undefined ? undefined : Number.parseInt(targetPromptIndex, 10);
    if (newCwd !== this.cwd && !this.runtimeHandshake?.sessionCapabilities?.fork) {
      throw new Error("当前 Grok CLI 未声明跨目录会话分叉能力");
    }
    return this.extension("x.ai/session/fork", {
      sourceSessionId: this.sessionId,
      sourceCwd: this.cwd,
      newCwd,
      ...(Number.isInteger(parsed) && (parsed as number) >= 0 ? { targetPromptIndex: parsed } : {}),
    });
  }
  async rewindPoints(): Promise<RewindPoint[]> {
    try {
      const result = await this.extension("x.ai/rewind/points");
      return normalizeRewindPoints(result);
    } catch (error) {
      // Rewind is an optional private Grok extension. Older installed CLIs
      // answer -32601; opening the panel must degrade to an empty state rather
      // than surface a global application error.
      if (isMethodNotFound(error)) return [];
      throw error;
    }
  }
  async rewind(pointId: string): Promise<void> {
    const targetPromptIndex = Number.parseInt(pointId, 10);
    if (!Number.isInteger(targetPromptIndex) || targetPromptIndex < 0) throw new Error("CLI 返回的回退点无效");
    await this.extension("x.ai/rewind/execute", { targetPromptIndex, force: false, mode: "conversation_only" });
  }
  async taskList(): Promise<Record<string, unknown>> {
    return unwrapExtResult(await this.extension("x.ai/task/list"));
  }
  async subagentListRunning(): Promise<Record<string, unknown>> {
    return unwrapExtResult(await this.extension("x.ai/subagent/list_running"));
  }
  async taskKill(taskId: string, source: "clientUi" | "teardown" = "clientUi"): Promise<void> {
    const response = unwrapExtResult(await this.extension("x.ai/task/kill", { taskId, source }));
    if (response.success === false) throw new Error(String(response.error ?? "后台任务停止失败"));
  }
  async subagentCancel(subagentId: string): Promise<void> {
    const response = unwrapExtResult(await this.extension("x.ai/subagent/cancel", { subagentId }));
    if (response.cancelled === false && !response.outcome) throw new Error("子 Agent 已结束或不存在");
  }

  cancel(): void {
    if (!this.sessionId) return;
    this.cancelRequested = true;
    for (const key of this.pendingPermissionRequests) {
      const requestId = this.pendingInteractionRequestIds.get(key) ?? key;
      this.write({ jsonrpc: "2.0", id: requestId, result: { outcome: { outcome: "cancelled" } } });
      this.emitEvent({ type: "interaction-resolved", sessionId: this.sessionId, interaction: "permission", requestId, outcome: "cancelled" });
    }
    for (const key of this.pendingQuestionRequests) {
      const requestId = this.pendingInteractionRequestIds.get(key) ?? key;
      this.write({ jsonrpc: "2.0", id: requestId, result: { outcome: "cancelled" } });
      this.emitEvent({ type: "interaction-resolved", sessionId: this.sessionId, interaction: "question", requestId, outcome: "cancelled" });
    }
    if (this.pendingPlanRequest !== undefined) {
      const requestId = this.pendingPlanRequest;
      this.write({ jsonrpc: "2.0", id: requestId, result: { outcome: "abandoned" } });
      this.emitEvent({ type: "interaction-resolved", sessionId: this.sessionId, interaction: "plan", requestId, outcome: "cancelled" });
    }
    this.pendingPermissionRequests.clear();
    this.pendingQuestionRequests.clear();
    this.pendingInteractionRequestIds.clear();
    this.pendingPlanRequest = undefined;
    this.write({ jsonrpc: "2.0", method: acpMethods.agent.session.cancel, params: { sessionId: this.sessionId } });
    this.needsUser = false;
    this.emitStatus("working", "正在停止…");
  }

  async setModel(modelId: string, identity: { localModelId?: string; persistRuntime?: boolean } = {}): Promise<void> {
    const previousRequestedModelId = this.requestedModelId;
    const previousLocalModelId = this.providerLocalModelId;
    const previousCurrentModelId = this.currentModelId;
    const previousUpstreamModelId = this.upstreamModelId;
    this.requestedModelId = modelId;
    this.providerLocalModelId = identity.localModelId;
    const previousSuspendModelRuntimePersistence = this.suspendModelRuntimePersistence;
    this.suspendModelRuntimePersistence = identity.persistRuntime === false;
    try {
      const result = await this.request("session/set_model", { sessionId: this.sessionId, modelId }) as { _meta?: { model?: { Ok?: string } } };
      this.upstreamModelId = result._meta?.model?.Ok || modelId;
      this.currentModelId = this.providerLocalModelId ?? resolveModelId(this.upstreamModelId, this.models, this.requestedModelId) ?? modelId;
      if (identity.persistRuntime !== false) this.persistRuntimePatch({ modelId: this.currentModelId });
      this.emitEvent({ type: "session-ready", sessionId: this.sessionId, models: this.models, currentModelId: this.currentModelId, effort: this.effort });
    } catch (error) {
      this.requestedModelId = previousRequestedModelId;
      this.providerLocalModelId = previousLocalModelId;
      this.currentModelId = previousCurrentModelId;
      this.upstreamModelId = previousUpstreamModelId;
      throw error;
    } finally {
      this.suspendModelRuntimePersistence = previousSuspendModelRuntimePersistence;
    }
  }

  /**
   * Grok CLI 0.2.101 exposes reasoning effort as a private extension on the
   * otherwise standard session/set_model request. The response only confirms
   * the model, so wait for model_changed before reporting success.
   */
  async setEffort(effort: Exclude<ReasoningEffort, "">): Promise<void> {
    if (!this.sessionId || !this.currentModelId) throw new LiveEffortUnsupportedError("当前会话没有可用于热切换的模型");
    if (this.pendingEffortChange) throw new Error("另一项推理强度切换仍在进行");
    if (effort === this.currentEffort) return;

    const confirmation = this.waitForEffortChange(effort);
    try {
      await this.request("session/set_model", {
        sessionId: this.sessionId,
        modelId: this.currentModelId,
        _meta: { reasoningEffort: effort },
      });
    } catch (error) {
      this.finishEffortChange(false);
      await confirmation;
      throw error;
    }
    if (!await confirmation) {
      throw new LiveEffortUnsupportedError("CLI 未确认推理强度热切换");
    }
  }

  async applyMode(mode: SessionMode, persist = true): Promise<void> {
    if (this.sessionId) await this.request(acpMethods.agent.session.setMode, { sessionId: this.sessionId, modeId: mode === "plan" ? "plan" : "default" });
    this.mode = mode;
    this.autoApprove = mode === "auto";
    this.planActive = mode === "plan";
    if (mode === "plan") this.planGateReleased = false;
    this.persistRuntimePatch({ mode });
    if (persist) this.emitEvent({ type: "mode", sessionId: this.sessionId, mode });
  }

  respondPermission(requestId: JsonRpcId, optionId: string): void {
    const key = String(requestId);
    if (!this.pendingPermissionRequests.has(key)) throw new Error("权限请求已经结束或已被响应");
    if (!this.write({ jsonrpc: "2.0", id: requestId, result: { outcome: { outcome: "selected", optionId } } })) {
      throw new Error("Grok 进程不可用，权限决定未提交");
    }
    this.pendingPermissionRequests.delete(key);
    this.pendingInteractionRequestIds.delete(key);
    this.refreshNeedsUser();
    this.emitEvent({ type: "interaction-resolved", sessionId: this.sessionId, interaction: "permission", requestId, outcome: optionId });
    this.emitStatus(this.needsUser ? "needs-user" : this.working ? "working" : "idle");
  }

  private cancelPermission(requestId: JsonRpcId): void {
    const key = String(requestId);
    if (!this.pendingPermissionRequests.has(key)) return;
    if (!this.write({ jsonrpc: "2.0", id: requestId, result: { outcome: { outcome: "cancelled" } } })) {
      throw new Error("Grok 进程不可用，权限取消决定未提交");
    }
    this.pendingPermissionRequests.delete(key);
    this.pendingInteractionRequestIds.delete(key);
    this.refreshNeedsUser();
    this.emitEvent({ type: "interaction-resolved", sessionId: this.sessionId, interaction: "permission", requestId, outcome: "cancelled" });
    this.emitStatus(this.needsUser ? "needs-user" : this.working ? "working" : "idle");
  }

  respondQuestion(requestId: JsonRpcId, answers: Record<string, string>): void {
    const key = String(requestId);
    if (!this.pendingQuestionRequests.has(key)) throw new Error("问题请求已经结束或已被回答");
    if (!this.write({ jsonrpc: "2.0", id: requestId, result: { outcome: "accepted", answers, annotations: {} } })) {
      throw new Error("Grok 进程不可用，回答未提交");
    }
    this.pendingQuestionRequests.delete(key);
    this.pendingInteractionRequestIds.delete(key);
    this.refreshNeedsUser();
    this.emitEvent({ type: "interaction-resolved", sessionId: this.sessionId, interaction: "question", requestId, outcome: "answered" });
    this.emitStatus(this.needsUser ? "needs-user" : this.working ? "working" : "idle");
  }

  async respondPlan(requestId: JsonRpcId | undefined, verdict: "approved" | "rejected" | "cancelled", comment = ""): Promise<PlanDecisionReceipt> {
    const requestedId = requestId ?? this.pendingPlanRequest;
    if (requestedId !== undefined) {
      const duplicateKey = `${this.sessionId || "pending"}:${String(requestedId)}`;
      const duplicate = this.resolvedPlanRequests.get(duplicateKey);
      if (duplicate) return { ...duplicate, state: "duplicate", message: "该计划决策已经提交，未重复执行" };
    }
    const id = this.pendingPlanRequest;
    if (id === undefined || (requestId !== undefined && String(requestId) !== String(id))) {
      throw new Error("计划请求已经结束或没有可响应的请求 ID");
    }
    const key = `${this.sessionId || "pending"}:${String(id)}`;
    const duplicate = this.resolvedPlanRequests.get(key);
    if (duplicate) return { ...duplicate, state: "duplicate", message: "该计划决策已经提交，未重复执行" };
    const normalizedComment = comment.trim().slice(0, 8_000);
    const receipt: PlanDecisionReceipt = {
      requestId: key,
      verdict,
      state: "accepted",
      message: verdict === "approved" ? "计划已批准，原回合将继续执行" : verdict === "rejected" ? "已要求继续规划" : "计划已取消",
    };
    this.resolvedPlanRequests.set(key, receipt);
    while (this.resolvedPlanRequests.size > 128) {
      const oldest = this.resolvedPlanRequests.keys().next().value;
      if (oldest === undefined) break;
      this.resolvedPlanRequests.delete(oldest);
    }
    // x.ai/exit_plan_mode is an ext_method, not an ACP permission request.
    // Grok Build expects all three user choices as successful JSON-RPC
    // results: approved=implement, cancelled=continue planning, and
    // abandoned=leave Plan without implementation. Sending an RPC error for
    // the latter choices cancels the tool loop and can strand the turn.
    const outcome = verdict === "approved" ? "approved" : verdict === "rejected" ? "cancelled" : "abandoned";
    if (!this.write({
      jsonrpc: "2.0",
      id,
      result: {
        outcome,
        ...(verdict === "rejected" && normalizedComment ? { feedback: normalizedComment } : {}),
      },
    })) {
      this.resolvedPlanRequests.delete(key);
      throw new Error("Grok 进程不可用，计划决策未提交");
    }
    this.pendingPlanRequest = undefined;
    if (verdict === "approved" || verdict === "cancelled") {
      // The exit-plan response is already on the wire. Release the old Plan
      // enforcement boundary immediately; session/set_mode is only a later
      // reconciliation and must not keep rejecting implementation tools.
      this.planGateReleased = true;
      this.planActive = false;
      this.mode = "agent";
      this.autoApprove = false;
      // Persist the local safety boundary before the optional CLI
      // reconciliation. If the process exits while set_mode is unavailable,
      // reopening the task must not resurrect the already-resolved Plan gate.
      this.persistRuntimePatch({ mode: "agent" });
      this.emitEvent({ type: "mode", sessionId: this.sessionId, mode: "agent" });
    }
    this.refreshNeedsUser();
    this.emitEvent({ type: "interaction-resolved", sessionId: this.sessionId, interaction: "plan", requestId: id, outcome: verdict });
    this.emitStatus(this.working ? "working" : "idle", receipt.message);
    // The decision is already durably written to the CLI. Mode reconciliation
    // is a separate best-effort phase: waiting for session/set_mode here can
    // keep the Renderer IPC pending while Grok resumes the tool loop.
    if (verdict === "approved" || verdict === "cancelled") {
      void this.applyMode("agent", false).then(() => {
        this.emitStatus(this.working ? "working" : "idle", "已退出 Plan 模式");
      }).catch((error) => {
        const message = `计划决定已提交，但模式恢复失败：${error instanceof Error ? error.message : String(error)}`;
        const failure = this.buildFailure(message, { error });
        failure.nextActions = ["计划决定已生效，旧 Plan 权限门控不会重新启用", "可从模式菜单手动切换到 Agent 后继续"];
        this.emitEvent({ type: "error", sessionId: this.sessionId, message, failure });
        this.emitStatus(this.working ? "working" : "error", "计划决定已提交；模式恢复失败");
      });
    }
    return receipt;
  }

  /**
   * Turns whatever signals this adapter has into a structured failure. The
   * main process enriches it further (provider, gateway trace) before it
   * reaches the renderer.
   */
  private buildFailure(message: string, context: { error?: unknown; processExitCode?: number; cancelled?: boolean } = {}): TurnFailure {
    const raw = context.error as { code?: number; data?: unknown } | undefined;
    const jsonRpcCode = typeof raw?.code === "number" ? raw.code : undefined;
    const httpStatus = httpStatusFromFailure(message, raw?.data);
    const cancelled = context.cancelled ?? this.cancelRequested;
    return {
      failureId: crypto.randomUUID(),
      at: new Date().toISOString(),
      classification: classifyTurnFailure({ message, httpStatus, jsonRpcCode, processExitCode: context.processExitCode, cancelled }),
      message,
      sessionId: this.sessionId || undefined,
      turnId: this.activeTurn?.turnId,
      modelId: this.currentModelId || undefined,
      ...(jsonRpcCode === undefined ? {} : { jsonRpcCode }),
      ...(httpStatus === undefined ? {} : { httpStatus }),
      ...(context.processExitCode === undefined ? {} : { processExitCode: context.processExitCode }),
      ...(cancelled ? { cancelled: true } : {}),
      ...(this.options.providerScopeId ? { gatewayScopeId: this.options.providerScopeId } : {}),
    };
  }

  /** `closed` releases the Computer Use lease, so it must fire exactly once on every exit path. */
  private emitClosed(): void {
    if (this.closedEmitted) return;
    this.closedEmitted = true;
    this.emit("closed");
  }

  async dispose(timeoutMs = 5_000): Promise<void> {
    this.disposed = true;
    this.clearFirstEventWatchdog();
    if (this.restoredQueueTimer) clearTimeout(this.restoredQueueTimer);
    this.restoredQueueTimer = undefined;
    // Defensive for adapters whose process never reached normal field
    // initialization (including failed construction/recovery fixtures).
    if (this.pendingQueueOperations) {
      for (const pending of this.pendingQueueOperations.values()) clearTimeout(pending.timer);
      this.pendingQueueOperations.clear();
    }
    this.finishEffortChange(false);
    await this.terminal.disposeAll();
    const child = this.process;
    if (child && child.exitCode === null && this.sessionId && this.runtimeHandshake?.sessionCapabilities?.close) {
      // Standard ACP close is a resource release, not permanent session
      // deletion. It also cancels a live turn before the child is terminated.
      // Best effort is intentional: a dead or wedged CLI must never prevent
      // Desktop shutdown.
      try {
        const result = await this.request(acpMethods.agent.session.close, { sessionId: this.sessionId }, Math.min(5_000, timeoutMs));
        this.lastCloseReceipt = normalizeSessionCloseReceipt(this.sessionId, result);
        this.emitRuntimeUpdate("session", "session/close", this.lastCloseReceipt.message ?? this.lastCloseReceipt.rawOutcome, {
          outcome: this.lastCloseReceipt.outcome,
          completed: this.lastCloseReceipt.completed,
          ...(this.lastCloseReceipt.rawOutcome ? { rawOutcome: this.lastCloseReceipt.rawOutcome } : {}),
        });
      } catch (error) {
        this.lastCloseReceipt = {
          sessionId: this.sessionId,
          outcome: "released-without-close",
          completed: false,
          at: new Date().toISOString(),
          message: error instanceof Error ? error.message : String(error),
        };
        await this.options.log.log(`session/close 未完成，继续释放 CLI 进程：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.lines?.close();
    // Emit before the early return: a process that never spawned, or already
    // exited, still owns a lease that nothing else will ever release.
    if (!child || child.exitCode !== null) { this.emitClosed(); return; }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
      if (process.platform === "win32" && child.pid) execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], () => undefined);
      else child.kill("SIGTERM");
    });
    // Covers the timeout branch above, where the kill never produced an exit.
    this.emitClosed();
  }

  private async onLine(line: string): Promise<void> {
    if (!line.trim()) return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      await this.options.log.log(`[grok non-json] ${line.slice(0, 500)}`);
      return;
    }
    const id = message.id as JsonRpcId | undefined;
    if (id !== undefined && !message.method) {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (pending.timer) clearTimeout(pending.timer);
      if (message.error) {
        const errorObject = message.error as { code?: number; message?: string; data?: unknown };
        // `code` used to be dropped here, leaving the renderer with a bare
        // string and no way to tell one failure class from another. Grok Build
        // 1.0 also uses the generic JSON-RPC text "Internal error" while the
        // actionable upstream HTTP message lives in `error.data`; prefer that
        // bounded detail without discarding the original code/data payload.
        const error = Object.assign(new Error(jsonRpcErrorMessage(errorObject)), { code: errorObject.code, data: errorObject.data, rpcMessage: errorObject.message });
        pending.reject(error);
      } else pending.resolve(message.result);
      return;
    }
    const envelope = normalizeRuntimeEventEnvelope(
      String(message.method || ""),
      (message.params || {}) as Record<string, unknown>,
      this.sessionId || undefined,
    );
    const method = envelope.method;
    const params = envelope.payload as Record<string, any>;
    if (method.startsWith("x.ai/")) this.observeRuntimeExtension(method);
    if (method === acpMethods.client.session.update) {
      // ACP metadata belongs to the SessionNotification envelope, not the
      // nested SessionUpdate. Preserve it for 1.x SessionInfoUpdate title
      // ownership; otherwise a reset-to-auto notification cannot clear a
      // Desktop manual title.
      this.handleSessionUpdate({ ...(params.update ?? {}), ...(params._meta ? { _meta: params._meta } : {}) });
      return;
    }
    await this.handleServerRequest(method, id, params);
  }

  private handleSessionUpdate(update: any): void {
    if (!update) return;
    this.lastTouched = Date.now();
    if (["agent_message_chunk", "agent_thought_chunk", "tool_call", "tool_call_update", "plan"].includes(String(update.sessionUpdate))) {
      this.markFirstTurnEvent();
    }
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        if (update.content?.type === "text") this.emitProviderText(update.content.text || "");
        else this.emitMediaFromContent(update.content);
        break;
      }
      case "user_message_chunk": {
        const content = update.content ?? {};
        const attachments = acpAttachmentPreviews(content);
        const text = typeof content.text === "string" ? content.text : "";
        const clientMessageId = firstNonEmptyString(update.clientMessageId, update.client_message_id, update.messageId, update.message_id, update.promptId, update.prompt_id);
        this.emitEvent({
          type: "user-message",
          sessionId: this.sessionId,
          text,
          ...(clientMessageId ? { id: clientMessageId, clientMessageId } : {}),
          ...(attachments.length ? { attachments } : {}),
          delivery: "sent",
        });
        break;
      }
      case "agent_thought_chunk":
        this.emitEvent({ type: "thought-chunk", sessionId: this.sessionId, text: update.content?.text || "" });
        break;
      case "tool_call":
      case "tool_call_update":
        this.handleToolCall(update);
        break;
      case "plan":
        this.emitEvent({ type: "plan", sessionId: this.sessionId, text: update.content?.text || update.plan || "" });
        break;
      case "current_mode_update": {
        const reportedMode = update.currentModeId === "plan" ? "plan" : this.autoApprove ? "auto" : "agent";
        // A late replay from the just-resolved Plan request is not a new user
        // decision. Keep the local mode/gate released until a genuinely new
        // exit_plan request re-arms it.
        const mode = reportedMode === "plan" && this.planGateReleased ? "agent" : reportedMode;
        this.mode = mode;
        this.planActive = mode === "plan" && !this.planGateReleased;
        this.emitEvent({ type: "mode", sessionId: this.sessionId, mode });
        break;
      }
      case "available_commands_update":
        this.commands = (update.availableCommands ?? []).map((command: any) => ({ name: command.name, description: command.description, inputHint: command.input?.hint }));
        this.registeredTools = normalizeRegisteredToolNames(update._meta?.tools ?? update.meta?.tools);
        if (this.runtimeHandshake) {
          this.runtimeHandshake.commands = this.commands.map((command) => command.name);
          const commandNames = new Set(this.runtimeHandshake.commands.map((command) => command.replace(/^\//, "").toLowerCase()));
          if (commandNames.has("btw")) this.observeRuntimeExtension("x.ai/btw");
          if (commandNames.has("recap")) this.observeRuntimeExtension("x.ai/recap");
        }
        if (this.sessionId) this.emitEvent({ type: "commands", sessionId: this.sessionId, commands: this.commands });
        this.emit("commands-changed");
        break;
      case "session_info_update": {
        const meta = recordValue(update._meta);
        const titleIsManual = meta?.["x.ai/titleIsManual"];
        if (typeof titleIsManual !== "boolean") break;
        const nested = recordValue(update.sessionInfoUpdate ?? update.session_info_update);
        const title = firstNonEmptyString(update.title, nested?.title) ?? "";
        this.emitEvent({ type: "session-title", sessionId: this.sessionId, title, manual: titleIsManual });
        break;
      }
      default:
        break;
    }
  }

  private handleToolCall(update: any): void {
    const toolCallId = String(update.toolCallId || update.id || crypto.randomUUID());
    const status = normalizeToolStatus(update.status);
    const diff = extractAcpToolDiff(update);
    const locations = Array.isArray(update.locations) && update.locations.length
      ? update.locations
      : diff.path ? [{ path: diff.path }] : update.locations;
    const tool: ToolCallState = {
      toolCallId,
      title: update.title || update.rawInput?.name || "工具调用",
      ...(update.kind !== undefined ? { kind: update.kind } : {}),
      ...(normalizeToolReadOnly(update) !== undefined ? { readOnly: normalizeToolReadOnly(update) } : {}),
      status,
      ...(update.rawInput !== undefined ? { rawInput: update.rawInput } : {}),
      ...(update.content !== undefined ? { content: update.content } : {}),
      ...(locations !== undefined ? { locations } : {}),
      ...(diff.oldText !== undefined ? { oldText: diff.oldText } : {}),
      ...(diff.newText !== undefined ? { newText: diff.newText } : {}),
      ...(diff.additions !== undefined ? { additions: diff.additions } : {}),
      ...(diff.deletions !== undefined ? { deletions: diff.deletions } : {}),
      ...((update.error?.message || update.error) ? { error: update.error?.message || update.error } : {}),
    };
    if (isMediaTool(update)) this.mediaToolIds.add(toolCallId);
    if (this.mediaToolIds.has(toolCallId)) this.emitGeneratedMedia(update);
    for (const item of update.content ?? []) this.emitMediaFromContent(item?.type === "content" ? item.content : item);
    this.emitEvent({ type: "tool-call", sessionId: this.sessionId, tool });
  }

  private handleModelChanged(update: Record<string, any>): void {
    if (update.sessionUpdate !== "model_changed") return;
    const modelId = typeof update.model_id === "string" ? update.model_id : undefined;
    if (modelId) {
      const resolved = resolveModelId(modelId, this.models, this.requestedModelId) || modelId;
      this.upstreamModelId = modelId;
      if (this.providerLocalModelId) {
        // A managed gateway can report its upstream alias (for example
        // grok-4.5). Keep the provider-scoped local id as Desktop identity.
        this.currentModelId = this.providerLocalModelId;
      } else {
        this.currentModelId = resolved;
        if (!modelIdsAlias(modelId, this.requestedModelId)) this.requestedModelId = resolved;
      }
    }
    const effort = normalizeReasoningEffort(update.reasoning_effort);
    if (effort !== undefined) this.currentEffort = effort;
    this.persistRuntimePatch({ ...(!this.suspendModelRuntimePersistence && this.currentModelId ? { modelId: this.currentModelId } : {}), ...(effort ? { effort } : {}) });
    this.emitEvent({
      type: "session-ready",
      sessionId: this.sessionId,
      models: this.models,
      currentModelId: this.currentModelId,
      effort: this.currentEffort,
    });
    if (effort && this.pendingEffortChange?.effort === effort) this.finishEffortChange(true);
  }

  private handlePrivateSessionUpdate(update: Record<string, any>): void {
    const updateType = normalizePrivateUpdateName(String(update.sessionUpdate || ""));
    if (updateType) this.markFirstTurnEvent();
    switch (updateType) {
      case "model_changed":
        this.handleModelChanged(update);
        return;
      case "subagent_spawned":
      case "subagent_progress":
      case "subagent_finished":
        this.emitEvent({ type: "subagent", sessionId: this.sessionId, update });
        this.emitRuntimeUpdate("subagent", updateType, firstNonEmptyString(update.description, update.message, update.status));
        return;
      case "turn_completed":
        {
        const terminalOutcome = normalizeTerminalTurnOutcome(update);
        const terminalTurnId = this.resolveTerminalTurnId(update);
        if (!terminalTurnId) {
          void this.options.log.log("ignored uncorrelated turn_completed update");
          return;
        }
        const completingActiveTurn = this.activeTurn?.turnId === terminalTurnId;
        const completingQueuedPromptId = completingActiveTurn ? this.activeQueuedPromptId : undefined;
        let terminalMeta: PromptMeta | undefined;
        if (update.usage) {
          terminalMeta = extractUsageMeta(update.usage);
          this.emitEvent({ type: "meta", sessionId: this.sessionId, meta: terminalMeta });
        }
        const usage = terminalMeta
          ? { ...terminalMeta, modelId: terminalMeta.modelId ?? this.currentModelId, source: "acp-turn" as const, exact: true as const }
          : undefined;
        if (completingActiveTurn) this.finishTurn(terminalOutcome, usage, terminalTurnId);
        else if (!this.correctSettledTurn(terminalTurnId, terminalOutcome, usage)) {
          void this.options.log.log(`ignored stale turn_completed update for ${terminalTurnId}`);
          return;
        }
        // Grok CLI can publish the authoritative turn terminal event without
        // ever completing the original session/prompt JSON-RPC request. Treat
        // that event as the request completion for the same turn; otherwise a
        // fully rendered final answer leaves Desktop permanently "working".
        this.settlePromptRequestFromTerminal(terminalTurnId, terminalOutcome, terminalMeta, completingQueuedPromptId);
        if (completingQueuedPromptId) {
          this.persistActiveQueueTerminal(terminalOutcome);
        }
        if (completingActiveTurn) this.activatePendingQueuedTurn();
        this.working = Boolean(this.activeTurn);
        if (completingActiveTurn) this.needsUser = false;
        this.flushPendingRecapsIfIdle();
        this.emitStatus(
          this.activeTurn ? "working" : terminalOutcome === "failed" ? "error" : "idle",
          this.activeTurn ? "正在处理已提交的跟进消息…" : terminalOutcome === "cancelled" ? "已取消" : terminalOutcome === "failed" ? "执行失败" : "已完成",
        );
        return;
        }
      case "retry_state": {
        const attempt = optionalPositiveInteger(update.attempt ?? update.retry_attempt ?? update.retryAttempt);
        const maxAttempts = optionalPositiveInteger(update.max_attempts ?? update.maxAttempts);
        const delayMs = optionalNonNegativeNumber(update.delay_ms ?? update.delayMs ?? update.retry_after_ms);
        const reason = firstNonEmptyString(update.reason, update.message, update.error);
        this.emitEvent({ type: "turn-retry", sessionId: this.sessionId, attempt, maxAttempts, delayMs, reason });
        this.emitStatus("working", formatRetryStatus(attempt, maxAttempts, delayMs, reason));
        return;
      }
      case "task_backgrounded":
        this.handleTaskBackgrounded(update);
        return;
      case "task_completed":
        this.handleTaskCompleted(update);
        return;
      case "auto_compact_started":
      case "auto_compact_completed":
      case "auto_compact_failed":
      case "auto_compact_cancelled": {
        const status = updateType.slice("auto_compact_".length) as "started" | "completed" | "failed" | "cancelled";
        this.emitEvent({
          type: "compact-status",
          sessionId: this.sessionId,
          status,
          trigger: "automatic",
          beforeTokens: optionalNonNegativeInteger(update.beforeTokens ?? update.before_tokens ?? update.tokensBefore ?? update.tokens_before),
          afterTokens: optionalNonNegativeInteger(update.afterTokens ?? update.after_tokens ?? update.tokensAfter ?? update.tokens_after),
          message: firstNonEmptyString(update.message, update.error, update.reason),
        });
        this.emitRuntimeUpdate("session", updateType, firstNonEmptyString(update.message, update.error, update.reason));
        return;
      }
      case "session_summary_generated": {
        const title = firstNonEmptyString(update.session_summary, update.sessionSummary, update.summary, update.title, update.text) ?? "";
        const meta = recordValue(update._meta);
        const titleIsManual = meta?.["x.ai/titleIsManual"];
        // Absent meta is an automatic summary/title and must not clobber a
        // Desktop/local manual rename. New shells explicitly send true/false
        // for manual rename and reset-to-auto.
        if (typeof titleIsManual === "boolean") {
          this.emitEvent({ type: "session-title", sessionId: this.sessionId, title, manual: titleIsManual });
        }
        return;
      }
      case "session_recap":
      case "session_summary": {
        const text = firstNonEmptyString(update.recap, update.summary, update.content?.text, update.text);
        if (!text) return;
        const turnId = firstNonEmptyString(update.turn_id, update.turnId);
        const contentHash = createHash("sha256").update(`${this.sessionId}\u0000${turnId ?? ""}\u0000${text}`).digest("hex");
        if (this.recapHashes.has(contentHash)) return;
        this.recapHashes.add(contentHash);
        if (this.recapHashes.size > 256) this.recapHashes.delete(this.recapHashes.values().next().value!);
        const recap = { ...(turnId ? { turnId } : {}), text, contentHash };
        if (this.activeTurn || this.working) {
          this.pendingRecaps.set(contentHash, recap);
          while (this.pendingRecaps.size > 64) this.pendingRecaps.delete(this.pendingRecaps.keys().next().value!);
        } else {
          this.emitEvent({ type: "session-recap", sessionId: this.sessionId, ...recap });
        }
        return;
      }
      case "goal_updated":
        this.emitRuntimeUpdate("goal", updateType, firstNonEmptyString(update.title, update.summary, update.status));
        return;
      case "workflow_updated":
        this.emitRuntimeUpdate("workflow", updateType, firstNonEmptyString(update.title, update.summary, update.status));
        return;
      case "model_auto_switched":
        this.handleModelChanged({ ...update, sessionUpdate: "model_changed", model_id: update.model_id ?? update.modelId ?? update.to_model_id });
        this.emitRuntimeUpdate("model", updateType, firstNonEmptyString(update.reason, update.model_id, update.modelId));
        return;
      case "interaction_resolved":
        this.emitRuntimeUpdate("session", updateType, firstNonEmptyString(update.outcome, update.status));
        return;
      default:
        // Unknown lifecycle updates are acknowledged by the caller but must
        // never be presented as subagents or logged with their potentially
        // sensitive payload. Preserve only the wire shape needed to diagnose
        // a forward-compatibility gap.
        void this.options.log.log(`[ACP unknown update] name=${updateType || "unknown"} schema=${wireSchemaVersion(update)} size=${wireSize(update)}`);
        return;
    }
  }

  private handleTaskBackgrounded(update: Record<string, any>): void {
    const taskId = String(update.task_id || "");
    if (!taskId) return;
    const completed = this.completedBackgroundTasks.get(taskId);
    if (completed) {
      this.completedBackgroundTasks.delete(taskId);
      return;
    }
    const toolCallId = String(update.tool_call_id || `background-task-${taskId}`);
    const command = typeof update.command === "string" ? update.command : undefined;
    const task: BackgroundTask = {
      toolCallId,
      title: String(update.description || command || "后台任务"),
      command,
    };
    this.backgroundTasks.set(taskId, task);
    this.emitEvent({
      type: "tool-call",
      sessionId: this.sessionId,
      tool: {
        toolCallId,
        title: task.title,
        kind: "background-task",
        status: "in_progress",
        command,
        rawInput: { taskId, cwd: update.cwd, outputFile: update.output_file },
      },
    });
  }

  private handleTaskCompleted(update: Record<string, any>): void {
    const snapshot = (update.task_snapshot ?? update) as Record<string, any>;
    const taskId = String(snapshot.task_id || update.task_id || "");
    if (!taskId) return;
    const known = this.backgroundTasks.get(taskId);
    if (!known) {
      this.completedBackgroundTasks.set(taskId, { update, at: Date.now() });
      while (this.completedBackgroundTasks.size > 128) this.completedBackgroundTasks.delete(this.completedBackgroundTasks.keys().next().value!);
    }
    const toolCallId = known?.toolCallId || String(update.tool_call_id || `background-task-${taskId}`);
    const exitCode = typeof snapshot.exit_code === "number" ? snapshot.exit_code : null;
    const signal = snapshot.signal == null ? "" : String(snapshot.signal);
    const failed = exitCode !== null ? exitCode !== 0 : Boolean(signal || snapshot.explicitly_killed);
    const command = typeof snapshot.command === "string" ? snapshot.command : known?.command;
    this.emitEvent({
      type: "tool-call",
      sessionId: this.sessionId,
      tool: {
        toolCallId,
        title: known?.title || String(snapshot.description || command || "后台任务"),
        kind: "background-task",
        status: failed ? "failed" : "completed",
        command,
        output: typeof snapshot.output === "string" ? snapshot.output : undefined,
        truncated: Boolean(snapshot.truncated),
        exitCode,
        error: failed ? signal || (exitCode === null ? "后台任务失败" : `退出代码 ${exitCode}`) : undefined,
        rawInput: { taskId, cwd: snapshot.cwd, outputFile: snapshot.output_file },
      },
    });
    this.backgroundTasks.delete(taskId);
  }

  private emitRuntimeUpdate(
    kind: import("../../shared/types").CliRuntimeUpdate["kind"],
    name: string,
    summary?: string,
    data?: Record<string, unknown>,
    targetSessionId = this.sessionId,
  ): void {
    this.emitEvent({
      type: "runtime-update",
      sessionId: targetSessionId,
      update: { kind, name, at: new Date().toISOString(), ...(summary ? { summary } : {}), ...(data ? { data } : {}) },
    });
  }

  /** Auto recap is presentation-only metadata. Buffer it until the session is
   * genuinely idle so an early recap cannot appear between streaming chunks or
   * ahead of an already accepted queued turn. */
  private flushPendingRecapsIfIdle(): void {
    const pending = this.pendingRecaps;
    if (this.activeTurn || this.working || !pending?.size) return;
    for (const recap of pending.values()) {
      this.emitEvent({ type: "session-recap", sessionId: this.sessionId, ...recap });
    }
    pending.clear();
  }

  private observeRuntimeExtension(method: string): void {
    if (!this.runtimeHandshake || !method.startsWith("x.ai/")) return;
    if (!this.runtimeHandshake.extensions.includes(method)) {
      this.runtimeHandshake.extensions = [...this.runtimeHandshake.extensions, method].sort();
    }
  }

  private runtimeSupportsExtension(method: string): boolean {
    if (!this.runtimeHandshake) return false;
    if (this.runtimeHandshake.extensions.includes(method)) return true;
    // Some 0.2.x builds expose private extensions as boolean capability keys
    // rather than the flat extension list.  Treat only an explicit true as
    // support; version numbers and command names alone are not enough here.
    return this.runtimeHandshake.sessionCapabilities?.[method] === true
      || this.runtimeHandshake.promptCapabilities?.[method] === true;
  }

  private applyModelStateUpdate(state: Record<string, unknown>): void {
    const available = arrayValue(state.availableModels) ?? arrayValue(state.available_models) ?? [];
    const models = available.flatMap((item): ModelInfo[] => {
      const row = recordValue(item);
      const modelId = firstNonEmptyString(row?.modelId, row?.model_id, row?.id);
      if (!row || !modelId) return [];
      const meta = recordValue(row._meta) ?? {};
      const reasoningEfforts = (arrayValue(meta.reasoningEfforts) ?? arrayValue(row.reasoningEfforts) ?? []).flatMap((candidate) => {
        const candidateRow = recordValue(candidate);
        const value = normalizeReasoningEffort(candidateRow?.value ?? candidate);
        if (!value) return [];
        return [{ value, label: firstNonEmptyString(candidateRow?.label) ?? value }];
      });
      return [{
        modelId,
        name: firstNonEmptyString(row.name, row.label) ?? modelId,
        description: firstNonEmptyString(row.description),
        totalContextTokens: optionalPositiveInteger(meta.totalContextTokens ?? row.totalContextTokens),
        ...normalizeImageInputCapability(meta, row),
        supportsReasoningEffort: meta.supportsReasoningEffort === true && reasoningEfforts.length > 0,
        reasoningEfforts,
      }];
    });
    if (models.length) this.models = models;
    const reportedModelId = firstNonEmptyString(state.currentModelId, state.current_model_id);
    if (reportedModelId) {
      this.upstreamModelId = reportedModelId;
      this.currentModelId = this.providerLocalModelId ?? resolveModelId(reportedModelId, this.models, this.requestedModelId) ?? reportedModelId;
    }
    if (this.runtimeHandshake) {
      this.runtimeHandshake.currentModelId = reportedModelId ?? this.runtimeHandshake.currentModelId;
      this.runtimeHandshake.models = this.models.map((model) => ({
        modelId: model.modelId,
        name: model.name,
        ...(model.reasoningEfforts?.length ? { reasoningEfforts: model.reasoningEfforts.map((entry) => entry.value) } : {}),
        ...(model.acceptsImages !== undefined ? { acceptsImages: model.acceptsImages } : {}),
        ...(model.inputModalities?.length ? { inputModalities: model.inputModalities } : {}),
      }));
    }
    if (this.sessionId) this.emitEvent({
      type: "session-ready",
      sessionId: this.sessionId,
      models: this.models,
      currentModelId: this.currentModelId,
      effort: this.currentEffort,
    });
  }

  private waitForEffortChange(effort: Exclude<ReasoningEffort, "">): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingEffortChange?.effort === effort) this.pendingEffortChange = undefined;
        resolve(false);
      }, 3_000);
      this.pendingEffortChange = { effort, timer, finish: resolve };
    });
  }

  private finishEffortChange(confirmed: boolean): void {
    const pending = this.pendingEffortChange;
    if (!pending) return;
    this.pendingEffortChange = undefined;
    clearTimeout(pending.timer);
    pending.finish(confirmed);
  }

  private async handleServerRequest(method: string, id: JsonRpcId | undefined, params: Record<string, any>): Promise<void> {
    try {
      if (method.startsWith("x.ai/") || method.startsWith("_x.ai/")) this.observeRuntimeExtension(method.replace(/^_/, ""));
      switch (method) {
        case acpMethods.client.fs.readTextFile: {
          const requestedPath = String(params.path ?? "");
          const planFilePath = this.sessionId
            ? await resolveSessionPlanFile(this.options.cwd, this.sessionId, this.options.env.GROK_HOME)
            : undefined;
          const resolvedPath = isCurrentSessionPlanFile(requestedPath, planFilePath)
            ? requestedPath
            : (await resolveExistingWorkspacePath(this.options.cwd, requestedPath, false)).path;
          await rejectSymbolicLink(resolvedPath);
          const content = await readFile(resolvedPath, "utf8");
          this.respondOk(id, { content });
          return;
        }
        case acpMethods.client.fs.writeTextFile: {
          const requestedPath = String(params.path ?? "");
          const planFilePath = this.sessionId
            ? await resolveSessionPlanFile(this.options.cwd, this.sessionId, this.options.env.GROK_HOME)
            : undefined;
          const isCurrentPlanFile = isCurrentSessionPlanFile(requestedPath, planFilePath);
          let resolvedPath: string;
          if (isCurrentPlanFile) {
            resolvedPath = requestedPath;
            if ((await lstat(resolvedPath).catch(() => undefined))?.isSymbolicLink()) {
              this.respondError(id, -32010, "拒绝写入符号链接计划文件");
              return;
            }
            this.emitEvent({ type: "plan", sessionId: this.sessionId, text: params.content || "" });
            await mkdir(dirname(resolvedPath), { recursive: true });
          } else {
            resolvedPath = await resolveAcpWorkspaceWritePath(this.options.cwd, requestedPath);
          }
          await writeFile(resolvedPath, params.content ?? "", "utf8");
          this.respondOk(id);
          return;
        }
        case acpMethods.client.terminal.create: {
          if (shouldBlockCommand(params.command, this.planActive)) {
            this.respondError(id, -32011, "Plan 模式已阻止修改性命令");
            return;
          }
          const created = this.terminal.create(params as TerminalCreateParams);
          this.terminalCommands.set(created.terminalId, params.command);
          this.respondOk(id, created);
          return;
        }
        case acpMethods.client.terminal.output:
          this.respondOk(id, this.terminal.output(params.terminalId));
          return;
        case acpMethods.client.terminal.waitForExit:
          this.respondOk(id, await this.terminal.waitForExit(params.terminalId));
          return;
        case acpMethods.client.terminal.kill:
          this.terminal.kill(params.terminalId);
          this.respondOk(id);
          return;
        case acpMethods.client.terminal.release: {
          const command = this.terminalCommands.get(params.terminalId) || "";
          const snapshot = this.terminal.output(params.terminalId);
          this.emitEvent({ type: "command-output", sessionId: this.sessionId, command, output: snapshot.output, exitCode: snapshot.exitStatus?.exitCode ?? null, truncated: snapshot.truncated });
          this.terminal.release(params.terminalId);
          this.terminalCommands.delete(params.terminalId);
          this.respondOk(id);
          return;
        }
        case acpMethods.client.session.requestPermission: {
          if (id === undefined) {
            this.respondError(id, -32602, "权限请求缺少请求 ID");
            return;
          }
          this.pendingPermissionRequests.add(String(id));
          this.pendingInteractionRequestIds.set(String(id), id);
          const options = (params.options ?? []) as PermissionOption[];
          if (shouldAutoApproveToolPermissions(this.mode, this.planActive)) {
            const option = selectAllowPermissionOption(options);
            if (option?.optionId) this.respondPermission(id, option.optionId);
            else this.cancelPermission(id);
          } else {
            const decided = await this.options.permissionDecider?.(params.toolCall);
            if (decided !== undefined) {
              const option = decided ? selectAllowPermissionOption(options) : options.find((value) => /reject|deny/i.test(value.kind || ""));
              if (option?.optionId) this.respondPermission(id, option.optionId);
              else this.cancelPermission(id);
            } else {
              this.needsUser = true;
              this.emitStatus("needs-user", "等待权限确认");
              this.emitEvent({ type: "permission", sessionId: this.sessionId, request: { requestId: id ?? "", sessionId: this.sessionId, toolCall: params.toolCall, options } });
            }
          }
          return;
        }
        case "x.ai/exit_plan_mode":
        case "_x.ai/exit_plan_mode":
          if (id === undefined) {
            this.respondError(id, -32602, "计划请求缺少请求 ID");
            return;
          }
          this.pendingPlanRequest = id;
          this.planGateReleased = false;
          this.planActive = true;
          this.needsUser = true;
          this.emitStatus("needs-user", "等待计划确认");
          this.emitEvent({ type: "plan", sessionId: this.sessionId, requestId: id, text: params.planContent || params.plan || params.input?.plan || "" });
          return;
        case "x.ai/ask_user_question":
        case "_x.ai/ask_user_question":
          if (id === undefined) {
            this.respondError(id, -32602, "问题请求缺少请求 ID");
            return;
          }
          this.pendingQuestionRequests.add(String(id));
          this.pendingInteractionRequestIds.set(String(id), id);
          this.needsUser = true;
          this.emitStatus("needs-user", "等待回答");
          this.emitEvent({ type: "question", sessionId: this.sessionId, requestId: id ?? "", questions: params.questions ?? [] });
          return;
        case "x.ai/session/update":
        case "_x.ai/session/update": {
          this.handlePrivateSessionUpdate(params.update ?? {});
          this.respondOk(id);
          return;
        }
        case "x.ai/session_notification":
        case "_x.ai/session_notification": {
          const update = { ...(params.update ?? params), ...(params._meta ? { _meta: params._meta } : {}) };
          this.handleModelChanged(update);
          this.handlePrivateSessionUpdate(update);
          this.respondOk(id);
          return;
        }
        case "x.ai/queue/changed":
        case "_x.ai/queue/changed": {
          const previous = this.promptQueue;
          const runningPromptId = typeof params.runningPromptId === "string" ? params.runningPromptId : typeof params.running_prompt_id === "string" ? params.running_prompt_id : undefined;
          const rawQueue = params.queue ?? params.entries ?? params.update?.queue ?? [];
          if (runningPromptId && this.restoredQueueIds.has(runningPromptId)) this.restoredQueueSeenIds.add(runningPromptId);
          if (Array.isArray(rawQueue)) for (const raw of rawQueue) {
            const queueId = raw && typeof raw === "object" && typeof raw.id === "string" ? raw.id : undefined;
            if (queueId && this.restoredQueueIds.has(queueId)) this.restoredQueueSeenIds.add(queueId);
          }
          if (runningPromptId && this.ownedQueuedPromptIds.has(runningPromptId) && runningPromptId !== this.activeQueuedPromptId && runningPromptId !== this.pendingQueuedTurn?.id) {
            const starting = previous.find((entry) => entry.id === runningPromptId);
            if (starting) {
              if (this.activeTurn) this.pendingQueuedTurn = starting;
              else this.startQueuedTurn(starting);
            }
          }
          // Grok Build also reports its internal queue entry for an ordinary
          // direct session/prompt. It has a server-generated id and is not a
          // user-queued follow-up. Treating it as ours starts a phantom second
          // turn after the real turn completes and leaves the Stop button on.
          this.promptQueue = normalizePromptQueue(rawQueue, this.sessionId, previous)
            .filter((entry) => this.ownedQueuedPromptIds.has(entry.id));
          if (this.activeQueuedPrompt && !this.promptQueue.some((entry) => entry.id === this.activeQueuedPrompt!.id)) {
            this.promptQueue = [{ ...this.activeQueuedPrompt, state: "accepted" }, ...this.promptQueue];
          }
          this.promptQueue = this.promptQueue.map((entry, position) => ({ ...entry, position }));
          this.queueRevision += 1;
          this.confirmQueueOperations(runningPromptId);
          this.emitEvent({ type: "prompt-queue", sessionId: this.sessionId, entries: this.promptQueue });
          this.respondOk(id);
          return;
        }
        case "x.ai/task_backgrounded":
        case "_x.ai/task_backgrounded":
          this.handlePrivateSessionUpdate({ ...(params.update ?? params), sessionUpdate: "task_backgrounded" });
          this.respondOk(id);
          return;
        case "x.ai/task_completed":
        case "_x.ai/task_completed":
          this.handlePrivateSessionUpdate({ ...(params.update ?? params), sessionUpdate: "task_completed" });
          this.respondOk(id);
          return;
        case "x.ai/session/prompt_complete":
        case "_x.ai/session/prompt_complete":
          this.respondOk(id);
          return;
        case "x.ai/follow_ups":
        case "_x.ai/follow_ups": {
          if (params._meta?.isReplay === true) {
            this.respondOk(id);
            return;
          }
          const raw = params.followUps ?? params.follow_ups ?? params.suggestions ?? params.items ?? [];
          const suggestions = (Array.isArray(raw) ? raw : []).flatMap((item: unknown, index: number) => {
            if (typeof item === "string" && item.trim()) return [{ id: `${index}-${createHash("sha256").update(item).digest("hex").slice(0, 12)}`, text: item.trim() }];
            if (!item || typeof item !== "object") return [];
            const value = item as Record<string, unknown>;
            const text = firstNonEmptyString(value.text, value.label, value.prompt, value.title);
            return text ? [{ id: firstNonEmptyString(value.id) ?? `${index}-${createHash("sha256").update(text).digest("hex").slice(0, 12)}`, text }] : [];
          }).slice(0, 12);
          this.emitEvent({
            type: "follow-ups",
            sessionId: this.sessionId,
            responseId: firstNonEmptyString(params.responseId, params.response_id),
            promptId: firstNonEmptyString(params.promptId, params.prompt_id),
            suggestions,
          });
          this.respondOk(id);
          return;
        }
        case "x.ai/models/update":
        case "_x.ai/models/update":
          this.applyModelStateUpdate(params);
          this.emitRuntimeUpdate("model", "models/update", firstNonEmptyString(params.reason, params.message));
          this.respondOk(id);
          return;
        case "x.ai/settings/update":
        case "_x.ai/settings/update":
          this.emitRuntimeUpdate("settings", "settings/update", firstNonEmptyString(params.reason, params.message));
          this.respondOk(id);
          return;
        case "x.ai/sessions/changed":
        case "_x.ai/sessions/changed":
        case "x.ai/session/interjection":
        case "_x.ai/session/interjection":
          this.emitRuntimeUpdate("session", method.replace(/^_/, ""), firstNonEmptyString(params.reason, params.message, params.status));
          this.respondOk(id);
          return;
        case "x.ai/monitor_event":
        case "_x.ai/monitor_event":
          this.emitRuntimeUpdate("monitor", "monitor_event", firstNonEmptyString(params.title, params.message, params.status));
          this.respondOk(id);
          return;
        case "x.ai/scheduled_task_created":
        case "_x.ai/scheduled_task_created":
        case "x.ai/scheduled_task_fired":
        case "_x.ai/scheduled_task_fired":
        case "x.ai/scheduled_task_deleted":
        case "_x.ai/scheduled_task_deleted":
        case "x.ai/scheduled_task_inject":
        case "_x.ai/scheduled_task_inject":
        case "x.ai/scheduled_task_inject_prompt":
        case "_x.ai/scheduled_task_inject_prompt":
          this.emitRuntimeUpdate("scheduled-task", method.replace(/^_?x\.ai\//, ""), firstNonEmptyString(params.title, params.message, params.status));
          this.respondOk(id);
          return;
        case "x.ai/mcp/init_progress":
        case "_x.ai/mcp/init_progress":
        case "x.ai/mcp/tools_changed":
        case "_x.ai/mcp/tools_changed":
        case "x.ai/mcp/server_status":
        case "_x.ai/mcp/server_status":
        case "x.ai/mcp/servers_updated":
        case "_x.ai/mcp/servers_updated":
        case "x.ai/mcp_initialized":
        case "_x.ai/mcp_initialized":
        case "x.ai/mcp_init_progress":
        case "_x.ai/mcp_init_progress":
        case "x.ai/mcp_tools_changed":
        case "_x.ai/mcp_tools_changed":
        case "x.ai/mcp_status_changed":
        case "_x.ai/mcp_status_changed":
        case "x.ai/mcp_servers_changed":
        case "_x.ai/mcp_servers_changed":
          {
          const targetSessionId = firstNonEmptyString(params.sessionId, params.session_id) ?? this.sessionId;
          this.emitRuntimeUpdate(
            "mcp",
            method.replace(/^_?x\.ai\//, ""),
            mcpRuntimeSummary(method, params),
            mcpRuntimeData(params),
            targetSessionId,
          );
          this.respondOk(id);
          return;
          }
        case "x.ai/git_head_changed":
        case "_x.ai/git_head_changed":
          this.emitRuntimeUpdate("git", "git_head_changed", firstNonEmptyString(params.head, params.branch, params.message));
          this.respondOk(id);
          return;
        case "x.ai/announcements/update":
        case "_x.ai/announcements/update":
          this.emitRuntimeUpdate("announcement", "announcements/update", firstNonEmptyString(params.title, params.message));
          this.respondOk(id);
          return;
        default:
          await this.options.log.log(`[ACP unknown request] method=${method} schema=${wireSchemaVersion(params)} size=${wireSize(params)}`);
          this.respondError(id, -32601, `Unsupported ACP method: ${method}`);
      }
    } catch (error) {
      await this.options?.log?.log(`[ACP handler error] ${method}: ${error instanceof Error ? error.message : String(error)}`);
      this.respondError(id, -32603, error instanceof Error ? error.message : String(error));
    }
  }

  private beginTurn(clientMessageId?: string): TurnPresentation {
    if (this.activeTurn) return this.activeTurn;
    this.providerThinking = { pending: "", thought: false };
    this.cancelRequested = false;
    const presentation: TurnPresentation & { monotonicStartedAt: number } = {
      turnId: clientMessageId || crypto.randomUUID(),
      ordinal: this.nextTurnOrdinal++,
      ...(clientMessageId ? { clientMessageId } : {}),
      startedAt: new Date().toISOString(),
      monotonicStartedAt: performance.now(),
    };
    this.activeTurn = presentation;
    this.startFirstEventWatchdog(presentation.turnId);
    const { monotonicStartedAt: _ignored, ...publicPresentation } = presentation;
    this.emitEvent({ type: "turn-started", sessionId: this.sessionId, presentation: publicPresentation });
    return publicPresentation;
  }

  private finishTurn(outcome: TurnOutcome, usage?: TurnPresentation["usage"], expectedTurnId?: string): TurnPresentation | undefined {
    const active = this.activeTurn;
    if (!active || (expectedTurnId && active.turnId !== expectedTurnId)) return undefined;
    this.clearFirstEventWatchdog(active.turnId);
    this.flushProviderText();
    this.activeTurn = undefined;
    const completedAt = new Date().toISOString();
    const presentation: TurnPresentation = {
      turnId: active.turnId,
      ordinal: active.ordinal,
      ...(active.clientMessageId ? { clientMessageId: active.clientMessageId } : {}),
      startedAt: active.startedAt,
      completedAt,
      durationMs: Math.max(0, Math.round(performance.now() - active.monotonicStartedAt)),
      outcome,
      ...(usage ? { usage } : {}),
    };
    this.cancelRequested = false;
    this.rememberSettledTurn(presentation);
    this.emitEvent({ type: "turn-completed", sessionId: this.sessionId, presentation });
    return presentation;
  }

  private startFirstEventWatchdog(turnId: string): void {
    this.clearFirstEventWatchdog();
    this.firstEventTurnId = turnId;
    this.firstEventWaitTimer = setTimeout(() => {
      if (this.activeTurn?.turnId !== turnId || this.firstEventTurnId !== turnId) return;
      this.emitStatus("working", "仍在等待 Grok 返回首个事件…");
      this.emitRuntimeUpdate("monitor", "first-event-waiting", "20 秒内尚未收到首个事件；请求仍在运行，不会自动取消。", { elapsedMs: FIRST_EVENT_WAIT_MS });
    }, FIRST_EVENT_WAIT_MS);
    this.firstEventWaitTimer.unref?.();
    this.firstEventDiagnosticTimer = setTimeout(() => {
      if (this.activeTurn?.turnId !== turnId || this.firstEventTurnId !== turnId) return;
      this.emitStatus("working", "长时间未收到首个事件；可打开诊断或停止任务");
      this.emitRuntimeUpdate("monitor", "first-event-diagnostic", "60 秒内尚未收到首个事件；Desktop 保持连接并提供诊断/停止，不主动取消。", { elapsedMs: FIRST_EVENT_DIAGNOSTIC_MS });
    }, FIRST_EVENT_DIAGNOSTIC_MS);
    this.firstEventDiagnosticTimer.unref?.();
  }

  private markFirstTurnEvent(): void {
    if (!this.activeTurn || this.firstEventTurnId !== this.activeTurn.turnId) return;
    this.clearFirstEventWatchdog(this.activeTurn.turnId);
  }

  private clearFirstEventWatchdog(expectedTurnId?: string): void {
    if (expectedTurnId && this.firstEventTurnId && this.firstEventTurnId !== expectedTurnId) return;
    if (this.firstEventWaitTimer) clearTimeout(this.firstEventWaitTimer);
    if (this.firstEventDiagnosticTimer) clearTimeout(this.firstEventDiagnosticTimer);
    this.firstEventWaitTimer = undefined;
    this.firstEventDiagnosticTimer = undefined;
    this.firstEventTurnId = undefined;
  }

  private rememberSettledTurn(presentation: TurnPresentation): void {
    this.settledTurns.set(presentation.turnId, presentation);
    while (this.settledTurns.size > 128) {
      const oldest = this.settledTurns.keys().next().value;
      if (!oldest) break;
      this.settledTurns.delete(oldest);
      this.turnsAwaitingAuthoritativeTerminal.delete(oldest);
    }
  }

  private correctSettledTurn(turnId: string, outcome: TurnOutcome, usage?: TurnPresentation["usage"]): boolean {
    const previous = this.settledTurns.get(turnId);
    if (!previous) return false;
    const corrected: TurnPresentation = {
      ...previous,
      outcome,
      ...(usage ? { usage } : {}),
    };
    this.turnsAwaitingAuthoritativeTerminal.delete(turnId);
    this.rememberSettledTurn(corrected);
    this.emitEvent({ type: "turn-completed", sessionId: this.sessionId, presentation: corrected });
    return true;
  }

  private resolveTerminalTurnId(update: Record<string, unknown>): string | undefined {
    const explicit = terminalTurnId(update);
    if (explicit) {
      if (this.activeTurn?.turnId === explicit || this.settledTurns.has(explicit)) return explicit;
      for (const pending of this.pending.values()) {
        if (pending.turnId === explicit) return explicit;
        if (pending.promptId === explicit && pending.turnId) return pending.turnId;
      }
      if (this.activeQueuedPromptId === explicit) return this.activeTurn?.turnId;
      return explicit;
    }
    // Older CLIs omit turnId. If the previous prompt RPC already resolved,
    // its authoritative terminal is necessarily older than any now-active
    // queued turn and must correct that settled turn instead of ending the new
    // one. Insertion order is prompt order.
    const awaiting = this.turnsAwaitingAuthoritativeTerminal.values().next().value;
    return awaiting ?? this.activeTurn?.turnId;
  }

  private startQueuedTurn(entry: PromptQueueEntry): void {
    const resumedAcceptedTurn = entry.state === "accepted" || entry.state === "sending";
    this.pendingQueuedTurn = undefined;
    this.activeQueuedPromptId = entry.id;
    this.activeQueuedPrompt = { ...entry, state: "accepted" };
    this.promptQueue = [
      this.activeQueuedPrompt,
      ...this.promptQueue.filter((value) => value.id !== entry.id),
    ].map((value, position) => ({ ...value, position }));
    // Persist accepted/running ownership. Without this snapshot a process
    // crash makes the in-flight queued prompt disappear on restart.
    this.emitEvent({ type: "prompt-queue", sessionId: this.sessionId, entries: this.promptQueue });
    this.working = true;
    this.beginTurn(entry.clientMessageId);
    // The prompt was already persisted by the CLI when it entered the queue.
    // Emit it only after its own turn boundary exists so it cannot be grouped
    // under the previous final answer.
    if (!resumedAcceptedTurn) {
      this.emitEvent({ type: "user-message", sessionId: this.sessionId, id: entry.clientMessageId, clientMessageId: entry.clientMessageId, text: entry.text, attachments: entry.attachmentPreviews, delivery: "sent" });
    }
    this.emitStatus("working", entry.state === "interjected" ? "正在处理已提交的跟进消息…" : "正在处理队列消息…");
  }

  private activatePendingQueuedTurn(): void {
    const pending = this.pendingQueuedTurn;
    if (pending && !this.activeTurn) this.startQueuedTurn(pending);
  }

  private persistActiveQueueTerminal(outcome: TurnOutcome): void {
    const entry = this.activeQueuedPrompt;
    if (!entry) return;
    const terminal = { ...entry, state: outcome === "completed" ? "completed" : outcome } satisfies PromptQueueEntry;
    this.activeQueuedPrompt = undefined;
    this.activeQueuedPromptId = undefined;
    this.ownedQueuedPromptIds.delete(entry.id);
    this.promptQueue = this.promptQueue.filter((value) => value.id !== entry.id).map((value, position) => ({ ...value, position }));
    this.queueRevision += 1;
    // `onPromptQueueTerminal` performs the durable remove+terminal append in
    // one JsonStore mutation. Send the visible snapshot without separately
    // persisting it, otherwise saveQueue can race and erase terminal history.
    this.emit("event", { type: "prompt-queue", sessionId: this.sessionId, entries: this.promptQueue } satisfies ChatEvent);
    if (!this.options.onPromptQueueTerminal) return;
    void Promise.resolve(this.options.onPromptQueueTerminal(this.sessionId, terminal)).catch((error: unknown) => {
      void this.options.log.log(`prompt queue terminal persistence failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private async reconcileRestoredQueue(): Promise<void> {
    this.restoredQueueTimer = undefined;
    if (this.disposed || !this.sessionId) return;
    const missing = this.promptQueue.filter((entry) => this.restoredQueueIds.has(entry.id) && !this.restoredQueueSeenIds.has(entry.id));
    for (const entry of missing) {
      if (this.disposed || !this.promptQueue.some((value) => value.id === entry.id)) return;
      const attachments = attachmentsFromQueuePreview(entry.attachmentPreviews);
      const prompt = await buildPromptBlocks(entry.text, attachments);
      const sendNow = entry.state === "interjected" || entry.state === "sending" || entry.state === "accepted";
      void this.submitQueuedRequest(entry, prompt, sendNow, true).catch((error) => {
        if (this.disposed) return;
        this.ownedQueuedPromptIds.delete(entry.id);
        this.promptQueue = this.promptQueue.filter((value) => value.id !== entry.id);
        this.emitEvent({ type: "prompt-queue", sessionId: this.sessionId, entries: this.promptQueue });
        const failureMessage = `恢复队列消息失败：${error instanceof Error ? error.message : String(error)}`;
        this.emitEvent({ type: "error", sessionId: this.sessionId, message: failureMessage, failure: this.buildFailure(failureMessage, { error }) });
        if (this.options.onPromptQueueTerminal) void Promise.resolve(this.options.onPromptQueueTerminal(this.sessionId, { ...entry, state: "failed" })).catch(() => undefined);
      });
    }
  }

  private submitQueuedRequest(entry: PromptQueueEntry, prompt: unknown[], sendNow: boolean, recovered = false): Promise<unknown> {
    return this.request(acpMethods.agent.session.prompt, {
      sessionId: this.sessionId,
      prompt,
      _meta: {
        promptId: entry.id,
        sendNow,
        ...(recovered ? { recovered: true } : {}),
        mode: this.mode === "plan" ? "plan" : "agent",
        clientIdentifier: "grok-build-desktop",
      },
    }, INTERACTIVE_PROMPT_TIMEOUT_MS, undefined, undefined, entry.id);
  }

  private emitProviderText(text: string, flush = false): void {
    const result = demuxProviderThinkingText(this.providerThinking, text, flush);
    this.providerThinking = result.state;
    for (const chunk of result.chunks) {
      this.emitEvent(chunk.role === "thought"
        ? { type: "thought-chunk", sessionId: this.sessionId, text: chunk.text }
        : { type: "message-chunk", sessionId: this.sessionId, text: chunk.text });
    }
  }

  private flushProviderText(): void {
    this.emitProviderText("", true);
    this.providerThinking = { pending: "", thought: false };
  }

  private request(method: string, params: unknown, timeoutMs: number | null = 120_000, onWritten?: () => void, turnId?: string, promptId?: string): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs === null ? undefined : setTimeout(() => {
        this.pending.delete(id);
        if (method === acpMethods.agent.session.prompt) this.cancel();
        reject(new Error(`ACP 请求超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, { method, turnId, promptId, resolve, reject, timer });
      if (!this.write({ jsonrpc: "2.0", id, method, params })) {
        if (timer) clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(`Grok 进程不可用：${method}`));
      } else onWritten?.();
    });
  }

  private settlePromptRequestFromTerminal(turnId: string, outcome: TurnOutcome, meta?: PromptMeta, promptId?: string): void {
    for (const [id, pending] of this.pending) {
      if (pending.method !== acpMethods.agent.session.prompt || (pending.turnId !== turnId && (!promptId || pending.promptId !== promptId))) continue;
      this.pending.delete(id);
      if (pending.timer) clearTimeout(pending.timer);
      const result: PromptTerminalResult = {
        _grokDesktopTerminalOutcome: outcome,
        ...(meta ? { _meta: { ...meta, modelId: meta.modelId ?? this.currentModelId } } : {}),
      };
      pending.resolve(result);
      return;
    }
  }

  private write(value: unknown): boolean {
    if (!this.process || !this.process.stdin.writable || this.process.killed) return false;
    try {
      this.process.stdin.write(`${JSON.stringify(value)}\n`);
      return true;
    } catch {
      return false;
    }
  }

  private queueNotification(method: string, params: Record<string, unknown>): void {
    if (!this.sessionId) throw new Error("会话尚未就绪");
    if (!this.write({
      jsonrpc: "2.0",
      method,
      params: { sessionId: this.sessionId, clientIdentifier: "grok-build-desktop", ...params },
    })) throw new Error(`Grok 进程不可用：${method}`);
  }

  private awaitQueueConfirmation(
    operationId: string,
    description: string,
    confirms: PendingQueueOperation["confirms"],
    onConfirmed?: PendingQueueOperation["onConfirmed"],
    onTimeout?: PendingQueueOperation["onTimeout"],
    timeoutMs = 5_000,
  ): void {
    const queueRevision = this.queueRevision;
    const timer = setTimeout(() => {
      const pending = this.pendingQueueOperations.get(operationId);
      if (!pending) return;
      this.pendingQueueOperations.delete(operationId);
      const rolledBack = this.queueRevision === pending.queueRevision;
      if (rolledBack) pending.onTimeout?.();
      const message = rolledBack
        ? `${description}已送达 CLI，但 ${Math.ceil(timeoutMs / 1_000)} 秒内未收到队列确认；已恢复操作前状态`
        : `${description}未收到匹配确认；界面已采用 CLI 最新队列状态`;
      this.emitEvent({ type: "error", sessionId: this.sessionId, message, failure: this.buildFailure(message) });
    }, timeoutMs);
    timer.unref?.();
    this.pendingQueueOperations.set(operationId, { operationId, description, confirms, onConfirmed, onTimeout, queueRevision, timer });
  }

  private cancelQueueConfirmation(operationId: string): void {
    const pending = this.pendingQueueOperations.get(operationId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingQueueOperations.delete(operationId);
  }

  private confirmQueueOperations(runningPromptId?: string): void {
    for (const [operationId, pending] of this.pendingQueueOperations) {
      if (!pending.confirms(this.promptQueue, runningPromptId)) continue;
      clearTimeout(pending.timer);
      this.pendingQueueOperations.delete(operationId);
      pending.onConfirmed?.();
    }
  }

  private respondOk(id: JsonRpcId | undefined, result: unknown = {}): void {
    if (id !== undefined) this.write({ jsonrpc: "2.0", id, result });
  }

  private respondError(id: JsonRpcId | undefined, code: number, message: string): void {
    if (id !== undefined) this.write({ jsonrpc: "2.0", id, error: { code, message } });
  }

  private failAll(error: Error): void {
    this.finishEffortChange(false);
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private emitEvent(event: ChatEvent): void {
    if (event.type === "prompt-queue") {
      const persist = this.options.onPromptQueueChanged;
      if (persist) void Promise.resolve(persist(event.sessionId, event.entries.map((entry) => ({ ...entry })))).catch((error: unknown) => {
        void this.options.log.log(`prompt queue persistence failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    this.emit("event", event);
  }

  private persistRuntimePatch(patch: { modelId?: string; effort?: ReasoningEffort; mode?: SessionMode }): void {
    if (!this.sessionId || !this.options.onRuntimeChanged || !Object.keys(patch).length) return;
    void Promise.resolve(this.options.onRuntimeChanged(this.sessionId, patch)).catch((error: unknown) => {
      void this.options.log.log(`session runtime persistence failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private emitStatus(status: "idle" | "working" | "needs-user" | "error", text?: string): void {
    if (this.sessionId) this.emitEvent({ type: "status", sessionId: this.sessionId, status, text });
  }

  private refreshNeedsUser(): boolean {
    this.needsUser = this.pendingPlanRequest !== undefined
      || (this.pendingPermissionRequests?.size ?? 0) > 0
      || (this.pendingQuestionRequests?.size ?? 0) > 0;
    return this.needsUser;
  }

  private emitMediaFromContent(content: any): void {
    if (!content) return;
    const emitImage = (data: unknown, mimeType: unknown): void => {
      if (typeof data !== "string" || !data) return;
      const mime = typeof mimeType === "string" && mimeType.startsWith("image/") ? mimeType : "image/png";
      const key = `image:${createHash("sha256").update(`${mime}\u0000${data}`).digest("hex")}`;
      if (this.emittedMediaKeys.has(key)) return;
      this.emittedMediaKeys.add(key);
      if (this.emittedMediaKeys.size > 512) this.emittedMediaKeys.delete(this.emittedMediaKeys.values().next().value!);
      this.emitEvent({ type: "media", sessionId: this.sessionId, media: "image", source: data, isData: true, mimeType: mime });
    };
    if (content.type === "image") emitImage(content.data, content.mimeType ?? content.mime_type);
    // Grok Build extracts MCP/file images before truncating the text payload.
    // They arrive as side-channel arrays on the tool result rather than as an
    // ACP `content` image block, so consume both current spellings here.
    for (const item of [...(Array.isArray(content.extracted_images) ? content.extracted_images : []), ...(Array.isArray(content.extractedImages) ? content.extractedImages : []), ...(Array.isArray(content.images) ? content.images : [])]) {
      if (item && typeof item === "object") emitImage(item.data, item.mime_type ?? item.mimeType);
    }
    const uri = content.uri || content.resource?.uri;
    if (typeof uri === "string") {
      const kind = mediaKind(uri);
      if (kind) this.emitEvent({ type: "media", sessionId: this.sessionId, media: kind, source: uri });
    }
  }

  private emitGeneratedMedia(update: any): void {
    for (const item of update.content ?? []) {
      const block = item?.type === "content" ? item.content : item;
      if (block?.type !== "text" || typeof block.text !== "string") continue;
      const paths: string[] = [];
      try {
        const parsed = JSON.parse(block.text) as { path?: string };
        if (parsed.path) paths.push(parsed.path);
      } catch {
        for (const match of block.text.matchAll(MEDIA_PATH)) if (match[0]) paths.push(match[0]);
      }
      for (const path of paths) {
        const clean = path.replace(/^\\\\\?\\/, "");
        const kind = mediaKind(clean);
        if (kind) this.emitEvent({ type: "media", sessionId: this.sessionId, media: kind, source: clean });
      }
    }
  }
}

function normalizeToolStatus(status: unknown): ToolCallState["status"] {
  const value = String(status || "").toLowerCase();
  if (/fail|error/.test(value)) return "failed";
  if (/complete|success/.test(value)) return "completed";
  if (/progress|running/.test(value)) return "in_progress";
  return "pending";
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort | undefined {
  return typeof value === "string" && (REASONING_EFFORTS as readonly string[]).includes(value)
    ? value as ReasoningEffort
    : undefined;
}

export function buildPromptText(text: string, attachments: Attachment[]): string {
  const paths = attachments.filter((value) => value.kind !== "image" && value.path).map((value) => `@${value.path}`);
  return paths.length ? `${text}\n\n上下文文件：\n${paths.join("\n")}` : text;
}

function mimeForPath(path: string): string {
  const ext = extname(path).toLowerCase();
  return ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".gif" ? "image/gif" : ext === ".webp" ? "image/webp" : "image/png";
}

function attachmentsFromQueuePreview(previews: UserMessageAttachmentPreview[] | undefined): Attachment[] {
  if (!previews?.length) return [];
  return previews.flatMap((preview): Attachment[] => {
    if (preview.availability === "missing" || !preview.source) return [];
    return [{
      id: preview.id,
      name: preview.name,
      kind: preview.kind,
      mimeType: preview.mimeType,
      size: preview.size,
      ...(preview.isData ? { data: preview.source } : { path: preview.source }),
    }];
  });
}

async function buildPromptBlocks(text: string, attachments: Attachment[]): Promise<unknown[]> {
  const prompt: unknown[] = [{ type: "text", text: buildPromptText(text, attachments) }];
  for (const attachment of attachments) if (attachment.kind === "image") {
    const data = attachment.data ?? (attachment.path ? await readFile(attachment.path).then((value) => value.toString("base64")) : undefined);
    if (data) prompt.push({ type: "image", data, mimeType: attachment.mimeType || mimeForPath(attachment.path || attachment.name) });
  }
  return prompt;
}

export function normalizePromptQueue(value: unknown, sessionId: string, previous: PromptQueueEntry[] = []): PromptQueueEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    const row = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const id = String(row.id ?? row.promptId ?? row.prompt_id ?? `queue-${index}`);
    const prior = previous.find((entry) => entry.id === id);
    return {
      id,
      sessionId,
      clientMessageId: typeof row.clientMessageId === "string" ? row.clientMessageId : typeof row.client_message_id === "string" ? row.client_message_id : prior?.clientMessageId,
      attachmentPreviews: prior?.attachmentPreviews,
      text: String(row.text ?? row.prompt ?? row.content ?? ""),
      position: typeof row.position === "number" ? row.position : index,
      createdAt: typeof row.createdAt === "string" ? row.createdAt : typeof row.created_at === "string" ? row.created_at : prior?.createdAt ?? new Date().toISOString(),
      state: row.sendNow || row.state === "interjected"
        ? "interjected"
        : row.state === "sending"
          ? "sending"
          : row.state === "queued"
            ? "queued"
            : prior?.state ?? "queued",
      version: typeof row.version === "number" ? row.version : 0,
      owner: typeof row.owner === "string" ? row.owner : undefined,
      lastEditor: typeof row.lastEditor === "string" ? row.lastEditor : typeof row.last_editor === "string" ? row.last_editor : undefined,
      kind: typeof row.kind === "string" ? row.kind : undefined,
    } satisfies PromptQueueEntry;
  }).sort((a, b) => a.position - b.position);
}

function normalizeRewindPoints(value: Record<string, unknown>): RewindPoint[] {
  const source = Array.isArray(value.points) ? value.points : Array.isArray(value.rewindPoints) ? value.rewindPoints : Array.isArray(value.rewind_points) ? value.rewind_points : [];
  return source.map((entry, index) => { const row = entry && typeof entry === "object" ? entry as Record<string, unknown> : {}; const promptIndex = row.promptIndex ?? row.prompt_index ?? row.id ?? row.pointId ?? row.point_id ?? index; const userMessage = typeof row.promptPreview === "string" ? row.promptPreview : typeof row.prompt_preview === "string" ? row.prompt_preview : typeof row.userMessage === "string" ? row.userMessage : typeof row.user_message === "string" ? row.user_message : undefined; const snapshotCount = typeof row.numFileSnapshots === "number" ? row.numFileSnapshots : typeof row.num_file_snapshots === "number" ? row.num_file_snapshots : typeof row.filesChanged === "number" ? row.filesChanged : typeof row.files_changed === "number" ? row.files_changed : undefined; return { id: String(promptIndex), label: String(row.label ?? row.title ?? userMessage ?? `回退点 ${index + 1}`), createdAt: typeof row.createdAt === "string" ? row.createdAt : typeof row.created_at === "string" ? row.created_at : undefined, userMessage, filesChanged: snapshotCount }; });
}

function unwrapExtResult(value: Record<string, unknown>): Record<string, unknown> {
  if (value.error !== undefined && (value.result === null || value.result === undefined)) {
    const error = value.error && typeof value.error === "object" ? (value.error as Record<string, unknown>).message ?? JSON.stringify(value.error) : value.error;
    throw new Error(String(error ?? "Grok 扩展请求失败"));
  }
  return value.result && typeof value.result === "object" ? value.result as Record<string, unknown> : value;
}

export function normalizeCliSessionList(value: Record<string, unknown>): CliSessionListResult {
  const rows = Array.isArray(value.sessions) ? value.sessions : Array.isArray(value.items) ? value.items : [];
  const sessions: CliSessionListItem[] = rows.flatMap((item): CliSessionListItem[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const sessionId = firstNonEmptyString(row.sessionId, row.session_id, row.id);
    if (!sessionId) return [];
    return [{
      sessionId,
      cwd: firstNonEmptyString(row.cwd, row.workspace, row.directory),
      title: firstNonEmptyString(row.title, row.name, row.label),
      createdAt: firstNonEmptyString(row.createdAt, row.created_at),
      updatedAt: firstNonEmptyString(row.updatedAt, row.updated_at, row.lastActivityAt),
      modelId: firstNonEmptyString(row.modelId, row.model_id),
      messageCount: optionalNonNegativeInteger(row.messageCount ?? row.message_count),
    }];
  });
  return {
    supported: true,
    sessions,
    nextCursor: firstNonEmptyString(value.nextCursor, value.next_cursor, value.cursor),
    source: "acp",
  };
}

export function normalizeCliSessionInfo(sessionId: string, value: Record<string, unknown>): CliSessionInfo {
  const row = recordValue(value.session) ?? value;
  const data = recordValue(row.data) ?? {};
  const context = recordValue(row.context) ?? recordValue(data.context) ?? {};
  const rawMode = firstNonEmptyString(row.mode, row.modeId, row.mode_id, data.mode, data.modeId, data.mode_id);
  const rawEffort = normalizeReasoningEffort(row.effort ?? row.reasoningEffort ?? row.reasoning_effort ?? data.effort ?? data.reasoningEffort ?? data.reasoning_effort);
  return {
    supported: true,
    sessionId: firstNonEmptyString(row.sessionId, row.session_id, row.id) ?? sessionId,
    cwd: firstNonEmptyString(row.cwd, row.workspace, row.directory),
    title: firstNonEmptyString(row.title, row.name, row.label, data.title),
    modelId: firstNonEmptyString(row.modelId, row.model_id, row.model, data.modelId, data.model_id, data.modelDisplayName, data.model_display_name, data.model),
    resolvedModelId: firstNonEmptyString(row.resolvedModelId, row.resolved_model_id, data.resolvedModelId, data.resolved_model_id),
    agentName: firstNonEmptyString(row.agentName, row.agent_name, data.agentName, data.agent_name),
    mode: rawMode === "agent" || rawMode === "plan" || rawMode === "auto" ? rawMode : undefined,
    effort: rawEffort,
    sandbox: firstNonEmptyString(row.sandbox, row.sandboxMode, row.sandbox_mode, data.sandbox, data.sandboxMode, data.sandbox_mode),
    contextWindowTokens: optionalNonNegativeInteger(context.total ?? context.contextWindowTokens ?? context.context_window_tokens ?? row.contextWindowTokens ?? row.context_window_tokens ?? data.contextWindowTokens ?? data.context_window_tokens),
    contextUsedTokens: optionalNonNegativeInteger(context.used ?? context.contextUsedTokens ?? context.context_used_tokens ?? row.contextUsedTokens ?? row.context_used_tokens ?? data.contextUsedTokens ?? data.context_used_tokens ?? data.totalTokens ?? data.total_tokens),
    contextFreeTokens: optionalNonNegativeInteger(context.freeTokens ?? context.free_tokens),
    contextUsagePercent: optionalNonNegativeNumber(context.usagePct ?? context.usage_pct),
    systemPromptTokens: optionalNonNegativeInteger(context.systemPromptTokens ?? context.system_prompt_tokens),
    toolDefinitionsCount: optionalNonNegativeInteger(context.toolDefinitionsCount ?? context.tool_definitions_count),
    toolDefinitionsTokens: optionalNonNegativeInteger(context.toolDefinitionsTokens ?? context.tool_definitions_tokens),
    compactionCount: optionalNonNegativeInteger(context.compactionCount ?? context.compaction_count),
    autoCompactThresholdPercent: optionalNonNegativeInteger(context.autoCompactThresholdPercent ?? context.auto_compact_threshold_percent),
    turnCount: optionalNonNegativeInteger(data.turns ?? context.turnCount ?? context.turn_count),
    toolCallCount: optionalNonNegativeInteger(context.toolCallCount ?? context.tool_call_count),
    messageCount: optionalNonNegativeInteger(context.messageCount ?? context.message_count),
    createdAt: firstNonEmptyString(row.createdAt, row.created_at),
    updatedAt: firstNonEmptyString(row.updatedAt, row.updated_at, row.lastActivityAt),
    source: "acp",
  };
}

export function normalizeCliSessionUsage(sessionId: string, value: Record<string, unknown>): CliSessionUsage {
  const row = recordValue(value.usage) ?? value;
  const costUsdTicks = optionalNonNegativeNumber(row.costUsdTicks ?? row.cost_usd_ticks ?? row.totalCostUsdTicks ?? row.total_cost_usd_ticks);
  const modelUsageRows = recordValue(row.modelUsage ?? row.model_usage);
  const modelUsage = modelUsageRows ? Object.fromEntries(Object.entries(modelUsageRows).flatMap(([modelId, raw]) => {
    const model = recordValue(raw);
    if (!model) return [];
    const modelCostTicks = optionalNonNegativeNumber(model.costUsdTicks ?? model.cost_usd_ticks ?? model.totalCostUsdTicks ?? model.total_cost_usd_ticks);
    return [[modelId, {
      inputTokens: optionalNonNegativeInteger(model.inputTokens ?? model.input_tokens),
      outputTokens: optionalNonNegativeInteger(model.outputTokens ?? model.output_tokens),
      cachedReadTokens: optionalNonNegativeInteger(model.cachedReadTokens ?? model.cached_read_tokens),
      reasoningTokens: optionalNonNegativeInteger(model.reasoningTokens ?? model.reasoning_tokens),
      totalTokens: optionalNonNegativeInteger(model.totalTokens ?? model.total_tokens),
      costUsd: optionalNonNegativeNumber(model.costUsd ?? model.cost_usd) ?? (modelCostTicks === undefined ? undefined : modelCostTicks / 10_000_000_000),
      costIsPartial: typeof (model.costIsPartial ?? model.cost_is_partial) === "boolean" ? Boolean(model.costIsPartial ?? model.cost_is_partial) : undefined,
    }]];
  })) : undefined;
  return {
    supported: true,
    sessionId: firstNonEmptyString(row.sessionId, row.session_id, row.id) ?? sessionId,
    inputTokens: optionalNonNegativeInteger(row.inputTokens ?? row.input_tokens ?? row.promptTokens ?? row.prompt_tokens),
    outputTokens: optionalNonNegativeInteger(row.outputTokens ?? row.output_tokens ?? row.completionTokens ?? row.completion_tokens),
    cachedReadTokens: optionalNonNegativeInteger(row.cachedReadTokens ?? row.cached_read_tokens ?? row.cacheReadTokens),
    reasoningTokens: optionalNonNegativeInteger(row.reasoningTokens ?? row.reasoning_tokens),
    totalTokens: optionalNonNegativeInteger(row.totalTokens ?? row.total_tokens ?? row.tokens),
    costUsd: optionalNonNegativeNumber(row.costUsd ?? row.cost_usd ?? row.totalCostUsd ?? row.total_cost_usd ?? row.cost)
      ?? (costUsdTicks === undefined ? undefined : costUsdTicks / 10_000_000_000),
    costUsdTicks,
    costIsPartial: typeof (row.costIsPartial ?? row.cost_is_partial) === "boolean" ? Boolean(row.costIsPartial ?? row.cost_is_partial) : undefined,
    usageIsIncomplete: typeof (row.usageIsIncomplete ?? row.usage_is_incomplete) === "boolean" ? Boolean(row.usageIsIncomplete ?? row.usage_is_incomplete) : undefined,
    modelCalls: optionalNonNegativeInteger(row.modelCalls ?? row.model_calls),
    apiDurationMs: optionalNonNegativeInteger(row.apiDurationMs ?? row.api_duration_ms),
    numTurns: optionalNonNegativeInteger(row.numTurns ?? row.num_turns),
    ...(modelUsage ? { modelUsage } : {}),
    limitPercent: optionalNonNegativeNumber(row.limitPercent ?? row.limit_percent ?? row.usedPercent ?? row.used_percent),
    resetAt: firstNonEmptyString(row.resetAt, row.reset_at),
    source: "acp",
  };
}

export function normalizeSessionCloseReceipt(sessionId: string, value: unknown): SessionCloseReceipt {
  const result = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const meta = result._meta && typeof result._meta === "object" ? result._meta as Record<string, unknown> : {};
  const rawOutcome = firstNonEmptyString(meta["x.ai/closeOutcome"], meta.closeOutcome, result.closeOutcome, result.outcome);
  const normalized = String(rawOutcome ?? "").trim().toLowerCase().replace(/_/g, "-");
  let outcome: SessionCloseOutcome = "unknown";
  if (/^(?:notresident|not-resident|already-closed)$/.test(normalized)) outcome = "not-resident";
  else if (normalized === "superseded") outcome = "superseded";
  else if (/^(?:closed|close|success|completed|cancelled-and-closed)$/.test(normalized)) outcome = "closed";
  return {
    sessionId,
    outcome,
    ...(rawOutcome ? { rawOutcome } : {}),
    completed: outcome !== "unknown",
    at: new Date().toISOString(),
    ...(outcome === "not-resident" ? { message: "会话已不在当前 CLI 进程中，无需重复关闭" }
      : outcome === "superseded" ? { message: "会话已由较新的附加进程接管，旧进程已释放" }
      : outcome === "unknown" ? { message: rawOutcome ? `CLI 返回了未知关闭结果：${rawOutcome}` : "CLI 未返回结构化关闭结果" }
      : {}),
  };
}

export function normalizeRuntimeEventEnvelope(
  rawMethod: string,
  rawPayload: Record<string, unknown>,
  sourceSessionId?: string,
): RuntimeEventEnvelope {
  let method = rawMethod.startsWith("_x.ai/") ? rawMethod.slice(1) : rawMethod;
  let payload = rawPayload;
  if ((rawMethod === "_x.ai/notification" || rawMethod === "_x.ai/event")
    && typeof rawPayload.method === "string"
    && /^_?x\.ai\//.test(rawPayload.method)) {
    method = rawPayload.method.replace(/^_/, "");
    payload = rawPayload.params && typeof rawPayload.params === "object"
      ? rawPayload.params as Record<string, unknown>
      : rawPayload.payload && typeof rawPayload.payload === "object"
        ? rawPayload.payload as Record<string, unknown>
        : {};
  }
  return {
    rawMethod,
    method,
    schemaVersion: wireSchemaVersion(payload),
    ...(sourceSessionId ? { sourceSessionId } : {}),
    receivedAt: new Date().toISOString(),
    payload,
  };
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number >= 0 ? number : undefined;
}

function mcpRuntimeData(value: Record<string, unknown>): Record<string, unknown> {
  const servers = Array.isArray(value.mcpServers)
    ? value.mcpServers
    : Array.isArray(value.servers)
      ? value.servers
      : undefined;
  const tools = Array.isArray(value.tools) ? value.tools : undefined;
  const progress = typeof value.progress === "number" && Number.isFinite(value.progress) ? value.progress : undefined;
  const total = optionalNonNegativeInteger(value.total);
  const connected = optionalNonNegativeInteger(value.connected);
  const toolCount = optionalNonNegativeInteger(value.mcpToolCount ?? value.toolCount);
  const elapsedMs = optionalNonNegativeInteger(value.elapsedMs ?? value.elapsed_ms);
  return {
    ...(firstNonEmptyString(value.sessionId, value.session_id) ? { sessionId: firstNonEmptyString(value.sessionId, value.session_id) } : {}),
    ...(firstNonEmptyString(value.server, value.serverName, value.name) ? { server: firstNonEmptyString(value.server, value.serverName, value.name) } : {}),
    ...(firstNonEmptyString(value.source) ? { source: firstNonEmptyString(value.source) } : {}),
    ...(firstNonEmptyString(value.status, value.state) ? { status: firstNonEmptyString(value.status, value.state) } : {}),
    ...(firstNonEmptyString(value.reason) ? { reason: firstNonEmptyString(value.reason) } : {}),
    ...(firstNonEmptyString(value.detail) ? { detail: firstNonEmptyString(value.detail) } : {}),
    ...(progress === undefined ? {} : { progress }),
    ...(total === undefined ? {} : { total }),
    ...(connected === undefined ? {} : { connected }),
    ...(servers ? { serverCount: servers.length } : {}),
    ...(toolCount === undefined ? (tools ? { toolCount: tools.length } : {}) : { toolCount }),
    ...(elapsedMs === undefined ? {} : { elapsedMs }),
    ...(typeof value.requiresAuth === "boolean" ? { requiresAuth: value.requiresAuth } : {}),
    ...(typeof value.authRequired === "boolean" ? { requiresAuth: value.authRequired } : {}),
    ...(typeof value.setupRequired === "boolean" ? { setupRequired: value.setupRequired } : {}),
  };
}

function mcpRuntimeSummary(method: string, value: Record<string, unknown>): string | undefined {
  const server = firstNonEmptyString(value.server, value.serverName, value.name);
  const status = firstNonEmptyString(value.status, value.state);
  const total = optionalNonNegativeInteger(value.total);
  const connected = optionalNonNegativeInteger(value.connected);
  const toolCount = optionalNonNegativeInteger(value.mcpToolCount ?? value.toolCount)
    ?? (Array.isArray(value.tools) ? value.tools.length : undefined);
  if (/init_progress$/.test(method) && total !== undefined && connected !== undefined) return `MCP 连接 ${connected}/${total}`;
  if (/mcp_initialized$/.test(method)) return toolCount === undefined ? "MCP 初始化完成" : `MCP 初始化完成 · ${toolCount} 个工具`;
  if (/tools_changed$/.test(method)) return `${server ? `${server} · ` : ""}${toolCount ?? 0} 个工具`;
  if (/server_status$|status_changed$/.test(method)) return [server, status].filter(Boolean).join(" · ") || undefined;
  if (/servers_updated$|servers_changed$/.test(method)) {
    const servers = Array.isArray(value.mcpServers) ? value.mcpServers : Array.isArray(value.servers) ? value.servers : undefined;
    return servers ? `MCP 服务器已更新 · ${servers.length} 个` : "MCP 服务器已更新";
  }
  return firstNonEmptyString(value.message, server, status);
}

function isMethodNotFound(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /method\s+not\s+found|-32601|unsupported/i.test(message);
}

function mediaKind(path: string): "image" | "video" | undefined {
  const ext = extname(path).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  return undefined;
}

function isMediaTool(value: any): boolean {
  const title = `${value.title || ""} ${value.rawInput?.variant || ""}`;
  return /imagine|image_gen|image_edit|video_gen|image_to_video|reference_to_video/i.test(title);
}

function normalizeTerminalTurnOutcome(update: Record<string, unknown>): TurnOutcome {
  if (update.cancelled === true || update.canceled === true) return "cancelled";
  const value = String(update.outcome ?? update.status ?? update.result ?? "").toLowerCase();
  if (/cancel|abort|stop/.test(value)) return "cancelled";
  if (/fail|error|reject/.test(value) || update.error) return "failed";
  return "completed";
}

function terminalTurnId(update: Record<string, unknown>): string | undefined {
  const meta = update._meta && typeof update._meta === "object" ? update._meta as Record<string, unknown> : undefined;
  const value = update.turnId ?? update.turn_id
    ?? update.clientMessageId ?? update.client_message_id
    ?? update.promptId ?? update.prompt_id
    ?? meta?.turnId ?? meta?.turn_id ?? meta?.clientMessageId ?? meta?.promptId;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

function extractPromptMeta(result: { _meta?: Record<string, unknown> }): PromptMeta {
  const meta = result?._meta ?? {};
  return {
    totalTokens: numberOrUndefined(meta.totalTokens),
    inputTokens: numberOrUndefined(meta.inputTokens),
    outputTokens: numberOrUndefined(meta.outputTokens),
    cachedReadTokens: numberOrUndefined(meta.cachedReadTokens),
    reasoningTokens: numberOrUndefined(meta.reasoningTokens),
    modelId: typeof meta.modelId === "string" ? meta.modelId : undefined,
  };
}

function extractUsageMeta(usage: Record<string, unknown>): PromptMeta {
  return {
    totalTokens: numberOrUndefined(usage.totalTokens ?? usage.total_tokens),
    inputTokens: numberOrUndefined(usage.inputTokens ?? usage.input_tokens),
    outputTokens: numberOrUndefined(usage.outputTokens ?? usage.output_tokens),
    cachedReadTokens: numberOrUndefined(usage.cachedReadTokens ?? usage.cached_read_tokens),
    reasoningTokens: numberOrUndefined(usage.reasoningTokens ?? usage.reasoning_tokens),
  };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && value > 0 ? value : undefined;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function optionalNonNegativeNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim();
}

function isAcpCapabilityError(error: unknown): boolean {
  const value = error as { code?: unknown; message?: unknown } | undefined;
  const code = typeof value?.code === "number" ? value.code : undefined;
  const message = typeof value?.message === "string" ? value.message.toLowerCase() : "";
  return code === -32601 || code === -32602 || /method not found|unknown method|unsupported.*(resume|session)/i.test(message);
}

function acpAttachmentPreviews(content: Record<string, any>): UserMessageAttachmentPreview[] {
  const value = content.type === "content" && content.content && typeof content.content === "object" ? content.content : content;
  const imageData = typeof value.data === "string" && value.type === "image" ? value.data : undefined;
  const uri = firstNonEmptyString(value.uri, value.resource?.uri, value.path, value.resource?.path);
  const mimeType = firstNonEmptyString(value.mimeType, value.mime_type);
  if (imageData) {
    const id = `acp-image-${createHash("sha256").update(`${mimeType ?? "image/png"}\u0000${imageData}`).digest("hex").slice(0, 24)}`;
    return [{ id, name: "会话图片", kind: "image", mimeType: mimeType ?? "image/png", size: Math.floor(imageData.length * 0.75), source: imageData, isData: true, availability: "ready" }];
  }
  if (!uri || (value.type !== "resource_link" && value.type !== "resource" && value.type !== "file" && !value.path)) return [];
  let path = uri;
  if (uri.startsWith("file://")) {
    try { path = fileURLToPath(uri); } catch { path = uri.slice("file://".length); }
  }
  const name = firstNonEmptyString(value.name, value.title, basename(path)) ?? "会话附件";
  const id = `acp-file-${createHash("sha256").update(path).digest("hex").slice(0, 24)}`;
  return [{ id, name, kind: "file", mimeType, source: path, availability: "ready" }];
}

export function normalizeRuntimeHandshake(value: Record<string, unknown>): CliRuntimeHandshake {
  const capabilities = recordValue(value.agentCapabilities) ?? recordValue(value.capabilities) ?? {};
  const meta = recordValue(value._meta) ?? {};
  const agentInfo = recordValue(value.agentInfo) ?? recordValue(value.agent) ?? {};
  const modelState = recordValue(value.modelState) ?? recordValue(meta.modelState) ?? recordValue(capabilities.modelState) ?? {};
  const rawModels = arrayValue(modelState.availableModels) ?? arrayValue(modelState.models) ?? arrayValue(value.models) ?? [];
  const rawCommands = arrayValue(value.availableCommands) ?? arrayValue(meta.availableCommands) ?? [];
  const normalizedCommands = rawCommands.flatMap((item) => {
    if (typeof item === "string" && item.trim()) return [item.trim()];
    const row = recordValue(item);
    const name = firstNonEmptyString(row?.name, row?.command);
    return name ? [name] : [];
  });
  const commandNames = new Set(normalizedCommands.map((command) => command.replace(/^\//, "").toLowerCase()));
  const feature = (...names: string[]): boolean => names.some((name) => value[name] === true || capabilities[name] === true || meta[name] === true);
  return {
    protocolVersion: typeof value.protocolVersion === "number" ? value.protocolVersion : PROTOCOL_VERSION,
    agentVersion: firstNonEmptyString(value.agentVersion, agentInfo.version, meta.agentVersion, meta.version),
    checkedAt: new Date().toISOString(),
    promptCapabilities: flattenBooleanRecord(recordValue(value.promptCapabilities) ?? recordValue(capabilities.promptCapabilities)),
    sessionCapabilities: flattenBooleanRecord(recordValue(value.sessionCapabilities) ?? recordValue(capabilities.sessionCapabilities)),
    mcpCapabilities: flattenBooleanRecord(recordValue(value.mcpCapabilities) ?? recordValue(capabilities.mcpCapabilities)),
    currentModelId: firstNonEmptyString(modelState.currentModelId, modelState.current_model_id),
    models: rawModels.flatMap((item): CliRuntimeHandshake["models"] => {
      const row = recordValue(item);
      const modelId = firstNonEmptyString(row?.modelId, row?.model_id, row?.id);
      if (!row || !modelId) return [];
      const modelMeta = recordValue(row._meta) ?? {};
      const efforts = (arrayValue(modelMeta.reasoningEfforts) ?? arrayValue(row.reasoningEfforts) ?? [])
        .flatMap((effort) => {
          const effortRow = recordValue(effort);
          const normalized = normalizeReasoningEffort(effortRow?.value ?? effort);
          return normalized ? [normalized] : [];
        });
      return [{
        modelId,
        name: firstNonEmptyString(row.name, row.label),
        ...(efforts.length ? { reasoningEfforts: [...new Set(efforts)] } : {}),
        ...normalizeImageInputCapability(modelMeta, row),
      }];
    }),
    commands: normalizedCommands,
    extensions: [...new Set([
      ...Object.keys(recordValue(capabilities._meta) ?? {}),
      ...Object.keys(meta).filter((key) => key.startsWith("x.ai/")),
      ...(commandNames.has("btw") ? ["x.ai/btw"] : []),
      ...(commandNames.has("recap") || meta.sessionRecap === true ? ["x.ai/recap"] : []),
    ])].sort(),
    features: {
      recap: feature("sessionRecap", "recap"),
      rewind: feature("rewind", "sessionRewind"),
      cancelRewind: feature("cancelRewind"),
      pluginDirectories: feature("pluginDirs", "pluginDirectories", "x.ai/pluginDirs") || Array.isArray(meta.pluginDirs),
      fsNotifications: feature("fsNotify", "fs_notify") || Boolean(recordValue(capabilities._meta)?.["x.ai/fs_notify"]),
      voiceMode: feature("voiceMode"),
    },
  };
}

function recordValue(value: unknown): Record<string, any> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : undefined;
}

function normalizeImageInputCapability(
  primary: Record<string, unknown> | undefined,
  secondary?: Record<string, unknown>,
): Pick<ModelInfo, "acceptsImages" | "inputModalities"> {
  const rawModalities = arrayValue(primary?.inputModalities)
    ?? arrayValue(primary?.input_modalities)
    ?? arrayValue(secondary?.inputModalities)
    ?? arrayValue(secondary?.input_modalities);
  const inputModalities = rawModalities
    ?.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .map((value) => value.trim().toLowerCase());
  const explicit = primary?.acceptsImages ?? primary?.accepts_images
    ?? secondary?.acceptsImages ?? secondary?.accepts_images;
  const acceptsImages = typeof explicit === "boolean"
    ? explicit
    : inputModalities?.length
      ? inputModalities.includes("image")
      : undefined;
  return {
    ...(acceptsImages !== undefined ? { acceptsImages } : {}),
    ...(inputModalities?.length ? { inputModalities: [...new Set(inputModalities)] } : {}),
  };
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function normalizeRegisteredToolNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => {
    if (typeof item === "string") return [item.trim().toLowerCase()];
    const row = recordValue(item);
    const name = firstNonEmptyString(row?.name, row?.toolName, row?.tool_name, row?.id);
    return name ? [name.trim().toLowerCase()] : [];
  }).filter(Boolean))];
}

function flattenBooleanRecord(value: Record<string, any> | undefined, prefix = ""): Record<string, boolean> | undefined {
  if (!value) return undefined;
  const output: Record<string, boolean> = {};
  for (const [key, item] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (typeof item === "boolean") output[name] = item;
    else if (recordValue(item)) {
      // ACP uses an empty object to advertise marker capabilities such as
      // session.list. Preserve the parent as supported, then retain any
      // nested boolean detail without treating a missing key as support.
      output[name] = true;
      Object.assign(output, flattenBooleanRecord(item, name));
    }
  }
  return Object.keys(output).length ? output : undefined;
}

function normalizePrivateUpdateName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s.-]+/g, "_")
    .toLowerCase();
}

/**
 * Grok Build has emitted the read-only hint in more than one shape while the
 * 1.x tool metadata contract was settling.  Treat it as display/audit
 * evidence only and never infer it from the tool name.
 */
export function normalizeToolReadOnly(value: Record<string, any>): boolean | undefined {
  const meta = recordValue(value._meta) ?? recordValue(value.meta);
  const toolMeta = recordValue(meta?.["x.ai/tool"])
    ?? recordValue(meta?.tool)
    ?? recordValue(value.tool);
  for (const candidate of [
    value.readOnly,
    value.read_only,
    meta?.readOnly,
    meta?.read_only,
    toolMeta?.readOnly,
    toolMeta?.read_only,
  ]) {
    if (typeof candidate === "boolean") return candidate;
  }
  return undefined;
}

function wireSchemaVersion(value: Record<string, any>): string {
  const meta = recordValue(value._meta);
  for (const candidate of [value.schemaVersion, value.schema_version, meta?.schemaVersion, meta?.schema_version]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
  }
  return "unknown";
}

function wireSize(value: unknown): number {
  try { return Buffer.byteLength(JSON.stringify(value), "utf8"); } catch { return -1; }
}

function formatRetryStatus(attempt?: number, maxAttempts?: number, delayMs?: number, reason?: string): string {
  const count = attempt ? `第 ${attempt}${maxAttempts ? `/${maxAttempts}` : ""} 次` : "";
  const wait = delayMs !== undefined ? `${Math.max(0, Math.round(delayMs / 1000))} 秒后` : "";
  return ["上游请求正在重试", count, wait, reason].filter(Boolean).join(" · ");
}

/** Recovers an upstream HTTP status from the error text or JSON-RPC data payload. */
function httpStatusFromFailure(message: string, data: unknown): number | undefined {
  let normalized = data;
  if (typeof data === "string") {
    try { normalized = JSON.parse(data); } catch { /* fall through to text parsing */ }
  }
  const fromData = normalized as { status?: unknown; httpStatus?: unknown; http_status?: unknown } | undefined;
  for (const candidate of [fromData?.status, fromData?.httpStatus, fromData?.http_status]) {
    if (typeof candidate === "number" && candidate >= 100 && candidate < 600) return candidate;
  }
  const match = /\bHTTP\s+(\d{3})\b/i.exec(message) ?? /"code"\s*:\s*(\d{3})\b/.exec(message);
  const parsed = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 100 && parsed < 600 ? parsed : undefined;
}

/** Prefer actionable bounded JSON-RPC data over Grok Build's generic wrapper. */
function jsonRpcErrorMessage(error: { message?: string; data?: unknown }): string {
  const wrapper = typeof error.message === "string" ? error.message.trim() : "";
  if (wrapper && !/^(?:internal error|acp 请求失败)$/i.test(wrapper)) return wrapper.slice(0, 8_000);
  let data = error.data;
  if (typeof data === "string") {
    const text = data.trim();
    try { data = JSON.parse(text); } catch { return text.slice(0, 8_000) || wrapper || "ACP 请求失败"; }
  }
  const row = recordValue(data);
  const nestedError = recordValue(row?.error);
  const detail = firstNonEmptyString(row?.message, nestedError?.message, row?.detail, row?.error_description);
  return (detail || wrapper || "ACP 请求失败").slice(0, 8_000);
}

function hasUsage(value: PromptMeta): boolean {
  return [value.totalTokens, value.inputTokens, value.outputTokens, value.cachedReadTokens, value.reasoningTokens].some((item) => item !== undefined);
}

async function readPersistedPromptMeta(cwd: string, sessionId: string): Promise<PromptMeta | undefined> {
  const root = await resolvePersistedWorkspace(cwd);
  try {
    const signals = JSON.parse(await readFile(join(root, sessionId, "signals.json"), "utf8")) as {
      contextTokensUsed?: number;
      primaryModelId?: string;
    };
    return {
      totalTokens: numberOrUndefined(signals.contextTokensUsed),
      modelId: typeof signals.primaryModelId === "string" ? signals.primaryModelId : undefined,
    };
  } catch {
    return undefined;
  }
}

async function readPersistedEffort(cwd: string, sessionId: string): Promise<ReasoningEffort | undefined> {
  const root = await resolvePersistedWorkspace(cwd);
  try {
    const summary = JSON.parse(await readFile(join(root, sessionId, "summary.json"), "utf8")) as { reasoning_effort?: unknown };
    return normalizeReasoningEffort(summary.reasoning_effort);
  } catch {
    return undefined;
  }
}

export async function resolveSessionPlanFile(cwd: string, sessionId: string, grokHome = join(homedir(), ".grok")): Promise<string> {
  return join(await resolvePersistedWorkspace(cwd, join(grokHome, "sessions")), sessionId, "plan.md");
}

async function resolveAcpWorkspaceWritePath(cwd: string, requestedPath: string): Promise<string> {
  try {
    const resolved = await resolveExistingWorkspacePath(cwd, requestedPath, false);
    await rejectSymbolicLink(resolved.path);
    return resolved.path;
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "文件或目录不存在") throw error;
    return (await resolveNewWorkspacePath(cwd, requestedPath)).path;
  }
}

async function resolvePersistedWorkspace(cwd: string, sessionsRoot = join(homedir(), ".grok", "sessions")): Promise<string> {
  const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const wanted = cwd.toLocaleLowerCase();
  const workspace = entries.find((entry) => {
    if (!entry.isDirectory()) return false;
    try { return decodeURIComponent(entry.name).toLocaleLowerCase() === wanted; } catch { return false; }
  });
  return workspace ? join(sessionsRoot, workspace.name) : join(sessionsRoot, encodeURIComponent(cwd));
}

export function resolveModelId(id: string | undefined, models: ModelInfo[], preferredId?: string): string | undefined {
  if (!id) return id;
  if (preferredId && models.some((model) => model.modelId === preferredId) && modelIdsAlias(id, preferredId)) return preferredId;
  if (models.some((model) => model.modelId === id)) return id;
  return models.filter((model) => id.startsWith(model.modelId) || model.modelId.startsWith(id)).sort((a, b) => b.modelId.length - a.modelId.length)[0]?.modelId ?? id;
}

function modelIdsAlias(left: string, right: string): boolean {
  if (!left || !right) return false;
  return left === right
    || left.endsWith(`-${right}`)
    || right.endsWith(`-${left}`);
}

function windowsBatchCommand(executable: string, args: string[]): string {
  const values = [executable, ...args];
  if (values.some((value) => /[\r\n"&|<>^%!]/.test(value))) {
    throw new Error("批处理 CLI 路径或参数包含不安全的 cmd.exe 元字符");
  }
  const quote = (value: string): string => `"${value}"`;
  // `call` avoids cmd.exe's special first/last-quote stripping when the batch
  // path itself is quoted. It also waits for the batch file to return.
  return `call ${values.map(quote).join(" ")}`;
}
