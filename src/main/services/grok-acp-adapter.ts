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
          if (this.autoApprove) {
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

function buildPromptText(text: string, attachments: Attachment[]): string {
  const paths = attachments.filter((value) => value.path).map((value) => `@${value.path}`);
  return paths.length ? `${text}\n\n上下文文件：\n${paths.join("\n")}` : text;
}

function mimeForPath(path: string): string {
  const ext = extname(path).toLowerCase();
  return ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".gif" ? "image/gif" : ext === ".webp" ? "image/webp" : "image/png";
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
