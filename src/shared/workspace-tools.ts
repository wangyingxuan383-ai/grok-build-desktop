export interface WorkspaceTerminal { id: string; workspace: string; title: string; status: "running" | "exited"; exitCode?: number; output: string; sequence: number }
export interface WorkspaceTerminalEvent { id: string; data: string; sequence: number; exitCode?: number }
export interface WorkspaceBrowserTab { id: string; url: string; title: string; loading: boolean; error?: string; downloadStatus?: string; canGoBack: boolean; canGoForward: boolean; sessionId?: string; workspace?: string }
export interface PreviewServer { terminalId: string; workspace: string; script: string; status: "running" | "exited"; url?: string }
export interface WorkspaceViewBounds { x: number; y: number; width: number; height: number; visible: boolean }
export interface WorkspaceArtifact { path: string; name: string; kind: "text" | "image" | "pdf" | "audio" | "video" | "html" | "office"; mimeType: string; data: string; previewUrl?: string }

export interface PullRequestStatus {
  available: boolean;
  reason?: string;
  number?: number;
  title?: string;
  url?: string;
  state?: string;
  isDraft?: boolean;
  headRefName?: string;
  baseRefName?: string;
  checks: Array<{ name: string; state: string }>;
  pending: boolean;
  watching?: boolean;
}
export interface PullRequestCreateInput { workspace: string; title: string; body: string; base?: string; draft?: boolean }
export interface PullRequestCreateResult { created: boolean; url?: string; number?: number; message: string; status?: PullRequestStatus }

export type WorkspaceScriptIcon = "play" | "test" | "lint" | "configure" | "build" | "debug";
export type WorkspaceScriptSource = "user" | "grok-project" | "t3";

export interface WorkspaceScript {
  id: string;
  projectId: string;
  name: string;
  command: string;
  icon: WorkspaceScriptIcon;
  source: WorkspaceScriptSource;
  trusted: boolean;
  commandHash: string;
  async?: boolean;
  autoOpenPreview?: boolean;
  previewUrl?: string;
  runOnWorktreeCreate?: boolean;
  stopOnSettle?: boolean;
  runOnSettle?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkspaceScriptSaveInput {
  workspacePath: string;
  id?: string;
  name: string;
  command: string;
  icon: WorkspaceScriptIcon;
  async?: boolean;
  autoOpenPreview?: boolean;
  previewUrl?: string;
  runOnWorktreeCreate?: boolean;
  stopOnSettle?: boolean;
  runOnSettle?: boolean;
}

export interface WorkspaceScriptListResult {
  projectId: string;
  workspacePath: string;
  repositoryTrusted: boolean;
  repositoryTrustRequired: boolean;
  repositoryRoot?: string;
  scripts: WorkspaceScript[];
}

export interface WorkspaceScriptRunInput {
  workspacePath: string;
  scriptId: string;
  executionCwd?: string;
  sessionId?: string;
  worktreeId?: string;
}

export interface WorkspaceScriptRunReceipt {
  runId: string;
  terminalId: string;
  scriptId: string;
  scriptName: string;
  projectId: string;
  cwd: string;
  sessionId?: string;
  worktreeId?: string;
  status: "running" | "exited";
  exitCode?: number;
  previewUrl?: string;
  stopOnSettle: boolean;
  startedAt: string;
}

export interface PullRequestTemplate {
  id: string;
  name: string;
  relativePath: string;
  content: string;
  isDefault: boolean;
}

export interface PullRequestStackItem {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  reviewDecision?: string;
  checks: Array<{ name: string; state: string }>;
  pending: boolean;
  isCurrent: boolean;
  depth: number;
}

export interface PullRequestStackSnapshot {
  available: boolean;
  reason?: string;
  currentBranch?: string;
  trunkBranch?: string;
  items: PullRequestStackItem[];
}

export interface GitHubIssueSummary {
  number: number;
  title: string;
  url: string;
  state: string;
  author?: string;
  labels: string[];
  assignees: string[];
  updatedAt?: string;
  bodyPreview?: string;
}

export interface GitHubIssueDetail extends GitHubIssueSummary {
  body: string;
  createdAt?: string;
  comments: Array<{ author: string; body: string; createdAt: string }>;
}

export interface GitHubIssueListQuery {
  state?: "open" | "closed" | "all";
  search?: string;
  limit?: number;
}

export interface GitHubIssueListResult {
  available: boolean;
  reason?: string;
  issues: GitHubIssueSummary[];
}

export interface SessionLinkedIssue {
  number: number;
  title: string;
  url: string;
  state?: string;
  repository?: string;
  linkedAt: string;
}
