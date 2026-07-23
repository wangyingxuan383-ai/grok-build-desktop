import type { ReasoningEffort, SessionMode } from "./types";

export type WorkspaceTreeNodeKind = "file" | "directory" | "symlink";

export interface WorkspaceTreeNode {
  id: string;
  path: string;
  relativePath: string;
  name: string;
  kind: WorkspaceTreeNodeKind;
  children?: WorkspaceTreeNode[];
  size?: number;
  modifiedAt?: string;
  hidden?: boolean;
  ignored?: boolean;
  readOnly?: boolean;
}

export interface WorkspaceTreeOptions {
  showIgnored?: boolean;
  showHidden?: boolean;
}

export type EditorEncoding = "utf8" | "utf8-bom" | "gb18030";
export type EditorLineEnding = "lf" | "crlf" | "mixed" | "none";

export interface EditorDocument {
  workspacePath: string;
  path: string;
  relativePath: string;
  content: string;
  encoding: EditorEncoding;
  lineEnding: EditorLineEnding;
  byteLength: number;
  editable: boolean;
  readOnlyReason?: string;
  hash: string;
  modifiedAt: string;
  languageId?: string;
}

export interface EditorSaveConflict {
  kind: "modified" | "deleted" | "type-changed";
  path: string;
  expectedHash: string;
  actualHash?: string;
  expectedModifiedAt: string;
  actualModifiedAt?: string;
  diskContent?: string;
  diskEncoding?: EditorEncoding;
  diskLineEnding?: EditorLineEnding;
}

export interface EditorOpenResult {
  kind: "document" | "external";
  document?: EditorDocument;
  path: string;
  relativePath: string;
  byteLength: number;
  reason?: string;
}

export interface EditorSaveInput {
  workspacePath: string;
  path: string;
  content: string;
  encoding: EditorEncoding;
  lineEnding: EditorLineEnding;
  expectedHash: string;
  expectedModifiedAt: string;
  overwrite?: boolean;
}

export interface EditorSaveResult {
  saved: boolean;
  document?: EditorDocument;
  conflict?: EditorSaveConflict;
}

export type GitFileChangeKind = "untracked" | "modified" | "added" | "deleted" | "renamed" | "copied" | "conflicted" | "unknown";

export interface GitFileChange {
  path: string;
  oldPath?: string;
  kind: GitFileChangeKind;
  staged: boolean;
  workingTree: boolean;
  conflict?: "both-added" | "both-deleted" | "both-modified" | "added-by-us" | "added-by-them" | "deleted-by-us" | "deleted-by-them";
}

export interface GitBranchSummary {
  name: string;
  current: boolean;
  detached?: boolean;
  upstream?: string;
  ahead?: number;
  behind?: number;
  commit?: string;
}

export interface GitRepositoryStatus {
  workspacePath: string;
  repositoryRoot: string;
  branch?: GitBranchSummary;
  remote?: { name: string; displayUrl: string };
  clean: boolean;
  changes: GitFileChange[];
  conflicts: string[];
  checkedAt: string;
}

export interface GitRepositoryTrust {
  workspacePath: string;
  repositoryRoot: string;
  required: boolean;
  trusted: boolean;
}

export interface GitWorkspaceCapability {
  available: boolean;
  cwd: string;
  repositoryRoot?: string;
  reason?: "no-workspace" | "not-repository" | "git-unavailable" | "invalid-workspace";
  message: string;
}

export interface GitDiffResult {
  repositoryRoot: string;
  path?: string;
  staged: boolean;
  patch: string;
  binary: boolean;
}

export type GitReviewScope =
  | { kind: "unstaged" }
  | { kind: "staged" }
  | { kind: "commit"; revision: string }
  | { kind: "branch"; base: string }
  | { kind: "last-turn"; paths: string[] };

export interface GitReviewLine {
  kind: "context" | "addition" | "deletion" | "meta";
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface GitReviewHunk {
  id: string;
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  additions: number;
  deletions: number;
  lines: GitReviewLine[];
  mutable: boolean;
}

export interface GitReviewFile {
  id: string;
  path: string;
  oldPath?: string;
  kind: GitFileChangeKind;
  staged: boolean;
  workingTree: boolean;
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: GitReviewHunk[];
}

export interface GitReviewSnapshot {
  id: string;
  repositoryRoot: string;
  scope: GitReviewScope;
  readOnly: boolean;
  files: GitReviewFile[];
  additions: number;
  deletions: number;
  createdAt: string;
}

/** Lightweight review payload used by the file navigator. Hunks stay in the main process
 * until the user selects one file, so very large repositories do not flood the renderer. */
export interface GitReviewFileSummary extends Omit<GitReviewFile, "hunks"> {
  hunkCount: number;
}

export interface GitReviewIndex {
  id: string;
  repositoryRoot: string;
  scope: GitReviewScope;
  readOnly: boolean;
  files: GitReviewFileSummary[];
  additions: number;
  deletions: number;
  createdAt: string;
}

export interface GitReviewFileDetail {
  snapshotId: string;
  file: GitReviewFile;
}

export interface GitHunkActionInput {
  snapshotId: string;
  scope: Extract<GitReviewScope, { kind: "unstaged" | "staged" }>;
  fileId: string;
  hunkId: string;
  action: "stage" | "unstage" | "revert";
  confirmed?: boolean;
}

export type NavigationSurface = "editor" | "diff" | "review";

export interface NavigationIntent {
  sessionId?: string;
  executionRoot: string;
  targetPath: string;
  line?: number;
  column?: number;
  surface: NavigationSurface;
}

export interface GitCommitSummary {
  hash: string;
  shortHash: string;
  author: string;
  authoredAt: string;
  subject: string;
}

export interface GitCommitDetails extends GitCommitSummary {
  body: string;
  parents: string[];
  files: Array<{
    path: string;
    oldPath?: string;
    kind: GitFileChangeKind;
    additions?: number;
    deletions?: number;
  }>;
}

export interface GitOperationResult {
  operationId: string;
  completed: boolean;
  cancelled: boolean;
  summary: string;
}

export interface GitDiscardInput {
  trackedPaths: string[];
  untrackedPaths: string[];
  confirmedPaths: string[];
}

export type GrokWorktreeState = "ready" | "applying" | "conflicted" | "orphaned" | "stale" | "missing" | "unknown";

export interface GrokWorktreeSummary {
  id: string;
  name: string;
  path: string;
  branch?: string;
  baseRef?: string;
  head?: string;
  sourceSessionId?: string;
  agentId?: string;
  changedFiles: number;
  state: GrokWorktreeState;
  official: boolean;
  createdAt?: string;
  lastUsedAt?: string;
}

export interface WorktreeApplyPreview {
  worktreeId: string;
  sourcePath: string;
  targetPath: string;
  baseRef?: string;
  headRef?: string;
  commits: Array<{ hash: string; subject: string }>;
  files: Array<{ path: string; kind: GitFileChangeKind; additions?: number; deletions?: number }>;
  additions: number;
  deletions: number;
  targetClean: boolean;
  canApply: boolean;
  reason?: string;
  confirmationToken?: string;
}

export interface WorktreeCreateInput {
  workspacePath: string;
  name: string;
  baseRef?: string;
  sourceSessionId?: string;
  agentId?: string;
}

export interface WorktreeApplyResult {
  worktreeId: string;
  applied: boolean;
  conflicted: boolean;
  cleaned: boolean;
  message: string;
}

export interface WorktreeGcPreview {
  repositoryRoot: string;
  candidates: Array<{ path: string; reason: string }>;
  confirmationToken: string;
}

export type MemoryScope = "global" | "workspace" | "session";

export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  title: string;
  content: string;
  workspaceIdentity?: string;
  sessionId?: string;
  path?: string;
  hash?: string;
  modifiedAt?: string;
  readOnly?: boolean;
}

export interface MemorySettings {
  workspaceIdentity: string;
  enabled: boolean;
  saveOnSessionEnd: boolean;
  autoDream: boolean;
  lastFlushAt?: string;
  lastDreamAt?: string;
  dreamStatus?: "idle" | "running" | "completed" | "failed";
  indexStatus?: "disabled" | "ready" | "building" | "failed" | "unknown";
}

export interface MemoryLayout {
  grokHome: string;
  memoryRoot: string;
  workspaceIdentity: string;
  workspaceKey: string;
  globalFile: string;
  workspaceDirectory: string;
  workspaceFile: string;
  sessionsDirectory: string;
}

export interface MemorySaveInput {
  workspacePath: string;
  scope: "global" | "workspace";
  content: string;
  expectedHash: string;
  expectedModifiedAt: string;
  overwrite?: boolean;
}

export interface MemorySaveResult {
  saved: boolean;
  entry?: MemoryEntry;
  conflict?: EditorSaveConflict;
}

export interface MemoryRememberPreview {
  workspacePath: string;
  scope: "global" | "workspace";
  text: string;
  targetPath: string;
  confirmationToken: string;
}

export interface MemoryStructuredEntry {
  id: string;
  scope: "global" | "workspace";
  heading: string;
  text: string;
  lineStart: number;
  lineEnd: number;
  hash: string;
}

export interface MemoryDeletePreview {
  workspacePath: string;
  entry: MemoryStructuredEntry;
  targetPath: string;
  confirmationToken: string;
}

export type DefinitionSource = "builtin" | "plugin" | "user" | "project";

export interface DefinitionValidation {
  valid: boolean;
  message?: string;
  checkedAt: string;
  inspectPassed?: boolean;
}

export interface DefinitionReloadResult {
  strategy: "hot-reload" | "idle-restart" | "not-needed" | "deferred";
  restartedSessions: number;
  message?: string;
}

export interface DefinitionSaveConflict {
  path: string;
  expectedHash: string;
  actualHash: string;
  diskContent: string;
}

export interface AgentDefinitionSaveInput {
  workspacePath: string;
  targetSource: "user" | "project";
  name: string;
  rawMarkdown: string;
  originalPath?: string;
  expectedHash?: string;
}

export interface PersonaDefinitionSaveInput {
  workspacePath: string;
  targetSource: "user" | "project";
  name: string;
  rawToml: string;
  originalPath?: string;
  expectedHash?: string;
}

export interface DefinitionMutationResult<T> {
  saved: boolean;
  definition?: T;
  validation: DefinitionValidation;
  reload: DefinitionReloadResult;
  backupPath?: string;
  conflict?: DefinitionSaveConflict;
}

export interface DefinitionActionResult {
  reload: DefinitionReloadResult;
  backupPath?: string;
}

export interface AgentDefinition {
  id: string;
  name: string;
  description?: string;
  source: DefinitionSource;
  path?: string;
  enabled: boolean;
  readOnly: boolean;
  effective: boolean;
  shadowedBy?: DefinitionSource;
  pluginName?: string;
  hash?: string;
  modelId?: string;
  effort?: ReasoningEffort;
  promptMode?: "extend" | "full";
  permissionMode?: string;
  tools?: string[];
  disallowedTools?: string[];
  skills?: string[];
  agentsMd?: boolean;
  instructions: string;
  rawMarkdown: string;
  validation?: DefinitionValidation;
}

export interface PersonaContractField {
  name: string;
  ioType: string;
  required: boolean;
  description?: string;
}

export interface PersonaDefinition {
  id: string;
  name: string;
  description?: string;
  source: DefinitionSource;
  path?: string;
  enabled: boolean;
  readOnly: boolean;
  effective: boolean;
  shadowedBy?: DefinitionSource;
  hash?: string;
  instructions?: string;
  instructionFile?: string;
  modelId?: string;
  effort?: ReasoningEffort;
  defaultCapabilityMode?: string;
  defaultForkContext?: boolean;
  defaultIsolation?: "none" | "worktree";
  inputContract: PersonaContractField[];
  outputContract: PersonaContractField[];
  rawToml: string;
  validation?: DefinitionValidation;
}

export type AgentDashboardStatus = "queued" | "running" | "waiting" | "completed" | "failed" | "stopped" | "unknown";

export interface AgentDashboardNode {
  id: string;
  sessionId: string;
  parentId?: string;
  children: AgentDashboardNode[];
  title: string;
  agentId?: string;
  personaId?: string;
  modelId?: string;
  effort?: ReasoningEffort;
  status: AgentDashboardStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  toolCount: number;
  contextUsed?: number;
  contextLimit?: number;
  isolation: "workspace" | "worktree";
  worktreeId?: string;
  latestAction?: string;
  waitingReason?: string;
  failureReason?: string;
  summary?: string;
  live: boolean;
  updatedAt: string;
}

export interface AgentDashboardSnapshot {
  workspacePath: string;
  roots: AgentDashboardNode[];
  mode: "live" | "history" | "mixed";
  updatedAt: string;
  liveCapability: CliCapabilityState;
  diagnostic?: string;
}

export interface AgentDashboardQuery {
  workspacePath: string;
  status?: AgentDashboardStatus | "all";
  agentId?: string;
  since?: string;
}

export type SessionExecutionProfileScope = "builtin" | "global" | "project";

export interface SessionExecutionProfile {
  id: string;
  name: string;
  description?: string;
  scope: SessionExecutionProfileScope;
  workspaceIdentity?: string;
  readOnly: boolean;
  agentId?: string;
  modelId?: string;
  effort: ReasoningEffort;
  mode: SessionMode;
  allowTools: string[];
  denyTools: string[];
  sandbox?: string;
  webSearch: "default" | "enabled" | "disabled";
  subagents: boolean;
  memory: boolean;
  worktree: boolean;
  worktreeRef?: string;
  maxTurns?: number;
  additionalRules?: string;
  allowedPersonaIds: string[];
  subagentIsolation: "workspace" | "worktree";
  createdAt?: string;
  updatedAt?: string;
  effective?: boolean;
  shadowedBy?: SessionExecutionProfileScope;
}

export type ExecutionProfileField =
  | "agentId" | "modelId" | "effort" | "mode" | "allowTools" | "denyTools"
  | "sandbox" | "webSearch" | "subagents" | "memory" | "worktree" | "worktreeRef"
  | "maxTurns" | "additionalRules" | "allowedPersonaIds" | "subagentIsolation";

export interface ExecutionProfileFieldSupport {
  state: "supported" | "degraded" | "unsupported";
  reason?: string;
  mapping?: string;
}

export interface ExecutionProfileValidation {
  valid: boolean;
  message?: string;
  fieldSupport: Record<ExecutionProfileField, ExecutionProfileFieldSupport>;
}

export interface ExecutionProfileSaveInput {
  workspacePath: string;
  scope: "global" | "project";
  profile: Omit<SessionExecutionProfile, "id" | "scope" | "workspaceIdentity" | "readOnly" | "createdAt" | "updatedAt" | "effective" | "shadowedBy"> & { id?: string };
}

export interface ExecutionProfileLaunchInput {
  workspacePath: string;
  profileId?: string;
  worktreeName?: string;
  worktreeRef?: string;
}

export interface ExecutionProfileForkInput extends ExecutionProfileLaunchInput {
  sessionId: string;
  rewindPointId?: string;
}

export interface SessionExecutionAssignment {
  sessionId: string;
  sourceWorkspacePath: string;
  cwd: string;
  profileId: string;
  profileName: string;
  profile: SessionExecutionProfile;
  worktreeId?: string;
  createdAt: string;
}

export interface SessionLaunchResult {
  sessionId: string;
  cwd: string;
  profileId: string;
  worktreeId?: string;
}

export const CLI_CAPABILITY_NAMES = [
  "acp.initialize",
  "acp.sessionNew",
  "queue",
  "interjection",
  "fork",
  "rewind",
  "git.status",
  "git.stage",
  "git.commit",
  "git.diffs",
  "git.discard",
  "worktree.create",
  "worktree.list",
  "worktree.apply",
  "worktree.remove",
  "worktree.gc",
  "memory.enable",
  "memory.manage",
  "memory.sessionCommands",
  "agents.inspect",
  "agents.definitions",
  "personas.definitions",
  "dashboard",
  "plugins",
  "mcp",
  "media",
  "codexReader",
  "quota",
  "computer",
] as const;

export type CliCapabilityName = (typeof CLI_CAPABILITY_NAMES)[number];
export type CliCapabilityState = "supported" | "unsupported" | "unknown";
export type CliCapabilitySource = "cli-help" | "inspect" | "acp-runtime" | "filesystem" | "not-probed";

export interface CliCapabilitySupport {
  state: CliCapabilityState;
  source: CliCapabilitySource;
  reason?: string;
}

export interface CliCapabilitySnapshot {
  cliFound: boolean;
  cliVersion?: string;
  cacheKey: string;
  checkedAt: string;
  capabilities: Record<CliCapabilityName, CliCapabilitySupport>;
}

export type AutomationHealthIssueKind = "registration" | "executable-path" | "session-mapping" | "account" | "provider" | "model" | "workspace" | "metadata";

export interface AutomationHealthReport {
  checkedAt: string;
  healthy: boolean;
  taskCount: number;
  repaired: number;
  needsConfiguration: number;
  issues: Array<{
    taskId: string;
    kind: AutomationHealthIssueKind;
    repairable: boolean;
    repaired: boolean;
    summary: string;
  }>;
}
