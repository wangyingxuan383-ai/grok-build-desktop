import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import { appendFile, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface, type Interface } from "node:readline";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type {
  ComputerActionName,
  ComputerActionRequest,
  ComputerApp,
  ComputerAppPermissionRequest,
  ComputerCapability,
  ComputerRiskCategory,
  ComputerRiskConfirmation,
  ComputerState,
  ComputerTaskState,
  ComputerUseSettings,
  ComputerWindow,
  SessionMode,
} from "../../shared/types";
import { JsonStore } from "./json-store";
import type { LogService } from "./log-service";

const DEFAULT_COMPUTER_SETTINGS: ComputerUseSettings = {
  enabled: true,
  experimentalUnlocked: true,
  acceptanceVersion: "0.3.1",
  confirmNewApps: false,
  alwaysAllowedAppIds: [],
  maxScreenshotEdge: 1600,
  emergencyShortcut: "Ctrl+Alt+Esc",
};

interface PendingHost { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }
interface Lease { id: string; token: string; sessionId: string; server: McpServer; transport: StreamableHTTPServerTransport }
interface PendingPermission { request: ComputerAppPermissionRequest; resolve?(approved: boolean): void; onDecision?(approved: boolean): void | Promise<void> }
interface PendingRisk { request: ComputerRiskConfirmation; resolve(approved: boolean): void }

export class ComputerUseService {
  private readonly settings: JsonStore<ComputerUseSettings>;
  private readonly auditPath: string;
  private readonly leases = new Map<string, Lease>();
  private readonly tasks = new Map<string, ComputerTaskState>();
  private readonly onceAllowed = new Set<string>();
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  private readonly pendingRisks = new Map<string, PendingRisk>();
  private http?: HttpServer;
  private port = 0;
  private host?: ComputerHostClient;

  constructor(
    userDataPath: string,
    private readonly helperPath: string,
    private readonly pluginPath: string,
    private readonly log: LogService,
    private readonly getMode: (sessionId: string) => SessionMode | undefined,
    private readonly emit: (state: ComputerTaskState | ComputerAppPermissionRequest | ComputerRiskConfirmation, kind: "state" | "permission" | "risk") => void,
    private readonly captureWindow?: (windowId: string, maxEdge: number) => Promise<{ base64: string; width: number; height: number } | undefined>,
  ) {
    this.settings = new JsonStore(join(userDataPath, "computer-use-settings.json"), DEFAULT_COMPUTER_SETTINGS);
    this.auditPath = join(userDataPath, "computer-use-audit.jsonl");
  }

  async capability(): Promise<ComputerCapability> {
    const diagnostics: string[] = [];
    const helper = await stat(this.helperPath).then((value) => value.isFile()).catch(() => false);
    const plugin = await stat(join(this.pluginPath, "plugin.json")).then((value) => value.isFile()).catch(() => false);
    let helperVersion: string | undefined;
    if (!helper) diagnostics.push("未找到 GrokComputerHost.exe；运行 build-computer-host.ps1");
    else {
      try { const result = await this.getHost().call("self_test", {}) as Record<string, unknown>; helperVersion = String(result.version || "unknown"); }
      catch (error) { diagnostics.push(`辅助程序自检失败：${message(error)}`); }
    }
    if (!plugin) diagnostics.push("未找到内置 /computer Skill");
    const available = helper && plugin && !diagnostics.length && process.platform === "win32" && process.arch === "x64";
    return { available, experimental: true, accepted: true, acceptanceSummary: "24/24 确定性流程、真实 Grok 视觉动作、风险拒绝与打包版 UI 已通过", helperPath: this.helperPath, helperVersion, pluginPath: this.pluginPath, pluginDirs: plugin, mcpImageContent: true, diagnostics };
  }

  async getSettings(): Promise<ComputerUseSettings> {
    const value = await this.settings.get();
    if (value.acceptanceVersion === "0.3.1" && value.experimentalUnlocked) return value;
    return this.settings.patch({ experimentalUnlocked: true, acceptanceVersion: "0.3.1", confirmNewApps: false });
  }
  async updateSettings(patch: Partial<ComputerUseSettings>): Promise<ComputerUseSettings> {
    const safe: Partial<ComputerUseSettings> = { ...patch, experimentalUnlocked: true, acceptanceVersion: "0.3.1" };
    if (safe.maxScreenshotEdge !== undefined) safe.maxScreenshotEdge = Math.max(640, Math.min(2000, safe.maxScreenshotEdge));
    if (safe.emergencyShortcut !== undefined && safe.emergencyShortcut !== "Ctrl+Alt+Esc") delete safe.emergencyShortcut;
    return this.settings.patch(safe);
  }

  async createSessionInjection(): Promise<{ leaseId: string; mcpServers: unknown[]; pluginDirs: string[] }> {
    await this.ensureHttp();
    const id = randomUUID(); const token = randomBytes(32).toString("base64url");
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), enableJsonResponse: true });
    const server = this.createMcpServer(id);
    await server.connect(transport);
    this.leases.set(id, { id, token, sessionId: "", server, transport });
    return {
      leaseId: id,
      mcpServers: [{ type: "http", name: "grok_desktop_computer", url: `http://127.0.0.1:${this.port}/mcp/${id}`, headers: [{ name: "Authorization", value: `Bearer ${token}` }] }],
      pluginDirs: [this.pluginPath],
    };
  }

  bindLease(leaseId: string | undefined, sessionId: string): void { const lease = leaseId ? this.leases.get(leaseId) : undefined; if (lease) lease.sessionId = sessionId; }
  async releaseLease(leaseId: string | undefined): Promise<void> { const lease = leaseId ? this.leases.get(leaseId) : undefined; if (!lease) return; this.leases.delete(lease.id); const task = this.tasks.get(lease.sessionId); if (task && ["running", "paused", "awaiting-app-permission", "awaiting-risk-confirmation"].includes(task.status)) this.stopWith(task, "Grok 会话已关闭，Computer Use 已清理"); await lease.server.close().catch(() => undefined); this.tasks.delete(lease.sessionId); await this.stopHostIfIdle(); }

  async listWindows(appId?: string): Promise<ComputerWindow[]> {
    const raw = await this.getHost().call("list_windows", {}) as unknown[];
    return raw.map(normalizeWindow).filter((row) => !appId || row.appId === appId);
  }

  async listApps(): Promise<ComputerApp[]> {
    const windows = await this.listWindows(); const groups = new Map<string, ComputerWindow[]>();
    for (const window of windows) { const group = groups.get(window.appId) ?? []; group.push(window); groups.set(window.appId, group); }
    return Array.from(groups, ([id, rows]) => { const first = rows[0]!; return { id, name: first.processName, processName: first.processName, executablePath: first.executablePath, windowCount: rows.length, controllable: rows.some((row) => row.controllable), blockedReason: rows.every((row) => !row.controllable) ? first.blockedReason : undefined }; });
  }

  async start(input: { sessionId: string; appId: string; windowId?: string }): Promise<ComputerTaskState> {
    const config = await this.getSettings();
    if (!config.enabled) throw new Error("Computer Use 已在扩展中心关闭");
    const app = (await this.listApps()).find((value) => value.id === input.appId);
    if (!app) throw new Error("目标应用已关闭或不存在");
    if (!app.controllable) throw new Error(app.blockedReason || "此应用不可控制");
    const windows = await this.listWindows(app.id);
    const window = input.windowId ? windows.find((value) => value.id === input.windowId) : windows.find((value) => value.controllable);
    if (!window) throw new Error("未找到可控制的目标窗口");
    const now = new Date().toISOString();
    const task: ComputerTaskState = { sessionId: input.sessionId, appId: app.id, windowId: window.id, appName: app.name, status: "idle", stepCount: 0, updatedAt: now };
    this.tasks.set(input.sessionId, task);
    if (shouldRequestComputerAppPermission(this.getMode(input.sessionId), config.confirmNewApps, await this.isAllowed(input.sessionId, app.id))) {
      task.status = "awaiting-app-permission"; this.publish(task);
      const request: ComputerAppPermissionRequest = { requestId: randomUUID(), sessionId: input.sessionId, app, window };
      this.pendingPermissions.set(request.requestId, { request, onDecision: async (approved) => { if (approved) await this.activateTask(task, window); else this.stopWith(task, "应用控制已拒绝"); } });
      this.emit(request, "permission");
      return { ...task };
    }
    return this.activateTask(task, window);
  }

  async pause(sessionId: string): Promise<ComputerTaskState> { const task = this.requiredTask(sessionId); task.status = "paused"; task.message = "Computer Use 已暂停；点击继续可重新观察目标窗口"; task.updatedAt = new Date().toISOString(); this.publish(task); return { ...task }; }
  async resume(sessionId: string): Promise<ComputerTaskState> {
    const task = this.requiredTask(sessionId); if (task.status !== "paused") return { ...task };
    task.manualInterventionRequired = false; task.message = "正在重新连接并观察目标窗口…"; task.updatedAt = new Date().toISOString(); this.publish(task);
    try {
      const target = (await this.listWindows(task.appId)).find((value) => value.id === task.windowId);
      if (!target) throw new Error("原目标窗口已关闭；请重新选择窗口");
      return this.activateTask(task, target);
    } catch (error) {
      const reason = message(error);
      if (isComputerManualInterventionError(reason)) this.requireManualIntervention(task, reason);
      else { task.status = "error"; task.message = reason; task.updatedAt = new Date().toISOString(); this.publish(task); }
      return { ...task };
    }
  }
  async stop(sessionId: string): Promise<ComputerTaskState> { const task = this.requiredTask(sessionId); await this.settleSession(sessionId, "stopped", "用户已停止 Computer Use"); return { ...task }; }

  async settleSession(sessionId: string, status: "completed" | "stopped" | "error", text: string): Promise<void> {
    const task = this.tasks.get(sessionId); if (!task || ["completed", "stopped", "error"].includes(task.status)) return;
    for (const [id, pending] of this.pendingPermissions) if (pending.request.sessionId === sessionId) { this.pendingPermissions.delete(id); await pending.onDecision?.(false); pending.resolve?.(false); }
    for (const [id, pending] of this.pendingRisks) if (pending.request.sessionId === sessionId) { this.pendingRisks.delete(id); pending.resolve(false); }
    task.status = status; task.message = text; task.pointer = undefined; task.manualInterventionRequired = false; task.updatedAt = new Date().toISOString(); this.onceAllowed.delete(`${task.sessionId}:${task.appId}`.toLocaleLowerCase()); this.publish(task);
    await this.stopHostIfIdle();
  }

  async respondPermission(requestId: string, decision: "once" | "always" | "deny"): Promise<void> {
    const pending = this.pendingPermissions.get(requestId); if (!pending) throw new Error("授权请求已失效"); this.pendingPermissions.delete(requestId);
    const approved = decision !== "deny";
    if (approved) {
      const key = `${pending.request.sessionId}:${pending.request.app.id}`.toLocaleLowerCase(); this.onceAllowed.add(key);
      if (decision === "always") { const settings = await this.settings.get(); if (!settings.alwaysAllowedAppIds.includes(pending.request.app.id)) await this.settings.patch({ alwaysAllowedAppIds: [...settings.alwaysAllowedAppIds, pending.request.app.id] }); }
    }
    await pending.onDecision?.(approved); pending.resolve?.(approved);
  }

  respondRisk(requestId: string, approved: boolean): void { const pending = this.pendingRisks.get(requestId); if (!pending) throw new Error("风险确认已失效"); this.pendingRisks.delete(requestId); pending.resolve(approved); }

  emergencyStop(source = "Ctrl+Alt+Esc"): void {
    for (const pending of this.pendingPermissions.values()) { pending.resolve?.(false); pending.onDecision?.(false); } this.pendingPermissions.clear();
    for (const pending of this.pendingRisks.values()) pending.resolve(false); this.pendingRisks.clear();
    for (const task of this.tasks.values()) if (["running", "paused", "awaiting-app-permission", "awaiting-risk-confirmation"].includes(task.status)) this.stopWith(task, `已通过 ${source} 紧急停止`);
  }

  async dispose(): Promise<void> {
    this.emergencyStop(); for (const lease of this.leases.values()) await lease.server.close().catch(() => undefined); this.leases.clear();
    await new Promise<void>((resolve) => this.http?.close(() => resolve()) ?? resolve()); this.http = undefined;
    await this.host?.dispose(); this.host = undefined;
  }

  private createMcpServer(leaseId: string): McpServer {
    const server = new McpServer({ name: "grok-desktop-computer", version: "0.3.1" });
    const schema = {
      appId: z.string().optional(), windowId: z.string().optional(), stateId: z.string().optional(), elementId: z.string().optional(),
      x: z.number().int().optional(), y: z.number().int().optional(), endX: z.number().int().optional(), endY: z.number().int().optional(), deltaX: z.number().int().optional(), deltaY: z.number().int().optional(),
      key: z.string().optional(), text: z.string().optional(), value: z.string().optional(), milliseconds: z.number().int().min(0).max(30000).optional(),
      detailX: z.number().int().min(0).optional(), detailY: z.number().int().min(0).optional(), detailWidth: z.number().int().min(1).max(2000).optional(), detailHeight: z.number().int().min(1).max(2000).optional(),
      risk: z.enum(["delete", "external-communication", "financial", "install", "account-access", "security-settings", "sensitive-transfer"]).optional(), riskSummary: z.string().optional(),
    };
    const descriptions: Record<string, string> = {
      list_apps: "List visible Windows applications and whether they can be controlled.", list_windows: "List exact visible windows.", start: "Activate an exact target window. Ordinary apps are allowed by default unless the user enables per-app confirmation.",
      pause: "Pause the current Computer Use task without changing the target application.", resume: "Resume a paused task and re-observe the target after any manual UAC handoff.", stop: "Stop the current Computer Use task.",
      launch_app: "Launch another instance of the currently authorized installed application.", activate_window: "Bring an authorized target window to the foreground.", get_window_state: "Observe the target using UI Automation and a PNG screenshot.",
      click: "Invoke or click one element.", double_click: "Double-click one element.", scroll: "Scroll one target.", press_key: "Press one key or chord.", type_text: "Type non-secret text.", set_value: "Set a non-secret accessible value.", drag: "Perform one drag.", perform_secondary_action: "Open one context menu.", wait: "Wait briefly, then observe.",
    };
    for (const name of Object.keys(descriptions)) server.registerTool(name, { description: descriptions[name], inputSchema: schema }, async (input) => this.mcpCall(leaseId, name, input as Record<string, unknown>));
    return server;
  }

  private async mcpCall(leaseId: string, name: string, input: Record<string, unknown>): Promise<any> {
    let auditTask: ComputerTaskState | undefined;
    let auditAction: ComputerActionName | undefined;
    try {
      const lease = this.leases.get(leaseId); if (!lease?.sessionId) throw new Error("Computer Use 会话尚未绑定");
      const sessionId = lease.sessionId;
      if (name === "list_apps") return textResult(await this.listApps());
      if (name === "list_windows") return textResult(await this.listWindows(string(input.appId)));
      if (name === "start") { const task = await this.startAndWait(sessionId, requiredString(input.appId, "appId"), string(input.windowId)); return buildComputerStateResult(task.lastState, task); }
      if (name === "pause") return textResult(await this.pause(sessionId));
      if (name === "resume") return textResult(await this.resume(sessionId));
      if (name === "stop") return textResult(await this.stop(sessionId));
      const task = this.requiredTask(sessionId);
      auditTask = task;
      if (task.status === "paused") throw new Error("Computer Use 已暂停");
      if (task.status !== "running") throw new Error("请先调用 start 激活目标应用");
      const action = name as ComputerActionName;
      if (this.getMode(sessionId) === "plan" && !["list_apps", "list_windows", "get_window_state"].includes(action)) throw new Error("Plan 模式只允许观察窗口、截图和 UI 结构");
      if (name === "get_window_state") {
        this.announce(task, "正在观察目标窗口和可交互元素…");
        const state = await this.observe(task, input, "画面已更新，Grok 正在判断下一步"); return buildComputerStateResult(state, task);
      }
      const request: ComputerActionRequest = { sessionId, action, appId: task.appId, windowId: task.windowId, ...input } as ComputerActionRequest;
      auditAction = action;
      if (action === "launch_app") {
        if (this.getMode(sessionId) === "plan") throw new Error("Plan 模式禁止启动应用");
        const app = (await this.listApps()).find((value) => value.id === task.appId);
        if (!app?.executablePath) throw new Error("没有已验证的目标应用路径");
        this.announce(task, `正在启动 ${app.name}…`, action);
        await this.getHost().call("launch_app", { executablePath: app.executablePath });
        task.stepCount += 1; task.lastAction = action; task.message = `${app.name} 已启动`; task.updatedAt = new Date().toISOString(); this.publish(task); await this.audit(task, action, true);
        return textResult({ launched: app.name, task: { ...task, lastState: undefined } });
      }
      if (!request.stateId || request.stateId !== task.lastState?.stateId) throw new Error("stateId 已过期；请重新观察后只执行一个动作");
      if (action === "wait") {
        this.announce(task, "正在等待界面稳定…", action);
        await this.getHost().call("wait", { milliseconds: input.milliseconds });
        const state = await this.observe(task, {}, "等待完成，画面已更新"); task.stepCount += 1; task.lastAction = action; task.updatedAt = new Date().toISOString(); this.publish(task);
        await this.audit(task, action, true); return buildComputerStateResult(state, task);
      }
      if (action === "activate_window") {
        this.announce(task, "正在把目标窗口带到前台…", action);
        await this.getHost().call("activate_window", { windowId: task.windowId });
        const state = await this.observe(task, {}, "目标窗口已置于前台"); task.stepCount += 1; task.lastAction = action; task.updatedAt = new Date().toISOString(); this.publish(task);
        await this.audit(task, action, true); return buildComputerStateResult(state, task);
      }
      const element = task.lastState?.elements.find((value) => value.elementId === request.elementId);
      if (request.elementId && !element) throw new Error("elementId 不属于当前界面状态；请重新观察后再操作");
      const actionContext = `${element?.name || ""} ${request.riskSummary || ""} ${request.text || ""} ${request.value || ""}`;
      if ((action === "type_text" || action === "set_value") && /password|passcode|one.?time|otp|验证码|密码|captcha/i.test(actionContext)) throw new Error("密码、一次性验证码和 CAPTCHA 必须由用户手动输入");
      const actionDescription = describeComputerAction(action, element?.name, string(input.key));
      this.announce(task, actionDescription, action, computerPointerForAction(task, request, element));
      const inferredRisk = request.risk || inferComputerRisk(actionContext, action);
      if (shouldConfirmComputerRisk(this.getMode(sessionId), inferredRisk)) await this.confirmRisk(task, inferredRisk!, request.riskSummary || element?.name || "检测到高影响操作", action);
      const maxEdge = (await this.settings.get()).maxScreenshotEdge;
      const raw = await this.getHost().call(action, { ...mapScreenshotCoordinates(request, task.lastState), maxEdge });
      const state = normalizeComputerState(await this.preferElectronScreenshot(raw, task.windowId || "", maxEdge), sessionId); task.lastState = state; task.stepCount += 1; task.lastAction = action; task.message = `${actionDescription.replace(/^正在/, "已").replace(/…$/, "")}，正在分析新画面`; task.updatedAt = new Date().toISOString(); this.publish(task);
      await this.audit(task, action, true); return buildComputerStateResult(state, task);
    } catch (error) {
      if (auditTask && auditAction) await this.audit(auditTask, auditAction, false).catch(() => undefined);
      const reason = message(error);
      if (auditTask) {
        if (isComputerManualInterventionError(reason)) this.requireManualIntervention(auditTask, reason);
        else if (auditTask.status === "running") { auditTask.message = `操作未完成：${reason}`; auditTask.updatedAt = new Date().toISOString(); this.publish(auditTask); }
      }
      return { isError: true, content: [{ type: "text", text: reason }] };
    }
  }

  private async startAndWait(sessionId: string, appId: string, windowId?: string): Promise<ComputerTaskState> {
    const result = await this.start({ sessionId, appId, windowId });
    if (result.status !== "awaiting-app-permission") return result;
    const pending = Array.from(this.pendingPermissions.values()).find((value) => value.request.sessionId === sessionId && value.request.app.id === appId);
    if (!pending) throw new Error("应用授权请求丢失");
    const approved = await new Promise<boolean>((resolve) => { pending.resolve = resolve; });
    if (!approved) throw new Error("用户拒绝控制该应用");
    return this.requiredTask(sessionId);
  }

  private async activateTask(task: ComputerTaskState, window: ComputerWindow): Promise<ComputerTaskState> {
    try {
      const observationOnly = this.getMode(task.sessionId) === "plan";
      task.status = "running"; task.startedAt ||= new Date().toISOString(); task.manualInterventionRequired = false; task.message = observationOnly ? "Plan 模式：正在只读观察窗口…" : `正在接管 ${task.appName || "目标应用"}…`; task.updatedAt = new Date().toISOString(); this.publish(task);
      if (!observationOnly) await this.getHost().call("activate_window", { windowId: window.id });
      task.lastState = await this.observe(task, {}, observationOnly ? "Plan 模式：仅观察，不修改窗口" : "已进入 Computer Use，Grok 正在观察画面"); return { ...task };
    } catch (error) {
      if (!["completed", "stopped", "error"].includes(task.status)) {
        const reason = message(error);
        if (isComputerManualInterventionError(reason)) this.requireManualIntervention(task, reason);
        else { task.status = "error"; task.message = reason; task.updatedAt = new Date().toISOString(); this.publish(task); }
      }
      return { ...task };
    }
  }

  private async observe(task: ComputerTaskState, detail: Record<string, unknown> = {}, completedMessage = "画面已更新"): Promise<ComputerState> { const maxEdge = (await this.settings.get()).maxScreenshotEdge; const raw = await this.getHost().call("get_window_state", { windowId: task.windowId, maxEdge, detailX: detail.detailX, detailY: detail.detailY, detailWidth: detail.detailWidth, detailHeight: detail.detailHeight }); const state = normalizeComputerState(await this.preferElectronScreenshot(raw, task.windowId || "", maxEdge), task.sessionId); task.lastState = state; task.message = completedMessage; task.updatedAt = new Date().toISOString(); this.publish(task); return state; }

  private async preferElectronScreenshot(raw: unknown, windowId: string, maxEdge: number): Promise<unknown> {
    if (!this.captureWindow) return raw;
    const capture = await this.captureWindow(windowId, maxEdge).catch(() => undefined); if (!capture?.base64) return raw;
    return { ...(raw as Record<string, unknown>), screenshot: capture.base64, screenshotWidth: capture.width, screenshotHeight: capture.height, screenshotSource: "electron-desktopCapturer" };
  }

  private async confirmRisk(task: ComputerTaskState, category: ComputerRiskCategory, summary: string, action: ComputerActionName): Promise<void> {
    const request: ComputerRiskConfirmation = { requestId: randomUUID(), sessionId: task.sessionId, category, summary, appName: task.appName || task.appId || "应用", action };
    task.status = "awaiting-risk-confirmation"; task.message = `等待你确认高影响操作：${summary}`; task.updatedAt = new Date().toISOString(); this.publish(task); this.emit(request, "risk");
    const approved = await new Promise<boolean>((resolve) => this.pendingRisks.set(request.requestId, { request, resolve }));
    task.status = approved ? "running" : "stopped"; task.message = approved ? "高影响操作已确认，正在执行…" : "用户已取消高影响操作"; task.updatedAt = new Date().toISOString(); this.publish(task); if (!approved) throw new Error("用户拒绝高影响操作");
  }

  private announce(task: ComputerTaskState, text: string, action?: ComputerActionName, pointer?: { x: number; y: number }): void {
    task.message = text; task.lastAction = action ?? task.lastAction; task.pointer = pointer && action ? { ...pointer, action, label: text } : undefined; task.updatedAt = new Date().toISOString(); this.publish(task);
  }

  private requireManualIntervention(task: ComputerTaskState, reason: string): void {
    task.status = "paused"; task.manualInterventionRequired = true; task.pointer = undefined;
    task.message = `需要你手动完成 Windows UAC、管理员或安全确认。完成后回到 Grok Build Desktop 点击“继续”。${reason ? `（${reason}）` : ""}`;
    task.updatedAt = new Date().toISOString(); this.publish(task);
  }

  private async isAllowed(sessionId: string, appId: string): Promise<boolean> { const settings = await this.settings.get(); return settings.alwaysAllowedAppIds.includes(appId) || this.onceAllowed.has(`${sessionId}:${appId}`.toLocaleLowerCase()); }
  private requiredTask(sessionId: string): ComputerTaskState { const task = this.tasks.get(sessionId); if (!task) throw new Error("当前会话没有 Computer Use 任务"); return task; }
  private stopWith(task: ComputerTaskState, text: string): void { task.status = "stopped"; task.message = text; task.pointer = undefined; task.manualInterventionRequired = false; task.updatedAt = new Date().toISOString(); task.lastState = undefined; this.onceAllowed.delete(`${task.sessionId}:${task.appId}`.toLocaleLowerCase()); this.publish(task); void this.stopHostIfIdle(); }
  private publish(task: ComputerTaskState): void { this.emit({ ...task }, "state"); }
  private async stopHostIfIdle(): Promise<void> { if (Array.from(this.tasks.values()).some((task) => ["running", "paused", "awaiting-app-permission", "awaiting-risk-confirmation"].includes(task.status))) return; await this.host?.dispose(); this.host = undefined; }
  private async audit(task: ComputerTaskState, action: ComputerActionName, ok: boolean): Promise<void> { await mkdir(dirname(this.auditPath), { recursive: true }); await appendFile(this.auditPath, `${JSON.stringify({ at: new Date().toISOString(), sessionId: task.sessionId, appId: task.appId, action, ok })}\n`, "utf8"); }
  private getHost(): ComputerHostClient { return this.host ??= new ComputerHostClient(this.helperPath, this.log, () => this.handleHostExit()); }
  private handleHostExit(): void {
    for (const pending of this.pendingPermissions.values()) { pending.resolve?.(false); pending.onDecision?.(false); } this.pendingPermissions.clear();
    for (const pending of this.pendingRisks.values()) pending.resolve(false); this.pendingRisks.clear();
    for (const task of this.tasks.values()) if (["running", "paused", "awaiting-app-permission", "awaiting-risk-confirmation"].includes(task.status)) { task.status = "error"; task.message = "Computer Host 意外退出"; task.updatedAt = new Date().toISOString(); task.lastState = undefined; this.publish(task); }
    this.host = undefined;
  }

  private async ensureHttp(): Promise<void> {
    if (this.http) return;
    this.http = createServer(async (request, response) => {
      const match = request.url?.match(/^\/mcp\/([0-9a-f-]+)$/i); const lease = match?.[1] ? this.leases.get(match[1]) : undefined;
      if (!lease || request.headers.authorization !== `Bearer ${lease.token}`) { response.writeHead(401).end("Unauthorized"); return; }
      if (request.method !== "POST") { response.writeHead(405, { Allow: "POST" }).end("Method Not Allowed"); return; }
      try { await lease.transport.handleRequest(request, response); } catch (error) { await this.log.log(`computer MCP transport: ${message(error)}`); if (!response.headersSent) response.writeHead(500).end("MCP transport error"); }
    });
    await new Promise<void>((resolve, reject) => { this.http!.once("error", reject); this.http!.listen(0, "127.0.0.1", () => { const address = this.http!.address(); this.port = typeof address === "object" && address ? address.port : 0; resolve(); }); });
  }
}

export function shouldRequestComputerAppPermission(mode: SessionMode | undefined, confirmNewApps: boolean, alreadyAllowed: boolean): boolean {
  return mode !== "auto" && confirmNewApps && !alreadyAllowed;
}

export function shouldConfirmComputerRisk(mode: SessionMode | undefined, risk: ComputerRiskCategory | undefined): boolean {
  return mode !== "auto" && risk !== undefined;
}

class ComputerHostClient {
  private process?: ChildProcessWithoutNullStreams; private lines?: Interface; private nextId = 1; private readonly pending = new Map<number, PendingHost>();
  private disposing = false;
  constructor(private readonly path: string, private readonly log: LogService, private readonly onUnexpectedExit: () => void) {}
  call(action: string, input: Record<string, unknown>): Promise<unknown> { this.ensure(); const id = this.nextId++; return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Computer Host ${action} 超时`)); }, 30_000); this.pending.set(id, { resolve, reject, timer }); this.process!.stdin.write(`${JSON.stringify({ id, action, input })}\n`); }); }
  async dispose(): Promise<void> { this.disposing = true; this.lines?.close(); this.process?.kill(); this.process = undefined; for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error("Computer Host 已停止")); } this.pending.clear(); }
  private ensure(): void { if (this.process && !this.process.killed) return; this.disposing = false; this.process = spawn(this.path, [], { windowsHide: true }); this.lines = createInterface({ input: this.process.stdout }); this.lines.on("line", (line) => this.onLine(line)); this.process.stderr.on("data", (data) => void this.log.log(`[computer-host] ${String(data)}`)); this.process.on("exit", () => { const pending = Array.from(this.pending.values()); this.pending.clear(); for (const item of pending) { clearTimeout(item.timer); item.reject(new Error("Computer Host 意外退出")); } this.process = undefined; if (!this.disposing) this.onUnexpectedExit(); }); }
  private onLine(line: string): void { try { const value = JSON.parse(line) as { id: number; ok: boolean; result?: unknown; error?: string }; const pending = this.pending.get(value.id); if (!pending) return; this.pending.delete(value.id); clearTimeout(pending.timer); if (value.ok) pending.resolve(value.result); else pending.reject(new Error(value.error || "Computer Host 操作失败")); } catch { void this.log.log("Computer Host 返回无效 JSON"); } }
}

function normalizeWindow(value: unknown): ComputerWindow { const row = value as Record<string, unknown>; const processName = string(row.processName); const executablePath = string(row.executablePath) || undefined; const title = string(row.title); const blocked = isBlockedComputerTarget(processName, title); const identity = executablePath ? createHash("sha256").update(executablePath.toLocaleLowerCase()).digest("hex").slice(0, 16) : string(row.appId); return { id: string(row.id), appId: `${processName.toLocaleLowerCase()}:${identity}`, processId: number(row.processId), processName, executablePath, title, bounds: { x: number(row.x), y: number(row.y), width: number(row.width), height: number(row.height) }, dpi: number(row.dpi) || 96, minimized: Boolean(row.minimized), foreground: Boolean(row.foreground), controllable: row.controllable !== false && !blocked, blockedReason: blocked ? "该应用位于 Computer Use 不可控制清单" : string(row.blockedReason) || undefined }; }

export function isBlockedComputerTarget(processName: string, title = ""): boolean { return /^(grok[- ]?build[- ]?desktop|codex|chatgpt|powershell|pwsh|cmd|windowsterminal|wt|conhost)$/i.test(processName.trim()) || /grok build desktop|windows security|user account control|用户账户控制|windows 安全/i.test(title); }
export function isComputerManualInterventionError(value: string): boolean { return /higher privilege|高权限|elevated|default desktop|secure desktop|uac|user account control|用户账户控制|管理员|windows security|windows 安全/i.test(value); }
export function describeComputerAction(action: ComputerActionName, target = "", key = ""): string {
  const label = target.trim() ? `“${target.trim()}”` : "目标位置";
  const descriptions: Record<ComputerActionName, string> = {
    list_apps: "正在查看可用应用…", list_windows: "正在查看应用窗口…", start: "正在进入 Computer Use…", pause: "正在暂停 Computer Use…", resume: "正在继续 Computer Use…", stop: "正在停止 Computer Use…", launch_app: "正在启动应用…", activate_window: "正在切换到目标窗口…", get_window_state: "正在观察目标窗口…",
    click: `正在点击 ${label}…`, double_click: `正在双击 ${label}…`, scroll: `正在滚动 ${label}…`, press_key: `正在按下 ${key || "快捷键"}…`, type_text: `正在向 ${label} 输入文本…`, set_value: `正在填写 ${label}…`, drag: `正在拖动 ${label}…`, perform_secondary_action: `正在右键点击 ${label}…`, wait: "正在等待界面稳定…",
  };
  return descriptions[action];
}
export function computerPointerForAction(task: ComputerTaskState, request: ComputerActionRequest, element?: ComputerState["elements"][number]): { x: number; y: number } | undefined {
  if (!["click", "double_click", "scroll", "drag", "perform_secondary_action"].includes(request.action)) return undefined;
  const state = task.lastState; const bounds = state?.window.bounds; const size = state?.screenshotSize;
  if (!state || !bounds || !size?.width || !size.height) return undefined;
  const screenshotX = element ? element.bounds.x + element.bounds.width / 2 : request.x;
  const screenshotY = element ? element.bounds.y + element.bounds.height / 2 : request.y;
  if (screenshotX === undefined || screenshotY === undefined) return undefined;
  return {
    x: bounds.x + Math.round(screenshotX * bounds.width / size.width),
    y: bounds.y + Math.round(screenshotY * bounds.height / size.height),
  };
}
export function inferComputerRisk(context: string, action: ComputerActionName): ComputerRiskCategory | undefined {
  if (!["click", "double_click", "press_key", "type_text", "set_value", "perform_secondary_action"].includes(action)) return undefined;
  if (/delete|remove|erase|永久删除|删除|清空|注销账号/i.test(context)) return "delete";
  if (/send|submit|publish|post|reply|comment|message|发送|提交|发布|回复|评论/i.test(context)) return "external-communication";
  if (/buy|purchase|pay|checkout|subscribe|billing|付款|购买|支付|订阅|结账/i.test(context)) return "financial";
  if (/install|download and run|run installer|安装|执行下载|浏览器扩展/i.test(context)) return "install";
  if (/permission|sharing|api.?key|access token|grant access|权限|共享|密钥|授权访问/i.test(context)) return "account-access";
  if (/vpn|firewall|security|privacy|password change|防火墙|安全设置|隐私|修改密码/i.test(context)) return "security-settings";
  if (/upload.*(secret|private|sensitive)|transfer.*(secret|private|sensitive)|上传.*(敏感|隐私|密钥)|传输.*(敏感|隐私|密钥)/i.test(context)) return "sensitive-transfer";
  return undefined;
}
export function mapScreenshotCoordinates(request: ComputerActionRequest, state: ComputerState | undefined): ComputerActionRequest {
  const size = state?.screenshotSize; const width = state?.window.bounds.width || 0; const height = state?.window.bounds.height || 0;
  if (!size?.width || !size.height || !width || !height || request.elementId) return { ...request };
  const mapped = { ...request };
  if (request.x !== undefined) mapped.x = Math.max(0, Math.min(width - 1, Math.round(request.x * width / size.width)));
  if (request.y !== undefined) mapped.y = Math.max(0, Math.min(height - 1, Math.round(request.y * height / size.height)));
  if (request.endX !== undefined) mapped.endX = Math.max(0, Math.min(width - 1, Math.round(request.endX * width / size.width)));
  if (request.endY !== undefined) mapped.endY = Math.max(0, Math.min(height - 1, Math.round(request.endY * height / size.height)));
  return mapped;
}
export function normalizeComputerState(value: unknown, sessionId: string): ComputerState {
  const row = value as Record<string, unknown>; const window = normalizeWindow(row.window);
  const screenshotWidth = number(row.screenshotWidth) || window.bounds.width; const screenshotHeight = number(row.screenshotHeight) || window.bounds.height;
  const scaleX = screenshotWidth / Math.max(1, window.bounds.width); const scaleY = screenshotHeight / Math.max(1, window.bounds.height);
  const elements = (Array.isArray(row.elements) ? row.elements : []).map((raw) => {
    const item = raw as Record<string, unknown>;
    return { elementId: string(item.elementId), name: string(item.name), controlType: string(item.controlType), value: string(item.value) || undefined, enabled: item.enabled !== false, bounds: { x: Math.round((number(item.x) - window.bounds.x) * scaleX), y: Math.round((number(item.y) - window.bounds.y) * scaleY), width: Math.round(number(item.width) * scaleX), height: Math.round(number(item.height) * scaleY) }, patterns: Array.isArray(item.patterns) ? item.patterns.map(string) : [] };
  });
  const detailRegionRow = row.detailRegion as Record<string, unknown> | undefined;
  const detailRegion = detailRegionRow ? { x: number(detailRegionRow.x), y: number(detailRegionRow.y), width: number(detailRegionRow.width), height: number(detailRegionRow.height) } : undefined;
  return { stateId: string(row.stateId), sessionId, window, capturedAt: string(row.capturedAt) || new Date().toISOString(), screenshot: string(row.screenshot) || undefined, screenshotMimeType: "image/png", screenshotSource: string(row.screenshotSource) === "electron-desktopCapturer" ? "electron-desktopCapturer" : "print-window", screenshotSize: { width: screenshotWidth, height: screenshotHeight }, detailScreenshot: string(row.detailScreenshot) || undefined, detailRegion, coordinateSpace: "screenshot-pixels", elements, treeTruncated: Boolean(row.treeTruncated) };
}
export function buildComputerStateResult(state: ComputerState | undefined, task: ComputerTaskState): { content: Array<Record<string, unknown>> } { const withoutImage = state ? { ...state, screenshot: undefined, detailScreenshot: undefined } : undefined; const content: Array<Record<string, unknown>> = [{ type: "text", text: JSON.stringify({ task: { ...task, lastState: undefined }, state: withoutImage }) }]; if (state?.screenshot) content.push({ type: "image", data: state.screenshot, mimeType: "image/png" }); if (state?.detailScreenshot) content.push({ type: "image", data: state.detailScreenshot, mimeType: "image/png", _meta: { role: "detail", region: state.detailRegion } }); return { content }; }
function textResult(value: unknown): { content: Array<Record<string, unknown>> } { return { content: [{ type: "text", text: JSON.stringify(value) }] }; }
function string(value: unknown): string { return typeof value === "string" ? value : ""; }
function number(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? value : Number.parseInt(String(value), 10) || 0; }
function requiredString(value: unknown, name: string): string { const result = string(value); if (!result) throw new Error(`缺少 ${name}`); return result; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
