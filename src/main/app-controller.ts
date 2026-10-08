import { HtmlPreviewService } from "./services/html-preview-service";
import { prepareMediaProjectOutput, saveProjectMedia, type MediaProjectOutput } from "./services/media-project-output";
import { recordOwnedMediaFile, removeProvenMediaFiles } from "./services/media-file-ownership";
import { mergeTurnUsage } from "../shared/turn-usage";
import { readWorkspaceArtifact } from "./services/workspace-artifact-service";
import { mediaRequestSession } from "../shared/media-scope";
import { RemoteWorkbenchService } from "./services/remote-workbench-service";
import { RemotePushService } from "./services/remote-push-service";
import{session as remoteHttpSession}from"electron";
import { ImageWorkspaceService } from "./services/image-workspace-service";
import type { ImageSubmit } from "../shared/image-workspace";
import { WorkspaceBrowserService } from "./services/workspace-browser-service";
import { WorkspaceTerminalService } from "./services/workspace-terminal-service";
import { automationRuntimeProfile, resolveAutomationProfile } from "./services/automation-effective-profile";
import { watchAutomationInactivity } from "./services/automation-activity-watch";
import { NativeAgentCapabilities } from "./services/native-agent-capabilities";
import { DesktopToolAuthority } from "./services/desktop-tool-authority";
import { DesktopToolsService } from "./services/desktop-tools-service";
import { SessionRelayService } from "./services/session-relay-service";
import { RemoteGatewayService } from "./services/remote-gateway-service";
import type { RemoteCommand, RemoteSession, RemoteSnapshot, RemoteOptions } from "../shared/remote";
import { remotePendingInteractions, sanitizeRemoteEvent } from "./services/remote-history";
import { toDataURL as qrDataUrl } from "qrcode";
import { SubagentConversationService } from "./services/subagent-conversation-service";
import type { CliUpdateInput, CliUpdatePolicy, CliUpdateAction } from "../shared/types";
import { app, clipboard, desktopCapturer, dialog, Menu, nativeImage, nativeTheme, Notification, safeStorage, session, shell, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions } from "electron";
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, copyFile, cp, mkdir, mkdtemp, open, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { stableRuntimeTaskIdentifier } from "./services/runtime-task-identity";
import { runSessionRebindTransaction, SessionRebindTransactionError } from "./services/session-rebind-transaction";
import type {
  AppSettings,
  Attachment,
  BootstrapData,
  ChatEvent,
  ConversationProjection,
  ReasoningEffort,
  SessionMode,
  SessionSummary,
  SessionCompactionPolicy,
  UiDensity,
  WorkspaceSummary,
  CodexSessionDetail,
  CodexSessionSummary,
  ClaudeSessionDetail,
  ClaudeSessionSummary,
  GrokQuotaSnapshot,
  MediaCapabilities,
  ModelInfo,
  MediaCreationKind,
  MediaCreationRequest,
  MediaGenerationJob,
  MediaArtifact,
  ComposerDraftState,
  NewTaskDraft,
  SessionPreviewSnapshot,
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
  OpenTargetIntent,
  OpenTargetResult,
  ExternalOpenTool,
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
  ProviderCapabilitySnapshot,
  ProviderDeepScanOptions,
  ProviderDeepScanResult,
  ProviderScanScope,
  ProviderScanJob,
  CapabilityApplicationDraft,
  CapabilityApplicationSelection,
  AutomationTask,
  AutomationTaskInput,
  AutomationRunRecord,
  AutomationGlobalPolicy,
  RewindPoint,
  SessionForkResult,
  SessionRebindReceipt,
  WorkspaceRebindReceipt,
  BackgroundTaskSummary,
  NotificationInboxItem,
  OfflineUiFixture,
  CliCapabilitySnapshot,
  CliBtwReceipt,
  CliSessionInfo,
  CliSessionListResult,
  CliSessionUsage,
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
  AgentChangeIndex,
  AutomationHealthReport,
  TokenActivityQuery,
  TokenActivityReport,
  FailureDiagnosisReport,
  ToolCallState,
  TurnFailure,
  TurnUsage,
  ProviderLaunchContext,
  UserMessageAttachmentPreview,
  OfficialFeedbackCapability,
  OfficialFeedbackPreview,
  OfficialFeedbackReceipt,
} from "../shared/types";
import { resolveAutomationExecutionPolicy } from "./services/automation-execution-policy";
import { detectMediaCapabilities } from "../shared/media";
import { REASONING_EFFORTS } from "../shared/types";
import { classifyProviderFailureStage, classifyTurnFailure, turnFailureActions } from "../shared/turn-failure";
import { AccountVault } from "./services/account-vault";
import { AuthService } from "./services/auth-service";
import { buildCliEnv, locateGrokCli, validateGrokCliExecutable } from "./services/cli-locator";
import { CliUpdateService } from "./services/cli-update-service";
import { normalizeOfficialGitStatus } from "./services/official-git-status";
import { setOfficialFeedbackMenuAvailable } from "./app-menu";
import { deleteCliSession } from "./services/cli-session-service";
import { GrokProcessManager } from "./services/grok-process-manager";
import { INTERACTIVE_PROMPT_TIMEOUT_MS } from "./services/grok-acp-adapter";
import { JsonStore } from "./services/json-store";
import { AgentChangeService } from "./services/agent-change-service";
import { TurnFileChangeJournal } from "./services/turn-file-change-journal";
import { MediaAccessService } from "./services/media-access-service";
import { MediaThumbnailService } from "./services/media-thumbnail-service";
import { TokenActivityClient as TokenActivityService } from "./services/token-activity-client";
import { ConversationProjectionService } from "./services/conversation-projection-service";
import { conversationProjectionMatches } from "./services/conversation-search";
import { buildForkRuntimePreferences, SessionRuntimeStateService } from "./services/session-runtime-state-service";
import { AutomaticUpdateChecker } from "./services/update-check-policy";
import { LogService, redactLogText, redactSecrets } from "./services/log-service";
import { SessionCatalog } from "./services/session-catalog";
import { CodexSessionCatalog } from "./services/codex-session-catalog";
import { ClaudeSessionCatalog } from "./services/claude-session-catalog";
import { WorkspaceCatalog, isImageConversationFolder } from "./services/workspace-catalog";
import { GrokQuotaService } from "./services/grok-quota-service";
import { UiStateService } from "./services/ui-state-service";
import { resolveProjectIdentity } from "./services/project-identity";
import { isAllowedExternalUrl } from "./security-policy";
import { ExtensionService } from "./services/extension-service";
import { CodexPluginService } from "./services/codex-plugin-service";
import { ComputerUseService } from "./services/computer-use-service";
import { loadAppConfig, createBuildInfo, type PublicAppConfig } from "./services/app-config";
import { OnboardingService } from "./services/onboarding-service";
import { DiagnosticsService } from "./services/diagnostics-service";
import { AppReleaseService, createAppReleaseFetcher } from "./services/app-release-service";
import { AppInstallerService } from "./services/app-installer-service";
import { WorkspaceFileService } from "./services/workspace-file-service";
import { ExternalOpenToolService } from "./services/external-open-tool-service";
import { inspectAttachmentPrivacy } from "./services/attachment-privacy-service";
import { verifyResourceManifest, type ResourceIntegrityResult } from "./services/resource-integrity";
import { backupUiMetadataForVersion } from "./services/metadata-migration";
import { DEFAULT_THEME, mergeThemeSettings, ThemeService } from "./services/theme-service";
import { managedBaseUrlEnvironmentName, ProviderService, validateGrokConfig } from "./services/provider-service";
import { AutomationService } from "./services/automation-service";
import { resolveAutomationSessionAction } from "./services/automation-session-lifecycle";
import { NotificationInboxService } from "./services/notification-inbox";
import {readPullRequest} from "./services/pull-request-service";
import {DesktopNotifications,parseNotificationUrl,type NotificationTarget} from "./services/desktop-notifications";
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
import { buildCliMediaArgs, runCliMediaProcess } from "./services/media-cli-runner";
import { fetchTrustedRemoteMediaArtifact, normalizeAcpMediaArtifactSource, resolveTrustedMediaArtifactSource, sessionCacheKey, sweepSessionMediaCache } from "./services/media-cache-service";
import { canonicalExistingPath, hasCanonicalPath, rememberCanonicalPath, resolveTrustedRendererPath } from "./services/renderer-path-policy";
import {
  isOfflineUiSessionResponderEnabled,
  OFFLINE_UI_SESSION_IDS,
  OfflineUiSessionResponder,
} from "./services/offline-ui-session-responder";

export const DEFAULT_SETTINGS: AppSettings = {
  cliPath: "",
  httpProxy: process.env.HTTP_PROXY || "",
  httpsProxy: process.env.HTTPS_PROXY || "",
  defaultModel: "",
  defaultEffort: "",
  defaultMode: "agent",
  showThinking: false,
  expandToolDetails: false,
  automaticUpdateChecks: true,
  fontScale: 100,
  uiDensity: "balanced",
  conversationContentWidth: 780,
  conversationFontScale: 100,
  recentWorkspaces: [],
  activeWorkspace: "",
  codexGroupCollapsed: true,
  claudeGroupCollapsed: true,
  sessionGroupCollapsed: { normal: false, fork: false, worktree: false, automation: true, "codex-continuation": true, "claude-continuation": true, other: true },
  showArchivedCodex: false,
  theme: structuredClone(DEFAULT_THEME),
};

const UNSAFE_SYSTEM_OPEN_EXTENSIONS = new Set([
  ".appx", ".bat", ".chm", ".cmd", ".com", ".cpl", ".exe", ".hta", ".inf", ".ins",
  ".isp", ".js", ".jse", ".lnk", ".msc", ".msi", ".msix", ".msp", ".ps1", ".reg",
  ".scr", ".sct", ".url", ".vbe", ".vbs", ".ws", ".wsc", ".wsf", ".wsh",
]);

export class AppController {
  private readonly deletingSessions = new Set<string>();
  private readonly deletingWorkspaces = new Set<string>();
  private readonly settingsStore: JsonStore<AppSettings>;
  private readonly log: LogService;
  private readonly vault: AccountVault;
  private readonly catalog: SessionCatalog;
  private readonly processes: GrokProcessManager;
  private readonly auth: AuthService;
  private readonly updater: CliUpdateService;
  private readonly codex: CodexSessionCatalog;
  private readonly claude: ClaudeSessionCatalog;
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
  private automaticUpdateChecker?: AutomaticUpdateChecker;
  private readonly workspaceFiles = new WorkspaceFileService();
  private readonly externalOpenTools = new ExternalOpenToolService();
  private readonly resourceIntegrity: ResourceIntegrityResult;
  private readonly themeService: ThemeService;
  private readonly providers: ProviderService;
  private readonly automations: AutomationService;
  private readonly nativeAgentCapabilities = new NativeAgentCapabilities();
  private readonly desktopTools: DesktopToolsService;
  private readonly sessionRelay: SessionRelayService;
  private remoteGateway?: RemoteGatewayService;
  private readonly extensionLeases = new Map<string, { computer?: string; desktop: string; sessionId?: string; authority: DesktopToolAuthority }>();
  private readonly automationSessionReservations = new Set<string>();
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
  private readonly conversationProjections: ConversationProjectionService;
  private readonly sessionRuntime: SessionRuntimeStateService;
  private window?: BrowserWindow;
  private workspaceBrowser?:WorkspaceBrowserService;
  private readonly previewServers=new Map<string,{workspace:string;script:string}>();
  private readonly pullRequestWatches=new Map<string,NodeJS.Timeout>();
  async getPullRequestStatus(workspace:string){const root=await this.requireToolWorkspace(workspace);return {...await readPullRequest(root,buildCliEnv(await this.settingsStore.get())),watching:this.pullRequestWatches.has(root)}}
  async watchPullRequest(workspace:string,sessionId:string,enabled:boolean){const root=await this.requireToolWorkspace(workspace);const existing=this.pullRequestWatches.get(root);if(existing)clearInterval(existing);this.pullRequestWatches.delete(root);if(!enabled)return;const owner=this.processes.snapshot(sessionId)??await this.sessionRuntime.get(sessionId);if(!owner||!samePath(owner.cwd,root))throw Error("PR 提醒必须绑定当前项目会话");let previous=await this.getPullRequestStatus(root);if(!previous.available)throw Error(previous.reason);let reading=false;const timer=setInterval(()=>{if(reading)return;reading=true;void this.getPullRequestStatus(root).then(async next=>{if(next.available&&next.number===previous.number&&previous.pending&&!next.pending){await this.inbox.add({kind:"completion",title:"PR 的 CI 检查已结束",detail:`#${next.number} ${next.title}`,sessionId});await this.notices().show(`ci:${root}:${next.number}:${JSON.stringify(next.checks)}`,"completion","PR 的 CI 检查已结束","点击返回关联会话查看项目。",{kind:"session",id:sessionId});}if(next.available)previous=next;}).catch(error=>this.log.log(String(error))).finally(()=>{reading=false})},60_000);timer.unref();this.pullRequestWatches.set(root,timer)}
  private readonly workspaceTerminals=new WorkspaceTerminalService(event=>{if(this.window&&!this.window.isDestroyed())this.window.webContents.send("grok:workspace-terminal",event)});
  private computerStateObserver?: (state: ComputerTaskState) => void;
  private focusedSessionId = "";
  private visibleConversationId="";
  private desktopNotices?:DesktopNotifications;
  private notices(){return this.desktopNotices??=new DesktopNotifications(()=>this.settingsStore.get(),()=>this.window,()=>this.visibleConversationId,target=>void this.navigateNotification(target).catch(error=>this.log.log(String(error))))}
  private pendingNotice?:NotificationTarget;
  private rendererNoticeReady=false;
  setVisibleConversation(id:string){this.rendererNoticeReady=true;this.visibleConversationId=id;if(this.pendingNotice){const target=this.pendingNotice;this.pendingNotice=undefined;void this.navigateNotification(target).catch(error=>this.log.log(String(error)))}}
  async testDesktopNotification(){await this.notices().show(`test:${crypto.randomUUID()}`,"completion","Grok 通知测试","点击返回应用。系统通知可在 Windows 设置中管理。",{kind:"automation",id:"test"},true)}
  async navigateNotification(target:NotificationTarget){
    if(this.window&&!this.window.isDestroyed()){if(this.window.isMinimized())this.window.restore();this.window.show();this.window.focus();}
    if(target.kind==="session"){const session=this.processes.snapshot(target.id)??await this.sessionRuntime.get(target.id)??(await this.remoteSessions().catch(()=>[])).find(row=>row.id===target.id);if(!session){this.window?.webContents.send("grok:notification-target",{kind:"missing-session",id:target.id});throw Error("通知所属会话已不存在");}this.window?.webContents.send("grok:navigate-session",{sessionId:target.id,cwd:session.cwd});}
    else this.window?.webContents.send("grok:notification-target",target);
  }
  handleNotificationUrl(value:string){const target=parseNotificationUrl(value);if(target){this.pendingNotice=target;if(this.window&&this.rendererNoticeReady)return this.navigateNotification(target).then(()=>{this.pendingNotice=undefined})}return Promise.resolve()}
  async openInboxItem(id:string){const item=(await this.inbox.list()).find(item=>item.id===id);if(!item)throw Error("通知记录已不存在");await this.navigateNotification(item.automationRunId?{kind:"automation",id:item.automationRunId}:item.sessionId?.startsWith("image-")?{kind:"image",id:item.sessionId}:item.sessionId?{kind:"session",id:item.sessionId}:{kind:"automation",id:item.taskId||"test"});await this.inbox.markRead(id,true)}
  private readonly agentChanges = new AgentChangeService();
  private readonly turnFileChanges = new TurnFileChangeJournal();
  private readonly mediaAccess: MediaAccessService;
  private readonly imageWorkspace: ImageWorkspaceService;
  private readonly htmlPreviews = new HtmlPreviewService();
  private readonly persistedImageStates = new Map<string,string>();
  private readonly mediaThumbnails: MediaThumbnailService;
  private readonly tokenActivity: TokenActivityService;
  private readonly runningSessions = new Set<string>();
  private readonly projectionReplaying = new Set<string>();
  private readonly projectionOpenSessions = new Set<string>();
  private readonly projectionReplayBuffers = new Map<string, ChatEvent[]>();
  private readonly projectionReplayTimers = new Map<string, NodeJS.Timeout>();
  private readonly sessionHydrationGenerations = new Map<string, number>();
  private readonly sessionOpenFlights = new Map<string, Promise<{ sessionId: string; hydration?: import("../shared/types").SessionHydrationState; message?: string }>>();
  private nextHydrationGeneration = 0;
  private readonly mediaJobs = new Map<string, MediaGenerationJob>();
  private readonly mediaWaitExtensions = new Map<string, () => void>();
  private readonly mediaJobControls = new Map<string, { abort: AbortController; child?: ReturnType<typeof spawn>; transientSession?: { cwd: string; sessionId: string; keep?: boolean }; contextReset?: boolean; cancellationMessage?: string }>();
  private readonly mediaJobFlights = new Map<string, Promise<void>>();
  private mediaCredentialChanges = 0;
  private disposing = false;
  private readonly trustedPickedPaths = new Set<string>();
  private readonly trustedWorkspacePaths = new Set<string>();
  private readonly offlineUiSessionResponder?: OfflineUiSessionResponder;

  constructor(private readonly userDataPath: string) {
    this.appConfig = loadAppConfig();
    this.buildInfo = createBuildInfo(this.appConfig);
    this.settingsStore = new JsonStore(join(userDataPath, "settings.json"), { ...DEFAULT_SETTINGS, cliPath: this.appConfig.mockCliPath });
    this.git = new GitService(userDataPath);
    this.memory = new MemoryService(userDataPath, () => this.settingsStore.get());
    this.themeService = new ThemeService(userDataPath, (path) => !nativeImage.createFromPath(path).isEmpty());
    this.log = new LogService(join(userDataPath, "logs", "app.log"));
    this.vault = new AccountVault(userDataPath);
    this.catalog = new SessionCatalog(userDataPath,process.env.GROK_DESKTOP_OFFLINE_SMOKE==="1"?join(userDataPath,"offline-cli"):undefined);
    this.attachmentCache = new AttachmentCacheService(userDataPath);
    this.mediaAccess = new MediaAccessService(userDataPath);
    this.imageWorkspace = new ImageWorkspaceService(userDataPath,join(app.getPath("pictures"),"Grok Images"),process.env.GROK_DESKTOP_AUTOMATION_WORKER!=="1" && process.env.GROK_DESKTOP_SCHEDULER_UNINSTALL!=="1");
    this.mediaThumbnails = new MediaThumbnailService(userDataPath, ({ sourcePath, maxEdge, quality }) => {
      const source = nativeImage.createFromPath(sourcePath);
      if (source.isEmpty()) throw new Error("无法读取缩略图源图片");
      const size = source.getSize();
      const resized = Math.max(size.width, size.height) > maxEdge
        ? source.resize(size.width >= size.height ? { width: maxEdge, quality: "good" } : { height: maxEdge, quality: "good" })
        : source;
      return resized.toJPEG(quality);
    });
    this.turnPresentations = new TurnPresentationService(userDataPath);
    this.sessionRuntime = new SessionRuntimeStateService(userDataPath);
    this.conversationProjections = new ConversationProjectionService(userDataPath, {
      runtime: (sessionId) => this.sessionRuntime.get(sessionId),
      queue: async (sessionId) => ({
        version: 1,
        sessionId,
        updatedAt: new Date().toISOString(),
        entries: await this.sessionRuntime.getQueue(sessionId),
        terminalEntries: await this.sessionRuntime.getTerminalQueue(sessionId),
      }),
      isSessionActive: (sessionId) => Boolean(this.processes?.snapshot(sessionId)),
      interruptQueue: (sessionId) => this.sessionRuntime.interruptInflightQueue(sessionId).then(() => undefined),
    });
    const offlineHome = (name: string) => process.env.GROK_DESKTOP_OFFLINE_SMOKE === "1" ? join(userDataPath, name) : undefined;
    this.codex = new CodexSessionCatalog(userDataPath, this.log, offlineHome("offline-codex"), offlineHome("offline-cli"));
    this.claude = new ClaudeSessionCatalog(userDataPath, this.log, offlineHome("offline-claude"), offlineHome("offline-cli"));
    this.workspaces = new WorkspaceCatalog(userDataPath, this.codex, this.claude, offlineHome("offline-cli"));
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
    this.sessionRelay = new SessionRelayService(userDataPath, async (sessionId, taskId, runId) => {
      const task = (await this.automations.list()).find(task => task.id === taskId);
      if (task?.destination !== "current-session" || task.targetSessionId !== sessionId) throw new Error("任务未绑定此会话");
      return this.runAutomationWorker(taskId, runId);
    });
    this.processes = new GrokProcessManager(
      () => this.settingsStore.get(),
      () => this.auth?.activeApiKey(),
      this.log,
      (event) => void this.handleEvent(event),
      async (context) => {
        const authority = new DesktopToolAuthority();
        const authorize = (tool: string, input: Record<string, unknown>) => authority.consume(tool, input);
        let desktopLeaseId: string | undefined;
        const computer = await this.computer.createSessionInjection(context?.computerEnabled ?? true, authorize);
        try {
          const desktop = await this.desktopTools.injection(context?.cwd ?? process.cwd(), authorize);
          desktopLeaseId = desktop.leaseId;
          const plugin = await authority.plugin(join(resourcesRoot, "plugins", `grok-desktop${resourceSuffix}`), join(userDataPath, "desktop-tools-runtime"));
          const leaseId = crypto.randomUUID();
          this.extensionLeases.set(leaseId, { computer: computer.leaseId, desktop: desktop.leaseId, authority });
          return { leaseId, mcpServers: [...computer.mcpServers, ...desktop.mcpServers], pluginDirs: [...computer.pluginDirs, plugin] };
        } catch (error) { await this.computer.releaseLease(computer.leaseId); if (desktopLeaseId) await this.desktopTools.release(desktopLeaseId); await authority.dispose(); throw error; }
      },
      (leaseId, sessionId) => {
        const lease = leaseId ? this.extensionLeases.get(leaseId) : undefined;
        if (!lease) return;
        lease.sessionId = sessionId;
        lease.authority.bind(sessionId);
        this.computer.bindLease(lease.computer, sessionId);
        this.desktopTools.bind(lease.desktop, sessionId);
        void this.sessionRelay.own(sessionId).catch(error => this.log.log(error));
      },
      (leaseId) => {
        const lease = leaseId ? this.extensionLeases.get(leaseId) : undefined;
        if (!lease) return;
        this.extensionLeases.delete(leaseId!);
        if (lease.sessionId) this.nativeAgentCapabilities.release(lease.sessionId);
        void Promise.allSettled([this.computer.releaseLease(lease.computer), this.desktopTools.release(lease.desktop), lease.authority.dispose(), lease.sessionId ? this.sessionRelay.release(lease.sessionId) : Promise.resolve()]).then(results => {
          for (const result of results) if (result.status === "rejected") void this.log.log(`会话扩展清理失败：${String(result.reason)}`).catch(() => undefined);
        });
      },
      () => this.vault.mcpSecretEnvironment(),
      (cwd) => this.memory.sessionEnvironment(cwd),
      (context) => this.providerLaunchEnvironment(context),
      (sessionId, session) => this.finalizeMemorySession(sessionId, session),
      this.sessionRuntime,
      (version) => this.updater?.isRuntimeVersionAllowed(version) ?? Promise.resolve(false),
      join(userDataPath, "session-ownership"),
      () => { this.assertCredentialStable(); return this.updater.assertRuntimeLaunchAllowed(); },
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
      async () => { await this.stopMediaJobs("账号正在变更，使用原账号的 CLI 媒体任务已取消", true); await this.processes.stopAll(); },
      this.log,
      (state) => this.window?.webContents.send("grok:login", state),
    );
    this.cliCapabilities = new CliCapabilityService(() => this.settingsStore.get(), () => this.auth.activeApiKey());
    this.updater = new CliUpdateService(
      userDataPath,
      () => this.settingsStore.get(),
      () => this.auth.activeApiKey(),
      async () => { await this.stopMediaJobs("CLI 正在更新，媒体任务已取消，请在更新完成后手动重试", true); return this.processes.suspendAll(); },
      async (snapshots) => {
        const restored = await Promise.all(snapshots.map(async (snapshot) => {
          if (snapshot.processOptions) return snapshot;
          const assignment = await this.profiles.assignment(snapshot.sessionId);
          if (!assignment) return snapshot;
          const compiled = await this.profiles.compileProfile(assignment.profile, await this.definitions.listAgents(assignment.cwd));
          return { ...snapshot, processOptions: { agentProfilePath: compiled.agentProfilePath, sessionMeta: compiled.sessionMeta, environmentOverride: compiled.environment, alwaysApprove: snapshot.mode === "auto" } };
        }));
        return this.processes.restoreAll(restored);
      },
      this.log,
      {
        pluginDir: join(resourcesRoot, "plugins", `grok-computer-use${resourceSuffix}`),
        computerHostPath: join(resourcesRoot, "native", "win-x64", `GrokComputerHost.exe${resourceSuffix}`),
      },
    );
    this.quota = new GrokQuotaService(
      this.vault,
      () => this.settingsStore.get(),
      () => this.readCliVersion(),
      this.log,
      undefined,
      undefined,
      join(userDataPath, "quota.json"),
      (method) => this.processes.extensionRequest(method),
    );
    this.extensions = new ExtensionService(() => this.settingsStore.get(), (method, params) => this.processes.extensionRequest(method, params), this.log, (name, values) => this.vault.setMcpSecrets(name, values), (name) => this.vault.removeMcpSecrets(name), () => this.processes.reloadIdleExtensions());
    this.codexPlugins = new CodexPluginService(userDataPath, this.log);
    this.appRelease = new AppReleaseService(this.buildInfo, this.log, createAppReleaseFetcher(this.buildInfo, () => this.settingsStore.get()));
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
      },
      onRunFinished: run => this.recordAutomationResult(run),
    });
    this.desktopTools = new DesktopToolsService({
      mode: id => this.processes.snapshot(id)?.mode,
      list: () => this.automations.list(),
      create: async (context, input) => {
        const snapshot = this.processes.snapshot(context.sessionId);
        if (!snapshot) throw new Error("会话已关闭");
        const assignment = await this.profiles.assignment(context.sessionId);
        const runtime = await this.sessionRuntime.get(context.sessionId);
        const account = await this.vault.active();
        const computerEnabled=input.computerEnabled;
        const definition={name:input.name,prompt:input.prompt,schedule:input.schedule,destination:input.destination,timeZone:input.timeZone,contextPolicy:input.contextPolicy};
        return this.automations.createOne(await this.applyExecutionProfileToAutomation({ ...definition, workspace: context.cwd, enabled: true, wakeToRun: false, notify: true,
          missedRunPolicy: "run-once", contextPolicy: input.contextPolicy ?? "reuse", targetSessionId: input.destination === "current-session" ? context.sessionId : undefined,
          frozenExecutionProfile: assignment?.profile, profile: { modelId: snapshot.modelId ?? "", effort: snapshot.effort, mode: snapshot.mode,
            permissionPolicy: snapshot.mode === "auto" ? "auto" : snapshot.mode === "plan" ? "read-only" : "agent",
            computerEnabled: computerEnabled === true, providerId: runtime?.providerId, accountId: account?.profile.id } }));
      },
      update: (id, patch) => this.updateAutomation(id, patch), remove: id => this.deleteAutomation(id),
      runs: id => this.automations.listRuns(id), cancel: id => this.automations.cancelRun(id),
      capabilities: async id => {
        const adapter = this.processes.get(id);
        const [computer, cliIdentity] = await Promise.all([this.getComputerCapability(id), adapter.cliIdentity()]);
        return {
          computer,
          desktop: { injected: true, liveVerified: false, callerIdentity: [...this.extensionLeases.values()].find(lease => lease.sessionId === id)?.authority.evidence() },
          subagents: this.nativeAgentCapabilities.snapshot(id, adapter.runtimeHandshake, cliIdentity),
          sessionId: id,
        };
      },
    }, join(resourcesRoot, "plugins", `grok-desktop${resourceSuffix}`));
    this.providers = new ProviderService(userDataPath, this.log, {
      fetcher: async (input, init, proxyMode = "inherit") => {
        const settings = await this.settingsStore.get();
        // Separate partitions prevent concurrent direct/proxied providers from
        // racing over one mutable Electron proxy configuration.
        const network = session.fromPartition(
          proxyMode === "direct" ? "grok-provider-direct" : "grok-provider-inherit",
          { cache: false },
        );
        const proxy = settings.httpsProxy || settings.httpProxy;
        await network.setProxy(
          proxyMode === "direct"
            ? { mode: "direct" }
            : proxy
              ? { proxyRules: proxy }
              : { mode: "system" },
        );
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
      onScanProgress: (progress) => this.window?.webContents.send("grok:provider-scan-progress", progress),
    });
    this.tokenActivity = new TokenActivityService(userDataPath);
    this.diagnostics = new DiagnosticsService(userDataPath, this.buildInfo, () => this.settingsStore.get(), () => this.auth.activeApiKey(), () => this.getComputerCapability(), this.log, this.appConfig.mockCliPath, { providers: () => this.providers.list(), automations: () => this.automations.list(), quota: () => this.quota.get() });
    this.offlineUiSessionResponder = isOfflineUiSessionResponderEnabled()
      ? new OfflineUiSessionResponder((event) => this.window?.webContents.send("grok:event", event))
      : undefined;
  }

  private async requireToolWorkspace(cwd:string):Promise<string>{const canonical=await canonicalExistingPath(cwd,"directory");const settings=await this.settingsStore.get();const known=[settings.activeWorkspace,...settings.recentWorkspaces];if(!hasCanonicalPath(this.trustedWorkspacePaths,canonical)&&!known.some(path=>samePath(path,canonical)))throw Error("请先在应用中打开此工作区");return canonical;}
  async pickWorkspaceArtifact(cwd:string){
    const root=await this.requireToolWorkspace(cwd);if(!this.window)throw Error("窗口不可用");
    const result=await dialog.showOpenDialog(this.window,{title:"选择工作区产物",defaultPath:root,properties:["openFile"]});
    if(result.canceled||!result.filePaths[0])return undefined;
    rememberCanonicalPath(this.trustedPickedPaths, await canonicalExistingPath(result.filePaths[0],"file"));
    return this.readWorkspaceArtifact(root,result.filePaths[0]);
  }
  async saveWorkspaceArtifact(cwd:string,path:string){
    const root=await this.requireToolWorkspace(cwd);const source=await resolveTrustedRendererPath(path,{roots:[root],issuedPaths:this.trustedPickedPaths,kind:"file"});if(!this.window)throw Error("窗口不可用");
    const target=await dialog.showSaveDialog(this.window,{title:"另存产物副本",defaultPath:basename(source)});
    if(target.canceled||!target.filePath)return false;
    const destination=join(await realpath(dirname(target.filePath)),basename(target.filePath));
    if(samePath(source,destination))throw Error("请选择不同于原文件的保存位置");
    const existing=await realpath(destination).catch(()=>undefined);if(existing&&samePath(source,existing))throw Error("请选择不同于原文件的保存位置");
    await copyFile(source,destination);return true;
  }
  async readWorkspaceArtifact(cwd:string,path:string){
    const artifact=await readWorkspaceArtifact(await this.requireToolWorkspace(cwd),path,{issuedPaths:this.trustedPickedPaths});
    return artifact.kind==="html"?{...artifact,previewUrl:this.htmlPreviews.register(artifact.data,artifact.path)}:artifact;
  }
  htmlPreviewResponse(url:string):Promise<Response>{return this.htmlPreviews.request(url);}

  async listWorkspaceTerminals(cwd:string){return this.workspaceTerminals.list(await this.requireToolWorkspace(cwd))}
  async createWorkspaceTerminal(cwd:string){return this.workspaceTerminals.create(await this.requireToolWorkspace(cwd))}
  writeWorkspaceTerminal(id:string,data:string){this.workspaceTerminals.write(id,data)}
  resizeWorkspaceTerminal(id:string,cols:number,rows:number){this.workspaceTerminals.resize(id,cols,rows)}
  closeWorkspaceTerminal(id:string){this.workspaceTerminals.close(id)}
  listWorkspaceBrowserTabs(){return this.workspaceBrowser?.list()??[]}
  async createWorkspaceBrowserTab(url:string,context?:{sessionId?:string;workspace?:string}){if(!this.workspaceBrowser)throw Error("浏览器窗口不可用");if(context?.workspace)context={...context,workspace:await this.requireToolWorkspace(context.workspace)};if(context?.sessionId){const owner=this.processes.snapshot(context.sessionId)??await this.sessionRuntime.get(context.sessionId);if(!owner||context.workspace&&!samePath(context.workspace,owner.cwd))throw Error("网页关联会话与工作区不匹配");context={...context,workspace:owner.cwd}}return this.workspaceBrowser.create(url,context)}
  async previewConfigurations(workspace:string):Promise<string[]>{const root=await this.requireToolWorkspace(workspace);try{const data=JSON.parse(await readFile(join(root,"package.json"),"utf8"));return Object.keys(data.scripts??{}).filter(script=>/^(dev|start|preview)(:[A-Za-z0-9_-]+)?$/.test(script))}catch{return []}}
  async startPreviewServer(workspace:string,script:string){const root=await this.requireToolWorkspace(workspace);if(!(await this.previewConfigurations(root)).includes(script))throw Error("开发服务器配置不存在，请刷新项目脚本");const terminal=await this.workspaceTerminals.create(root);try{this.workspaceTerminals.write(terminal.id,`${process.platform==="win32"?"npm.cmd":"npm"} run ${script}\r`);this.previewServers.set(terminal.id,{workspace:root,script});return terminal.id}catch(error){this.workspaceTerminals.close(terminal.id);throw error}}
  listPreviewServers(workspace:string):import("../shared/workspace-tools").PreviewServer[]{const terminals=this.workspaceTerminals.list(workspace);return [...this.previewServers].filter(([,value])=>samePath(value.workspace,workspace)).map(([terminalId,value])=>{const terminal=terminals.find(row=>row.id===terminalId);const text=terminal?.output.replace(/\u001b\[[0-9;]*[A-Za-z]/g,"")??"";const url=text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d{2,5}[^\s\u001b]*/)?.[0];return {terminalId,...value,status:terminal?.status??"exited",url}})}
  stopPreviewServer(id:string){if(!this.previewServers.has(id))throw Error("开发服务器已不存在");this.workspaceTerminals.close(id);this.previewServers.delete(id)}
  async captureBrowserFeedback(id:string){if(!this.workspaceBrowser)throw Error("浏览器窗口不可用");const {image,state}=await this.workspaceBrowser.capture(id);const bytes=image.toPNG();if(!bytes.length||bytes.length>20*1024*1024)throw Error("网页截图不可用或过大");const owner=state.sessionId||`browser:${id}`;const directory=join(this.userDataPath,"session-attachments",sessionCacheKey(owner));await mkdir(directory,{recursive:true});const path=join(directory,`${crypto.randomUUID()}.png`);await writeFile(path,bytes);this.trustedPickedPaths.add(process.platform==="win32"?path.toLowerCase():path);const media=await this.mediaAccess.registerAttachment(owner,path,"image/png","网页截图");return {tab:state,previewUrl:`grok-media://access/${media.id}?sessionId=${encodeURIComponent(owner)}`,attachment:{id:crypto.randomUUID(),name:"网页预览.png",path,kind:"image" as const,mimeType:"image/png",size:bytes.length}}}
  navigateWorkspaceBrowser(id:string,url:string){if(!this.workspaceBrowser)throw Error("浏览器窗口不可用");return this.workspaceBrowser.navigate(id,url)}
  commandWorkspaceBrowser(id:string,action:"back"|"forward"|"reload"|"stop"){this.workspaceBrowser?.command(id,action)}
  boundsWorkspaceBrowser(id:string,bounds:import("../shared/workspace-tools").WorkspaceViewBounds){this.workspaceBrowser?.bounds(id,bounds)}
  closeWorkspaceBrowserTab(id:string){this.workspaceBrowser?.close(id)}
  clearWorkspaceBrowserSite(id:string){if(!this.workspaceBrowser)throw Error("浏览器窗口不可用");return this.workspaceBrowser.clearSite(id)}
  setWindow(window: BrowserWindow): void {
    this.window = window;
    this.workspaceBrowser ??=new WorkspaceBrowserService(window,tabs=>{if(!window.isDestroyed())window.webContents.send("grok:workspace-browser",tabs)});
  }

  showContextMenu(params: ContextMenuParams): void {
    if (!this.window) return;
    const template: MenuItemConstructorOptions[] = [];
    if (params.selectionText) template.push({ label: "复制选中文本", role: "copy", enabled: params.editFlags.canCopy });
    if (params.isEditable) {
      template.push(
        { label: "剪切", role: "cut", enabled: params.editFlags.canCut },
        { label: "复制", role: "copy", enabled: params.editFlags.canCopy },
        { label: "粘贴", role: "paste", enabled: params.editFlags.canPaste },
      );
    }
    if (params.linkURL) {
      if (template.length) template.push({ type: "separator" });
      template.push({ label: "复制链接", click: () => clipboard.writeText(params.linkURL) });
      if (isAllowedExternalUrl(params.linkURL)) {
        template.push({ label: "在浏览器中打开", click: () => void shell.openExternal(params.linkURL) });
      }
    }
    const imageSource = params.mediaType === "image" ? params.srcURL : "";
    if (imageSource) {
      if (template.length) template.push({ type: "separator" });
      template.push(
        { label: "复制图片", click: () => void this.copyImage(imageSource).catch((error) => this.log.log(`复制图片失败：${error instanceof Error ? error.message : String(error)}`)) },
        { label: "图片另存为…", click: () => void this.saveImage(imageSource).catch((error) => this.log.log(`保存图片失败：${error instanceof Error ? error.message : String(error)}`)) },
      );
      if (imageSource.startsWith("file:") || imageSource.startsWith("grok-media:")) {
        template.push({
          label: "打开原文件",
          click: () => void this.resolveTrustedImagePath(imageSource)
            .then((path) => shell.openPath(path))
            .catch((error) => this.log.log(`打开图片失败：${error instanceof Error ? error.message : String(error)}`)),
        });
      }
    }
    if (!params.isEditable && !params.selectionText) {
      if (template.length) template.push({ type: "separator" });
      template.push({ label: "全选", role: "selectAll" });
    }
    if (!template.length) return;
    Menu.buildFromTemplate(template).popup({ window: this.window });
  }

  async copyImage(source: string): Promise<void> {
    const image = await this.loadTrustedImage(source);
    if (image.isEmpty()) throw new Error("无法读取图片");
    clipboard.writeImage(image);
  }

  async saveImage(source: string): Promise<string | null> {
    if (!this.window) return null;
    const image = await this.loadTrustedImage(source);
    if (image.isEmpty()) throw new Error("无法读取图片");
    const result = await dialog.showSaveDialog(this.window, {
      title: "图片另存为",
      defaultPath: `grok-image-${Date.now()}.png`,
      filters: [{ name: "PNG 图片", extensions: ["png"] }],
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, image.toPNG());
    return result.filePath;
  }

  async openMedia(source: string): Promise<void> {
    const path = await this.resolveTrustedMediaPath(source);
    const result = await shell.openPath(path);
    if (result) throw new Error(result);
  }

  async resolveMediaRequest(source: string): Promise<{ path: string; mimeType: string; size: number }> {
    const path = await this.resolveTrustedMediaPath(source);
    const info = await stat(path);
    if (!info.isFile()) throw new Error("媒体文件不存在");
    const mimeType = localMediaMimeType(path);
    if (!mimeType) throw new Error("媒体文件类型不受支持");
    if (new URL(source).searchParams.get("variant") === "thumbnail") {
      if (!mimeType.startsWith("image/")) throw new Error("只有图片支持缩略图");
      const record = await this.mediaAccess.resolve(source, mediaRequestSession(source, this.focusedSessionId));
      return this.mediaThumbnails.get(record.sessionId, path);
    }
    return { path, mimeType, size: info.size };
  }

  /** Remote tickets use the stored handle owner, never the desktop's focused view. */
  async resolveRemoteMediaRequest(source: string): Promise<{ path: string; mimeType: string; size: number; sessionId: string }> {
    const record = await this.mediaAccess.resolve(source);
    if (this.deletingSessions.has(record.sessionId)) throw new Error("所属会话正在删除");
    const scoped = new URL(source);
    const expected = scoped.searchParams.get("session");
    if (expected && expected !== record.sessionId) throw new Error("媒体访问句柄不属于指定会话");
    scoped.searchParams.set("session", record.sessionId);
    return { ...await this.resolveMediaRequest(scoped.href), sessionId: record.sessionId };
  }

  private async loadTrustedImage(source: string): Promise<Electron.NativeImage> {
    if (source.startsWith("data:image/")) {
      if (source.length > 28 * 1024 * 1024) throw new Error("图片数据超过复制限制");
      return nativeImage.createFromDataURL(source);
    }
    const path = await this.resolveTrustedImagePath(source);
    return nativeImage.createFromPath(path);
  }

  private async resolveTrustedImagePath(source: string): Promise<string> {
    const path = await this.resolveTrustedMediaPath(source);
    if (!localMediaMimeType(path)?.startsWith("image/")) throw new Error("图片文件类型不受支持");
    return path;
  }

  private async resolveTrustedMediaPath(source: string): Promise<string> {
    if (source.startsWith("grok-media://access/")) {
      const owner = mediaRequestSession(source, this.focusedSessionId);
      if (this.deletingSessions.has(owner)) throw new Error("所属会话正在删除");
      const record = await this.mediaAccess.resolve(source, owner);
      if (this.deletingSessions.has(owner)) throw new Error("所属会话正在删除");
      return record.path;
    }
    // The only raw path surface retained is the short-lived preview URL that
    // the main process itself returned from a file picker. Durable user and
    // assistant media is always exposed through an opaque MediaAccessHandle.
    // Do not turn file:/absolute strings from a compromised Renderer into a
    // workspace-wide media read primitive.
    let requested = "";
    try {
      if (source.startsWith("grok-media:")) {
        const url = new URL(source);
        if (url.hostname !== "local") throw new Error("媒体访问句柄无效");
        requested = url.searchParams.get("path") || "";
      } else throw new Error("媒体来源必须使用应用签发的访问句柄");
    } catch { throw new Error("媒体来源地址无效"); }
    let path: string;
    try { path = await realpath(requested); } catch { throw new Error("媒体文件不存在或无法读取"); }
    if (hasCanonicalPath(this.trustedPickedPaths, path)) return path;
    throw new Error("媒体预览路径不是本次应用文件选择器签发的路径");
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
    const existingSessionIds = await this.catalog.allSessionIds().catch(() => new Set<string>());
    for(const row of (await this.imageWorkspace.list()).conversations)existingSessionIds.add(row.id);
    await this.attachmentCache.sweep(existingSessionIds).catch(() => this.log.log("附件缓存清理失败"));
    await sweepSessionMediaCache(join(this.userDataPath, "session-media"), existingSessionIds)
      .catch(() => this.log.log("媒体缓存清理失败"));
    await this.mediaThumbnails.sweep(existingSessionIds).catch(() => this.log.log("媒体缩略图缓存清理失败"));
    await this.mediaAccess.sweep(existingSessionIds).catch(() => this.log.log("媒体访问句柄清理失败"));
    await this.uiState.sweepDraftAttachments().catch(() => this.log.log("输入框文本草稿缓存清理失败"));
    if (process.env.GROK_DESKTOP_OFFLINE_SMOKE !== "1") await this.auth.importCurrentIfNeeded().catch((error) => this.log.log(error));
    let settings = await this.settingsStore.get();
    if (settings.cliPath && settings.cliPath !== this.appConfig.mockCliPath) {
      try {
        const cliPath = await validateGrokCliExecutable(settings.cliPath);
        if (cliPath !== settings.cliPath) settings = await this.settingsStore.patch({ cliPath });
      } catch (error) {
        await this.log.log(`已拒绝未通过身份验证的 Grok CLI 路径：${error instanceof Error ? error.message : String(error)}`);
        settings = await this.settingsStore.patch({ cliPath: "" });
      }
    }
    for (const workspace of [settings.activeWorkspace, ...settings.recentWorkspaces].filter(Boolean)) {
      const canonical = await canonicalExistingPath(workspace, "directory").catch(() => undefined);
      if (canonical) rememberCanonicalPath(this.trustedWorkspacePaths, canonical, 64);
    }
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
      claudeSessions: [],
      buildInfo: this.buildInfo,
      onboarding: await this.onboarding.get(),
    };
  }

  getBuildInfo(): BuildInfo { return this.buildInfo; }
  getOnboarding(): Promise<OnboardingState> { return this.onboarding.get(); }
  updateOnboarding(patch: Partial<OnboardingState>): Promise<OnboardingState> { return this.onboarding.update(patch); }
  resetOnboarding(): Promise<OnboardingState> { return this.onboarding.reset(); }
  runDiagnostics(): Promise<SystemCompatibilityReport> { return this.diagnostics.run(); }
  previewGrokDoctorFixes() { return this.diagnostics.previewDoctorFixes(); }
  applyGrokDoctorFix(id: string, confirmationToken: string, confirmed: boolean) { return this.diagnostics.applyDoctorFix(id, confirmationToken, confirmed); }
  getTokenActivity(query: TokenActivityQuery = {}): Promise<TokenActivityReport> { return this.tokenActivity.report(query); }
  /** Scoped to one failed turn; does not re-run the four-subprocess install sweep. */
  diagnoseFailure(failure: TurnFailure): Promise<FailureDiagnosisReport> { return this.diagnostics.diagnoseFailure(failure); }
  getCliCapabilities(force = false): Promise<CliCapabilitySnapshot> { return this.cliCapabilities.get(force); }
  async previewSupportBundle(): Promise<SupportBundlePreview> { return this.diagnostics.preview(); }
  async exportSupportBundle(): Promise<string | null> {
    const target = await dialog.showSaveDialog(this.window!, { title: "导出脱敏支持包", defaultPath: `grok-build-desktop-support-${new Date().toISOString().slice(0, 10)}.zip`, filters: [{ name: "ZIP 压缩包", extensions: ["zip"] }] });
    if (target.canceled || !target.filePath) return null;
    await this.diagnostics.createBundle(target.filePath);
    return target.filePath;
  }
  async exportSessionTrace(sessionId: string): Promise<string | null> {
    const safeId = sessionId.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48) || "session";
    const target = await dialog.showSaveDialog(this.window!, {
      title: "导出 Grok 会话 Trace",
      defaultPath: `grok-session-trace-${safeId}.json`,
      filters: [{ name: "JSON Trace", extensions: ["json"] }],
    });
    if (target.canceled || !target.filePath) return null;
    await this.diagnostics.exportSessionTrace(sessionId, target.filePath);
    return target.filePath;
  }
  checkAppUpdate(force = false): Promise<AppReleaseStatus> { return this.appRelease.check(force); }
  async openAppRelease(url?: string): Promise<void> { await shell.openExternal(this.appRelease.releaseUrl(url)); }
  private appInstallerService?: AppInstallerService;
  private appInstaller(){return this.appInstallerService??=new AppInstallerService(join(this.userDataPath,"updates"),async(url,init)=>{const settings=await this.settingsStore.get();const network=remoteHttpSession.fromPartition("grok-app-releases",{cache:false});const proxy=settings.httpsProxy||settings.httpProxy;await network.setProxy(proxy?{proxyRules:proxy}:{mode:"system"});return network.fetch(url,{headers:{"User-Agent":`Grok-Build-Desktop/${this.buildInfo.version}`},redirect:"follow",signal:init.signal}) as never},state=>this.window?.webContents.send("grok:app-update-progress",state))}
  appUpdateDownload(){return Promise.resolve(this.appInstaller().current())}
  async downloadAppUpdate(){const status=await this.appRelease.check(false);if(!status.updateAvailable||!status.latestVersion)throw Error("当前没有可下载的新版本");if(!status.installer)throw Error("此版本没有提供安装包，请打开发布页手动下载");return this.appInstaller().download(status.installer,status.latestVersion)}
  async cancelAppUpdate(){this.appInstaller().cancel()}
  async installAppUpdate(){if(this.hasWorking())throw Error("有会话正在运行，请等待完成或停止后再安装更新");await this.appInstaller().install();setTimeout(()=>app.quit(),400)}

  async chooseWorkspace(): Promise<string | null> {
    const result = await dialog.showOpenDialog(this.window!, { title: "选择工作区", properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    const canonical = await canonicalExistingPath(result.filePaths[0], "directory");
    rememberCanonicalPath(this.trustedWorkspacePaths, canonical, 64);
    await this.setWorkspace(canonical);
    await this.workspaces.setHidden(canonical, false, await this.settingsStore.get());
    return canonical;
  }

  async createTemporaryWorkspace(): Promise<string> {
    const root = join(this.userDataPath, "temporary-workspaces", `task-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`);
    await mkdir(root, { recursive: true });
    const canonical = await canonicalExistingPath(root, "directory");
    rememberCanonicalPath(this.trustedWorkspacePaths, canonical, 64);
    const settings = await this.settingsStore.get();
    await this.settingsStore.patch({
      activeWorkspace: canonical,
      recentWorkspaces: [canonical, ...settings.recentWorkspaces.filter((value) => !samePath(value, canonical))].slice(0, 12),
    });
    return canonical;
  }

  async setWorkspace(cwd: string): Promise<SessionSummary[]> {
    const settings = await this.settingsStore.get();
    const persisted = await Promise.all([settings.activeWorkspace, ...settings.recentWorkspaces]
      .filter(Boolean)
      .map((value) => canonicalExistingPath(value, "directory").catch(() => undefined)));
    for (const value of persisted) if (value) rememberCanonicalPath(this.trustedWorkspacePaths, value, 64);
    const canonical = await canonicalExistingPath(cwd, "directory");
    if (!hasCanonicalPath(this.trustedWorkspacePaths, canonical)) {
      throw new Error("工作区必须来自应用目录选择器、最近项目或已发现项目");
    }
    const recent = [canonical, ...settings.recentWorkspaces.filter((value) => !samePath(value, canonical))].slice(0, 12);
    await this.settingsStore.patch({ activeWorkspace: canonical, recentWorkspaces: recent });
    await this.workspaces.restoreEntry(canonical);
    this.workspaceFiles.invalidate(canonical);
    return this.listSessions(canonical);
  }

  async openWorkspaceOffline(cwd: string): Promise<SessionSummary[]> {
    const settings = await this.settingsStore.get();
    const rows = await this.workspaces.discover(settings, true, true);
    const known = rows.find((row) => samePath(row.cwd, cwd));
    if (!known) throw new Error("只能离线打开项目目录中已记录的失效工作区");
    if (known.exists) throw new Error("该工作区仍然可用，请正常打开");
    const recent = [known.cwd, ...settings.recentWorkspaces.filter((value) => !samePath(value, known.cwd))].slice(0, 12);
    await this.settingsStore.patch({ activeWorkspace: known.cwd, recentWorkspaces: recent });
    return this.listSessions(known.cwd);
  }

  async listSessions(cwd?: string, query = "", includeDismissed = false): Promise<SessionSummary[]> {
    const workspace = cwd || (await this.settingsStore.get()).activeWorkspace;
    await this.syncSessionOrigins(workspace);
    const assignments = (await this.profiles.listAssignments()).filter((value) => samePath(value.sourceWorkspacePath, workspace));
    const roots = [...new Set([workspace, ...assignments.map((value) => value.cwd)])];
    const rows = (await Promise.all(roots.map((root) => this.catalog.list(root, "", this.processes.liveStatuses(), includeDismissed)))).flat();
    const assignmentBySession = new Map(assignments.map((value) => [value.sessionId, value]));
    const queuedSessions = new Set(this.processes.promptQueues().filter((value) => value.entries.some((entry) => entry.state === "queued")).map((value) => value.sessionId));
    let result = rows.map((row) => {
      const assignment = assignmentBySession.get(row.id);
      const status = queuedSessions.has(row.id) && row.status !== "working" && row.status !== "needs-user" ? "queued" as const : row.status;
      return assignment ? { ...row, status, executionProfileId: assignment.profileId, worktreeId: assignment.worktreeId, originKind: assignment.worktreeId && row.originKind === "normal" ? "worktree" : row.originKind, originId: assignment.worktreeId ?? row.originId, originTitle: assignment.worktreeId ? assignment.profileName : row.originTitle } : { ...row, status };
    }).filter((row, index, values) => values.findIndex((value) => value.id === row.id) === index);
    const normalized = query.trim().toLocaleLowerCase();
    if (normalized) {
      const matches = await Promise.all(result.map(async (row) => {
        if (row.title.toLocaleLowerCase().includes(normalized) || row.id.toLocaleLowerCase().includes(normalized)) return true;
        return conversationProjectionMatches(await this.conversationProjections.restore(row.id).catch(() => undefined), normalized);
      }));
      result = result.filter((_row, index) => matches[index]);
    }
    return result.sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) || right.updatedAt.localeCompare(left.updatedAt));
  }

  listOfficialSessions(cwd?: string, cursor?: string): Promise<CliSessionListResult> {
    return this.processes.listOfficialSessions(cwd, cursor);
  }

  getCliSessionInfo(sessionId: string): Promise<CliSessionInfo> {
    return this.processes.sessionInfo(sessionId);
  }

  getCliSessionUsage(sessionId: string): Promise<CliSessionUsage> {
    return this.processes.sessionUsage(sessionId);
  }

  getSessionRuntimePreferences(sessionId: string) {
    return this.sessionRuntime.get(sessionId);
  }

  setSessionCompactionPolicy(sessionId: string, policy: SessionCompactionPolicy) {
    return this.sessionRuntime.setCompactionPolicy(sessionId, policy);
  }

  compactSession(sessionId: string) {
    return this.processes.compactSession(sessionId);
  }

  getOfficialFeedbackCapability(sessionId: string): OfficialFeedbackCapability {
    const capability = this.processes.feedbackCapability(sessionId);
    setOfficialFeedbackMenuAvailable(capability.available);
    return capability;
  }

  previewOfficialFeedback(text: string): OfficialFeedbackPreview {
    const normalized = text.trim();
    if (!normalized) throw new Error("反馈内容不能为空");
    if (Buffer.byteLength(normalized, "utf8") > 64 * 1024) throw new Error("反馈内容超过 64 KiB 限制");
    const preview = redactLogText(normalized);
    return { originalLength: normalized.length, preview, redacted: preview !== normalized };
  }

  async submitOfficialFeedback(sessionId: string, text: string): Promise<OfficialFeedbackReceipt> {
    const preview = this.previewOfficialFeedback(text);
    return this.processes.submitOfficialFeedback(sessionId, preview.preview);
  }

  sendBtwPrompt(sessionId: string, text: string): Promise<CliBtwReceipt> {
    return this.processes.btw(sessionId, text);
  }

  private async syncSessionOrigins(cwd: string): Promise<void> {
    const [continuations, claudeContinuations, tasks, runs] = await Promise.all([
      this.codex.listContinuations(cwd).catch(() => []),
      this.claude.listContinuations(cwd).catch(() => []),
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
    values.push(...claudeContinuations.map((value) => ({
      sessionId: value.sessionId,
      kind: "claude-continuation" as const,
      id: value.claudeId,
      title: "Claude 接力",
      suggestedTitle: value.title,
    })));
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
    const settings = await this.settingsStore.get();
    const workspaces = await this.workspaces.discover(settings, force);
    await this.enrichWorkspaceActivity(workspaces);
    for (const workspace of workspaces) {
      const canonical = await canonicalExistingPath(workspace.cwd, "directory").catch(() => undefined);
      if (canonical) rememberCanonicalPath(this.trustedWorkspacePaths, canonical, 64);
    }
    return workspaces;
  }

  async pinWorkspace(cwd: string, pinned: boolean): Promise<WorkspaceSummary[]> {
    const rows = await this.workspaces.pin(cwd, pinned, await this.settingsStore.get());
    await this.enrichWorkspaceActivity(rows);
    return rows;
  }

  async listHiddenWorkspaces(): Promise<WorkspaceSummary[]> {
    const rows = (await this.workspaces.discover(await this.settingsStore.get(), true, true)).filter((row) => row.hidden);
    await this.enrichWorkspaceActivity(rows);
    return rows;
  }

  async previewWorkspaceRemoval(cwd: string): Promise<{ sessionIds: string[]; running: string[]; automationCount: number }> {
    const known = (await this.workspaces.discover(await this.settingsStore.get(), true, true)).find(row => samePath(row.cwd, cwd));
    if (!known) throw new Error("项目入口不存在，请刷新项目列表");
    const rows = await this.listSessions(known.cwd, "", true);
    const statuses = this.processes.liveStatuses();
    const tasks = (await this.automations.list()).filter(task => samePath(task.workspace, cwd) || Boolean(task.targetSessionId && rows.some(row => row.id === task.targetSessionId)));
    const runs = await this.automations.listRuns();
    return { sessionIds: rows.map(row => row.id), running: [...rows.filter(row => ["working", "needs-user", "queued"].includes(statuses.get(row.id) ?? row.status)).map(row => row.id), ...runs.filter(run => tasks.some(task => task.id === run.taskId) && ["running", "awaiting-confirmation"].includes(run.status)).map(run => run.id)], automationCount: tasks.length };
  }
  async removeWorkspace(cwd: string): Promise<{ removedIds: string[]; failures: Array<{ id: string; message: string }>; removed: boolean }> {
    const workspaceKey = normalizePathKey(cwd);
    if (this.deletingWorkspaces.has(workspaceKey)) throw new Error("此项目正在删除，请等待完成");
    this.deletingWorkspaces.add(workspaceKey);
    try {
    const preview = await this.previewWorkspaceRemoval(cwd);
    if (preview.running.length) throw new Error("项目中有运行或等待中的任务，请先处理，再删除项目");
    const tasks = (await this.automations.list()).filter(task => samePath(task.workspace, cwd) || Boolean(task.targetSessionId && preview.sessionIds.includes(task.targetSessionId)));
    return await this.automations.withIdleTasks(tasks.map(task => task.id), async () => {
    const removedIds: string[] = []; const failures: Array<{ id: string; message: string }> = [];
    for (const task of tasks) await this.automations.update(task.id, { enabled: false, projectRemoved: true });
    for (const id of preview.sessionIds) {
      try { await this.deleteSession(cwd, id); removedIds.push(id); }
      catch (error) { failures.push({ id, message: error instanceof Error ? error.message : String(error) }); }
    }
    for (const row of await this.listSessions(cwd, "", true)) if (!failures.some(failure => failure.id === row.id)) failures.push({ id: row.id, message: "删除期间检测到新增或残留记录，项目入口保留，请刷新后重试" });
    if (!failures.length) {
      await this.workspaces.removeEntry(cwd);
      const settings = await this.settingsStore.get();
      await this.settingsStore.patch({ recentWorkspaces: settings.recentWorkspaces.filter(path => !samePath(path, cwd)), ...(samePath(settings.activeWorkspace, cwd) ? { activeWorkspace: "" } : {}) });
    }
    return { removedIds, failures, removed: !failures.length };
    });
    } finally { this.deletingWorkspaces.delete(workspaceKey); }
  }

  async setWorkspaceHidden(cwd: string, hidden: boolean): Promise<WorkspaceSummary[]> {
    const rows = await this.workspaces.setHidden(cwd, hidden, await this.settingsStore.get());
    await this.enrichWorkspaceActivity(rows);
    return rows;
  }

  private async enrichWorkspaceActivity(rows: WorkspaceSummary[]): Promise<void> {
    const drafts = await this.uiState.listDrafts();
    const snapshots = this.processes.snapshots();
    const statuses = this.processes.liveStatuses();
    for (const row of rows) {
      row.draftCount = drafts.filter((draft) => draft.newTask?.projectId === row.projectId
        || draft.newTask?.workspacePath && samePath(draft.newTask.workspacePath, row.cwd)
        || draft.key.toLocaleLowerCase().startsWith("new:") && samePath(draft.key.slice(4), row.cwd)).length;
      row.activeSessions = snapshots.filter((snapshot) => samePath(snapshot.cwd, row.cwd) && (statuses.get(snapshot.sessionId) === "working" || statuses.get(snapshot.sessionId) === "needs-user")).length;
    }
  }

  searchWorkspaceFiles(cwd: string, query: string, limit = 12): Promise<WorkspaceFileCandidate[]> { return this.workspaceFiles.search(cwd, query, limit); }
  listWorkspaceTree(cwd: string, directoryPath = "", options: WorkspaceTreeOptions = {}): Promise<WorkspaceTreeNode[]> { return this.workspaceTree.list(cwd, directoryPath, options); }
  openEditorDocument(cwd: string, path: string): Promise<EditorOpenResult> { return this.editor.open(cwd, path); }
  saveEditorDocument(input: EditorSaveInput): Promise<EditorSaveResult> { return this.editor.save(input).then((result) => { if (result.saved) this.workspaceFiles.invalidate(input.workspacePath); return result; }); }
  createEditorFile(cwd: string, path: string, content = ""): Promise<EditorDocument> { return this.editor.createFile(cwd, path, content).then((result) => { this.workspaceFiles.invalidate(cwd); return result; }); }
  createEditorDirectory(cwd: string, path: string): Promise<void> { return this.editor.createDirectory(cwd, path).then(() => { this.workspaceFiles.invalidate(cwd); }); }
  renameEditorPath(cwd: string, path: string, targetPath: string): Promise<string> { return this.editor.rename(cwd, path, targetPath).then((result) => { this.workspaceFiles.invalidate(cwd); return result; }); }
  deleteEditorPath(cwd: string, path: string, confirmed: boolean): Promise<void> { return this.editor.delete(cwd, path, confirmed).then(() => { this.workspaceFiles.invalidate(cwd); }); }
  async revealEditorPath(cwd: string, path: string): Promise<void> { const target = await this.editor.open(cwd, path); shell.showItemInFolder(target.path); }
  getGitRepositoryTrust(cwd: string): Promise<GitRepositoryTrust> { return this.git.getRepositoryTrust(cwd); }
  getGitWorkspaceCapability(cwd: string): Promise<GitWorkspaceCapability> { return this.git.capability(cwd); }
  setGitRepositoryTrust(cwd: string, repositoryRoot: string, trusted: boolean): Promise<GitRepositoryTrust> { return this.git.setRepositoryTrust(cwd, repositoryRoot, trusted); }
  async getGitStatus(cwd: string): Promise<GitRepositoryStatus> {
    const official = await this.processes.officialGitStatusForWorkspace(cwd).catch(() => undefined);
    const normalized = official && normalizeOfficialGitStatus(official, cwd);
    return normalized ?? this.git.status(cwd);
  }
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
    if (at >= 0) {
      const target = await this.dashboard.cancellationTarget(nodeId);
      if (!target) throw new Error("CLI 尚未提供此子智能体的可取消原生 ID；不能用子会话 ID 代替");
      return this.processes.killBackgroundTask(target.sessionId, `subagent:${target.nativeSubagentId}`);
    }
    if (nodeId.startsWith("session:")) return this.cancelSession(nodeId.slice("session:".length));
    throw new Error("Agent Dashboard 节点标识无效");
  }
  async getSubagentConversation(nodeId: string) {
    const snapshot=await new SubagentConversationService(id => this.dashboard.subagentRecord(id), id => this.conversationProjections.inspect(id)).read(nodeId);
    const parent=this.processes.snapshot(snapshot.parentSessionId)??await this.sessionRuntime.get(snapshot.parentSessionId);
    let advertised=false;try{advertised=this.processes.get(snapshot.parentSessionId).runtimeHandshake?.extensions.includes("x.ai/subagent/cancel")===true}catch{}
    const target=await this.dashboard.cancellationTarget(nodeId);
    return {...snapshot,parentCwd:parent?.cwd,controls:{canCancel:Boolean(target&&advertised),cancelReason:advertised?"CLI 尚未提供可取消的原生 ID":"当前父会话未声明取消合同；可在父会话要求停止对应子任务"}};
  }
  clearAgentDashboardRecord(nodeId?: string): Promise<void> { return this.dashboard.clear(nodeId); }
  async inspectAttachmentPrivacy(cwd: string, attachments: Attachment[]): Promise<AttachmentPrivacyFinding[]> { return inspectAttachmentPrivacy(cwd, attachments); }

  private getRemoteGateway(): RemoteGatewayService {
    return this.remoteGateway ??= new RemoteGatewayService(this.userDataPath, {
      sessions: () => this.remoteSessions(), snapshot: (id,before,around) => this.remoteSnapshot(id,before,around), options:(refresh,modelsOnly)=>this.remoteOptions(refresh,modelsOnly),perform: (command,deviceId) => this.performRemoteCommand(command,deviceId),
      query:(params,deviceId)=>this.remoteTools().query(params,deviceId),upload:(body,deviceId)=>this.remoteTools().files.upload(body,deviceId,id=>this.remoteTools().known(id)),resource:(ticket,suffix,deviceId)=>this.remoteTools().resource(ticket,suffix,deviceId),
      tick:(computer,devices)=>this.pushTools().poll(()=>this.listInbox(),computer,devices),
    }, {
      encrypt: value => { if (!safeStorage.isEncryptionAvailable()) throw Error("系统加密不可用，暂时不能开启手机连接"); return safeStorage.encryptString(value).toString("base64"); },
      decrypt: value => safeStorage.decryptString(Buffer.from(value,"base64")),
    }, () => { this.window?.webContents.send("grok:remote-state"); });
  }
  /** Download link + QR for the companion APK attached to the latest public release. */
  async getMobileDownload():Promise<{version?:string;url?:string;qrDataUrl?:string;error?:string}>{
    const status=await this.appRelease.check(false);
    if(!status.configured)return {error:status.error||"本地构建，未配置公开更新源"};
    if(!status.companion)return {error:status.error||"最新发布中没有手机安装包"};
    return {version:status.companion.version,url:status.companion.downloadUrl,qrDataUrl:await qrDataUrl(status.companion.downloadUrl,{width:220,margin:2})};
  }
  /** Opens a visible PowerShell window running xAI's official installer; only on an explicit click. */
  async installCliInteractive(){
    if(process.platform!=="win32")throw Error("一键安装仅支持 Windows，请按官方文档安装");
    // detached on Windows gives the child its own visible console window.
    const child=spawn("powershell.exe",["-NoExit","-NoProfile","-ExecutionPolicy","Bypass","-Command","Write-Host '正在运行 xAI 官方安装脚本 https://x.ai/cli/install.ps1 ...';irm https://x.ai/cli/install.ps1 | iex; Write-Host '';Write-Host '完成后回到 Grok Build Desktop 点击“重新检测”。'"],{detached:true,stdio:"ignore",windowsHide:false});
    child.unref();
  }
  async getRemoteState() { const state=await this.getRemoteGateway().state();return {...state,qrDataUrl:state.pairing?await qrDataUrl(state.pairing.uri,{width:280,margin:2}):undefined}; }
  async setRemoteEnabled(enabled:boolean,port?:number) { await this.getRemoteGateway().setEnabled(enabled,port);return this.getRemoteState(); }
  async beginRemotePairing(address?:string) { await this.getRemoteGateway().beginPairing(address);return this.getRemoteState(); }
  async decideRemotePair(id:string,approve:boolean) { await this.getRemoteGateway().decidePair(id,approve);return this.getRemoteState(); }
  async revokeRemoteDevice(id:string) { await this.getRemoteGateway().revoke(id);await this.pushTools().unregister(id);return this.getRemoteState(); }
  startRemoteIfEnabled() { return this.getRemoteGateway().startIfEnabled(); }
  remoteKeepAlive(){return this.remoteGateway?.enabled===true}
  remoteLiveDevices(){return this.remoteGateway?.enabled===true?this.remoteGateway.liveDevices():0}
  private remoteWorkbench?:RemoteWorkbenchService;
  private remotePush?:RemotePushService;
  private pushTools(){return this.remotePush??=new RemotePushService(this.userDataPath,{encrypt:value=>{if(!safeStorage.isEncryptionAvailable())throw Error("系统加密不可用");return safeStorage.encryptString(value).toString("base64")},decrypt:value=>safeStorage.decryptString(Buffer.from(value,"base64"))},async(url,init)=>{const settings=await this.settingsStore.get();const partition=remoteHttpSession.fromPartition("grok-remote-push");const proxy=settings.httpsProxy||settings.httpProxy;await partition.setProxy(proxy?{proxyRules:proxy}:{mode:"system"});return partition.fetch(url,init)})}
  remotePushStatus(deviceId?:string){return this.pushTools().status(deviceId)}
  registerRemotePush(deviceId:string,token:string){return this.pushTools().register(deviceId,token)}
  unregisterRemotePush(deviceId:string){return this.pushTools().unregister(deviceId)}
  async configureRemotePush(){const picked=await dialog.showOpenDialog(this.window!,{title:"选择 Firebase 服务账号与 Android 配置 JSON（共两个）",properties:["openFile","multiSelections"],filters:[{name:"JSON",extensions:["json"]}]});if(picked.canceled)return this.remotePushStatus();if(picked.filePaths.length!==2)throw Error("需要服务账号凭据与同项目的 google-services.json");const first=JSON.parse(await readFile(picked.filePaths[0]!,"utf8"));return first.type==="service_account"?this.pushTools().configure(picked.filePaths[0]!,picked.filePaths[1]!):this.pushTools().configure(picked.filePaths[1]!,picked.filePaths[0]!)}
  private remoteTools(){return this.remoteWorkbench??=new RemoteWorkbenchService(this,this.userDataPath)}
  async trustRemoteAttachments(attachments:Attachment[]){for(const attachment of attachments){if(!attachment.path)throw Error("附件缺少已上传文件");rememberCanonicalPath(this.trustedPickedPaths,await canonicalExistingPath(attachment.path,attachment.kind==="folder"?"directory":"file"))}}
  async trustRemoteWorkspace(id:string){const session=await this.requireRemoteSession(id);rememberCanonicalPath(this.trustedWorkspacePaths,await canonicalExistingPath(session.cwd,"directory"))}
  private async remoteReferences(references:NonNullable<RemoteCommand["references"]>):Promise<Attachment[]>{const workspaces=(await this.remoteOptions()).workspaces;const paths=await Promise.all(references.map(async reference=>{const workspace=workspaces.find(w=>w.id===reference.workspaceId);if(!workspace?.path)throw Error("引用所属项目已不可用");const path=await resolveTrustedRendererPath(reference.path,{roots:[workspace.path],kind:reference.kind==="folder"?"directory":"file"});rememberCanonicalPath(this.trustedPickedPaths,path);return path}));return this.buildAttachmentsFromPaths(paths)}
  private remoteConfigFlights=new Set<string>();
  private async remoteRuntime(id:string):Promise<import("../shared/remote").RemoteRuntime>{
    const preferences=await this.sessionRuntime.get(id);const live=this.processes.snapshot(id);let adapter:ReturnType<GrokProcessManager["get"]>|undefined;try{adapter=this.processes.get(id)}catch{}
    const config={modelId:live?.modelId??preferences?.modelId,providerId:preferences?.providerId,effort:live?.effort??preferences?.effort??"",mode:live?.mode??preferences?.mode??"agent"};
    const queue=adapter?.queuedPrompts().filter(row=>row.state==="queued")??[];const busy=Boolean(adapter?.working||adapter?.needsUser||queue.length||this.remoteConfigFlights.has(id));
    return {...config,revision:createHash("sha256").update(JSON.stringify(config)).digest("hex"),models:adapter?.models??[],mutable:!busy,reason:busy?"本轮运行、待确认或队列尚未结束，已提交任务保持原配置":undefined,interjectSupported:adapter?.runtimeHandshake?.extensions.includes("x.ai/interject")===true,commands:adapter?.commands??[]};
  }
  private remoteListFlight?:Promise<RemoteSession[]>;
  private remoteListCache?:RemoteSession[];
  private remoteChildren=new Map<string,RemoteSession>();
  private remoteListExpires=0;
  private invalidateRemoteList(){this.remoteListCache=undefined;this.remoteListExpires=0;}
  async remoteOptions(refreshModels=false,modelsOnly=false):Promise<RemoteOptions>{
    const settings=await this.settingsStore.get();
    const notices:string[]=[];
    const workspaces:RemoteOptions["workspaces"]=[];
    if(!modelsOnly){
      const discovered=await this.discoverWorkspaces().catch(()=>{notices.push("项目列表暂未同步，仍可选择模型；请刷新项目列表。");return []});
      const roots=[...new Set([settings.activeWorkspace,...settings.recentWorkspaces,...discovered.map(w=>w.cwd)].filter(Boolean))].slice(0,100);
      const results=await Promise.all(roots.filter(cwd=>!this.deletingWorkspaces.has(normalizePathKey(cwd))).map(async cwd=>{
        try{
          const profiles=await this.listExecutionProfiles(cwd);
          return {id:createHash("sha256").update(normalizePathKey(cwd)).digest("hex").slice(0,24),name:cwd.split(/[\\/]/).filter(Boolean).at(-1)||cwd,path:cwd,profiles:profiles.map(p=>({id:p.id,name:p.name,mode:p.mode,worktree:Boolean(p.worktree),modelId:p.modelId,effort:p.effort}))};
        }catch{return undefined}
      }));
      for(const result of results)if(result)workspaces.push(result);
      if(results.some(result=>!result))notices.push("部分项目目录或配置档暂不可用，已从新建选项中略去；原会话和文件未删除。");
    }
    // Catalog discovery can wait on login/network. Return known options now,
    // and let clients poll the refresh state instead of timing out this route.
    if ((refreshModels || !this.modelCatalogProbedAt) && !this.modelCatalogRefreshFlight) {
      const flight = this.listModelCatalog(true);
      this.modelCatalogRefreshFlight = flight;
      void flight.finally(()=>{if(this.modelCatalogRefreshFlight===flight)this.modelCatalogRefreshFlight=undefined}).catch(()=>undefined);
    }
    const models=await this.listModelCatalog(false);
    const availableProviders=await this.listProviders().catch(error=>{notices.push("Provider 目录暂不可用："+(error instanceof Error?error.message:String(error)));return []});
    const imageModels=availableProviders.filter(p=>p.enabled!==false).flatMap(p=>p.models.filter(m=>m.enabled!==false).map(m=>({modelId:m.id,providerId:p.id,name:`${p.name} · ${m.name||m.model}`,image:Object.values(m.capabilities?.protocols??{}).some(value=>value?.imageGeneration===true),video:Object.values(m.capabilities?.protocols??{}).some(value=>value?.videoGeneration===true)})));
    const modelId=models.some(model=>model.modelId===settings.defaultModel)?settings.defaultModel:models.find(model=>model.defaultForCli&&!model.providerId)?.modelId??settings.defaultModel;
    return {capabilities:["session.create","session.rename","session.archive","queue.remove","session.configure","session.compact","session.fork","session.delete","queue.edit","queue.move","queue.clear","workbench","attachments.upload"],workspaces,models,imageModels,modelCatalog:{refreshing:Boolean(this.modelCatalogRefreshFlight||this.modelCatalogProbe),checkedAt:this.modelCatalogProbedAt||undefined,reason:this.modelCatalogError},...(notices.length?{notices}:{}),defaults:{modelId,effort:settings.defaultEffort,mode:settings.defaultMode}};
  }
  async remoteSessions():Promise<RemoteSession[]> {
    if(this.remoteListCache&&Date.now()<this.remoteListExpires)return this.remoteListCache.map(row=>({...row,status:this.processes.liveStatuses().get(row.id)||row.status}));
    if(this.remoteListFlight)return this.remoteListFlight;
    return this.remoteListFlight=this.loadRemoteSessions().then(rows=>{this.remoteListCache=rows;this.remoteListExpires=Date.now()+1500;return rows}).finally(()=>{this.remoteListFlight=undefined});
  }
  private async loadRemoteSessions():Promise<RemoteSession[]>{
    const [settings,assignments,workspaces]=await Promise.all([this.settingsStore.get(),this.profiles.listAssignments(),this.discoverWorkspaces()]);
    const roots=[...new Set([settings.activeWorkspace,...settings.recentWorkspaces,...assignments.map(a=>a.cwd),...workspaces.map(w=>w.cwd)].filter(cwd=>cwd&&!isImageConversationFolder(cwd)))].slice(0,100);
    const rows=(await Promise.all(roots.map(cwd=>this.catalog.list(cwd,"",this.processes.liveStatuses()).catch(()=>[])))).flat();
    const byId=new Map(rows.map(row=>[row.id,row]));
    const cwds=[...new Set(rows.map(row=>row.cwd))];const missing=new Set((await Promise.all(cwds.map(async cwd=>(await stat(cwd).then(info=>info.isDirectory(),()=>false))?"":cwd))).filter(Boolean));
    const projected:RemoteSession[]=[...byId.values()].map(row=>({...(missing.has(row.cwd)?{projectMissing:true}:{}),id:row.id,cwd:row.cwd,title:row.title,projectName:row.cwd.split(/[\\/]/).filter(Boolean).at(-1)||row.cwd,updatedAt:row.updatedAt,archived:row.archived,preview:row.preview,parentSessionId:row.parentSessionId,status:row.status,modelId:this.processes.snapshot(row.id)?.modelId||row.modelId,mode:this.processes.snapshot(row.id)?.mode,canSend:!row.parentSessionId&&(row.originKind!=="automation"||Boolean(this.processes.snapshot(row.id)))}));
    for(const [id,child]of this.remoteChildren){if(!byId.has(child.parentSessionId??""))this.remoteChildren.delete(id);else if(!byId.has(id))projected.push(child)}return projected.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  }
  private async requireRemoteSession(id:string):Promise<RemoteSession>{const row=(await this.remoteSessions()).find(s=>s.id===id);if(!row||this.deletingSessions.has(id)||this.deletingWorkspaces.has(normalizePathKey(row.cwd)))throw Error("会话已删除、迁移或不属于已知项目，请刷新手机列表");return row;}
  async inspectRemoteChild(parentId:string,childId:string){
    const parent=await this.requireRemoteSession(parentId);const projection=await this.inspectSession(parent.cwd,parentId);
    const proven=(projection?.events??[]).some(event=>{if(event.type!=="subagent")return false;const update=event.update as Record<string,unknown>|undefined;return update&&[update.child_session_id,update.childSessionId].includes(childId)});
    if(!proven||childId===parentId)throw Error("没有可核验的父子身份；未打开其他会话替代");
    const child=await this.conversationProjections.inspect(childId);if(!child)throw Error("CLI 尚未提供完整子会话历史，当前仅可查看父会话摘要");
    const row:RemoteSession={id:childId,cwd:(await this.sessionRuntime.get(childId))?.cwd||parent.cwd,title:`子会话 · ${childId.slice(0,10)}`,projectName:parent.projectName,updatedAt:child.updatedAt,status:"cold",canSend:false,parentSessionId:parentId};
    this.remoteChildren.set(childId,row);
    this.remoteListCache=[...(await this.remoteSessions()).filter(s=>s.id!==childId),row];this.remoteListExpires=Date.now()+60_000;return row;
  }
  async remoteSnapshot(id:string,before?:number,around?:number):Promise<Omit<RemoteSnapshot,"cursor"|"epoch">>{
    const session=await this.requireRemoteSession(id);const projection=await this.inspectSession(session.cwd,id);
    const events=(projection?.events??[]) as ChatEvent[];const end=Math.min(before??events.length,events.length);let start=end;let bytes=0;
    const visible:ChatEvent[]=[];const allowed=new Set(["user-message","user-message-status","interjection","message-chunk","thought-chunk","tool-call","subagent","error","status","turn-started","turn-completed","session-reset","plan","question","permission","interaction-resolved","prompt-queue","media","computer-state","computer-permission","computer-risk","compact-status","session-recap","command-output","turn-retry","follow-ups","commands","meta","mode","runtime-update"]);
    if(around!==undefined){
      if(!Number.isSafeInteger(around)||around<0||around>=events.length)throw Error("消息位置已变化，请刷新跳转列表");
      start=around;let cursor=around;
      while(cursor<events.length&&cursor-around<2000){const event=events[cursor]!;if(cursor>around&&event.type==="user-message")break;cursor++;if(!allowed.has(event.type))continue;const safe={...sanitizeRemoteEvent(event),remoteIndex:cursor-1};const size=Buffer.byteLength(JSON.stringify(safe));if(bytes+size>2*1024*1024&&visible.length)break;bytes+=size;visible.push(safe);}
      return {session,events:visible,totalEvents:events.length,before:start||undefined,truncated:start>0,pending:[...remotePendingInteractions(events),...this.computer.pendingForSession(id)],runtime:await this.remoteRuntime(id)};
    }
    while(start>0&&end-start<2000){const event=events[start-1]!;if(!allowed.has(event.type)){start--;continue;}const safe={...sanitizeRemoteEvent(event),remoteIndex:start-1};const size=Buffer.byteLength(JSON.stringify(safe));if(bytes+size>2*1024*1024&&visible.length)break;bytes+=size;visible.unshift(safe);start--;if(end-start>=250&&(event.type==="user-message"||event.type==="turn-started"))break;}
    const pending=[...remotePendingInteractions(events),...this.computer.pendingForSession(id)];
    return {session,events:visible,totalEvents:events.length,before:start||undefined,truncated:start>0,pending,runtime:await this.remoteRuntime(id)};
  }
  private async performRemoteCommand(command:RemoteCommand,deviceId?:string):Promise<{state:"queued"|"completed";message?:string;resultSessionId?:string}> {
    if(command.action==="workbench"){if(!deviceId)throw Error("设备身份无效");return this.remoteTools().mutate(command.mutation!,deviceId,command.operationId)}
    if(command.action==="create"){
      const options=await this.remoteOptions();const workspace=options.workspaces.find(w=>w.id===command.workspaceId);if(!workspace)throw Error("项目已不可用，请刷新项目列表");
      if(command.profileId&&!workspace.profiles.some(p=>p.id===command.profileId))throw Error("配置档不属于所选项目");
      const settings=await this.settingsStore.get();const discovered=await this.discoverWorkspaces();const cwd=[settings.activeWorkspace,...settings.recentWorkspaces,...discovered.map(w=>w.cwd)].find(path=>createHash("sha256").update(normalizePathKey(path)).digest("hex").slice(0,24)===workspace.id);if(!cwd)throw Error("项目已不可用");
      const created=await this.createSession({workspacePath:cwd,profileId:command.profileId,modelId:command.modelId,providerId:command.providerId,effort:command.effort,mode:command.mode},false);this.invalidateRemoteList();return {state:"completed",resultSessionId:created.sessionId};
    }
    const session=await this.requireRemoteSession(command.sessionId);
    if(command.action==="rename"){await this.renameSession(session.id,command.title!);this.invalidateRemoteList();return {state:"completed"};}
    if(command.action==="archive"){await this.archiveSession(session.id,command.archived!);this.invalidateRemoteList();return {state:"completed"};}
    if(command.action==="delete"){await this.deleteSession(session.cwd,session.id);this.invalidateRemoteList();return {state:"completed"};}
    if(!session.canSend)throw Error("此会话由子智能体或任务 Worker 管理，手机首版仅支持查看");
    if(["send","interject","configure","compact","fork"].includes(command.action)){
      if(!this.processes.snapshot(session.id)){const result=await this.openSession(session.cwd,session.id,false);if(result.sessionId!==session.id||result.hydration!=="ready")throw Error(result.message||"原会话暂时无法继续，未创建新会话");}
    }
    if(command.action==="configure"){
      return this.configurationMutation(session.id,async()=>{if(this.remoteConfigFlights.has(session.id))throw Error("配置正在修改，请刷新后重试");const current=await this.remoteRuntime(session.id);if(current.revision!==command.revision)throw Error("配置已被其他端修改，请刷新后再选择");if(!current.mutable)throw Error(current.reason);
      const fields=["modelId","effort","mode"].filter(key=>command[key as "modelId"]!==undefined);if(fields.length!==1)throw Error("每次只能修改一个配置项");
      this.remoteConfigFlights.add(session.id);try{if(command.modelId!==undefined)await this.setModelNow(session.id,command.modelId);if(command.effort!==undefined)await this.setEffortNow(session.id,command.effort);if(command.mode!==undefined)await this.processes.setMode(session.id,command.mode)}finally{this.remoteConfigFlights.delete(session.id)}return {state:"completed",message:"配置已应用"};});
    }
    if(command.action==="compact"){await this.compactSession(session.id);return {state:"completed"};}
    if(command.action==="fork"){const launch=command.profileId||command.modelId||command.effort!==undefined||command.mode?{workspacePath:session.cwd,profileId:command.profileId,modelId:command.modelId,providerId:command.providerId,effort:command.effort,mode:command.mode}:undefined;const result=await this.forkSession(session.id,command.pointId,launch);this.invalidateRemoteList();return {state:"completed",resultSessionId:result.sessionId};}
    if(command.action==="queue-edit"){await this.editQueuedPrompt(session.id,command.queueId!,command.text!);return {state:"completed"};}
    if(command.action==="queue-move"){await this.reorderQueuedPrompt(session.id,command.queueId!,command.position!);return {state:"completed"};}
    if(command.action==="queue-clear"){await this.clearPromptQueue(session.id);return {state:"completed"};}
    if(command.action==="send"||command.action==="interject"){
      const adapter=this.processes.get(session.id);
      if(adapter.needsUser)throw Error("会话正在等待回答，请先处理确认或问题");
      const attachments=[...(command.attachmentIds?.length?await this.remoteTools().files.attachments(command.attachmentIds,deviceId??"",session.id):[]),...(command.references?.length?await this.remoteReferences(command.references):[])];await this.trustRemoteAttachments(attachments);
      if(command.action==="interject"){await this.interjectPrompt(session.id,command.text!,attachments,command.operationId.slice(14),undefined,undefined,command.toolSelection);return {state:"completed"};}
      if(adapter.working){await this.enqueuePrompt(session.id,command.text!,attachments,command.operationId.slice(14),undefined,undefined,command.toolSelection);return {state:"queued",message:"消息已进入当前会话队列"};}
      await this.sendPrompt(session.id,command.text!,attachments,command.operationId.slice(14),undefined,undefined,command.toolSelection);return {state:"completed"};
    }
    if(command.action==="cancel"){if(!this.processes.snapshot(session.id))throw Error("此会话当前未运行");await this.cancelSession(session.id);return {state:"completed"};}
    if(command.action==="queue-remove"){if(!this.processes.snapshot(session.id))throw Error("此会话当前未运行");await this.removeQueuedPrompt(session.id,command.queueId!);return {state:"completed"};}
    const snapshot=await this.remoteSnapshot(session.id);const pending=snapshot.pending.find(event=>{
      if(command.action==="permission")return event.type==="permission"&&event.request.requestId===command.requestId;
      if(command.action==="question")return event.type==="question"&&event.requestId===command.requestId;
      return event.type==="plan"&&event.requestId===command.requestId;
    });
    if(!pending)throw Error("该请求已处理或已失效，请刷新会话");
    if(command.action==="permission"){if(pending.type!=="permission"||!pending.request.options.some(option=>option.optionId===command.optionId))throw Error("权限选项无效");await this.respondPermission(session.id,command.requestId!,command.optionId!);}
    else if(command.action==="question")await this.respondQuestion(session.id,command.requestId!,command.answers!);
    else await this.respondPlan(session.id,command.requestId,command.verdict!);
    return {state:"completed"};
  }

  async createSession(input: string | ExecutionProfileLaunchInput,activate=true): Promise<SessionLaunchResult> {
    const launch = typeof input === "string" ? { workspacePath: input } : input;
    if (this.deletingWorkspaces.has(normalizePathKey(launch.workspacePath))) throw new Error("此项目正在删除，暂时不能创建会话");
    const workspace = (await resolveExistingWorkspacePath(launch.workspacePath, ".", true)).path;
    const compiled = await this.compileExecutionProfile(workspace, launch.profileId);
    let targetCwd = workspace;
    let worktree: GrokWorktreeSummary | undefined;
    if (compiled.profile.worktree) {
      worktree = await this.worktrees.create({ workspacePath: workspace, name: launch.worktreeName?.trim() || `${profileSlug(compiled.profile.name)}-${new Date().toISOString().slice(0, 10)}`, baseRef: launch.worktreeRef?.trim() || compiled.profile.worktreeRef, agentId: compiled.profile.agentId });
      targetCwd = worktree.path;
    }
    const settings = await this.settingsStore.get();
    const modelId = launch.modelId || compiled.modelId || settings.defaultModel;
    const providerId = launch.providerId || await this.resolveManagedProviderSelection(modelId);
    const effort = launch.effort ?? (compiled.effort || settings.defaultEffort);
    const mode = launch.mode ?? compiled.mode;
    let result: { sessionId: string };
    try {
      result = await this.processes.createConfigured(targetCwd, effort, mode, modelId, undefined, compiled.environment, { agentProfilePath: compiled.agentProfilePath, sessionMeta: compiled.sessionMeta, alwaysApprove: mode === "auto" });
    } catch (error) {
      if (worktree) await this.worktrees.remove(workspace, worktree.id, true).catch(() => undefined);
      throw error;
    }
    void this.cliCapabilities.recordRuntimeSupport(["acp.initialize", "acp.sessionNew"]).catch((error) => this.log.log(error));
    if(activate)this.focusedSessionId = result.sessionId;
    await this.catalog.markRead(result.sessionId);
    const assignment: SessionExecutionAssignment = { sessionId: result.sessionId, sourceWorkspacePath: workspace, cwd: targetCwd, profileId: compiled.profile.id, profileName: compiled.profile.name, profile: compiled.profile, worktreeId: worktree?.id, createdAt: new Date().toISOString() };
    await this.profiles.assign(assignment);
    await this.persistSessionProviderIdentity(result.sessionId, targetCwd, modelId, providerId, compiled.profile.id);
    if (worktree) await this.catalog.recordOrigins([{ sessionId: result.sessionId, kind: "worktree", id: worktree.id, title: compiled.profile.name, suggestedTitle: worktree.name }]);
    return { sessionId: result.sessionId, cwd: targetCwd, profileId: compiled.profile.id, worktreeId: worktree?.id };
  }

  async previewSession(cwd: string, sessionId: string): Promise<SessionPreviewSnapshot> {
    const [projection, presentations, attachments, sessions] = await Promise.all([
      this.conversationProjections.restore(sessionId),
      this.turnPresentations.list(sessionId),
      this.attachmentCache.restore(sessionId).catch(() => []),
      this.catalog.list(cwd, "", this.processes.liveStatuses()).catch(() => []),
    ]);
    const summary = sessions.find((value) => value.id === sessionId);
    return {
      sessionId,
      title: summary?.title || "历史会话",
      lastActivityAt: summary?.updatedAt,
      visibleSummary: projectionVisibleSummary(projection),
      status: summary?.status ?? "cold",
      modelId: projection?.runtime?.modelId ?? summary?.modelId,
      attachmentCount: attachments.length,
      projectionUpdatedAt: projection?.updatedAt,
      projection,
      presentations,
    };
  }

  async inspectSession(cwd: string, sessionId: string): Promise<import("../shared/types").ConversationProjection | undefined> {
    const assertOwner = async (): Promise<void> => {
      if (this.deletingSessions.has(sessionId)) throw new Error("此会话正在删除，无法读取");
      const runtime = await this.sessionRuntime.get(sessionId);
      const owner = this.processes.snapshot(sessionId)?.cwd ?? runtime?.cwd;
      if (owner ? !samePath(owner, cwd) : !await this.catalog.has(cwd, sessionId))
        throw new Error("会话已迁移、删除或不属于此项目，请关闭旧标签后重新打开");
    };
    await assertOwner();
    // inspect deliberately avoids restore(), queue reconciliation and permission settlement.
    const projection = await this.conversationProjections.inspect(sessionId)
      ?? await this.conversationProjections.inspectNative(sessionId, cwd);
    await assertOwner();
    if (projection && projection.sessionId !== sessionId) throw new Error("历史记录身份不匹配");
    return projection;
  }

  async openSession(cwd: string, sessionId: string, activate = true): Promise<{ sessionId: string; hydration?: import("../shared/types").SessionHydrationState; message?: string }> {
    if (this.deletingSessions.has(sessionId)) throw new Error("此会话正在删除，暂时不能打开");
    const pending = this.sessionOpenFlights.get(sessionId);
    if (pending) { if (activate) { this.focusedSessionId = sessionId; await this.catalog.markRead(sessionId); } return pending; }
    const flight = this.openSessionOwned(cwd, sessionId, activate).finally(() => {
      if (this.sessionOpenFlights.get(sessionId) === flight) this.sessionOpenFlights.delete(sessionId);
    });
    this.sessionOpenFlights.set(sessionId, flight);
    return flight;
  }

  private async openSessionOwned(cwd: string, sessionId: string, activate = true): Promise<{ sessionId: string; hydration?: import("../shared/types").SessionHydrationState; message?: string }> {
    const generation = ++this.nextHydrationGeneration;
    this.sessionHydrationGenerations.set(sessionId, generation);
    const emitHydration = (state: import("../shared/types").SessionHydrationState, message?: string): void => {
      if (this.sessionHydrationGenerations.get(sessionId) !== generation) return;
      this.window?.webContents.send("grok:event", { type: "session-hydration", sessionId, state, generation, message } satisfies ChatEvent);
    };
    if (activate) { this.focusedSessionId = sessionId; await this.catalog.markRead(sessionId); }
    const assignment = await this.profiles.assignment(sessionId);
    const targetCwd = assignment?.cwd ?? cwd;
    const presentations = await this.turnPresentations.list(sessionId);
    let projection = await this.conversationProjections.restore(sessionId);
    let recoveryMessage = "";
    if (!projection && presentations.length) {
      const recovery = await this.conversationProjections.recoverLegacy(sessionId, targetCwd);
      projection = recovery.projection;
      if (recovery.status !== "recovered") recoveryMessage = recovery.message;
    }
    if (projection) {
      emitHydration("local");
      this.window?.webContents.send("grok:event", await this.prepareVisibleEvent({ type: "conversation-projection-restore", sessionId, projection } satisfies ChatEvent));
    }
    const attachmentEntries = await this.attachmentCache.restore(sessionId);
    if (attachmentEntries.length) await this.handleEvent({ type: "user-attachments-restore", sessionId, entries: attachmentEntries });
    await this.handleEvent({ type: "turn-presentations-restore", sessionId, presentations });

    this.projectionOpenSessions.add(sessionId);
    this.projectionReplaying.add(sessionId);
    this.projectionReplayBuffers.set(sessionId, []);
    emitHydration("connecting");
    try {
      const result = assignment
        ? await this.openAssignedSession(assignment)
        : await this.processes.open(cwd, sessionId);
      await this.eventFlights.get(sessionId);
      emitHydration("synchronizing");
      const replayed = [...(this.projectionReplayBuffers.get(sessionId) ?? [])];
      if (replayed.length) {
        try {
          projection = await this.conversationProjections.mergeReplay(sessionId, replayed) ?? projection;
        } catch (error) {
          await this.log.log(`会话回放与本地投影合并失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (projection) {
        this.window?.webContents.send("grok:event", await this.prepareVisibleEvent({ type: "conversation-projection-restore", sessionId, projection } satisfies ChatEvent));
      } else {
        // Seed V2 from the only replay available, but never invent history.
        for (const event of replayed) {
          this.window?.webContents.send("grok:event", event);
          await this.conversationProjections.record(event)
            .catch((error) => this.log.log(`会话回放投影失败：${error instanceof Error ? error.message : String(error)}`));
        }
        if (!replayed.length && recoveryMessage) this.window?.webContents.send("grok:event", { type: "history-recovery", sessionId, status: "unavailable", message: recoveryMessage } satisfies ChatEvent);
      }
      this.finishProjectionReplay(sessionId);
      this.processes.get(sessionId).setNextTurnOrdinal(presentations.length);
      emitHydration("ready");
      void this.cliCapabilities.recordRuntimeSupport(["acp.initialize"]).catch((error) => this.log.log(error));
      return { ...result, hydration: "ready" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const state = projection ? "offline" as const : "failed" as const;
      emitHydration(state, message);
      if (projection) return { sessionId, hydration: state, message };
      throw error;
    } finally {
      this.finishProjectionReplay(sessionId);
      this.projectionOpenSessions.delete(sessionId);
    }
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    const normalized = title.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    if (!normalized) throw new Error("会话名称不能为空");
    if ([...normalized].length > 100) throw new Error("会话名称不能超过 100 个字符");
    const source = await this.processes.renameSessionIfLoaded(sessionId, normalized);
    await this.catalog.rename(sessionId, normalized);
    if (source === "official") {
      void this.cliCapabilities.recordRuntimeSupport(["session.rename"]).catch((error) => this.log.log(error));
    }
  }

  private async assertSessionIdleForDeletion(sessionId: string): Promise<void> {
    if (this.sessionOpenFlights.has(sessionId)) throw new Error("会话正在连接，请等待连接完成后再删除");
    const tasks = (await this.automations.list()).filter(task => task.targetSessionId === sessionId || task.sessionId === sessionId);
    if ((await this.automations.listRuns()).some(run => ["running", "awaiting-confirmation"].includes(run.status) && (run.sessionId === sessionId || tasks.some(task => task.id === run.taskId)))) throw new Error("关联定时任务仍在运行，请先完成或取消任务，再删除会话");
    if ([...this.mediaJobs.values()].some(job => job.sessionId === sessionId && (["queued", "running", "cancelling"].includes(job.status) || this.mediaJobControls.has(job.jobId)))) throw new Error("会话仍有媒体任务或正在结束，请等待完成或取消收尾后再删除记录");
    if (["working", "needs-user", "queued"].includes(this.processes.liveStatuses().get(sessionId) ?? "") || this.processes.promptQueues().some(value => value.sessionId === sessionId && value.entries.length > 0)) throw new Error("会话仍在运行或等待，请先停止任务并处理队列，再删除记录");
  }
  async deleteSession(cwd: string, sessionId: string): Promise<void> {
    if (this.deletingSessions.has(sessionId)) throw new Error("此会话正在删除，请等待完成");
    this.deletingSessions.add(sessionId);
    try {
    await this.assertSessionIdleForDeletion(sessionId);
    const assignment = await this.profiles.assignment(sessionId);
    const sessionCwd = assignment?.cwd ?? cwd;
    const known = (await this.catalog.list(sessionCwd, "", this.processes.liveStatuses(), true)).some(row => row.id === sessionId);
    if (!known) throw new Error("未能核验该目录中的会话记录；请刷新列表或显式选择仅清理 Desktop 数据");
    if(process.env.GROK_DESKTOP_OFFLINE_SMOKE==="1")throw new Error("离线验收禁止调用真实 CLI 删除；隔离原始记录保留");
    await this.processes.close(sessionId);
    const settings = await this.settingsStore.get();
    const cliPath = await locateGrokCli(settings.cliPath);
    if (!cliPath) throw new Error("未找到 Grok CLI；尚未删除任何会话数据。可显式选择“仅清理 Desktop 数据”作为降级操作。");
    await deleteCliSession(cliPath, sessionId, buildCliEnv(settings, await this.auth.activeApiKey()));
    await this.catalog.delete(sessionCwd, sessionId);
    await this.cleanupSessionState(sessionId);
    } finally { this.deletingSessions.delete(sessionId); }
  }

  async deleteDesktopSessionData(cwd: string, sessionId: string): Promise<void> {
    if (this.deletingSessions.has(sessionId)) throw new Error("此会话正在删除，请等待完成");
    this.deletingSessions.add(sessionId);
    try {
    await this.assertSessionIdleForDeletion(sessionId);
    await this.processes.close(sessionId);
    await this.catalog.dismiss(sessionId);
    await this.cleanupSessionState(sessionId);
    } finally { this.deletingSessions.delete(sessionId); }
  }

  async clearSessions(cwd: string, keepSessionId?: string): Promise<void> {
    const assignments = (await this.profiles.listAssignments()).filter((value) => samePath(value.sourceWorkspacePath, cwd) && value.sessionId !== keepSessionId);
    const targets = new Map<string, string>();
    for (const session of await this.catalog.list(cwd)) if (session.id !== keepSessionId) targets.set(session.id, cwd);
    for (const assignment of assignments) targets.set(assignment.sessionId, assignment.cwd);
    for (const sessionId of targets.keys()) await this.assertSessionIdleForDeletion(sessionId);
    for (const [sessionId, sessionCwd] of targets) {
      await this.deleteSession(sessionCwd, sessionId);
    }
  }

  private async cleanupSessionState(sessionId: string, forgetTokens = true): Promise<void> {
    await this.uiState.clearDraft(sessionId);
    this.sessionHydrationGenerations.delete(sessionId);
    await this.profiles.removeAssignment(sessionId);
    if (forgetTokens) await this.tokenActivity.forgetSession(sessionId).catch((error) => this.log.log(`Token 活动明细清理失败：${error instanceof Error ? error.message : String(error)}`));
    this.agentChanges.clear(sessionId);
    this.turnFileChanges.clearSession(sessionId);
    await this.mediaAccess.removeSession(sessionId).catch((error) => this.log.log(`媒体访问句柄清理失败：${error instanceof Error ? error.message : String(error)}`));
    await this.mediaThumbnails.removeSession(sessionId).catch((error) => this.log.log(`媒体缩略图缓存清理失败：${error instanceof Error ? error.message : String(error)}`));
    await this.dashboard.clear(`session:${sessionId}`);
    await this.attachmentCache.cleanupSession(sessionId);
    await rm(join(this.userDataPath, "session-media", createHashForPath(sessionId)), { recursive: true, force: true })
      .catch((error) => this.log.log(`会话媒体缓存清理失败：${error instanceof Error ? error.message : String(error)}`));
    for (const [jobId, job] of this.mediaJobs) {
      if (job.sessionId !== sessionId) continue;
      const control = this.mediaJobControls.get(jobId);
      control?.abort.abort(new Error("会话已删除"));
      control?.child?.kill();
      this.mediaJobControls.delete(jobId);
      this.mediaJobs.delete(jobId);this.persistedImageStates?.delete(jobId);
    }
    await this.turnPresentations.delete(sessionId);
    await this.conversationProjections.delete(sessionId);
    await this.sessionRuntime.delete(sessionId);
    if (this.focusedSessionId === sessionId) this.focusedSessionId = "";
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
    await this.processes.waitForCommands(sessionId).catch(() => []);
    const evidence = this.processes.mediaCapabilityEvidence(sessionId);
    return detectMediaCapabilities(evidence.commands, evidence.tools);
  }

  async listImageWorkspace(){const result=await this.imageWorkspace.list();for(const row of result.conversations)for(const record of row.jobs){const current=this.mediaJobs.get(record.job.jobId);if(current)record.job=structuredClone(current)}return result}
  createImageConversation(){return this.imageWorkspace.create()}
  async listCodeImages(){const images=await this.imageWorkspace.list();return this.mediaAccess.listGeneratedImages(new Set([...this.deletingSessions,...images.conversations.map(row=>row.id)]))}
  saveImageDraft(id:string,draft:string){return this.imageWorkspace.draft(id,draft)}
  readAutomationInstructions(id:string){return this.automations.instructions(id)}
  async saveImageComposerDraft(id:string,draft:import("../shared/image-workspace").ImageComposerDraft){
    const row=await this.imageWorkspace.get(id);if(!row)throw Error("图像会话已不存在");
    for(const reference of draft.references){if(!reference.path)continue;const path=await realpath(reference.path);if(!pathWithin(path,row.cwd)&&!hasCanonicalPath(this.trustedPickedPaths,path)&&!row.composerDraft?.references.some(previous=>previous.path===reference.path)&&!row.jobs.some(record=>record.job.status==="completed"&&record.request?.referencePaths?.includes(reference.path!)))throw Error("请通过文件选择器重新授权参考图");}
    return this.imageWorkspace.composer(id,draft);
  }
  extendMediaWait(jobId:string):void{const extend=this.mediaWaitExtensions.get(jobId);if(!extend)throw Error("此任务已结束或尚未开始等待");extend();const job=this.mediaJobs.get(jobId);if(job){job.message="已延长本次等待，没有重新提交生成请求";job.updatedAt=new Date().toISOString();this.publishMediaJob(job)}}
  async pickImageOutputRoot(){const result=await dialog.showOpenDialog(this.window!,{title:"选择图片保存根目录",properties:["openDirectory","createDirectory"]});return result.canceled?undefined:this.imageWorkspace.root(result.filePaths[0]!)}
  renameImageConversation(id:string,title:string){return this.imageWorkspace.rename(id,title)}
  /**
   * Files this record is allowed to delete: the project copies it actually wrote. A record saved
   * before per-artifact paths existed falls back to its flat list; an artwork index is never used,
   * because a batch where one picture failed to save does not line up with that list.
   */
  private savedFilesOf(job:MediaGenerationJob):string[]{
    const perArtifact=job.artifacts.map(artifact=>artifact.savedPath).filter((value):value is string=>Boolean(value));
    return perArtifact.length?perArtifact:[...(job.savedProjectFiles??[])];
  }
  private async removeImageFiles(conversationId:string,folder:string,artifacts:readonly MediaArtifact[],legacyFiles:readonly string[]):Promise<{removed:number;keptFiles:string[]}>{
    const proofs=artifacts.flatMap(artifact=>artifact.ownedFiles??[]);
    if(!proofs.length)return this.removeOwnedMediaFiles(folder,legacyFiles);
    const selected=new Set(artifacts.map(artifact=>artifact.id));
    const state=await this.imageWorkspace.list();
    const protectedPaths=new Set(state.conversations.flatMap(row=>row.jobs.flatMap(record=>record.job.artifacts
      .filter(artifact=>row.id!==conversationId||!selected.has(artifact.id))
      .flatMap(artifact=>[...(artifact.ownedFiles??[]).map(file=>file.path),...(artifact.savedPath?[artifact.savedPath]:[])]))));
    const proofPaths=new Set(proofs.map(file=>process.platform==="win32"?file.path.toLowerCase():file.path));
    const legacyFilesWithoutProof:string[]=[];
    for(const path of legacyFiles){const canonical=await realpath(path).catch(()=>path);if(!proofPaths.has(process.platform==="win32"?canonical.toLowerCase():canonical))legacyFilesWithoutProof.push(path);}
    const legacy=await this.removeOwnedMediaFiles(folder,legacyFilesWithoutProof);
    if(legacy.keptFiles.length)return legacy;
    return removeProvenMediaFiles(proofs,protectedPaths);
  }
  private async cleanupImagePreviewSources(id:string,artifacts:readonly MediaArtifact[]):Promise<void>{
    await this.mediaAccess.removeSources(id,artifacts.map(artifact=>artifact.source));
    // Thumbnails are small regenerable cache entries, never original images.
    await this.mediaThumbnails.removeSession(id);
  }
  /**
   * Deletes only files a conversation is recorded as having produced, and only inside its own folder.
   * The folder itself is never removed recursively: it is the folder the UI offers to open, so a user
   * may keep their own files there, and the confirmation only promises to delete the pictures.
   */
  private async removeOwnedMediaFiles(_folder:string,files:readonly string[]):Promise<{removed:number;keptFiles:string[]}>{
    const keptFiles:string[]=[];
    // Legacy paths have no content/ownership proof. Only an already absent file
    // is safely considered cleaned; a same-name file may now belong to the user.
    for(const file of new Set(files)){
      try{await stat(file);keptFiles.push(file);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")keptFiles.push(file);}
    }
    return {removed:0,keptFiles};
  }
  /** Removes a conversation's folder once it is empty. Files the user put there keep it alive. */
  private async pruneEmptyMediaFolder(cwd:string):Promise<void>{
    const state=await this.imageWorkspace.list();
    const root=await realpath(state.outputRoot).catch(()=>undefined);
    const folder=await realpath(cwd).catch(()=>undefined);
    if(!root||!folder||folder===root||!pathWithin(folder,root)||dirname(folder)!==root)return;
    await rm(folder,{recursive:false,force:true}).catch(()=>undefined);
  }
  /**
   * Removes a session record. With `deleteFiles` the project copies it recorded go too; the folder is
   * only pruned when it is left empty, so unrelated files in it survive.
   */
  async deleteImageConversation(id:string,deleteFiles=false):Promise<{removedFiles:boolean;removedFileCount:number;keptFiles:string[];recordRemoved:boolean;cleanupError?:string}>{
    if(this.deletingSessions.has(id))throw Error("此图像会话正在删除");
    this.deletingSessions.add(id);
    try{
      const row=await this.imageWorkspace.get(id);
      if(!row)throw Error("图像会话已不存在");
      // A running job would keep writing artifacts into a record that no longer exists.
      if(row.jobs.some(record=>["queued","running","cancelling"].includes(record.job.status)))throw Error("请先取消此会话的图像任务");
      if(row.jobs.some(record=>this.mediaJobControls?.has(record.job.jobId)))throw Error("图像任务仍在结束，请稍后再删除");
      const removal=deleteFiles
        ? await this.removeImageFiles(id,row.cwd,row.jobs.flatMap(record=>record.job.artifacts),row.jobs.flatMap(record=>this.savedFilesOf(record.job)))
        : {removed:0,keptFiles:[] as string[]};
      if(removal.keptFiles.length)return {removedFiles:removal.removed>0,removedFileCount:removal.removed,keptFiles:removal.keptFiles,recordRemoved:false};
      // Keep a retryable Desktop record until the original CLI history has actually been removed.
      if(row.cliSessionId){
        try{await this.catalog.delete(row.cwd,row.cliSessionId)}
        catch(error){return {removedFiles:removal.removed>0,removedFileCount:removal.removed,keptFiles:[],recordRemoved:false,cleanupError:`CLI 历史清理失败：${error instanceof Error?error.message:String(error)}`}}
      }
      await this.imageWorkspace.remove(id);await this.mediaAccess.removeSession(id);
      await rm(join(this.userDataPath,"session-media",createHashForPath(id)),{recursive:true,force:true});
      await this.mediaThumbnails.removeSession(id);
      for(const [jobId,job] of this.mediaJobs??[])if(job.sessionId===id){this.mediaJobs.delete(jobId);this.persistedImageStates?.delete(jobId);}
      if(deleteFiles&&!removal.keptFiles.length)await this.pruneEmptyMediaFolder(row.cwd);
      return {removedFiles:removal.removed>0,removedFileCount:removal.removed,keptFiles:[],recordRemoved:true};
    }
    finally{this.deletingSessions.delete(id)}
  }
  /**
   * Removes one generation record. Files are kept unless `deleteFiles` is set, and even then only the
   * images that live inside the conversation's own folder are deleted. Files that could not be removed
   * are reported by path, so nothing disappears without the user being told where it went.
   */
  async deleteImageJob(conversationId:string,jobId:string,deleteFiles:boolean):Promise<{removedFiles:number;keptFiles:string[];recordRemoved:boolean}>{
    if(this.deletingSessions.has(conversationId))throw Error("此图像会话正在删除");
    this.deletingSessions.add(conversationId);
    try{
    const row=await this.imageWorkspace.get(conversationId);
    const record=row?.jobs.find(value=>value.job.jobId===jobId);
    if(!row||!record)throw Error("这条生成记录已不存在");
    if(["queued","running","cancelling"].includes(record.job.status))throw Error("请先取消正在运行的图像任务");
    if(this.mediaJobControls?.has(jobId))throw Error("图像任务仍在结束，请稍后再删除");
    const removal=deleteFiles?await this.removeImageFiles(conversationId,row.cwd,record.job.artifacts,this.savedFilesOf(record.job)):{removed:0,keptFiles:[] as string[]};
    if(removal.keptFiles.length)return {removedFiles:removal.removed,keptFiles:removal.keptFiles,recordRemoved:false};
    await this.imageWorkspace.removeJob(conversationId,jobId);
    await this.cleanupImagePreviewSources(conversationId,record.job.artifacts);
    this.mediaJobs?.delete(jobId);
    return {removedFiles:removal.removed,keptFiles:[],recordRemoved:true};
    }finally{this.deletingSessions.delete(conversationId)}
  }
  /**
   * Removes one picture out of a generation instead of the whole batch. A completed record left with no
   * pictures is dropped, so the gallery never shows an empty success.
   */
  async deleteImageArtifact(conversationId:string,jobId:string,artifactId:string,deleteFiles:boolean):Promise<{removedFiles:number;keptFiles:string[];recordRemoved:boolean}>{
    if(this.deletingSessions.has(conversationId))throw Error("此图像会话正在删除");
    this.deletingSessions.add(conversationId);
    try{
    const row=await this.imageWorkspace.get(conversationId);
    const record=row?.jobs.find(value=>value.job.jobId===jobId);
    if(!row||!record)throw Error("这条生成记录已不存在");
    if(["queued","running","cancelling"].includes(record.job.status))throw Error("请先取消正在运行的图像任务");
    if(this.mediaJobControls?.has(jobId))throw Error("图像任务仍在结束，请稍后再删除");
    const artifact=record.job.artifacts.find(value=>value.id===artifactId);
    if(!artifact)throw Error("这张图片已不存在");
    const legacyPath=record.job.artifacts.length===1&&record.job.savedProjectFiles?.length===1?record.job.savedProjectFiles[0]:undefined;
    const savedPath=artifact.savedPath??legacyPath;
    if(deleteFiles&&!savedPath&&record.job.savedProjectFiles?.length)return {removedFiles:0,keptFiles:[...record.job.savedProjectFiles],recordRemoved:false};
    const removal=deleteFiles?await this.removeImageFiles(conversationId,row.cwd,[artifact],savedPath?[savedPath]:[]):{removed:0,keptFiles:[] as string[]};
    if(deleteFiles&&removal.keptFiles.length)return {removedFiles:0,keptFiles:removal.keptFiles,recordRemoved:false};
    const removed=await this.imageWorkspace.removeArtifact(conversationId,jobId,artifactId);
    await this.cleanupImagePreviewSources(conversationId,[artifact]);
    // listImageWorkspace must not overlay the removed artwork with a stale terminal job snapshot.
    this.mediaJobs?.delete(jobId);
    return {removedFiles:removal.removed,keptFiles:[],recordRemoved:removed.recordRemoved};
    }finally{this.deletingSessions.delete(conversationId)}
  }
  async previewImageOriginal(id:string,jobId:string,artifactId:string){
    if(this.deletingSessions.has(id))throw Error("此图像会话正在删除");
    const row=await this.imageWorkspace.get(id);const record=row?.jobs.find(value=>value.job.jobId===jobId);
    const artifact=record?.job.artifacts.find(value=>value.id===artifactId);
    // Records written before per-artifact paths existed have no unambiguous mapping when a batch
    // partially saved, so only a single saved file is treated as "this picture's original".
    const legacy=record?.job.savedProjectFiles?.length===1?record.job.savedProjectFiles[0]:undefined;
    const path=artifact?.savedPath??legacy;
    if(!path)throw Error("没有此图像的保存记录");
    const canonical=await realpath(path);
    const canonicalParent=await realpath(dirname(path));
    if(!samePath(canonical,join(canonicalParent,basename(path))))throw Error("保存的原图路径已改变");
    const mimeType=localMediaMimeType(canonical);if(!mimeType?.startsWith("image/"))throw Error("保存记录不是图片");
    const cached=await this.cacheMediaArtifact(id,{id:`${jobId}-original-${artifactId}`,media:"image",source:canonical,mimeType,isData:false},[dirname(canonical)],[]);
    if(this.deletingSessions.has(id)||!await this.imageWorkspace.get(id)){
      await this.mediaAccess.removeSession(id);
      throw Error("图像会话已删除，不能恢复预览");
    }
    return cached;
  }
  async submitImage(input:ImageSubmit){
    if(this.deletingSessions.has(input.conversationId))throw Error("此图像会话正在删除");
    if(input.request.kind!=="image")throw Error("图像模式只接受图片任务");
    if(input.request.referencePaths?.length && input.request.route==="provider")throw Error("此 Provider 图片编辑合同尚未接入，请使用 CLI 或移除参考图");
    const prior=await this.imageWorkspace.get(input.conversationId);
    const reserved=await this.imageWorkspace.reserve(input);
    if(!reserved.created)return reserved.job;
    try{
      const references=[...(input.request.referencePaths??[])];
      for(const path of references)if(prior?.composerDraft?.references.some(reference=>reference.path===path)){const canonical=await realpath(path);this.trustedPickedPaths.add(process.platform==="win32"?canonical.toLowerCase():canonical);}
      for(const source of input.referenceSources??[]){const local=await this.mediaAccess.resolve(source);if(local.media!=="image")throw Error("参考产物必须是图片");this.trustedPickedPaths.add(process.platform==="win32"?local.path.toLowerCase():local.path);references.push(local.path)}
      if(references.length && input.request.route==="provider")throw Error("此 Provider 图片编辑合同尚未接入，请选择 CLI");
      return await this.startMediaGeneration({...input.request,referencePaths:references,sessionId:input.conversationId,projectOutputDirectory:"originals"},reserved.job.jobId,reserved.job.outputRoot)
    }
    catch(error){const job={...reserved.job,status:"failed" as const,error:error instanceof Error?error.message:String(error),message:"图像提交失败",updatedAt:new Date().toISOString()};await this.imageWorkspace.update(job);return job}
  }

  async startMediaGeneration(request: MediaCreationRequest & { sessionId: string }, reservedId?:string, imageOutputRoot?:string): Promise<MediaGenerationJob> {
    if (this.disposing) throw new Error("应用正在退出，未提交媒体任务");
    if (this.deletingSessions.has(request.sessionId)) throw new Error("此会话正在删除，暂时不能创建媒体任务");
    const session = this.processes.snapshot(request.sessionId) ?? (request.sessionId.startsWith("image-") ? await this.imageWorkspace.get(request.sessionId) : undefined);
    if (!session) throw new Error("媒体任务需要一个已加载的 Grok 会话");
    const submittedCwd = session.cwd;
    const output = request.projectOutputDirectory !== undefined
      ? await prepareMediaProjectOutput(imageOutputRoot ?? submittedCwd, request.projectOutputDirectory) : undefined;
    if ((!request.sessionId.startsWith("image-") && this.processes.snapshot(request.sessionId)?.cwd !== submittedCwd) || this.deletingSessions.has(request.sessionId)) throw new Error("媒体任务所属项目已改变，请重新打开创作面板");
    if (request.referencePaths?.length) {
      const root = await realpath(session.cwd).catch(() => resolve(session.cwd));
      const normalized: string[] = [];
      for (const path of request.referencePaths.slice(0, 8)) {
        const target = await realpath(path).catch(() => undefined);
        if (!target || (!pathWithin(target, root) && !hasCanonicalPath(this.trustedPickedPaths, target))) {
          throw new Error("参考图必须位于当前会话目录，或由“添加参考图”文件选择器明确选取");
        }
        if (!mimeForExtension(extname(target).toLowerCase())) throw new Error("参考图必须是 PNG、JPEG、WebP 或 GIF");
        normalized.push(target);
        this.trustedPickedPaths.delete(process.platform === "win32" ? target.toLowerCase() : target);
      }
      request = { ...request, referencePaths: normalized };
    }
    const route = request.route === "provider" ? "provider" : "cli";
    if (route === "cli") {
      if (this.mediaCredentialChanges) throw new Error("账号正在变更，请完成登录或账号切换后再生成图片");
      await this.updater.assertRuntimeLaunchAllowed();
    }
    if (this.disposing || (route === "cli" && this.mediaCredentialChanges)) throw new Error("应用或账号状态已改变，未提交媒体任务");
    if (route === "provider" && (!request.providerId || !request.modelId)) throw new Error("请选择自定义 Provider 和模型");
    const now = new Date().toISOString();
    const job: MediaGenerationJob = {
      jobId: reservedId ?? crypto.randomUUID(),
      sessionId: request.sessionId,
      status: "queued",
      route,
      kind: request.kind,
      progress: 0,
      message: route === "provider" ? "正在准备 Provider 媒体请求" : "正在准备 Grok CLI 媒体工具",
      artifacts: [],
      startedAt: now,
      updatedAt: now,
      ...(imageOutputRoot ? { outputRoot: imageOutputRoot } : {}),
    };
    this.mediaJobs.set(job.jobId, job);
    const control = { abort: new AbortController() };
    this.mediaJobControls.set(job.jobId, control);
    this.publishMediaJob(job);
    const flight = this.runMediaJob(job.jobId, request, output, submittedCwd)
      .catch(error => this.log.log(`媒体任务收尾失败：${String(error)}`).catch(() => undefined))
      .finally(() => this.mediaJobFlights.delete(job.jobId));
    this.mediaJobFlights.set(job.jobId, flight);
    return structuredClone(job);
  }

  getMediaGenerationJob(jobId: string): MediaGenerationJob | undefined {
    const job = this.mediaJobs.get(jobId);
    return job ? structuredClone(job) : undefined;
  }

  cancelMediaGeneration(jobId: string): MediaGenerationJob {
    const job = this.mediaJobs.get(jobId);
    if (!job) throw new Error("媒体任务不存在");
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") return structuredClone(job);
    job.status = "cancelling";
    job.message = "正在取消媒体任务";
    job.updatedAt = new Date().toISOString();
    this.publishMediaJob(job);
    const control = this.mediaJobControls.get(jobId);
    control?.abort.abort(new Error("用户取消媒体任务"));
    control?.child?.kill();
    setTimeout(() => {
      const current = this.mediaJobs.get(jobId);
      if (!current || current.status !== "cancelling") return;
      current.status = "cancelled";
      current.message = "媒体任务已取消；迟到结果将被忽略";
      current.completedAt = new Date().toISOString();
      current.updatedAt = current.completedAt;
      // Keep lifecycle ownership until the process and persistence actually settle.
      this.publishMediaJob(current);
    }, 2_000).unref?.();
    return structuredClone(job);
  }

  private async runMediaJob(jobId: string, request: MediaCreationRequest & { sessionId: string }, output?: MediaProjectOutput, submittedCwd?: string): Promise<void> {
    const job = this.mediaJobs.get(jobId);
    const control = this.mediaJobControls.get(jobId);
    if (!job || !control) return;
    job.status = "running";
    job.progress = 5;
    job.updatedAt = new Date().toISOString();
    this.publishMediaJob(job);
    try {
      let artifacts: MediaArtifact[];
      if (job.route === "provider") artifacts = await this.runProviderMedia(request, control.abort.signal,jobId);
      else {
        try { artifacts = await this.runCliMedia(jobId, request, control, submittedCwd); }
        catch (cliError) {
          if (request.route !== "auto" || control.abort.signal.aborted) throw cliError;
          const fallback = await this.providerMediaFallback(request.sessionId, request.kind);
          if (!fallback) throw cliError;
          job.route = "provider";
          job.message = `Grok CLI 路由失败，正在回退到 ${fallback.providerName} · ${fallback.modelName}`;
          job.updatedAt = new Date().toISOString();
          this.publishMediaJob(job);
          request = { ...request, providerId: fallback.providerId, modelId: fallback.modelId };
          artifacts = await this.runProviderMedia(request, control.abort.signal,jobId);
        }
      }
      if (control.abort.signal.aborted) throw control.abort.signal.reason;
      job.message = "正在保存媒体结果";
      job.progress = 90;
      job.updatedAt = new Date().toISOString();
      this.publishMediaJob(job);

      job.artifacts = [];
      const artifactRoots: string[] = submittedCwd ? [submittedCwd] : [];
      if (control.transientSession) {
        const transientWorkspaceRoot = await this.catalog.resolveSessionRoot(control.transientSession.cwd);
        artifactRoots.push(join(transientWorkspaceRoot, control.transientSession.sessionId));
      }
      const allowedOrigins = job.route === "provider"
        ? await this.providerMediaAllowedOrigins(request.providerId)
        : [];
      if (!artifacts.length) throw new Error("媒体工具没有返回可保存的产物");
      for (const artifact of artifacts) {
        control.abort.signal.throwIfAborted();
        const cached = await this.cacheMediaArtifact(request.sessionId, artifact, artifactRoots, allowedOrigins, control.abort.signal);
        control.abort.signal.throwIfAborted();
        job.artifacts.push(cached);
        if(!request.sessionId.startsWith("image-"))await this.handleEvent({ type: "media", sessionId: request.sessionId, media: cached.media, source: cached.source, isData: cached.isData, mimeType: cached.mimeType });
        if (output) {
          try {
            const local = await this.mediaAccess.resolve(cached.source, request.sessionId);
            const saved = await saveProjectMedia(output, local.path, local.mimeType, control.abort.signal);
            (job.savedProjectFiles ??= []).push(saved);
            // Per-artifact, so deleting one picture can never take a different one's file with it.
            cached.savedPath = saved;
            if (request.sessionId.startsWith("image-")) (cached.ownedFiles ??= []).push(await recordOwnedMediaFile(saved, output.root));
          } catch (error) {
            if (control.abort.signal.aborted) throw error;
            job.outputWarning = `图片已保留在会话中，但项目副本保存失败：${error instanceof Error ? error.message : String(error)}。请从图片卡另存，无需重新生成。`;
          }
        }
      }
      job.status = "completed";
      job.progress = 100;
      control.abort.signal.throwIfAborted();
      // Told plainly, because the user asked for a follow-up and the model cannot see it.
      if (control.contextReset) job.contextReset = true;
      job.message = `已生成 ${job.artifacts.length} 个媒体结果${output ? `，已保存 ${job.savedProjectFiles?.length ?? 0} 个项目副本` : ""}${control.contextReset ? "；原会话历史不可用，本轮已开始新的上下文" : ""}`;
    } catch (error) {
      const cancelled = control.abort.signal.aborted || this.mediaJobs.get(jobId)?.status === "cancelling";
      job.status = cancelled ? "cancelled" : "failed";
      job.error = cancelled ? undefined : normalizeMediaJobError(error);
      job.message = cancelled ? control.cancellationMessage ?? "媒体任务已取消" : `媒体任务失败：${job.error}`;
    } finally {
      job.completedAt = new Date().toISOString();
      job.updatedAt = job.completedAt;
      if (control.transientSession && !control.transientSession.keep) {
        await this.catalog.delete(control.transientSession.cwd, control.transientSession.sessionId).catch(async (error) => {
          await this.log.log(`清理媒体临时会话失败：${error instanceof Error ? error.message : String(error)}`);
        });
      }
      try {
        if(job.sessionId.startsWith("image-"))await this.imageWorkspace.update(job).catch(error=>this.log.log(`图像记录保存失败：${String(error)}`).catch(()=>undefined));
      } finally { this.mediaJobControls.delete(jobId); this.mediaWaitExtensions.delete(jobId); }
      this.publishMediaJob(job);
      await this.inbox.add({kind:job.status==="completed"?"completion":"failure",title:job.status==="completed"?"图像任务已完成":job.status==="cancelled"?"媒体等待已取消":"图像任务失败",detail:job.status==="completed"?job.message:job.error||job.message,sessionId:job.sessionId});
      await this.notices().show(`media:${jobId}`,job.status==="completed"?"completion":"failure",job.status==="completed"?"Grok 媒体已生成":"Grok 媒体任务已结束",job.status==="completed"?`已保存 ${job.artifacts.length} 个产物，点击查看。`:"点击查看原因与现有结果。",{kind:job.sessionId.startsWith("image-")?"image":"session",id:job.sessionId});
    }
  }

  private async runCliMedia(jobId: string, request: MediaCreationRequest & { sessionId: string }, control: { abort: AbortController; child?: ReturnType<typeof spawn>; transientSession?: { cwd: string; sessionId: string; keep?: boolean }; contextReset?: boolean }, submittedCwd?: string): Promise<MediaArtifact[]> {
    const settings = await this.settingsStore.get();
    const cliPath = await locateGrokCli(settings.cliPath);
    if (!cliPath) throw new Error("未找到 Grok CLI");
    const imageSession=request.sessionId.startsWith("image-")?await this.imageWorkspace.get(request.sessionId):undefined;
    const session = this.processes.snapshot(request.sessionId) ?? (imageSession?{cwd:imageSession.cwd,modelId:undefined}:undefined);
    if (!session) throw new Error("会话当前未加载");
    if (submittedCwd !== undefined && session.cwd !== submittedCwd) throw new Error("媒体生成前会话项目已改变，请重新提交");
    const executionCwd = session.cwd;
    const catalog = await this.listModelCatalog();
    const boundModel=request.modelId||imageSession?.execution?.modelId||session.modelId;
    const modelId=boundModel||(catalog.some(model=>model.modelId===settings.defaultModel)?settings.defaultModel:catalog.find(model=>model.defaultForCli&&!model.providerId)?.modelId);
    if (!modelId) throw new Error("尚未取得 CLI 默认模型；请刷新模型列表或明确选择后生成图片");
    if (this.modelCatalogProbedAt && !catalog.some(model => model.modelId === modelId)) {
      throw new Error(`调度模型“${modelId}”已不在当前 CLI 的可用目录中。请打开模型选择，刷新后选择可用模型再生成；本次没有提交生图请求。`);
    }
    const providerId = await this.resolveManagedProviderSelection(modelId);
    const accountId = (await this.vault.active())?.profile.id;
    if(imageSession)await this.imageWorkspace.execution(imageSession.id,{modelId,providerId,accountId});
    const mediaJob=this.mediaJobs.get(jobId);if(mediaJob){mediaJob.modelId=modelId;mediaJob.providerId=providerId;}
    const continuing = Boolean(imageSession?.cliSessionId);
    // A continued conversation may edit what an earlier turn produced without a fresh reference file.
    const toolList = request.kind === "image" ? continuing ? "image_gen,image_edit" : request.referencePaths?.length ? "image_edit" : "image_gen" : "video_gen,image_to_video,reference_to_video";
    const prompt = mediaToolPrompt(request, continuing);
    const providerEnvironment = await this.providerLaunchEnvironment({
      scopeId: `media-${crypto.randomUUID()}`,
      sessionId: request.sessionId,
      cwd: session.cwd,
      modelId,
      providerId,
    });
    const apiKey = await this.auth.activeApiKey();
    await this.updater.assertRuntimeLaunchAllowed();
    // `grok --single` still writes a normal CLI session. Give it an isolated
    // UUID and remove that transient catalog entry only after its artifacts
    // have been copied into the Desktop session cache.
    const transientSessionId = imageSession?.cliSessionId ?? crypto.randomUUID();
    if (!imageSession && this.processes.snapshot(request.sessionId)?.cwd !== executionCwd) throw new Error("准备媒体请求期间会话项目已改变，请重新提交");
    control.abort.signal.throwIfAborted();
    // An image conversation owns one real CLI session so later prompts see earlier ones; other media work stays throwaway.
    control.transientSession = { cwd: executionCwd, sessionId: transientSessionId, keep: Boolean(imageSession) };
    if (imageSession && !continuing) await this.imageWorkspace.setCliSession(imageSession.id, transientSessionId);
    const batch = /\.(?:cmd|bat)$/i.test(cliPath);
    const executable = batch ? (process.env.ComSpec || "cmd.exe") : cliPath;
    const launch = async (sessionId: string, resume: boolean): Promise<MediaArtifact[]> => {
      await this.updater.assertRuntimeLaunchAllowed();
      control.abort.signal.throwIfAborted();
      const cliArgs = buildCliMediaArgs(prompt, sessionId, toolList, resume, modelId);
      let usage: import("../shared/types").TurnUsage | undefined;
      try { return await runCliMediaProcess({
      executable,
      args: batch ? ["/d", "/s", "/c", windowsBatchCommand(cliPath, cliArgs)] : cliArgs,
      cwd: session.cwd,
      env: { ...buildCliEnv(settings, apiKey), ...providerEnvironment },
      media: request.kind,
      excludeSources: request.referencePaths,
      signal: control.abort.signal,
      idleTimeoutMs: request.kind === "video" ? 600_000 : 180_000,
      generationTimeoutMs: request.kind === "video" ? 600_000 : 360_000,
      onWaitControl: extend => this.mediaWaitExtensions.set(jobId, extend),
      windowsVerbatimArguments: batch,
      onSpawn: (child) => { control.child = child; },
      onUsage: (reported) => { usage = mergeTurnUsage(usage, {...reported, ...(providerId ? {providerId}: {})}); },
      onProgress: (progress) => {
        const job = this.mediaJobs.get(jobId);
        if (job) {
          job.stage = progress?.stage;
          job.progress = progress?.stage === "result" ? 85 : progress?.stage === "generating" ? 35 : Math.max(job.progress ?? 5, 5);
          job.message = progress?.message ?? "Grok CLI 已有响应，等待媒体结果";
          job.updatedAt = new Date().toISOString();
          this.publishMediaJob(job);
        }
      },
      }); } finally {
        if(usage)await this.tokenActivity.record(request.sessionId,{
          turnId:`media-${jobId}-${sessionId}`,ordinal:0,startedAt:this.mediaJobs.get(jobId)!.startedAt,
          completedAt:new Date().toISOString(),usage,
        },{workspace:executionCwd}).catch(error=>this.log.log(`媒体用量记录失败：${String(error)}`).catch(()=>undefined));
      }
    };
    if (!continuing) return launch(transientSessionId, false);
    try { return await launch(transientSessionId, true); }
    catch (error) {
      // The CLI session was removed outside the app (cleanup, another machine): start a fresh one instead of failing the prompt.
      const message = error instanceof Error ? error.message : String(error);
      if (control.abort.signal.aborted || !/session.{0,80}(not found|does not exist|no such)|(not found|no such).{0,40}session|cannot resume|unable to resume/i.test(message)) throw error;
      const fresh = crypto.randomUUID();
      control.transientSession = { cwd: executionCwd, sessionId: fresh, keep: true };
      await this.imageWorkspace.setCliSession(imageSession!.id, fresh);
      // The conversation continues under a new CLI session: this turn cannot see the earlier ones.
      control.contextReset = true;
      return launch(fresh, false);
    }
  }

  private async cacheMediaArtifact(
    sessionId: string,
    artifact: MediaArtifact,
    additionalTrustedRoots: readonly string[] = [],
    allowedOrigins: readonly string[] = [],
    signal?: AbortSignal,
  ): Promise<MediaArtifact> {
    const directory = join(this.userDataPath, "session-media", createHashForPath(sessionId));
    await mkdir(directory, { recursive: true });
    if (!artifact.isData) {
      if (/^https?:\/\//i.test(artifact.source)) {
        const response = await fetchTrustedRemoteMediaArtifact(artifact.source, {
          allowedOrigins,
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
        });
        if (!response.ok) throw new Error(`媒体产物下载返回 HTTP ${response.status}`);
        const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
        if (artifact.media === "image" ? !mimeType?.startsWith("image/") : !mimeType?.startsWith("video/")) {
          throw new Error("媒体产物 URL 返回了不匹配的内容类型");
        }
        const extension = artifact.media === "video"
          ? mimeType === "video/webm" ? ".webm" : mimeType === "video/quicktime" ? ".mov" : ".mp4"
          : mimeType === "image/jpeg" ? ".jpg" : mimeType === "image/webp" ? ".webp" : mimeType === "image/gif" ? ".gif" : ".png";
        const target = join(directory, `${artifact.id}${extension}`);
        await writeBoundedResponseFile(response, target, artifact.media === "video" ? 256 * 1024 * 1024 : 24 * 1024 * 1024);
        if (artifact.media === "video" && !await isSupportedVideoFile(target)) throw new Error("媒体 URL 返回的视频文件无效或容器不受支持");
        if (artifact.media === "image" && nativeImage.createFromPath(target).isEmpty()) throw new Error("媒体 URL 返回的图片文件无效");
        return this.exposeCachedMedia(sessionId, { ...artifact, source: target, mimeType, isData: false, name: artifact.name || `${artifact.id}${extension}` });
      }
      const sessionRoot = this.processes.snapshot(sessionId)?.cwd;
      const trustedRoots = [...additionalTrustedRoots];
      if (sessionRoot) trustedRoots.push(sessionRoot);
      const source = await resolveTrustedMediaArtifactSource(artifact.source, trustedRoots);
      if (!source) {
        throw new Error("媒体工具返回了会话工作区之外的文件");
      }
      const extension = extname(source) || (artifact.media === "video" ? ".mp4" : ".png");
      const target = join(directory, `${artifact.id}${extension}`);
      await copyFile(source, target);
      if (artifact.media === "image" && nativeImage.createFromPath(target).isEmpty()) throw new Error("媒体工具返回的图片文件无效");
      if (artifact.media === "video" && !await isSupportedVideoFile(target)) throw new Error("媒体工具返回的视频文件无效或容器不受支持");
      const ownedFiles = sessionId.startsWith("image-") ? [await recordOwnedMediaFile(source, dirname(source))] : undefined;
      return this.exposeCachedMedia(sessionId, { ...artifact, source: target, isData: false, ownedFiles });
    }
    const maxBytes = artifact.media === "video" ? 256 * 1024 * 1024 : 24 * 1024 * 1024;
    if (Buffer.byteLength(artifact.source, "ascii") > Math.ceil(maxBytes * 4 / 3) + 8) {
      throw new Error("媒体产物超过缓存大小限制");
    }
    const buffer = Buffer.from(artifact.source, "base64");
    if (buffer.byteLength > maxBytes) throw new Error("媒体产物超过缓存大小限制");
    const image = nativeImage.createFromBuffer(buffer);
    if (artifact.media === "image" && image.isEmpty()) throw new Error("Provider 返回的图片数据无效");
    if (artifact.media === "video" && !isSupportedVideoBuffer(buffer)) throw new Error("Provider 返回的视频数据无效或容器不受支持");
    const extension = artifact.media === "video" ? ".mp4" : artifact.mimeType === "image/jpeg" ? ".jpg" : ".png";
    const target = join(directory, `${artifact.id}${extension}`);
    await writeFile(target, buffer);
    return this.exposeCachedMedia(sessionId, { ...artifact, source: target, isData: false });
  }

  private async exposeCachedMedia(sessionId: string, artifact: MediaArtifact): Promise<MediaArtifact> {
    const mimeType = artifact.mimeType || localMediaMimeType(artifact.source);
    if (!mimeType) throw new Error("媒体缓存文件类型不受支持");
    const handle = await this.mediaAccess.register(sessionId, artifact.source, artifact.media, mimeType, artifact.name);
    if (sessionId.startsWith("image-")) (artifact.ownedFiles ??= []).push(await recordOwnedMediaFile(artifact.source, join(this.userDataPath, "session-media", createHashForPath(sessionId))));
    return { ...artifact, source: handle.url, mimeType: handle.mimeType, isData: false, name: handle.name };
  }

  private async exposeAttachmentPreviews(sessionId: string, previews: UserMessageAttachmentPreview[] | undefined): Promise<UserMessageAttachmentPreview[] | undefined> {
    if (!previews?.length) return previews;
    return Promise.all(previews.map(async (preview) => {
      if (preview.kind !== "image" || preview.isData || !preview.source || preview.source.startsWith("grok-media://access/")) return preview;
      try {
        const handle = await this.mediaAccess.registerAttachment(sessionId, preview.source, preview.mimeType || "image/png", preview.name);
        return { ...preview, source: handle.url, isData: false, availability: "ready" as const };
      } catch {
        return { ...preview, source: undefined, isData: false, availability: "missing" as const };
      }
    }));
  }

  private async prepareVisibleEvent(event: ChatEvent): Promise<ChatEvent> {
    if (event.type === "conversation-projection-restore") {
      const events: Array<Record<string, unknown>> = [];
      for (const value of event.projection.events) {
        if (!value || typeof value !== "object" || typeof value.type !== "string") { events.push(value); continue; }
        events.push(await this.prepareVisibleEvent(value as ChatEvent) as unknown as Record<string, unknown>);
      }
      return { ...event, projection: { ...event.projection, events } as ConversationProjection };
    }
    if (event.type === "user-message") {
      return { ...event, attachments: await this.exposeAttachmentPreviews(event.sessionId, event.attachments) };
    }
    if (event.type === "user-attachments-restore") {
      return {
        ...event,
        entries: await Promise.all(event.entries.map(async (entry) => ({
          ...entry,
          attachments: await this.exposeAttachmentPreviews(event.sessionId, entry.attachments) ?? [],
        }))),
      };
    }
    if (event.type === "prompt-queue") {
      return {
        ...event,
        entries: await Promise.all(event.entries.map(async (entry) => ({
          ...entry,
          attachmentPreviews: await this.exposeAttachmentPreviews(event.sessionId, entry.attachmentPreviews),
        }))),
      };
    }
    if (event.type !== "media" || event.source.startsWith("grok-media://access/")) return event;
    try {
      const cwd = this.processes.snapshot(event.sessionId)?.cwd ?? "";
      const allowedOrigins = await this.sessionMediaAllowedOrigins(event.sessionId);
      const source = event.isData ? event.source : normalizeAcpMediaArtifactSource(event.source, cwd, { allowedOrigins });
      const sessionRoot = cwd ? join(await this.catalog.resolveSessionRoot(cwd), event.sessionId) : undefined;
      const cached = await this.cacheMediaArtifact(event.sessionId, {
        id: `acp-${randomUUID()}`,
        media: event.media,
        source,
        isData: event.isData,
        mimeType: event.mimeType,
      }, sessionRoot ? [sessionRoot] : [], allowedOrigins);
      return { type: "media", sessionId: event.sessionId, media: cached.media, source: cached.source, mimeType: cached.mimeType, isData: false };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.log.log(`ACP 媒体产物未进入会话缓存：${detail}`);
      return { type: "error", sessionId: event.sessionId, message: `媒体产物不可用：${detail}` };
    }
  }

  private async runProviderMedia(request: MediaCreationRequest & { sessionId: string }, signal: AbortSignal,jobId?:string): Promise<MediaArtifact[]> {
    if (!request.providerId || !request.modelId) throw new Error("Provider 媒体路由缺少提供商或模型");
    return request.kind === "image"
      ? this.providers.generateImage({ providerId: request.providerId, modelId: request.modelId, prompt: request.prompt, aspectRatio: request.aspectRatio, signal,onUsage:async usage=>jobId?this.tokenActivity.record(request.sessionId,{turnId:`media-provider:${jobId}`,ordinal:0,startedAt:this.mediaJobs.get(jobId)?.startedAt??new Date().toISOString(),completedAt:new Date().toISOString(),usage},{workspace:this.processes.snapshot(request.sessionId)?.cwd??(await this.imageWorkspace.get(request.sessionId))?.cwd}).catch(error=>this.log.log(`媒体用量记录失败：${String(error)}`)):undefined })
      : this.providers.generateVideo({ providerId: request.providerId, modelId: request.modelId, prompt: request.prompt, aspectRatio: request.aspectRatio, duration: request.duration ?? 6, resolution: request.resolution ?? "480p", voice: request.voice, referencePaths: request.referencePaths, signal });
  }

  private async providerMediaAllowedOrigins(providerId?: string): Promise<string[]> {
    if (!providerId) return [];
    const provider = await this.providers.managedProviderById(providerId);
    if (!provider || provider.enabled === false) return [];
    try { return [new URL(provider.baseUrl).origin]; }
    catch { return []; }
  }

  private async sessionMediaAllowedOrigins(sessionId: string): Promise<string[]> {
    const runtime = await this.sessionRuntime.get(sessionId);
    if (runtime?.providerId) return this.providerMediaAllowedOrigins(runtime.providerId);
    const modelId = runtime?.modelId ?? this.processes.snapshot(sessionId)?.modelId;
    const provider = await this.providers.managedProviderForModel(modelId);
    return this.providerMediaAllowedOrigins(provider?.id);
  }

  private async providerMediaFallback(sessionId: string, kind: MediaCreationKind): Promise<{ providerId: string; providerName: string; modelId: string; modelName: string } | undefined> {
    const modelId = this.processes.snapshot(sessionId)?.modelId;
    if (!modelId) return undefined;
    const provider = await this.providers.managedProviderForModel(modelId);
    if (!provider || provider.enabled === false) return undefined;
    const model = provider.models.find((value) => value.id === modelId && value.enabled !== false);
    if (!model) return undefined;
    const verified = Object.values(model.capabilities?.protocols ?? {}).some((capability) => kind === "image" ? capability?.imageGeneration : capability?.videoGeneration);
    const configured = kind === "image" ? Boolean(model.media?.image) : Boolean(model.media?.video?.endpoint);
    if (!verified && !configured) return undefined;
    return { providerId: provider.id, providerName: provider.name, modelId: model.id, modelName: model.name || model.model };
  }

  private publishMediaJob(job: MediaGenerationJob): void {
    if(job.sessionId.startsWith("image-") && this.persistedImageStates.get(job.jobId)!==job.status){this.persistedImageStates.set(job.jobId,job.status);void this.imageWorkspace.update(job).catch(error=>this.log.log(`图像记录保存失败：${String(error)}`).catch(()=>undefined));}
    if (this.window && !this.window.isDestroyed() && !this.window.webContents.isDestroyed()) this.window.webContents.send("grok:media-progress", structuredClone(job));
  }

  getSessionMcpTools(sessionId: string) { return this.processes.get(sessionId).discoverMcpTools(); }

  async sendPrompt(sessionId: string, text: string, attachments: Attachment[], clientMessageId?: string, draftKey?: string, draftSubmissionId?: string, toolSelection?: import("../shared/types").McpToolSelection): Promise<void> {
    this.assertCredentialStable();
    if (this.deletingSessions.has(sessionId)) throw new Error("此会话正在删除，暂时不能发送消息");
    clientMessageId ??= crypto.randomUUID();
    const prepared = await this.prepareSubmissionAttachments(sessionId, attachments, draftKey).catch(async (error) => { await this.uiState.settleSubmission(draftSubmissionId, false).catch(() => undefined); throw error; });
    await this.attachmentCache.record(sessionId, clientMessageId, text, prepared.previews, "sending");
    let detachedDraftFiles: string[] = [];
    try {
      detachedDraftFiles = await this.detachSubmissionDraft(sessionId, draftKey, draftSubmissionId);
      this.assertCredentialStable();
      await this.processes.get(sessionId).prompt(text, prepared.attachments, INTERACTIVE_PROMPT_TIMEOUT_MS, { clientMessageId, attachments: prepared.previews, toolSelection });
      await this.attachmentCache.updateDelivery(sessionId, clientMessageId, "sent").catch((error) => this.log.log(`发送已完成，附件账本更新失败：${String(error)}`).catch(() => undefined));
      await this.uiState.settleSubmission(draftSubmissionId, true).catch((error) => this.log.log(`提交已接收，恢复快照结算失败：${String(error)}`).catch(() => undefined));
      await this.discardSubmissionDraftFiles(draftKey, detachedDraftFiles).catch(() => undefined);
    } catch (error) {
      await this.uiState.settleSubmission(draftSubmissionId, false).catch(() => undefined);
      await this.attachmentCache.updateDelivery(sessionId, clientMessageId, "failed").catch(() => undefined);
      await this.handleEvent({ type: "user-message", sessionId, id: clientMessageId, clientMessageId, text, attachments: prepared.previews, delivery: "failed" });
      throw error;
    }
  }

  async getOfflineUiFixture(): Promise<OfflineUiFixture | null> {
    if (process.env.GROK_DESKTOP_OFFLINE_SMOKE !== "1" || process.env.GROK_DESKTOP_UI_FIXTURE !== "1") return null;
    this.offlineUiSessionResponder?.reset();
    const sessionId = OFFLINE_UI_SESSION_IDS.conversation;
    const workspace = (await this.settingsStore.get()).activeWorkspace || process.cwd();
    const fixtureProject = await resolveProjectIdentity(workspace);
    const fixtureDraftKey = `new:${fixtureProject.id}`;
    if (!(await this.uiState.getDraft(fixtureDraftKey))) {
      await this.uiState.setDraft(fixtureDraftKey, "0.8.1 本地草稿（尚未启动 CLI）", undefined, [], {
        projectId: fixtureProject.id,
        workspacePath: fixtureProject.canonicalPath,
        profileId: "builtin-normal",
        modelId: "fixture-draft-model",
        effort: "high",
        mode: "agent",
      });
    }
    // Keep the offline fixture as a real RGBA PNG. Electron's nativeImage
    // rejects the older grayscale/alpha sample even though some decoders
    // accept it, which made the generated-media card disappear as an error.
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMIWPDhPwAGBALgx3AGRgAAAABJRU5ErkJggg==";
    const imageAttachments: Attachment[] = ["architecture.png", "result.png", "detail.png"].map((name, index) => ({ id: `fixture-image-${index + 1}`, name, kind: "image", mimeType: "image/png", size: 68, data: png }));
    const prepared = await this.attachmentCache.prepare(sessionId, imageAttachments);
    await this.attachmentCache.record(sessionId, "fixture-client-images", "请检查这些界面截图。", prepared.previews, "sent");
    const failed = await this.attachmentCache.prepare(sessionId, [{ id: "fixture-failed-image", name: "retry.png", kind: "image", mimeType: "image/png", size: 68, data: png }]);
    await this.attachmentCache.record(sessionId, "fixture-client-failed", "这条消息用于测试失败恢复。", failed.previews, "failed");
    const now = new Date().toISOString();
    const session: SessionSummary = { id: sessionId, cwd: workspace, title: "0.8.1 会话生命周期与并发验收", createdAt: now, updatedAt: now, messageCount: 39, status: "cold", pinned: true, originKind: "normal" };
    const waitingSessionId = OFFLINE_UI_SESSION_IDS.waiting;
    const backgroundSessionId = OFFLINE_UI_SESSION_IDS.background;
    const waitingSession: SessionSummary = { id: waitingSessionId, cwd: workspace, title: "0.8.1 Plan 与权限交互", createdAt: now, updatedAt: now, messageCount: 4, status: "needs-user", originKind: "normal" };
    const backgroundSession: SessionSummary = { id: backgroundSessionId, cwd: workspace, title: "0.8.1 后台并行队列", createdAt: now, updatedAt: now, messageCount: 3, status: "working", originKind: "normal" };
    const legacyEvents: ChatEvent[] = Array.from({ length: 30 }, (_, index): ChatEvent[] => [
      { type: "tool-call", sessionId, tool: { toolCallId: `legacy-read-${index}`, title: `历史读取 ${index + 1}`, kind: "read_file", status: index % 11 === 0 ? "failed" : "completed", output: `历史执行片段 ${index + 1}`, locations: [{ path: "src/renderer/src/App.tsx", line: index + 1 }] } },
      { type: "turn-completed", sessionId },
    ]).flat();
    const events: ChatEvent[] = [
      { type: "session-ready", sessionId, models: [{ modelId: "fixture-model", name: "Offline Fixture", totalContextTokens: 512_000 }], currentModelId: "fixture-model", effort: "high" },
      ...legacyEvents,
      { type: "turn-presentations-restore", sessionId, presentations: [{ turnId: "fixture-client-images", clientMessageId: "fixture-client-images", ordinal: 0, startedAt: "2026-07-22T07:00:00.000Z", completedAt: "2026-07-22T07:01:23.000Z", durationMs: 83_000, outcome: "completed", usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150, modelId: "fixture-model", source: "prompt-result", exact: true } }] },
      { type: "user-message", sessionId, id: "fixture-client-images", clientMessageId: "fixture-client-images", text: "请检查这些界面截图。", attachments: prepared.previews, delivery: "sent" },
      { type: "thought-chunk", sessionId, text: "正在核对布局、交互状态和附件可见性。" },
      { type: "tool-call", sessionId, tool: { toolCallId: "fixture-read", title: "读取界面结构", kind: "read_file", status: "completed", output: "已读取会话壳层。", locations: [{ path: "src/renderer/src/App.tsx", line: 1 }] } },
      { type: "tool-call", sessionId, tool: { toolCallId: "fixture-edit", title: "修改会话样式", kind: "edit", status: "completed", output: "已更新消息与附件布局。", content: [{ type: "diff", path: "src/renderer/src/styles.css", oldText: ".message { width: 100%; }", newText: ".message { width: min(760px, 100%); }" }], oldText: ".message { width: 100%; }", newText: ".message { width: min(760px, 100%); }", additions: 1, deletions: 1, locations: [{ path: "src/renderer/src/styles.css", line: 1 }] } },
      { type: "subagent", sessionId, update: { sessionUpdate: "subagent_spawned", subagent_id: "fixture-sub-1", child_session_id: "fixture-sub-1", subagent_type: "explore", description: "审查侧栏与右窗格布局", model: "fixture-model", capability_mode: "read-only" } },
      { type: "subagent", sessionId, update: { sessionUpdate: "subagent_finished", subagent_id: "fixture-sub-1", child_session_id: "fixture-sub-1", status: "completed", tool_calls: 12, turns: 2, duration_ms: 84_000, tokens_used: 41_200, output: "## 审查结论\n\n侧栏与右窗格的层级一致，没有发现遮挡。\n\n- 侧栏宽度可拖拽，折叠后内容区自动补位\n- 右窗格在窄窗口改为浮层\n\n建议把设置改成整页。" } },
      { type: "subagent", sessionId, update: { sessionUpdate: "subagent_spawned", subagent_id: "fixture-sub-2", child_session_id: "fixture-sub-2", subagent_type: "general", description: "核对图像模式入口", model: "fixture-model" } },
      { type: "subagent", sessionId, update: { sessionUpdate: "subagent_progress", subagent_id: "fixture-sub-2", child_session_id: "fixture-sub-2", tool_calls: 5, turns: 1, tokens_used: 9_800 } },
      { type: "message-chunk", sessionId, text: "界面结构已按任务流收敛，图片在发送后保留于用户消息中。" },
      { type: "media", sessionId, media: "image", source: png, isData: true, mimeType: "image/png" },
      { type: "turn-completed", sessionId, presentation: { turnId: "fixture-client-images", clientMessageId: "fixture-client-images", ordinal: 0, startedAt: "2026-07-22T07:00:00.000Z", completedAt: "2026-07-22T07:01:23.000Z", durationMs: 83_000, outcome: "completed", usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150, modelId: "fixture-model", source: "prompt-result", exact: true } } },
      { type: "error", sessionId, message: "HTTP 400\nProvider: fixture-provider\nTrace: fixture-trace\n响应: GenerateContentRequest.tools[0].function_declarations[0].parameters.properties[status].enum[4]: cannot be empty", failure: {
        failureId: "fixture-failure", at: now, classification: "schema-rejected",
        message: "GenerateContentRequest.tools[0].function_declarations[0].parameters.properties[status].enum[4]: cannot be empty",
        sessionId, modelId: "fixture-model", providerId: "fixture-provider", httpStatus: 400,
        traceId: "fixture-trace", gatewayPhase: "upstream", sanitizedCount: 0,
        nextActions: ["把提供商「Fixture」的工具 Schema 改为 Gemini / Antigravity 档后重试", "改档后重试本回合；应用会在转发前清理不被接受的枚举与类型"],
      } },
      { type: "user-message", sessionId, id: "fixture-plan", clientMessageId: "fixture-plan", text: "列出后续步骤。", delivery: "sent" },
      { type: "plan", sessionId, text: "1. 验证左右侧栏。\n2. 验证消息与文件卡。\n3. 验证输入框和底部环境栏。" },
      { type: "message-chunk", sessionId, text: "计划已完成，所有入口均映射到真实功能。" },
      { type: "turn-completed", sessionId, presentation: { turnId: "fixture-plan", clientMessageId: "fixture-plan", ordinal: 1, startedAt: "2026-07-22T07:02:00.000Z", completedAt: "2026-07-22T07:03:23.000Z", durationMs: 83_000, outcome: "completed", usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150, modelId: "fixture-model", source: "prompt-result", exact: true } } },
      { type: "user-message", sessionId, id: "fixture-partial", clientMessageId: "fixture-partial", text: "演示中断后仍保留半段回答。", delivery: "sent" },
      { type: "thought-chunk", sessionId, text: "正在生成一个会被中断的长回答。" },
      { type: "message-chunk", sessionId, text: "这是已经显示给用户的部分回答。即使进程重建或请求失败，这段可见正文也必须在第二次、第三次打开会话时保留。" },
      { type: "error", sessionId, message: "fixture provider stream closed", failure: {
        failureId: "fixture-partial-failure", at: now, classification: "network",
        message: "Provider stream closed after partial output", sessionId, modelId: "fixture-model",
        nextActions: ["保留部分回答", "检查网络后重试"],
      } },
      { type: "turn-completed", sessionId, presentation: { turnId: "fixture-partial", clientMessageId: "fixture-partial", ordinal: 2, startedAt: "2026-07-22T07:04:00.000Z", completedAt: "2026-07-22T07:13:13.000Z", durationMs: 553_000, outcome: "failed", usage: { inputTokens: 356_400, outputTokens: 34, cachedReadTokens: 352_300, reasoningTokens: 25, totalTokens: 356_459, modelId: "fixture-model", source: "prompt-result", exact: true } } },
      { type: "user-message", sessionId, id: "fixture-client-failed", clientMessageId: "fixture-client-failed", text: "这条消息用于测试失败恢复。", attachments: failed.previews, delivery: "failed" },
      { type: "status", sessionId, status: "idle", text: "离线夹具" },
      { type: "session-ready", sessionId: waitingSessionId, models: [{ modelId: "fixture-model", name: "Offline Fixture", totalContextTokens: 512_000 }], currentModelId: "fixture-model", effort: "medium" },
      { type: "mode", sessionId: waitingSessionId, mode: "plan" },
      { type: "user-message", sessionId: waitingSessionId, id: "fixture-waiting-user", clientMessageId: "fixture-waiting-user", text: "先制定计划，并演示权限确认。", delivery: "sent" },
      { type: "plan", sessionId: waitingSessionId, requestId: "fixture-plan-request", text: "1. 只读检查项目。\n2. 汇总发现。\n3. 等待批准后再执行写操作。" },
      { type: "permission", sessionId: waitingSessionId, request: { requestId: "fixture-permission-request", sessionId: waitingSessionId, toolCall: { name: "执行受保护的修改", description: "写入 src/example.ts" }, options: [{ optionId: "deny", name: "No", kind: "reject_once" }, { optionId: "allow", name: "Yes", kind: "allow_once" }] } },
      { type: "status", sessionId: waitingSessionId, status: "needs-user", text: "等待计划或权限决定" },
      { type: "session-ready", sessionId: backgroundSessionId, models: [{ modelId: "fixture-background-model", name: "Background Fixture", totalContextTokens: 200_000 }], currentModelId: "fixture-background-model", effort: "xhigh" },
      { type: "user-message", sessionId: backgroundSessionId, id: "fixture-background-user", clientMessageId: "fixture-background-user", text: "在后台继续分析，不要影响前台草稿。", delivery: "sent" },
      { type: "turn-started", sessionId: backgroundSessionId, presentation: this.offlineUiSessionResponder?.backgroundPresentation() ?? { turnId: "fixture-background-turn", clientMessageId: "fixture-background-user", ordinal: 0, startedAt: now } },
      { type: "thought-chunk", sessionId: backgroundSessionId, text: "后台会话正在独立运行。" },
      { type: "prompt-queue", sessionId: backgroundSessionId, entries: this.offlineUiSessionResponder?.backgroundQueue() ?? [{ id: "fixture-background-queue", sessionId: backgroundSessionId, text: "后台排队消息", position: 0, createdAt: now, state: "queued", clientMessageId: "fixture-background-queue" }] },
      { type: "status", sessionId: backgroundSessionId, status: "working", text: "后台处理中" },
    ];
    // Exercise the same Desktop-owned attachment ledger restore path used by
    // a real reopened session.  The fixture intentionally emits the restore
    // after ACP-like replay so a dropped/partial user-message replay cannot
    // make the image card disappear on a renderer reload.
    const restoredAttachments = await this.attachmentCache.restore(sessionId);
    if (restoredAttachments.length) events.push({ type: "user-attachments-restore", sessionId, entries: restoredAttachments });
    return {
      session,
      sessions: [session, waitingSession, backgroundSession],
      activeSessionId: sessionId,
      events: await Promise.all(events.map((event) => this.prepareVisibleEvent(event))),
    };
  }

  async cancelSession(sessionId: string): Promise<void> {
    if (this.offlineUiSessionResponder?.owns(sessionId)) {
      await this.offlineUiSessionResponder.cancelSession(sessionId);
      return;
    }
    await this.computer.settleSession(sessionId, "stopped", "Grok 回合已停止，Computer Use 已清理");
    await this.processes.cancelSession(sessionId);
  }

  async setModel(sessionId: string, modelId: string): Promise<void> {
    return this.configurationMutation(sessionId,()=>this.setModelNow(sessionId,modelId));
  }
  private configurationQueues=new Map<string,Promise<unknown>>();
  private async configurationMutation<T>(id:string,operation:()=>Promise<T>):Promise<T>{const previous=this.configurationQueues.get(id)??Promise.resolve();const next=previous.catch(()=>undefined).then(operation);this.configurationQueues.set(id,next);try{return await next}finally{if(this.configurationQueues.get(id)===next)this.configurationQueues.delete(id)}}
  private async setModelNow(sessionId:string,modelId:string):Promise<void>{
    const providerId = await this.resolveManagedProviderSelection(modelId);
    const previous = await this.sessionRuntime.get(sessionId);
    const snapshot = this.processes.snapshot(sessionId);
    const previousModelId = previous?.modelId ?? snapshot?.modelId;
    const previousProviderId = previous?.providerId
      ?? (await this.providers.managedProviderForModel(previousModelId))?.id;
    try {
      await this.processes.setModel(sessionId, modelId, {
        target: { providerId, localModelId: modelId },
        previous: { providerId: previousProviderId, localModelId: previousModelId },
      });
      if (previous) await this.sessionRuntime.save({ ...previous, modelId, providerId });
      else if (snapshot) await this.sessionRuntime.save({ sessionId, cwd: snapshot.cwd, modelId, providerId, effort: snapshot.effort, mode: snapshot.mode });
    } catch (error) {
      if (previous) await this.sessionRuntime.save(previous);
      else await this.sessionRuntime.deletePreferences(sessionId);
      throw error;
    }
  }

  async setEffort(sessionId: string, effort: ReasoningEffort): Promise<void> {
    return this.configurationMutation(sessionId,()=>this.setEffortNow(sessionId,effort));
  }
  private async setEffortNow(sessionId:string,effort:ReasoningEffort):Promise<void>{
    if (!REASONING_EFFORTS.includes(effort)) throw new Error("不支持的推理强度");
    await this.processes.setEffort(sessionId, effort);
  }

  async setMode(sessionId: string, mode: SessionMode): Promise<void> {
    await this.configurationMutation(sessionId,()=>this.processes.setMode(sessionId, mode));
  }

  async pickAttachments(): Promise<Attachment[]> {
    const result = await dialog.showOpenDialog(this.window!, { title: "添加文件或图片", properties: ["openFile", "multiSelections"] });
    if (result.canceled) return [];
    const paths = await Promise.all(result.filePaths.map((path) => canonicalExistingPath(path, "file")));
    for (const path of paths) rememberCanonicalPath(this.trustedPickedPaths, path);
    return this.buildAttachmentsFromPaths(paths);
  }

  async pickAttachmentFolders(): Promise<Attachment[]> {
    const result = await dialog.showOpenDialog(this.window!, { title: "添加文件夹", properties: ["openDirectory", "multiSelections"] });
    if (result.canceled) return [];
    const paths = await Promise.all(result.filePaths.map((path) => canonicalExistingPath(path, "directory")));
    for (const path of paths) rememberCanonicalPath(this.trustedPickedPaths, path);
    return this.buildAttachmentsFromPaths(paths);
  }

  async attachmentsFromPaths(paths: string[], sessionId?: string): Promise<Attachment[]> {
    const roots = await this.trustedAttachmentRoots(sessionId ?? (this.focusedSessionId || undefined));
    const trusted = await Promise.all(paths.map((path) => resolveTrustedRendererPath(path, {
      roots,
      issuedPaths: this.trustedPickedPaths,
    })));
    return this.buildAttachmentsFromPaths(trusted);
  }

  async attachmentsFromDroppedPaths(paths: string[]): Promise<Attachment[]> {
    const trusted = await Promise.all(paths.map((path) => canonicalExistingPath(path)));
    for (const path of trusted) rememberCanonicalPath(this.trustedPickedPaths, path);
    return this.buildAttachmentsFromPaths(trusted);
  }

  private async buildAttachmentsFromPaths(paths: readonly string[]): Promise<Attachment[]> {
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

  private async trustedAttachmentRoots(sessionId?: string): Promise<string[]> {
    const settings = await this.settingsStore.get();
    const roots = [settings.activeWorkspace].filter(Boolean);
    if (sessionId) {
      const cwd = this.processes.snapshot(sessionId)?.cwd ?? (await this.profiles.assignment(sessionId))?.cwd;
      if (cwd) roots.push(cwd);
      roots.push(join(this.userDataPath, "session-attachments", sessionCacheKey(sessionId)));
    }
    return roots;
  }

  private async validatePromptAttachments(sessionId: string, attachments: Attachment[]): Promise<Attachment[]> {
    const roots = await this.trustedAttachmentRoots(sessionId);
    return Promise.all(attachments.map(async (attachment) => {
      if (attachment.data) return attachment;
      if (!attachment.path) throw new Error(`${attachment.name || "附件"} 缺少受信任的文件来源`);
      if (attachment.draftText) {
        const path = await this.uiState.resolveTextDraftAttachment(sessionId, attachment.path);
        return { ...attachment, path };
      }
      const path = await resolveTrustedRendererPath(attachment.path, {
        roots,
        issuedPaths: this.trustedPickedPaths,
        kind: attachment.kind === "folder" ? "directory" : "file",
      });
      return { ...attachment, path };
    }));
  }

  private async prepareSubmissionAttachments(sessionId: string, attachments: Attachment[], draftKey?: string) {
    const releaseProtection = draftKey
      ? this.uiState.protectDraftFiles(draftKey, attachments.flatMap((attachment) => attachment.draftText && attachment.path ? [attachment.path] : []))
      : () => undefined;
    try {
      return await this.attachmentCache.prepare(sessionId, await this.validatePromptAttachments(sessionId, attachments));
    } finally {
      releaseProtection();
    }
  }

  private async detachSubmissionDraft(sessionId: string, draftKey?: string, draftSubmissionId?: string): Promise<string[]> {
    if (!draftKey) return [];
    if (draftKey.toLocaleLowerCase() !== sessionId.toLocaleLowerCase()) {
      throw new Error("提交草稿与目标会话不匹配");
    }
    return this.uiState.detachDraftForSubmission(draftKey, draftSubmissionId);
  }

  private async discardSubmissionDraftFiles(draftKey: string | undefined, paths: readonly string[]): Promise<void> {
    if (draftKey && paths.length) await this.uiState.discardDetachedDraftFiles(draftKey, paths);
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    delete patch.lastAutomaticUpdateCheckAt;
    const current = await this.settingsStore.get();
    if (patch.activeWorkspace !== undefined && !samePath(patch.activeWorkspace, current.activeWorkspace)) {
      const canonical = patch.activeWorkspace
        ? await canonicalExistingPath(patch.activeWorkspace, "directory")
        : "";
      if (canonical && !hasCanonicalPath(this.trustedWorkspacePaths, canonical)) {
        throw new Error("活动工作区只能通过应用工作区选择器修改");
      }
      patch.activeWorkspace = canonical;
    }
    if (patch.recentWorkspaces !== undefined
      && JSON.stringify(patch.recentWorkspaces) !== JSON.stringify(current.recentWorkspaces)) {
      const canonical = await Promise.all(patch.recentWorkspaces.map((path) => canonicalExistingPath(path, "directory")));
      if (canonical.some((path) => !hasCanonicalPath(this.trustedWorkspacePaths, path))) {
        throw new Error("最近工作区只能包含应用已选择或发现的项目");
      }
      patch.recentWorkspaces = canonical;
    }
    if (patch.cliPath !== undefined && patch.cliPath !== current.cliPath) {
      patch.cliPath = patch.cliPath === this.appConfig.mockCliPath
        ? patch.cliPath
        : await validateGrokCliExecutable(patch.cliPath);
    }
    if (patch.fontScale !== undefined) patch.fontScale = Math.min(130, Math.max(85, patch.fontScale));
    if (patch.conversationContentWidth !== undefined) patch.conversationContentWidth = Math.min(1040, Math.max(640, Math.round(patch.conversationContentWidth)));
    if (patch.conversationFontScale !== undefined) patch.conversationFontScale = Math.min(135, Math.max(90, Math.round(patch.conversationFontScale)));
    if (patch.defaultEffort !== undefined && !REASONING_EFFORTS.includes(patch.defaultEffort)) throw new Error("不支持的默认推理强度");
    if (patch.uiDensity !== undefined && !isUiDensity(patch.uiDensity)) throw new Error("不支持的界面密度");
    if (patch.theme !== undefined) patch.theme = mergeThemeSettings(current.theme ?? DEFAULT_THEME, patch.theme);
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

  listClaudeSessions(cwd: string, force = false): Promise<ClaudeSessionSummary[]> {
    return this.claude.list(cwd, force);
  }

  openClaudeSession(id: string): Promise<ClaudeSessionDetail> { return this.claude.open(id); }
  refreshClaudeSession(id: string): Promise<ClaudeSessionDetail> { return this.claude.refresh(id); }
  hideClaudeSession(id: string, hidden = true): Promise<void> { return this.claude.hide(id, hidden); }

  async continueClaudeSession(id: string): Promise<{ sessionId: string; cwd: string }> {
    const detail = await this.claude.open(id, true);
    const before = detail.contentHash;
    const result = await this.processes.create(detail.cwd);
    void this.cliCapabilities.recordRuntimeSupport(["acp.initialize", "acp.sessionNew", "claudeReader"]).catch((error) => this.log.log(error));
    this.focusedSessionId = result.sessionId;
    await this.catalog.markRead(result.sessionId);
    await this.catalog.recordOrigins([{ sessionId: result.sessionId, kind: "claude-continuation", id, title: "Claude 接力", suggestedTitle: detail.title }]);
    await this.catalog.rename(result.sessionId, detail.title);
    await this.claude.recordContinuation(id, result.sessionId);
    void (async () => {
      try {
        await this.processes.get(result.sessionId).prompt(`/resume-claude ${JSON.stringify(detail.path)}`, []);
      } catch (error) {
        await this.handleEvent({ type: "error", sessionId: result.sessionId, message: `Claude 接力失败：${error instanceof Error ? error.message : String(error)}` });
      } finally {
        const after = await this.claude.contentHash(id).catch(() => "");
        if (after !== before) {
          await this.log.log(`Claude read-only hash mismatch: ${id}`);
          await this.handleEvent({ type: "error", sessionId: result.sessionId, message: "Claude 原会话哈希发生变化；已记录只读约束诊断" });
        }
      }
    })();
    return { sessionId: result.sessionId, cwd: detail.cwd };
  }

  getQuota(force = false): Promise<GrokQuotaSnapshot> { return this.quota.get(force); }

  private modelCatalog: ModelInfo[] = [];
  private modelCatalogProbe?: Promise<ModelInfo[]>;
  private modelCatalogRefreshFlight?: Promise<ModelInfo[]>;
  private modelCatalogProbedAt = 0;
  private modelCatalogAttemptedAt = 0;
  private modelCatalogError?: string;
  private modelCatalogRevision = 0;
  private invalidateModelCatalog(): void {
    this.modelCatalogRevision=(this.modelCatalogRevision??0)+1;
    this.modelCatalog=[];this.modelCatalogProbedAt=0;this.modelCatalogAttemptedAt=0;this.modelCatalogError=undefined;
    this.modelCatalogProbe=undefined;this.modelCatalogRefreshFlight=undefined;
  }

  async listModelCatalog(refresh=true): Promise<ModelInfo[]> {
    const live = this.processes.listKnownModels();
    if (live.length && !this.modelCatalogProbedAt) {
      const byId = new Map(this.modelCatalog.map((model) => [model.modelId, model]));
      for (const model of live) byId.set(model.modelId, model);
      this.modelCatalog = [...byId.values()];
    }
    const settings = await this.settingsStore.get();
    // Refresh at most once per minute unless a live session already supplied
    // newer data. Concurrent settings/new-task requests share one ACP probe.
    const probeCwd = settings.activeWorkspace && await stat(settings.activeWorkspace).then(info=>info.isDirectory()).catch(()=>false)
      ? settings.activeWorkspace : app.getPath("userData");
    if (refresh && (this.modelCatalogProbe || !this.modelCatalogAttemptedAt || Date.now() - this.modelCatalogAttemptedAt >= 60_000)) {
      if (!this.modelCatalogProbe) {
        const revision=this.modelCatalogRevision;
        this.modelCatalogAttemptedAt = Date.now();
        const probe = this.processes.probeModelCatalog(probeCwd)
          .then(models => {
            if(revision!==this.modelCatalogRevision)return [];
            if (!models.length) throw new Error("CLI 尚未返回可用模型；请检查登录和网络后刷新。");
            // A successful new declaration replaces the old native catalog.
            this.modelCatalog = models;
            this.modelCatalogProbedAt = Date.now();
            this.modelCatalogError = undefined;
            return models;
          })
          .catch(async (error) => {
            if(revision!==this.modelCatalogRevision)return [];
            this.modelCatalogError = error instanceof Error ? error.message : String(error);
            await this.log.log(`读取 ACP 模型目录失败：${error instanceof Error ? error.message : String(error)}`);
            return [];
          })
          .finally(() => { if(this.modelCatalogProbe===probe)this.modelCatalogProbe = undefined; });
        this.modelCatalogProbe=probe;
      }
      await this.modelCatalogProbe;
    }
    const providers = await this.providers.list().catch(() => []);
    const byId = new Map(this.modelCatalog.map((model) => [model.modelId, model]));
    for (const provider of providers) {
      if (provider.enabled === false) continue;
      for (const model of provider.models) {
        if (model.enabled === false) continue;
        const efforts = (model.reasoningEfforts ?? []).filter((value): value is Exclude<ReasoningEffort, ""> => Boolean(value));
        byId.set(model.id, {
          modelId: model.id,
          name: `${provider.name} · ${model.name || model.model}`,
          providerId: provider.id,
          description: model.description,
          totalContextTokens: model.contextWindow,
          supportsReasoningEffort: efforts.length > 0,
          reasoningEfforts: efforts.map((value) => ({ value, label: value })),
        });
      }
    }
    return [...byId.values()];
  }
  listProviders(): Promise<CustomProviderProfile[]> {
    if (process.env.GROK_DESKTOP_OFFLINE_SMOKE === "1") return Promise.resolve([]);
    return this.providers.list();
  }
  async upsertProvider(input: CustomProviderInput): Promise<CustomProviderProfile[]> {
    const values = await this.providers.upsert(input);
    await this.reconcileProviderDesktopDefault(values);
    return values;
  }
  async removeProvider(id: string): Promise<CustomProviderProfile[]> {
    const values = await this.providers.remove(id);
    await this.reconcileProviderDesktopDefault(values);
    return values;
  }
  testProvider(id: string): Promise<ProviderConnectivityResult> { return this.providers.test(id); }
  pullProviderModels(id: string): Promise<Array<{ id: string; name?: string }>> { return this.providers.pullModels(id); }
  probeProviderDraft(input: ProviderConnectionDraft): Promise<ProviderDraftProbeResult> { return this.providers.probeDraft(input); }
  discoverProviderModels(input: ProviderConnectionDraft): Promise<ProviderModelCandidate[]> { return this.providers.discoverDraftModels(input); }
  getProviderCapabilities(id: string): Promise<ProviderCapabilitySnapshot | undefined> { return this.providers.getCapabilities(id); }
  deepScanProvider(id: string, options?: ProviderDeepScanOptions): Promise<ProviderDeepScanResult> { return this.providers.deepScan(id, options); }
  cancelProviderDeepScan(id: string): boolean { return this.providers.cancelDeepScan(id); }
  startProviderScan(scope: ProviderScanScope): Promise<ProviderScanJob> { return this.providers.startScan(scope); }
  getProviderScanJob(jobId: string): ProviderScanJob | undefined { return this.providers.getScanJob(jobId); }
  listProviderScanJobs(providerId?: string): ProviderScanJob[] { return this.providers.listScanJobs(providerId); }
  cancelProviderScan(jobId: string): ProviderScanJob { return this.providers.cancelScan(jobId); }
  getProviderCapabilityApplication(id: string): Promise<CapabilityApplicationDraft> { return this.providers.getCapabilityApplication(id); }
  applyProviderCapabilities(id: string, selection?: CapabilityApplicationSelection): Promise<CustomProviderProfile[]> { return this.providers.applyCapabilities(id, selection); }
  async setProviderDesktopDefault(modelId: string): Promise<AppSettings> {
    const providers = await this.providers.list();
    const available = providers.some((provider) => provider.enabled !== false
      && provider.models.some((model) => model.enabled !== false && model.id === modelId));
    if (!available) throw new Error("只能选择已启用的 Provider 模型作为桌面默认值");
    return this.settingsStore.patch({ defaultModel: modelId });
  }
  setProviderCliDefault(modelId: string): Promise<CustomProviderProfile[]> { return this.providers.setCliDefault(modelId); }
  reloadProviders(): Promise<void> { return this.providers.reload(); }
  async listAutomations(): Promise<AutomationTask[]> {
    if (process.env.GROK_DESKTOP_OFFLINE_SMOKE === "1") return [];
    const [tasks, accounts, providers] = await Promise.all([this.automations.list(), this.vault.list(), this.providers.list()]);
    const accountIds = new Set(accounts.map((value) => value.id));
    const providerModels = new Map(providers
      .filter((value) => value.enabled !== false)
      .map((value) => [value.id, new Set(value.models.filter((model) => model.enabled !== false).map((model) => model.id))]));
    return tasks.map((task) => {
      const accountMissing = Boolean(task.profile.accountId && !accountIds.has(task.profile.accountId));
      const providerMissing = Boolean(task.profile.providerId && (!providerModels.has(task.profile.providerId) || !providerModels.get(task.profile.providerId)!.has(task.profile.modelId)));
      return accountMissing || providerMissing ? { ...task, registrationStatus: "needs-config" as const, registrationError: accountMissing ? "固定账号已不存在，需要重新配置" : "固定提供商或模型已不存在，需要重新配置" } : task;
    });
  }
  async createAutomation(input: AutomationTaskInput): Promise<AutomationTask[]> { return this.automations.create(await this.applyExecutionProfileToAutomation(input)); }
  async createRemoteAutomation(input:AutomationTaskInput,overrides?:Partial<Pick<AutomationTaskInput["profile"],"modelId"|"providerId"|"mode"|"effort">>){
    if(input.destination==="current-session"){
      const session=await this.requireRemoteSession(input.targetSessionId??"");if(!session.canSend)throw Error("请选择可继续的主会话");const snapshot=this.processes.snapshot(session.id),runtime=await this.sessionRuntime.get(session.id),assignment=await this.profiles.assignment(session.id);if(!snapshot&&!runtime)throw Error("原会话执行配置尚未记录，请先连接原会话读取配置");const account=await this.vault.active();
      const modelId=snapshot?.modelId??runtime?.modelId;if(!modelId)throw Error("原会话模型尚未确认，请先连接原会话");const mode=snapshot?.mode??runtime!.mode;
      input={...input,workspace:session.cwd,contextPolicy:"reuse",frozenExecutionProfile:assignment?.profile,profile:{modelId,effort:snapshot?.effort??runtime!.effort,mode,permissionPolicy:mode==="auto"?"auto":mode==="plan"?"read-only":"agent",computerEnabled:input.profile.computerEnabled,providerId:runtime?.providerId,accountId:account?.profile.id}};
    }
    if(input.destination!=="current-session" && input.executionProfileId && overrides){
      const compiled=await this.compileExecutionProfile(input.workspace,input.executionProfileId);
      const profile={...input.profile,...overrides};
      input={...input,profile,frozenExecutionProfile:automationRuntimeProfile(profile,compiled.profile)};
    }
    return this.automations.createOne(await this.applyExecutionProfileToAutomation(input));
  }
  async updateAutomation(id: string, patch: Partial<AutomationTaskInput>,expectedRevision?:number): Promise<AutomationTask[]> {
    if (!("executionProfileId" in patch) && !patch.workspace && !patch.profile) return this.automations.update(id, patch,expectedRevision);
    const current = (await this.automations.list()).find((value) => value.id === id);
    if (!current) throw new Error("持久任务不存在");
    const merged = { ...current, ...patch, profile: { ...current.profile, ...patch.profile }, schedule: patch.schedule ?? current.schedule, prompt: patch.prompt } as AutomationTaskInput;
    const profiled = await this.applyExecutionProfileToAutomation({ ...merged, frozenExecutionProfile: "executionProfileId" in patch && patch.executionProfileId !== current.executionProfileId ? undefined : current.frozenExecutionProfile });
    return this.automations.update(id, { ...patch, executionProfileId: profiled.executionProfileId, profile: profiled.profile, frozenExecutionProfile: profiled.frozenExecutionProfile },expectedRevision);
  }
  deleteAutomation(id: string): Promise<AutomationTask[]> { return this.automations.delete(id); }
  pauseAutomation(id: string, paused: boolean): Promise<AutomationTask[]> { return this.automations.pause(id, paused); }
  runAutomationNow(id: string): Promise<AutomationRunRecord> { return this.automations.runNow(id); }
  retryAutomationRun(id: string): Promise<AutomationRunRecord> { return this.automations.retryRun(id); }
  clearAutomationRuns(taskId?: string): Promise<AutomationRunRecord[]> { return this.automations.clearFinishedRuns(taskId); }
  cancelAutomationRun(id: string): Promise<AutomationRunRecord> { return this.automations.cancelRun(id); }
  listAutomationRuns(taskId?: string): Promise<AutomationRunRecord[]> {
    if (process.env.GROK_DESKTOP_OFFLINE_SMOKE === "1") return Promise.resolve([]);
    return this.automations.listRuns(taskId);
  }
  getAutomationGlobalPolicy(): Promise<AutomationGlobalPolicy> {
    if (process.env.GROK_DESKTOP_OFFLINE_SMOKE === "1") return Promise.resolve({
      defaultProfile: { modelId: "", effort: "", mode: "auto", permissionPolicy: "auto", computerEnabled: false },
      maxConcurrentRuns: 2,
      confirmationTimeoutMinutes: 30,
      inactivityTimeoutMinutes: 0,
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
        if (task) await this.automations.setExecutionSession(taskId, undefined, task.revision);
      },
      repairRegistrations: () => this.automations.repairRegistrations(),
    }, repair);
  }
  clearAutomationContext(id: string): Promise<AutomationTask[]> {
    return this.automations.clearSession(id, async (task) => {
      if (task.destination === "current-session") throw new Error("继续当前会话的任务不能删除用户会话；请删除或重新绑定该任务");
      if (!task.sessionId) return;
      const assignment = await this.profiles.assignment(task.sessionId);
      await this.processes.close(task.sessionId);
      if (await this.catalog.has(assignment?.cwd ?? task.workspace, task.sessionId)) await this.catalog.delete(assignment?.cwd ?? task.workspace, task.sessionId);
      await this.profiles.removeAssignment(task.sessionId);
    });
  }
  unregisterAllAutomations(): Promise<void> { return this.automations.unregisterAll(); }

  async runAutomationWorker(taskId: string, runId?: string): Promise<AutomationRunRecord> {
    const requested = (await this.automations.list()).find(task => task.id === taskId);
    if (requested?.destination === "current-session" && requested.targetSessionId) {
      const forwarded = await this.sessionRelay.forward(requested.targetSessionId, taskId, runId);
      if (forwarded) return forwarded;
    }
    let reservedSession: string | undefined;
    try { return await this.automations.execute(taskId, runId, async ({ task, prompt, runId: activeRunId, confirm, signal, waitUntilReady }) => {
      if (signal.aborted) throw signal.reason ?? new Error("任务已取消");
      if (task.destination === "current-session" && task.targetSessionId && this.processes.snapshot(task.targetSessionId)) {
        let adapter = this.processes.get(task.targetSessionId);
        const activeAccount = await this.vault.active();
        if (task.profile.accountId && task.profile.accountId !== activeAccount?.profile.id) throw new Error("当前会话账号与任务固定账号不同，请切回原账号后执行");
        while (adapter.working || adapter.needsUser) await waitUntilReady();
        signal.throwIfAborted();
        if (!samePath(adapter.cwd, task.workspace)) {
          const source = (await this.catalog.list(adapter.cwd)).find(session => session.id === task.targetSessionId);
          if (!source) throw new Error("原工作区中未找到绑定会话，未改变执行目录");
          await this.rebindSession(source, await canonicalExistingPath(task.workspace, "directory"), (cwd, id) => this.processes.openConfigured(cwd, id, adapter.effort, adapter.mode, adapter.currentModelId ?? "", undefined, undefined, adapter.processOptions, true));
          adapter = this.processes.get(task.targetSessionId);
        }
        const execution = resolveAutomationExecutionPolicy(task.profile);
        if (adapter.mode !== execution.mode || (task.profile.modelId && adapter.currentModelId !== task.profile.modelId) || adapter.effort !== task.profile.effort) throw new Error("绑定会话的执行配置已改变，请重新创建当前会话任务");
        const inactivityMinutes = (await this.automations.getPolicy()).inactivityTimeoutMinutes;
        while (adapter.working || adapter.needsUser) await waitUntilReady();
        signal.throwIfAborted();
        const restoreComputer = this.computer.configureSession(task.targetSessionId, { enabled: task.profile.computerEnabled, confirm: (request, requestSignal) => confirm(request, true, requestSignal), signal });
        const restorePermission = adapter.usePermissionDecider(execution.permission === "allow" ? async () => true : execution.permission === "deny" ? async () => false : request => confirm(request, execution.permission === "confirm-all"));
        const cancel = (): void => adapter.cancel(); signal.addEventListener("abort", cancel, { once: true });
        const stopInactivity = watchAutomationInactivity(inactivityMinutes, () => adapter.lastTouched, () => this.automations.cancelRun(activeRunId));
        try { await waitForAbort(adapter.prompt(task.skillCommand ? `${task.skillCommand} ${prompt}` : prompt), signal); return { sessionId: task.targetSessionId }; }
        finally { stopInactivity(); restorePermission(); signal.removeEventListener("abort", cancel); restoreComputer(); }
      }
      const accountContext = await this.prepareAutomationAccount(task);
      const execution = resolveAutomationExecutionPolicy(task.profile);
      const decision = execution.permission === "allow"
        ? async () => true
        : execution.permission === "deny"
          ? async () => false
          : (toolCall: unknown) => confirm(toolCall, execution.permission === "confirm-all");
      try {
        let sessionId = task.destination === "current-session" ? task.targetSessionId : task.sessionId;
        let assignment = sessionId ? await this.profiles.assignment(sessionId) : undefined;
        const mappedCwd = assignment?.cwd ?? (sessionId ? (await this.sessionRuntime.get(sessionId))?.cwd : undefined) ?? task.workspace;
        const mappedSessionExists = Boolean(sessionId && await this.catalog.has(mappedCwd, sessionId));
        if (task.destination === "current-session" && !mappedSessionExists) throw new Error("绑定的目标会话已不存在，不能静默创建独立任务");
        let sessionAction = resolveAutomationSessionAction(task.destination === "current-session" ? "reuse" : task.contextPolicy, Boolean(sessionId), mappedSessionExists);
        if (sessionId && sessionAction === "replace") {
          await this.processes.close(sessionId);
          await this.automations.setExecutionSession(task.id, undefined, task.revision);
          sessionId = undefined;
          assignment = undefined;
        }
        const agents = await this.definitions.listAgents(task.workspace);
        const frozen = task.frozenExecutionProfile ?? assignment?.profile ?? (await this.profiles.resolve(task.workspace, task.executionProfileId));
        const compiled = await this.profiles.compileProfile(automationRuntimeProfile(task.profile, frozen), agents);
        if (task.destination !== "current-session" && sessionAction === "reuse" && assignment && JSON.stringify(assignment.profile) !== JSON.stringify(compiled.profile)) {
          sessionAction = "replace";
          sessionId = undefined;
          assignment = undefined;
        }
        let targetCwd = assignment?.cwd ?? task.workspace;
        const sourceCwd = assignment?.cwd ?? (sessionId ? (await this.sessionRuntime.get(sessionId))?.cwd : undefined) ?? task.workspace;
        const relocate = Boolean(sessionId && (task.destination === "current-session" ? !samePath(sourceCwd, task.workspace) : assignment && !samePath(assignment.sourceWorkspacePath, task.workspace)));
        if (relocate) targetCwd = await canonicalExistingPath(task.workspace, "directory");
        let worktree: GrokWorktreeSummary | undefined;
        if (sessionAction !== "reuse" && compiled.profile.worktree) {
          worktree = await this.worktrees.create({ workspacePath: task.workspace, name: `${profileSlug(task.name)}-${new Date().toISOString().slice(0, 10)}`, baseRef: compiled.profile.worktreeRef, agentId: compiled.profile.agentId });
          targetCwd = worktree.path;
        }
        const environment = { ...compiled.environment, ...accountContext.environment };
        const desktopSettings = await this.settingsStore.get();
        const modelId = compiled.modelId || task.profile.modelId || desktopSettings.defaultModel;
        const providerId = await this.resolveManagedProviderSelection(modelId);
        const previousRuntime = sessionId ? await this.sessionRuntime.get(sessionId) : undefined;
        if (sessionAction === "reuse" && previousRuntime) await this.sessionRuntime.patch(sessionId!, { modelId, providerId });
        let result: { sessionId: string };
        try {
          if (relocate && sessionId) {
            const source = (await this.catalog.list(sourceCwd)).find(session => session.id === sessionId);
            if (!source) throw new Error("原工作区中未找到任务会话，未改变执行目录");
            await this.rebindSession(source, targetCwd, (cwd, id) => this.processes.openConfigured(cwd, id, compiled.effort || task.profile.effort, compiled.mode, modelId, decision, environment, { agentProfilePath: compiled.agentProfilePath, sessionMeta: compiled.sessionMeta, computerEnabled: task.profile.computerEnabled, alwaysApprove: compiled.mode === "auto" }));
            assignment = await this.profiles.assignment(sessionId);
          }
          result = sessionAction === "reuse"
            ? await this.processes.openConfigured(targetCwd, sessionId!, compiled.effort || task.profile.effort, compiled.mode, modelId, decision, environment, { agentProfilePath: compiled.agentProfilePath, sessionMeta: compiled.sessionMeta, computerEnabled: task.profile.computerEnabled, alwaysApprove: compiled.mode === "auto" })
            : await this.processes.createConfigured(targetCwd, compiled.effort || task.profile.effort, compiled.mode, modelId, decision, environment, { agentProfilePath: compiled.agentProfilePath, sessionMeta: compiled.sessionMeta, computerEnabled: task.profile.computerEnabled, alwaysApprove: compiled.mode === "auto" });
        } catch (error) {
          if (previousRuntime) await this.sessionRuntime.save(previousRuntime);
          throw error;
        }
        await this.persistSessionProviderIdentity(result.sessionId, targetCwd, modelId, providerId, compiled.profile.id);
        if (sessionAction !== "reuse") {
          assignment = { sessionId: result.sessionId, sourceWorkspacePath: task.workspace, cwd: targetCwd, profileId: compiled.profile.id, profileName: compiled.profile.name, profile: compiled.profile, worktreeId: worktree?.id, createdAt: new Date().toISOString() };
          await this.profiles.assign(assignment);
        }
        await this.catalog.recordOrigins([{ sessionId: result.sessionId, kind: "automation", id: task.id, title: task.name, suggestedTitle: task.name }]);
        if (sessionAction !== "reuse") await this.catalog.rename(result.sessionId, task.name);
        await this.automations.setExecutionSession(task.id, result.sessionId, task.revision);
        await this.automations.setRunSession(activeRunId, result.sessionId);
        this.computer.configureSession(result.sessionId, { enabled: task.profile.computerEnabled, confirm: (request, requestSignal) => confirm(request, true, requestSignal), signal });
        const text = task.skillCommand ? `${task.skillCommand} ${prompt}` : prompt;
        const adapter = this.processes.get(result.sessionId);
        const runController = new AbortController();
        const forwardCancellation = (): void => {
          if (!runController.signal.aborted) runController.abort(signal.reason ?? new Error("任务已取消"));
        };
        signal.addEventListener("abort", forwardCancellation, { once: true });
        const stopAdapter = (): void => adapter.cancel();
        runController.signal.addEventListener("abort", stopAdapter, { once: true });
        const automationPolicy = await this.automations.getPolicy();
        const stopInactivity = watchAutomationInactivity(automationPolicy.inactivityTimeoutMinutes, () => adapter.lastTouched, () => this.automations.cancelRun(activeRunId));
        try {
          // Persisted tasks have no Desktop wall-clock ceiling. Completion,
          // explicit user stop, process exit and the automation lease are the
          // only authorities allowed to settle the run.
          await waitForAbort(adapter.prompt(text), runController.signal);
          return { sessionId: result.sessionId };
        } finally {
          stopInactivity();
          signal.removeEventListener("abort", forwardCancellation);
          runController.signal.removeEventListener("abort", stopAdapter);
          await this.processes.close(result.sessionId).catch(async (error) => {
            await this.log.log(`自动化会话清理失败：${error instanceof Error ? error.message : String(error)}`).catch(() => undefined);
          });
        }
      } finally {
        await accountContext.cleanup().catch(async (error) => {
          await this.log.log(`自动化账号上下文清理失败：${error instanceof Error ? error.message : String(error)}`).catch(() => undefined);
        });
      }
    }, task => {
      if (task.destination !== "current-session" || !task.targetSessionId) return true;
      if (this.automationSessionReservations.has(task.targetSessionId) && reservedSession !== task.targetSessionId) return false;
      if (this.processes.snapshot(task.targetSessionId)) {
        const adapter = this.processes.get(task.targetSessionId);
        if (adapter.working || adapter.needsUser) return false;
      }
      reservedSession = task.targetSessionId;
      this.automationSessionReservations.add(reservedSession);
      return true;
    });
    } finally { if (reservedSession) this.automationSessionReservations.delete(reservedSession); }
  }
  async enqueuePrompt(sessionId: string, text: string, attachments: Attachment[], clientMessageId?: string, draftKey?: string, draftSubmissionId?: string, toolSelection?: import("../shared/types").McpToolSelection) {
    if (this.deletingSessions.has(sessionId)) throw new Error("此会话正在删除，暂时不能添加排队消息");
    clientMessageId ??= crypto.randomUUID();
    const prepared = await this.prepareSubmissionAttachments(sessionId, attachments, draftKey).catch(async (error) => { await this.uiState.settleSubmission(draftSubmissionId, false).catch(() => undefined); throw error; });
    await this.attachmentCache.record(sessionId, clientMessageId, text, prepared.previews, "queued");
    let detachedDraftFiles: string[] = [];
    try {
      detachedDraftFiles = await this.detachSubmissionDraft(sessionId, draftKey, draftSubmissionId);
      const receipt = await this.processes.get(sessionId).queuePrompt(text, prepared.attachments, false, { clientMessageId, attachments: prepared.previews, toolSelection });
      await this.uiState.settleSubmission(draftSubmissionId, true).catch((error) => this.log.log(`提交已接收，恢复快照结算失败：${String(error)}`).catch(() => undefined));
      await this.discardSubmissionDraftFiles(draftKey, detachedDraftFiles).catch(() => undefined);
      return receipt;
    } catch (error) {
      await this.uiState.settleSubmission(draftSubmissionId, false).catch(() => undefined);
      // The queue row was never created, so its attachment ledger must not
      // resurrect an unsent user bubble when the conversation is reopened.
      await this.attachmentCache.removeRecord(sessionId, clientMessageId).catch((cleanupError) => this.log.log(`排队失败后的附件账本清理失败：${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`).catch(() => undefined));
      throw error;
    }
  }
  async interjectPrompt(sessionId: string, text: string, attachments: Attachment[], clientMessageId?: string, draftKey?: string, draftSubmissionId?: string, toolSelection?: import("../shared/types").McpToolSelection) {
    this.assertCredentialStable();
    clientMessageId ??= crypto.randomUUID();
    const prepared = await this.prepareSubmissionAttachments(sessionId, attachments, draftKey).catch(async (error) => { await this.uiState.settleSubmission(draftSubmissionId, false).catch(() => undefined); throw error; });
    let detachedDraftFiles: string[] = [];
    try {
      detachedDraftFiles = await this.detachSubmissionDraft(sessionId, draftKey, draftSubmissionId);
      this.assertCredentialStable();
      const receipt = await this.processes.get(sessionId).interjectPrompt(text, prepared.attachments, { clientMessageId, attachments: prepared.previews, toolSelection });
      if (receipt.state === "send-now") {
        // Older CLIs fall back to stop-then-send. Use the same bounded Stop
        // recovery as the visible stop button; adapter.cancel() alone could
        // leave the local row waiting forever if the CLI never acknowledges
        // cancellation. Do not delay the operation receipt while the 8-second
        // recovery boundary runs in the background.
        void this.processes.cancelSession(sessionId).catch((cancelError) => this.log.log(`插话降级后的会话停止恢复失败：${cancelError instanceof Error ? cancelError.message : String(cancelError)}`));
      }
      await this.attachmentCache.record(
        sessionId,
        clientMessageId,
        text,
        prepared.previews,
        receipt.state === "send-now" || receipt.state === "queued" ? "queued" : "sent",
        receipt.state === "interjected" ? "interjection" : "user-message",
        receipt.entryId,
      ).catch((error) => this.log.log(`插话已接收，附件账本更新失败：${String(error)}`).catch(() => undefined));
      await this.uiState.settleSubmission(draftSubmissionId, true).catch((error) => this.log.log(`提交已接收，恢复快照结算失败：${String(error)}`).catch(() => undefined));
      await this.discardSubmissionDraftFiles(draftKey, detachedDraftFiles).catch(() => undefined);
      return receipt;
    } catch (error) {
      await this.uiState.settleSubmission(draftSubmissionId, false).catch(() => undefined);
      await this.attachmentCache.record(sessionId, clientMessageId, text, prepared.previews, "failed").catch(() => undefined);
      throw error;
    }
  }
  async editQueuedPrompt(sessionId: string, id: string, text: string) {
    const adapter = this.processes.get(sessionId);
    const entry = adapter.queuedPrompts().find((value) => value.id === id);
    const receipt = await adapter.editQueuedPrompt(id, text);
    if (entry?.clientMessageId) await this.attachmentCache.updateRecord(sessionId, entry.clientMessageId, { text: text.trim() })
      .catch((error) => this.log.log(`队列附件账本更新失败（队列编辑已生效）：${error instanceof Error ? error.message : String(error)}`));
    return receipt;
  }
  async removeQueuedPrompt(sessionId: string, id: string) {
    const adapter = this.processes.get(sessionId);
    const entry = adapter.queuedPrompts().find((value) => value.id === id);
    const receipt = await adapter.removeQueuedPrompt(id);
    if (entry?.clientMessageId) await this.attachmentCache.removeRecord(sessionId, entry.clientMessageId)
      .catch((error) => this.log.log(`队列附件账本清理失败（队列撤回已生效）：${error instanceof Error ? error.message : String(error)}`));
    return receipt;
  }
  reorderQueuedPrompt(sessionId: string, id: string, position: number) { return this.processes.get(sessionId).reorderQueuedPrompt(id, position); }
  async clearPromptQueue(sessionId: string) {
    if (this.offlineUiSessionResponder?.owns(sessionId)) return this.offlineUiSessionResponder.clearPromptQueue(sessionId);
    const adapter = this.processes.get(sessionId);
    const entries = adapter.queuedPrompts().filter((entry) => entry.state === "queued");
    const receipt = await adapter.clearPromptQueue();
    await Promise.all(entries.flatMap((entry) => entry.clientMessageId
      ? [this.attachmentCache.removeRecord(sessionId, entry.clientMessageId).catch((error) => this.log.log(`队列附件账本清理失败（批量撤回已生效）：${error instanceof Error ? error.message : String(error)}`))]
      : []));
    return receipt;
  }
  async interjectQueuedPrompt(sessionId: string, id: string, text?: string) {
    const adapter = this.processes.get(sessionId);
    const entry = adapter.queuedPrompts().find((value) => value.id === id);
    const nextText = text?.trim() || entry?.text;
    const receipt = await adapter.interjectQueuedPrompt(id, text);
    if (entry?.clientMessageId && nextText) {
      await this.attachmentCache.updateRecord(sessionId, entry.clientMessageId, receipt.state === "interjected"
        ? { text: nextText, delivery: "sent", presentation: "interjection", eventId: id }
        : { text: nextText })
        .catch((error) => this.log.log(`插话附件账本更新失败（插话结果已生效）：${error instanceof Error ? error.message : String(error)}`));
    }
    return receipt;
  }
  async forkSession(sessionId: string, rewindPointId?: string, launch?: ExecutionProfileLaunchInput): Promise<SessionForkResult> {
    const snapshot = this.processes.snapshot(sessionId); if (!snapshot) throw new Error("会话当前未加载");
    const parentRuntime = await this.sessionRuntime.get(sessionId);
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
    const inheritedModelId = parentRuntime?.modelId ?? snapshot.modelId;
    const inheritedProviderId = parentRuntime?.providerId
      ?? (await this.providers.managedProviderForModel(inheritedModelId))?.id;
    const forkRuntime = buildForkRuntimePreferences(parentRuntime, {
      sessionId: childId,
      cwd,
      modelId: inheritedModelId,
      providerId: inheritedProviderId,
      effort: snapshot.effort,
      mode: snapshot.mode,
      profileId: launch ? compiled.profile.id : parentAssignment?.profileId ?? compiled.profile.id,
    });
    await this.sessionRuntime.save({
      ...forkRuntime,
      // Choosing an explicit fork profile is the one intentional override;
      // ordinary forks inherit the parent's complete runtime profile.
      ...(launch ? { profileId: compiled.profile.id } : {}),
    });
    if (inheritedWorktreeId) await this.catalog.recordOrigins([{ sessionId: childId, kind: "worktree", id: inheritedWorktreeId, title: compiled.profile.name, suggestedTitle: worktree?.name || "Worktree 分叉" }]);
    return { sessionId: childId, parentSessionId: sessionId, cwd, profileId: compiled.profile.id, worktreeId: inheritedWorktreeId };
  }

  async rebindWorkspaceSessions(sourceCwd: string, targetCwd: string): Promise<WorkspaceRebindReceipt> {
    const canonicalTarget = await canonicalExistingPath(targetCwd, "directory");
    if (!hasCanonicalPath(this.trustedWorkspacePaths, canonicalTarget)) {
      throw new Error("新项目位置必须通过应用文件夹选择器选择");
    }
    if (samePath(sourceCwd, canonicalTarget)) throw new Error("新旧项目位置相同");
    const sessions = await this.catalog.list(sourceCwd, "", this.processes.liveStatuses());
    if (!sessions.length) throw new Error("旧项目没有可重新绑定的 Grok 会话");
    const receipt: WorkspaceRebindReceipt = { sourceCwd, targetCwd: canonicalTarget, completed: [], failures: [] };
    for (const session of sessions) {
      try {
        receipt.completed.push(await this.rebindSession(session, canonicalTarget));
      } catch (error) {
        receipt.failures.push({ sessionId: session.id, message: error instanceof Error ? error.message : String(error) });
      }
    }
    if (!receipt.completed.length) throw new Error(`项目重新绑定失败：${receipt.failures.map((item) => `${item.sessionId}: ${item.message}`).join("；")}`);
    await this.settingsStore.patch({
      activeWorkspace: canonicalTarget,
      recentWorkspaces: [canonicalTarget, ...(await this.settingsStore.get()).recentWorkspaces.filter((value) => !samePath(value, canonicalTarget))].slice(0, 12),
    });
    return receipt;
  }

  private async rebindSession(source: SessionSummary, targetCwd: string, openTarget: (cwd: string, sessionId: string) => Promise<{ sessionId: string }> = (cwd, id) => this.processes.open(cwd, id)): Promise<SessionRebindReceipt> {
    const parentRuntime = await this.sessionRuntime.get(source.id);
    const parentAssignment = await this.profiles.assignment(source.id);
    const originalLive = this.processes.snapshot(source.id);
    const liveStatus = this.processes.liveStatuses().get(source.id);
    if (liveStatus === "working" || liveStatus === "needs-user") {
      throw new Error("会话正在运行或等待操作，完成或停止后再重新绑定项目路径");
    }
    const transactionId = randomUUID();
    let targetMaterialized = false;
    let committed = false;
    await this.appendRebindJournal({ transactionId, status: "started", sessionId: source.id, sourceCwd: source.cwd, targetCwd, at: new Date().toISOString() });
    try {
      if (originalLive) await this.processes.close(source.id, false);
      await this.catalog.materializeAtWorkspace(source.cwd, targetCwd, source.id);
      targetMaterialized = true;
      try {
        await openTarget(targetCwd, source.id);
      } catch (error) {
        await this.processes.close(source.id, false).catch(() => undefined);
        await this.catalog.removeWorkspaceCopy(targetCwd, source.id).catch(() => undefined);
        if (parentRuntime) await this.sessionRuntime.save(parentRuntime).catch(() => undefined);
        else await this.sessionRuntime.deletePreferences(source.id).catch(() => undefined);
        if (originalLive) await this.processes.open(source.cwd, source.id).catch(() => undefined);
        throw new Error(`复制后的会话无法由当前 CLI 重新打开：${error instanceof Error ? error.message : String(error)}`);
      }
      const settings = await this.settingsStore.get();
      const targetRuntime = buildForkRuntimePreferences(parentRuntime, {
        sessionId: source.id, cwd: targetCwd,
        modelId: parentRuntime?.modelId ?? settings.defaultModel,
        providerId: parentRuntime?.providerId,
        effort: parentRuntime?.effort ?? settings.defaultEffort,
        mode: parentRuntime?.mode ?? settings.defaultMode,
        profileId: parentRuntime?.profileId,
        compaction: parentRuntime?.compaction,
      });
      const restoreRuntime = async (): Promise<void> => {
        if (parentRuntime) await this.sessionRuntime.save(parentRuntime);
        else await this.sessionRuntime.deletePreferences(source.id);
      };
      try {
        await runSessionRebindTransaction([
          ...(parentAssignment ? [{
            name: "执行档案绑定",
            apply: () => this.profiles.assign({ ...structuredClone(parentAssignment), sourceWorkspacePath: targetCwd, cwd: targetCwd, worktreeId: undefined, createdAt: new Date().toISOString() }),
            rollback: () => this.profiles.assign(parentAssignment),
          }] : []),
          {
            name: "会话运行配置",
            apply: () => this.sessionRuntime.save(targetRuntime).then(() => undefined),
            // Runtime was already changed by ProcessManager.open; the initial
            // rollback below owns restoration and avoids duplicate writes.
            rollback: () => undefined,
          },
          { name: "会话投影根目录", apply: () => this.conversationProjections.rebindRuntime(source.id, targetCwd), rollback: () => this.conversationProjections.rebindRuntime(source.id, source.cwd) },
          { name: "Token 工作区归属", apply: () => this.tokenActivity.rebindSession(source.id, source.id, targetCwd), rollback: () => this.tokenActivity.rebindSession(source.id, source.id, source.cwd) },
        ], [{ name: "ACP 打开写入的运行配置", rollback: restoreRuntime }]);
      } catch (error) {
        await this.processes.close(source.id, false).catch(() => undefined);
        const rollbackIncomplete = error instanceof SessionRebindTransactionError && error.rollbackErrors.length > 0;
        if (!rollbackIncomplete) {
          await this.catalog.removeWorkspaceCopy(targetCwd, source.id).catch(() => undefined);
          if (originalLive) await this.processes.open(source.cwd, source.id).catch((restoreError) => {
            throw new Error(`元数据已回滚，但原会话重新加载失败：${restoreError instanceof Error ? restoreError.message : String(restoreError)}`, { cause: error });
          });
        }
        throw error;
      }
      committed = true;
      const receipt: SessionRebindReceipt = {
        sessionId: source.id, parentSessionId: source.id, cwd: targetCwd,
        profileId: parentRuntime?.profileId ?? parentAssignment?.profileId,
        sourceCwd: source.cwd, targetCwd, method: "desktop-copy", codeRestored: false,
        localProjectionCopied: true, attachmentLedgerCopied: true, mediaCacheCopied: true,
        completedAt: new Date().toISOString(),
      };
      await this.appendRebindJournal({ transactionId, status: "completed", method: receipt.method, sessionId: source.id, targetSessionId: source.id, sourceCwd: source.cwd, targetCwd, at: receipt.completedAt });
      await this.catalog.removeWorkspaceCopy(source.cwd, source.id).catch((error) => this.log.log(`旧路径会话副本清理失败（新路径副本已验证）：${error instanceof Error ? error.message : String(error)}`));
      return receipt;
    } catch (error) {
      if (targetMaterialized && !committed && this.processes.snapshot(source.id)?.cwd === targetCwd) {
        await this.processes.close(source.id, false).catch(() => undefined);
      }
      const message = error instanceof Error ? error.message : String(error);
      await this.appendRebindJournal({ transactionId, status: "failed", sessionId: source.id, sourceCwd: source.cwd, targetCwd, message, at: new Date().toISOString() }).catch(() => undefined);
      throw error;
    }
  }

  private async appendRebindJournal(entry: Record<string, unknown>): Promise<void> {
    const path = join(this.userDataPath, "session-rebind-history.jsonl");
    await appendFile(path, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  }
  listRewindPoints(sessionId: string): Promise<RewindPoint[]> { return this.processes.get(sessionId).rewindPoints(); }
  async rewindSession(sessionId: string, pointId: string): Promise<void> {
    const snapshot = this.processes.snapshot(sessionId); if (!snapshot) throw new Error("会话当前未加载");
    await this.processes.get(sessionId).rewind(pointId);
    await this.processes.close(sessionId, false);
    await this.handleEvent({ type: "session-reset", sessionId });
    await this.processes.open(snapshot.cwd, sessionId);
  }
  archiveSession(sessionId: string, archived: boolean): Promise<void> { return this.catalog.archive(sessionId, archived); }
  async listBackgroundTasks(): Promise<BackgroundTaskSummary[]> {
    if (process.env.GROK_DESKTOP_OFFLINE_SMOKE === "1") return [];
    const output: BackgroundTaskSummary[] = [];
    for (const { sessionId, entries } of this.processes.promptQueues()) for (const entry of entries) output.push({ id: `queue:${sessionId}:${entry.id}`, sessionId, kind: "queue", title: entry.text || "等待消息", status: entry.state === "queued" ? "queued" : "running", updatedAt: entry.createdAt, detail: `队列第 ${entry.position + 1} 项` });
    for (const { sessionId, result, subagents } of await this.processes.backgroundTaskResults()) {
      const values = Array.isArray(result.tasks) ? result.tasks : Array.isArray(result.items) ? result.items : [];
      for (const [ordinal, value] of values.entries()) { const row = value && typeof value === "object" ? value as Record<string, unknown> : {}; const completed = row.completed === true; const exitCode = typeof row.exit_code === "number" ? row.exit_code : typeof row.exitCode === "number" ? row.exitCode : undefined; const status = completed ? exitCode && exitCode !== 0 ? "failed" : "completed" : normalizeBackgroundStatus(row.status); const rawKind = String(row.kind ?? row.task_type ?? "command").toLowerCase(); output.push({ id: `${sessionId}:${stableRuntimeTaskIdentifier(row, ordinal)}`, sessionId, kind: rawKind.includes("subagent") ? "subagent" : rawKind.includes("loop") || rawKind.includes("schedule") ? "loop" : rawKind.includes("monitor") ? "monitor" : "command", title: String(row.title ?? row.name ?? row.display_command ?? row.command ?? "后台任务"), status, updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : typeof row.updated_at === "string" ? row.updated_at : new Date().toISOString(), detail: typeof row.detail === "string" ? row.detail : completed ? `退出代码 ${exitCode ?? "未知"}` : undefined }); }
      const running = Array.isArray(subagents?.subagents) ? subagents.subagents : [];
      for (const [ordinal, value] of running.entries()) {
        const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
        output.push({ id: `${sessionId}:subagent:${stableRuntimeTaskIdentifier(row, ordinal)}`, sessionId, kind: "subagent", title: String(row.description ?? row.subagentType ?? row.subagent_type ?? "子 Agent"), status: "running", updatedAt: new Date().toISOString(), detail: `${Number(row.turnCount ?? row.turn_count ?? 0)} 回合 · ${Number(row.toolCallCount ?? row.tool_call_count ?? 0)} 次工具` });
      }
    }
    for (const task of await this.automations.list()) output.push({ id: `automation:${task.id}`, kind: "automation", title: task.name, status: task.enabled ? "queued" : "cancelled", updatedAt: task.updatedAt, detail: task.registrationStatus });
    return output;
  }
  async killBackgroundTask(id: string): Promise<void> { if (/(?:^|:)unidentified-/.test(id)) throw new Error("CLI 未提供可取消的原生任务 ID"); const separator = id.indexOf(":"); if (separator < 1) throw new Error("后台任务标识无效"); await this.processes.killBackgroundTask(id.slice(0, separator), id.slice(separator + 1)); }
  async listInbox(): Promise<NotificationInboxItem[]> {
    if (process.env.GROK_DESKTOP_OFFLINE_SMOKE === "1") return [];
    const stored = await this.inbox.list(); const pending = await this.automations.pending();
    if (!pending.length) return stored.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const [tasks, runs] = await Promise.all([this.automations.list(), this.automations.listRuns()]);
    return [...pending.map((value): NotificationInboxItem => ({ id: `pending:${value.id}`, kind: "confirmation", title: value.source === "computer" ? "定时任务：Computer 操作等待确认" : "定时任务：工具权限等待确认", detail: value.summary, taskId: value.taskId, automationRunId: value.runId, sessionId: runs.find(run => run.id === value.runId)?.sessionId ?? tasks.find(task => task.id === value.taskId)?.targetSessionId ?? tasks.find(task => task.id === value.taskId)?.sessionId, read: false, createdAt: new Date(new Date(value.expiresAt).getTime() - 30 * 60_000).toISOString() })), ...stored].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  markInboxRead(id: string, read: boolean): Promise<NotificationInboxItem[]> { return this.inbox.markRead(id, read); }
  clearInbox(): Promise<NotificationInboxItem[]> { return this.inbox.clear(); }
  async getDraft(key: string): Promise<ComposerDraftState | null> {
    const draft = await this.uiState.getDraft(key);
    // A restored composer draft was originally selected by the user through
    // the main-process picker. Re-establish only those exact canonical files
    // so its preview remains usable after an application restart.
    for (const attachment of draft?.attachments ?? []) {
      if (!attachment.path) continue;
      const path = await realpath(attachment.path).catch(() => undefined);
      if (path) rememberCanonicalPath(this.trustedPickedPaths, path);
    }
    return draft;
  }
  listDrafts(): Promise<ComposerDraftState[]> { return this.uiState.listDrafts(); }
  async setDraft(key: string, text: string, capability?: ComposerCapabilitySelection, attachments: Attachment[] = [], newTask?: NewTaskDraft, submissionId?: string): Promise<void> {
    const safeAttachments: Attachment[] = [];
    for (const attachment of attachments) {
      if (!attachment.path) continue;
      if (attachment.draftText) { safeAttachments.push(attachment); continue; }
      const path = await resolveTrustedRendererPath(attachment.path, {
        roots: [...this.trustedWorkspacePaths],
        issuedPaths: this.trustedPickedPaths,
        kind: attachment.kind === "folder" ? "directory" : "file",
      });
      safeAttachments.push({ ...attachment, path });
    }
    return this.uiState.setDraft(key, text, capability, safeAttachments, newTask, submissionId);
  }
  moveDraft(sourceKey: string, targetKey: string): Promise<ComposerDraftState | null> { return this.uiState.moveDraft(sourceKey, targetKey); }
  clearDraft(key: string): Promise<void> { return this.uiState.clearDraft(key); }
  async createTextDraftAttachment(key: string, text: string): Promise<Attachment> {
    const attachment = await this.uiState.createTextDraftAttachment(key, text);
    if (attachment.path) {
      const path = await canonicalExistingPath(attachment.path, "file");
      rememberCanonicalPath(this.trustedPickedPaths, path);
      attachment.path = path;
    }
    return attachment;
  }
  readTextDraftAttachment(path: string): Promise<string> { return this.uiState.readTextDraftAttachment(path); }
  deleteTextDraftAttachment(path: string): Promise<void> { return this.uiState.deleteTextDraftAttachment(path); }
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
  async getComputerCapability(sessionId?: string): Promise<ComputerCapability> {
    const capability = await this.computer.capability(sessionId);
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
  /**
   * Stopping the Computer Use task is not enough on its own: the Grok turn that
   * is issuing the tool calls keeps running. Cancel it too, or the agent simply
   * continues with its next step.
   */
  emergencyStopComputer(source = "Ctrl+Alt+Esc"): void {
    void Promise.all([this.automations.list(), this.automations.listRuns()]).then(async ([tasks, runs]) => {
      const computerTasks = new Set(tasks.filter(task => task.profile.computerEnabled).map(task => task.id));
      await Promise.all(runs.filter(run => computerTasks.has(run.taskId) && ["running", "awaiting-confirmation", "queued"].includes(run.status)).map(run => this.automations.cancelRun(run.id)));
    }).catch(error => this.log.log(error));
    for (const sessionId of this.computer.emergencyStop(source)) {
      void this.processes.cancelSession(sessionId).catch((error) => void this.log.log(`紧急停止后取消会话失败：${error instanceof Error ? error.message : String(error)}`));
    }
  }

  async logEmergencyShortcutUnavailable(): Promise<void> {
    await this.log.log("全局快捷键 Ctrl+Alt+Esc 注册失败，可能已被其他程序占用；Computer Use 浮层将提示回到主窗口停止。");
  }

  async exportLogs(): Promise<string | null> {
    const target = await dialog.showSaveDialog(this.window!, { title: "导出脱敏日志", defaultPath: "grok-build-desktop.log" });
    if (target.canceled || !target.filePath) return null;
    const content = await this.log.read();
    await writeFile(target.filePath, redactSecrets(content), "utf8");
    return target.filePath;
  }

  hasWorking(): boolean { return this.processes.hasWorking() || this.updater.isActive() || this.mediaJobControls.size > 0; }
  hasCliUpdateInProgress(): boolean { return this.updater.isActive(); }
  getSettings(): Promise<AppSettings> { return this.settingsStore.get(); }
  listAccounts() { return this.vault.list(); }
  async loginDevice() { return this.withMediaCredentialChange(() => this.auth.loginDevice()); }
  async loginApiKey(label: string, key: string) { return this.withMediaCredentialChange(() => this.auth.addApiKey(label, key)); }
  async logout() { return this.withMediaCredentialChange(() => this.auth.logout()); }
  async switchAccount(id: string) { return this.withMediaCredentialChange(()=>this.auth.switchAccount(id)); }
  async removeAccount(id: string) {
    const active = await this.vault.active();
    return active?.profile.id === id ? this.withMediaCredentialChange(() => this.auth.removeAccount(id)) : this.auth.removeAccount(id);
  }

  private async withMediaCredentialChange<T>(operation: () => Promise<T>): Promise<T> {
    if (this.updater.isActive()) throw new Error("CLI 正在更新，请等待更新完成后再变更账号");
    if (this.mediaCredentialChanges) throw new Error("另一项账号操作正在进行，请稍后再试");
    if (this.processes.hasWorking() || [...this.mediaJobControls.keys()].some(id => this.mediaJobs.get(id)?.route === "cli")) {
      throw new Error("当前账号仍有编程或生图任务运行／等待确认。请先完成或停止任务，再切换、登录或退出账号。");
    }
    this.mediaCredentialChanges++;
    try {
      if(this.automations && this.vault){
        const [runs,tasks,account]=await Promise.all([this.automations.listRuns(),this.automations.list(),this.vault.active()]);
        const active=runs.some(run=>["queued","running","awaiting-confirmation"].includes(run.status)&&tasks.some(task=>task.id===run.taskId&&!task.profile.providerId&&(!task.profile.accountId||task.profile.accountId===account?.profile.id)));
        if(active)throw Error("当前账号还有定时任务运行或等待确认。请先完成或停止任务，再变更账号。");
      }
      const result = await operation(); this.quota.clear(); this.invalidateModelCatalog(); return result;
    } finally { this.mediaCredentialChanges--; }
  }

  private assertCredentialStable(): void {
    if (this.mediaCredentialChanges) throw new Error("账号正在变更，完成后再发送消息或打开会话；草稿已保留");
  }

  private async stopMediaJobs(message: string, cliOnly = false): Promise<void> {
    const flights: Promise<void>[] = [];
    for (const [jobId, control] of this.mediaJobControls) {
      if (cliOnly && this.mediaJobs.get(jobId)?.route !== "cli") continue;
      control.cancellationMessage = message;
      control.abort.abort(new Error(message));
      control.child?.kill();
      const flight = this.mediaJobFlights.get(jobId);
      if (flight) flights.push(flight);
    }
    // A job may be persisting its terminal state after releasing its process.
    for (const [jobId, flight] of this.mediaJobFlights) if ((!cliOnly || this.mediaJobs.get(jobId)?.route === "cli") && !flights.includes(flight)) flights.push(flight);
    await Promise.allSettled(flights);
  }
  checkCliUpdate() { return this.updater.check(); }
  async checkUpdatesAutomatically(): Promise<import("../shared/types").AutomaticUpdateCheckResult> {
    if (process.env.GROK_DESKTOP_OFFLINE_SMOKE === "1") return { checked: false, reason: "disabled" };
    this.automaticUpdateChecker ??= new AutomaticUpdateChecker({
      settings: () => this.settingsStore.get(), cli: () => this.updater.check(),
      app: () => this.appRelease.check(false), currentVersion: app.getVersion(),
      record: at => this.settingsStore.patch({ lastAutomaticUpdateCheckAt: at }),
    });
    return this.automaticUpdateChecker.check();
  }
  previewCliUpdate(policy?: CliUpdatePolicy, action?: CliUpdateAction) { return this.updater.preview(policy, action); }
  getCliUpdateState() { return this.updater.state(); }
  applyCliUpdate(input: CliUpdateInput) { return this.updater.apply(input); }
  getCliCompatibilitySnapshot() { return this.updater.compatibility(); }
  getCliUpdateHistory() { return this.updater.history(); }
  async openPath(path: string): Promise<void> {
    const result = await this.openTarget({ target: path, sessionId: this.focusedSessionId || undefined });
    if (!result.ok) throw new Error(result.message);
  }
  async openTarget(intent: OpenTargetIntent): Promise<OpenTargetResult> {
    const action = intent.action ?? "open";
    const effectiveSessionId = intent.sessionId ?? (this.focusedSessionId || undefined);
    const roots: string[] = [];
    const sessionRoot = effectiveSessionId
      ? this.processes.snapshot(effectiveSessionId)?.cwd ?? (await this.profiles.assignment(effectiveSessionId))?.cwd
      : undefined;
    if (sessionRoot) roots.push(sessionRoot);
    const configuredWorkspace = (await this.settingsStore.get()).activeWorkspace;
    if (configuredWorkspace) roots.push(configuredWorkspace);
    if (effectiveSessionId) {
      const cacheKey = sessionCacheKey(effectiveSessionId);
      roots.push(
        join(this.userDataPath, "session-attachments", cacheKey),
        join(this.userDataPath, "session-media", cacheKey),
      );
    }
    const requestedRoot = intent.executionRoot;
    const canonicalRequestedRoot = requestedRoot
      ? await canonicalExistingPath(requestedRoot, "directory").catch(() => undefined)
      : undefined;
    if (canonicalRequestedRoot && roots.some((root) => samePath(root, canonicalRequestedRoot))) roots.push(canonicalRequestedRoot);
    const relativeBase = sessionRoot
      ?? (canonicalRequestedRoot && roots.some((root) => samePath(root, canonicalRequestedRoot)) ? canonicalRequestedRoot : undefined)
      ?? configuredWorkspace;
    if (!isAbsolute(intent.target) && !relativeBase) {
      return { ok: false, target: intent.target, kind: "missing", action, message: "相对目标缺少会话或 Worktree 执行根目录" };
    }
    const target = resolve(relativeBase ?? "", intent.target);
    const canonicalTarget = await realpath(target).catch(() => undefined);
    if (!canonicalTarget) return { ok: false, target, kind: "missing", action, message: `目标不存在：${target}` };
    const trusted = await Promise.all(roots.map(async (root) => realpath(root).catch(() => resolve(root))));
    if (!trusted.some((root) => pathWithin(canonicalTarget, root))) {
      return { ok: false, target: canonicalTarget, kind: "missing", action, message: "目标超出当前会话、工作区或应用缓存范围" };
    }
    const info = await stat(canonicalTarget);
    const extension = extname(canonicalTarget).toLowerCase();
    const kind: OpenTargetResult["kind"] = info.isDirectory()
      ? "directory"
      : [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"].includes(extension)
        ? "image"
        : [".mp4", ".webm", ".mov", ".mkv"].includes(extension)
          ? "video"
          : "file";
    if (action === "open" && info.isFile() && UNSAFE_SYSTEM_OPEN_EXTENSIONS.has(extension)) {
      return { ok: false, target: canonicalTarget, kind, action, message: `为避免执行本地代码，应用不会直接打开 ${extension || "该"} 文件` };
    }
    if (action === "open-with") {
      if (!intent.applicationId) return { ok: false, target: canonicalTarget, kind, action, message: "请选择实际可用的打开工具" };
      try {
        await this.externalOpenTools.open(intent.applicationId, canonicalTarget, info.isDirectory() ? "directory" : "file", intent.line, intent.column);
        const tool = (await this.externalOpenTools.list()).find((value) => value.id === intent.applicationId);
        return { ok: true, target: canonicalTarget, kind, action, message: `已使用 ${tool?.label || intent.applicationId} 打开` };
      } catch (error) {
        return { ok: false, target: canonicalTarget, kind, action, message: error instanceof Error ? error.message : String(error) };
      }
    }
    if (action === "copy-path") {
      clipboard.writeText(canonicalTarget);
      return { ok: true, target: canonicalTarget, kind, action, message: "路径已复制" };
    }
    if (action === "reveal") {
      if (info.isDirectory()) {
        const error = await shell.openPath(canonicalTarget);
        return { ok: !error, target: canonicalTarget, kind, action, message: error || "已在资源管理器中打开目录" };
      }
      shell.showItemInFolder(canonicalTarget);
      return { ok: true, target: canonicalTarget, kind, action, message: "已在资源管理器中定位文件" };
    }
    const error = await shell.openPath(canonicalTarget);
    return { ok: !error, target: canonicalTarget, kind, action, message: error || (info.isDirectory() ? "已打开执行目录" : "已打开目标文件") };
  }
  listOpenTargetTools(): Promise<ExternalOpenTool[]> { return this.externalOpenTools.list(); }
  openExternal(url: string) {
    if (!isAllowedExternalUrl(url)) throw new Error("仅允许打开 HTTP/HTTPS 链接");
    return shell.openExternal(url);
  }
  async respondPermission(sessionId: string, requestId: string | number, optionId: string): Promise<void> {
    if (this.offlineUiSessionResponder?.owns(sessionId)) {
      await this.offlineUiSessionResponder.respondPermission(sessionId, requestId, optionId);
      return;
    }
    this.processes.get(sessionId).respondPermission(requestId, optionId);
  }
  respondQuestion(sessionId: string, requestId: string | number, answers: Record<string, string>) { this.processes.get(sessionId).respondQuestion(requestId, answers); }
  respondMcpElicitation(sessionId: string, requestId: string | number, outcome: "accept" | "decline" | "cancel", content?: Record<string, string | number | boolean>) {
    this.processes.get(sessionId).respondMcpElicitation(requestId, outcome, content);
  }
  respondPlan(sessionId: string, requestId: string | number | undefined, verdict: "approved" | "rejected" | "cancelled", comment = "", executionMode?: "agent" | "auto") {
    if (this.offlineUiSessionResponder?.owns(sessionId)) return this.offlineUiSessionResponder.respondPlan(sessionId, requestId, verdict, comment, executionMode);
    return this.processes.get(sessionId).respondPlan(requestId, verdict, comment, executionMode);
  }

  private async compileExecutionProfile(workspacePath: string, profileId?: string): Promise<CompiledExecutionProfile> {
    return this.profiles.compile(workspacePath, profileId, await this.definitions.listAgents(workspacePath));
  }

  private async applyExecutionProfileToAutomation(input: AutomationTaskInput): Promise<AutomationTaskInput> {
    const compiled = input.frozenExecutionProfile
      ? await this.profiles.compileProfile(input.frozenExecutionProfile, await this.definitions.listAgents(input.workspace))
      : await this.compileExecutionProfile(input.workspace, input.executionProfileId);
    return resolveAutomationProfile(input, compiled);
  }

  private async openAssignedSession(assignment: SessionExecutionAssignment): Promise<{ sessionId: string }> {
    const compiled = await this.profiles.compileProfile(assignment.profile, await this.definitions.listAgents(assignment.cwd));
    const settings = await this.settingsStore.get();
    return this.processes.openConfigured(assignment.cwd, assignment.sessionId, compiled.effort || settings.defaultEffort, compiled.mode, compiled.modelId || settings.defaultModel, undefined, compiled.environment, { agentProfilePath: compiled.agentProfilePath, sessionMeta: compiled.sessionMeta, alwaysApprove: compiled.mode === "auto" }, true);
  }

  /**
   * Resolves an exact managed Provider identity before a conversation launch or
   * model switch. Disabled registrations remain discoverable specifically so a
   * stale session cannot silently fall through to an official model with the
   * same display name.
   */
  private async resolveManagedProviderSelection(modelId: string | undefined): Promise<string | undefined> {
    if (!modelId || !this.providers) return undefined;
    const provider = await this.providers.managedProviderForModel(modelId);
    if (!provider) return undefined;
    if (provider.enabled === false) throw new Error(`提供商“${provider.name}”已停用，无法使用模型“${modelId}”`);
    const model = provider.models.find((value) => value.id === modelId);
    if (!model || model.enabled === false) throw new Error(`模型“${provider.name} · ${model?.name || modelId}”已停用，无法启动会话`);
    return provider.id;
  }

  private async persistSessionProviderIdentity(sessionId: string, cwd: string, modelId: string | undefined, providerId: string | undefined, profileId?: string): Promise<void> {
    const previous = await this.sessionRuntime.get(sessionId);
    if (previous) {
      await this.sessionRuntime.patch(sessionId, { cwd, modelId, providerId, profileId: profileId ?? previous.profileId });
      return;
    }
    const snapshot = this.processes.snapshot(sessionId);
    await this.sessionRuntime.save({
      sessionId,
      cwd,
      modelId,
      providerId,
      effort: snapshot?.effort ?? "",
      mode: snapshot?.mode ?? "agent",
      profileId,
    });
  }

  private async reconcileProviderDesktopDefault(providers: CustomProviderProfile[]): Promise<void> {
    const settings = await this.settingsStore.get();
    if (!settings.defaultModel) return;
    const stillAvailable = providers.some((provider) => provider.enabled !== false
      && provider.models.some((model) => model.enabled !== false && model.id === settings.defaultModel));
    if (!stillAvailable) await this.settingsStore.patch({ defaultModel: "" });
  }

  async dispose(): Promise<void> {
    this.disposing = true;
    await this.remoteGateway?.dispose();
    for(const timer of this.pullRequestWatches.values())clearInterval(timer);this.pullRequestWatches.clear();
    this.workspaceTerminals.dispose();
    this.workspaceBrowser?.dispose();
    // The updater may currently be replacing grok.exe and still owes the user a
    // post-install probe, rollback and session restoration. Never tear down its
    // controller dependencies halfway through that transaction.
    await this.updater.waitForActive().catch((error) => this.log.log(`退出前等待 CLI 更新结束失败：${error instanceof Error ? error.message : String(error)}`));
    for (const timer of this.projectionReplayTimers.values()) clearTimeout(timer);
    this.projectionReplayTimers.clear();
    await this.stopMediaJobs("应用退出，媒体任务已取消");
    await this.conversationProjections.dispose();
    await this.auth.dispose();
    await this.processes.dispose();
    await this.tokenActivity.dispose();
    await this.providers.dispose();
    await this.computer.dispose();
    await this.desktopTools.dispose();
    await this.sessionRelay.dispose();
  }

  /**
   * The adapter knows the model and the JSON-RPC error; the gateway knows the
   * HTTP status, trace id and how many schema values it had to rewrite. Neither
   * alone can explain the failure, so they are joined here, in the only process
   * that can see both. Mutates in place: the event is sent to the renderer next.
   */
  private async enrichFailure(failure: TurnFailure): Promise<void> {
    const gatewayScopeId = failure.gatewayScopeId;
    delete failure.gatewayScopeId;
    try {
      failure.message = redactSecrets(failure.message).slice(0, 8_000);
      const routeReceipt = this.providers?.routeReceipt(gatewayScopeId);
      const provider = routeReceipt
        ? await this.providers?.managedProviderById(routeReceipt.providerId)
        : await this.providers?.providerForModel(failure.modelId);
      if (!provider) { failure.nextActions = turnFailureActions(failure.classification); return; }
      if (routeReceipt) {
        failure.providerRoute = routeReceipt;
        failure.providerId = routeReceipt.providerId;
      }
      // Match only a recent observation: an older one describes a different turn.
      const observedFailure = this.providers?.gatewayFailures(provider.id, gatewayScopeId)
        .find((record) => {
          const delta = Date.parse(failure.at) - Date.parse(record.at);
          return delta >= 0 && delta < 60_000;
        });
      const observed = observedFailure ?? this.providers?.gatewayObservations(provider.id, gatewayScopeId)
        .find((record) => {
          const delta = Date.parse(failure.at) - Date.parse(record.at);
          return delta >= 0 && delta < 60_000;
        });
      if (!observed) {
        // A requested local model id is not proof that the custom provider
        // handled the turn. Older persisted sessions can expose only the
        // upstream alias and remain on the official route. Do not label an
        // official quota error as a Provider failure without gateway evidence.
        failure.nextActions = [
          `本回合没有观察到「${provider.name}」兼容网关请求；应用将重新应用自定义模型路由后再发送`,
          ...turnFailureActions(failure.classification),
        ];
        failure.providerFailureStage = classifyProviderFailureStage({});
        return;
      }
      failure.providerId = provider.id;
      if (observed.status !== undefined && observed.status >= 400) failure.httpStatus ??= observed.status;
      failure.traceId ??= observed.traceId;
      failure.retryAfter ??= observed.retryAfter;
      failure.gatewayPhase ??= observed.phase;
      if (observed.reason) failure.gatewayReason ??= observed.reason;
      failure.gatewayProxyMode ??= observed.proxyMode;
      failure.gatewayRequestId ??= observed.requestId;
      failure.gatewayElapsedMs ??= observed.elapsedMs;
      failure.sanitizedCount ??= observed.sanitizedCount;
      failure.classification = classifyTurnFailure({
        message: failure.message,
        httpStatus: failure.httpStatus,
        jsonRpcCode: failure.jsonRpcCode,
        processExitCode: failure.processExitCode,
        cancelled: failure.cancelled,
      });
      failure.providerFailureStage = classifyProviderFailureStage({ observed, classification: failure.classification });
      // A Gemini-family upstream on the pass-through profile is the single most
      // actionable case: the remedy is one setting, not a retry.
      if (failure.classification === "schema-rejected" && (provider.schemaProfile ?? "standard") === "standard") {
        failure.nextActions = [`把提供商「${provider.name}」的工具 Schema 改为 Gemini / Antigravity 档后重试`, ...turnFailureActions(failure.classification).slice(1)];
      } else failure.nextActions = turnFailureActions(failure.classification);
    } catch (error) {
      await this.log.log(`失败诊断信息补全失败：${error instanceof Error ? error.message : String(error)}`);
      failure.nextActions ??= turnFailureActions(failure.classification);
    }
  }

  /** Records a real agent write so non-Git workspaces can still review changes. */
  private recordAgentChange(sessionId: string, tool: ToolCallState): void {
    const snapshot = this.processes.snapshot(sessionId);
    this.agentChanges.record(sessionId, snapshot?.cwd ?? "", this.processes.get(sessionId)?.activeTurnId, tool);
  }

  /** Real agent writes for this session; rebuilt from the private projection after restart. */
  async getAgentChanges(sessionId: string, scope: "last-turn" | "session"): Promise<AgentChangeIndex> {
    let index = this.agentChanges.index(sessionId, scope);
    if (index.files.length) return index;
    const projection = await this.conversationProjections.restore(sessionId).catch(() => undefined);
    if (!projection) return index;
    const cwd = this.processes.snapshot(sessionId)?.cwd ?? "";
    let turnId: string | undefined;
    for (const raw of projection.events) {
      const event = raw as ChatEvent;
      if (event.type === "turn-started") {
        turnId = event.presentation.turnId;
        this.agentChanges.beginTurn(sessionId, cwd, turnId);
      } else if (event.type === "tool-call") {
        this.agentChanges.record(sessionId, cwd, turnId, event.tool);
      } else if (event.type === "turn-completed") turnId = undefined;
    }
    index = this.agentChanges.index(sessionId, scope);
    return index;
  }

  /**
   * Quota bookkeeping reads the vault and writes quota.json. It must never
   * delay or suppress delivering the error event that triggered it, so it runs
   * detached and reports its own failures.
   */
  private captureQuotaSignal(message: string, modelId?: string): void {
    void this.quota.captureError(message, modelId).catch((error) => this.log.log(`滚动额度采集失败：${error instanceof Error ? error.message : String(error)}`));
  }

  /**
   * Custom providers are optional, so a broken managed block, a failed user
   * environment write or a concurrent config.toml edit must not be able to
   * block launching sessions that do not use a provider at all.
   */
  private async providerLaunchEnvironment(context: ProviderLaunchContext): Promise<Record<string, string>> {
    if (!this.providers) return {};
    const localModelId = context.localModelId ?? context.modelId;
    const recordedProvider = await this.providers.managedProviderById(context.providerId);
    const providerByModel = await this.providers.managedProviderForModel(localModelId);
    if (context.providerId && !recordedProvider) {
      throw new Error(`此会话记录的自定义提供商（${context.providerId}）已不存在。为防止串到官方模型，已阻止发送`);
    }
    if (recordedProvider && providerByModel?.id !== recordedProvider.id) {
      throw new Error(`此会话记录的模型“${localModelId || "未知"}”不再属于提供商“${recordedProvider.name}”。为防止错误路由，已阻止发送`);
    }
    const managed = recordedProvider ?? providerByModel;
    if (managed?.enabled === false) throw new Error(`提供商“${managed.name}”已停用，无法恢复此会话`);
    const managedModel = managed?.models.find((model) => model.id === localModelId);
    if (managedModel?.enabled === false) throw new Error(`模型“${managed!.name} · ${managedModel.name || managedModel.model}”已停用，无法恢复此会话`);
    try {
      const environment = await this.providers.desktopEnvironment(context.scopeId, managed?.id);
      if (managed && !environment[managedBaseUrlEnvironmentName(managed.id)]) {
        throw new Error(`提供商“${managed.name}”的网关路由未建立`);
      }
      if (managed && managedModel) this.providers.captureRouteReceipt(context, managed, managedModel);
      return environment;
    }
    catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (managed) {
        await this.log.log(`受管模型 ${localModelId} 的提供商环境启动失败：${detail}`);
        throw new Error(`自定义模型“${managed.name} · ${managedModel?.name || managedModel?.model || localModelId}”启动失败：${detail}`);
      }
      await this.log.log(`未使用受管模型的会话忽略提供商环境错误：${detail}`);
      return {};
    }
  }

  private eventFlights = new Map<string, Promise<void>>();
  private handleEvent(event: ChatEvent): Promise<void> {
    // Preparing attachments performs I/O. Preserve ACP order across that await,
    // otherwise a sent status or terminal update can overtake its user bubble.
    const key = event.sessionId || "global";
    const flights = this.eventFlights ??= new Map();
    const next = (flights.get(key) ?? Promise.resolve()).catch(() => undefined)
      .then(() => this.handleOrderedEvent(event));
    flights.set(key, next);
    void next.finally(() => { if (flights.get(key) === next) flights.delete(key); }).catch(() => undefined);
    return next;
  }

  private async handleOrderedEvent(event: ChatEvent): Promise<void> {
    const replayingAtEntry=Boolean(event.sessionId && this.projectionReplaying.has(event.sessionId));
    this.nativeAgentCapabilities.record(event, { replaying: Boolean(event.sessionId && this.projectionReplaying.has(event.sessionId)) });
    if (!replayingAtEntry && event.type === "session-title") {
      await this.catalog.syncOfficialTitle(event.sessionId, event.title, event.manual);
    }
    if (event.type === "commands") {
      setOfficialFeedbackMenuAvailable(event.commands.some((command) => command.name.replace(/^\//, "").toLowerCase() === "feedback"));
    }
    if (!replayingAtEntry && event.type === "tool-call") {
      const snapshot = this.processes.snapshot(event.sessionId);
      try {
        event.tool = await this.turnFileChanges.observe(
          event.sessionId,
          snapshot?.cwd ?? "",
          this.processes.get(event.sessionId)?.activeTurnId,
          event.tool,
        );
      } catch (error) {
        // Refusing an untrusted or unavailable filesystem path must not hide
        // the original ACP tool update from the user.
        await this.log.log(`文件改动快照未采集：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    event = await this.prepareVisibleEvent(event);
    // Failure enrichment changes what the renderer presents, so it is the only
    // disk/network-adjacent observer allowed to run before delivery.
    if (event.type === "error") {
      this.captureQuotaSignal(event.message, event.sessionId ? this.processes.snapshot(event.sessionId)?.modelId : undefined);
      if (event.failure) await this.enrichFailure(event.failure);
    }
    const sessionId = event.sessionId ?? "";
    const readyModelId = event.type === "session-ready" ? event.currentModelId : undefined;
    if (event.type === "session-ready" && event.models?.length) {
      const byId = new Map(this.modelCatalog.map((model) => [model.modelId, model]));
      for (const model of event.models) {
        if (model.modelId.startsWith("fixture-")) continue;
        byId.set(model.modelId, model);
      }
      this.modelCatalog = [...byId.values()];
    }
    if (event.type === "session-ready" && sessionId && readyModelId) {
      void this.providers.managedProviderForModel(readyModelId).then(async (provider) => {
        // Reconcile atomically: a managed session keeps its provider-scoped
        // local id even when ACP reports only the upstream alias.
        await this.sessionRuntime.reconcileSessionReady(sessionId, readyModelId, provider?.id);
      }).catch((error) => this.log.log(`保存会话 Provider 路由失败：${error instanceof Error ? error.message : String(error)}`));
    }
    if (event.type === "session-reset" && sessionId) {
      this.projectionReplaying.add(sessionId);
      this.projectionReplayBuffers.set(sessionId, []);
      this.armProjectionReplayWatchdog(sessionId);
      this.window?.webContents.send("grok:event", event);
      const projection = await this.conversationProjections.restore(sessionId).catch(() => undefined);
      if (projection) {
        this.window?.webContents.send("grok:event", await this.prepareVisibleEvent({
          type: "conversation-projection-restore",
          sessionId,
          projection,
        } satisfies ChatEvent));
      }
    } else {
      const replayingVisibleEvent = sessionId
        && this.projectionReplaying.has(sessionId)
        && !["session-ready", "commands", "mode", "meta", "status"].includes(event.type);
      if (replayingVisibleEvent) {
        const buffered = this.projectionReplayBuffers.get(sessionId);
        if (buffered && buffered.length < 20_000) buffered.push(sanitizeProjectionReplayEvent(event));
      } else {
        this.window?.webContents.send("grok:event", event);
      }
      if (event.type === "session-ready" && sessionId && this.projectionReplaying.has(sessionId)) {
        // openSession owns the initial replay barrier so it can reconcile once
        // before sending a single restore. A transport rebuild that happens
        // outside openSession is reconciled here instead.
        if (!this.projectionOpenSessions.has(sessionId)) {
          const buffered = [...(this.projectionReplayBuffers.get(sessionId) ?? [])];
          let projection = await this.conversationProjections.restore(sessionId).catch(() => undefined);
          if (buffered.length) {
            projection = await this.conversationProjections.mergeReplay(sessionId, buffered)
              .catch(async (error) => {
                await this.log.log(`会话传输重建投影合并失败：${error instanceof Error ? error.message : String(error)}`);
                return projection;
              });
          }
          if (projection) {
            this.window?.webContents.send("grok:event", await this.prepareVisibleEvent({
              type: "conversation-projection-restore",
              sessionId,
              projection,
            } satisfies ChatEvent));
          } else {
            for (const replayed of buffered) this.window?.webContents.send("grok:event", replayed);
          }
          this.finishProjectionReplay(sessionId);
        }
      }
    }

    // Everything below is a secondary projection. A full disk, stale cache or
    // optional dashboard must never suppress the primary chat event.
    if (!this.projectionReplaying.has(sessionId)) {
      await this.conversationProjections.record(event)
        .catch((error) => this.log.log(`会话可见内容投影失败：${error instanceof Error ? error.message : String(error)}`));
    }
    if (!replayingAtEntry && !this.projectionReplaying.has(sessionId)) this.remoteGateway?.observe(event);
    if (replayingAtEntry || this.projectionReplaying.has(sessionId)) return;
    await this.dashboard.record(event).catch((error) => this.log.log(`Agent Dashboard 记录失败：${error instanceof Error ? error.message : String(error)}`));
    if ((event.type === "turn-started" || event.type === "turn-completed") && event.presentation) {
      await this.turnPresentations.recordForSession(event.sessionId, event.presentation)
        .catch((error) => this.log.log(`回合展示记录失败：${error instanceof Error ? error.message : String(error)}`));
      if (event.type === "turn-completed") {
        await this.tokenActivity.record(event.sessionId, event.presentation, { workspace: this.processes.snapshot(event.sessionId)?.cwd })
          .catch((error) => this.log.log(`Token 活动记录失败：${error instanceof Error ? error.message : String(error)}`));
      }
    }
    // A child agent reports its own cumulative usage on a separate event. Record it as
    // its own row so the number is visible; it is deliberately not folded into the
    // parent turn, because the CLI's parent total may already include it.
    if (event.type === "subagent") {
      const subagentUsage = subagentTurnUsage(event.update);
      if (subagentUsage) {
        const identity = subagentIdentity(event.update);
        if (!identity) return;
        const child = await this.dashboard.subagentRecord(`session:${event.sessionId}:subagent:${identity}`);
        const stableId = child?.nativeSubagentId ?? identity;
        await this.tokenActivity.record(event.sessionId, {
          turnId: `subagent:${stableId}`,
          ordinal: 0,
          startedAt: subagentUsage.observedAt,
          completedAt: subagentUsage.observedAt,
          usage: subagentUsage.usage,
        }, { workspace: this.processes.snapshot(event.sessionId)?.cwd,
          relatedTurnIds:[identity,child?.nativeSubagentId,child?.childSessionId].filter((id):id is string=>Boolean(id)).map(id=>`subagent:${id}`) })
          .catch((error) => this.log.log(`子智能体 Token 记录失败：${error instanceof Error ? error.message : String(error)}`));
      }
    }
    if (event.type === "tool-call") {
      try { this.recordAgentChange(event.sessionId, event.tool); }
      catch (error) { await this.log.log(`Agent 改动记录失败：${error instanceof Error ? error.message : String(error)}`); }
    }
    if (event.type === "turn-started") {
      const cwd = this.processes.snapshot(event.sessionId)?.cwd ?? "";
      this.agentChanges.beginTurn(event.sessionId, cwd, event.presentation.turnId);
    }
    if (event.type === "user-message-status") {
      await this.attachmentCache.updateDelivery(event.sessionId, event.clientMessageId, event.delivery)
        .catch((error) => this.log.log(`消息附件状态记录失败：${error instanceof Error ? error.message : String(error)}`));
    }
    if (event.type === "turn-completed") await this.computer.settleSession(event.sessionId, "completed", "Computer Use 回合已完成").catch(() => undefined);
    if (event.type === "error" && event.sessionId) await this.computer.settleSession(event.sessionId, "error", event.message).catch(() => undefined);
    if (event.type === "status" && event.status === "error") await this.computer.settleSession(event.sessionId, "error", event.text || "Grok 进程异常，Computer Use 已清理").catch(() => undefined);
    if (event.type === "status" && event.status === "error" && event.text) this.captureQuotaSignal(event.text, this.processes.snapshot(event.sessionId)?.modelId);
    // Only a live prompt turn counts as "work finished". Model/effort/mode switches and
    // session restore also toggle working→idle and must not raise completion notices.
    if (!replayingAtEntry && event.type === "turn-started") this.runningSessions.add(event.sessionId);
    if (event.type === "status" && (event.status === "idle" || event.status === "error") && this.runningSessions.delete(event.sessionId)) {
      if(this.visibleConversationId!==event.sessionId||!this.window?.isFocused())await this.catalog.markUnread(event.sessionId, event.status === "error");
      await this.inbox.add({ kind: event.status === "error" ? "failure" : "completion", title: event.status === "error" ? "会话失败" : "会话已完成", detail: event.text, sessionId: event.sessionId });
      await this.notices().show(`session:${event.sessionId}:${Date.now()}`,event.status==="error"?"failure":"completion",event.status==="error"?"Grok 会话失败":"Grok 会话已完成","点击查看最终回复或错误详情。",{kind:"session",id:event.sessionId});
    }
    if(["permission","question","plan","computer-permission","computer-risk"].includes(event.type)&&event.sessionId){const raw=event as unknown as {requestId?:string;request?:{requestId?:string}};await this.notices().show(`confirmation:${event.sessionId}:${raw.requestId??raw.request?.requestId??event.type}`,"confirmation","Grok 正在等待你处理","任务已暂停，点击返回会话。",{kind:"session",id:event.sessionId});}
  }

  private finishProjectionReplay(sessionId: string): void {
    this.projectionReplaying.delete(sessionId);
    this.projectionReplayBuffers.delete(sessionId);
    const timer = this.projectionReplayTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.projectionReplayTimers.delete(sessionId);
  }

  private armProjectionReplayWatchdog(sessionId: string): void {
    const previous = this.projectionReplayTimers.get(sessionId);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => void this.releaseStalledProjectionReplay(sessionId), 10_000);
    timer.unref?.();
    this.projectionReplayTimers.set(sessionId, timer);
  }

  /**
   * A transport reset normally ends with session-ready. If an older or broken
   * CLI never emits it, keeping replay mode forever would silently discard all
   * later visible events. Reconcile the bounded replay buffer with the durable
   * local projection before releasing the barrier; never discard either side.
   */
  private async releaseStalledProjectionReplay(sessionId: string): Promise<void> {
    if (!this.projectionReplaying.has(sessionId)) return;
    if (this.projectionOpenSessions.has(sessionId)) {
      this.armProjectionReplayWatchdog(sessionId);
      return;
    }
    const buffered = [...(this.projectionReplayBuffers.get(sessionId) ?? [])];
    let projection = await this.conversationProjections.restore(sessionId).catch(() => undefined);
    if (buffered.length) {
      projection = await this.conversationProjections.mergeReplay(sessionId, buffered)
        .catch(async (error) => {
          await this.log.log(`会话超时回放投影合并失败：${error instanceof Error ? error.message : String(error)}`);
          return projection;
        });
    }
    this.finishProjectionReplay(sessionId);
    if (projection) {
      this.window?.webContents.send("grok:event", await this.prepareVisibleEvent({
        type: "conversation-projection-restore",
        sessionId,
        projection,
      } satisfies ChatEvent));
    } else {
      for (const event of buffered) {
        this.window?.webContents.send("grok:event", event);
        await this.conversationProjections.record(event)
          .catch((error) => this.log.log(`会话重建回放投影失败：${error instanceof Error ? error.message : String(error)}`));
      }
    }
    await this.log.log(`会话传输重建未收到 session-ready，已在 10 秒后解除回放保护：${sessionId.slice(0, 12)}`);
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

  private async showAutomationNotification(run: AutomationRunRecord): Promise<void> {
    const [task,policy]=await Promise.all([this.automations.list().then(tasks=>tasks.find(task=>task.id===run.taskId)),this.automations.getPolicy()]);
    if(!task?.notify||(run.status==="completed"?!policy.notifyOnSuccess:!policy.notifyOnFailure))return;
    await this.notices().show(`automation:${run.id}`,run.status==="completed"&&!run.warning?"completion":"failure",run.warning?"定时任务结果待检查":run.status==="completed"?"定时任务已完成":"定时任务失败","点击打开对应运行记录。",{kind:"automation",id:run.id});
  }

  private async recordAutomationResult(run: AutomationRunRecord): Promise<void> {
    await this.inbox.add({
      kind: run.status === "completed" && !run.warning ? "completion" : "failure",
      title: run.warning ? "定时任务结果待检查" : run.status === "completed" ? "定时任务已完成" : "定时任务失败",
      detail: run.error || run.warning || (run.sessionId ? `已保存为 Grok 会话 ${run.sessionId.slice(0, 8)}` : "运行记录已保存，可在任务中心查看。"),
      taskId: run.taskId,
      automationRunId: run.id,
    });
    await this.showAutomationNotification(run);
  }

  private showAutomationPendingNotification(pending: import("../shared/types").AutomationPendingConfirmation): void {
    void this.notices().show(`pending:${pending.id}`,"confirmation","定时任务等待确认",`操作已暂停，将在 ${new Date(pending.expiresAt).toLocaleTimeString("zh-CN")} 前等待处理。点击打开任务中心。`,{kind:"automation",id:pending.runId}).catch(error=>this.log.log(String(error)));
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

function normalizePathKey(value: string): string { return value.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase(); }
function samePath(left: string, right: string): boolean { return normalizePathKey(left) === normalizePathKey(right); }
function pathWithin(target: string, root: string): boolean {
  const value = relative(resolve(root), resolve(target));
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}
function createHashForPath(value: string): string { return createHash("sha256").update(value).digest("hex").slice(0, 32); }
/** Stable identity for one child agent across its spawned/progress/finished updates. */
function subagentIdentity(update: Record<string, unknown>): string | undefined {
  const value = update.subagent_id ?? update.subagentId ?? update.child_session_id ?? update.childSessionId;
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}
/**
 * Child agents report a cumulative `tokens_used` on each lifecycle update, so the
 * value is mapped onto a stable per-child turn id and merged rather than summed.
 * `totalTokens` is only set when the CLI actually reported one.
 */
function subagentTurnUsage(update: Record<string, unknown>): { usage: TurnUsage; observedAt: string } | undefined {
  const total = finiteCount(update.tokens_used ?? update.tokensUsed);
  if (total === undefined) return undefined;
  return {
    usage: { source: "subagent", exact: true, totalTokens: total },
    observedAt: new Date().toISOString(),
  };
}
function finiteCount(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}
function windowsBatchCommand(executable: string, args: string[]): string {
  const values = [executable, ...args];
  if (values.some((value) => /[\r\n"&|<>^%!]/.test(value))) {
    throw new Error("批处理 CLI 路径或媒体提示包含不安全的 cmd.exe 元字符；请安装原生 Grok CLI 可执行文件");
  }
  return `call ${values.map((value) => `"${value}"`).join(" ")}`;
}
export function mediaToolPrompt(request: MediaCreationRequest, continuing = false): string {
  const aspect = request.aspectRatio === "auto" ? "" : `，画面比例 ${request.aspectRatio}`;
  const once = "只调用一次媒体工具；成功时返回实际产物路径，失败时原样返回第一次错误并立即停止，不要重试或改用其它媒体工具。";
  if (request.kind === "image") return `${request.prompt.trim()}${aspect}。${request.referencePaths?.length ? `使用 image_edit 编辑参考图片，参考文件路径：${JSON.stringify(request.referencePaths)}。` : continuing ? "根据本次意图选择 image_edit 修改上轮图片，或选择 image_gen 生成新图片；使用真实产物路径，不把新生成当作编辑。" : "使用 image_gen 生成图片。"}${once}`;
  const references = (request.referencePaths ?? []).map((path) => `@${path}`).join("\n");
  const voice = request.voice?.trim() ? `，参考视频声音 ${request.voice.trim()}` : "";
  return `${request.prompt.trim()}${aspect}，时长 ${request.duration ?? 6} 秒，分辨率 ${request.resolution ?? "480p"}${voice}。${references ? `参考图：\n${references}\n` : ""}无参考图时使用 video_gen；有一张参考图时使用 image_to_video，多张参考图时使用 reference_to_video。${once}`;
}

export function normalizeMediaJobError(error: unknown): string {
  const raw = (error instanceof Error ? error.message : String(error))
    .replace(/\u001b\[[0-9;]*m/g, "")
    .trim();
  if (/Zero Data Retention teams must provide output\.upload_url/i.test(raw)) {
    return "当前 Grok 团队启用了 Zero Data Retention，但已安装的 CLI 视频工具无法提供 output.upload_url。这不是内容审核或桌面路径配置错误；请改用非 ZDR 团队，或使用已配置上传回调的视频 Provider。";
  }
  return raw || "媒体任务失败";
}

function localMediaMimeType(path: string): string | undefined {
  switch (extname(path).toLowerCase()) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    case ".bmp": return "image/bmp";
    case ".mp4": return "video/mp4";
    case ".webm": return "video/webm";
    case ".mov": return "video/quicktime";
    default: return undefined;
  }
}

function sanitizeProjectionReplayEvent(event: ChatEvent): ChatEvent {
  // Replay buffers live only for the duration of session/open. Keep an
  // immutable copy so later adapter mutations cannot alter the recovered
  // conversation. Oversized tool screenshots are intentionally omitted here;
  // durable media blocks and attachment caches remain the canonical image
  // surfaces.
  if (event.type !== "tool-call") return structuredClone(event);
  return {
    ...structuredClone(event),
    tool: {
      ...structuredClone(event.tool),
      content: event.tool.content?.map((item) => {
        if (!item || typeof item !== "object") return item;
        const value = item as Record<string, unknown>;
        return value.type === "image" && typeof value.data === "string" && value.data.length > 512 * 1024
          ? { ...value, data: "" }
          : item;
      }),
    },
  };
}

async function writeBoundedResponseFile(response: Response, target: string, maxBytes: number): Promise<void> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("媒体产物超过缓存大小限制");
  if (!response.body) throw new Error("媒体产物响应没有正文");
  const reader = response.body.getReader();
  const file = await open(target, "w");
  let total = 0;
  try {
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > maxBytes) {
          await reader.cancel("media artifact too large").catch(() => undefined);
          throw new Error("媒体产物超过缓存大小限制");
        }
        let offset = 0;
        while (offset < next.value.byteLength) {
          const written = await file.write(next.value, offset, next.value.byteLength - offset);
          offset += written.bytesWritten;
        }
      }
    } finally {
      reader.releaseLock();
      await file.close();
    }
  } catch (error) {
    await rm(target, { force: true }).catch(() => undefined);
    throw error;
  }
}

function isSupportedVideoBuffer(buffer: Buffer): boolean {
  return buffer.subarray(4, 8).toString("ascii") === "ftyp"
    || buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    || buffer.subarray(0, 4).toString("ascii") === "OggS";
}

async function isSupportedVideoFile(path: string): Promise<boolean> {
  const file = await open(path, "r");
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    return isSupportedVideoBuffer(header.subarray(0, bytesRead));
  } finally { await file.close(); }
}

function profileSlug(value: string): string { return value.normalize("NFKC").toLocaleLowerCase().replace(/[^a-z0-9\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 32) || "session"; }

function mimeForExtension(extension: string): string | undefined {
  return extension === ".png" ? "image/png" : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".gif" ? "image/gif" : extension === ".webp" ? "image/webp" : undefined;
}

function projectionVisibleSummary(projection?: ConversationProjection): string {
  if (!projection) return "";
  for (let index = projection.events.length - 1; index >= 0; index--) {
    const event = projection.events[index];
    if (!event || typeof event !== "object") continue;
    const type = typeof event.type === "string" ? event.type : "";
    if (type !== "message-chunk" && type !== "user-message" && type !== "recap") continue;
    const text = typeof event.text === "string" ? event.text.replace(/\s+/g, " ").trim() : "";
    if (text) return text.slice(0, 240);
  }
  return "";
}

function isUiDensity(value: unknown): value is UiDensity {
  return value === "compact" || value === "balanced" || value === "comfortable";
}

function applyNativeTheme(theme: ThemeSettings): void {
  nativeTheme.themeSource = theme.mode === "system" ? "system" : theme.mode === "light" || (theme.mode === "custom" && theme.customBase === "light") ? "light" : "dark";
}

function waitForAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("任务已取消"));
  return new Promise<T>((resolvePromise, rejectPromise) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = (): void => finish(() => rejectPromise(signal.reason ?? new Error("任务已取消")));
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (value) => finish(() => resolvePromise(value)),
      (error) => finish(() => rejectPromise(error)),
    );
  });
}
