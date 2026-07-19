export const REASONING_EFFORTS = ["", "none", "minimal", "low", "medium", "high", "xhigh"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
export type SessionMode = "agent" | "plan" | "auto";
export type UiDensity = "compact" | "balanced" | "comfortable";

export interface BuildInfo {
  productName: "Grok Build Desktop";
  version: string;
  channel: string;
  commit: string;
  builtAt: string;
  repository: string;
  profile: "public" | "local";
  packaged: boolean;
  signed: false;
  unofficial: true;
}

export type DiagnosticStatus = "ok" | "warning" | "error" | "info";

export interface SystemDiagnosticItem {
  id: string;
  label: string;
  status: DiagnosticStatus;
  summary: string;
  details?: string[];
}

export interface SystemCompatibilityReport {
  checkedAt: string;
  overall: "ready" | "limited" | "blocked";
  items: SystemDiagnosticItem[];
  cliPath?: string;
  cliVersion?: string;
  effortFlag?: "--effort" | "--reasoning-effort";
}

export interface OnboardingState {
  version: number;
  completed: boolean;
  skipped: boolean;
  currentStep: number;
  lastCheckedAt?: string;
}

export interface SupportBundlePreview {
  files: Array<{ name: string; description: string }>;
  fields: string[];
  excluded: string[];
  redacted: true;
}

export interface AppReleaseStatus {
  configured: boolean;
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  checkedAt: string;
  publishedAt?: string;
  releaseUrl?: string;
  notes?: string;
  error?: string;
}

export interface WorkspaceFileCandidate {
  path: string;
  relativePath: string;
  name: string;
  size: number;
  score: number;
}

export interface AttachmentPrivacyFinding {
  attachmentId: string;
  name: string;
  kind: "outside-workspace" | "environment" | "credential" | "private-key";
  severity: "warning" | "high";
  message: string;
}

export interface AppSettings {
  cliPath: string;
  httpProxy: string;
  httpsProxy: string;
  defaultModel: string;
  defaultEffort: ReasoningEffort;
  defaultMode: SessionMode;
  showThinking: boolean;
  expandToolDetails: boolean;
  fontScale: number;
  uiDensity: UiDensity;
  recentWorkspaces: string[];
  activeWorkspace: string;
  codexGroupCollapsed?: boolean;
  showArchivedCodex?: boolean;
}

export interface AccountProfile {
  id: string;
  label: string;
  email?: string;
  kind: "oauth" | "api-key";
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type LiveStatus = "idle" | "working" | "needs-user" | "unread" | "error" | "cold";

export interface SessionSummary {
  id: string;
  cwd: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  modelId?: string;
  effort?: string;
  status: LiveStatus;
  pinned?: boolean;
}

export type WorkspaceSource = "pinned" | "recent" | "grok" | "codex";

export interface WorkspaceSummary {
  cwd: string;
  name: string;
  exists: boolean;
  pinned: boolean;
  sources: WorkspaceSource[];
  lastUsedAt?: string;
  grokSessions: number;
  codexSessions: number;
}

export interface CodexSessionSummary {
  id: string;
  path: string;
  cwd: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  hidden: boolean;
  source?: string;
  origin?: string;
}

export interface CodexTurn {
  role: "user" | "assistant" | "tool" | "thought";
  text: string;
  toolCalls?: unknown[];
  toolResults?: unknown[];
  inert?: boolean;
}

export interface CodexSessionDetail extends CodexSessionSummary {
  turns: CodexTurn[];
  warnings: string[];
  lastUserRequest?: string;
  lastAssistantAction?: string;
  contentHash: string;
}

export interface TurnActivityGroup {
  kind: "progress" | "files" | "commands" | "subagents" | "computer" | "other";
  label: string;
  count: number;
  failed: number;
}

export interface ChatTurnState {
  id: string;
  completed: boolean;
  running: boolean;
  activityGroups: TurnActivityGroup[];
  summary: { files: number; commands: number; tools: number; subagents: number; failed: number };
}

export interface QuotaWindow {
  label: string;
  used?: number;
  limit?: number;
  remaining?: number;
  unit: "credits" | "usd" | "percent";
  periodStart?: string;
  periodEnd?: string;
  resetAt?: string;
  products?: Array<{ label: string; usedPercent?: number }>;
}

export interface GrokQuotaSnapshot {
  accountId?: string;
  supported: boolean;
  fetchedAt: string;
  stale: boolean;
  partial: boolean;
  weekly?: QuotaWindow;
  monthly?: QuotaWindow;
  onDemand?: QuotaWindow;
  prepaidBalance?: number;
  diagnostics: string[];
}

export interface ComposerDraftState {
  key: string;
  text: string;
  updatedAt: string;
}

export interface PluginSummary {
  id: string;
  name: string;
  version?: string;
  description?: string;
  enabled: boolean;
  trusted: boolean;
  scope?: string;
  path?: string;
  source?: string;
  origin?: string;
  skills: string[];
  commands: string[];
  agents: string[];
  hookCount: number;
  mcpServerCount: number;
  conflict?: string;
}

export interface PluginDetails extends PluginSummary {
  manifest?: Record<string, unknown>;
  hooks: Array<{ name: string; event?: string; enabled: boolean }>;
  mcpServers: Array<{ name: string; enabled: boolean }>;
  license?: string;
  commit?: string;
}

export interface PluginInstallPreview {
  name: string;
  version?: string;
  description?: string;
  source: string;
  installSource: string;
  kind: "local" | "git";
  commit?: string;
  fingerprint: string;
  skills: string[];
  commands: string[];
  hooks: string[];
  mcpServers: string[];
  executableFiles: string[];
  license?: string;
}

export interface MarketplacePlugin {
  id: string;
  name: string;
  description?: string;
  version?: string;
  source: string;
  official: boolean;
  installed: boolean;
  commit?: string;
  relativePath?: string;
  components?: { skills: string[]; commands: string[]; agents: string[]; hooks: number; mcpServers: number };
}

export interface MarketplaceSource {
  name: string;
  kind: string;
  urlOrPath: string;
  branch?: string;
  commit?: string;
  error?: string;
  plugins: MarketplacePlugin[];
}

export interface SkillSummary {
  name: string;
  description?: string;
  source?: string;
  command: string;
}

export interface McpServerSummary {
  name: string;
  source: "managed" | "local" | string;
  enabled: boolean;
  status?: "ready" | "initializing" | "unavailable" | string;
  toolCount: number;
  tools: Array<{ name: string; description?: string }>;
  configSource?: string;
  oauth?: boolean;
}

export interface McpDiagnostic {
  name: string;
  ok: boolean;
  message: string;
  checkedAt: string;
}

export interface McpServerInput {
  name: string;
  transport: "stdio" | "http" | "sse";
  commandOrUrl: string;
  args: string[];
  env: Record<string, string>;
  secretEnv: Record<string, string>;
  headers: Record<string, string>;
}

export interface HookSummary {
  id: string;
  name: string;
  pluginId?: string;
  source?: string;
  event?: string;
  enabled: boolean;
}

export type CodexPluginCompatibilityLevel = "adaptable" | "partial" | "incompatible";

export interface CodexPluginCompatibility {
  id: string;
  name: string;
  version?: string;
  sourcePath: string;
  sourceHash: string;
  level: CodexPluginCompatibilityLevel;
  reasons: string[];
  skills: string[];
  hasStandardMcp: boolean;
  adapterPath?: string;
  adapterStale?: boolean;
}

export interface ComputerApp {
  id: string;
  name: string;
  processName: string;
  executablePath?: string;
  iconDataUrl?: string;
  windowCount: number;
  controllable: boolean;
  blockedReason?: string;
}

export interface ComputerWindow {
  id: string;
  appId: string;
  processId: number;
  processName: string;
  executablePath?: string;
  title: string;
  bounds: { x: number; y: number; width: number; height: number };
  dpi: number;
  minimized: boolean;
  foreground: boolean;
  controllable: boolean;
  blockedReason?: string;
}

export interface ComputerElement {
  elementId: string;
  name: string;
  controlType: string;
  value?: string;
  enabled: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  patterns: string[];
}

export interface ComputerState {
  stateId: string;
  sessionId: string;
  window: ComputerWindow;
  capturedAt: string;
  screenshot?: string;
  screenshotMimeType?: "image/png";
  screenshotSource?: "electron-desktopCapturer" | "print-window";
  screenshotSize?: { width: number; height: number };
  detailScreenshot?: string;
  detailRegion?: { x: number; y: number; width: number; height: number };
  coordinateSpace?: "screenshot-pixels";
  elements: ComputerElement[];
  treeTruncated: boolean;
}

export type ComputerActionName = "list_apps" | "list_windows" | "start" | "pause" | "resume" | "stop" | "launch_app" | "activate_window" | "get_window_state" | "click" | "double_click" | "scroll" | "press_key" | "type_text" | "set_value" | "drag" | "perform_secondary_action" | "wait";
export type ComputerRiskCategory = "delete" | "external-communication" | "financial" | "install" | "account-access" | "security-settings" | "sensitive-transfer";

export interface ComputerActionRequest {
  sessionId: string;
  action: ComputerActionName;
  appId?: string;
  windowId?: string;
  stateId?: string;
  elementId?: string;
  x?: number;
  y?: number;
  endX?: number;
  endY?: number;
  deltaX?: number;
  deltaY?: number;
  key?: string;
  text?: string;
  value?: string;
  milliseconds?: number;
  detailX?: number;
  detailY?: number;
  detailWidth?: number;
  detailHeight?: number;
  risk?: ComputerRiskCategory;
  riskSummary?: string;
}

export type ComputerTaskStatus = "idle" | "awaiting-app-permission" | "awaiting-risk-confirmation" | "running" | "paused" | "stopped" | "completed" | "error";

export interface ComputerTaskState {
  sessionId: string;
  appId?: string;
  windowId?: string;
  appName?: string;
  status: ComputerTaskStatus;
  stepCount: number;
  startedAt?: string;
  updatedAt: string;
  lastAction?: ComputerActionName;
  lastState?: ComputerState;
  message?: string;
  pointer?: { x: number; y: number; action: ComputerActionName; label?: string };
  manualInterventionRequired?: boolean;
}

export interface ComputerAppPermissionRequest {
  requestId: string;
  sessionId: string;
  app: ComputerApp;
  window?: ComputerWindow;
}

export interface ComputerRiskConfirmation {
  requestId: string;
  sessionId: string;
  category: ComputerRiskCategory;
  summary: string;
  appName: string;
  action: ComputerActionName;
}

export interface ComputerUseSettings {
  enabled: boolean;
  experimentalUnlocked: boolean;
  acceptanceVersion?: string;
  confirmNewApps: boolean;
  alwaysAllowedAppIds: string[];
  maxScreenshotEdge: number;
  emergencyShortcut: string;
}

export interface ComputerCapability {
  available: boolean;
  experimental: boolean;
  accepted: boolean;
  acceptanceSummary?: string;
  helperPath?: string;
  helperVersion?: string;
  pluginPath?: string;
  pluginDirs: boolean;
  mcpImageContent: boolean;
  diagnostics: string[];
}

export interface ModelInfo {
  modelId: string;
  name: string;
  description?: string;
  totalContextTokens?: number;
}

export interface CommandInfo {
  name: string;
  description?: string;
  inputHint?: string;
}

export type MediaCreationKind = "image" | "video";
export type MediaAspectRatio = "auto" | "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
export type MediaVideoDuration = 6 | 10;
export type MediaVideoResolution = "480p" | "720p";

export interface MediaCapabilities {
  image: boolean;
  video: boolean;
  commands: string[];
  imageCommand?: "imagine";
  videoCommand?: "imagine" | "imagine-video";
  diagnostic?: string;
}

export interface MediaCreationRequest {
  kind: MediaCreationKind;
  prompt: string;
  aspectRatio: MediaAspectRatio;
  duration?: MediaVideoDuration;
  resolution?: MediaVideoResolution;
}

export interface PromptMeta {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  reasoningTokens?: number;
  modelId?: string;
}

export interface Attachment {
  id: string;
  name: string;
  path?: string;
  mimeType?: string;
  data?: string;
  size?: number;
  kind: "file" | "image";
}

export interface ToolCallState {
  toolCallId: string;
  title: string;
  kind?: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  rawInput?: unknown;
  content?: unknown[];
  locations?: Array<{ path?: string; line?: number }>;
  command?: string;
  output?: string;
  truncated?: boolean;
  exitCode?: number | null;
  oldText?: string;
  newText?: string;
  error?: string;
}

export interface PermissionOption {
  optionId: string;
  name?: string;
  kind?: string;
}

export interface PermissionRequest {
  requestId: string | number;
  sessionId: string;
  toolCall: unknown;
  options: PermissionOption[];
}

export interface QuestionItem {
  question: string;
  header?: string;
  options?: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

export type ChatEvent =
  | { type: "session-reset"; sessionId: string }
  | { type: "session-ready"; sessionId: string; models: ModelInfo[]; currentModelId?: string; effort?: ReasoningEffort; modes?: unknown[] }
  | { type: "user-message"; sessionId: string; text: string; id?: string }
  | { type: "message-chunk"; sessionId: string; text: string }
  | { type: "thought-chunk"; sessionId: string; text: string }
  | { type: "tool-call"; sessionId: string; tool: ToolCallState }
  | { type: "permission"; sessionId: string; request: PermissionRequest }
  | { type: "question"; sessionId: string; requestId: string | number; questions: QuestionItem[] }
  | { type: "plan"; sessionId: string; requestId?: string | number; text: string }
  | { type: "media"; sessionId: string; media: "image" | "video"; source: string; isData?: boolean; mimeType?: string }
  | { type: "commands"; sessionId: string; commands: CommandInfo[] }
  | { type: "mode"; sessionId: string; mode: SessionMode | string }
  | { type: "meta"; sessionId: string; meta: PromptMeta }
  | { type: "status"; sessionId: string; status: LiveStatus; text?: string }
  | { type: "command-output"; sessionId: string; command: string; output: string; exitCode: number | null; truncated: boolean }
  | { type: "turn-completed"; sessionId: string }
  | { type: "subagent"; sessionId: string; update: { sessionUpdate?: string; subagent_id?: string; duration_ms?: number; output?: string; [key: string]: unknown } }
  | { type: "computer-state"; sessionId: string; state: ComputerTaskState }
  | { type: "computer-permission"; sessionId: string; request: ComputerAppPermissionRequest }
  | { type: "computer-risk"; sessionId: string; request: ComputerRiskConfirmation }
  | { type: "error"; sessionId?: string; message: string };

export interface CliVersionStatus {
  found: boolean;
  path?: string;
  currentVersion?: string;
  latestVersion?: string;
  channel?: string;
  updateAvailable?: boolean;
  error?: string | null;
}

export interface LoginState {
  running: boolean;
  url?: string;
  code?: string;
  message?: string;
  error?: string;
}

export interface CliUpdateRecord {
  at: string;
  from?: string;
  to?: string;
  status: "checked" | "updated" | "rolled-back" | "failed";
  message: string;
}

export interface BootstrapData {
  settings: AppSettings;
  accounts: AccountProfile[];
  sessions: SessionSummary[];
  cli: CliVersionStatus;
  login: LoginState;
  updateHistory: CliUpdateRecord[];
  appVersion: string;
  changelog: string;
  workspaces: WorkspaceSummary[];
  codexSessions: CodexSessionSummary[];
  buildInfo: BuildInfo;
  onboarding: OnboardingState;
}

export interface SendPromptInput {
  sessionId: string;
  text: string;
  attachments: Attachment[];
}

export interface GrokDesktopApi {
  bootstrap(): Promise<BootstrapData>;
  getBuildInfo(): Promise<BuildInfo>;
  getOnboarding(): Promise<OnboardingState>;
  updateOnboarding(patch: Partial<OnboardingState>): Promise<OnboardingState>;
  resetOnboarding(): Promise<OnboardingState>;
  runDiagnostics(): Promise<SystemCompatibilityReport>;
  previewSupportBundle(): Promise<SupportBundlePreview>;
  exportSupportBundle(): Promise<string | null>;
  checkAppUpdate(force?: boolean): Promise<AppReleaseStatus>;
  openAppRelease(url?: string): Promise<void>;
  chooseWorkspace(): Promise<string | null>;
  setWorkspace(cwd: string): Promise<SessionSummary[]>;
  discoverWorkspaces(force?: boolean): Promise<WorkspaceSummary[]>;
  pinWorkspace(cwd: string, pinned: boolean): Promise<WorkspaceSummary[]>;
  searchWorkspaceFiles(cwd: string, query: string, limit?: number): Promise<WorkspaceFileCandidate[]>;
  inspectAttachmentPrivacy(cwd: string, attachments: Attachment[]): Promise<AttachmentPrivacyFinding[]>;
  listSessions(cwd?: string, query?: string): Promise<SessionSummary[]>;
  createSession(cwd: string): Promise<{ sessionId: string }>;
  openSession(cwd: string, sessionId: string): Promise<{ sessionId: string }>;
  renameSession(sessionId: string, title: string): Promise<void>;
  deleteSession(cwd: string, sessionId: string): Promise<void>;
  clearSessions(cwd: string, keepSessionId?: string): Promise<void>;
  pinSession(sessionId: string, pinned: boolean): Promise<void>;
  exportSessionMarkdown(cwd: string, sessionId: string): Promise<string | null>;
  getMediaCapabilities(sessionId: string): Promise<MediaCapabilities>;
  sendPrompt(input: SendPromptInput): Promise<void>;
  cancelSession(sessionId: string): Promise<void>;
  setModel(sessionId: string, modelId: string): Promise<void>;
  setEffort(sessionId: string, effort: ReasoningEffort): Promise<void>;
  setMode(sessionId: string, mode: SessionMode): Promise<void>;
  respondPermission(sessionId: string, requestId: string | number, optionId: string): Promise<void>;
  respondQuestion(sessionId: string, requestId: string | number, answers: Record<string, string>): Promise<void>;
  respondPlan(sessionId: string, requestId: string | number | undefined, verdict: "approved" | "rejected" | "cancelled", comment?: string): Promise<void>;
  pickAttachments(): Promise<Attachment[]>;
  attachmentsFromPaths(paths: string[]): Promise<Attachment[]>;
  openPath(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  listAccounts(): Promise<AccountProfile[]>;
  loginDevice(): Promise<LoginState>;
  loginApiKey(label: string, apiKey: string): Promise<AccountProfile[]>;
  logout(): Promise<void>;
  switchAccount(accountId: string): Promise<AccountProfile[]>;
  removeAccount(accountId: string): Promise<AccountProfile[]>;
  listCodexSessions(cwd: string, includeArchived?: boolean, force?: boolean): Promise<CodexSessionSummary[]>;
  openCodexSession(id: string): Promise<CodexSessionDetail>;
  refreshCodexSession(id: string): Promise<CodexSessionDetail>;
  hideCodexSession(id: string, hidden?: boolean): Promise<void>;
  continueCodexSession(id: string): Promise<{ sessionId: string; cwd: string }>;
  getQuota(force?: boolean): Promise<GrokQuotaSnapshot>;
  getDraft(key: string): Promise<ComposerDraftState | null>;
  setDraft(key: string, text: string): Promise<void>;
  clearDraft(key: string): Promise<void>;
  listPromptHistory(cwd: string): Promise<string[]>;
  appendPromptHistory(cwd: string, text: string): Promise<void>;
  listPlugins(force?: boolean): Promise<PluginSummary[]>;
  getPluginDetails(id: string): Promise<PluginDetails>;
  previewPlugin(source: string): Promise<PluginInstallPreview>;
  pluginAction(id: string, action: "enable" | "disable" | "update" | "uninstall" | "reload"): Promise<PluginSummary[]>;
  installPlugin(source: string, trust: boolean, expectedFingerprint?: string): Promise<PluginSummary[]>;
  listMarketplace(force?: boolean): Promise<MarketplaceSource[]>;
  installMarketplacePlugin(source: string, name: string, trust: boolean): Promise<PluginSummary[]>;
  listSkills(): Promise<SkillSummary[]>;
  listMcpServers(force?: boolean): Promise<McpServerSummary[]>;
  diagnoseMcp(name?: string): Promise<McpDiagnostic[]>;
  toggleMcp(name: string, enabled: boolean): Promise<McpServerSummary[]>;
  upsertMcp(input: McpServerInput): Promise<McpServerSummary[]>;
  triggerMcpAuth(name: string): Promise<{ url?: string; code?: string; message?: string }>;
  removeMcp(name: string): Promise<McpServerSummary[]>;
  listHooks(): Promise<HookSummary[]>;
  reloadExtensions(): Promise<void>;
  scanCodexPlugins(force?: boolean): Promise<CodexPluginCompatibility[]>;
  adaptCodexPlugin(id: string): Promise<CodexPluginCompatibility[]>;
  removeCodexPluginAdapter(id: string): Promise<CodexPluginCompatibility[]>;
  getComputerCapability(): Promise<ComputerCapability>;
  listComputerApps(): Promise<ComputerApp[]>;
  listComputerWindows(appId?: string): Promise<ComputerWindow[]>;
  startComputer(input: { sessionId: string; appId: string; windowId?: string }): Promise<ComputerTaskState>;
  pauseComputer(sessionId: string): Promise<ComputerTaskState>;
  resumeComputer(sessionId: string): Promise<ComputerTaskState>;
  stopComputer(sessionId: string): Promise<ComputerTaskState>;
  respondComputerAppPermission(requestId: string, decision: "once" | "always" | "deny"): Promise<void>;
  respondComputerRisk(requestId: string, approved: boolean): Promise<void>;
  getComputerSettings(): Promise<ComputerUseSettings>;
  updateComputerSettings(patch: Partial<ComputerUseSettings>): Promise<ComputerUseSettings>;
  checkCliUpdate(): Promise<CliVersionStatus>;
  applyCliUpdate(): Promise<CliVersionStatus>;
  getCliUpdateHistory(): Promise<CliUpdateRecord[]>;
  exportLogs(): Promise<string | null>;
  onEvent(listener: (event: ChatEvent) => void): () => void;
  onLogin(listener: (state: LoginState) => void): () => void;
  onDroppedAttachments(listener: (attachments: Attachment[]) => void): () => void;
  onNavigateSession(listener: (target: { sessionId: string; cwd: string }) => void): () => void;
  onComputerStateChanged(listener: (state: ComputerTaskState) => void): () => void;
}
