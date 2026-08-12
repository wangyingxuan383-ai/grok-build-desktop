export const REASONING_EFFORTS = ["", "auto", "none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
export type SessionMode = "agent" | "plan" | "auto";
export type UiDensity = "compact" | "balanced" | "comfortable";
export type ThemeMode = "dark" | "light" | "system" | "custom";
export type ThemeBase = "dark" | "light";
export type BackgroundScope = "conversation" | "window";
export type BackgroundFit = "cover" | "contain";
export type BackgroundPosition = "center" | "top" | "bottom" | "left" | "right";

export interface ThemeColors {
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  border: string;
}

export interface ThemeSettings {
  mode: ThemeMode;
  customBase: ThemeBase;
  colors: ThemeColors;
  background: {
    enabled: boolean;
    scope: BackgroundScope;
    fit: BackgroundFit;
    position: BackgroundPosition;
    opacity: number;
    blur: number;
    dim: number;
  };
}

export interface ComposerCapabilitySelection {
  kind: "computer" | "skill";
  label: string;
  command: string;
  source?: string;
}

export type AppMenuCommand =
  | "new-session" | "choose-workspace" | "add-attachment" | "export-session"
  | "search-sessions" | "search-conversation" | "focus-composer" | "stop-generation" | "copy-final-answer"
  | "toggle-sidebar" | "open-accounts" | "open-media" | "open-extensions" | "open-computer"
  | "open-settings" | "open-diagnostics" | "open-onboarding" | "open-about" | "open-task-center" | "open-feedback";

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

/**
 * One file the agent actually wrote, with the before/after text the ACP tool
 * call carried. Not a git substitute: it records what the agent did, which is
 * also more faithful than `git status` for a file that was edited and then
 * reverted, or one that has already been committed.
 */
export interface AgentFileChange {
  id: string;
  path: string;
  absolutePath: string;
  toolCallId: string;
  at: string;
  status: "applied" | "failed";
  turnId?: string;
  before?: string;
  after?: string;
  beforeTruncated?: boolean;
  afterTruncated?: boolean;
  /** Exact when derived from an ACP diff block; otherwise omitted. */
  additions?: number;
  deletions?: number;
  /** `missing-before` and `none` must be shown as such rather than diffed against "". */
  baseline?: "captured" | "missing-before" | "none";
}

export interface AgentChangeIndex {
  cwd: string;
  scope: "last-turn" | "session";
  files: AgentFileChange[];
  createdAt: string;
}

/**
 * Token totals for one period. Every number is a sum of what the CLI or
 * provider actually reported — nothing is estimated. `turns` vs `turnsWithUsage`
 * is the coverage: failed and cancelled turns report no usage at all, so a
 * period can contain real work that no total can account for.
 */
export interface TokenActivityWindow {
  from: string;
  turns: number;
  turnsWithUsage: number;
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface TokenDayBucket {
  day: string;
  turns: number;
  turnsWithUsage: number;
  totalTokens: number;
}

export interface TokenActivityQuery {
  modelId?: string;
  providerId?: string;
  workspace?: string;
}

export interface TokenActivityReport {
  generatedAt: string;
  windows: {
    rolling24h: TokenActivityWindow;
    today: TokenActivityWindow;
    rolling7d: TokenActivityWindow;
    rolling30d: TokenActivityWindow;
    month: TokenActivityWindow;
  };
  days: TokenDayBucket[];
  models: string[];
  workspaces: string[];
}

/**
 * A diagnosis scoped to one failed turn. The static install sweep answers
 * "is my install healthy"; this answers "why did THIS request fail".
 */
export interface FailureDiagnosisReport {
  failure: TurnFailure;
  generatedAt: string;
  headline: string;
  items: SystemDiagnosticItem[];
  actions: string[];
}

export interface SystemCompatibilityReport {
  checkedAt: string;
  overall: "ready" | "limited" | "blocked";
  items: SystemDiagnosticItem[];
  cliPath?: string;
  cliVersion?: string;
  effortFlag?: "--effort" | "--reasoning-effort";
}

export interface GrokDoctorFixCandidate {
  id: string;
  message: string;
  note?: string;
}

export interface GrokDoctorFixPreview {
  generatedAt: string;
  fixes: GrokDoctorFixCandidate[];
  confirmationToken?: string;
  message: string;
}

export interface GrokDoctorFixReceipt {
  id: string;
  applied: boolean;
  completedAt: string;
  message: string;
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
  currentAhead?: boolean;
  checkedAt: string;
  publishedAt?: string;
  releaseUrl?: string;
  notes?: string;
  error?: string;
}

export interface AutomaticUpdateCheckResult {
  checked: boolean;
  checkedAt?: string;
  nextCheckAt?: string;
  reason?: "disabled" | "throttled" | "checked";
  cli?: CliVersionStatus;
  app?: AppReleaseStatus;
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
  /** Check the CLI stable channel and the Desktop GitHub Release on startup, then at most once per 24 hours. */
  automaticUpdateChecks?: boolean;
  /** Main-process maintained timestamp used to throttle automatic checks. */
  lastAutomaticUpdateCheckAt?: string;
  fontScale: number;
  uiDensity: UiDensity;
  /** Conversation-only reading width. It must not resize workbenches or dialogs. */
  conversationContentWidth?: number;
  /** Conversation-only font scale. Shell/navigation text remains governed by fontScale. */
  conversationFontScale?: number;
  recentWorkspaces: string[];
  activeWorkspace: string;
  codexGroupCollapsed?: boolean;
  claudeGroupCollapsed?: boolean;
  /** The 开发工具 section resets to collapsed on every launch without this. */
  projectToolsOpen?: boolean;
  sessionGroupCollapsed?: Partial<Record<SessionOriginKind, boolean>>;
  showArchivedCodex?: boolean;
  theme: ThemeSettings;
}

export type ProviderProtocol = "chat_completions" | "responses" | "messages";
export type ProviderUpstreamProtocol = "openai_chat" | "openai_responses" | "anthropic_messages" | "gemini_generate_content" | "compatible_passthrough";
export type ProviderSchemaProfile = "standard" | "gemini" | "strict";
export type ProviderAuthScheme = "bearer" | "x_api_key";
export type ProviderProxyMode = "inherit" | "direct";
export type ProviderCompatibilityFlavor = "auto" | "cliproxyapi" | "grok2api" | "sub2api" | "new-api" | "generic";
export type ProviderCapabilityEvidenceSource = "manual" | "model_metadata" | "live_probe" | "compatibility_profile";
export type ProviderCapabilityVerification = "unknown" | "request_accepted" | "response_confirmed" | "mapped" | "capped" | "rejected";
export type ProviderReasoningMode = "effort_enum" | "budget_tokens" | "adaptive" | "model_suffix" | "fixed" | "unsupported";

export interface ProviderReasoningTransport {
  mode: ProviderReasoningMode;
  efforts: Exclude<ReasoningEffort, "">[];
  budgetByEffort?: Partial<Record<Exclude<ReasoningEffort, "">, number>>;
  suffixByEffort?: Partial<Record<Exclude<ReasoningEffort, "">, string>>;
  fixedEffort?: Exclude<ReasoningEffort, "">;
  source: ProviderCapabilityEvidenceSource;
}

export interface ProviderProtocolCapability {
  protocol: ProviderProtocol;
  available: boolean;
  nonStreaming: boolean;
  streaming: boolean;
  tools: boolean;
  toolContinuation: boolean;
  imageInput: boolean;
  imageGeneration: boolean;
  imageEditing: boolean;
  videoGeneration?: boolean;
  usage: boolean;
  verification: ProviderCapabilityVerification;
  checkedAt?: string;
  latencyMs?: number;
  status?: number;
  returnedModel?: string;
  message?: string;
  reasoning?: ProviderReasoningTransport;
  context?: ProviderContextProbeResult;
}

export interface ProviderModelCapabilityProfile {
  modelId: string;
  protocols: Partial<Record<ProviderProtocol, ProviderProtocolCapability>>;
  returnedModelIds?: string[];
  checkedAt?: string;
  source: ProviderCapabilityEvidenceSource;
}

export interface ProviderCapabilitySnapshot {
  providerId: string;
  checkedAt: string;
  modelListHash: string;
  serverFlavor: ProviderCompatibilityFlavor;
  models: ProviderModelCapabilityProfile[];
  expired: boolean;
}

export interface ProviderDeepScanOptions {
  modelIds?: string[];
  protocols?: ProviderProtocol[];
  includeReasoning?: boolean;
  includeTools?: boolean;
  includeImages?: boolean;
  context?: ProviderContextProbeOptions;
}

export type ProviderContextProbeMode = "off" | "safe" | "exact";

export interface ProviderContextProbeOptions {
  mode: ProviderContextProbeMode;
  /** Requested lower bound for safe mode, or the search ceiling for exact mode. */
  targetTokens?: number;
  maxRequests?: number;
  confirmedCost?: boolean;
}

export interface ProviderContextProbeResult {
  mode: Exclude<ProviderContextProbeMode, "off">;
  verification: ProviderCapabilityVerification;
  declaredTokens?: number;
  verifiedAtLeastTokens?: number;
  acceptedTokens?: number;
  rejectedTokens?: number;
  acceptedCharacters?: number;
  rejectedCharacters?: number;
  verifiedCharacters?: number;
  exactUsage: boolean;
  requests: number;
  checkedAt: string;
  message?: string;
}

export type ProviderScanStage =
  | "preparing"
  | "metadata"
  | "baseline"
  | "stream"
  | "usage"
  | "tool"
  | "tool-continuation"
  | "image"
  | "video"
  | "reasoning"
  | "context"
  | "saving"
  | "complete";

export type ProviderScanJobStatus = "queued" | "running" | "cancelling" | "completed" | "cancelled" | "failed";

export interface ProviderScanScope extends ProviderDeepScanOptions {
  providerId: string;
}

export interface ProviderScanProgress {
  jobId: string;
  providerId: string;
  status: ProviderScanJobStatus;
  stage: ProviderScanStage;
  completed: number;
  total: number;
  succeeded: number;
  failed: number;
  modelId?: string;
  protocol?: ProviderProtocol;
  effort?: Exclude<ReasoningEffort, "">;
  message: string;
  startedAt: string;
  updatedAt: string;
}

export interface ProviderScanJob extends ProviderScanProgress {
  /** Monotonic per-provider generation used to reject late responses from cancelled jobs. */
  generation: number;
  scope: ProviderScanScope;
  completedAt?: string;
  result?: ProviderDeepScanResult;
  error?: string;
}

export interface CapabilityApplicationSelection {
  reasoning?: boolean;
  context?: boolean;
  capabilities?: boolean;
  aliases?: boolean;
  compatibilityFlavor?: boolean;
  protocolsByModel?: Record<string, ProviderProtocol>;
}

export interface CapabilityApplicationDraft {
  providerId: string;
  checkedAt: string;
  expired: boolean;
  changes: Array<{
    id: string;
    modelId?: string;
    kind: "protocol" | "reasoning" | "context" | "capabilities" | "aliases" | "compatibility";
    label: string;
    before?: string;
    after: string;
    selectedByDefault: boolean;
    evidenceSource: ProviderCapabilityEvidenceSource;
    checkedAt?: string;
    expired: boolean;
  }>;
}

export interface ProviderDeepScanResult {
  providerId: string;
  startedAt: string;
  completedAt: string;
  cancelled: boolean;
  completed: number;
  total: number;
  snapshot: ProviderCapabilitySnapshot;
  warnings: string[];
}

export interface ProviderModelDefinition {
  enabled?: boolean;
  id: string;
  model: string;
  name: string;
  description?: string;
  protocol?: ProviderProtocol;
  contextWindow?: number;
  maxCompletionTokens?: number;
  /** Seconds without an inference stream event before Grok CLI cancels it. */
  inferenceIdleTimeoutSeconds?: number;
  reasoningEfforts?: ReasoningEffort[];
  upstreamProtocol?: ProviderUpstreamProtocol;
  reasoning?: Partial<Record<ProviderProtocol | ProviderUpstreamProtocol, ProviderReasoningTransport>>;
  /** User-applied aliases observed in live responses; kept as local evidence, not sent upstream. */
  returnedModelAliases?: string[];
  media?: ProviderModelMediaConfiguration;
  capabilities?: ProviderModelCapabilityProfile;
}

export type ProviderImageTransport = "openai_images" | "openai_responses_image" | "gemini_generate_content";
export type ProviderVideoTransport = "compatible_video";

export interface ProviderModelMediaConfiguration {
  image?: {
    transport: ProviderImageTransport;
    /** Relative to Provider baseUrl, or an absolute URL on the same origin. */
    endpoint?: string;
  };
  video?: {
    transport: ProviderVideoTransport;
    /** Required explicit endpoint; the Desktop never guesses a video route. */
    endpoint: string;
  };
}

export interface ProviderHeaderInput {
  name: string;
  source: "environment";
  value: string;
}

export interface CustomProviderProfile {
  enabled?: boolean;
  id: string;
  name: string;
  baseUrl: string;
  modelListUrl?: string;
  protocol: ProviderProtocol;
  upstreamProtocol?: ProviderUpstreamProtocol;
  schemaProfile?: ProviderSchemaProfile;
  compatibilityFlavor?: ProviderCompatibilityFlavor;
  /** Whether desktop requests inherit the app proxy or bypass it. */
  proxyMode?: ProviderProxyMode;
  authScheme: ProviderAuthScheme;
  credentialMode: "managed" | "existing" | "none";
  credentialEnv?: string;
  extraHeaders: Record<string, string>;
  models: ProviderModelDefinition[];
  owned: boolean;
  hasCredential: boolean;
  insecureHttp: boolean;
  createdAt: string;
  updatedAt: string;
  diagnostic?: string;
}

export interface CustomProviderInput extends Omit<CustomProviderProfile, "owned" | "hasCredential" | "insecureHttp" | "createdAt" | "updatedAt" | "diagnostic"> {
  credentialValue?: string;
  allowInsecureHttp?: boolean;
}

export interface ProviderConnectionDraft extends Omit<CustomProviderInput, "models" | "extraHeaders"> {
  models?: ProviderModelDefinition[];
  headers: ProviderHeaderInput[];
}

export interface ProviderModelCandidate {
  remoteId: string;
  localId: string;
  name: string;
  description?: string;
  ownedBy?: string;
  contextWindow?: number;
  reasoningEfforts?: ReasoningEffort[];
  capabilities?: ProviderModelCapabilityProfile;
  alreadyConfigured: boolean;
}

export interface ProviderDraftProbeResult extends ProviderConnectivityResult {
  endpoint: string;
  warnings: string[];
  candidates: ProviderModelCandidate[];
}

export interface ProviderConnectivityResult {
  ok: boolean;
  checkedAt: string;
  latencyMs: number;
  status?: number;
  message: string;
  models: Array<{ id: string; name?: string }>;
}

export type AutomationSchedule =
  | { kind: "once"; at: string }
  | { kind: "daily"; time: string }
  | { kind: "weekly"; time: string; days: number[] }
  | { kind: "interval"; minutes: number };

export type ScheduledPermissionPolicy = "auto" | "agent" | "read-only";
export type AutomationContextPolicy = "reuse" | "fresh";

export interface AutomationExecutionProfile {
  accountId?: string;
  providerId?: string;
  modelId: string;
  effort: ReasoningEffort;
  mode: SessionMode;
  permissionPolicy: ScheduledPermissionPolicy;
  computerEnabled: boolean;
}

export interface AutomationTask {
  id: string;
  name: string;
  workspace: string;
  schedule: AutomationSchedule;
  profile: AutomationExecutionProfile;
  executionProfileId?: string;
  enabled: boolean;
  wakeToRun: boolean;
  notify: boolean;
  missedRunPolicy: "run-once" | "skip";
  skillCommand?: string;
  contextPolicy: AutomationContextPolicy;
  sessionId?: string;
  promptPresent: boolean;
  registrationStatus: "registered" | "needs-repair" | "needs-config" | "unsupported" | "error";
  registrationError?: string;
  registrationDiagnostic?: AutomationRegistrationDiagnostic;
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRegistrationDiagnostic {
  operation: "register" | "unregister";
  exitCode?: number;
  code: "scheduler-command-failed" | "scheduler-unavailable" | "historical-encoding-damaged";
  message: string;
  repairable: boolean;
}

export interface AutomationTaskInput extends Omit<AutomationTask, "id" | "sessionId" | "promptPresent" | "registrationStatus" | "registrationError" | "registrationDiagnostic" | "nextRunAt" | "createdAt" | "updatedAt"> {
  id?: string;
  prompt?: string;
}

export interface AutomationGlobalPolicy {
  defaultProfile: AutomationExecutionProfile;
  maxConcurrentRuns: number;
  confirmationTimeoutMinutes: number;
  /** Zero disables automatic cancellation; otherwise only genuine ACP inactivity is measured. */
  inactivityTimeoutMinutes: number;
  notifyOnSuccess: boolean;
  notifyOnFailure: boolean;
}

export interface AutomationRunRecord {
  id: string;
  taskId: string;
  status: "queued" | "running" | "awaiting-confirmation" | "completed" | "failed" | "cancelled" | "skipped";
  scheduledAt: string;
  startedAt?: string;
  finishedAt?: string;
  sessionId?: string;
  error?: string;
}

export interface AutomationPendingConfirmation {
  id: string;
  taskId: string;
  runId: string;
  category: ComputerRiskCategory | "tool-permission";
  summary: string;
  expiresAt: string;
}

export interface PromptQueueEntry {
  id: string;
  sessionId: string;
  text: string;
  position: number;
  createdAt: string;
  state: "queued" | "interjected" | "sending" | "accepted" | "completed" | "failed" | "cancelled";
  /** Server-owned optimistic-concurrency version from x.ai/queue/changed. */
  version?: number;
  owner?: string;
  lastEditor?: string;
  kind?: string;
  clientMessageId?: string;
  attachmentPreviews?: UserMessageAttachmentPreview[];
}

/** Durable per-session execution choices. Global defaults are used only when a session is created. */
export interface SessionRuntimePreferences {
  sessionId: string;
  cwd: string;
  modelId?: string;
  providerId?: string;
  effort: ReasoningEffort;
  mode: SessionMode;
  profileId?: string;
  /** Session compaction behavior. The CLI remains authoritative when omitted or set to inherit. */
  compaction?: SessionCompactionPolicy;
  updatedAt: string;
}

export interface SessionCompactionPolicy {
  mode: "inherit" | "custom";
  /** Custom auto-compaction threshold, constrained to 60-95. */
  thresholdPercent?: number;
}

/** Queue ownership survives a Desktop/CLI restart and is reconciled with the CLI queue by stable IDs. */
export interface PersistedPromptQueue {
  version: 1;
  sessionId: string;
  updatedAt: string;
  entries: PromptQueueEntry[];
  terminalEntries?: PromptQueueEntry[];
}

/** Main-process-only context used to bind one CLI process to its selected managed Provider route. */
export interface ProviderLaunchContext {
  scopeId: string;
  sessionId?: string;
  cwd: string;
  /** Stable Desktop/provider configuration id. Never replace this with an upstream alias. */
  localModelId?: string;
  /** Model id passed to the CLI. For managed models this is normally the same local config id. */
  modelId?: string;
  providerId?: string;
}

export interface QueueOperationReceipt {
  operationId: string;
  entryId?: string;
  state: "queued" | "interjected" | "updated" | "removed" | "reordered" | "cleared";
  message: string;
  fallback?: boolean;
  /**
   * Queue edit/remove/reorder commands are private one-way CLI extensions.
   * `transport` means the JSON-RPC notification was written successfully;
   * `cli` is reserved for an authoritative x.ai/queue/changed acknowledgement.
   */
  acknowledgement?: "transport" | "cli";
}

export interface PlanDecisionReceipt {
  requestId: string;
  verdict: "approved" | "rejected" | "cancelled";
  state: "accepted" | "duplicate";
  message: string;
}

export interface BackgroundTaskSummary {
  id: string;
  sessionId?: string;
  kind: "queue" | "command" | "monitor" | "subagent" | "loop" | "automation";
  title: string;
  status: "queued" | "running" | "needs-user" | "completed" | "failed" | "cancelled";
  updatedAt: string;
  detail?: string;
}

export interface RewindPoint {
  id: string;
  label: string;
  createdAt?: string;
  userMessage?: string;
  filesChanged?: number;
}

export interface SessionForkResult {
  sessionId: string;
  parentSessionId: string;
  cwd: string;
  profileId?: string;
  worktreeId?: string;
}

export interface SessionRebindReceipt extends SessionForkResult {
  sourceCwd: string;
  targetCwd: string;
  method: "official-move" | "official-fork" | "desktop-copy";
  codeRestored: false;
  localProjectionCopied: boolean;
  attachmentLedgerCopied: boolean;
  mediaCacheCopied: boolean;
  completedAt: string;
}

export interface WorkspaceRebindReceipt {
  sourceCwd: string;
  targetCwd: string;
  completed: SessionRebindReceipt[];
  failures: Array<{ sessionId: string; message: string }>;
}

export interface NotificationInboxItem {
  id: string;
  kind: "completion" | "failure" | "confirmation" | "info";
  title: string;
  detail?: string;
  sessionId?: string;
  taskId?: string;
  automationRunId?: string;
  read: boolean;
  createdAt: string;
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

export type LiveStatus = "idle" | "working" | "needs-user" | "queued" | "unread" | "error" | "cold";
export type SessionOriginKind = "normal" | "fork" | "worktree" | "codex-continuation" | "claude-continuation" | "automation" | "other";

export interface SessionSummary {
  id: string;
  cwd: string;
  title: string;
  /** CLI-produced previous-turn recap; never inferred from message count. */
  preview?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  modelId?: string;
  effort?: string;
  status: LiveStatus;
  pinned?: boolean;
  archived?: boolean;
  parentSessionId?: string;
  originKind?: SessionOriginKind;
  originId?: string;
  originTitle?: string;
  executionProfileId?: string;
  worktreeId?: string;
}

export type WorkspaceSource = "pinned" | "recent" | "grok" | "codex" | "claude";

export interface ProjectIdentity {
  id: string;
  displayPath: string;
  canonicalPath: string;
  comparisonPath: string;
  name: string;
  exists: boolean;
  diagnostic?: string;
}

export interface WorkspaceSummary {
  projectId: string;
  cwd: string;
  displayPath: string;
  canonicalPath: string;
  name: string;
  exists: boolean;
  hidden: boolean;
  pinned: boolean;
  sources: WorkspaceSource[];
  lastUsedAt?: string;
  grokSessions: number;
  codexSessions: number;
  claudeSessions: number;
  draftCount: number;
  activeSessions: number;
  diagnostic?: string;
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

export interface ClaudeSessionSummary {
  id: string;
  path: string;
  cwd: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  hidden: boolean;
  source?: string;
  origin?: string;
  model?: string;
}

export interface ClaudeTurn {
  role: "user" | "assistant" | "tool" | "thought";
  text: string;
  toolCalls?: unknown[];
  toolResults?: unknown[];
  inert?: boolean;
}

export interface ClaudeSessionDetail extends ClaudeSessionSummary {
  turns: ClaudeTurn[];
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
  summary: { files: number; additions: number; deletions: number; commands: number; tools: number; subagents: number; failed: number };
}

export interface QuotaWindow {
  label: string;
  used?: number;
  limit?: number;
  remaining?: number;
  unit: "credits" | "usd" | "percent" | "tokens";
  periodStart?: string;
  periodEnd?: string;
  resetAt?: string;
  products?: Array<{ label: string; usedPercent?: number }>;
  source?: "billing-api" | "cli-error";
  observedAt?: string;
  modelId?: string;
  expired?: boolean;
}

export interface GrokQuotaSnapshot {
  accountId?: string;
  supported: boolean;
  fetchedAt: string;
  stale: boolean;
  partial: boolean;
  rolling24h?: QuotaWindow;
  weekly?: QuotaWindow;
  monthly?: QuotaWindow;
  onDemand?: QuotaWindow;
  prepaidBalance?: number;
  diagnostics: string[];
}

export interface ComposerDraftState {
  key: string;
  text: string;
  capability?: ComposerCapabilitySelection;
  attachments?: Attachment[];
  newTask?: NewTaskDraft;
  updatedAt: string;
}

export interface NewTaskDraft {
  projectId: string;
  workspacePath: string;
  profileId?: string;
  worktreeName?: string;
  worktreeRef?: string;
  modelId?: string;
  providerId?: string;
  effort?: ReasoningEffort;
  mode?: SessionMode;
}

export type SessionHydrationState = "local" | "connecting" | "synchronizing" | "ready" | "offline" | "failed";

export interface SessionPreviewSnapshot {
  sessionId: string;
  title: string;
  lastActivityAt?: string;
  visibleSummary: string;
  status: LiveStatus;
  modelId?: string;
  attachmentCount: number;
  projectionUpdatedAt?: string;
  projection?: ConversationProjection;
  presentations: TurnPresentation[];
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
  /** `elevated` is a permanent Windows integrity boundary; `blocklist` is our own policy. */
  blockedCode?: "elevated" | "blocklist";
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
  /** `elevated` is a permanent Windows integrity boundary; `blocklist` is our own policy. */
  blockedCode?: "elevated" | "blocklist";
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
  /**
   * Why the user is being asked to intervene. `uac-handoff` is transient and
   * resuming is meaningful; `elevation-blocked` is permanent and resuming can
   * never succeed, so offering the same button for both traps the user in a
   * loop against an unfixable target.
   */
  interventionKind?: "uac-handoff" | "elevation-blocked";
  /** Short cause, rendered in the headline slot so a nowrap strip cannot clip it away. */
  headline?: string;
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
  supportsReasoningEffort?: boolean;
  reasoningEfforts?: Array<{
    value: Exclude<ReasoningEffort, "">;
    label: string;
    description?: string;
    default?: boolean;
  }>;
}

export interface CommandInfo {
  name: string;
  description?: string;
  inputHint?: string;
}

export type MediaCreationKind = "image" | "video";
export type MediaRouteKind = "auto" | "cli" | "provider";
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
  sessionId?: string;
  route?: MediaRouteKind;
  providerId?: string;
  modelId?: string;
  referencePaths?: string[];
}

export interface MediaArtifact {
  id: string;
  media: MediaCreationKind;
  source: string;
  mimeType?: string;
  isData?: boolean;
  name?: string;
}

/** Opaque, session-bound access to a cached media file. Local paths stay in main. */
export interface MediaAccessHandle {
  id: string;
  sessionId: string;
  media: MediaCreationKind;
  mimeType: string;
  name: string;
  url: string;
}

export interface MediaGenerationJob {
  jobId: string;
  sessionId: string;
  status: "queued" | "running" | "cancelling" | "completed" | "cancelled" | "failed";
  route: Exclude<MediaRouteKind, "auto">;
  kind: MediaCreationKind;
  progress?: number;
  message: string;
  artifacts: MediaArtifact[];
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
}

export interface OpenTargetIntent {
  target: string;
  sessionId?: string;
  executionRoot?: string;
  action?: "open" | "reveal" | "copy-path" | "open-with";
  applicationId?: ExternalOpenToolId;
  line?: number;
  column?: number;
}

export type ExternalOpenToolId = "explorer" | "vscode" | "cursor" | "notepad" | "terminal" | "codex-cli";

export interface ExternalOpenTool {
  id: ExternalOpenToolId;
  label: string;
  detail: string;
  targetKinds: Array<"file" | "directory">;
  supportsPosition: boolean;
}

export interface OpenTargetResult {
  ok: boolean;
  target: string;
  kind: "directory" | "file" | "image" | "video" | "missing";
  action: NonNullable<OpenTargetIntent["action"]>;
  message: string;
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
  kind: "file" | "image" | "folder";
  /** Local-only composer draft metadata; never interpreted by the Provider. */
  draftText?: boolean;
  previewText?: string;
}

export type UserMessageDeliveryState = "sending" | "queued" | "sent" | "failed";

export interface UserMessageAttachmentPreview {
  id: string;
  name: string;
  kind: Attachment["kind"];
  mimeType?: string;
  size?: number;
  source?: string;
  isData?: boolean;
  availability: "ready" | "missing";
}

export interface UserMessageAttachmentRestore {
  clientMessageId: string;
  text: string;
  attachments: UserMessageAttachmentPreview[];
  delivery: UserMessageDeliveryState;
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
  additions?: number;
  deletions?: number;
  error?: string;
}

export type TurnOutcome = "completed" | "failed" | "cancelled";

export interface TurnPresentation {
  turnId: string;
  ordinal: number;
  clientMessageId?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  outcome?: TurnOutcome;
  usage?: TurnUsage;
}

export interface TurnUsage extends PromptMeta {
  providerId?: string;
  source: "acp-turn" | "prompt-result" | "history";
  exact: true;
}

/**
 * What kind of failure this was, which is what decides the useful next action.
 * A quota wall, a rejected tool schema and an expired credential all surface as
 * "the request failed" today even though nothing about the remedy is shared.
 */
export type TurnFailureClass =
  | "quota-exhausted"
  | "schema-rejected"
  | "auth-expired"
  | "provider-error"
  | "network"
  | "cli-crashed"
  | "cancelled"
  | "unknown";

/**
 * Identity and context for one failed turn. Without this the renderer receives
 * only a free-text string, so nothing downstream can tell which provider,
 * model or request failed — which is why the diagnostics centre could not be
 * connected to a failure and reported an all-green install instead.
 */
export interface TurnFailure {
  failureId: string;
  at: string;
  classification: TurnFailureClass;
  /** Already redacted in the main process before it crosses the bridge. */
  message: string;
  sessionId?: string;
  turnId?: string;
  modelId?: string;
  providerId?: string;
  jsonRpcCode?: number;
  httpStatus?: number;
  traceId?: string;
  retryAfter?: string;
  gatewayPhase?: "pre-send" | "upstream" | "response";
  gatewayReason?: "gateway-timeout" | "downstream-request-aborted" | "downstream-response-closed" | "upstream-connect" | "upstream-stream" | "request-validation" | "upstream-http";
  gatewayProxyMode?: ProviderProxyMode;
  gatewayRequestId?: string;
  gatewayElapsedMs?: number;
  /** How many tool-schema values the compatibility gateway rewrote for this provider. */
  sanitizedCount?: number;
  processExitCode?: number;
  cancelled?: boolean;
  /** Opaque process-local gateway scope used only to correlate one CLI process. */
  gatewayScopeId?: string;
  /** Short, class-specific things the user can actually do. */
  nextActions?: string[];
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

export interface ConversationProjection {
  version: 1 | 2;
  sessionId: string;
  updatedAt: string;
  /** Persisted ChatEvent records. Kept structurally loose to avoid a recursive union. */
  events: Array<Record<string, unknown>>;
  runtime?: SessionRuntimePreferences;
  queue?: PersistedPromptQueue;
}

export type ChatEvent =
  | { type: "session-reset"; sessionId: string }
  | { type: "session-hydration"; sessionId: string; state: SessionHydrationState; generation: number; message?: string }
  | { type: "conversation-projection-restore"; sessionId: string; projection: ConversationProjection }
  | { type: "history-recovery"; sessionId: string; status: "recovered" | "unavailable"; message: string }
  | { type: "session-ready"; sessionId: string; models: ModelInfo[]; currentModelId?: string; effort?: ReasoningEffort; modes?: unknown[] }
  | { type: "user-message"; sessionId: string; text: string; id?: string; clientMessageId?: string; attachments?: UserMessageAttachmentPreview[]; delivery?: UserMessageDeliveryState }
  | { type: "user-message-status"; sessionId: string; clientMessageId: string; delivery: UserMessageDeliveryState }
  | { type: "user-attachments-restore"; sessionId: string; entries: UserMessageAttachmentRestore[] }
  | { type: "message-chunk"; sessionId: string; text: string }
  | { type: "thought-chunk"; sessionId: string; text: string }
  | { type: "tool-call"; sessionId: string; tool: ToolCallState }
  | { type: "permission"; sessionId: string; request: PermissionRequest }
  | { type: "question"; sessionId: string; requestId: string | number; questions: QuestionItem[] }
  | { type: "plan"; sessionId: string; requestId?: string | number; text: string }
  | { type: "interaction-resolved"; sessionId: string; interaction: "permission" | "question" | "plan"; requestId: string | number; outcome?: string }
  | { type: "media"; sessionId: string; media: "image" | "video"; source: string; isData?: boolean; mimeType?: string }
  | { type: "commands"; sessionId: string; commands: CommandInfo[] }
  | { type: "mode"; sessionId: string; mode: SessionMode | string }
  | { type: "meta"; sessionId: string; meta: PromptMeta }
  | { type: "status"; sessionId: string; status: LiveStatus; text?: string }
  | { type: "command-output"; sessionId: string; command: string; output: string; exitCode: number | null; truncated: boolean }
  | { type: "turn-started"; sessionId: string; presentation: TurnPresentation }
  | { type: "turn-completed"; sessionId: string; presentation?: TurnPresentation }
  | { type: "turn-retry"; sessionId: string; attempt?: number; maxAttempts?: number; delayMs?: number; reason?: string }
  | { type: "compact-status"; sessionId: string; status: "started" | "completed" | "failed" | "cancelled"; trigger?: "automatic" | "manual" | "unknown"; beforeTokens?: number; afterTokens?: number; message?: string }
  | { type: "session-recap"; sessionId: string; turnId?: string; text: string; contentHash: string }
  | { type: "session-title"; sessionId: string; title: string; manual: boolean }
  | { type: "follow-ups"; sessionId: string; responseId?: string; promptId?: string; suggestions: Array<{ id: string; text: string }> }
  | { type: "runtime-update"; sessionId: string; update: CliRuntimeUpdate }
  | { type: "turn-presentations-restore"; sessionId: string; presentations: TurnPresentation[] }
  | { type: "subagent"; sessionId: string; update: { sessionUpdate?: string; subagent_id?: string; duration_ms?: number; output?: string; [key: string]: unknown } }
  | { type: "computer-state"; sessionId: string; state: ComputerTaskState }
  | { type: "computer-permission"; sessionId: string; request: ComputerAppPermissionRequest }
  | { type: "computer-risk"; sessionId: string; request: ComputerRiskConfirmation }
  | { type: "prompt-queue"; sessionId: string; entries: PromptQueueEntry[] }
  | { type: "error"; sessionId?: string; message: string; failure?: TurnFailure };

export interface CliVersionStatus {
  found: boolean;
  path?: string;
  currentVersion?: string;
  latestVersion?: string;
  channel?: string;
  installer?: string;
  autoUpdate?: boolean;
  checkedAt?: string;
  changelogUrl?: string;
  publicLatestVersion?: string;
  distributionState?: "current" | "stable-update" | "public-ahead" | "error";
  /** True when the stable channel crosses a semantic major-version boundary. */
  majorUpgrade?: boolean;
  updateAvailable?: boolean;
  error?: string | null;
}

export type CliCapabilityEvidenceSource = "runtime-declaration" | "successful-probe" | "observed-event" | "version-hint";

export interface CliCapabilityEvidence {
  name: string;
  state: "supported" | "unsupported" | "unknown";
  source: CliCapabilityEvidenceSource;
  observedAt: string;
  reason?: string;
}

export interface CliRuntimeHandshake {
  protocolVersion: number;
  agentVersion?: string;
  checkedAt: string;
  promptCapabilities?: Record<string, boolean>;
  sessionCapabilities?: Record<string, boolean>;
  mcpCapabilities?: Record<string, boolean>;
  currentModelId?: string;
  models: Array<{ modelId: string; name?: string; reasoningEfforts?: ReasoningEffort[] }>;
  commands: string[];
  extensions: string[];
  features: {
    recap: boolean;
    rewind: boolean;
    cancelRewind: boolean;
    pluginDirectories: boolean;
    fsNotifications: boolean;
    voiceMode: boolean;
  };
}

export interface SessionAttachPolicy {
  /** Desktop renders permission, question, and Plan requests and is therefore interactive. */
  nonInteractive: false;
  /** Assistant text is visible in Desktop; delivery does not need an MCP hand-off tool. */
  deliveryTools: string[];
}

/** Grok Build 1.0 wire outcomes are `closed`, `notResident` and
 * `superseded`. `released-without-close` is a Desktop-only fallback when the
 * ACP request could not complete before the process was released. */
export type SessionCloseOutcome = "closed" | "not-resident" | "superseded" | "released-without-close" | "unknown";

export interface SessionCloseReceipt {
  sessionId: string;
  outcome: SessionCloseOutcome;
  rawOutcome?: string;
  completed: boolean;
  at: string;
  message?: string;
}

export interface SessionCompactReceipt {
  sessionId: string;
  accepted: boolean;
  source: "extension" | "slash-command" | "unsupported";
  startedAt: string;
  completedAt?: string;
  beforeTokens?: number;
  afterTokens?: number;
  message: string;
}

export interface OfficialFeedbackCapability {
  available: boolean;
  sessionId?: string;
  source: "available-command" | "unavailable";
  reason?: string;
}

export interface OfficialFeedbackPreview {
  originalLength: number;
  preview: string;
  redacted: boolean;
}

export interface OfficialFeedbackReceipt {
  sessionId: string;
  submitted: boolean;
  message: string;
}

export interface RuntimeEventEnvelope {
  rawMethod: string;
  method: string;
  schemaVersion: string;
  sourceSessionId?: string;
  receivedAt: string;
  payload: Record<string, unknown>;
}

export interface CliCompatibilityCheck {
  id: string;
  label: string;
  status: "passed" | "failed" | "pending" | "unsupported";
  source: "fixture" | "runtime" | "live";
  message?: string;
}

export interface CliMajorCompatibilityProfile {
  major: number;
  targetVersion: string;
  label: string;
  requiredChecks: string[];
  changelogUrl: string;
}

export interface CliV1RuntimeSnapshot {
  version: string;
  observedAt: string;
  attachPolicy: SessionAttachPolicy;
  closeOutcomeSupported: boolean;
  mcpMethods: string[];
  gitStatusUsesExplicitOptions: boolean;
  dataViews: Array<"context" | "usage" | "session-info">;
}

export interface CliCompatibilityGate {
  targetVersion: string;
  major: number;
  status: "passed" | "failed" | "pending";
  checkedAt: string;
  checks: CliCompatibilityCheck[];
  liveVerified: boolean;
}

export interface CliCompatibilityReceipt {
  targetVersion: string;
  accepted: boolean;
  gate: CliCompatibilityGate;
  message: string;
}

export interface CliCompatibilitySnapshot {
  cliVersion?: string;
  checkedAt: string;
  handshake?: CliRuntimeHandshake;
  capabilities: CliCapabilityEvidence[];
  majorProfile?: CliMajorCompatibilityProfile;
  v1?: CliV1RuntimeSnapshot;
  gate?: CliCompatibilityGate;
}

export interface CliUpdatePreview {
  fromVersion: string;
  targetVersion: string;
  channel?: string;
  installer?: string;
  autoUpdate?: boolean;
  changelogUrl: string;
  publicLatestVersion?: string;
  publicVersionAhead: boolean;
  majorUpgrade: boolean;
  compatibilityGate?: CliCompatibilityGate;
}

export interface CliUpdateReceipt {
  fromVersion: string;
  toVersion: string;
  status: "updated" | "rolled-back" | "failed";
  verifiedAt: string;
  message: string;
  compatibility?: CliCompatibilitySnapshot;
}

export interface CliRuntimeUpdate {
  kind: "model" | "settings" | "goal" | "workflow" | "subagent" | "monitor" | "scheduled-task" | "mcp" | "git" | "announcement" | "session";
  name: string;
  at: string;
  summary?: string;
  data?: Record<string, unknown>;
}

/**
 * Capability-gated session surfaces exposed by newer Grok Build CLIs.  These
 * are intentionally normalized at the main-process boundary so the renderer
 * never consumes arbitrary ACP payloads or assumes a version is sufficient.
 */
export interface CliSessionListItem {
  sessionId: string;
  cwd?: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  modelId?: string;
  messageCount?: number;
}

export interface CliSessionListResult {
  supported: boolean;
  sessions: CliSessionListItem[];
  nextCursor?: string;
  source: "acp" | "unsupported";
}

export interface CliSessionInfo {
  supported: boolean;
  sessionId: string;
  cwd?: string;
  title?: string;
  modelId?: string;
  mode?: SessionMode;
  effort?: ReasoningEffort;
  sandbox?: string;
  contextWindowTokens?: number;
  contextUsedTokens?: number;
  contextFreeTokens?: number;
  contextUsagePercent?: number;
  systemPromptTokens?: number;
  toolDefinitionsCount?: number;
  toolDefinitionsTokens?: number;
  compactionCount?: number;
  autoCompactThresholdPercent?: number;
  turnCount?: number;
  toolCallCount?: number;
  messageCount?: number;
  agentName?: string;
  resolvedModelId?: string;
  createdAt?: string;
  updatedAt?: string;
  source: "acp" | "unsupported";
}

export interface CliSessionUsage {
  supported: boolean;
  sessionId: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  costUsdTicks?: number;
  costIsPartial?: boolean;
  usageIsIncomplete?: boolean;
  modelCalls?: number;
  apiDurationMs?: number;
  numTurns?: number;
  modelUsage?: Record<string, {
    inputTokens?: number;
    outputTokens?: number;
    cachedReadTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
    costUsd?: number;
    costIsPartial?: boolean;
  }>;
  limitPercent?: number;
  resetAt?: string;
  source: "acp" | "unsupported";
}

export interface CliBtwReceipt {
  accepted: boolean;
  sessionId: string;
  requestId?: string;
  message?: string;
  source: "acp" | "unsupported";
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
  claudeSessions: ClaudeSessionSummary[];
  buildInfo: BuildInfo;
  onboarding: OnboardingState;
}

export interface SendPromptInput {
  sessionId: string;
  text: string;
  attachments: Attachment[];
  clientMessageId?: string;
}

export interface OfflineUiFixture {
  session: SessionSummary;
  events: ChatEvent[];
  /** Optional current-version multi-session fixture data. Older probes can keep using session/events. */
  sessions?: SessionSummary[];
  activeSessionId?: string;
}

export interface GrokDesktopApi {
  bootstrap(): Promise<BootstrapData>;
  getBuildInfo(): Promise<BuildInfo>;
  getOnboarding(): Promise<OnboardingState>;
  updateOnboarding(patch: Partial<OnboardingState>): Promise<OnboardingState>;
  resetOnboarding(): Promise<OnboardingState>;
  runDiagnostics(): Promise<SystemCompatibilityReport>;
  previewGrokDoctorFixes(): Promise<GrokDoctorFixPreview>;
  applyGrokDoctorFix(id: string, confirmationToken: string, confirmed: boolean): Promise<GrokDoctorFixReceipt>;
  diagnoseFailure(failure: TurnFailure): Promise<FailureDiagnosisReport>;
  getAgentChanges(sessionId: string, scope: "last-turn" | "session"): Promise<AgentChangeIndex>;
  getTokenActivity(query?: TokenActivityQuery): Promise<TokenActivityReport>;
  getCliCapabilities(force?: boolean): Promise<import("./workbench-types").CliCapabilitySnapshot>;
  previewSupportBundle(): Promise<SupportBundlePreview>;
  exportSupportBundle(): Promise<string | null>;
  checkAppUpdate(force?: boolean): Promise<AppReleaseStatus>;
  openAppRelease(url?: string): Promise<void>;
  chooseWorkspace(): Promise<string | null>;
  createTemporaryWorkspace(): Promise<string>;
  setWorkspace(cwd: string): Promise<SessionSummary[]>;
  openWorkspaceOffline(cwd: string): Promise<SessionSummary[]>;
  discoverWorkspaces(force?: boolean): Promise<WorkspaceSummary[]>;
  pinWorkspace(cwd: string, pinned: boolean): Promise<WorkspaceSummary[]>;
  listHiddenWorkspaces(): Promise<WorkspaceSummary[]>;
  setWorkspaceHidden(cwd: string, hidden: boolean): Promise<WorkspaceSummary[]>;
  searchWorkspaceFiles(cwd: string, query: string, limit?: number): Promise<WorkspaceFileCandidate[]>;
  listWorkspaceTree(cwd: string, directoryPath?: string, options?: import("./workbench-types").WorkspaceTreeOptions): Promise<import("./workbench-types").WorkspaceTreeNode[]>;
  openEditorDocument(cwd: string, path: string): Promise<import("./workbench-types").EditorOpenResult>;
  saveEditorDocument(input: import("./workbench-types").EditorSaveInput): Promise<import("./workbench-types").EditorSaveResult>;
  createEditorFile(cwd: string, path: string, content?: string): Promise<import("./workbench-types").EditorDocument>;
  createEditorDirectory(cwd: string, path: string): Promise<void>;
  renameEditorPath(cwd: string, path: string, targetPath: string): Promise<string>;
  deleteEditorPath(cwd: string, path: string, confirmed: boolean): Promise<void>;
  revealEditorPath(cwd: string, path: string): Promise<void>;
  getGitRepositoryTrust(cwd: string): Promise<import("./workbench-types").GitRepositoryTrust>;
  getGitWorkspaceCapability(cwd: string): Promise<import("./workbench-types").GitWorkspaceCapability>;
  setGitRepositoryTrust(cwd: string, repositoryRoot: string, trusted: boolean): Promise<import("./workbench-types").GitRepositoryTrust>;
  getGitStatus(cwd: string): Promise<import("./workbench-types").GitRepositoryStatus>;
  getGitDiff(cwd: string, staged: boolean, path?: string): Promise<import("./workbench-types").GitDiffResult>;
  getGitReview(cwd: string, scope: import("./workbench-types").GitReviewScope): Promise<import("./workbench-types").GitReviewSnapshot>;
  getGitReviewIndex(cwd: string, scope: import("./workbench-types").GitReviewScope): Promise<import("./workbench-types").GitReviewIndex>;
  getGitReviewFileDetail(cwd: string, scope: import("./workbench-types").GitReviewScope, snapshotId: string, fileId: string): Promise<import("./workbench-types").GitReviewFileDetail>;
  applyGitReviewHunk(cwd: string, input: import("./workbench-types").GitHunkActionInput): Promise<import("./workbench-types").GitReviewSnapshot>;
  stageGitChanges(cwd: string, paths?: string[]): Promise<import("./workbench-types").GitRepositoryStatus>;
  unstageGitChanges(cwd: string, paths?: string[]): Promise<import("./workbench-types").GitRepositoryStatus>;
  commitGitChanges(cwd: string, message: string): Promise<import("./workbench-types").GitCommitSummary>;
  listGitBranches(cwd: string): Promise<import("./workbench-types").GitBranchSummary[]>;
  createGitBranch(cwd: string, name: string, startPoint?: string): Promise<import("./workbench-types").GitRepositoryStatus>;
  switchGitBranch(cwd: string, name: string): Promise<import("./workbench-types").GitRepositoryStatus>;
  listGitHistory(cwd: string, limit?: number): Promise<import("./workbench-types").GitCommitSummary[]>;
  getGitCommitDetails(cwd: string, hash: string): Promise<import("./workbench-types").GitCommitDetails>;
  discardGitChanges(cwd: string, input: import("./workbench-types").GitDiscardInput): Promise<import("./workbench-types").GitRepositoryStatus>;
  pullGitRepository(cwd: string, operationId: string): Promise<import("./workbench-types").GitOperationResult>;
  pushGitRepository(cwd: string, operationId: string): Promise<import("./workbench-types").GitOperationResult>;
  cancelGitOperation(operationId: string): Promise<boolean>;
  listWorktrees(cwd: string): Promise<import("./workbench-types").GrokWorktreeSummary[]>;
  createWorktree(input: import("./workbench-types").WorktreeCreateInput): Promise<import("./workbench-types").GrokWorktreeSummary>;
  previewWorktreeApply(cwd: string, worktreeId: string): Promise<import("./workbench-types").WorktreeApplyPreview>;
  applyWorktree(cwd: string, worktreeId: string, confirmationToken: string, confirmed: boolean, cleanup?: boolean): Promise<import("./workbench-types").WorktreeApplyResult>;
  removeWorktree(cwd: string, worktreeId: string, confirmed: boolean): Promise<void>;
  previewWorktreeGc(cwd: string): Promise<import("./workbench-types").WorktreeGcPreview>;
  gcWorktrees(cwd: string, confirmationToken: string, confirmed: boolean): Promise<import("./workbench-types").WorktreeGcPreview>;
  resolveMemoryLayout(cwd: string): Promise<import("./workbench-types").MemoryLayout>;
  getMemorySettings(cwd: string): Promise<import("./workbench-types").MemorySettings>;
  updateMemorySettings(cwd: string, patch: Partial<Pick<import("./workbench-types").MemorySettings, "enabled" | "saveOnSessionEnd" | "autoDream">>, sessionId?: string): Promise<import("./workbench-types").MemorySettings>;
  listMemory(cwd: string, query?: string): Promise<import("./workbench-types").MemoryEntry[]>;
  saveMemory(input: import("./workbench-types").MemorySaveInput): Promise<import("./workbench-types").MemorySaveResult>;
  previewRemember(cwd: string, scope: "global" | "workspace", text: string): Promise<import("./workbench-types").MemoryRememberPreview>;
  rememberMemory(preview: import("./workbench-types").MemoryRememberPreview, confirmationToken: string, confirmed: boolean, sessionId?: string): Promise<import("./workbench-types").MemoryEntry>;
  listMemoryStructuredEntries(cwd: string, scope?: "global" | "workspace"): Promise<import("./workbench-types").MemoryStructuredEntry[]>;
  previewDeleteMemoryEntry(cwd: string, entryId: string): Promise<import("./workbench-types").MemoryDeletePreview>;
  deleteMemoryEntry(preview: import("./workbench-types").MemoryDeletePreview, confirmationToken: string, confirmed: boolean): Promise<import("./workbench-types").MemoryEntry>;
  deleteSessionMemory(cwd: string, entryId: string, confirmed: boolean): Promise<void>;
  clearMemory(cwd: string, scope: "workspace" | "global" | "all", confirmed: boolean): Promise<import("./workbench-types").MemoryEntry[]>;
  runMemoryCommand(sessionId: string, command: "flush" | "dream"): Promise<import("./workbench-types").MemorySettings>;
  listAgentDefinitions(cwd: string): Promise<import("./workbench-types").AgentDefinition[]>;
  validateAgentDefinition(rawMarkdown: string, expectedName?: string): Promise<import("./workbench-types").DefinitionValidation>;
  saveAgentDefinition(input: import("./workbench-types").AgentDefinitionSaveInput): Promise<import("./workbench-types").DefinitionMutationResult<import("./workbench-types").AgentDefinition>>;
  copyAgentDefinition(cwd: string, sourcePath: string, targetSource: "user" | "project", newName: string): Promise<import("./workbench-types").DefinitionMutationResult<import("./workbench-types").AgentDefinition>>;
  renameAgentDefinition(cwd: string, sourcePath: string, newName: string): Promise<import("./workbench-types").DefinitionMutationResult<import("./workbench-types").AgentDefinition>>;
  setAgentDefinitionEnabled(cwd: string, sourcePath: string, enabled: boolean): Promise<import("./workbench-types").DefinitionMutationResult<import("./workbench-types").AgentDefinition>>;
  deleteAgentDefinition(cwd: string, sourcePath: string, confirmed: boolean): Promise<import("./workbench-types").DefinitionActionResult>;
  listPersonaDefinitions(cwd: string): Promise<import("./workbench-types").PersonaDefinition[]>;
  validatePersonaDefinition(rawToml: string): Promise<import("./workbench-types").DefinitionValidation>;
  savePersonaDefinition(input: import("./workbench-types").PersonaDefinitionSaveInput): Promise<import("./workbench-types").DefinitionMutationResult<import("./workbench-types").PersonaDefinition>>;
  copyPersonaDefinition(cwd: string, sourcePath: string, targetSource: "user" | "project", newName: string): Promise<import("./workbench-types").DefinitionMutationResult<import("./workbench-types").PersonaDefinition>>;
  renamePersonaDefinition(cwd: string, sourcePath: string, newName: string): Promise<import("./workbench-types").DefinitionMutationResult<import("./workbench-types").PersonaDefinition>>;
  setPersonaDefinitionEnabled(cwd: string, sourcePath: string, enabled: boolean): Promise<import("./workbench-types").DefinitionMutationResult<import("./workbench-types").PersonaDefinition>>;
  deletePersonaDefinition(cwd: string, sourcePath: string, confirmed: boolean): Promise<import("./workbench-types").DefinitionActionResult>;
  listExecutionProfiles(cwd: string): Promise<import("./workbench-types").SessionExecutionProfile[]>;
  validateExecutionProfile(profile: import("./workbench-types").SessionExecutionProfile): Promise<import("./workbench-types").ExecutionProfileValidation>;
  saveExecutionProfile(input: import("./workbench-types").ExecutionProfileSaveInput): Promise<import("./workbench-types").SessionExecutionProfile[]>;
  deleteExecutionProfile(cwd: string, profileId: string, confirmed: boolean): Promise<import("./workbench-types").SessionExecutionProfile[]>;
  getSessionExecutionAssignment(sessionId: string): Promise<import("./workbench-types").SessionExecutionAssignment | undefined>;
  getAgentDashboard(query: import("./workbench-types").AgentDashboardQuery): Promise<import("./workbench-types").AgentDashboardSnapshot>;
  stopAgentDashboardNode(nodeId: string): Promise<void>;
  clearAgentDashboardRecord(nodeId?: string): Promise<void>;
  inspectAttachmentPrivacy(cwd: string, attachments: Attachment[]): Promise<AttachmentPrivacyFinding[]>;
  listSessions(cwd?: string, query?: string): Promise<SessionSummary[]>;
  listOfficialSessions(cwd?: string, cursor?: string): Promise<CliSessionListResult>;
  createSession(input: string | import("./workbench-types").ExecutionProfileLaunchInput): Promise<import("./workbench-types").SessionLaunchResult>;
  previewSession(cwd: string, sessionId: string): Promise<SessionPreviewSnapshot>;
  openSession(cwd: string, sessionId: string): Promise<{ sessionId: string; hydration?: SessionHydrationState; message?: string }>;
  getCliSessionInfo(sessionId: string): Promise<CliSessionInfo>;
  getCliSessionUsage(sessionId: string): Promise<CliSessionUsage>;
  getSessionRuntimePreferences(sessionId: string): Promise<SessionRuntimePreferences | undefined>;
  setSessionCompactionPolicy(sessionId: string, policy: SessionCompactionPolicy): Promise<SessionRuntimePreferences>;
  compactSession(sessionId: string): Promise<SessionCompactReceipt>;
  sendBtwPrompt(sessionId: string, text: string): Promise<CliBtwReceipt>;
  getOfficialFeedbackCapability(sessionId: string): Promise<OfficialFeedbackCapability>;
  previewOfficialFeedback(text: string): Promise<OfficialFeedbackPreview>;
  submitOfficialFeedback(sessionId: string, text: string): Promise<OfficialFeedbackReceipt>;
  renameSession(sessionId: string, title: string): Promise<void>;
  deleteSession(cwd: string, sessionId: string): Promise<void>;
  deleteDesktopSessionData(cwd: string, sessionId: string): Promise<void>;
  clearSessions(cwd: string, keepSessionId?: string): Promise<void>;
  pinSession(sessionId: string, pinned: boolean): Promise<void>;
  exportSessionMarkdown(cwd: string, sessionId: string): Promise<string | null>;
  getMediaCapabilities(sessionId: string): Promise<MediaCapabilities>;
  startMediaGeneration(request: MediaCreationRequest & { sessionId: string }): Promise<MediaGenerationJob>;
  getMediaGenerationJob(jobId: string): Promise<MediaGenerationJob | undefined>;
  cancelMediaGeneration(jobId: string): Promise<MediaGenerationJob>;
  onMediaGenerationProgress(listener: (job: MediaGenerationJob) => void): () => void;
  sendPrompt(input: SendPromptInput): Promise<void>;
  getOfflineUiFixture(): Promise<OfflineUiFixture | null>;
  cancelSession(sessionId: string): Promise<void>;
  setModel(sessionId: string, modelId: string): Promise<void>;
  setEffort(sessionId: string, effort: ReasoningEffort): Promise<void>;
  setMode(sessionId: string, mode: SessionMode): Promise<void>;
  respondPermission(sessionId: string, requestId: string | number, optionId: string): Promise<void>;
  respondQuestion(sessionId: string, requestId: string | number, answers: Record<string, string>): Promise<void>;
  respondPlan(sessionId: string, requestId: string | number | undefined, verdict: "approved" | "rejected" | "cancelled", comment?: string): Promise<PlanDecisionReceipt>;
  pickAttachments(): Promise<Attachment[]>;
  pickAttachmentFolders(): Promise<Attachment[]>;
  attachmentsFromPaths(paths: string[], sessionId?: string): Promise<Attachment[]>;
  openPath(path: string): Promise<void>;
  openTarget(intent: OpenTargetIntent): Promise<OpenTargetResult>;
  listOpenTargetTools(): Promise<ExternalOpenTool[]>;
  copyImage(source: string): Promise<void>;
  saveImage(source: string): Promise<string | null>;
  openMedia(source: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  listModelCatalog(): Promise<ModelInfo[]>;
  getTheme(): Promise<ThemeSettings>;
  updateTheme(patch: Partial<ThemeSettings>): Promise<AppSettings>;
  pickThemeBackground(): Promise<AppSettings | null>;
  removeThemeBackground(): Promise<AppSettings>;
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
  listClaudeSessions(cwd: string, force?: boolean): Promise<ClaudeSessionSummary[]>;
  openClaudeSession(id: string): Promise<ClaudeSessionDetail>;
  refreshClaudeSession(id: string): Promise<ClaudeSessionDetail>;
  hideClaudeSession(id: string, hidden?: boolean): Promise<void>;
  continueClaudeSession(id: string): Promise<{ sessionId: string; cwd: string }>;
  getQuota(force?: boolean): Promise<GrokQuotaSnapshot>;
  listProviders(): Promise<CustomProviderProfile[]>;
  upsertProvider(input: CustomProviderInput): Promise<CustomProviderProfile[]>;
  removeProvider(id: string): Promise<CustomProviderProfile[]>;
  testProvider(id: string): Promise<ProviderConnectivityResult>;
  pullProviderModels(id: string): Promise<Array<{ id: string; name?: string }>>;
  probeProviderDraft(input: ProviderConnectionDraft): Promise<ProviderDraftProbeResult>;
  discoverProviderModels(input: ProviderConnectionDraft): Promise<ProviderModelCandidate[]>;
  getProviderCapabilities(id: string): Promise<ProviderCapabilitySnapshot | undefined>;
  startProviderScan(scope: ProviderScanScope): Promise<ProviderScanJob>;
  getProviderScanJob(jobId: string): Promise<ProviderScanJob | undefined>;
  listProviderScanJobs(providerId?: string): Promise<ProviderScanJob[]>;
  cancelProviderScan(jobId: string): Promise<ProviderScanJob>;
  onProviderScanProgress(listener: (progress: ProviderScanProgress) => void): () => void;
  /** @deprecated Compatibility-only blocking API. New callers must use startProviderScan(). */
  deepScanProvider(id: string, options?: ProviderDeepScanOptions): Promise<ProviderDeepScanResult>;
  /** @deprecated Compatibility-only Provider-wide cancellation. New callers must cancel by Job ID. */
  cancelProviderDeepScan(id: string): Promise<boolean>;
  getProviderCapabilityApplication(id: string): Promise<CapabilityApplicationDraft>;
  applyProviderCapabilities(id: string, selection?: CapabilityApplicationSelection): Promise<CustomProviderProfile[]>;
  setProviderDesktopDefault(modelId: string): Promise<AppSettings>;
  setProviderCliDefault(modelId: string): Promise<CustomProviderProfile[]>;
  reloadProviders(): Promise<void>;
  listAutomations(): Promise<AutomationTask[]>;
  createAutomation(input: AutomationTaskInput): Promise<AutomationTask[]>;
  updateAutomation(id: string, patch: Partial<AutomationTaskInput>): Promise<AutomationTask[]>;
  deleteAutomation(id: string): Promise<AutomationTask[]>;
  pauseAutomation(id: string, paused: boolean): Promise<AutomationTask[]>;
  runAutomationNow(id: string): Promise<AutomationRunRecord>;
  cancelAutomationRun(id: string): Promise<AutomationRunRecord>;
  listAutomationRuns(taskId?: string): Promise<AutomationRunRecord[]>;
  getAutomationGlobalPolicy(): Promise<AutomationGlobalPolicy>;
  updateAutomationGlobalPolicy(patch: Partial<AutomationGlobalPolicy>): Promise<AutomationGlobalPolicy>;
  applyAutomationPolicyToAll(): Promise<AutomationTask[]>;
  respondAutomationPending(id: string, approved: boolean): Promise<void>;
  repairAutomationRegistrations(): Promise<AutomationTask[]>;
  checkAutomationHealth(repair?: boolean): Promise<import("./workbench-types").AutomationHealthReport>;
  clearAutomationContext(id: string): Promise<AutomationTask[]>;
  enqueuePrompt(sessionId: string, text: string, attachments: Attachment[], clientMessageId?: string): Promise<QueueOperationReceipt>;
  interjectPrompt(sessionId: string, text: string, attachments: Attachment[], clientMessageId?: string): Promise<QueueOperationReceipt>;
  editQueuedPrompt(sessionId: string, id: string, text: string): Promise<QueueOperationReceipt>;
  removeQueuedPrompt(sessionId: string, id: string): Promise<QueueOperationReceipt>;
  reorderQueuedPrompt(sessionId: string, id: string, position: number): Promise<QueueOperationReceipt>;
  clearPromptQueue(sessionId: string): Promise<QueueOperationReceipt>;
  interjectQueuedPrompt(sessionId: string, id: string, text?: string): Promise<QueueOperationReceipt>;
  forkSession(sessionId: string, rewindPointId?: string, launch?: import("./workbench-types").ExecutionProfileLaunchInput): Promise<SessionForkResult>;
  rebindWorkspaceSessions(sourceCwd: string, targetCwd: string): Promise<WorkspaceRebindReceipt>;
  listRewindPoints(sessionId: string): Promise<RewindPoint[]>;
  rewindSession(sessionId: string, pointId: string, mode: "conversation" | "conversation-and-files" | "files"): Promise<void>;
  archiveSession(sessionId: string, archived: boolean): Promise<void>;
  listBackgroundTasks(): Promise<BackgroundTaskSummary[]>;
  killBackgroundTask(id: string): Promise<void>;
  listInbox(): Promise<NotificationInboxItem[]>;
  markInboxRead(id: string, read: boolean): Promise<NotificationInboxItem[]>;
  clearInbox(): Promise<NotificationInboxItem[]>;
  getDraft(key: string): Promise<ComposerDraftState | null>;
  listDrafts(): Promise<ComposerDraftState[]>;
  setDraft(key: string, text: string, capability?: ComposerCapabilitySelection, attachments?: Attachment[], newTask?: NewTaskDraft): Promise<void>;
  moveDraft(sourceKey: string, targetKey: string): Promise<ComposerDraftState | null>;
  clearDraft(key: string): Promise<void>;
  createTextDraftAttachment(key: string, text: string): Promise<Attachment>;
  readTextDraftAttachment(path: string): Promise<string>;
  deleteTextDraftAttachment(path: string): Promise<void>;
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
  checkUpdatesAutomatically(): Promise<AutomaticUpdateCheckResult>;
  previewCliUpdate(): Promise<CliUpdatePreview>;
  applyCliUpdate(input: { targetVersion: string; expectedCurrentVersion: string; allowMajorUpgrade?: boolean }): Promise<CliUpdateReceipt>;
  getCliCompatibilitySnapshot(): Promise<CliCompatibilitySnapshot>;
  getCliUpdateHistory(): Promise<CliUpdateRecord[]>;
  exportLogs(): Promise<string | null>;
  onEvent(listener: (event: ChatEvent) => void): () => void;
  onLogin(listener: (state: LoginState) => void): () => void;
  onDroppedAttachments(listener: (attachments: Attachment[]) => void): () => void;
  onNavigateSession(listener: (target: { sessionId: string; cwd: string }) => void): () => void;
  onMenuCommand(listener: (command: AppMenuCommand) => void): () => void;
  onComputerStateChanged(listener: (state: ComputerTaskState) => void): () => void;
  onAutomationEvent(listener: (event: { taskId: string; run?: AutomationRunRecord; task?: AutomationTask; pending?: AutomationPendingConfirmation }) => void): () => void;
}

export type {
  AgentDashboardNode,
  AgentDashboardQuery,
  AgentDashboardSnapshot,
  AgentDashboardStatus,
  AgentDefinition,
  AgentDefinitionSaveInput,
  AutomationHealthReport,
  CliCapabilityName,
  CliCapabilitySnapshot,
  CliCapabilitySource,
  CliCapabilityState,
  CliCapabilitySupport,
  DefinitionActionResult,
  DefinitionMutationResult,
  DefinitionReloadResult,
  DefinitionSaveConflict,
  DefinitionSource,
  DefinitionValidation,
  EditorDocument,
  EditorEncoding,
  EditorLineEnding,
  EditorOpenResult,
  EditorSaveInput,
  EditorSaveResult,
  EditorSaveConflict,
  ExecutionProfileField,
  ExecutionProfileFieldSupport,
  ExecutionProfileForkInput,
  ExecutionProfileLaunchInput,
  ExecutionProfileSaveInput,
  ExecutionProfileValidation,
  GitBranchSummary,
  GitCommitDetails,
  GitCommitSummary,
  GitDiscardInput,
  GitDiffResult,
  GitFileChange,
  GitFileChangeKind,
  GitOperationResult,
  GitReviewFile,
  GitReviewFileDetail,
  GitReviewFileSummary,
  GitReviewHunk,
  GitReviewIndex,
  GitReviewLine,
  GitReviewScope,
  GitReviewSnapshot,
  GitHunkActionInput,
  GitRepositoryStatus,
  GitRepositoryTrust,
  GitWorkspaceCapability,
  GrokWorktreeState,
  GrokWorktreeSummary,
  MemoryEntry,
  MemoryLayout,
  MemoryRememberPreview,
  MemoryDeletePreview,
  MemoryStructuredEntry,
  MemorySaveInput,
  MemorySaveResult,
  MemoryScope,
  MemorySettings,
  NavigationIntent,
  NavigationSurface,
  PersonaContractField,
  PersonaDefinition,
  PersonaDefinitionSaveInput,
  SessionExecutionProfile,
  SessionExecutionAssignment,
  SessionExecutionProfileScope,
  SessionLaunchResult,
  WorktreeApplyPreview,
  WorktreeApplyResult,
  WorktreeCreateInput,
  WorktreeGcPreview,
  WorkspaceTreeNode,
  WorkspaceTreeNodeKind,
  WorkspaceTreeOptions,
} from "./workbench-types";
