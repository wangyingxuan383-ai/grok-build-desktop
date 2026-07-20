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
  type PromptMeta,
  type PromptQueueEntry,
  type RewindPoint,
  type ReasoningEffort,
  type SessionMode,
  type ToolCallState,
} from "../../shared/types";
import { shouldBlockCommand, shouldBlockWrite } from "./plan-gate";
import { TerminalService, type TerminalCreateParams } from "./terminal-service";
import type { LogService } from "./log-service";

type JsonRpcId = string | number;
interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error & { data?: unknown }): void;
  timer: NodeJS.Timeout;
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

interface AdapterOptions {
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
}

interface SessionResponse {
  sessionId: string;
  models?: {
    currentModelId?: string;
    availableModels?: Array<{ modelId: string; name: string; description?: string; _meta?: { totalContextTokens?: number } }>;
  };
  modes?: { currentModeId?: string; availableModes?: unknown[] };
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".m4v"]);
const MEDIA_PATH = /(?:\\\\\?\\)?(?:[A-Za-z]:[\\/]|\/|\\\\)[^\r\n"'<>|?*]*?\.(?:png|jpe?g|gif|webp|bmp|svg|mp4|mov|webm|m4v)(?=$|[\s.,;:)"'\]])/gi;

export class LiveEffortUnsupportedError extends Error {
  override readonly name = "LiveEffortUnsupportedError";
}

export function buildGrokAgentArgs(effort: ReasoningEffort, pluginDirs: string[] = [], effortFlag: "--effort" | "--reasoning-effort" = "--reasoning-effort"): string[] {
  return ["agent", ...(effort ? [effortFlag, effort] : []), ...pluginDirs.flatMap((path) => ["--plugin-dir", path]), "stdio"];
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
  private pendingEffortChange?: PendingEffortChange;
  private pendingPlanRequest?: JsonRpcId;
  private disposed = false;
  private currentEffort: ReasoningEffort;
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
  queuedPrompts(): PromptQueueEntry[] { return this.promptQueue.map((entry) => ({ ...entry })); }

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
    this.terminal = new TerminalService(options.env);
    this.mode = options.mode;
    this.planActive = options.mode === "plan";
    this.autoApprove = options.mode === "auto";
    this.extensionLeaseId = options.extensionLeaseId;
  }

  async start(resumeSessionId?: string): Promise<{ sessionId: string }> {
    const args = buildGrokAgentArgs(this.options.effort, this.options.pluginDirs, this.options.effortFlag);
    await this.options.log.log(`spawn ${this.options.cliPath} ${args.join(" ")} cwd=${this.options.cwd}`);
    const shell = process.platform === "win32" && /\.(cmd|bat)$/i.test(this.options.cliPath);
    this.process = spawn(this.options.cliPath, args, {
      cwd: this.options.cwd,
      env: this.options.env,
      shell,
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
      if (!this.disposed) this.emitEvent({ type: "error", sessionId: this.sessionId || undefined, message: `Grok 进程已退出（代码 ${String(code)}）` });
      this.failAll(new Error(`Grok process exited (${String(code)})`));
      this.emit("closed");
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
      ...(this.options.pluginDirs?.length ? { _meta: { pluginDirs: this.options.pluginDirs } } : {}),
    }, 120_000) as SessionResponse;
    this.sessionId = response.sessionId || resumeSessionId || "";
    this.models = (response.models?.availableModels ?? []).map((model) => ({
      modelId: model.modelId,
      name: model.name,
      description: model.description,
      totalContextTokens: model._meta?.totalContextTokens,
    }));
    this.currentModelId = resolveModelId(response.models?.currentModelId, this.models) || "";
    if (resumeSessionId) this.currentEffort = await readPersistedEffort(this.options.cwd, this.sessionId) ?? this.currentEffort;
    if (this.options.modelId && this.options.modelId !== this.currentModelId) await this.setModel(this.options.modelId);
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

  async prompt(text: string, attachments: Attachment[] = []): Promise<void> {
    if (!this.sessionId) throw new Error("会话尚未就绪");
    this.lastTouched = Date.now();
    this.working = true;
    this.emitEvent({ type: "user-message", sessionId: this.sessionId, text });
    this.emitStatus("working", "Grok 正在处理…");
    try {
      const prompt: unknown[] = [{ type: "text", text: buildPromptText(text, attachments) }];
      for (const attachment of attachments) {
        if (attachment.kind === "image") {
          const data = attachment.data ?? (attachment.path ? await readFile(attachment.path).then((value) => value.toString("base64")) : undefined);
          if (data) prompt.push({ type: "image", data, mimeType: attachment.mimeType || mimeForPath(attachment.path || attachment.name) });
        }
      }
      const result = await this.request(acpMethods.agent.session.prompt, { sessionId: this.sessionId, prompt }, 1_800_000) as { _meta?: Record<string, unknown> };
      const meta = extractPromptMeta(result);
      this.emitEvent({ type: "meta", sessionId: this.sessionId, meta });
      this.emitEvent({ type: "turn-completed", sessionId: this.sessionId });
      this.working = false;
      this.needsUser = false;
      this.emitStatus("idle", "已完成");
    } catch (error) {
      this.working = false;
      this.needsUser = false;
      this.emitStatus("error", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async queuePrompt(text: string, attachments: Attachment[] = [], sendNow = false): Promise<void> {
    if (!this.sessionId) throw new Error("会话尚未就绪");
    const id = crypto.randomUUID();
    const prompt = await buildPromptBlocks(text, attachments);
    const entry: PromptQueueEntry = { id, sessionId: this.sessionId, text, position: this.promptQueue.length, createdAt: new Date().toISOString(), state: sendNow ? "interjected" : "queued" };
    this.promptQueue = sendNow ? [entry, ...this.promptQueue] : [...this.promptQueue, entry];
    this.emitEvent({ type: "prompt-queue", sessionId: this.sessionId, entries: this.promptQueue });
    // A queued ACP prompt request is intentionally answered only after that
    // prompt eventually runs. Do not keep the Renderer composer blocked while
    // it waits; x.ai/queue/changed remains the authoritative visible state.
    void this.request(acpMethods.agent.session.prompt, {
      sessionId: this.sessionId,
      prompt,
      _meta: { promptId: id, sendNow, clientIdentifier: "grok-build-desktop" },
    }, 1_800_000).catch((error) => {
      this.promptQueue = this.promptQueue.filter((value) => value.id !== id);
      this.emitEvent({ type: "prompt-queue", sessionId: this.sessionId, entries: this.promptQueue });
      this.emitEvent({ type: "error", sessionId: this.sessionId, message: error instanceof Error ? error.message : String(error) });
    });
  }

  async interjectPrompt(text: string, attachments: Attachment[] = []): Promise<void> {
    if (!this.sessionId) throw new Error("会话尚未就绪");
    const id = crypto.randomUUID();
    const content = await buildPromptBlocks(text, attachments);
    try {
      unwrapExtResult(await this.extension("x.ai/interject", { text, interjectionId: id, content }));
    } catch (error) {
      // Older CLIs do not expose x.ai/interject. Their closest compatible
      // behavior is the official sendNow prompt metadata path.
      if (!isMethodNotFound(error)) throw error;
      await this.queuePrompt(text, attachments, true);
    }
  }

  async editQueuedPrompt(id: string, text: string): Promise<void> {
    this.queueNotification("x.ai/queue/edit", { id, newText: text });
  }
  async removeQueuedPrompt(id: string): Promise<void> {
    const entry = this.promptQueue.find((value) => value.id === id);
    this.queueNotification("x.ai/queue/remove", { id, expectedVersion: entry?.version ?? 0 });
  }
  async reorderQueuedPrompt(id: string, position: number): Promise<void> {
    const ordered = [...this.promptQueue].sort((a, b) => a.position - b.position);
    const current = ordered.findIndex((value) => value.id === id);
    if (current < 0) throw new Error("排队消息已不存在，请等待队列刷新");
    const [moved] = ordered.splice(current, 1);
    ordered.splice(Math.max(0, Math.min(position, ordered.length)), 0, moved!);
    this.queueNotification("x.ai/queue/reorder", { orderedIds: ordered.map((value) => value.id) });
  }
  async clearPromptQueue(): Promise<void> { this.queueNotification("x.ai/queue/clear", {}); }
  async interjectQueuedPrompt(id: string, text?: string): Promise<void> {
    const entry = this.promptQueue.find((value) => value.id === id);
    this.queueNotification("x.ai/queue/interject", { id, expectedVersion: entry?.version ?? 0, ...(text?.trim() ? { newText: text.trim() } : {}) });
  }
  async fork(targetPromptIndex?: string): Promise<Record<string, unknown>> {
    const parsed = targetPromptIndex === undefined ? undefined : Number.parseInt(targetPromptIndex, 10);
    return this.extension("x.ai/session/fork", {
      sourceSessionId: this.sessionId,
      sourceCwd: this.cwd,
      newCwd: this.cwd,
      ...(Number.isInteger(parsed) && (parsed as number) >= 0 ? { targetPromptIndex: parsed } : {}),
    });
  }
  async rewindPoints(): Promise<RewindPoint[]> { const result = await this.extension("x.ai/rewind/points"); return normalizeRewindPoints(result); }
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
    this.write({ jsonrpc: "2.0", method: acpMethods.agent.session.cancel, params: { sessionId: this.sessionId } });
    this.needsUser = false;
    this.emitStatus("working", "正在停止…");
  }

  async setModel(modelId: string): Promise<void> {
    const result = await this.request("session/set_model", { sessionId: this.sessionId, modelId }) as { _meta?: { model?: { Ok?: string } } };
    this.currentModelId = resolveModelId(result._meta?.model?.Ok || modelId, this.models) || modelId;
    this.emitEvent({ type: "session-ready", sessionId: this.sessionId, models: this.models, currentModelId: this.currentModelId, effort: this.effort });
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
    this.needsUser = false;
    this.write({ jsonrpc: "2.0", id: requestId, result: { outcome: { outcome: "selected", optionId } } });
    this.emitStatus(this.working ? "working" : "idle");
  }

  respondQuestion(requestId: JsonRpcId, answers: Record<string, string>): void {
    this.needsUser = false;
    this.write({ jsonrpc: "2.0", id: requestId, result: { outcome: "accepted", answers, annotations: {} } });
    this.emitStatus(this.working ? "working" : "idle");
  }

  async respondPlan(requestId: JsonRpcId | undefined, verdict: "approved" | "rejected" | "cancelled", comment = ""): Promise<void> {
    const id = requestId ?? this.pendingPlanRequest;
    if (id !== undefined) {
      if (verdict === "approved") this.write({ jsonrpc: "2.0", id, result: { outcome: "approved" } });
      else this.write({ jsonrpc: "2.0", id, error: { code: -32000, message: verdict === "rejected" ? "User rejected the plan" : "User abandoned the plan" } });
    }
    this.pendingPlanRequest = undefined;
    this.needsUser = false;
    if (verdict === "approved") {
      await this.applyMode("agent");
      await this.prompt(`[Plan approved]${comment ? ` ${comment}` : ""}\n现在执行该计划。`);
    } else if (verdict === "rejected") {
      await this.prompt(`[Plan rejected]${comment ? ` ${comment}` : ""}\n继续规划，不要执行。`);
    } else {
      await this.applyMode("agent");
    }
  }

  async dispose(timeoutMs = 5_000): Promise<void> {
    this.disposed = true;
    this.finishEffortChange(false);
    this.lines?.close();
    await this.terminal.disposeAll();
    const child = this.process;
    if (!child || child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
      if (process.platform === "win32" && child.pid) execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], () => undefined);
      else child.kill("SIGTERM");
    });
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
      clearTimeout(pending.timer);
      if (message.error) {
        const errorObject = message.error as { message?: string; data?: unknown };
        const error = Object.assign(new Error(errorObject.message || "ACP 请求失败"), { data: errorObject.data });
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
        if (update.content?.type === "text") this.emitEvent({ type: "message-chunk", sessionId: this.sessionId, text: update.content.text || "" });
        else this.emitMediaFromContent(update.content);
        break;
      }
      case "user_message_chunk":
        this.emitEvent({ type: "user-message", sessionId: this.sessionId, text: update.content?.text || "" });
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
    const tool: ToolCallState = {
      toolCallId,
      title: update.title || update.rawInput?.name || "工具调用",
      kind: update.kind,
      status,
      rawInput: update.rawInput,
      content: update.content,
      locations: update.locations,
      oldText: update.oldText || update.diff?.oldText,
      newText: update.newText || update.diff?.newText,
      error: update.error?.message || update.error,
    };
    if (isMediaTool(update)) this.mediaToolIds.add(toolCallId);
    if (this.mediaToolIds.has(toolCallId)) this.emitGeneratedMedia(update);
    for (const item of update.content ?? []) this.emitMediaFromContent(item?.type === "content" ? item.content : item);
    this.emitEvent({ type: "tool-call", sessionId: this.sessionId, tool });
  }

  private handleModelChanged(update: Record<string, any>): void {
    if (update.sessionUpdate !== "model_changed") return;
    const modelId = typeof update.model_id === "string" ? update.model_id : undefined;
    if (modelId) this.currentModelId = resolveModelId(modelId, this.models) || modelId;
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
        if (update.usage) this.emitEvent({ type: "meta", sessionId: this.sessionId, meta: extractUsageMeta(update.usage) });
        this.emitEvent({ type: "turn-completed", sessionId: this.sessionId });
        if (this.activeQueuedPromptId) {
          this.activeQueuedPromptId = undefined;
          this.working = false;
          this.emitStatus("idle", "已完成");
        }
        return;
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
          const options = (params.options ?? []) as PermissionOption[];
          const decided = await this.options.permissionDecider?.(params.toolCall);
          if (decided !== undefined) {
            const option = decided ? options.find((value) => value.kind === "allow_always") ?? options.find((value) => value.kind === "allow_once") : options.find((value) => /reject|deny/i.test(value.kind || ""));
            if (option && id !== undefined) this.respondPermission(id, option.optionId);
            else this.respondError(id, -32602, decided ? "权限请求没有可用的允许选项" : "权限请求没有可用的拒绝选项");
          } else if (this.autoApprove) {
            const option = options.find((value) => value.kind === "allow_always") ?? options.find((value) => value.kind === "allow_once");
            const fallback = options.find((value) => /reject|deny/i.test(value.kind || ""));
            if (option && id !== undefined) this.respondPermission(id, option.optionId);
            else if (fallback && id !== undefined) this.respondPermission(id, fallback.optionId);
            else this.respondError(id, -32602, "权限请求没有可用选项");
          } else {
            this.needsUser = true;
            this.emitStatus("needs-user", "等待权限确认");
            this.emitEvent({ type: "permission", sessionId: this.sessionId, request: { requestId: id ?? "", sessionId: this.sessionId, toolCall: params.toolCall, options } });
          }
          return;
        }
        case "x.ai/exit_plan_mode":
        case "_x.ai/exit_plan_mode":
          this.pendingPlanRequest = id;
          this.needsUser = true;
          this.emitStatus("needs-user", "等待计划确认");
          this.emitEvent({ type: "plan", sessionId: this.sessionId, requestId: id, text: params.planContent || params.plan || params.input?.plan || "" });
          return;
        case "x.ai/ask_user_question":
        case "_x.ai/ask_user_question":
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
          if (runningPromptId && runningPromptId !== this.activeQueuedPromptId) {
            const starting = previous.find((entry) => entry.id === runningPromptId);
            if (starting) {
              this.activeQueuedPromptId = runningPromptId;
              this.working = true;
              this.emitEvent({ type: "user-message", sessionId: this.sessionId, text: starting.text });
              this.emitStatus("working", "正在处理队列消息…");
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

  private request(method: string, params: unknown, timeoutMs = 120_000): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ACP 请求超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      if (!this.write({ jsonrpc: "2.0", id, method, params })) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(`Grok 进程不可用：${method}`));
      }
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
      clearTimeout(pending.timer);
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
  const paths = attachments.filter((value) => value.path).map((value) => `@${value.path}`);
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

function normalizePromptQueue(value: unknown, sessionId: string, previous: PromptQueueEntry[] = []): PromptQueueEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    const row = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    return {
      id: String(row.id ?? row.promptId ?? row.prompt_id ?? `queue-${index}`),
      sessionId,
      text: String(row.text ?? row.prompt ?? row.content ?? ""),
      position: typeof row.position === "number" ? row.position : index,
      createdAt: typeof row.createdAt === "string" ? row.createdAt : typeof row.created_at === "string" ? row.created_at : previous.find((entry) => entry.id === String(row.id ?? row.promptId ?? row.prompt_id))?.createdAt ?? new Date().toISOString(),
      state: row.sendNow || row.state === "interjected" ? "interjected" : row.state === "sending" ? "sending" : "queued",
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

function resolveModelId(id: string | undefined, models: ModelInfo[]): string | undefined {
  if (!id) return id;
  if (models.some((model) => model.modelId === id)) return id;
  return models.filter((model) => id.startsWith(model.modelId) || model.modelId.startsWith(id)).sort((a, b) => b.modelId.length - a.modelId.length)[0]?.modelId ?? id;
}
