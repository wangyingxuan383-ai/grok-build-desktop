import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { methods as acpMethods, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { createInterface, type Interface } from "node:readline";
import { dirname, extname, join } from "node:path";
import {
  REASONING_EFFORTS,
  type Attachment,
  type ChatEvent,
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
import { isPlanSafeToolCall, shouldBlockCommand, shouldBlockWrite } from "./plan-gate";
import { TerminalService, type TerminalCreateParams } from "./terminal-service";
import type { LogService } from "./log-service";

type JsonRpcId = string | number;
// Interactive turns intentionally have no Desktop wall-clock ceiling. Users
// retain explicit Stop/cancel controls, while Provider idle timeouts continue
// to detect a genuinely silent upstream connection.
export const INTERACTIVE_PROMPT_TIMEOUT_MS: null = null;

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error & { data?: unknown }): void;
  timer?: NodeJS.Timeout;
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
}

interface AdapterOptions extends SessionProcessOptions {
  cliPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  effort: ReasoningEffort;
  modelId?: string;
  mode: SessionMode;
  log: LogService;
  sessionMcpServers?: unknown[];
  pluginDirs?: string[];
  extensionLeaseId?: string;
  effortFlag?: "--effort" | "--reasoning-effort";
  permissionDecider?: (toolCall: unknown) => Promise<boolean | undefined>;
  providerScopeId?: string;
}

export interface UserPromptPresentation {
  clientMessageId?: string;
  attachments?: UserMessageAttachmentPreview[];
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

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".m4v"]);
const MEDIA_PATH = /(?:\\\\\?\\)?(?:[A-Za-z]:[\\/]|\/|\\\\)[^\r\n"'<>|?*]*?\.(?:png|jpe?g|gif|webp|bmp|svg|mp4|mov|webm|m4v)(?=$|[\s.,;:)"'\]])/gi;

export class LiveEffortUnsupportedError extends Error {
  override readonly name = "LiveEffortUnsupportedError";
}

export function buildGrokAgentArgs(effort: ReasoningEffort, pluginDirs: string[] = [], effortFlag: "--effort" | "--reasoning-effort" = "--reasoning-effort", options: SessionProcessOptions & { modelId?: string } = {}): string[] {
  return [
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
  private readonly backgroundTasks = new Map<string, BackgroundTask>();
  private promptQueue: PromptQueueEntry[] = [];
  private activeQueuedPromptId?: string;
  private pendingQueuedTurn?: PromptQueueEntry;
  private pendingEffortChange?: PendingEffortChange;
  private pendingPlanRequest?: JsonRpcId;
  private readonly pendingPermissionRequests = new Set<string>();
  private readonly pendingQuestionRequests = new Set<string>();
  private readonly resolvedPlanRequests = new Map<string, PlanDecisionReceipt>();
  private activeTurn?: TurnPresentation & { monotonicStartedAt: number };
  private nextTurnOrdinal = 0;
  private cancelRequested = false;
  private providerThinking: ProviderThinkingDemuxState = { pending: "", thought: false };
  private closedEmitted = false;
  private disposed = false;
  private currentEffort: ReasoningEffort;
  private requestedModelId = "";
  sessionId = "";
  models: ModelInfo[] = [];
  commands: CommandInfo[] = [];
  currentModelId = "";
  mode: SessionMode;
  planActive = false;
  autoApprove = false;
  lastTouched = Date.now();
  working = false;
  needsUser = false;
  readonly extensionLeaseId?: string;

  get cwd(): string { return this.options.cwd; }
  get effort(): ReasoningEffort { return this.currentEffort; }
  get processOptions(): SessionProcessOptions { return { agentProfilePath: this.options.agentProfilePath, sessionMeta: this.options.sessionMeta ? structuredClone(this.options.sessionMeta) : undefined, alwaysApprove: this.options.alwaysApprove }; }
  queuedPrompts(): PromptQueueEntry[] { return this.promptQueue.map((entry) => ({ ...entry })); }
  get activeTurnId(): string | undefined { return this.activeTurn?.turnId; }
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

  constructor(private readonly options: AdapterOptions) {
    super();
    this.currentEffort = options.effort;
    this.requestedModelId = options.modelId ?? "";
    this.terminal = new TerminalService(options.env);
    this.mode = options.mode;
    this.planActive = options.mode === "plan";
    this.autoApprove = options.mode === "auto";
    this.extensionLeaseId = options.extensionLeaseId;
  }

  async start(resumeSessionId?: string): Promise<{ sessionId: string }> {
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
      this.working = false;
      this.needsUser = false;
      this.finishTurn(this.cancelRequested ? "cancelled" : "failed");
      if (!this.disposed) {
        const message = `Grok 进程已退出（代码 ${String(code)}）`;
        this.emitEvent({ type: "error", sessionId: this.sessionId || undefined, message, failure: this.buildFailure(message, { processExitCode: code ?? undefined, cancelled: this.cancelRequested }) });
      }
      this.failAll(new Error(`Grok process exited (${String(code)})`));
      this.emitClosed();
    });

    await this.request(acpMethods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    }, 120_000);
    if (resumeSessionId) this.sessionId = resumeSessionId;
    const response = await this.request(resumeSessionId ? acpMethods.agent.session.load : acpMethods.agent.session.new, {
      ...(resumeSessionId ? { sessionId: resumeSessionId } : {}),
      cwd: this.options.cwd,
      mcpServers: this.options.sessionMcpServers ?? [],
      ...((this.options.pluginDirs?.length || this.options.sessionMeta) ? { _meta: { ...(this.options.sessionMeta ?? {}), ...(this.options.pluginDirs?.length ? { pluginDirs: this.options.pluginDirs } : {}) } } : {}),
    }, 120_000) as SessionResponse;
    this.sessionId = response.sessionId || resumeSessionId || "";
    this.models = (response.models?.availableModels ?? []).map((model) => {
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
        supportsReasoningEffort: model._meta?.supportsReasoningEffort === true && reasoningEfforts.length > 0,
        reasoningEfforts,
      };
    });
    const reportedModelId = response.models?.currentModelId;
    this.currentModelId = resolveModelId(reportedModelId, this.models, this.requestedModelId) || "";
    if (resumeSessionId) this.currentEffort = await readPersistedEffort(this.options.cwd, this.sessionId) ?? this.currentEffort;
    // Persisted sessions store the upstream route id, not the local provider
    // configuration id. Compare the raw ACP value here so resuming a custom
    // model really reapplies its route instead of silently using the official
    // model while the renderer still shows the provider-prefixed alias.
    if (this.options.modelId && this.options.modelId !== reportedModelId) await this.setModel(this.options.modelId);
    await this.applyMode(this.mode, false);
    this.emitEvent({
      type: "session-ready",
      sessionId: this.sessionId,
      models: this.models,
      currentModelId: this.currentModelId,
      effort: this.effort,
      modes: response.modes?.availableModes,
    });
    // Some CLIs publish available commands while session/new is still in
    // flight, before the response assigns sessionId. Re-emit the snapshot with
    // the final id so the renderer does not lose slash/media capabilities.
    if (this.commands.length) this.emitEvent({ type: "commands", sessionId: this.sessionId, commands: this.commands });
    if (resumeSessionId) {
      const persistedMeta = await readPersistedPromptMeta(this.options.cwd, this.sessionId);
      if (persistedMeta) this.emitEvent({ type: "meta", sessionId: this.sessionId, meta: persistedMeta });
    }
    this.emitStatus("idle", "已连接");
    return { sessionId: this.sessionId };
  }

  async extension(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (!this.sessionId) throw new Error("会话尚未就绪");
    return this.request(method, { sessionId: this.sessionId, ...params }) as Promise<Record<string, unknown>>;
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
        { sessionId: this.sessionId, prompt },
        timeoutMs,
        () => this.emitEvent({ type: "user-message-status", sessionId: this.sessionId, clientMessageId, delivery: "sent" }),
      ) as { _meta?: Record<string, unknown> };
      const meta = extractPromptMeta(result);
      this.emitEvent({ type: "meta", sessionId: this.sessionId, meta });
      this.finishTurn("completed", hasUsage(meta) ? { ...meta, modelId: meta.modelId ?? this.currentModelId, source: "prompt-result", exact: true } : undefined, startedTurn.turnId);
      this.activatePendingQueuedTurn();
      this.working = Boolean(this.activeTurn);
      this.needsUser = false;
      this.emitStatus(this.activeTurn ? "working" : "idle", this.activeTurn ? "正在处理已提交的跟进消息…" : "已完成");
    } catch (error) {
      this.working = false;
      this.needsUser = false;
      this.emitEvent({ type: "user-message-status", sessionId: this.sessionId, clientMessageId, delivery: "failed" });
      const failureMessage = error instanceof Error ? error.message : String(error);
      this.emitEvent({ type: "error", sessionId: this.sessionId, message: failureMessage, failure: this.buildFailure(failureMessage, { error }) });
      this.finishTurn(this.cancelRequested ? "cancelled" : "failed", undefined, startedTurn.turnId);
      this.activatePendingQueuedTurn();
      // The structured error event above owns the visible card. A text-bearing
      // status event would append a second unstructured "Internal error" card.
      this.working = Boolean(this.activeTurn);
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
    this.promptQueue = sendNow ? [entry, ...this.promptQueue] : [...this.promptQueue, entry];
    this.emitEvent({ type: "prompt-queue", sessionId: this.sessionId, entries: this.promptQueue });
    // A queued ACP prompt request is intentionally answered only after that
    // prompt eventually runs. Do not keep the Renderer composer blocked while
    // it waits; x.ai/queue/changed remains the authoritative visible state.
    void this.request(acpMethods.agent.session.prompt, {
      sessionId: this.sessionId,
      prompt,
      _meta: { promptId: id, sendNow, clientIdentifier: "grok-build-desktop" },
    }, INTERACTIVE_PROMPT_TIMEOUT_MS).catch((error) => {
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
    // Keep the submitted interjection visible until the CLI reports it as the
    // running prompt. It is already accepted at this point and must never be
    // presented with a misleading removable "x" action.
    this.promptQueue = [entry, ...this.promptQueue].map((value, position) => ({ ...value, position }));
    this.emitEvent({ type: "prompt-queue", sessionId: this.sessionId, entries: this.promptQueue });
    try {
      unwrapExtResult(await this.extension("x.ai/interject", { text, interjectionId: id, content }));
      return { operationId: crypto.randomUUID(), entryId: id, state: "interjected", message: "插话已提交；它会在当前步骤收束后作为同一会话的下一回合执行，已提交后不能撤回" };
    } catch (error) {
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
    this.queueNotification("x.ai/queue/edit", { id, newText: text });
    this.promptQueue = this.promptQueue.map((value) => value.id === id ? { ...value, text } : value);
    this.emitEvent({ type: "prompt-queue", sessionId: this.sessionId, entries: this.promptQueue });
    return { operationId: crypto.randomUUID(), entryId: id, state: "updated", message: "编辑已提交，等待 CLI 确认" };
  }
  async removeQueuedPrompt(id: string): Promise<QueueOperationReceipt> {
    const entry = this.promptQueue.find((value) => value.id === id);
    if (!entry || entry.state !== "queued") throw new Error("仅等待中的队列消息可以删除");
    this.queueNotification("x.ai/queue/remove", { id, expectedVersion: entry?.version ?? 0 });
    this.promptQueue = this.promptQueue.filter((value) => value.id !== id).map((value, position) => ({ ...value, position }));
    this.emitEvent({ type: "prompt-queue", sessionId: this.sessionId, entries: this.promptQueue });
    return { operationId: crypto.randomUUID(), entryId: id, state: "removed", message: "队列消息已移除" };
  }
  async reorderQueuedPrompt(id: string, position: number): Promise<QueueOperationReceipt> {
    const ordered = [...this.promptQueue].sort((a, b) => a.position - b.position);
    const current = ordered.findIndex((value) => value.id === id);
    if (current < 0) throw new Error("排队消息已不存在，请等待队列刷新");
    if (ordered[current]?.state !== "queued") throw new Error("已提交或发送中的消息不能重新排序");
    const [moved] = ordered.splice(current, 1);
    ordered.splice(Math.max(0, Math.min(position, ordered.length)), 0, moved!);
    this.queueNotification("x.ai/queue/reorder", { orderedIds: ordered.map((value) => value.id) });
    this.promptQueue = ordered.map((value, nextPosition) => ({ ...value, position: nextPosition }));
    this.emitEvent({ type: "prompt-queue", sessionId: this.sessionId, entries: this.promptQueue });
    return { operationId: crypto.randomUUID(), entryId: id, state: "reordered", message: "队列顺序已更新" };
  }
  async clearPromptQueue(): Promise<QueueOperationReceipt> {
    const removable = this.promptQueue.filter((entry) => entry.state === "queued");
    for (const entry of removable) this.queueNotification("x.ai/queue/remove", { id: entry.id, expectedVersion: entry.version ?? 0 });
    this.promptQueue = this.promptQueue.filter((entry) => entry.state !== "queued").map((value, position) => ({ ...value, position }));
    this.emitEvent({ type: "prompt-queue", sessionId: this.sessionId, entries: this.promptQueue });
    return {
      operationId: crypto.randomUUID(),
      state: "cleared",
      message: removable.length ? `已撤回 ${removable.length} 条尚未提交的队列消息` : "没有可撤回的等待消息；已提交的插话不能撤回",
    };
  }
  async interjectQueuedPrompt(id: string, text?: string): Promise<QueueOperationReceipt> {
    const entry = this.promptQueue.find((value) => value.id === id);
    if (!entry || entry.state !== "queued") throw new Error("该消息已不在等待队列中");
    this.queueNotification("x.ai/queue/interject", { id, expectedVersion: entry?.version ?? 0, ...(text?.trim() ? { newText: text.trim() } : {}) });
    this.promptQueue = this.promptQueue.map((value) => value.id === id ? { ...value, state: "interjected", ...(text?.trim() ? { text: text.trim() } : {}) } : value);
    this.emitEvent({ type: "prompt-queue", sessionId: this.sessionId, entries: this.promptQueue });
    return { operationId: crypto.randomUUID(), entryId: id, state: "interjected", message: "插话请求已提交；若 CLI 不支持即时插话，将按队首消息处理" };
  }
  async fork(targetPromptIndex?: string, newCwd = this.cwd): Promise<Record<string, unknown>> {
    const parsed = targetPromptIndex === undefined ? undefined : Number.parseInt(targetPromptIndex, 10);
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
  async rewind(pointId: string, mode: "conversation" | "conversation-and-files" | "files"): Promise<void> {
    const targetPromptIndex = Number.parseInt(pointId, 10);
    if (!Number.isInteger(targetPromptIndex) || targetPromptIndex < 0) throw new Error("CLI 返回的回退点无效");
    const wireMode = mode === "conversation" ? "conversation_only" : mode === "files" ? "files_only" : "all";
    await this.extension("x.ai/rewind/execute", { targetPromptIndex, force: false, mode: wireMode });
  }
  async taskList(): Promise<Record<string, unknown>> {
    return unwrapExtResult(await this.extension("x.ai/task/list"));
  }
  async subagentListRunning(): Promise<Record<string, unknown>> {
    return unwrapExtResult(await this.extension("x.ai/subagent/list_running"));
  }
  async taskKill(taskId: string): Promise<void> {
    const response = unwrapExtResult(await this.extension("x.ai/task/kill", { taskId }));
    if (response.success === false) throw new Error(String(response.error ?? "后台任务停止失败"));
  }
  async subagentCancel(subagentId: string): Promise<void> {
    const response = unwrapExtResult(await this.extension("x.ai/subagent/cancel", { subagentId }));
    if (response.cancelled === false && !response.outcome) throw new Error("子 Agent 已结束或不存在");
  }

  cancel(): void {
    if (!this.sessionId) return;
    this.cancelRequested = true;
    this.write({ jsonrpc: "2.0", method: acpMethods.agent.session.cancel, params: { sessionId: this.sessionId } });
    this.needsUser = false;
    this.emitStatus("working", "正在停止…");
  }

  async setModel(modelId: string): Promise<void> {
    const previousRequestedModelId = this.requestedModelId;
    this.requestedModelId = modelId;
    try {
      const result = await this.request("session/set_model", { sessionId: this.sessionId, modelId }) as { _meta?: { model?: { Ok?: string } } };
      this.currentModelId = resolveModelId(result._meta?.model?.Ok || modelId, this.models, this.requestedModelId) || modelId;
      this.emitEvent({ type: "session-ready", sessionId: this.sessionId, models: this.models, currentModelId: this.currentModelId, effort: this.effort });
    } catch (error) {
      this.requestedModelId = previousRequestedModelId;
      throw error;
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
    this.mode = mode;
    this.autoApprove = mode === "auto";
    this.planActive = mode === "plan";
    if (this.sessionId) await this.request(acpMethods.agent.session.setMode, { sessionId: this.sessionId, modeId: mode === "plan" ? "plan" : "default" }).catch(() => undefined);
    if (persist) this.emitEvent({ type: "mode", sessionId: this.sessionId, mode });
  }

  respondPermission(requestId: JsonRpcId, optionId: string): void {
    const key = String(requestId);
    if (!this.pendingPermissionRequests.has(key)) throw new Error("权限请求已经结束或已被响应");
    if (!this.write({ jsonrpc: "2.0", id: requestId, result: { outcome: { outcome: "selected", optionId } } })) {
      throw new Error("Grok 进程不可用，权限决定未提交");
    }
    this.pendingPermissionRequests.delete(key);
    this.needsUser = false;
    this.emitEvent({ type: "interaction-resolved", sessionId: this.sessionId, interaction: "permission", requestId, outcome: optionId });
    this.emitStatus(this.working ? "working" : "idle");
  }

  respondQuestion(requestId: JsonRpcId, answers: Record<string, string>): void {
    const key = String(requestId);
    if (!this.pendingQuestionRequests.has(key)) throw new Error("问题请求已经结束或已被回答");
    if (!this.write({ jsonrpc: "2.0", id: requestId, result: { outcome: "accepted", answers, annotations: {} } })) {
      throw new Error("Grok 进程不可用，回答未提交");
    }
    this.pendingQuestionRequests.delete(key);
    this.needsUser = false;
    this.emitEvent({ type: "interaction-resolved", sessionId: this.sessionId, interaction: "question", requestId, outcome: "answered" });
    this.emitStatus(this.working ? "working" : "idle");
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
    if (verdict === "approved") {
      if (!this.write({ jsonrpc: "2.0", id, result: { outcome: "approved", ...(normalizedComment ? { comment: normalizedComment, annotations: { comment: normalizedComment } } : {}) } })) {
        this.resolvedPlanRequests.delete(key);
        throw new Error("Grok 进程不可用，计划决策未提交");
      }
    } else {
      const message = verdict === "rejected" ? "User rejected the plan" : "User abandoned the plan";
      if (!this.write({ jsonrpc: "2.0", id, error: { code: -32000, message, ...(normalizedComment ? { data: { comment: normalizedComment } } : {}) } })) {
        this.resolvedPlanRequests.delete(key);
        throw new Error("Grok 进程不可用，计划决策未提交");
      }
    }
    this.pendingPlanRequest = undefined;
    this.needsUser = false;
    this.emitEvent({ type: "interaction-resolved", sessionId: this.sessionId, interaction: "plan", requestId: id, outcome: verdict });
    if (verdict === "approved") {
      await this.applyMode("agent");
    } else if (verdict === "cancelled") {
      await this.applyMode("agent");
    }
    this.emitStatus(this.working ? "working" : "idle", receipt.message);
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
    this.finishEffortChange(false);
    this.lines?.close();
    await this.terminal.disposeAll();
    const child = this.process;
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
        // string and no way to tell one failure class from another.
        const error = Object.assign(new Error(errorObject.message || "ACP 请求失败"), { code: errorObject.code, data: errorObject.data });
        pending.reject(error);
      } else pending.resolve(message.result);
      return;
    }
    const method = String(message.method || "");
    const params = (message.params || {}) as Record<string, any>;
    if (method === acpMethods.client.session.update) {
      this.handleSessionUpdate(params.update);
      return;
    }
    await this.handleServerRequest(method, id, params);
  }

  private handleSessionUpdate(update: any): void {
    if (!update) return;
    this.lastTouched = Date.now();
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        if (update.content?.type === "text") this.emitProviderText(update.content.text || "");
        else this.emitMediaFromContent(update.content);
        break;
      }
      case "user_message_chunk":
        if (update.content?.type === "image" && typeof update.content.data === "string") {
          this.emitEvent({
            type: "user-message",
            sessionId: this.sessionId,
            text: "",
            attachments: [{
              id: crypto.randomUUID(),
              name: "会话图片",
              kind: "image",
              mimeType: typeof update.content.mimeType === "string" ? update.content.mimeType : "image/png",
              size: Math.floor(update.content.data.length * 0.75),
              source: update.content.data,
              isData: true,
              availability: "ready",
            }],
            delivery: "sent",
          });
        } else this.emitEvent({ type: "user-message", sessionId: this.sessionId, text: update.content?.text || "", delivery: "sent" });
        break;
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
        const mode = update.currentModeId === "plan" ? "plan" : this.autoApprove ? "auto" : "agent";
        this.planActive = mode === "plan";
        this.emitEvent({ type: "mode", sessionId: this.sessionId, mode });
        break;
      }
      case "available_commands_update":
        this.commands = (update.availableCommands ?? []).map((command: any) => ({ name: command.name, description: command.description, inputHint: command.input?.hint }));
        if (this.sessionId) this.emitEvent({ type: "commands", sessionId: this.sessionId, commands: this.commands });
        this.emit("commands-changed");
        break;
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
      this.currentModelId = resolved;
      if (!modelIdsAlias(modelId, this.requestedModelId)) this.requestedModelId = resolved;
    }
    const effort = normalizeReasoningEffort(update.reasoning_effort);
    if (effort !== undefined) this.currentEffort = effort;
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
    const updateType = String(update.sessionUpdate || "");
    switch (updateType) {
      case "model_changed":
        this.handleModelChanged(update);
        return;
      case "subagent_spawned":
      case "subagent_finished":
        this.emitEvent({ type: "subagent", sessionId: this.sessionId, update });
        return;
      case "turn_completed":
        {
        const terminalOutcome = normalizeTerminalTurnOutcome(update);
        const completingQueuedPromptId = this.activeQueuedPromptId;
        if (update.usage) {
          const meta = extractUsageMeta(update.usage);
          this.emitEvent({ type: "meta", sessionId: this.sessionId, meta });
          this.finishTurn(terminalOutcome, { ...meta, modelId: meta.modelId ?? this.currentModelId, source: "acp-turn", exact: true });
        } else this.finishTurn(terminalOutcome);
        if (completingQueuedPromptId) {
          if (this.activeQueuedPromptId === completingQueuedPromptId) this.activeQueuedPromptId = undefined;
          this.working = false;
          this.emitStatus(terminalOutcome === "completed" ? "idle" : "error", terminalOutcome === "cancelled" ? "已取消" : terminalOutcome === "failed" ? "执行失败" : "已完成");
        }
        this.activatePendingQueuedTurn();
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
      default:
        // Unknown lifecycle updates are acknowledged by the caller but must
        // never be presented as subagents. This is what caused stale cards.
        return;
    }
  }

  private handleTaskBackgrounded(update: Record<string, any>): void {
    const taskId = String(update.task_id || "");
    if (!taskId) return;
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
      switch (method) {
        case acpMethods.client.fs.readTextFile: {
          const content = await readFile(params.path, "utf8");
          this.respondOk(id, { content });
          return;
        }
        case acpMethods.client.fs.writeTextFile: {
          if (String(params.path).endsWith("plan.md")) this.emitEvent({ type: "plan", sessionId: this.sessionId, text: params.content || "" });
          if (shouldBlockWrite(params.path, this.options.cwd, this.planActive)) {
            this.respondError(id, -32010, "Plan 模式已阻止工作区写入");
            return;
          }
          await mkdir(dirname(params.path), { recursive: true });
          await writeFile(params.path, params.content ?? "", "utf8");
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
          const options = (params.options ?? []) as PermissionOption[];
          const decided = await this.options.permissionDecider?.(params.toolCall);
          if (decided !== undefined) {
            const option = decided ? options.find((value) => value.kind === "allow_always") ?? options.find((value) => value.kind === "allow_once") : options.find((value) => /reject|deny/i.test(value.kind || ""));
            if (option && id !== undefined) this.respondPermission(id, option.optionId);
            else { this.pendingPermissionRequests.delete(String(id)); this.respondError(id, -32602, decided ? "权限请求没有可用的允许选项" : "权限请求没有可用的拒绝选项"); }
          } else if (this.planActive && isPlanSafeToolCall(params.toolCall)) {
            // Plan is read-only, not "bypass everything". Safe inspection is
            // frictionless; mutating/unknown requests still go through the
            // normal permission UI or the explicit write/command gates above.
            const option = options.find((value) => value.kind === "allow_once") ?? options.find((value) => value.kind === "allow_always");
            if (option && id !== undefined) this.respondPermission(id, option.optionId);
            else { this.pendingPermissionRequests.delete(String(id)); this.respondError(id, -32602, "Plan 只读工具没有可用的允许选项"); }
          } else if (this.autoApprove) {
            const option = options.find((value) => value.kind === "allow_always") ?? options.find((value) => value.kind === "allow_once");
            const fallback = options.find((value) => /reject|deny/i.test(value.kind || ""));
            if (option && id !== undefined) this.respondPermission(id, option.optionId);
            else if (fallback && id !== undefined) this.respondPermission(id, fallback.optionId);
            else { this.pendingPermissionRequests.delete(String(id)); this.respondError(id, -32602, "权限请求没有可用选项"); }
          } else {
            this.needsUser = true;
            this.emitStatus("needs-user", "等待权限确认");
            this.emitEvent({ type: "permission", sessionId: this.sessionId, request: { requestId: id ?? "", sessionId: this.sessionId, toolCall: params.toolCall, options } });
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
          this.handleModelChanged(params.update ?? params);
          this.respondOk(id);
          return;
        }
        case "x.ai/queue/changed":
        case "_x.ai/queue/changed": {
          const previous = this.promptQueue;
          const runningPromptId = typeof params.runningPromptId === "string" ? params.runningPromptId : typeof params.running_prompt_id === "string" ? params.running_prompt_id : undefined;
          if (runningPromptId && runningPromptId !== this.activeQueuedPromptId && runningPromptId !== this.pendingQueuedTurn?.id) {
            const starting = previous.find((entry) => entry.id === runningPromptId);
            if (starting) {
              if (this.activeTurn) this.pendingQueuedTurn = starting;
              else this.startQueuedTurn(starting);
            }
          }
          this.promptQueue = normalizePromptQueue(params.queue ?? params.entries ?? params.update?.queue ?? [], this.sessionId, previous);
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
        default:
          await this.options.log.log(`[ACP unknown request] ${method}`);
          this.respondError(id, -32601, `Unsupported ACP method: ${method}`);
      }
    } catch (error) {
      await this.options.log.log(`[ACP handler error] ${method}: ${error instanceof Error ? error.message : String(error)}`);
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
    const { monotonicStartedAt: _ignored, ...publicPresentation } = presentation;
    this.emitEvent({ type: "turn-started", sessionId: this.sessionId, presentation: publicPresentation });
    return publicPresentation;
  }

  private finishTurn(outcome: TurnOutcome, usage?: TurnPresentation["usage"], expectedTurnId?: string): TurnPresentation | undefined {
    const active = this.activeTurn;
    if (!active || (expectedTurnId && active.turnId !== expectedTurnId)) return undefined;
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
    this.emitEvent({ type: "turn-completed", sessionId: this.sessionId, presentation });
    return presentation;
  }

  private startQueuedTurn(entry: PromptQueueEntry): void {
    this.pendingQueuedTurn = undefined;
    this.activeQueuedPromptId = entry.id;
    this.working = true;
    this.beginTurn(entry.clientMessageId);
    // The prompt was already persisted by the CLI when it entered the queue.
    // Emit it only after its own turn boundary exists so it cannot be grouped
    // under the previous final answer.
    this.emitEvent({ type: "user-message", sessionId: this.sessionId, id: entry.clientMessageId, clientMessageId: entry.clientMessageId, text: entry.text, attachments: entry.attachmentPreviews, delivery: "sent" });
    this.emitStatus("working", entry.state === "interjected" ? "正在处理已提交的跟进消息…" : "正在处理队列消息…");
  }

  private activatePendingQueuedTurn(): void {
    const pending = this.pendingQueuedTurn;
    if (pending && !this.activeTurn) this.startQueuedTurn(pending);
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

  private request(method: string, params: unknown, timeoutMs: number | null = 120_000, onWritten?: () => void): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs === null ? undefined : setTimeout(() => {
        this.pending.delete(id);
        if (method === acpMethods.agent.session.prompt) this.cancel();
        reject(new Error(`ACP 请求超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      if (!this.write({ jsonrpc: "2.0", id, method, params })) {
        if (timer) clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(`Grok 进程不可用：${method}`));
      } else onWritten?.();
    });
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
    this.emit("event", event);
  }

  private emitStatus(status: "idle" | "working" | "needs-user" | "error", text?: string): void {
    if (this.sessionId) this.emitEvent({ type: "status", sessionId: this.sessionId, status, text });
  }

  private emitMediaFromContent(content: any): void {
    if (!content) return;
    if (content.type === "image" && typeof content.data === "string") {
      this.emitEvent({ type: "media", sessionId: this.sessionId, media: "image", source: content.data, isData: true, mimeType: content.mimeType || "image/png" });
    }
    const uri = content.uri || content.resource?.uri;
    if (typeof uri === "string") {
      const path = uri.replace(/^file:\/\//, "");
      const kind = mediaKind(path);
      if (kind) this.emitEvent({ type: "media", sessionId: this.sessionId, media: kind, source: path });
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
    totalTokens: numberOrUndefined(usage.totalTokens),
    inputTokens: numberOrUndefined(usage.inputTokens),
    outputTokens: numberOrUndefined(usage.outputTokens),
    cachedReadTokens: numberOrUndefined(usage.cachedReadTokens),
    reasoningTokens: numberOrUndefined(usage.reasoningTokens),
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

async function resolvePersistedWorkspace(cwd: string): Promise<string> {
  const sessionsRoot = join(homedir(), ".grok", "sessions");
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
