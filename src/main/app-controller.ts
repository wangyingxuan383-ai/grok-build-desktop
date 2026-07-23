import { app, desktopCapturer, dialog, nativeImage, nativeTheme, Notification, session, shell, type BrowserWindow } from "electron";
import { execFile, spawn } from "node:child_process";
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
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
  ComposerCapabilitySelection,
  ThemeSettings,
  CustomProviderInput,
  CustomProviderProfile,
  ProviderConnectivityResult,
  ProviderConnectionDraft,
  ProviderDraftProbeResult,
  ProviderModelCandidate,
  AutomationTask,
  AutomationTaskInput,
  AutomationRunRecord,
  AutomationGlobalPolicy,
  RewindPoint,
  SessionForkResult,
  BackgroundTaskSummary,
  NotificationInboxItem,
  OfflineUiFixture,
  CliCapabilitySnapshot,
  WorkspaceTreeNode,
  WorkspaceTreeOptions,
  EditorDocument,
  EditorOpenResult,
  EditorSaveInput,
  EditorSaveResult,
  GitBranchSummary,
  GitCommitDetails,
  GitCommitSummary,
  GitDiffResult,
  GitDiscardInput,
  GitOperationResult,
  GitRepositoryStatus,
  GitRepositoryTrust,
  GitWorkspaceCapability,
  GitReviewScope,
  GitReviewSnapshot,
  GitReviewIndex,
  GitReviewFileDetail,
  GitHunkActionInput,
  GrokWorktreeSummary,
  WorktreeApplyPreview,
  WorktreeApplyResult,
  WorktreeCreateInput,
  WorktreeGcPreview,
  MemoryEntry,
  MemoryDeletePreview,
  MemoryLayout,
  MemoryRememberPreview,
  MemorySaveInput,
  MemorySaveResult,
  MemorySettings,
  MemoryStructuredEntry,
  AgentDefinition,
  AgentDefinitionSaveInput,
  DefinitionActionResult,
  DefinitionMutationResult,
  DefinitionValidation,
  PersonaDefinition,
  PersonaDefinitionSaveInput,
  ExecutionProfileForkInput,
  ExecutionProfileLaunchInput,
  ExecutionProfileSaveInput,
  ExecutionProfileValidation,
  SessionExecutionAssignment,
  SessionExecutionProfile,
  SessionLaunchResult,
  AgentDashboardQuery,
  AgentDashboardSnapshot,
  AutomationHealthReport,
} from "../shared/types";
import { resolveAutomationExecutionPolicy } from "./services/automation-execution-policy";
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
import { DEFAULT_THEME, mergeThemeSettings, ThemeService } from "./services/theme-service";
import { ProviderService, validateGrokConfig } from "./services/provider-service";
import { AutomationService } from "./services/automation-service";
import { resolveAutomationSessionAction } from "./services/automation-session-lifecycle";
import { NotificationInboxService } from "./services/notification-inbox";
import { CliCapabilityService } from "./services/cli-capability-service";
import { WorkspaceTreeService } from "./services/workspace-tree-service";
import { EditorService } from "./services/editor-service";
import { GitService } from "./services/git-service";
import { WorktreeService } from "./services/worktree-service";
import { MemoryService } from "./services/memory-service";
import { AgentDefinitionService } from "./services/agent-definition-service";
import { ExecutionProfileService, type CompiledExecutionProfile } from "./services/execution-profile-service";
import { AgentDashboardService } from "./services/agent-dashboard-service";
import { checkAutomationHealth } from "./services/automation-health-service";
import { resolveExistingWorkspacePath } from "./services/workspace-path-policy";
import { AttachmentCacheService } from "./services/attachment-cache-service";
import { TurnPresentationService } from "./services/turn-presentation-service";

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
  sessionGroupCollapsed: { normal: false, fork: false, worktree: false, automation: true, "codex-continuation": true, other: true },
  showArchivedCodex: false,
  theme: structuredClone(DEFAULT_THEME),
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
  private readonly themeService: ThemeService;
  private readonly providers: ProviderService;
  private readonly automations: AutomationService;
  private readonly inbox: NotificationInboxService;
  private readonly cliCapabilities: CliCapabilityService;
  private readonly workspaceTree = new WorkspaceTreeService();
  private readonly editor = new EditorService();
  private readonly git: GitService;
  private readonly worktrees: WorktreeService;
  private readonly memory: MemoryService;
  private readonly definitions: AgentDefinitionService;
  private readonly profiles: ExecutionProfileService;
  private readonly dashboard: AgentDashboardService;
  private readonly attachmentCache: AttachmentCacheService;
  private readonly turnPresentations: TurnPresentationService;
  private window?: BrowserWindow;
  private computerStateObserver?: (state: ComputerTaskState) => void;
  private focusedSessionId = "";
  private readonly runningSessions = new Set<string>();

  constructor(private readonly userDataPath: string) {
    this.appConfig = loadAppConfig();
    this.buildInfo = createBuildInfo(this.appConfig);
    this.settingsStore = new JsonStore(join(userDataPath, "settings.json"), { ...DEFAULT_SETTINGS, cliPath: this.appConfig.mockCliPath });
    this.git = new GitService(userDataPath);
    this.memory = new MemoryService(userDataPath, () => this.settingsStore.get());
    this.themeService = new ThemeService(userDataPath, (path) => !nativeImage.createFromPath(path).isEmpty());
    this.log = new LogService(join(userDataPath, "logs", "app.log"));
    this.vault = new AccountVault(userDataPath);
    this.catalog = new SessionCatalog(userDataPath);
    this.attachmentCache = new AttachmentCacheService(userDataPath);
    this.turnPresentations = new TurnPresentationService(userDataPath);
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
      (cwd) => this.memory.sessionEnvironment(cwd),
      (sessionId, session) => this.finalizeMemorySession(sessionId, session),
    );
    this.definitions = new AgentDefinitionService(() => this.settingsStore.get(), {
      reload: {
        restartIdleSessions: () => this.processes.restartIdleSessions(),
        hasLiveSessions: () => this.processes.snapshots().length > 0,
      },
    });
    this.profiles = new ExecutionProfileService(userDataPath, { resolveWorkspaceIdentity: async (cwd) => (await this.memory.resolveLayout(cwd)).workspaceIdentity });
    this.dashboard = new AgentDashboardService(userDataPath);
    this.worktrees = new WorktreeService(userDataPath, this.git, { requestExtension: (method, params) => this.processes.extensionRequest(method, params) });
    this.auth = new AuthService(
      this.vault,
      () => this.settingsStore.get(),
      () => this.processes.stopAll(),
      this.log,
      (state) => this.window?.webContents.send("grok:login", state),
    );
    this.cliCapabilities = new CliCapabilityService(() => this.settingsStore.get(), () => this.auth.activeApiKey());
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
    this.appRelease = new AppReleaseService(this.buildInfo, this.log);
    this.inbox = new NotificationInboxService(userDataPath);
    const workerBaseArgs = app.isPackaged ? [] : [app.getAppPath()];
    this.automations = new AutomationService(userDataPath, this.log, {
      executable: process.execPath,
      workerBaseArgs,
      launchWorker: async (taskId, runId) => {
        const child = spawn(process.execPath, [...workerBaseArgs, "--scheduler-worker", taskId, runId], { detached: true, windowsHide: true, stdio: "ignore", env: { ...process.env, GROK_DESKTOP_AUTOMATION_WORKER: "1" } });
        child.once("exit", () => void this.automations.listRuns(taskId).then((runs) => {
          const run = runs.find((value) => value.id === runId);
          if (run) this.window?.webContents.send("grok:automation-event", { taskId, run });
        }).catch(() => undefined));
        child.unref();
      },
      onChanged: (event) => {
        this.window?.webContents.send("grok:automation-event", event);
        if (event.pending) this.showAutomationPendingNotification(event.pending);
        if (event.run?.status === "completed" || event.run?.status === "failed") void this.recordAutomationResult(event.run);
      },
    });
    this.providers = new ProviderService(userDataPath, this.log, {
      fetcher: async (input, init) => {
        const settings = await this.settingsStore.get();
        const network = session.fromPartition("grok-provider", { cache: false });
        const proxy = settings.httpsProxy || settings.httpProxy;
        await network.setProxy(proxy ? { proxyRules: proxy } : { mode: "system" });
        const target = input instanceof URL ? input.toString() : input;
        return network.fetch(target, init);
      },
      validateConfig: async () => {
        const settings = await this.settingsStore.get();
        const cliPath = await locateGrokCli(settings.cliPath);
        if (!cliPath) throw new Error("未找到 Grok CLI，无法验证提供商配置");
        await validateGrokConfig(cliPath, settings.activeWorkspace || process.cwd());
      },
      reloadModels: async () => {
        const result = await this.processes.extensionRequest("x.ai/internal/reload_models").catch(() => undefined);
        if (!result) await this.processes.reloadIdleExtensions();
      },
      references: async (providerId) => this.providerReferences(providerId),
    });
    this.diagnostics = new DiagnosticsService(userDataPath, this.buildInfo, () => this.settingsStore.get(), () => this.auth.activeApiKey(), () => this.getComputerCapability(), this.log, this.appConfig.mockCliPath, { providers: () => this.providers.list(), automations: () => this.automations.list() });
  }

  setWindow(window: BrowserWindow): void {
    this.window = window;
  }

  async prepareAppearance(): Promise<ThemeSettings> {
    const settings = await this.settingsStore.get();
    const theme = settings.theme ? mergeThemeSettings(DEFAULT_THEME, settings.theme) : structuredClone(DEFAULT_THEME);
    if (!settings.theme || JSON.stringify(theme) !== JSON.stringify(settings.theme)) await this.settingsStore.patch({ theme });
    applyNativeTheme(theme);
    return theme;
  }

  async bootstrap(): Promise<BootstrapData> {
    await backupUiMetadataForVersion(this.userDataPath, app.getVersion()).catch((error) => this.log.log(error));
    // Finish orphan cleanup before the renderer can restore or materialize
    // attachments. Running this in the background allowed sweep() to remove a
    // freshly-created session directory during a fast renderer reload.
    await this.catalog.allSessionIds().then((ids) => this.attachmentCache.sweep(ids)).catch(() => this.log.log("附件缓存清理失败"));
    if (process.env.GROK_DESKTOP_OFFLINE_SMOKE !== "1") await this.auth.importCurrentIfNeeded().catch((error) => this.log.log(error));
    let settings = await this.settingsStore.get();
    if (settings.fontScale < 85) {
      settings = await this.settingsStore.patch({ fontScale: 100, uiDensity: "compact" });
    } else if (settings.fontScale > 130) {
      settings = await this.settingsStore.patch({ fontScale: 130 });
    }
    await this.prepareAppearance();
    if (process.env.GROK_DESKTOP_OFFLINE_SMOKE !== "1" && process.env.GROK_DESKTOP_AUTOMATION_WORKER !== "1" && process.env.GROK_DESKTOP_SCHEDULER_UNINSTALL !== "1") void this.automations.repairRegistrations().catch((error) => this.log.log(`自动化注册修复失败：${error instanceof Error ? error.message : String(error)}`));
    settings = await this.settingsStore.get();
    const cliPath = await locateGrokCli(settings.cliPath);
    const cli = cliPath ? { found: true, path: cliPath } : { found: false, error: "未找到 Grok CLI" };
    const changelog = await readFile(join(app.getAppPath(), "CHANGELOG.md"), "utf8").catch(() => "");
    return {
      settings,
      accounts: await this.vault.list(),
      sessions: await this.listSessions(settings.activeWorkspace),
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
  getCliCapabilities(force = false): Promise<CliCapabilitySnapshot> { return this.cliCapabilities.get(force); }
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
    return this.listSessions(cwd);
  }

  async listSessions(cwd?: string, query = ""): Promise<SessionSummary[]> {
    const workspace = cwd || (await this.settingsStore.get()).activeWorkspace;
    await this.syncSessionOrigins(workspace);
    const assignments = (await this.profiles.listAssignments()).filter((value) => samePath(value.sourceWorkspacePath, workspace));
    const roots = [...new Set([workspace, ...assignments.map((value) => value.cwd)])];
    const rows = (await Promise.all(roots.map((root) => this.catalog.list(root, query, this.processes.liveStatuses())))).flat();
    const assignmentBySession = new Map(assignments.map((value) => [value.sessionId, value]));
    return rows.map((row) => {
      const assignment = assignmentBySession.get(row.id);
      return assignment ? { ...row, executionProfileId: assignment.profileId, worktreeId: assignment.worktreeId, originKind: assignment.worktreeId && row.originKind === "normal" ? "worktree" : row.originKind, originId: assignment.worktreeId ?? row.originId, originTitle: assignment.worktreeId ? assignment.profileName : row.originTitle } : row;
    }).filter((row, index, values) => values.findIndex((value) => value.id === row.id) === index).sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) || right.updatedAt.localeCompare(left.updatedAt));
  }

  private async syncSessionOrigins(cwd: string): Promise<void> {
    const [continuations, tasks, runs] = await Promise.all([
      this.codex.listContinuations(cwd).catch(() => []),
      this.automations.list().catch(() => []),
      this.automations.listRuns().catch(() => []),
    ]);
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const values: Parameters<SessionCatalog["recordOrigins"]>[0] = continuations.map((value) => ({
      sessionId: value.sessionId,
      kind: "codex-continuation",
      id: value.codexId,
      title: "Codex 接力",
      suggestedTitle: value.title,
    }));
    for (const task of tasks) {
      if (task.sessionId) values.push({ sessionId: task.sessionId, kind: "automation", id: task.id, title: task.name, suggestedTitle: task.name });
    }
    for (const run of runs) {
      if (!run.sessionId) continue;
      const task = taskById.get(run.taskId);
      if (task) values.push({ sessionId: run.sessionId, kind: "automation", id: task.id, title: task.name, suggestedTitle: task.name });
    }
    await this.catalog.recordOrigins(values);
  }

  async discoverWorkspaces(force = false): Promise<WorkspaceSummary[]> {
    return this.workspaces.discover(await this.settingsStore.get(), force);
  }

  async pinWorkspace(cwd: string, pinned: boolean): Promise<WorkspaceSummary[]> {
    return this.workspaces.pin(cwd, pinned, await this.settingsStore.get());
  }

  searchWorkspaceFiles(cwd: string, query: string, limit = 12): Promise<WorkspaceFileCandidate[]> { return this.workspaceFiles.search(cwd, query, limit); }
  listWorkspaceTree(cwd: string, directoryPath = "", options: WorkspaceTreeOptions = {}): Promise<WorkspaceTreeNode[]> { return this.workspaceTree.list(cwd, directoryPath, options); }
  openEditorDocument(cwd: string, path: string): Promise<EditorOpenResult> { return this.editor.open(cwd, path); }
  saveEditorDocument(input: EditorSaveInput): Promise<EditorSaveResult> { return this.editor.save(input).then((result) => { if (result.saved) this.workspaceFiles.invalidate(input.workspacePath); return result; }); }
  createEditorFile(cwd: string, path: string, content = ""): Promise<EditorDocument> { return this.editor.createFile(cwd, path, content).then((result) => { this.workspaceFiles.invalidate(cwd); return result; }); }
  createEditorDirectory(cwd: string, path: string): Promise<void> { return this.editor.createDirectory(cwd, path).then(() => { this.workspaceFiles.invalidate(cwd); }); }
  renameEditorPath(cwd: string, path: string, targetPath: string): Promise<string> { return this.editor.rename(cwd, path, targetPath).then((result) => { this.workspaceFiles.invalidate(cwd); return result; }); }
  deleteEditorPath(cwd: string, path: string, confirmed: boolean): Promise<void> { return this.editor.delete(cwd, path, confirmed).then(() => { this.workspaceFiles.invalidate(cwd); }); }
  async revealEditorPath(cwd: string, path: string): Promise<void> { const target = await resolveExistingWorkspacePath(cwd, path, false); shell.showItemInFolder(target.path); }
  getGitRepositoryTrust(cwd: string): Promise<GitRepositoryTrust> { return this.git.getRepositoryTrust(cwd); }
  getGitWorkspaceCapability(cwd: string): Promise<GitWorkspaceCapability> { return this.git.capability(cwd); }
  setGitRepositoryTrust(cwd: string, repositoryRoot: string, trusted: boolean): Promise<GitRepositoryTrust> { return this.git.setRepositoryTrust(cwd, repositoryRoot, trusted); }
  getGitStatus(cwd: string): Promise<GitRepositoryStatus> { return this.git.status(cwd); }
  getGitDiff(cwd: string, staged: boolean, path?: string): Promise<GitDiffResult> { return this.git.diff(cwd, staged, path); }
  getGitReview(cwd: string, scope: GitReviewScope): Promise<GitReviewSnapshot> { return this.git.review(cwd, scope); }
  getGitReviewIndex(cwd: string, scope: GitReviewScope): Promise<GitReviewIndex> { return this.git.reviewIndex(cwd, scope); }
  getGitReviewFileDetail(cwd: string, scope: GitReviewScope, snapshotId: string, fileId: string): Promise<GitReviewFileDetail> { return this.git.reviewFileDetail(cwd, scope, snapshotId, fileId); }
  applyGitReviewHunk(cwd: string, input: GitHunkActionInput): Promise<GitReviewSnapshot> { return this.git.applyReviewHunk(cwd, input); }
  stageGitChanges(cwd: string, paths?: string[]): Promise<GitRepositoryStatus> { return this.git.stage(cwd, paths); }
  unstageGitChanges(cwd: string, paths?: string[]): Promise<GitRepositoryStatus> { return this.git.unstage(cwd, paths); }
  commitGitChanges(cwd: string, message: string): Promise<GitCommitSummary> { return this.git.commit(cwd, message); }
  listGitBranches(cwd: string): Promise<GitBranchSummary[]> { return this.git.listBranches(cwd); }
  createGitBranch(cwd: string, name: string, startPoint?: string): Promise<GitRepositoryStatus> { return this.git.createBranch(cwd, name, startPoint); }
  switchGitBranch(cwd: string, name: string): Promise<GitRepositoryStatus> { return this.git.switchBranch(cwd, name); }
  listGitHistory(cwd: string, limit?: number): Promise<GitCommitSummary[]> { return this.git.history(cwd, limit); }
  getGitCommitDetails(cwd: string, hash: string): Promise<GitCommitDetails> { return this.git.commitDetails(cwd, hash); }
  discardGitChanges(cwd: string, input: GitDiscardInput): Promise<GitRepositoryStatus> { return this.git.discard(cwd, input); }
  pullGitRepository(cwd: string, operationId: string): Promise<GitOperationResult> { return this.git.pull(cwd, operationId); }
  pushGitRepository(cwd: string, operationId: string): Promise<GitOperationResult> { return this.git.push(cwd, operationId); }
  cancelGitOperation(operationId: string): boolean { return this.git.cancelOperation(operationId); }
  listWorktrees(cwd: string): Promise<GrokWorktreeSummary[]> { return this.worktrees.list(cwd); }
  createWorktree(input: WorktreeCreateInput): Promise<GrokWorktreeSummary> { return this.worktrees.create(input); }
  previewWorktreeApply(cwd: string, worktreeId: string): Promise<WorktreeApplyPreview> { return this.worktrees.previewApply(cwd, worktreeId); }
  applyWorktree(cwd: string, worktreeId: string, confirmationToken: string, confirmed: boolean, cleanup = false): Promise<WorktreeApplyResult> { return this.worktrees.apply(cwd, worktreeId, confirmationToken, confirmed, cleanup); }
  removeWorktree(cwd: string, worktreeId: string, confirmed: boolean): Promise<void> { return this.worktrees.remove(cwd, worktreeId, confirmed); }
  previewWorktreeGc(cwd: string): Promise<WorktreeGcPreview> { return this.worktrees.previewGc(cwd); }
  gcWorktrees(cwd: string, confirmationToken: string, confirmed: boolean): Promise<WorktreeGcPreview> { return this.worktrees.gc(cwd, confirmationToken, confirmed); }
  resolveMemoryLayout(cwd: string): Promise<MemoryLayout> { return this.memory.resolveLayout(cwd); }
  getMemorySettings(cwd: string): Promise<MemorySettings> { return this.memory.getSettingsForWorkspace(cwd); }
  async updateMemorySettings(cwd: string, patch: Partial<Pick<MemorySettings, "enabled" | "saveOnSessionEnd" | "autoDream">>, sessionId?: string): Promise<MemorySettings> {
    const previous = await this.memory.getSettingsForWorkspace(cwd);
    const enabledChanged = patch.enabled !== undefined && patch.enabled !== previous.enabled;
    const snapshot = enabledChanged && sessionId ? this.processes.snapshot(sessionId) : undefined;
    let affectsLiveSession = false;
    if (snapshot) {
      const [requestedLayout, sessionLayout] = await Promise.all([this.memory.resolveLayout(cwd), this.memory.resolveLayout(snapshot.cwd)]);
      affectsLiveSession = requestedLayout.workspaceIdentity === sessionLayout.workspaceIdentity;
      if (affectsLiveSession) {
        const adapter = this.processes.get(sessionId!);
        if (adapter.working || adapter.needsUser) throw new Error("当前会话正在运行或等待操作，完成后再切换 Memory");
      }
    }
    const updated = await this.memory.updateSettings(cwd, patch);
    if (!affectsLiveSession || !snapshot || !sessionId) return updated;
    try {
      const adapter = this.processes.get(sessionId);
      const hasNativeToggle = adapter.commands.some((command) => command.name.replace(/^\//, "") === "memory");
      if (!patch.enabled && hasNativeToggle) await adapter.prompt("/memory off");
      else await this.processes.restartSession(sessionId, patch.enabled ? "正在启用 Memory 并恢复会话…" : "正在关闭 Memory 并恢复会话…");
      return await this.memory.getSettingsForWorkspace(cwd);
    } catch (error) {
      await this.memory.updateSettings(cwd, { enabled: previous.enabled, saveOnSessionEnd: previous.saveOnSessionEnd, autoDream: previous.autoDream });
      try {
        if (this.processes.snapshot(sessionId)) await this.processes.restartSession(sessionId, "Memory 切换失败，正在恢复原设置…");
        else await this.processes.openConfigured(snapshot.cwd, snapshot.sessionId, snapshot.effort, snapshot.mode, snapshot.modelId ?? "");
      } catch (rollbackError) {
        throw new Error(`Memory 切换失败，且原会话恢复失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
      throw new Error(`Memory 切换失败，已恢复原设置：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  listMemory(cwd: string, query?: string): Promise<MemoryEntry[]> { return this.memory.list(cwd, query); }
  saveMemory(input: MemorySaveInput): Promise<MemorySaveResult> { return this.memory.save(input); }
  previewRemember(cwd: string, scope: "global" | "workspace", text: string): Promise<MemoryRememberPreview> { return this.memory.previewRemember(cwd, scope, text); }
  async rememberMemory(preview: MemoryRememberPreview, confirmationToken: string, confirmed: boolean, sessionId?: string): Promise<MemoryEntry> {
    if (!sessionId) return this.memory.remember(preview, confirmationToken, confirmed);
    await this.memory.confirmRememberPreview(preview, confirmationToken, confirmed);
    const session = this.processes.get(sessionId);
    if (session.working || session.needsUser) throw new Error("当前会话正在运行或等待操作");
    const [targetLayout, sessionLayout, before] = await Promise.all([this.memory.resolveLayout(preview.workspacePath), this.memory.resolveLayout(session.cwd), this.memory.list(preview.workspacePath)]);
    if (targetLayout.workspaceIdentity !== sessionLayout.workspaceIdentity) throw new Error("当前会话不属于所选 Memory 工作区");
    const settings = await this.memory.getSettingsForWorkspace(preview.workspacePath);
    if (!settings.enabled) throw new Error("请先为当前工作区启用 Memory");
    const previous = before.find((value) => value.id === preview.scope);
    const target = preview.scope === "global" ? "全局 Memory" : "当前工作区 Memory（不要写入全局 Memory）";
    await session.prompt(`/remember 请将下面的长期记忆整理并保存到${target}：\n\n${preview.text}`);
    const entry = (await this.memory.list(preview.workspacePath)).find((value) => value.id === preview.scope)!;
    if (entry.hash === previous?.hash) throw new Error("原生 /remember 未更新所选范围，请检查会话结果后重试");
    return entry;
  }
  listMemoryStructuredEntries(cwd: string, scope?: "global" | "workspace"): Promise<MemoryStructuredEntry[]> { return this.memory.listStructured(cwd, scope); }
  previewDeleteMemoryEntry(cwd: string, entryId: string): Promise<MemoryDeletePreview> { return this.memory.previewDelete(cwd, entryId); }
  deleteMemoryEntry(preview: MemoryDeletePreview, confirmationToken: string, confirmed: boolean): Promise<MemoryEntry> { return this.memory.deleteStructured(preview, confirmationToken, confirmed); }
  deleteSessionMemory(cwd: string, entryId: string, confirmed: boolean): Promise<void> { return this.memory.deleteSession(cwd, entryId, confirmed); }
  clearMemory(cwd: string, scope: "workspace" | "global" | "all", confirmed: boolean): Promise<MemoryEntry[]> { return this.memory.clear(cwd, scope, confirmed); }
  async runMemoryCommand(sessionId: string, command: "flush" | "dream"): Promise<MemorySettings> {
    const session = this.processes.get(sessionId);
    if (session.working || session.needsUser) throw new Error("当前会话正在运行或等待操作");
    await this.memory.markCommand(session.cwd, command, "running");
    try {
      await session.prompt(`/${command}`);
      return await this.memory.markCommand(session.cwd, command, "completed");
    } catch (error) {
      await this.memory.markCommand(session.cwd, command, "failed");
      throw error;
    }
  }
  listAgentDefinitions(cwd: string): Promise<AgentDefinition[]> { return this.definitions.listAgents(cwd); }
  validateAgentDefinition(rawMarkdown: string, expectedName?: string): DefinitionValidation { return this.definitions.validateAgent(rawMarkdown, expectedName); }
  saveAgentDefinition(input: AgentDefinitionSaveInput): Promise<DefinitionMutationResult<AgentDefinition>> { return this.definitions.saveAgent(input); }
  copyAgentDefinition(cwd: string, sourcePath: string, targetSource: "user" | "project", newName: string): Promise<DefinitionMutationResult<AgentDefinition>> { return this.definitions.copyAgent(cwd, sourcePath, targetSource, newName); }
  renameAgentDefinition(cwd: string, sourcePath: string, newName: string): Promise<DefinitionMutationResult<AgentDefinition>> { return this.definitions.renameAgent(cwd, sourcePath, newName); }
  setAgentDefinitionEnabled(cwd: string, sourcePath: string, enabled: boolean): Promise<DefinitionMutationResult<AgentDefinition>> { return this.definitions.setAgentEnabled(cwd, sourcePath, enabled); }
  deleteAgentDefinition(cwd: string, sourcePath: string, confirmed: boolean): Promise<DefinitionActionResult> { return this.definitions.deleteAgent(cwd, sourcePath, confirmed); }
  listPersonaDefinitions(cwd: string): Promise<PersonaDefinition[]> { return this.definitions.listPersonas(cwd); }
  validatePersonaDefinition(rawToml: string): DefinitionValidation { return this.definitions.validatePersona(rawToml); }
  savePersonaDefinition(input: PersonaDefinitionSaveInput): Promise<DefinitionMutationResult<PersonaDefinition>> { return this.definitions.savePersona(input); }
  copyPersonaDefinition(cwd: string, sourcePath: string, targetSource: "user" | "project", newName: string): Promise<DefinitionMutationResult<PersonaDefinition>> { return this.definitions.copyPersona(cwd, sourcePath, targetSource, newName); }
  renamePersonaDefinition(cwd: string, sourcePath: string, newName: string): Promise<DefinitionMutationResult<PersonaDefinition>> { return this.definitions.renamePersona(cwd, sourcePath, newName); }
  setPersonaDefinitionEnabled(cwd: string, sourcePath: string, enabled: boolean): Promise<DefinitionMutationResult<PersonaDefinition>> { return this.definitions.setPersonaEnabled(cwd, sourcePath, enabled); }
  deletePersonaDefinition(cwd: string, sourcePath: string, confirmed: boolean): Promise<DefinitionActionResult> { return this.definitions.deletePersona(cwd, sourcePath, confirmed); }
  listExecutionProfiles(cwd: string): Promise<SessionExecutionProfile[]> { return this.profiles.list(cwd); }
  validateExecutionProfile(profile: SessionExecutionProfile): ExecutionProfileValidation { return this.profiles.validate(profile); }
  saveExecutionProfile(input: ExecutionProfileSaveInput): Promise<SessionExecutionProfile[]> { return this.profiles.save(input); }
  deleteExecutionProfile(cwd: string, profileId: string, confirmed: boolean): Promise<SessionExecutionProfile[]> { return this.profiles.remove(cwd, profileId, confirmed); }
  getSessionExecutionAssignment(sessionId: string): Promise<SessionExecutionAssignment | undefined> { return this.profiles.assignment(sessionId); }
  async getAgentDashboard(query: AgentDashboardQuery): Promise<AgentDashboardSnapshot> {
    const [sessions, assignments, tasks] = await Promise.all([
      this.listSessions(query.workspacePath),
      this.profiles.listAssignments().then((values) => values.filter((value) => samePath(value.sourceWorkspacePath, query.workspacePath))),
      this.listBackgroundTasks(),
    ]);
    const liveSessions = this.processes.snapshots().filter((value) => assignments.some((assignment) => assignment.sessionId === value.sessionId) || samePath(value.cwd, query.workspacePath));
    const liveCapability = tasks.some((value) => value.kind === "subagent") ? "supported" as const : "unknown" as const;
    return this.dashboard.snapshot({ query, sessions, liveSessions, tasks, assignments, liveCapability });
  }
  async stopAgentDashboardNode(nodeId: string): Promise<void> {
    if (nodeId.startsWith("task:")) return this.killBackgroundTask(nodeId.slice("task:".length));
    const marker = ":subagent:";
    const at = nodeId.indexOf(marker);
    if (at >= 0) return this.processes.killBackgroundTask(nodeId.slice("session:".length, at), `subagent:${nodeId.slice(at + marker.length)}`);
    if (nodeId.startsWith("session:")) return this.cancelSession(nodeId.slice("session:".length));
    throw new Error("Agent Dashboard 节点标识无效");
  }
  clearAgentDashboardRecord(nodeId?: string): Promise<void> { return this.dashboard.clear(nodeId); }
  async inspectAttachmentPrivacy(cwd: string, attachments: Attachment[]): Promise<AttachmentPrivacyFinding[]> { return inspectAttachmentPrivacy(cwd, attachments); }

  async createSession(input: string | ExecutionProfileLaunchInput): Promise<SessionLaunchResult> {
    const launch = typeof input === "string" ? { workspacePath: input } : input;
    const workspace = (await resolveExistingWorkspacePath(launch.workspacePath, ".", true)).path;
    const compiled = await this.compileExecutionProfile(workspace, launch.profileId);
    let targetCwd = workspace;
    let worktree: GrokWorktreeSummary | undefined;
    if (compiled.profile.worktree) {
      worktree = await this.worktrees.create({ workspacePath: workspace, name: launch.worktreeName?.trim() || `${profileSlug(compiled.profile.name)}-${new Date().toISOString().slice(0, 10)}`, baseRef: launch.worktreeRef?.trim() || compiled.profile.worktreeRef, agentId: compiled.profile.agentId });
      targetCwd = worktree.path;
    }
    const settings = await this.settingsStore.get();
    let result: { sessionId: string };
    try {
      result = await this.processes.createConfigured(targetCwd, compiled.effort || settings.defaultEffort, compiled.mode, compiled.modelId || settings.defaultModel, undefined, compiled.environment, { agentProfilePath: compiled.agentProfilePath, sessionMeta: compiled.sessionMeta, alwaysApprove: compiled.mode === "auto" });
    } catch (error) {
      if (worktree) await this.worktrees.remove(workspace, worktree.id, true).catch(() => undefined);
      throw error;
    }
    void this.cliCapabilities.recordRuntimeSupport(["acp.initialize", "acp.sessionNew"]).catch((error) => this.log.log(error));
    this.focusedSessionId = result.sessionId;
    await this.catalog.markRead(result.sessionId);
    const assignment: SessionExecutionAssignment = { sessionId: result.sessionId, sourceWorkspacePath: workspace, cwd: targetCwd, profileId: compiled.profile.id, profileName: compiled.profile.name, profile: compiled.profile, worktreeId: worktree?.id, createdAt: new Date().toISOString() };
    await this.profiles.assign(assignment);
    if (worktree) await this.catalog.recordOrigins([{ sessionId: result.sessionId, kind: "worktree", id: worktree.id, title: compiled.profile.name, suggestedTitle: worktree.name }]);
    return { sessionId: result.sessionId, cwd: targetCwd, profileId: compiled.profile.id, worktreeId: worktree?.id };
  }

  async openSession(cwd: string, sessionId: string): Promise<{ sessionId: string }> {
    this.focusedSessionId = sessionId;
    await this.catalog.markRead(sessionId);
    const assignment = await this.profiles.assignment(sessionId);
    const targetCwd = assignment?.cwd ?? cwd;
    const result = assignment
      ? await this.openAssignedSession(assignment)
      : await this.processes.open(cwd, sessionId);
    const attachmentEntries = await this.attachmentCache.restore(sessionId);
    if (attachmentEntries.length) await this.handleEvent({ type: "user-attachments-restore", sessionId, entries: attachmentEntries });
    const presentations = await this.turnPresentations.list(sessionId);
    this.processes.get(sessionId).setNextTurnOrdinal(presentations.length);
    await this.handleEvent({ type: "turn-presentations-restore", sessionId, presentations });
    void this.cliCapabilities.recordRuntimeSupport(["acp.initialize"]).catch((error) => this.log.log(error));
    return result;
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    await this.catalog.rename(sessionId, title);
  }

  async deleteSession(cwd: string, sessionId: string): Promise<void> {
    const assignment = await this.profiles.assignment(sessionId);
    await this.processes.close(sessionId);
    await this.catalog.delete(assignment?.cwd ?? cwd, sessionId);
    await this.profiles.removeAssignment(sessionId);
    await this.dashboard.clear(`session:${sessionId}`);
    await this.attachmentCache.cleanupSession(sessionId);
    await this.turnPresentations.delete(sessionId);
    if (this.focusedSessionId === sessionId) this.focusedSessionId = "";
  }

  async clearSessions(cwd: string, keepSessionId?: string): Promise<void> {
    const removedSessionIds = (await this.catalog.list(cwd)).map((session) => session.id).filter((id) => id !== keepSessionId);
    await this.processes.stopAll();
    await this.catalog.clear(cwd, keepSessionId);
    for (const assignment of (await this.profiles.listAssignments()).filter((value) => samePath(value.sourceWorkspacePath, cwd) && value.sessionId !== keepSessionId)) {
      await this.catalog.delete(assignment.cwd, assignment.sessionId).catch(() => undefined);
      await this.profiles.removeAssignment(assignment.sessionId);
    }
    await Promise.all(removedSessionIds.flatMap((sessionId) => [this.attachmentCache.cleanupSession(sessionId), this.turnPresentations.delete(sessionId)]));
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

  async sendPrompt(sessionId: string, text: string, attachments: Attachment[], clientMessageId?: string): Promise<void> {
    clientMessageId ??= crypto.randomUUID();
    const prepared = await this.attachmentCache.prepare(sessionId, attachments);
    await this.attachmentCache.record(sessionId, clientMessageId, text, prepared.previews, "sending");
    try {
      await this.processes.get(sessionId).prompt(text, prepared.attachments, 1_800_000, { clientMessageId, attachments: prepared.previews });
      await this.attachmentCache.updateDelivery(sessionId, clientMessageId, "sent");
    } catch (error) {
      await this.attachmentCache.updateDelivery(sessionId, clientMessageId, "failed");
      await this.handleEvent({ type: "user-message", sessionId, id: clientMessageId, clientMessageId, text, attachments: prepared.previews, delivery: "failed" });
      throw error;
    }
  }

  async getOfflineUiFixture(): Promise<OfflineUiFixture | null> {
    if (process.env.GROK_DESKTOP_OFFLINE_SMOKE !== "1" || process.env.GROK_DESKTOP_UI_FIXTURE !== "1") return null;
    const sessionId = "offline-ui-fixture-v062";
    const workspace = (await this.settingsStore.get()).activeWorkspace || process.cwd();
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlWQAAAAASUVORK5CYII=";
    const imageAttachments: Attachment[] = ["architecture.png", "result.png", "detail.png"].map((name, index) => ({ id: `fixture-image-${index + 1}`, name, kind: "image", mimeType: "image/png", size: 68, data: png }));
    const prepared = await this.attachmentCache.prepare(sessionId, imageAttachments);
    await this.attachmentCache.record(sessionId, "fixture-client-images", "请检查这些界面截图。", prepared.previews, "sent");
    const failed = await this.attachmentCache.prepare(sessionId, [{ id: "fixture-failed-image", name: "retry.png", kind: "image", mimeType: "image/png", size: 68, data: png }]);
    await this.attachmentCache.record(sessionId, "fixture-client-failed", "这条消息用于测试失败恢复。", failed.previews, "failed");
    const now = new Date().toISOString();
    const session: SessionSummary = { id: sessionId, cwd: workspace, title: "0.6.2 Review 与会话验收", createdAt: now, updatedAt: now, messageCount: 34, status: "cold", pinned: true, originKind: "normal" };
    const legacyEvents: ChatEvent[] = Array.from({ length: 30 }, (_, index): ChatEvent[] => [
      { type: "tool-call", sessionId, tool: { toolCallId: `legacy-read-${index}`, title: `历史读取 ${index + 1}`, kind: "read_file", status: index % 11 === 0 ? "failed" : "completed", output: `历史执行片段 ${index + 1}`, locations: [{ path: "src/renderer/src/App.tsx", line: index + 1 }] } },
      { type: "turn-completed", sessionId },
    ]).flat();
    const events: ChatEvent[] = [
      { type: "session-ready", sessionId, models: [{ modelId: "fixture-model", name: "Offline Fixture", totalContextTokens: 512_000 }], currentModelId: "fixture-model", effort: "high" },
      ...legacyEvents,
      { type: "turn-presentations-restore", sessionId, presentations: [{ turnId: "fixture-client-images", clientMessageId: "fixture-client-images", ordinal: 0, startedAt: "2026-07-22T07:00:00.000Z", completedAt: "2026-07-22T07:01:23.000Z", durationMs: 83_000, outcome: "completed" }] },
      { type: "user-message", sessionId, id: "fixture-client-images", clientMessageId: "fixture-client-images", text: "请检查这些界面截图。", attachments: prepared.previews, delivery: "sent" },
      { type: "thought-chunk", sessionId, text: "正在核对布局、交互状态和附件可见性。" },
      { type: "tool-call", sessionId, tool: { toolCallId: "fixture-read", title: "读取界面结构", kind: "read_file", status: "completed", output: "已读取会话壳层。", locations: [{ path: "src/renderer/src/App.tsx", line: 1 }] } },
      { type: "tool-call", sessionId, tool: { toolCallId: "fixture-edit", title: "修改会话样式", kind: "edit_file", status: "completed", output: "已更新消息与附件布局。", oldText: ".message { width: 100%; }", newText: ".message { width: min(760px, 100%); }", locations: [{ path: "src/renderer/src/styles.css", line: 1 }] } },
      { type: "message-chunk", sessionId, text: "界面结构已按任务流收敛，图片在发送后保留于用户消息中。" },
      { type: "media", sessionId, media: "image", source: png, isData: true, mimeType: "image/png" },
      { type: "turn-completed", sessionId, presentation: { turnId: "fixture-client-images", clientMessageId: "fixture-client-images", ordinal: 0, startedAt: "2026-07-22T07:00:00.000Z", completedAt: "2026-07-22T07:01:23.000Z", durationMs: 83_000, outcome: "completed" } },
      { type: "user-message", sessionId, id: "fixture-plan", clientMessageId: "fixture-plan", text: "列出后续步骤。", delivery: "sent" },
      { type: "plan", sessionId, text: "1. 验证左右侧栏。\n2. 验证消息与文件卡。\n3. 验证输入框和底部环境栏。" },
      { type: "message-chunk", sessionId, text: "计划已完成，所有入口均映射到真实功能。" },
      { type: "turn-completed", sessionId },
      { type: "user-message", sessionId, id: "fixture-client-failed", clientMessageId: "fixture-client-failed", text: "这条消息用于测试失败恢复。", attachments: failed.previews, delivery: "failed" },
      { type: "status", sessionId, status: "idle", text: "离线夹具" },
    ];
    return { session, events };
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

  async pickAttachmentFolders(): Promise<Attachment[]> {
    const result = await dialog.showOpenDialog(this.window!, { title: "添加文件夹", properties: ["openDirectory", "multiSelections"] });
    if (result.canceled) return [];
    return this.attachmentsFromPaths(result.filePaths);
  }

  async attachmentsFromPaths(paths: string[]): Promise<Attachment[]> {
    return Promise.all(paths.map(async (path): Promise<Attachment> => {
      const info = await stat(path);
      if (info.isDirectory()) return { id: crypto.randomUUID(), name: path.split(/[\\/]/).at(-1) || path, path, kind: "folder" };
      if (!info.isFile()) throw new Error(`${path} 不是可添加的文件或文件夹`);
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
    if (patch.theme !== undefined) patch.theme = mergeThemeSettings((await this.settingsStore.get()).theme ?? DEFAULT_THEME, patch.theme);
    const settings = await this.settingsStore.patch(patch);
    applyNativeTheme(settings.theme);
    return settings;
  }

  async getTheme(): Promise<ThemeSettings> { return (await this.settingsStore.get()).theme; }
  async updateTheme(patch: Partial<ThemeSettings>): Promise<AppSettings> {
    const current = await this.settingsStore.get();
    return this.updateSettings({ theme: mergeThemeSettings(current.theme ?? DEFAULT_THEME, patch) });
  }
  async pickThemeBackground(): Promise<AppSettings | null> {
    const result = await dialog.showOpenDialog(this.window!, { title: "选择背景图片", properties: ["openFile"], filters: [{ name: "背景图片", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    await this.themeService.installBackground(result.filePaths[0]);
    const current = await this.settingsStore.get();
    return this.updateTheme({ background: { ...current.theme.background, enabled: true } });
  }
  async removeThemeBackground(): Promise<AppSettings> {
    await this.themeService.removeBackground();
    const current = await this.settingsStore.get();
    return this.updateTheme({ background: { ...current.theme.background, enabled: false } });
  }
  currentThemeBackground() { return this.themeService.currentBackground(); }

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
    void this.cliCapabilities.recordRuntimeSupport(["acp.initialize", "acp.sessionNew", "codexReader"]).catch((error) => this.log.log(error));
    this.focusedSessionId = result.sessionId;
    await this.catalog.markRead(result.sessionId);
    await this.catalog.recordOrigins([{ sessionId: result.sessionId, kind: "codex-continuation", id, title: "Codex 接力", suggestedTitle: detail.title }]);
    await this.catalog.rename(result.sessionId, detail.title);
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
  listProviders(): Promise<CustomProviderProfile[]> {
    if (process.env.GROK_DESKTOP_OFFLINE_SMOKE === "1") return Promise.resolve([]);
    return this.providers.list();
  }
  upsertProvider(input: CustomProviderInput): Promise<CustomProviderProfile[]> { return this.providers.upsert(input); }
  removeProvider(id: string): Promise<CustomProviderProfile[]> { return this.providers.remove(id); }
  testProvider(id: string): Promise<ProviderConnectivityResult> { return this.providers.test(id); }
  pullProviderModels(id: string): Promise<Array<{ id: string; name?: string }>> { return this.providers.pullModels(id); }
  probeProviderDraft(input: ProviderConnectionDraft): Promise<ProviderDraftProbeResult> { return this.providers.probeDraft(input); }
  discoverProviderModels(input: ProviderConnectionDraft): Promise<ProviderModelCandidate[]> { return this.providers.discoverDraftModels(input); }
  async setProviderDesktopDefault(modelId: string): Promise<AppSettings> { return this.settingsStore.patch({ defaultModel: modelId }); }
  setProviderCliDefault(modelId: string): Promise<CustomProviderProfile[]> { return this.providers.setCliDefault(modelId); }
  reloadProviders(): Promise<void> { return this.providers.reload(); }
  async listAutomations(): Promise<AutomationTask[]> {
    if (process.env.GROK_DESKTOP_OFFLINE_SMOKE === "1") return [];
    const [tasks, accounts, providers] = await Promise.all([this.automations.list(), this.vault.list(), this.providers.list()]);
    const accountIds = new Set(accounts.map((value) => value.id));
    const providerModels = new Map(providers.map((value) => [value.id, new Set(value.models.map((model) => model.id))]));
    return tasks.map((task) => {
      const accountMissing = Boolean(task.profile.accountId && !accountIds.has(task.profile.accountId));
      const providerMissing = Boolean(task.profile.providerId && (!providerModels.has(task.profile.providerId) || !providerModels.get(task.profile.providerId)!.has(task.profile.modelId)));
      return accountMissing || providerMissing ? { ...task, registrationStatus: "needs-config" as const, registrationError: accountMissing ? "固定账号已不存在，需要重新配置" : "固定提供商或模型已不存在，需要重新配置" } : task;
    });
  }
  async createAutomation(input: AutomationTaskInput): Promise<AutomationTask[]> { return this.automations.create(await this.applyExecutionProfileToAutomation(input)); }
  async updateAutomation(id: string, patch: Partial<AutomationTaskInput>): Promise<AutomationTask[]> {
    if (!patch.executionProfileId && !patch.workspace) return this.automations.update(id, patch);
    const current = (await this.automations.list()).find((value) => value.id === id);
    if (!current) throw new Error("持久任务不存在");
    const merged = { ...current, ...patch, profile: { ...current.profile, ...patch.profile }, schedule: patch.schedule ?? current.schedule, prompt: patch.prompt } as AutomationTaskInput;
    const profiled = await this.applyExecutionProfileToAutomation(merged);
    return this.automations.update(id, { ...patch, executionProfileId: profiled.executionProfileId, profile: profiled.profile });
  }
  deleteAutomation(id: string): Promise<AutomationTask[]> { return this.automations.delete(id); }
  pauseAutomation(id: string, paused: boolean): Promise<AutomationTask[]> { return this.automations.pause(id, paused); }
  runAutomationNow(id: string): Promise<AutomationRunRecord> { return this.automations.runNow(id); }
  listAutomationRuns(taskId?: string): Promise<AutomationRunRecord[]> {
    if (process.env.GROK_DESKTOP_OFFLINE_SMOKE === "1") return Promise.resolve([]);
    return this.automations.listRuns(taskId);
  }
  getAutomationGlobalPolicy(): Promise<AutomationGlobalPolicy> {
    if (process.env.GROK_DESKTOP_OFFLINE_SMOKE === "1") return Promise.resolve({
      defaultProfile: { modelId: "grok-4.5", effort: "", mode: "auto", permissionPolicy: "auto", computerEnabled: false },
      maxConcurrentRuns: 2,
      confirmationTimeoutMinutes: 30,
      notifyOnSuccess: true,
      notifyOnFailure: true,
    });
    return this.automations.getPolicy();
  }
  updateAutomationGlobalPolicy(patch: Partial<AutomationGlobalPolicy>): Promise<AutomationGlobalPolicy> { return this.automations.updatePolicy(patch); }
  applyAutomationPolicyToAll(): Promise<AutomationTask[]> { return this.automations.applyPolicyToAll(); }
  respondAutomationPending(id: string, approved: boolean): Promise<void> { return this.automations.respondPending(id.replace(/^pending:/, ""), approved); }
  repairAutomationRegistrations(): Promise<AutomationTask[]> { return this.automations.repairRegistrations(); }
  async checkAutomationHealth(repair = false): Promise<AutomationHealthReport> {
    const [tasks, accounts, providers] = await Promise.all([this.automations.list(), this.vault.list(), this.providers.list()]);
    return checkAutomationHealth({
      tasks, accounts, providers,
      workspaceExists: (path) => stat(path).then((value) => value.isDirectory()).catch(() => false),
      executableExists: () => stat(process.execPath).then((value) => value.isFile()).catch(() => false),
      sessionExists: async (task) => {
        if (!task.sessionId) return true;
        const assignment = await this.profiles.assignment(task.sessionId);
        return this.catalog.has(assignment?.cwd ?? task.workspace, task.sessionId);
      },
      executionProfileExists: async (task) => !task.executionProfileId || (await this.profiles.list(task.workspace)).some((value) => value.id === task.executionProfileId && value.effective),
      clearSessionMapping: async (taskId) => {
        const task = tasks.find((value) => value.id === taskId);
        if (task?.sessionId) await this.profiles.removeAssignment(task.sessionId);
        await this.automations.setExecutionSession(taskId, undefined);
      },
      repairRegistrations: () => this.automations.repairRegistrations(),
    }, repair);
  }
  clearAutomationContext(id: string): Promise<AutomationTask[]> {
    return this.automations.clearSession(id, async (task) => {
      if (!task.sessionId) return;
      const assignment = await this.profiles.assignment(task.sessionId);
      await this.processes.close(task.sessionId);
      if (await this.catalog.has(assignment?.cwd ?? task.workspace, task.sessionId)) await this.catalog.delete(assignment?.cwd ?? task.workspace, task.sessionId);
      await this.profiles.removeAssignment(task.sessionId);
    });
  }
  unregisterAllAutomations(): Promise<void> { return this.automations.unregisterAll(); }

  async runAutomationWorker(taskId: string, runId?: string): Promise<AutomationRunRecord> {
    return this.automations.execute(taskId, runId, async ({ task, prompt, confirm }) => {
      const accountContext = await this.prepareAutomationAccount(task);
      const execution = resolveAutomationExecutionPolicy(task.profile);
      const decision = execution.permission === "allow"
        ? async () => true
        : execution.permission === "deny"
          ? async () => false
          : (toolCall: unknown) => confirm(toolCall, execution.permission === "confirm-all");
      try {
        let sessionId = task.sessionId;
        let assignment = sessionId ? await this.profiles.assignment(sessionId) : undefined;
        const mappedSessionExists = Boolean(sessionId && await this.catalog.has(assignment?.cwd ?? task.workspace, sessionId));
        const sessionAction = resolveAutomationSessionAction(task.contextPolicy, Boolean(sessionId), mappedSessionExists);
        if (sessionId && sessionAction === "replace") {
          await this.processes.close(sessionId);
          await this.catalog.delete(assignment?.cwd ?? task.workspace, sessionId);
          await this.profiles.removeAssignment(sessionId);
          await this.automations.setExecutionSession(task.id, undefined);
          sessionId = undefined;
          assignment = undefined;
        }
        const agents = await this.definitions.listAgents(assignment?.cwd ?? task.workspace);
        const compiled = assignment
          ? await this.profiles.compileProfile(assignment.profile, agents)
          : await this.profiles.compile(task.workspace, task.executionProfileId, agents);
        let targetCwd = assignment?.cwd ?? task.workspace;
        let worktree: GrokWorktreeSummary | undefined;
        if (sessionAction !== "reuse" && compiled.profile.worktree) {
          worktree = await this.worktrees.create({ workspacePath: task.workspace, name: `${profileSlug(task.name)}-${new Date().toISOString().slice(0, 10)}`, baseRef: compiled.profile.worktreeRef, agentId: compiled.profile.agentId });
          targetCwd = worktree.path;
        }
        const environment = { ...compiled.environment, ...accountContext.environment };
        const modelId = compiled.modelId || task.profile.modelId;
        const result = sessionAction === "reuse"
          ? await this.processes.openConfigured(targetCwd, sessionId!, compiled.effort || task.profile.effort, compiled.mode, modelId, decision, environment, { agentProfilePath: compiled.agentProfilePath, sessionMeta: compiled.sessionMeta, alwaysApprove: compiled.mode === "auto" })
          : await this.processes.createConfigured(targetCwd, compiled.effort || task.profile.effort, compiled.mode, modelId, decision, environment, { agentProfilePath: compiled.agentProfilePath, sessionMeta: compiled.sessionMeta, alwaysApprove: compiled.mode === "auto" });
        if (sessionAction !== "reuse") {
          assignment = { sessionId: result.sessionId, sourceWorkspacePath: task.workspace, cwd: targetCwd, profileId: compiled.profile.id, profileName: compiled.profile.name, profile: compiled.profile, worktreeId: worktree?.id, createdAt: new Date().toISOString() };
          await this.profiles.assign(assignment);
        }
        await this.catalog.recordOrigins([{ sessionId: result.sessionId, kind: "automation", id: task.id, title: task.name, suggestedTitle: task.name }]);
        if (sessionAction !== "reuse") await this.catalog.rename(result.sessionId, task.name);
        await this.automations.setExecutionSession(task.id, result.sessionId);
        const text = task.profile.computerEnabled ? `/computer ${prompt}` : task.skillCommand ? `${task.skillCommand} ${prompt}` : prompt;
        try {
          // A persisted Windows task may legitimately run much longer than an
          // interactive turn. Keep the worker just below Task Scheduler's 24h
          // execution limit instead of failing a healthy run after 30 minutes.
          await this.processes.get(result.sessionId).prompt(text, [], 23 * 60 * 60_000);
          return { sessionId: result.sessionId };
        } finally { await this.processes.close(result.sessionId); }
      } finally { await accountContext.cleanup(); }
    });
  }
  async enqueuePrompt(sessionId: string, text: string, attachments: Attachment[], clientMessageId?: string): Promise<void> {
    clientMessageId ??= crypto.randomUUID();
    const prepared = await this.attachmentCache.prepare(sessionId, attachments);
    await this.attachmentCache.record(sessionId, clientMessageId, text, prepared.previews, "queued");
    await this.processes.get(sessionId).queuePrompt(text, prepared.attachments, false, { clientMessageId, attachments: prepared.previews });
  }
  async interjectPrompt(sessionId: string, text: string, attachments: Attachment[], clientMessageId?: string): Promise<void> {
    clientMessageId ??= crypto.randomUUID();
    const prepared = await this.attachmentCache.prepare(sessionId, attachments);
    await this.attachmentCache.record(sessionId, clientMessageId, text, prepared.previews, "sending");
    try {
      await this.processes.get(sessionId).interjectPrompt(text, prepared.attachments, { clientMessageId, attachments: prepared.previews });
      await this.attachmentCache.updateDelivery(sessionId, clientMessageId, "sent");
    } catch (error) {
      await this.attachmentCache.updateDelivery(sessionId, clientMessageId, "failed");
      throw error;
    }
  }
  editQueuedPrompt(sessionId: string, id: string, text: string): Promise<void> { return this.processes.get(sessionId).editQueuedPrompt(id, text); }
  removeQueuedPrompt(sessionId: string, id: string): Promise<void> { return this.processes.get(sessionId).removeQueuedPrompt(id); }
  reorderQueuedPrompt(sessionId: string, id: string, position: number): Promise<void> { return this.processes.get(sessionId).reorderQueuedPrompt(id, position); }
  clearPromptQueue(sessionId: string): Promise<void> { return this.processes.get(sessionId).clearPromptQueue(); }
  interjectQueuedPrompt(sessionId: string, id: string, text?: string): Promise<void> { return this.processes.get(sessionId).interjectQueuedPrompt(id, text); }
  async forkSession(sessionId: string, rewindPointId?: string, launch?: ExecutionProfileLaunchInput): Promise<SessionForkResult> {
    const snapshot = this.processes.snapshot(sessionId); if (!snapshot) throw new Error("会话当前未加载");
    const parentAssignment = await this.profiles.assignment(sessionId);
    const sourceWorkspace = parentAssignment?.sourceWorkspacePath ?? snapshot.cwd;
    let compiled = launch
      ? await this.compileExecutionProfile(sourceWorkspace, launch.profileId)
      : parentAssignment
        ? await this.profiles.compileProfile(parentAssignment.profile, await this.definitions.listAgents(snapshot.cwd))
        : await this.compileExecutionProfile(sourceWorkspace);
    let cwd = launch && !compiled.profile.worktree ? sourceWorkspace : snapshot.cwd;
    let worktree: GrokWorktreeSummary | undefined;
    if (launch && compiled.profile.worktree) {
      worktree = await this.worktrees.create({ workspacePath: sourceWorkspace, name: launch.worktreeName?.trim() || `${profileSlug(compiled.profile.name)}-fork-${new Date().toISOString().slice(0, 10)}`, baseRef: launch.worktreeRef?.trim() || compiled.profile.worktreeRef, sourceSessionId: sessionId, agentId: compiled.profile.agentId });
      cwd = worktree.path;
    }
    const result = await this.processes.get(sessionId).fork(rewindPointId, cwd);
    const childId = String(result.newSessionId ?? result.new_session_id ?? result.sessionId ?? result.forkedSessionId ?? result.session_id ?? "");
    if (!childId) {
      if (worktree) await this.worktrees.remove(sourceWorkspace, worktree.id, true).catch(() => undefined);
      throw new Error("CLI 未返回分叉会话 ID");
    }
    void this.cliCapabilities.recordRuntimeSupport(["fork"]).catch((error) => this.log.log(error));
    await this.catalog.recordFork(sessionId, childId);
    const inheritedWorktreeId = worktree?.id ?? (!launch ? parentAssignment?.worktreeId : undefined);
    const assignment: SessionExecutionAssignment = { sessionId: childId, sourceWorkspacePath: sourceWorkspace, cwd, profileId: compiled.profile.id, profileName: compiled.profile.name, profile: compiled.profile, worktreeId: inheritedWorktreeId, createdAt: new Date().toISOString() };
    await this.profiles.assign(assignment);
    if (inheritedWorktreeId) await this.catalog.recordOrigins([{ sessionId: childId, kind: "worktree", id: inheritedWorktreeId, title: compiled.profile.name, suggestedTitle: worktree?.name || "Worktree 分叉" }]);
    return { sessionId: childId, parentSessionId: sessionId, cwd, profileId: compiled.profile.id, worktreeId: inheritedWorktreeId };
  }
  listRewindPoints(sessionId: string): Promise<RewindPoint[]> { return this.processes.get(sessionId).rewindPoints(); }
  async rewindSession(sessionId: string, pointId: string, mode: "conversation" | "conversation-and-files" | "files"): Promise<void> {
    const snapshot = this.processes.snapshot(sessionId); if (!snapshot) throw new Error("会话当前未加载");
    await this.processes.get(sessionId).rewind(pointId, mode);
    await this.processes.close(sessionId, false);
    await this.handleEvent({ type: "session-reset", sessionId });
    await this.processes.open(snapshot.cwd, sessionId);
  }
  archiveSession(sessionId: string, archived: boolean): Promise<void> { return this.catalog.archive(sessionId, archived); }
  async listBackgroundTasks(): Promise<BackgroundTaskSummary[]> {
    if (process.env.GROK_DESKTOP_OFFLINE_SMOKE === "1") return [];
    const output: BackgroundTaskSummary[] = [];
    for (const { sessionId, entries } of this.processes.promptQueues()) for (const entry of entries) output.push({ id: `queue:${sessionId}:${entry.id}`, sessionId, kind: "queue", title: entry.text || "等待消息", status: entry.state === "sending" || entry.state === "interjected" ? "running" : "queued", updatedAt: entry.createdAt, detail: `队列第 ${entry.position + 1} 项` });
    for (const { sessionId, result, subagents } of await this.processes.backgroundTaskResults()) {
      const values = Array.isArray(result.tasks) ? result.tasks : Array.isArray(result.items) ? result.items : [];
      for (const value of values) { const row = value && typeof value === "object" ? value as Record<string, unknown> : {}; const completed = row.completed === true; const exitCode = typeof row.exit_code === "number" ? row.exit_code : typeof row.exitCode === "number" ? row.exitCode : undefined; const status = completed ? exitCode && exitCode !== 0 ? "failed" : "completed" : normalizeBackgroundStatus(row.status); const rawKind = String(row.kind ?? row.task_type ?? "command").toLowerCase(); output.push({ id: `${sessionId}:${String(row.id ?? row.taskId ?? row.task_id ?? crypto.randomUUID())}`, sessionId, kind: rawKind.includes("subagent") ? "subagent" : rawKind.includes("loop") || rawKind.includes("schedule") ? "loop" : rawKind.includes("monitor") ? "monitor" : "command", title: String(row.title ?? row.name ?? row.display_command ?? row.command ?? "后台任务"), status, updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : typeof row.updated_at === "string" ? row.updated_at : new Date().toISOString(), detail: typeof row.detail === "string" ? row.detail : completed ? `退出代码 ${exitCode ?? "未知"}` : undefined }); }
      const running = Array.isArray(subagents?.subagents) ? subagents.subagents : [];
      for (const value of running) {
        const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
        output.push({ id: `${sessionId}:subagent:${String(row.subagentId ?? row.subagent_id ?? crypto.randomUUID())}`, sessionId, kind: "subagent", title: String(row.description ?? row.subagentType ?? row.subagent_type ?? "子 Agent"), status: "running", updatedAt: new Date().toISOString(), detail: `${Number(row.turnCount ?? row.turn_count ?? 0)} 回合 · ${Number(row.toolCallCount ?? row.tool_call_count ?? 0)} 次工具` });
      }
    }
    for (const task of await this.automations.list()) output.push({ id: `automation:${task.id}`, kind: "automation", title: task.name, status: task.enabled ? "queued" : "cancelled", updatedAt: task.updatedAt, detail: task.registrationStatus });
    return output;
  }
  async killBackgroundTask(id: string): Promise<void> { const separator = id.indexOf(":"); if (separator < 1) throw new Error("后台任务标识无效"); await this.processes.killBackgroundTask(id.slice(0, separator), id.slice(separator + 1)); }
  async listInbox(): Promise<NotificationInboxItem[]> {
    if (process.env.GROK_DESKTOP_OFFLINE_SMOKE === "1") return [];
    const stored = await this.inbox.list(); const pending = await this.automations.pending();
    return [...pending.map((value): NotificationInboxItem => ({ id: `pending:${value.id}`, kind: "confirmation", title: "定时任务等待确认", detail: value.summary, taskId: value.taskId, read: false, createdAt: new Date(new Date(value.expiresAt).getTime() - 30 * 60_000).toISOString() })), ...stored].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  markInboxRead(id: string, read: boolean): Promise<NotificationInboxItem[]> { return this.inbox.markRead(id, read); }
  clearInbox(): Promise<NotificationInboxItem[]> { return this.inbox.clear(); }
  getDraft(key: string): Promise<ComposerDraftState | null> { return this.uiState.getDraft(key); }
  setDraft(key: string, text: string, capability?: ComposerCapabilitySelection): Promise<void> { return this.uiState.setDraft(key, text, capability); }
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

  private async compileExecutionProfile(workspacePath: string, profileId?: string): Promise<CompiledExecutionProfile> {
    return this.profiles.compile(workspacePath, profileId, await this.definitions.listAgents(workspacePath));
  }

  private async applyExecutionProfileToAutomation(input: AutomationTaskInput): Promise<AutomationTaskInput> {
    if (!input.executionProfileId) return input;
    const compiled = await this.compileExecutionProfile(input.workspace, input.executionProfileId);
    return {
      ...input,
      executionProfileId: compiled.profile.id,
      profile: {
        ...input.profile,
        modelId: compiled.modelId || input.profile.modelId,
        effort: compiled.effort || input.profile.effort,
        mode: compiled.mode,
        permissionPolicy: compiled.mode === "auto" ? "auto" : input.profile.permissionPolicy,
      },
    };
  }

  private async openAssignedSession(assignment: SessionExecutionAssignment): Promise<{ sessionId: string }> {
    const compiled = await this.profiles.compileProfile(assignment.profile, await this.definitions.listAgents(assignment.cwd));
    const settings = await this.settingsStore.get();
    return this.processes.openConfigured(assignment.cwd, assignment.sessionId, compiled.effort || settings.defaultEffort, compiled.mode, compiled.modelId || settings.defaultModel, undefined, compiled.environment, { agentProfilePath: compiled.agentProfilePath, sessionMeta: compiled.sessionMeta, alwaysApprove: compiled.mode === "auto" });
  }

  async dispose(): Promise<void> {
    await this.auth.dispose();
    await this.processes.dispose();
    await this.computer.dispose();
  }

  private async handleEvent(event: ChatEvent): Promise<void> {
    await this.dashboard.record(event);
    if ((event.type === "turn-started" || event.type === "turn-completed") && event.presentation) {
      await this.turnPresentations.recordForSession(event.sessionId, event.presentation);
    }
    if (event.type === "user-message-status") await this.attachmentCache.updateDelivery(event.sessionId, event.clientMessageId, event.delivery);
    if (event.type === "turn-completed") await this.computer.settleSession(event.sessionId, "completed", "Computer Use 回合已完成");
    if (event.type === "error" && event.sessionId) await this.computer.settleSession(event.sessionId, "error", event.message);
    if (event.type === "status" && event.status === "error") await this.computer.settleSession(event.sessionId, "error", event.text || "Grok 进程异常，Computer Use 已清理");
    this.window?.webContents.send("grok:event", event);
    if (event.type === "status" && (event.status === "working" || event.status === "needs-user")) this.runningSessions.add(event.sessionId);
    if (event.type === "status" && (event.status === "idle" || event.status === "error") && event.sessionId !== this.focusedSessionId) {
      await this.catalog.markUnread(event.sessionId, event.status === "error");
      if (this.runningSessions.has(event.sessionId)) await this.inbox.add({ kind: event.status === "error" ? "failure" : "completion", title: event.status === "error" ? "后台会话失败" : "后台会话已完成", detail: event.text, sessionId: event.sessionId });
      if (this.runningSessions.delete(event.sessionId)) this.showSessionNotification(event.sessionId, event.status === "error");
    }
  }

  private async finalizeMemorySession(_sessionId: string, session: import("./services/grok-acp-adapter").GrokAcpAdapter): Promise<void> {
    const settings = await this.memory.getSettingsForWorkspace(session.cwd);
    if (!settings.enabled || session.working || session.needsUser) return;
    if (settings.saveOnSessionEnd) {
      await this.memory.markCommand(session.cwd, "flush", "running");
      try { await session.prompt("/flush", [], 120_000); await this.memory.markCommand(session.cwd, "flush", "completed"); }
      catch (error) { await this.memory.markCommand(session.cwd, "flush", "failed"); throw error; }
    }
    if (settings.autoDream) {
      await this.memory.markCommand(session.cwd, "dream", "running");
      try { await session.prompt("/dream", [], 120_000); await this.memory.markCommand(session.cwd, "dream", "completed"); }
      catch (error) { await this.memory.markCommand(session.cwd, "dream", "failed"); throw error; }
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

  private async showAutomationNotification(run: AutomationRunRecord): Promise<void> {
    if (!Notification.isSupported()) return;
    const [task, policy] = await Promise.all([this.automations.list().then((values) => values.find((value) => value.id === run.taskId)), this.automations.getPolicy()]);
    if (!task?.notify || (run.status === "completed" ? !policy.notifyOnSuccess : !policy.notifyOnFailure)) return;
    const interactive = Boolean(this.window);
    const notification = new Notification({
      title: run.status === "completed" ? "定时任务已完成" : "定时任务失败",
      body: run.status === "completed"
        ? interactive ? "点击打开任务中心查看结果。" : "结果已保存，可在任务中心查看。"
        : run.error || (interactive ? "点击打开任务中心查看详情。" : "详情已保存到任务中心。"),
    });
    if (interactive) notification.on("click", () => this.openInteractiveTaskCenter());
    notification.show();
  }

  private async recordAutomationResult(run: AutomationRunRecord): Promise<void> {
    await this.inbox.add({
      kind: run.status === "completed" ? "completion" : "failure",
      title: run.status === "completed" ? "定时任务已完成" : "定时任务失败",
      detail: run.error || (run.sessionId ? `已保存为 Grok 会话 ${run.sessionId.slice(0, 8)}` : "运行记录已保存，可在任务中心查看。"),
      taskId: run.taskId,
      automationRunId: run.id,
    });
    await this.showAutomationNotification(run);
  }

  private showAutomationPendingNotification(pending: import("../shared/types").AutomationPendingConfirmation): void {
    if (!Notification.isSupported()) return;
    const notification = new Notification({ title: "定时任务等待确认", body: `操作已暂停，将在 ${new Date(pending.expiresAt).toLocaleTimeString("zh-CN")} 前等待处理。` });
    notification.on("click", () => this.openInteractiveTaskCenter());
    notification.show();
  }

  private openInteractiveTaskCenter(): void {
    if (this.window) {
      if (this.window.isMinimized()) this.window.restore();
      this.window.show();
      this.window.focus();
      this.window.webContents.send("grok:menu-command", "open-task-center");
      return;
    }
    const environment = { ...process.env };
    delete environment.GROK_DESKTOP_AUTOMATION_WORKER;
    const args = app.isPackaged ? ["--open-task-center"] : [app.getAppPath(), "--open-task-center"];
    const child = spawn(process.execPath, args, { detached: true, windowsHide: true, stdio: "ignore", env: environment });
    child.unref();
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

  private async providerReferences(providerId: string): Promise<string[]> {
    const providers = await this.providers.list();
    const modelIds = new Set(providers.find((value) => value.id === providerId)?.models.map((value) => value.id) ?? []);
    const references: string[] = [];
    const settings = await this.settingsStore.get();
    if (modelIds.has(settings.defaultModel)) references.push("桌面默认模型");
    for (const snapshot of this.processes.snapshots()) if (snapshot.modelId && modelIds.has(snapshot.modelId)) references.push(`实时会话 ${snapshot.sessionId.slice(0, 8)}`);
    for (const task of await this.automations.list()) if (modelIds.has(task.profile.modelId)) references.push(`定时任务 ${task.name}`);
    return references;
  }

  private async prepareAutomationAccount(task: AutomationTask): Promise<{ environment: NodeJS.ProcessEnv; cleanup(): Promise<void> }> {
    // Refresh user-level provider environment values inside Task Scheduler
    // workers, whose inherited environment can predate a newly saved key.
    const providers = await this.providers.list();
    if (task.profile.providerId) {
      const provider = providers.find((value) => value.id === task.profile.providerId);
      if (!provider || !provider.models.some((model) => model.id === task.profile.modelId)) throw new Error("任务固定的提供商或模型已不存在，请重新配置");
      if (!provider.hasCredential) throw new Error("任务固定的提供商凭据不可用，请重新配置");
    }
    if (!task.profile.accountId) return { environment: {}, cleanup: async () => undefined };
    const account = await this.vault.get(task.profile.accountId);
    if (!account) throw new Error("任务固定的账号已不存在，请重新配置");
    if (account.payload.kind === "api-key") {
      if (!account.payload.apiKey) throw new Error("任务固定的 API Key 凭据不可用，请重新配置");
      return { environment: { XAI_API_KEY: account.payload.apiKey }, cleanup: async () => undefined };
    }
    if (!account.payload.authJson) throw new Error("任务固定的 OAuth 凭据不可用，请重新配置");
    const oauthCredential = await this.auth.resolveAutomationOAuth(account.profile.id, account.payload.authJson);
    const root = await mkdtemp(join(app.getPath("temp"), "grok-desktop-automation-home-"));
    const grokHome = join(root, ".grok");
    const canonicalHome = join(homedir(), ".grok");
    const canonicalSessions = join(canonicalHome, "sessions");
    const isolatedSessions = join(grokHome, "sessions");
    await mkdir(grokHome, { recursive: true });
    await mkdir(canonicalSessions, { recursive: true });
    for (const file of ["config.toml", "managed_config.toml", "requirements.toml"]) {
      await copyFile(join(canonicalHome, file), join(grokHome, file)).catch(() => undefined);
    }
    await writeFile(join(grokHome, "auth.json"), oauthCredential.authJson, { encoding: "utf8", mode: 0o600 });
    let sharedSessions = true;
    try { await symlink(canonicalSessions, isolatedSessions, "junction"); }
    catch { sharedSessions = false; await mkdir(isolatedSessions, { recursive: true }); }
    for (const folder of ["installed-plugins", "skills", "commands"]) {
      const source = join(canonicalHome, folder);
      if (await stat(source).then((value) => value.isDirectory()).catch(() => false)) await symlink(source, join(grokHome, folder), "junction").catch(() => undefined);
    }
    return {
      environment: { GROK_HOME: grokHome, XAI_API_KEY: undefined },
      cleanup: async () => {
        const refreshed = await readFile(join(grokHome, "auth.json"), "utf8").catch(() => "");
        if (refreshed.trim()) await this.auth.reconcileAutomationOAuth(account.profile.id, oauthCredential, refreshed).catch((error) => this.log.log(`自动化 OAuth 刷新保存失败：${error instanceof Error ? error.message : String(error)}`));
        if (!sharedSessions) await cp(isolatedSessions, canonicalSessions, { recursive: true, force: true }).catch((error) => this.log.log(`自动化会话归档失败：${error instanceof Error ? error.message : String(error)}`));
        await rm(root, { recursive: true, force: true });
      },
    };
  }
}

function normalizeBackgroundStatus(value: unknown): BackgroundTaskSummary["status"] { const text = String(value ?? "running").toLowerCase(); return /fail|error/.test(text) ? "failed" : /complete|success|done/.test(text) ? "completed" : /cancel|kill|stop/.test(text) ? "cancelled" : /wait|permission/.test(text) ? "needs-user" : /queue|pending/.test(text) ? "queued" : "running"; }

function samePath(left: string, right: string): boolean { return left.replace(/[\\/]+$/, "").toLocaleLowerCase() === right.replace(/[\\/]+$/, "").toLocaleLowerCase(); }
function profileSlug(value: string): string { return value.normalize("NFKC").toLocaleLowerCase().replace(/[^a-z0-9\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 32) || "session"; }

function mimeForExtension(extension: string): string | undefined {
  return extension === ".png" ? "image/png" : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".gif" ? "image/gif" : extension === ".webp" ? "image/webp" : undefined;
}

function isUiDensity(value: unknown): value is UiDensity {
  return value === "compact" || value === "balanced" || value === "comfortable";
}

function applyNativeTheme(theme: ThemeSettings): void {
  nativeTheme.themeSource = theme.mode === "system" ? "system" : theme.mode === "light" || (theme.mode === "custom" && theme.customBase === "light") ? "light" : "dark";
}
