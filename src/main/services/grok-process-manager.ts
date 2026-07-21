import type { AppSettings, ChatEvent, CommandInfo, LiveStatus, ReasoningEffort, SessionMode } from "../../shared/types";
import { buildCliEnv, detectEffortFlag, locateGrokCli } from "./cli-locator";
import { GrokAcpAdapter, LiveEffortUnsupportedError } from "./grok-acp-adapter";
import type { LogService } from "./log-service";

export interface LiveSessionSnapshot {
  sessionId: string;
  cwd: string;
  effort: ReasoningEffort;
  mode: SessionMode;
  modelId?: string;
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
      sessionId, session, cwd: session.cwd, effort: session.effort, mode: session.mode, modelId: session.currentModelId,
    }));
    const failures: string[] = [];
    for (const snapshot of snapshots) {
      this.sessions.delete(snapshot.sessionId);
      await snapshot.session.dispose();
      const adapter = await this.spawn(snapshot.cwd, snapshot.effort, snapshot.mode, snapshot.modelId);
      try {
        await adapter.start(snapshot.sessionId);
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

  get(sessionId: string): GrokAcpAdapter {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("会话当前未加载");
    return session;
  }

  snapshot(sessionId: string): LiveSessionSnapshot | undefined {
    const session = this.sessions.get(sessionId);
    return session ? { sessionId, cwd: session.cwd, effort: session.effort, mode: session.mode, modelId: session.currentModelId } : undefined;
  }

  snapshots(): LiveSessionSnapshot[] {
    return Array.from(this.sessions, ([sessionId, session]) => ({ sessionId, cwd: session.cwd, effort: session.effort, mode: session.mode, modelId: session.currentModelId }));
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

  async createConfigured(cwd: string, effort: ReasoningEffort, mode: SessionMode, modelId: string, permissionDecider?: (toolCall: unknown) => Promise<boolean | undefined>, environmentOverride?: NodeJS.ProcessEnv): Promise<{ sessionId: string }> {
    const adapter = await this.spawn(cwd, effort, mode, modelId, permissionDecider, environmentOverride);
    try {
      const result = await adapter.start();
      this.sessions.set(result.sessionId, adapter);
      this.onSessionStarted?.(adapter.extensionLeaseId, result.sessionId);
      this.focusedId = result.sessionId;
      await this.enforceCap();
      return result;
    } catch (error) { await adapter.dispose(); throw error; }
  }

  async openConfigured(cwd: string, sessionId: string, effort: ReasoningEffort, mode: SessionMode, modelId: string, permissionDecider?: (toolCall: unknown) => Promise<boolean | undefined>, environmentOverride?: NodeJS.ProcessEnv): Promise<{ sessionId: string }> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastTouched = Date.now();
      this.focusedId = sessionId;
      return { sessionId };
    }
    const adapter = await this.spawn(cwd, effort, mode, modelId, permissionDecider, environmentOverride);
    try {
      await adapter.start(sessionId);
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
    const settings = await this.getSettings();
    const adapter = await this.spawn(cwd, settings.defaultEffort, settings.defaultMode, settings.defaultModel);
    try {
      await adapter.start(sessionId);
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

    // An empty value means "use the CLI default" and cannot be represented by
    // the private live API. Non-empty values are hot-switched on current CLIs.
    if (effort) {
      this.onEvent({ type: "status", sessionId, status: "working", text: "正在切换推理强度…" });
      try {
        await current.setEffort(effort);
        this.onEvent({ type: "status", sessionId, status: "idle", text: "推理强度已更新" });
        return;
      } catch (error) {
        await this.log.log(`live reasoning effort failed; falling back to restart: ${error instanceof Error ? error.message : String(error)}`);
        // Method-not-found, ignored private metadata and absent model_changed
        // are expected compatibility paths for older CLI versions. A dead
        // process is also recoverable through the same restart path.
        if (!(error instanceof LiveEffortUnsupportedError)) {
          await this.log.log("live effort failure was not an explicit compatibility error; attempting one controlled recovery restart");
        }
        if (current.effort === effort) {
          this.onEvent({ type: "status", sessionId, status: "idle", text: "推理强度已更新" });
          return;
        }
      }
    }
    await this.restartWithEffort(sessionId, effort);
  }

  async restartWithEffort(sessionId: string, effort: ReasoningEffort): Promise<void> {
    const previous = this.get(sessionId);
    if (previous.effort === effort) return;
    if (previous.working || previous.needsUser) throw new Error("当前会话正在运行或等待操作，完成后再更改推理强度");
    const cwd = previous.cwd;
    const mode = previous.mode;
    const model = previous.currentModelId;
    const previousEffort = previous.effort;
    this.onEvent({ type: "status", sessionId, status: "working", text: "正在应用推理强度并恢复会话…" });
    await previous.dispose();
    this.sessions.delete(sessionId);
    this.onEvent({ type: "session-reset", sessionId });
    this.onEvent({ type: "status", sessionId, status: "working", text: "正在应用推理强度并恢复会话…" });
    let replacement: GrokAcpAdapter | undefined;
    try {
      replacement = await this.spawn(cwd, effort, mode, model);
      await replacement.start(sessionId);
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
      const rollback = await this.spawn(cwd, previousEffort, mode, model);
      try {
        await rollback.start(sessionId);
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

  async setModel(sessionId: string, modelId: string): Promise<void> {
    const current = this.get(sessionId);
    if (current.working || current.needsUser) throw new Error("当前会话正在运行或等待操作，完成后再更改模型");
    const previousModelId = current.currentModelId;
    try {
      await current.setModel(modelId);
      return;
    } catch (error) {
      this.onEvent({ type: "status", sessionId, status: "working", text: "CLI 不支持热切换，正在重启并恢复会话…" });
      const cwd = current.cwd;
      const effort = current.effort;
      const mode = current.mode;
      await current.dispose();
      this.sessions.delete(sessionId);
      this.onEvent({ type: "session-reset", sessionId });
      const replacement = await this.spawn(cwd, effort, mode, modelId);
      try {
        await replacement.start(sessionId);
        this.onSessionStarted?.(replacement.extensionLeaseId, sessionId);
        this.sessions.set(sessionId, replacement);
        this.focusedId = sessionId;
      } catch (restartError) {
        await replacement.dispose();
        const rollback = await this.spawn(cwd, effort, mode, previousModelId);
        try {
          await rollback.start(sessionId);
          this.onSessionStarted?.(rollback.extensionLeaseId, sessionId);
          this.sessions.set(sessionId, rollback);
          this.focusedId = sessionId;
        } catch {
          await rollback.dispose();
        }
        throw new Error(`模型热切换失败，已尝试恢复原模型：${restartError instanceof Error ? restartError.message : String(restartError)}；原错误：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await session.dispose();
    this.sessions.delete(sessionId);
  }

  async stopAll(): Promise<void> {
    const sessions = Array.from(this.sessions.values());
    this.sessions.clear();
    await Promise.allSettled(sessions.map((session) => session.dispose()));
  }

  async suspendAll(): Promise<LiveSessionSnapshot[]> {
    const snapshots = Array.from(this.sessions.entries()).map(([sessionId, session]) => ({
      sessionId,
      cwd: session.cwd,
      effort: session.effort,
      mode: session.mode,
      modelId: session.currentModelId,
    }));
    await this.stopAll();
    return snapshots;
  }

  async restoreAll(snapshots: LiveSessionSnapshot[]): Promise<void> {
    const failures: string[] = [];
    for (const snapshot of snapshots) {
      this.onEvent({ type: "session-reset", sessionId: snapshot.sessionId });
      const adapter = await this.spawn(snapshot.cwd, snapshot.effort, snapshot.mode, snapshot.modelId);
      try {
        await adapter.start(snapshot.sessionId);
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

  private async spawn(cwd: string, effort: ReasoningEffort, mode: SessionMode, modelId?: string, permissionDecider?: (toolCall: unknown) => Promise<boolean | undefined>, environmentOverride?: NodeJS.ProcessEnv): Promise<GrokAcpAdapter> {
    const settings = await this.getSettings();
    const cliPath = await locateGrokCli(settings.cliPath);
    if (!cliPath) throw new Error("未找到 Grok CLI，请在设置中指定路径");
    const apiKey = await this.getApiKey();
    const mcpSecretEnvironment = await this.getMcpSecretEnvironment();
    const extensions = await this.getSessionExtensions?.();
    const env = { ...buildCliEnv(settings, apiKey), ...mcpSecretEnvironment, ...environmentOverride };
    for (const [name, value] of Object.entries(env)) if (value === undefined) delete env[name];
    const adapter = new GrokAcpAdapter({
      cliPath,
      cwd,
      env,
      effort,
      modelId,
      mode,
      log: this.log,
      sessionMcpServers: extensions?.mcpServers,
      pluginDirs: extensions?.pluginDirs,
      extensionLeaseId: extensions?.leaseId,
      effortFlag: await detectEffortFlag(cliPath, env),
      permissionDecider,
    });
    adapter.on("event", (event: ChatEvent) => this.onEvent(event));
    adapter.on("closed", () => {
      const sessionId = adapter.sessionId;
      if (sessionId && this.sessions.get(sessionId) === adapter) this.sessions.delete(sessionId);
      this.onSessionClosed?.(adapter.extensionLeaseId);
    });
    return adapter;
  }

  private async enforceCap(): Promise<void> {
    if (this.sessions.size <= 8) return;
    const candidates = Array.from(this.sessions.entries())
      .filter(([id, session]) => id !== this.focusedId && !session.working && !session.needsUser)
      .sort((a, b) => a[1].lastTouched - b[1].lastTouched);
    while (this.sessions.size > 8 && candidates.length) {
      const [id, session] = candidates.shift()!;
      await session.dispose();
      this.sessions.delete(id);
    }
  }

  private async reap(): Promise<void> {
    const cutoff = Date.now() - 60 * 60_000;
    const victims = Array.from(this.sessions.entries()).filter(([id, session]) => id !== this.focusedId && !session.working && !session.needsUser && session.lastTouched < cutoff);
    for (const [id, session] of victims) {
      await session.dispose();
      this.sessions.delete(id);
    }
  }
}

export function isMutatingExtensionMethod(method: string): boolean {
  return /^(?:x\.ai\/(?:plugins\/(?:action|reload)|marketplace\/action|mcp\/(?:upsert|delete|toggle|auth_trigger)))$/.test(method);
}
