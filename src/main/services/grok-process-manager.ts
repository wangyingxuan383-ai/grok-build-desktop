import { randomUUID } from "node:crypto";
import type { AppSettings, ChatEvent, CliBtwReceipt, CliSessionInfo, CliSessionListResult, CliSessionUsage, CommandInfo, LiveStatus, ModelInfo, OfficialFeedbackCapability, OfficialFeedbackReceipt, ProviderLaunchContext, ReasoningEffort, SessionCompactReceipt, SessionMode } from "../../shared/types";
import { buildCliEnv, detectEffortFlag, locateGrokCli } from "./cli-locator";
import { GrokAcpAdapter, LiveEffortUnsupportedError, type SessionProcessOptions } from "./grok-acp-adapter";
import type { LogService } from "./log-service";
import type { SessionRuntimeStateService } from "./session-runtime-state-service";

export interface LiveSessionSnapshot {
  sessionId: string;
  cwd: string;
  effort: ReasoningEffort;
  mode: SessionMode;
  modelId?: string;
  processOptions?: SessionProcessOptions;
}

export interface ManagedModelIdentity {
  providerId?: string;
  localModelId?: string;
}

export interface ModelSwitchIdentity {
  target: ManagedModelIdentity;
  previous: ManagedModelIdentity;
}

export class GrokProcessManager {
  private readonly sessions = new Map<string, GrokAcpAdapter>();
  private focusedId = "";
  private readonly reaper: NodeJS.Timeout;

  constructor(
    private readonly getSettings: () => Promise<AppSettings>,
    private readonly getApiKey: () => Promise<string | undefined>,
    private readonly log: LogService,
    private readonly onEvent: (event: ChatEvent) => void,
    private readonly getSessionExtensions?: () => Promise<{ leaseId?: string; mcpServers?: unknown[]; pluginDirs?: string[] }>,
    private readonly onSessionStarted?: (leaseId: string | undefined, sessionId: string) => void,
    private readonly onSessionClosed?: (leaseId: string | undefined) => void,
    private readonly getMcpSecretEnvironment: () => Promise<Record<string, string>> = async () => ({}),
    private readonly getWorkspaceEnvironment: (cwd: string) => Promise<Record<string, string>> = async () => ({}),
    private readonly getProviderEnvironment: (context: ProviderLaunchContext) => Promise<Record<string, string>> = async () => ({}),
    private readonly beforeSessionClose?: (sessionId: string, session: GrokAcpAdapter, reason: "close" | "shutdown" | "reap" | "cap") => Promise<void>,
    private readonly runtimeState?: SessionRuntimeStateService,
  ) {
    this.reaper = setInterval(() => void this.reap(), 5 * 60_000);
    this.reaper.unref();
  }

  async extensionRequest(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown> | undefined> {
    let adapter = this.findIdleExtensionAdapter();
    if (!adapter && this.sessions.size && isMutatingExtensionMethod(method)) {
      // Extension mutations are deliberately queued behind active turns. This
      // avoids reloading a plugin/MCP while its tools are still being used.
      adapter = await this.waitForIdleExtensionAdapter();
    }
    if (!adapter) return undefined;
    return adapter.extension(method, params);
  }

  async listOfficialSessions(cwd?: string, cursor?: string): Promise<CliSessionListResult> {
    const adapter = this.findIdleExtensionAdapter();
    if (!adapter) return { supported: false, sessions: [], source: "unsupported" };
    return adapter.officialSessionList(cwd, cursor);
  }

  async sessionInfo(sessionId: string): Promise<CliSessionInfo> {
    return this.get(sessionId).sessionInfo();
  }

  async sessionUsage(sessionId: string): Promise<CliSessionUsage> {
    return this.get(sessionId).sessionUsage();
  }

  async renameSessionIfLoaded(sessionId: string, title: string): Promise<"official" | "unsupported" | "not-loaded"> {
    const adapter = this.sessions.get(sessionId);
    if (!adapter) return "not-loaded";
    return adapter.renameSession(title);
  }

  async compactSession(sessionId: string): Promise<SessionCompactReceipt> {
    return this.get(sessionId).compact();
  }

  feedbackCapability(sessionId: string): OfficialFeedbackCapability {
    const adapter = this.sessions.get(sessionId);
    return adapter?.feedbackCapability() ?? { available: false, sessionId, source: "unavailable", reason: "请先打开并连接一个 Grok 会话。" };
  }

  submitOfficialFeedback(sessionId: string, text: string): Promise<OfficialFeedbackReceipt> {
    return this.get(sessionId).submitOfficialFeedback(text);
  }

  async forkToWorkspace(sourceSessionId: string, sourceCwd: string, newCwd: string): Promise<Record<string, unknown>> {
    const loaded = this.sessions.get(sourceSessionId);
    if (loaded) {
      if (loaded.working || loaded.needsUser) throw new Error("会话正在运行或等待操作，完成后再重新绑定项目路径");
      return loaded.fork(undefined, newCwd);
    }
    const settings = await this.getSettings();
    const adapter = await this.spawn(newCwd, settings.defaultEffort, settings.defaultMode, settings.defaultModel);
    try {
      return await adapter.forkExternal(sourceSessionId, sourceCwd, newCwd);
    } finally {
      await adapter.dispose().catch(() => undefined);
    }
  }

  /**
   * Grok Build 1.0 can load an existing session id against a moved cwd.  Only
   * probe an unloaded session: replacing a resident adapter would be a
   * destructive side effect if the CLI rejects the new directory.  The caller
   * verifies that the CLI materialized the session in the target catalog and
   * closes this probe before falling back to an official fork.
   */
  async tryMoveSessionToWorkspace(sessionId: string, newCwd: string): Promise<boolean> {
    if (this.sessions.has(sessionId)) return false;
    await this.open(newCwd, sessionId);
    return true;
  }

  async btw(sessionId: string, text: string): Promise<CliBtwReceipt> {
    return this.get(sessionId).btw(text);
  }

  private findIdleExtensionAdapter(): GrokAcpAdapter | undefined {
    const preferred = this.sessions.get(this.focusedId);
    return preferred && !preferred.working && !preferred.needsUser
      ? preferred
      : Array.from(this.sessions.values()).find((value) => !value.working && !value.needsUser);
  }

  private async waitForIdleExtensionAdapter(timeoutMs = 30 * 60_000): Promise<GrokAcpAdapter | undefined> {
    const started = Date.now();
    while (this.sessions.size && Date.now() - started < timeoutMs) {
      const adapter = this.findIdleExtensionAdapter();
      if (adapter) return adapter;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return undefined;
  }

  liveStatuses(): Map<string, LiveStatus> {
    return new Map(Array.from(this.sessions, ([id, session]) => [id, session.needsUser ? "needs-user" : session.working ? "working" : "idle"]));
  }

  hasWorking(): boolean {
    return Array.from(this.sessions.values()).some((session) => session.working || session.needsUser);
  }

  async reloadIdleExtensions(timeoutMs = 30 * 60_000): Promise<number> {
    if (!this.sessions.size) return 0;
    const started = Date.now();
    while (Array.from(this.sessions.values()).some((session) => session.working || session.needsUser)) {
      if (Date.now() - started >= timeoutMs) throw new Error("等待运行中的会话结束以重载扩展超时");
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const snapshots = Array.from(this.sessions.entries()).map(([sessionId, session]) => ({
      sessionId, session, cwd: session.cwd, effort: session.effort, mode: session.mode, modelId: session.currentModelId, processOptions: session.processOptions,
    }));
    const failures: string[] = [];
    for (const snapshot of snapshots) {
      this.sessions.delete(snapshot.sessionId);
      await snapshot.session.dispose();
      const adapter = await this.spawn(snapshot.cwd, snapshot.effort, snapshot.mode, snapshot.modelId, undefined, undefined, snapshot.processOptions, snapshot.sessionId);
      try {
        await adapter.start(snapshot.sessionId);
        await this.rememberSession(snapshot.sessionId, adapter);
        this.onSessionStarted?.(adapter.extensionLeaseId, snapshot.sessionId);
        this.sessions.set(snapshot.sessionId, adapter);
      } catch (error) {
        await adapter.dispose();
        failures.push(`${snapshot.sessionId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (failures.length) throw new Error(`扩展重载后部分会话恢复失败：${failures.join("；")}`);
    return snapshots.length;
  }

  async restartIdleSessions(statusText = "Agent/Persona 定义已更新，正在恢复空闲会话…"): Promise<number> {
    const sessionIds = Array.from(this.sessions, ([sessionId, session]) => !session.working && !session.needsUser ? sessionId : undefined).filter((value): value is string => Boolean(value));
    const failures: string[] = [];
    let restarted = 0;
    for (const sessionId of sessionIds) {
      try {
        await this.restartSession(sessionId, statusText);
        restarted += 1;
      } catch (error) {
        failures.push(`${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (failures.length) throw new Error(`部分空闲会话恢复失败：${failures.join("；")}`);
    return restarted;
  }

  get(sessionId: string): GrokAcpAdapter {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("会话当前未加载");
    return session;
  }

  listKnownModels(): ModelInfo[] {
    const byId = new Map<string, ModelInfo>();
    for (const session of this.sessions.values()) {
      for (const model of session.models) byId.set(model.modelId, model);
    }
    return [...byId.values()];
  }

  snapshot(sessionId: string): LiveSessionSnapshot | undefined {
    const session = this.sessions.get(sessionId);
    return session ? { sessionId, cwd: session.cwd, effort: session.effort, mode: session.mode, modelId: session.currentModelId, processOptions: session.processOptions } : undefined;
  }

  snapshots(): LiveSessionSnapshot[] {
    return Array.from(this.sessions, ([sessionId, session]) => ({ sessionId, cwd: session.cwd, effort: session.effort, mode: session.mode, modelId: session.currentModelId, processOptions: session.processOptions }));
  }

  /** Prefer the official 1.0 Git status extension only when a matching live
   * session is idle.  Review mutations continue to use the repository-scoped
   * GitService so an active turn can never race a UI refresh. */
  async officialGitStatusForWorkspace(cwd: string, gitRoot?: string): Promise<Record<string, unknown> | undefined> {
    const target = workspaceKey(cwd);
    const adapter = Array.from(this.sessions.values()).find((candidate) => workspaceKey(candidate.cwd) === target && !candidate.working && !candidate.needsUser);
    return adapter?.officialGitStatus(gitRoot);
  }

  promptQueues(): Array<{ sessionId: string; entries: ReturnType<GrokAcpAdapter["queuedPrompts"]> }> {
    return Array.from(this.sessions, ([sessionId, adapter]) => ({ sessionId, entries: adapter.queuedPrompts() }));
  }

  waitForCommands(sessionId: string, timeoutMs?: number): Promise<CommandInfo[]> {
    return this.get(sessionId).waitForCommands(timeoutMs);
  }

  async backgroundTaskResults(): Promise<Array<{ sessionId: string; result: Record<string, unknown>; subagents?: Record<string, unknown> }>> {
    const output: Array<{ sessionId: string; result: Record<string, unknown>; subagents?: Record<string, unknown> }> = [];
    for (const [sessionId, adapter] of this.sessions) {
      const [result, subagents] = await Promise.all([adapter.taskList().catch(() => undefined), adapter.subagentListRunning().catch(() => undefined)]);
      if (result || subagents) output.push({ sessionId, result: result ?? { tasks: [] }, subagents });
    }
    return output;
  }

  async killBackgroundTask(sessionId: string, taskId: string): Promise<void> {
    if (taskId.startsWith("subagent:")) await this.get(sessionId).subagentCancel(taskId.slice("subagent:".length));
    else await this.get(sessionId).taskKill(taskId);
  }

  async create(cwd: string): Promise<{ sessionId: string }> {
    const settings = await this.getSettings();
    const adapter = await this.spawn(cwd, settings.defaultEffort, settings.defaultMode, settings.defaultModel);
    let result: { sessionId: string };
    try {
      result = await adapter.start();
      await this.rememberSession(result.sessionId, adapter);
    } catch (error) {
      await adapter.dispose();
      throw error;
    }
    this.sessions.set(result.sessionId, adapter);
    this.onSessionStarted?.(adapter.extensionLeaseId, result.sessionId);
    this.focusedId = result.sessionId;
    await this.enforceCap();
    return result;
  }

  async createConfigured(cwd: string, effort: ReasoningEffort, mode: SessionMode, modelId: string, permissionDecider?: (toolCall: unknown) => Promise<boolean | undefined>, environmentOverride?: NodeJS.ProcessEnv, processOptions?: SessionProcessOptions): Promise<{ sessionId: string }> {
    const adapter = await this.spawn(cwd, effort, mode, modelId, permissionDecider, environmentOverride, processOptions);
    try {
      const result = await adapter.start();
      await this.rememberSession(result.sessionId, adapter);
      this.sessions.set(result.sessionId, adapter);
      this.onSessionStarted?.(adapter.extensionLeaseId, result.sessionId);
      this.focusedId = result.sessionId;
      await this.enforceCap();
      return result;
    } catch (error) { await adapter.dispose(); throw error; }
  }

  async openConfigured(cwd: string, sessionId: string, effort: ReasoningEffort, mode: SessionMode, modelId: string, permissionDecider?: (toolCall: unknown) => Promise<boolean | undefined>, environmentOverride?: NodeJS.ProcessEnv, processOptions?: SessionProcessOptions, restoreRuntimePreferences = false): Promise<{ sessionId: string }> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastTouched = Date.now();
      this.focusedId = sessionId;
      return { sessionId };
    }
    // A task execution profile is allowed to stay fixed for scheduled runs.
    // Opening an ordinary assigned conversation is different: the choices the
    // user made inside that conversation must win over both the old profile and
    // today's global defaults. Keep the distinction explicit so automation does
    // not accidentally inherit interactive state.
    const saved = restoreRuntimePreferences ? await this.runtimeState?.get(sessionId) : undefined;
    const adapter = await this.spawn(
      cwd,
      saved?.effort ?? effort,
      saved?.mode ?? mode,
      saved?.modelId ?? modelId,
      permissionDecider,
      environmentOverride,
      processOptions,
      sessionId,
    );
    try {
      await adapter.start(sessionId);
      await this.rememberSession(sessionId, adapter);
      this.sessions.set(sessionId, adapter);
      this.onSessionStarted?.(adapter.extensionLeaseId, sessionId);
      this.focusedId = sessionId;
      await this.enforceCap();
      return { sessionId };
    } catch (error) { await adapter.dispose(); throw error; }
  }

  async open(cwd: string, sessionId: string): Promise<{ sessionId: string }> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastTouched = Date.now();
      this.focusedId = sessionId;
      this.onEvent({ type: "session-ready", sessionId, models: existing.models, currentModelId: existing.currentModelId, effort: existing.effort });
      return { sessionId };
    }
    const saved = await this.runtimeState?.get(sessionId);
    // Existing conversations must not inherit the latest global model from an
    // unrelated task. Without a Desktop record, let the CLI-reported model win.
    const adapter = await this.spawn(cwd, saved?.effort ?? "", saved?.mode ?? "agent", saved?.modelId, undefined, undefined, undefined, sessionId);
    try {
      await adapter.start(sessionId);
      await this.rememberSession(sessionId, adapter);
    } catch (error) {
      await adapter.dispose();
      throw error;
    }
    this.sessions.set(sessionId, adapter);
    this.onSessionStarted?.(adapter.extensionLeaseId, sessionId);
    this.focusedId = sessionId;
    await this.enforceCap();
    return { sessionId };
  }

  focus(sessionId: string): void {
    this.focusedId = sessionId;
    const session = this.sessions.get(sessionId);
    if (session) session.lastTouched = Date.now();
  }

  async setEffort(sessionId: string, effort: ReasoningEffort): Promise<void> {
    const current = this.get(sessionId);
    if (current.effort === effort) return;
    if (current.working || current.needsUser) throw new Error("当前会话正在运行或等待操作，完成后再更改推理强度");
    if (!effort) throw new Error("已存在会话不能切回 CLI 默认强度；请把它设为新会话默认值后新建会话");

    const model = current.models.find((item) => item.modelId === current.currentModelId);
    const supported = model?.reasoningEfforts?.map((item) => item.value) ?? [];
    if (!model?.supportsReasoningEffort || !supported.includes(effort)) {
      const declared = supported.length ? supported.join("、") : "未声明";
      throw new Error(`当前模型不支持热切换到 ${effort}（可用档位：${declared}）。可在提供商模型配置中声明上游实际支持的档位`);
    }

    this.onEvent({ type: "status", sessionId, status: "working", text: "正在切换推理强度…" });
    try {
      await current.setEffort(effort);
      await this.runtimeState?.patch(sessionId, { effort });
      this.onEvent({ type: "status", sessionId, status: "idle", text: "推理强度已更新" });
    } catch (error) {
      await this.log.log(`live reasoning effort failed without restarting the persisted session: ${error instanceof Error ? error.message : String(error)}`);
      this.onEvent({ type: "status", sessionId, status: "idle", text: "推理强度未更改" });
      const detail = error instanceof LiveEffortUnsupportedError
        ? "当前 CLI 没有确认这次热切换"
        : error instanceof Error ? error.message : String(error);
      throw new Error(`推理强度未更改：${detail}。为避免恢复历史会话时串到错误模型，应用没有重启该会话`);
    }
  }

  async restartWithEffort(sessionId: string, effort: ReasoningEffort): Promise<void> {
    const previous = this.get(sessionId);
    if (previous.effort === effort) return;
    if (previous.working || previous.needsUser) throw new Error("当前会话正在运行或等待操作，完成后再更改推理强度");
    const cwd = previous.cwd;
    const mode = previous.mode;
    const model = previous.currentModelId;
    const previousEffort = previous.effort;
    const processOptions = previous.processOptions;
    this.onEvent({ type: "status", sessionId, status: "working", text: "正在应用推理强度并恢复会话…" });
    await previous.dispose();
    this.sessions.delete(sessionId);
    this.onEvent({ type: "session-reset", sessionId });
    this.onEvent({ type: "status", sessionId, status: "working", text: "正在应用推理强度并恢复会话…" });
    let replacement: GrokAcpAdapter | undefined;
    try {
      replacement = await this.spawn(cwd, effort, mode, model, undefined, undefined, processOptions, sessionId);
      await replacement.start(sessionId);
      await this.rememberSession(sessionId, replacement);
      this.onSessionStarted?.(replacement.extensionLeaseId, sessionId);
      if (replacement.effort !== effort) {
        throw new Error(`CLI 恢复会话后仍使用 ${replacement.effort || "默认强度"}`);
      }
      this.sessions.set(sessionId, replacement);
      this.focusedId = sessionId;
    } catch (restartError) {
      await replacement?.dispose();
      this.onEvent({ type: "session-reset", sessionId });
      this.onEvent({ type: "status", sessionId, status: "working", text: "新强度启动失败，正在恢复原设置…" });
      const rollback = await this.spawn(cwd, previousEffort, mode, model, undefined, undefined, processOptions, sessionId);
      try {
        await rollback.start(sessionId);
        await this.rememberSession(sessionId, rollback);
        this.onSessionStarted?.(rollback.extensionLeaseId, sessionId);
        this.sessions.set(sessionId, rollback);
        this.focusedId = sessionId;
      } catch (rollbackError) {
        await rollback.dispose();
        throw new Error(`推理强度切换失败，且原设置恢复失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
      throw new Error(`推理强度切换失败，已恢复原设置：${restartError instanceof Error ? restartError.message : String(restartError)}`);
    }
  }

  async restartSession(sessionId: string, statusText = "正在重启并恢复会话…"): Promise<void> {
    const previous = this.get(sessionId);
    if (previous.working || previous.needsUser) throw new Error("当前会话正在运行或等待操作，完成后再重启");
    const { cwd, mode, effort, currentModelId: model, processOptions } = previous;
    this.onEvent({ type: "status", sessionId, status: "working", text: statusText });
    await previous.dispose();
    this.sessions.delete(sessionId);
    this.onEvent({ type: "session-reset", sessionId });
    const replacement = await this.spawn(cwd, effort, mode, model, undefined, undefined, processOptions, sessionId);
    try {
      await replacement.start(sessionId);
      await this.rememberSession(sessionId, replacement);
      this.onSessionStarted?.(replacement.extensionLeaseId, sessionId);
      this.sessions.set(sessionId, replacement);
      this.focusedId = sessionId;
    } catch (error) {
      await replacement.dispose();
      throw error;
    }
  }

  async setModel(sessionId: string, modelId: string, identity: ModelSwitchIdentity = { target: {}, previous: {} }): Promise<void> {
    const current = this.get(sessionId);
    if ((current.working || current.needsUser) && !current.planDecisionPending) throw new Error("当前会话正在运行或等待操作，完成后再更改模型");
    const previousModelId = current.currentModelId;
    try {
      await current.setModel(modelId, { localModelId: identity.target.localModelId, persistRuntime: false });
      await this.rememberSession(sessionId, current, identity.target);
      return;
    } catch (error) {
      this.onEvent({ type: "status", sessionId, status: "working", text: "CLI 不支持热切换，正在重启并恢复会话…" });
      const cwd = current.cwd;
      const effort = current.effort;
      const mode = current.mode;
      const processOptions = current.processOptions;
      await current.dispose();
      this.sessions.delete(sessionId);
      this.onEvent({ type: "session-reset", sessionId });
      const replacement = await this.spawn(cwd, effort, mode, modelId, undefined, undefined, processOptions, sessionId, identity.target);
      try {
        await replacement.start(sessionId);
        await this.rememberSession(sessionId, replacement, identity.target);
        this.onSessionStarted?.(replacement.extensionLeaseId, sessionId);
        this.sessions.set(sessionId, replacement);
        this.focusedId = sessionId;
      } catch (restartError) {
        await replacement.dispose();
        const rollback = await this.spawn(cwd, effort, mode, previousModelId, undefined, undefined, processOptions, sessionId, identity.previous);
        try {
          await rollback.start(sessionId);
          await this.rememberSession(sessionId, rollback, identity.previous);
          this.onSessionStarted?.(rollback.extensionLeaseId, sessionId);
          this.sessions.set(sessionId, rollback);
          this.focusedId = sessionId;
        } catch (rollbackError) {
          await rollback.dispose();
          throw new Error(`模型热切换失败，且原模型恢复失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}；目标错误：${restartError instanceof Error ? restartError.message : String(restartError)}`);
        }
        throw new Error(`模型热切换失败，已尝试恢复原模型：${restartError instanceof Error ? restartError.message : String(restartError)}；原错误：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  async close(sessionId: string, finalize = true): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (finalize) await this.finalizeSession(sessionId, session, "close");
    await session.dispose();
    this.sessions.delete(sessionId);
  }

  async setMode(sessionId: string, mode: SessionMode): Promise<void> {
    await this.get(sessionId).applyMode(mode);
    await this.runtimeState?.patch(sessionId, { mode });
  }

  /**
   * ACP cancellation is a notification, so a wedged CLI is not required to
   * acknowledge it. Give the active turn a short grace period, then replace
   * only that session process and reload the persisted conversation. This
   * makes Stop a real recovery boundary without affecting concurrent sessions.
   */
  async cancelSession(sessionId: string, graceMs = 8_000): Promise<void> {
    const current = this.get(sessionId);
    current.cancel();
    const deadline = Date.now() + Math.max(0, graceMs);
    while (Date.now() < deadline) {
      if (this.sessions.get(sessionId) !== current || (!current.working && !current.needsUser)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (this.sessions.get(sessionId) !== current || (!current.working && !current.needsUser)) return;

    const { cwd, mode, effort, currentModelId: model, processOptions } = current;
    this.onEvent({ type: "status", sessionId, status: "working", text: "CLI 未确认停止，正在恢复该会话…" });
    await current.dispose(2_000);
    this.sessions.delete(sessionId);
    this.onEvent({ type: "session-reset", sessionId });
    const replacement = await this.spawn(cwd, effort, mode, model, undefined, undefined, processOptions, sessionId);
    try {
      await replacement.start(sessionId);
      await this.rememberSession(sessionId, replacement);
      this.onSessionStarted?.(replacement.extensionLeaseId, sessionId);
      this.sessions.set(sessionId, replacement);
      this.focusedId = sessionId;
      this.onEvent({ type: "status", sessionId, status: "idle", text: "已停止并恢复会话" });
    } catch (error) {
      await replacement.dispose();
      throw new Error(`停止后恢复会话失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async stopAll(finalize = true): Promise<void> {
    const sessions = Array.from(this.sessions.entries());
    this.sessions.clear();
    await Promise.allSettled(sessions.map(async ([sessionId, session]) => { if (finalize) await this.finalizeSession(sessionId, session, "shutdown"); await session.dispose(); }));
  }

  async suspendAll(): Promise<LiveSessionSnapshot[]> {
    const snapshots = Array.from(this.sessions.entries()).map(([sessionId, session]) => ({
      sessionId,
      cwd: session.cwd,
      effort: session.effort,
      mode: session.mode,
      modelId: session.currentModelId,
      processOptions: session.processOptions,
    }));
    await this.stopAll(false);
    return snapshots;
  }

  async restoreAll(snapshots: LiveSessionSnapshot[]): Promise<void> {
    const failures: string[] = [];
    for (const snapshot of snapshots) {
      this.onEvent({ type: "session-reset", sessionId: snapshot.sessionId });
      const adapter = await this.spawn(snapshot.cwd, snapshot.effort, snapshot.mode, snapshot.modelId, undefined, undefined, snapshot.processOptions, snapshot.sessionId);
      try {
        await adapter.start(snapshot.sessionId);
        await this.rememberSession(snapshot.sessionId, adapter);
        this.onSessionStarted?.(adapter.extensionLeaseId, snapshot.sessionId);
        this.sessions.set(snapshot.sessionId, adapter);
      } catch (error) {
        await adapter.dispose();
        failures.push(`${snapshot.sessionId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (snapshots.length) this.focusedId = snapshots.at(-1)!.sessionId;
    if (failures.length) throw new Error(`部分会话恢复失败：${failures.join("；")}`);
  }

  async dispose(): Promise<void> {
    clearInterval(this.reaper);
    await this.stopAll();
  }

  private async spawn(cwd: string, effort: ReasoningEffort, mode: SessionMode, modelId?: string, permissionDecider?: (toolCall: unknown) => Promise<boolean | undefined>, environmentOverride?: NodeJS.ProcessEnv, processOptions?: SessionProcessOptions, resumeSessionId?: string, launchIdentity?: ManagedModelIdentity): Promise<GrokAcpAdapter> {
    const settings = await this.getSettings();
    const cliPath = await locateGrokCli(settings.cliPath);
    if (!cliPath) throw new Error("未找到 Grok CLI，请在设置中指定路径");
    const apiKey = await this.getApiKey();
    const mcpSecretEnvironment = await this.getMcpSecretEnvironment();
    const workspaceEnvironment = await this.getWorkspaceEnvironment(cwd);
    const providerScopeId = randomUUID();
    const savedRuntime = resumeSessionId ? await this.runtimeState?.get(resumeSessionId) : undefined;
    const providerId = launchIdentity ? launchIdentity.providerId : savedRuntime?.providerId;
    const localModelId = launchIdentity
      ? launchIdentity.localModelId ?? modelId
      : savedRuntime?.modelId ?? modelId;
    const providerEnvironment = await this.getProviderEnvironment({ scopeId: providerScopeId, sessionId: resumeSessionId, cwd, modelId, localModelId, providerId });
    const initialPromptQueue = resumeSessionId ? await this.runtimeState?.getQueue(resumeSessionId) : undefined;
    const extensions = await this.getSessionExtensions?.();
    const effectivePermissionDecider = permissionDecider ?? processOptions?.permissionDecider;
    const effectiveEnvironmentOverride = environmentOverride ?? processOptions?.environmentOverride;
    const compactionEnvironment = savedRuntime?.compaction?.mode === "custom" && savedRuntime.compaction.thresholdPercent
      ? { GROK_AUTO_COMPACT_THRESHOLD_PERCENT: String(savedRuntime.compaction.thresholdPercent) }
      : {};
    const env = enforceProtectedWorkspaceEnvironment(mergeProcessEnvironment(buildCliEnv(settings, apiKey), workspaceEnvironment, mcpSecretEnvironment, providerEnvironment, compactionEnvironment, effectiveEnvironmentOverride), workspaceEnvironment);
    const adapter = new GrokAcpAdapter({
      cliPath,
      cwd,
      env,
      effort,
      modelId,
      localModelId,
      mode,
      log: this.log,
      sessionMcpServers: extensions?.mcpServers,
      pluginDirs: extensions?.pluginDirs,
      extensionLeaseId: extensions?.leaseId,
      effortFlag: await detectEffortFlag(cliPath, env),
      permissionDecider: effectivePermissionDecider,
      providerScopeId,
      initialPromptQueue,
      onPromptQueueChanged: this.runtimeState ? (sessionId, entries) => this.runtimeState!.saveQueue(sessionId, entries) : undefined,
      onPromptQueueTerminal: this.runtimeState ? (sessionId, entry) => this.runtimeState!.recordQueueTerminal(sessionId, entry) : undefined,
      onRuntimeChanged: this.runtimeState ? async (sessionId, patch) => { await this.runtimeState!.patch(sessionId, patch); } : undefined,
      agentProfilePath: processOptions?.agentProfilePath,
      sessionMeta: processOptions?.sessionMeta,
      // The effective restored mode, rather than the profile's stale launch
      // flag, controls CLI approval behavior on every respawn.
      alwaysApprove: mode === "auto",
      environmentOverride: effectiveEnvironmentOverride ? { ...effectiveEnvironmentOverride } : undefined,
    });
    adapter.on("event", (event: ChatEvent) => this.onEvent(event));
    adapter.on("closed", () => {
      const sessionId = adapter.sessionId;
      if (sessionId && this.sessions.get(sessionId) === adapter) this.sessions.delete(sessionId);
      this.onSessionClosed?.(adapter.extensionLeaseId);
    });
    return adapter;
  }

  private async rememberSession(sessionId: string, adapter: GrokAcpAdapter, identity?: ManagedModelIdentity): Promise<void> {
    if (!this.runtimeState) return;
    const previous = await this.runtimeState.get(sessionId);
    await this.runtimeState.save({
      sessionId,
      cwd: adapter.cwd,
      modelId: identity?.localModelId ?? (adapter.currentModelId || previous?.modelId),
      providerId: identity ? identity.providerId : previous?.providerId,
      effort: adapter.effort,
      mode: adapter.mode,
      profileId: previous?.profileId,
      compaction: previous?.compaction,
    });
  }

  private async enforceCap(): Promise<void> {
    if (this.sessions.size <= 8) return;
    const candidates = Array.from(this.sessions.entries())
      .filter(([id, session]) => id !== this.focusedId && !session.working && !session.needsUser)
      .sort((a, b) => a[1].lastTouched - b[1].lastTouched);
    while (this.sessions.size > 8 && candidates.length) {
      const [id, session] = candidates.shift()!;
      await this.finalizeSession(id, session, "cap");
      await session.dispose();
      this.sessions.delete(id);
    }
  }

  private async reap(): Promise<void> {
    const cutoff = Date.now() - 60 * 60_000;
    const victims = Array.from(this.sessions.entries()).filter(([id, session]) => id !== this.focusedId && !session.working && !session.needsUser && session.lastTouched < cutoff);
    for (const [id, session] of victims) {
      await this.finalizeSession(id, session, "reap");
      await session.dispose();
      this.sessions.delete(id);
    }
  }

  private async finalizeSession(sessionId: string, session: GrokAcpAdapter, reason: "close" | "shutdown" | "reap" | "cap"): Promise<void> {
    if (!this.beforeSessionClose || session.working || session.needsUser) return;
    try { await this.beforeSessionClose(sessionId, session, reason); }
    catch (error) { await this.log.log(`session finalization failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
}

function workspaceKey(value: string): string {
  return value.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLocaleLowerCase("en-US");
}

export function isMutatingExtensionMethod(method: string): boolean {
  return /^(?:x\.ai\/(?:plugins\/(?:action|reload)|marketplace\/action|mcp\/(?:upsert|delete|toggle|auth_trigger)))$/.test(method);
}

export function mergeProcessEnvironment(...sources: Array<NodeJS.ProcessEnv | Record<string, string> | undefined>): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = Object.assign({}, ...sources.filter(Boolean));
  for (const [name, value] of Object.entries(environment)) if (value === undefined) delete environment[name];
  return environment;
}

export function enforceProtectedWorkspaceEnvironment(environment: NodeJS.ProcessEnv, workspaceEnvironment: Record<string, string>): NodeJS.ProcessEnv {
  if (workspaceEnvironment.GROK_MEMORY_LOG === "0") environment.GROK_MEMORY_LOG = "0";
  return environment;
}
