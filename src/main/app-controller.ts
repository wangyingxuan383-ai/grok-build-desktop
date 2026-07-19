import { app, desktopCapturer, dialog, Notification, shell, type BrowserWindow } from "electron";
import { execFile } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join } from "node:path";
import type {
  AppSettings,
  Attachment,
  BootstrapData,
  ChatEvent,
  ReasoningEffort,
  SessionMode,
  SessionSummary,
  UiDensity,
  WorkspaceSummary,
  CodexSessionDetail,
  CodexSessionSummary,
  GrokQuotaSnapshot,
  MediaCapabilities,
  ComposerDraftState,
  PluginSummary,
  PluginDetails,
  PluginInstallPreview,
  MarketplaceSource,
  SkillSummary,
  McpServerSummary,
  McpDiagnostic,
  HookSummary,
  CodexPluginCompatibility,
  ComputerApp,
  ComputerWindow,
  ComputerTaskState,
  ComputerUseSettings,
  ComputerCapability,
  BuildInfo,
  OnboardingState,
  SystemCompatibilityReport,
  SupportBundlePreview,
  AppReleaseStatus,
  WorkspaceFileCandidate,
  AttachmentPrivacyFinding,
} from "../shared/types";
import { detectMediaCapabilities } from "../shared/media";
import { REASONING_EFFORTS } from "../shared/types";
import { AccountVault } from "./services/account-vault";
import { AuthService } from "./services/auth-service";
import { locateGrokCli } from "./services/cli-locator";
import { CliUpdateService } from "./services/cli-update-service";
import { GrokProcessManager } from "./services/grok-process-manager";
import { JsonStore } from "./services/json-store";
import { LogService, redactSecrets } from "./services/log-service";
import { SessionCatalog } from "./services/session-catalog";
import { CodexSessionCatalog } from "./services/codex-session-catalog";
import { WorkspaceCatalog } from "./services/workspace-catalog";
import { GrokQuotaService } from "./services/grok-quota-service";
import { UiStateService } from "./services/ui-state-service";
import { isAllowedExternalUrl } from "./security-policy";
import { ExtensionService } from "./services/extension-service";
import { CodexPluginService } from "./services/codex-plugin-service";
import { ComputerUseService } from "./services/computer-use-service";
import { loadAppConfig, createBuildInfo, type PublicAppConfig } from "./services/app-config";
import { OnboardingService } from "./services/onboarding-service";
import { DiagnosticsService } from "./services/diagnostics-service";
import { AppReleaseService } from "./services/app-release-service";
import { WorkspaceFileService } from "./services/workspace-file-service";
import { inspectAttachmentPrivacy } from "./services/attachment-privacy-service";
import { verifyResourceManifest, type ResourceIntegrityResult } from "./services/resource-integrity";
import { backupUiMetadataForVersion } from "./services/metadata-migration";

export const DEFAULT_SETTINGS: AppSettings = {
  cliPath: "",
  httpProxy: process.env.HTTP_PROXY || "",
  httpsProxy: process.env.HTTPS_PROXY || "",
  defaultModel: "",
  defaultEffort: "",
  defaultMode: "agent",
  showThinking: false,
  expandToolDetails: false,
  fontScale: 100,
  uiDensity: "balanced",
  recentWorkspaces: [],
  activeWorkspace: "",
  codexGroupCollapsed: true,
  showArchivedCodex: false,
};

export class AppController {
  private readonly settingsStore: JsonStore<AppSettings>;
  private readonly log: LogService;
  private readonly vault: AccountVault;
  private readonly catalog: SessionCatalog;
  private readonly processes: GrokProcessManager;
  private readonly auth: AuthService;
  private readonly updater: CliUpdateService;
  private readonly codex: CodexSessionCatalog;
  private readonly workspaces: WorkspaceCatalog;
  private readonly quota: GrokQuotaService;
  private readonly uiState: UiStateService;
  private readonly extensions: ExtensionService;
  private readonly codexPlugins: CodexPluginService;
  private readonly computer: ComputerUseService;
  private readonly appConfig: PublicAppConfig;
  private readonly buildInfo: BuildInfo;
  private readonly onboarding: OnboardingService;
  private readonly diagnostics: DiagnosticsService;
  private readonly appRelease: AppReleaseService;
  private readonly workspaceFiles = new WorkspaceFileService();
  private readonly resourceIntegrity: ResourceIntegrityResult;
  private window?: BrowserWindow;
  private computerStateObserver?: (state: ComputerTaskState) => void;
  private focusedSessionId = "";
  private readonly runningSessions = new Set<string>();

  constructor(private readonly userDataPath: string) {
    this.appConfig = loadAppConfig();
    this.buildInfo = createBuildInfo(this.appConfig);
    this.settingsStore = new JsonStore(join(userDataPath, "settings.json"), { ...DEFAULT_SETTINGS, cliPath: this.appConfig.mockCliPath });
    this.log = new LogService(join(userDataPath, "logs", "app.log"));
    this.vault = new AccountVault(userDataPath);
    this.catalog = new SessionCatalog(userDataPath);
    this.codex = new CodexSessionCatalog(userDataPath, this.log);
    this.workspaces = new WorkspaceCatalog(userDataPath, this.codex);
    this.uiState = new UiStateService(userDataPath);
    this.onboarding = new OnboardingService(userDataPath);
    const resourcesRoot = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), "resources");
    this.resourceIntegrity = verifyResourceManifest(resourcesRoot, app.isPackaged);
    const resourceSuffix = this.resourceIntegrity.ok ? "" : ".integrity-failed";
    this.computer = new ComputerUseService(
      userDataPath,
      join(resourcesRoot, "native", "win-x64", `GrokComputerHost.exe${resourceSuffix}`),
      join(resourcesRoot, "plugins", `grok-computer-use${resourceSuffix}`),
      this.log,
      (sessionId) => this.processes?.snapshot(sessionId)?.mode,
      (value, kind) => {
        if (kind === "state") {
          const state = value as ComputerTaskState;
          this.computerStateObserver?.(state);
          this.window?.webContents.send("grok:computer-state", state);
          void this.handleEvent({ type: "computer-state", sessionId: state.sessionId, state });
        } else if (kind === "permission") {
          const request = value as import("../shared/types").ComputerAppPermissionRequest;
          void this.handleEvent({ type: "computer-permission", sessionId: request.sessionId, request });
        } else {
          const request = value as import("../shared/types").ComputerRiskConfirmation;
          void this.handleEvent({ type: "computer-risk", sessionId: request.sessionId, request });
        }
      },
      async (windowId, maxEdge) => {
        let decimalId: string; try { decimalId = BigInt(`0x${windowId}`).toString(10); } catch { return undefined; }
        const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: maxEdge, height: maxEdge }, fetchWindowIcons: false });
        const source = sources.find((value) => value.id.startsWith(`window:${decimalId}:`)); if (!source || source.thumbnail.isEmpty()) return undefined;
        const size = source.thumbnail.getSize(); return { base64: source.thumbnail.toPNG().toString("base64"), width: size.width, height: size.height };
      },
    );
    this.processes = new GrokProcessManager(
      () => this.settingsStore.get(),
      () => this.auth?.activeApiKey(),
      this.log,
      (event) => void this.handleEvent(event),
      () => this.computer.createSessionInjection(),
      (leaseId, sessionId) => this.computer.bindLease(leaseId, sessionId),
      (leaseId) => void this.computer.releaseLease(leaseId),
      () => this.vault.mcpSecretEnvironment(),
    );
    this.auth = new AuthService(
      this.vault,
      () => this.settingsStore.get(),
      () => this.processes.stopAll(),
      this.log,
      (state) => this.window?.webContents.send("grok:login", state),
    );
    this.updater = new CliUpdateService(
      userDataPath,
      () => this.settingsStore.get(),
      () => this.auth.activeApiKey(),
      () => this.processes.suspendAll(),
      (snapshots) => this.processes.restoreAll(snapshots),
      this.log,
      {
        pluginDir: join(resourcesRoot, "plugins", `grok-computer-use${resourceSuffix}`),
        computerHostPath: join(resourcesRoot, "native", "win-x64", `GrokComputerHost.exe${resourceSuffix}`),
      },
    );
    this.quota = new GrokQuotaService(this.vault, () => this.settingsStore.get(), () => this.readCliVersion(), this.log);
    this.extensions = new ExtensionService(() => this.settingsStore.get(), (method, params) => this.processes.extensionRequest(method, params), this.log, (name, values) => this.vault.setMcpSecrets(name, values), (name) => this.vault.removeMcpSecrets(name), () => this.processes.reloadIdleExtensions());
    this.codexPlugins = new CodexPluginService(userDataPath, this.log);
    this.diagnostics = new DiagnosticsService(userDataPath, this.buildInfo, () => this.settingsStore.get(), () => this.auth.activeApiKey(), () => this.getComputerCapability(), this.log, this.appConfig.mockCliPath);
    this.appRelease = new AppReleaseService(this.buildInfo, this.log);
  }

  setWindow(window: BrowserWindow): void {
    this.window = window;
  }

  async bootstrap(): Promise<BootstrapData> {
    await backupUiMetadataForVersion(this.userDataPath, app.getVersion()).catch((error) => this.log.log(error));
    await this.auth.importCurrentIfNeeded().catch((error) => this.log.log(error));
    let settings = await this.settingsStore.get();
    if (settings.fontScale < 85) {
      settings = await this.settingsStore.patch({ fontScale: 100, uiDensity: "compact" });
    } else if (settings.fontScale > 130) {
      settings = await this.settingsStore.patch({ fontScale: 130 });
    }
    const cliPath = await locateGrokCli(settings.cliPath);
    const cli = cliPath ? { found: true, path: cliPath } : { found: false, error: "未找到 Grok CLI" };
    const changelog = await readFile(join(app.getAppPath(), "CHANGELOG.md"), "utf8").catch(() => "");
    return {
      settings,
      accounts: await this.vault.list(),
      sessions: await this.catalog.list(settings.activeWorkspace, "", this.processes.liveStatuses()),
      cli,
      login: this.auth.getLoginState(),
      updateHistory: await this.updater.history(),
      appVersion: app.getVersion(),
      changelog,
      workspaces: [],
      codexSessions: [],
      buildInfo: this.buildInfo,
      onboarding: await this.onboarding.get(),
    };
  }

  getBuildInfo(): BuildInfo { return this.buildInfo; }
  getOnboarding(): Promise<OnboardingState> { return this.onboarding.get(); }
  updateOnboarding(patch: Partial<OnboardingState>): Promise<OnboardingState> { return this.onboarding.update(patch); }
  resetOnboarding(): Promise<OnboardingState> { return this.onboarding.reset(); }
  runDiagnostics(): Promise<SystemCompatibilityReport> { return this.diagnostics.run(); }
  async previewSupportBundle(): Promise<SupportBundlePreview> { return this.diagnostics.preview(); }
  async exportSupportBundle(): Promise<string | null> {
    const target = await dialog.showSaveDialog(this.window!, { title: "导出脱敏支持包", defaultPath: `grok-build-desktop-support-${new Date().toISOString().slice(0, 10)}.zip`, filters: [{ name: "ZIP 压缩包", extensions: ["zip"] }] });
    if (target.canceled || !target.filePath) return null;
    await this.diagnostics.createBundle(target.filePath);
    return target.filePath;
  }
  checkAppUpdate(force = false): Promise<AppReleaseStatus> { return this.appRelease.check(force); }
  async openAppRelease(url?: string): Promise<void> { await shell.openExternal(this.appRelease.releaseUrl(url)); }

  async chooseWorkspace(): Promise<string | null> {
    const result = await dialog.showOpenDialog(this.window!, { title: "选择工作区", properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    await this.setWorkspace(result.filePaths[0]);
    return result.filePaths[0];
  }

  async setWorkspace(cwd: string): Promise<SessionSummary[]> {
    const settings = await this.settingsStore.get();
    const recent = [cwd, ...settings.recentWorkspaces.filter((value) => value.toLowerCase() !== cwd.toLowerCase())].slice(0, 12);
    await this.settingsStore.patch({ activeWorkspace: cwd, recentWorkspaces: recent });
    this.workspaceFiles.invalidate(cwd);
    return this.catalog.list(cwd, "", this.processes.liveStatuses());
  }

  async listSessions(cwd?: string, query = ""): Promise<SessionSummary[]> {
    const workspace = cwd || (await this.settingsStore.get()).activeWorkspace;
    return this.catalog.list(workspace, query, this.processes.liveStatuses());
  }

  async discoverWorkspaces(force = false): Promise<WorkspaceSummary[]> {
    return this.workspaces.discover(await this.settingsStore.get(), force);
  }

  async pinWorkspace(cwd: string, pinned: boolean): Promise<WorkspaceSummary[]> {
    return this.workspaces.pin(cwd, pinned, await this.settingsStore.get());
  }

  searchWorkspaceFiles(cwd: string, query: string, limit = 12): Promise<WorkspaceFileCandidate[]> { return this.workspaceFiles.search(cwd, query, limit); }
  async inspectAttachmentPrivacy(cwd: string, attachments: Attachment[]): Promise<AttachmentPrivacyFinding[]> { return inspectAttachmentPrivacy(cwd, attachments); }

  async createSession(cwd: string): Promise<{ sessionId: string }> {
    const result = await this.processes.create(cwd);
    this.focusedSessionId = result.sessionId;
    await this.catalog.markRead(result.sessionId);
    return result;
  }

  async openSession(cwd: string, sessionId: string): Promise<{ sessionId: string }> {
    this.focusedSessionId = sessionId;
    await this.catalog.markRead(sessionId);
    return this.processes.open(cwd, sessionId);
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    await this.catalog.rename(sessionId, title);
  }

  async deleteSession(cwd: string, sessionId: string): Promise<void> {
    await this.processes.close(sessionId);
    await this.catalog.delete(cwd, sessionId);
    if (this.focusedSessionId === sessionId) this.focusedSessionId = "";
  }

  async clearSessions(cwd: string, keepSessionId?: string): Promise<void> {
    await this.processes.stopAll();
    await this.catalog.clear(cwd, keepSessionId);
  }

  pinSession(sessionId: string, pinned: boolean): Promise<void> { return this.catalog.pin(sessionId, pinned); }

  async exportSessionMarkdown(cwd: string, sessionId: string): Promise<string | null> {
    const markdown = await this.catalog.exportMarkdown(cwd, sessionId);
    const target = await dialog.showSaveDialog(this.window!, { title: "导出会话 Markdown", defaultPath: `grok-session-${sessionId.slice(0, 8)}.md`, filters: [{ name: "Markdown", extensions: ["md"] }] });
    if (target.canceled || !target.filePath) return null;
    await writeFile(target.filePath, markdown, "utf8");
    return target.filePath;
  }

  async getMediaCapabilities(sessionId: string): Promise<MediaCapabilities> {
    return detectMediaCapabilities(await this.processes.waitForCommands(sessionId));
  }

  async sendPrompt(sessionId: string, text: string, attachments: Attachment[]): Promise<void> {
    await this.processes.get(sessionId).prompt(text, attachments);
  }

  async cancelSession(sessionId: string): Promise<void> {
    await this.computer.settleSession(sessionId, "stopped", "Grok 回合已停止，Computer Use 已清理");
    this.processes.get(sessionId).cancel();
  }

  async setModel(sessionId: string, modelId: string): Promise<void> {
    await this.processes.setModel(sessionId, modelId);
    await this.settingsStore.patch({ defaultModel: modelId });
  }

  async setEffort(sessionId: string, effort: ReasoningEffort): Promise<void> {
    if (!REASONING_EFFORTS.includes(effort)) throw new Error("不支持的推理强度");
    await this.processes.setEffort(sessionId, effort);
    await this.settingsStore.patch({ defaultEffort: effort });
  }

  async setMode(sessionId: string, mode: SessionMode): Promise<void> {
    await this.processes.get(sessionId).applyMode(mode);
    if (mode !== "plan") await this.settingsStore.patch({ defaultMode: mode });
  }

  async pickAttachments(): Promise<Attachment[]> {
    const result = await dialog.showOpenDialog(this.window!, { title: "添加文件或图片", properties: ["openFile", "multiSelections"] });
    if (result.canceled) return [];
    return this.attachmentsFromPaths(result.filePaths);
  }

  async attachmentsFromPaths(paths: string[]): Promise<Attachment[]> {
    return Promise.all(paths.map(async (path): Promise<Attachment> => {
      const info = await stat(path);
      const extension = extname(path).toLowerCase();
      const isImage = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"].includes(extension);
      if (isImage && info.size > 20 * 1024 * 1024) throw new Error(`${path} 超过 20 MiB 图片限制`);
      return { id: crypto.randomUUID(), name: path.split(/[\\/]/).at(-1) || path, path, size: info.size, kind: isImage ? "image" : "file", mimeType: mimeForExtension(extension) };
    }));
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    if (patch.fontScale !== undefined) patch.fontScale = Math.min(130, Math.max(85, patch.fontScale));
    if (patch.defaultEffort !== undefined && !REASONING_EFFORTS.includes(patch.defaultEffort)) throw new Error("不支持的默认推理强度");
    if (patch.uiDensity !== undefined && !isUiDensity(patch.uiDensity)) throw new Error("不支持的界面密度");
    return this.settingsStore.patch(patch);
  }

  listCodexSessions(cwd: string, includeArchived = false, force = false): Promise<CodexSessionSummary[]> {
    return this.codex.list(cwd, includeArchived, force);
  }

  openCodexSession(id: string): Promise<CodexSessionDetail> { return this.codex.open(id); }
  refreshCodexSession(id: string): Promise<CodexSessionDetail> { return this.codex.refresh(id); }
  hideCodexSession(id: string, hidden = true): Promise<void> { return this.codex.hide(id, hidden); }

  async continueCodexSession(id: string): Promise<{ sessionId: string; cwd: string }> {
    const detail = await this.codex.open(id, true);
    const before = detail.contentHash;
    const result = await this.processes.create(detail.cwd);
    this.focusedSessionId = result.sessionId;
    await this.catalog.markRead(result.sessionId);
    await this.codex.recordContinuation(id, result.sessionId);
    void (async () => {
      try {
        await this.processes.get(result.sessionId).prompt(`/resume-codex ${JSON.stringify(detail.path)}`, []);
      } catch (error) {
        await this.handleEvent({ type: "error", sessionId: result.sessionId, message: `Codex 接力失败：${error instanceof Error ? error.message : String(error)}` });
      } finally {
        const after = await this.codex.contentHash(id).catch(() => "");
        if (after !== before) {
          await this.log.log(`Codex read-only hash mismatch: ${id}`);
          await this.handleEvent({ type: "error", sessionId: result.sessionId, message: "Codex 原会话哈希发生变化；已记录只读约束诊断" });
        }
      }
    })();
    return { sessionId: result.sessionId, cwd: detail.cwd };
  }

  getQuota(force = false): Promise<GrokQuotaSnapshot> { return this.quota.get(force); }
  getDraft(key: string): Promise<ComposerDraftState | null> { return this.uiState.getDraft(key); }
  setDraft(key: string, text: string): Promise<void> { return this.uiState.setDraft(key, text); }
  clearDraft(key: string): Promise<void> { return this.uiState.clearDraft(key); }
  listPromptHistory(cwd: string): Promise<string[]> { return this.uiState.listPromptHistory(cwd); }
  appendPromptHistory(cwd: string, text: string): Promise<void> { return this.uiState.appendPromptHistory(cwd, text); }

  listPlugins(force = false): Promise<PluginSummary[]> { return this.extensions.listPlugins(force); }
  getPluginDetails(id: string): Promise<PluginDetails> { return this.extensions.details(id); }
  previewPlugin(source: string): Promise<PluginInstallPreview> { return this.extensions.preview(source); }
  pluginAction(id: string, action: "enable" | "disable" | "update" | "uninstall" | "reload"): Promise<PluginSummary[]> { return this.extensions.action(id, action); }
  installPlugin(source: string, trust: boolean, expectedFingerprint?: string): Promise<PluginSummary[]> { return this.extensions.install(source, trust, expectedFingerprint); }
  listMarketplace(force = false): Promise<MarketplaceSource[]> { return this.extensions.listMarketplace(force); }
  installMarketplacePlugin(source: string, name: string, trust: boolean): Promise<PluginSummary[]> { return this.extensions.installMarketplace(source, name, trust); }
  listSkills(): Promise<SkillSummary[]> { return this.extensions.listSkills(); }
  listMcpServers(force = false): Promise<McpServerSummary[]> { return this.extensions.listMcp(force); }
  diagnoseMcp(name?: string): Promise<McpDiagnostic[]> { return this.extensions.diagnoseMcp(name); }
  toggleMcp(name: string, enabled: boolean): Promise<McpServerSummary[]> { return this.extensions.toggleMcp(name, enabled); }
  upsertMcp(input: import("../shared/types").McpServerInput): Promise<McpServerSummary[]> { return this.extensions.upsertMcp(input); }
  triggerMcpAuth(name: string) { return this.extensions.triggerMcpAuth(name); }
  removeMcp(name: string): Promise<McpServerSummary[]> { return this.extensions.removeMcp(name); }
  listHooks(): Promise<HookSummary[]> { return this.extensions.listHooks(); }
  reloadExtensions(): Promise<void> { return this.extensions.reload(); }
  scanCodexPlugins(force = false): Promise<CodexPluginCompatibility[]> { return this.codexPlugins.scan(force); }
  adaptCodexPlugin(id: string): Promise<CodexPluginCompatibility[]> { return this.codexPlugins.adapt(id); }
  removeCodexPluginAdapter(id: string): Promise<CodexPluginCompatibility[]> { return this.codexPlugins.removeAdapter(id); }
  async getComputerCapability(): Promise<ComputerCapability> {
    const capability = await this.computer.capability();
    if (this.resourceIntegrity.ok) return capability;
    return { ...capability, available: false, diagnostics: [...this.resourceIntegrity.diagnostics, ...capability.diagnostics] };
  }
  listComputerApps(): Promise<ComputerApp[]> { return this.computer.listApps(); }
  listComputerWindows(appId?: string): Promise<ComputerWindow[]> { return this.computer.listWindows(appId); }
  startComputer(input: { sessionId: string; appId: string; windowId?: string }): Promise<ComputerTaskState> {
    if (!this.resourceIntegrity.ok) throw new Error(`Computer Use 资源完整性校验失败：${this.resourceIntegrity.diagnostics.join("；")}`);
    return this.computer.start(input);
  }
  pauseComputer(sessionId: string): Promise<ComputerTaskState> { return this.computer.pause(sessionId); }
  resumeComputer(sessionId: string): Promise<ComputerTaskState> { return this.computer.resume(sessionId); }
  stopComputer(sessionId: string): Promise<ComputerTaskState> { return this.computer.stop(sessionId); }
  respondComputerAppPermission(requestId: string, decision: "once" | "always" | "deny"): Promise<void> { return this.computer.respondPermission(requestId, decision); }
  async respondComputerRisk(requestId: string, approved: boolean): Promise<void> { this.computer.respondRisk(requestId, approved); }
  getComputerSettings(): Promise<ComputerUseSettings> { return this.computer.getSettings(); }
  updateComputerSettings(patch: Partial<ComputerUseSettings>): Promise<ComputerUseSettings> { return this.computer.updateSettings(patch); }
  setComputerStateObserver(observer: (state: ComputerTaskState) => void): void { this.computerStateObserver = observer; }
  emergencyStopComputer(source = "Ctrl+Alt+Esc"): void { this.computer.emergencyStop(source); }

  async exportLogs(): Promise<string | null> {
    const target = await dialog.showSaveDialog(this.window!, { title: "导出脱敏日志", defaultPath: "grok-build-desktop.log" });
    if (target.canceled || !target.filePath) return null;
    const content = await this.log.read();
    await writeFile(target.filePath, redactSecrets(content), "utf8");
    return target.filePath;
  }

  hasWorking(): boolean { return this.processes.hasWorking(); }
  getSettings(): Promise<AppSettings> { return this.settingsStore.get(); }
  listAccounts() { return this.vault.list(); }
  async loginDevice() { const result = await this.auth.loginDevice(); this.quota.clear(); return result; }
  async loginApiKey(label: string, key: string) { const result = await this.auth.addApiKey(label, key); this.quota.clear(); return result; }
  async logout() { const result = await this.auth.logout(); this.quota.clear(); return result; }
  async switchAccount(id: string) { const result = await this.auth.switchAccount(id); this.quota.clear(); return result; }
  async removeAccount(id: string) { const result = await this.auth.removeAccount(id); this.quota.clear(); return result; }
  checkCliUpdate() { return this.updater.check(); }
  applyCliUpdate() { return this.updater.apply(); }
  getCliUpdateHistory() { return this.updater.history(); }
  async openPath(path: string): Promise<void> {
    const extension = extname(path).toLowerCase();
    if (!isAbsolute(path) || ![".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".mp4", ".webm", ".mov", ".mkv"].includes(extension)) {
      throw new Error("仅允许打开 Grok 生成的图片或视频文件");
    }
    const info = await stat(path);
    if (!info.isFile()) throw new Error("媒体路径不是文件");
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
  }
  openExternal(url: string) {
    if (!isAllowedExternalUrl(url)) throw new Error("仅允许打开 HTTP/HTTPS 链接");
    return shell.openExternal(url);
  }
  respondPermission(sessionId: string, requestId: string | number, optionId: string) { this.processes.get(sessionId).respondPermission(requestId, optionId); }
  respondQuestion(sessionId: string, requestId: string | number, answers: Record<string, string>) { this.processes.get(sessionId).respondQuestion(requestId, answers); }
  respondPlan(sessionId: string, requestId: string | number | undefined, verdict: "approved" | "rejected" | "cancelled", comment = "") { return this.processes.get(sessionId).respondPlan(requestId, verdict, comment); }

  async dispose(): Promise<void> {
    await this.auth.dispose();
    await this.processes.dispose();
    await this.computer.dispose();
  }

  private async handleEvent(event: ChatEvent): Promise<void> {
    if (event.type === "turn-completed") await this.computer.settleSession(event.sessionId, "completed", "Computer Use 回合已完成");
    if (event.type === "error" && event.sessionId) await this.computer.settleSession(event.sessionId, "error", event.message);
    if (event.type === "status" && event.status === "error") await this.computer.settleSession(event.sessionId, "error", event.text || "Grok 进程异常，Computer Use 已清理");
    this.window?.webContents.send("grok:event", event);
    if (event.type === "status" && (event.status === "working" || event.status === "needs-user")) this.runningSessions.add(event.sessionId);
    if (event.type === "status" && (event.status === "idle" || event.status === "error") && event.sessionId !== this.focusedSessionId) {
      await this.catalog.markUnread(event.sessionId, event.status === "error");
      if (this.runningSessions.delete(event.sessionId)) this.showSessionNotification(event.sessionId, event.status === "error");
    }
  }

  private showSessionNotification(sessionId: string, failed: boolean): void {
    if (!Notification.isSupported()) return;
    const snapshot = this.processes.snapshot(sessionId);
    if (!snapshot) return;
    const notification = new Notification({ title: failed ? "Grok 后台任务失败" : "Grok 后台任务已完成", body: failed ? "点击查看错误详情。" : "点击查看最终回复。", silent: false });
    notification.on("click", () => {
      if (!this.window) return;
      if (this.window.isMinimized()) this.window.restore();
      this.window.show(); this.window.focus();
      this.window.webContents.send("grok:navigate-session", { sessionId, cwd: snapshot.cwd });
    });
    notification.show();
  }

  private async readCliVersion(): Promise<string> {
    const settings = await this.settingsStore.get();
    const cliPath = await locateGrokCli(settings.cliPath);
    if (!cliPath) return "unknown";
    return new Promise((resolveVersion) => execFile(cliPath, ["--version"], { windowsHide: true, timeout: 10_000 }, (error, stdout, stderr) => {
      if (error) resolveVersion("unknown");
      else resolveVersion(String(stdout || stderr).match(/\d+\.\d+\.\d+/)?.[0] || String(stdout || stderr).trim() || "unknown");
    }));
  }
}

function mimeForExtension(extension: string): string | undefined {
  return extension === ".png" ? "image/png" : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".gif" ? "image/gif" : extension === ".webp" ? "image/webp" : undefined;
}

function isUiDensity(value: unknown): value is UiDensity {
  return value === "compact" || value === "balanced" || value === "comfortable";
}
