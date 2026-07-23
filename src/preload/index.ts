import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AppMenuCommand, AppSettings, Attachment, AutomationRunRecord, AutomationTask, ChatEvent, ComputerTaskState, GrokDesktopApi, LoginState, ReasoningEffort, SessionMode } from "../shared/types";

const droppedAttachmentListeners = new Set<(attachments: Attachment[]) => void>();
const navigateSessionListeners = new Set<(target: { sessionId: string; cwd: string }) => void>();
const computerStateListeners = new Set<(state: ComputerTaskState) => void>();
const menuCommandListeners = new Set<(command: AppMenuCommand) => void>();
const automationEventListeners = new Set<(event: { taskId: string; run?: AutomationRunRecord; task?: AutomationTask }) => void>();

ipcRenderer.on("grok:navigate-session", (_event, target: { sessionId: string; cwd: string }) => {
  for (const listener of navigateSessionListeners) listener(target);
});
ipcRenderer.on("grok:computer-state", (_event, state: ComputerTaskState) => {
  for (const listener of computerStateListeners) listener(state);
});
ipcRenderer.on("grok:menu-command", (_event, command: AppMenuCommand) => {
  for (const listener of menuCommandListeners) listener(command);
});
ipcRenderer.on("grok:automation-event", (_event, value) => { for (const listener of automationEventListeners) listener(value); });

window.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("dragover", (event) => event.preventDefault());
  document.addEventListener("drop", (event) => {
    event.preventDefault();
    const paths = Array.from(event.dataTransfer?.files ?? []).map((file) => webUtils.getPathForFile(file)).filter(Boolean);
    if (!paths.length) return;
    void ipcRenderer.invoke("attachments:paths", paths).then((attachments: Attachment[]) => {
      for (const listener of droppedAttachmentListeners) listener(attachments);
    });
  });
});

const api: GrokDesktopApi = {
  bootstrap: () => ipcRenderer.invoke("app:bootstrap"),
  getBuildInfo: () => ipcRenderer.invoke("app:build-info"),
  getOnboarding: () => ipcRenderer.invoke("onboarding:get"),
  updateOnboarding: (patch) => ipcRenderer.invoke("onboarding:update", patch),
  resetOnboarding: () => ipcRenderer.invoke("onboarding:reset"),
  runDiagnostics: () => ipcRenderer.invoke("diagnostics:run"),
  getCliCapabilities: (force) => ipcRenderer.invoke("diagnostics:cli-capabilities", force),
  previewSupportBundle: () => ipcRenderer.invoke("diagnostics:support-preview"),
  exportSupportBundle: () => ipcRenderer.invoke("diagnostics:support-export"),
  checkAppUpdate: (force) => ipcRenderer.invoke("app-update:check", force),
  openAppRelease: (url) => ipcRenderer.invoke("app-update:open", url),
  chooseWorkspace: () => ipcRenderer.invoke("workspace:choose"),
  setWorkspace: (cwd) => ipcRenderer.invoke("workspace:set", cwd),
  discoverWorkspaces: (force) => ipcRenderer.invoke("workspace:discover", force),
  pinWorkspace: (cwd, pinned) => ipcRenderer.invoke("workspace:pin", cwd, pinned),
  searchWorkspaceFiles: (cwd, query, limit) => ipcRenderer.invoke("workspace:search-files", cwd, query, limit),
  listWorkspaceTree: (cwd, directoryPath, options) => ipcRenderer.invoke("workspace:tree:list", cwd, directoryPath, options),
  openEditorDocument: (cwd, path) => ipcRenderer.invoke("editor:open", cwd, path),
  saveEditorDocument: (input) => ipcRenderer.invoke("editor:save", input),
  createEditorFile: (cwd, path, content) => ipcRenderer.invoke("editor:create-file", cwd, path, content),
  createEditorDirectory: (cwd, path) => ipcRenderer.invoke("editor:create-directory", cwd, path),
  renameEditorPath: (cwd, path, targetPath) => ipcRenderer.invoke("editor:rename", cwd, path, targetPath),
  deleteEditorPath: (cwd, path, confirmed) => ipcRenderer.invoke("editor:delete", cwd, path, confirmed),
    revealEditorPath: (cwd, path) => ipcRenderer.invoke("editor:reveal", cwd, path),
    getGitRepositoryTrust: (cwd) => ipcRenderer.invoke("git:trust:get", cwd),
    getGitWorkspaceCapability: (cwd) => ipcRenderer.invoke("git:capability", cwd),
    setGitRepositoryTrust: (cwd, repositoryRoot, trusted) => ipcRenderer.invoke("git:trust:set", cwd, repositoryRoot, trusted),
    getGitStatus: (cwd) => ipcRenderer.invoke("git:status", cwd),
    getGitDiff: (cwd, staged, path) => ipcRenderer.invoke("git:diff", cwd, staged, path),
    getGitReview: (cwd, scope) => ipcRenderer.invoke("git:review", cwd, scope),
    getGitReviewIndex: (cwd, scope) => ipcRenderer.invoke("git:review:index", cwd, scope),
    getGitReviewFileDetail: (cwd, scope, snapshotId, fileId) => ipcRenderer.invoke("git:review:file", cwd, scope, snapshotId, fileId),
    applyGitReviewHunk: (cwd, input) => ipcRenderer.invoke("git:review:hunk", cwd, input),
    stageGitChanges: (cwd, paths) => ipcRenderer.invoke("git:stage", cwd, paths),
    unstageGitChanges: (cwd, paths) => ipcRenderer.invoke("git:unstage", cwd, paths),
    commitGitChanges: (cwd, message) => ipcRenderer.invoke("git:commit", cwd, message),
    listGitBranches: (cwd) => ipcRenderer.invoke("git:branches", cwd),
    createGitBranch: (cwd, name, startPoint) => ipcRenderer.invoke("git:branch:create", cwd, name, startPoint),
    switchGitBranch: (cwd, name) => ipcRenderer.invoke("git:branch:switch", cwd, name),
    listGitHistory: (cwd, limit) => ipcRenderer.invoke("git:history", cwd, limit),
    getGitCommitDetails: (cwd, hash) => ipcRenderer.invoke("git:commit:details", cwd, hash),
    discardGitChanges: (cwd, input) => ipcRenderer.invoke("git:discard", cwd, input),
    pullGitRepository: (cwd, operationId) => ipcRenderer.invoke("git:pull", cwd, operationId),
    pushGitRepository: (cwd, operationId) => ipcRenderer.invoke("git:push", cwd, operationId),
    cancelGitOperation: (operationId) => ipcRenderer.invoke("git:cancel", operationId),
    listWorktrees: (cwd) => ipcRenderer.invoke("worktree:list", cwd),
    createWorktree: (input) => ipcRenderer.invoke("worktree:create", input),
    previewWorktreeApply: (cwd, worktreeId) => ipcRenderer.invoke("worktree:apply:preview", cwd, worktreeId),
    applyWorktree: (cwd, worktreeId, confirmationToken, confirmed, cleanup) => ipcRenderer.invoke("worktree:apply", cwd, worktreeId, confirmationToken, confirmed, cleanup),
    removeWorktree: (cwd, worktreeId, confirmed) => ipcRenderer.invoke("worktree:remove", cwd, worktreeId, confirmed),
    previewWorktreeGc: (cwd) => ipcRenderer.invoke("worktree:gc:preview", cwd),
    gcWorktrees: (cwd, confirmationToken, confirmed) => ipcRenderer.invoke("worktree:gc", cwd, confirmationToken, confirmed),
    resolveMemoryLayout: (cwd) => ipcRenderer.invoke("memory:layout", cwd),
    getMemorySettings: (cwd) => ipcRenderer.invoke("memory:settings:get", cwd),
    updateMemorySettings: (cwd, patch, sessionId) => ipcRenderer.invoke("memory:settings:update", cwd, patch, sessionId),
    listMemory: (cwd, query) => ipcRenderer.invoke("memory:list", cwd, query),
    saveMemory: (input) => ipcRenderer.invoke("memory:save", input),
    previewRemember: (cwd, scope, text) => ipcRenderer.invoke("memory:remember:preview", cwd, scope, text),
    rememberMemory: (preview, confirmationToken, confirmed, sessionId) => ipcRenderer.invoke("memory:remember", preview, confirmationToken, confirmed, sessionId),
    listMemoryStructuredEntries: (cwd, scope) => ipcRenderer.invoke("memory:structured:list", cwd, scope),
    previewDeleteMemoryEntry: (cwd, entryId) => ipcRenderer.invoke("memory:structured:delete:preview", cwd, entryId),
    deleteMemoryEntry: (preview, confirmationToken, confirmed) => ipcRenderer.invoke("memory:structured:delete", preview, confirmationToken, confirmed),
    deleteSessionMemory: (cwd, entryId, confirmed) => ipcRenderer.invoke("memory:session:delete", cwd, entryId, confirmed),
    clearMemory: (cwd, scope, confirmed) => ipcRenderer.invoke("memory:clear", cwd, scope, confirmed),
    runMemoryCommand: (sessionId, command) => ipcRenderer.invoke("memory:command", sessionId, command),
    listAgentDefinitions: (cwd) => ipcRenderer.invoke("agents:list", cwd),
    validateAgentDefinition: (rawMarkdown, expectedName) => ipcRenderer.invoke("agents:validate", rawMarkdown, expectedName),
    saveAgentDefinition: (input) => ipcRenderer.invoke("agents:save", input),
    copyAgentDefinition: (cwd, sourcePath, targetSource, newName) => ipcRenderer.invoke("agents:copy", cwd, sourcePath, targetSource, newName),
    renameAgentDefinition: (cwd, sourcePath, newName) => ipcRenderer.invoke("agents:rename", cwd, sourcePath, newName),
    setAgentDefinitionEnabled: (cwd, sourcePath, enabled) => ipcRenderer.invoke("agents:toggle", cwd, sourcePath, enabled),
    deleteAgentDefinition: (cwd, sourcePath, confirmed) => ipcRenderer.invoke("agents:delete", cwd, sourcePath, confirmed),
    listPersonaDefinitions: (cwd) => ipcRenderer.invoke("personas:list", cwd),
    validatePersonaDefinition: (rawToml) => ipcRenderer.invoke("personas:validate", rawToml),
    savePersonaDefinition: (input) => ipcRenderer.invoke("personas:save", input),
    copyPersonaDefinition: (cwd, sourcePath, targetSource, newName) => ipcRenderer.invoke("personas:copy", cwd, sourcePath, targetSource, newName),
    renamePersonaDefinition: (cwd, sourcePath, newName) => ipcRenderer.invoke("personas:rename", cwd, sourcePath, newName),
    setPersonaDefinitionEnabled: (cwd, sourcePath, enabled) => ipcRenderer.invoke("personas:toggle", cwd, sourcePath, enabled),
    deletePersonaDefinition: (cwd, sourcePath, confirmed) => ipcRenderer.invoke("personas:delete", cwd, sourcePath, confirmed),
    listExecutionProfiles: (cwd) => ipcRenderer.invoke("profiles:list", cwd),
    validateExecutionProfile: (profile) => ipcRenderer.invoke("profiles:validate", profile),
    saveExecutionProfile: (input) => ipcRenderer.invoke("profiles:save", input),
    deleteExecutionProfile: (cwd, profileId, confirmed) => ipcRenderer.invoke("profiles:delete", cwd, profileId, confirmed),
    getSessionExecutionAssignment: (sessionId) => ipcRenderer.invoke("profiles:assignment", sessionId),
    getAgentDashboard: (query) => ipcRenderer.invoke("dashboard:get", query),
    stopAgentDashboardNode: (nodeId) => ipcRenderer.invoke("dashboard:stop", nodeId),
    clearAgentDashboardRecord: (nodeId) => ipcRenderer.invoke("dashboard:clear", nodeId),
  inspectAttachmentPrivacy: (cwd, attachments) => ipcRenderer.invoke("attachment:inspect-privacy", cwd, attachments),
  listSessions: (cwd, query) => ipcRenderer.invoke("session:list", cwd, query),
  createSession: (cwd) => ipcRenderer.invoke("session:create", cwd),
  openSession: (cwd, id) => ipcRenderer.invoke("session:open", cwd, id),
  renameSession: (id, title) => ipcRenderer.invoke("session:rename", id, title),
  deleteSession: (cwd, id) => ipcRenderer.invoke("session:delete", cwd, id),
  clearSessions: (cwd, keep) => ipcRenderer.invoke("session:clear", cwd, keep),
  pinSession: (id, pinned) => ipcRenderer.invoke("session:pin", id, pinned),
  exportSessionMarkdown: (cwd, id) => ipcRenderer.invoke("session:export-markdown", cwd, id),
  getMediaCapabilities: (id) => ipcRenderer.invoke("session:media-capabilities", id),
  sendPrompt: (input) => ipcRenderer.invoke("session:send", input.sessionId, input.text, input.attachments, input.clientMessageId),
  getOfflineUiFixture: () => ipcRenderer.invoke("ui-fixture:get"),
  enqueuePrompt: (sessionId, text, attachments, clientMessageId) => ipcRenderer.invoke("session:enqueue", sessionId, text, attachments, clientMessageId),
  interjectPrompt: (sessionId, text, attachments, clientMessageId) => ipcRenderer.invoke("session:interject", sessionId, text, attachments, clientMessageId),
  editQueuedPrompt: (sessionId, id, text) => ipcRenderer.invoke("session:queue:edit", sessionId, id, text),
  removeQueuedPrompt: (sessionId, id) => ipcRenderer.invoke("session:queue:remove", sessionId, id),
  reorderQueuedPrompt: (sessionId, id, position) => ipcRenderer.invoke("session:queue:reorder", sessionId, id, position),
  clearPromptQueue: (sessionId) => ipcRenderer.invoke("session:queue:clear", sessionId),
  interjectQueuedPrompt: (sessionId, id, text) => ipcRenderer.invoke("session:queue:interject", sessionId, id, text),
  forkSession: (sessionId, pointId, launch) => ipcRenderer.invoke("session:fork", sessionId, pointId, launch),
  listRewindPoints: (sessionId) => ipcRenderer.invoke("session:rewind-points", sessionId),
  rewindSession: (sessionId, pointId, mode) => ipcRenderer.invoke("session:rewind", sessionId, pointId, mode),
  archiveSession: (sessionId, archived) => ipcRenderer.invoke("session:archive", sessionId, archived),
  listBackgroundTasks: () => ipcRenderer.invoke("tasks:list"),
  killBackgroundTask: (id) => ipcRenderer.invoke("tasks:kill", id),
  listInbox: () => ipcRenderer.invoke("inbox:list"),
  markInboxRead: (id, read) => ipcRenderer.invoke("inbox:mark-read", id, read),
  clearInbox: () => ipcRenderer.invoke("inbox:clear"),
  cancelSession: (id) => ipcRenderer.invoke("session:cancel", id),
  setModel: (id, model) => ipcRenderer.invoke("session:model", id, model),
  setEffort: (id, effort: ReasoningEffort) => ipcRenderer.invoke("session:effort", id, effort),
  setMode: (id, mode: SessionMode) => ipcRenderer.invoke("session:mode", id, mode),
  respondPermission: (id, requestId, optionId) => ipcRenderer.invoke("permission:respond", id, requestId, optionId),
  respondQuestion: (id, requestId, answers) => ipcRenderer.invoke("question:respond", id, requestId, answers),
  respondPlan: (id, requestId, verdict, comment) => ipcRenderer.invoke("plan:respond", id, requestId, verdict, comment),
  pickAttachments: () => ipcRenderer.invoke("attachments:pick"),
  pickAttachmentFolders: () => ipcRenderer.invoke("attachments:pick-folders"),
  attachmentsFromPaths: (paths) => ipcRenderer.invoke("attachments:paths", paths),
  openPath: (path) => ipcRenderer.invoke("system:open-path", path),
  openExternal: (url) => ipcRenderer.invoke("system:open-external", url),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (patch: Partial<AppSettings>) => ipcRenderer.invoke("settings:update", patch),
  getTheme: () => ipcRenderer.invoke("theme:get"),
  updateTheme: (patch) => ipcRenderer.invoke("theme:update", patch),
  pickThemeBackground: () => ipcRenderer.invoke("theme:pick-background"),
  removeThemeBackground: () => ipcRenderer.invoke("theme:remove-background"),
  listAccounts: () => ipcRenderer.invoke("auth:list"),
  loginDevice: () => ipcRenderer.invoke("auth:login-device"),
  loginApiKey: (label, key) => ipcRenderer.invoke("auth:login-api-key", label, key),
  logout: () => ipcRenderer.invoke("auth:logout"),
  switchAccount: (id) => ipcRenderer.invoke("auth:switch", id),
  removeAccount: (id) => ipcRenderer.invoke("auth:remove", id),
  listCodexSessions: (cwd, includeArchived, force) => ipcRenderer.invoke("codex:list", cwd, includeArchived, force),
  openCodexSession: (id) => ipcRenderer.invoke("codex:open", id),
  refreshCodexSession: (id) => ipcRenderer.invoke("codex:refresh", id),
  hideCodexSession: (id, hidden) => ipcRenderer.invoke("codex:hide", id, hidden),
  continueCodexSession: (id) => ipcRenderer.invoke("codex:continue", id),
  getQuota: (force) => ipcRenderer.invoke("quota:get", force),
  listProviders: () => ipcRenderer.invoke("providers:list"),
  upsertProvider: (input) => ipcRenderer.invoke("providers:upsert", input),
  removeProvider: (id) => ipcRenderer.invoke("providers:remove", id),
  testProvider: (id) => ipcRenderer.invoke("providers:test", id),
  pullProviderModels: (id) => ipcRenderer.invoke("providers:pull-models", id),
  probeProviderDraft: (input) => ipcRenderer.invoke("providers:probe-draft", input),
  discoverProviderModels: (input) => ipcRenderer.invoke("providers:discover-models", input),
  setProviderDesktopDefault: (modelId) => ipcRenderer.invoke("providers:set-desktop-default", modelId),
  setProviderCliDefault: (modelId) => ipcRenderer.invoke("providers:set-cli-default", modelId),
  reloadProviders: () => ipcRenderer.invoke("providers:reload"),
  listAutomations: () => ipcRenderer.invoke("automations:list"),
  createAutomation: (input) => ipcRenderer.invoke("automations:create", input),
  updateAutomation: (id, patch) => ipcRenderer.invoke("automations:update", id, patch),
  deleteAutomation: (id) => ipcRenderer.invoke("automations:delete", id),
  pauseAutomation: (id, paused) => ipcRenderer.invoke("automations:pause", id, paused),
  runAutomationNow: (id) => ipcRenderer.invoke("automations:run-now", id),
  listAutomationRuns: (taskId) => ipcRenderer.invoke("automations:runs", taskId),
  getAutomationGlobalPolicy: () => ipcRenderer.invoke("automations:policy:get"),
  updateAutomationGlobalPolicy: (patch) => ipcRenderer.invoke("automations:policy:update", patch),
  applyAutomationPolicyToAll: () => ipcRenderer.invoke("automations:policy:apply-all"),
  respondAutomationPending: (id, approved) => ipcRenderer.invoke("automations:pending:respond", id, approved),
  repairAutomationRegistrations: () => ipcRenderer.invoke("automations:repair"),
  checkAutomationHealth: (repair) => ipcRenderer.invoke(repair ? "automations:health:repair" : "automations:health:check"),
  clearAutomationContext: (id) => ipcRenderer.invoke("automations:clear-context", id),
  getDraft: (key) => ipcRenderer.invoke("draft:get", key),
  setDraft: (key, text, capability) => ipcRenderer.invoke("draft:set", key, text, capability),
  clearDraft: (key) => ipcRenderer.invoke("draft:clear", key),
  listPromptHistory: (cwd) => ipcRenderer.invoke("prompt-history:list", cwd),
  appendPromptHistory: (cwd, text) => ipcRenderer.invoke("prompt-history:append", cwd, text),
  listPlugins: (force) => ipcRenderer.invoke("extensions:plugins:list", force),
  getPluginDetails: (id) => ipcRenderer.invoke("extensions:plugins:details", id),
  previewPlugin: (source) => ipcRenderer.invoke("extensions:plugins:preview", source),
  pluginAction: (id, action) => ipcRenderer.invoke("extensions:plugins:action", id, action),
  installPlugin: (source, trust, expectedFingerprint) => ipcRenderer.invoke("extensions:plugins:install", source, trust, expectedFingerprint),
  listMarketplace: (force) => ipcRenderer.invoke("extensions:marketplace:list", force),
  installMarketplacePlugin: (source, name, trust) => ipcRenderer.invoke("extensions:marketplace:install", source, name, trust),
  listSkills: () => ipcRenderer.invoke("extensions:skills:list"),
  listMcpServers: (force) => ipcRenderer.invoke("extensions:mcp:list", force),
  diagnoseMcp: (name) => ipcRenderer.invoke("extensions:mcp:diagnose", name),
  toggleMcp: (name, enabled) => ipcRenderer.invoke("extensions:mcp:toggle", name, enabled),
  upsertMcp: (input) => ipcRenderer.invoke("extensions:mcp:upsert", input),
  triggerMcpAuth: (name) => ipcRenderer.invoke("extensions:mcp:auth", name),
  removeMcp: (name) => ipcRenderer.invoke("extensions:mcp:remove", name),
  listHooks: () => ipcRenderer.invoke("extensions:hooks:list"),
  reloadExtensions: () => ipcRenderer.invoke("extensions:reload"),
  scanCodexPlugins: (force) => ipcRenderer.invoke("extensions:codex:scan", force),
  adaptCodexPlugin: (id) => ipcRenderer.invoke("extensions:codex:adapt", id),
  removeCodexPluginAdapter: (id) => ipcRenderer.invoke("extensions:codex:remove-adapter", id),
  getComputerCapability: () => ipcRenderer.invoke("computer:capability"),
  listComputerApps: () => ipcRenderer.invoke("computer:list-apps"),
  listComputerWindows: (appId) => ipcRenderer.invoke("computer:list-windows", appId),
  startComputer: (input) => ipcRenderer.invoke("computer:start", input),
  pauseComputer: (sessionId) => ipcRenderer.invoke("computer:pause", sessionId),
  resumeComputer: (sessionId) => ipcRenderer.invoke("computer:resume", sessionId),
  stopComputer: (sessionId) => ipcRenderer.invoke("computer:stop", sessionId),
  respondComputerAppPermission: (requestId, decision) => ipcRenderer.invoke("computer:permission", requestId, decision),
  respondComputerRisk: (requestId, approved) => ipcRenderer.invoke("computer:risk", requestId, approved),
  getComputerSettings: () => ipcRenderer.invoke("computer:settings:get"),
  updateComputerSettings: (patch) => ipcRenderer.invoke("computer:settings:update", patch),
  checkCliUpdate: () => ipcRenderer.invoke("cli:check-update"),
  applyCliUpdate: () => ipcRenderer.invoke("cli:apply-update"),
  getCliUpdateHistory: () => ipcRenderer.invoke("cli:update-history"),
  exportLogs: () => ipcRenderer.invoke("logs:export"),
  onEvent: (listener: (event: ChatEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: ChatEvent): void => listener(value);
    ipcRenderer.on("grok:event", handler);
    return () => ipcRenderer.removeListener("grok:event", handler);
  },
  onLogin: (listener: (state: LoginState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: LoginState): void => listener(value);
    ipcRenderer.on("grok:login", handler);
    return () => ipcRenderer.removeListener("grok:login", handler);
  },
  onDroppedAttachments: (listener) => {
    droppedAttachmentListeners.add(listener);
    return () => droppedAttachmentListeners.delete(listener);
  },
  onNavigateSession: (listener) => {
    navigateSessionListeners.add(listener);
    return () => navigateSessionListeners.delete(listener);
  },
  onMenuCommand: (listener) => {
    menuCommandListeners.add(listener);
    return () => menuCommandListeners.delete(listener);
  },
  onComputerStateChanged: (listener) => {
    computerStateListeners.add(listener);
    return () => computerStateListeners.delete(listener);
  },
  onAutomationEvent: (listener) => {
    automationEventListeners.add(listener);
    return () => automationEventListeners.delete(listener);
  },
};

contextBridge.exposeInMainWorld("grokDesktop", api);
