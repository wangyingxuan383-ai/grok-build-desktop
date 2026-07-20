import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import type { AppController } from "./app-controller";
import type { AppSettings, Attachment, AutomationGlobalPolicy, AutomationTaskInput, ComposerCapabilitySelection, ComputerUseSettings, CustomProviderInput, McpServerInput, OnboardingState, ReasoningEffort, SessionMode, ThemeSettings } from "../shared/types";
import { isTrustedRendererFrame, type RendererTrustPolicy } from "./security-policy";

export function registerIpc(controller: AppController, window: BrowserWindow, policy: RendererTrustPolicy): void {
  const handle = <Args extends unknown[]>(channel: string, action: (...args: Args) => unknown): void => {
    ipcMain.handle(channel, (event, ...args) => {
      assertTrustedIpcSender(event, window, policy);
      return action(...args as Args);
    });
  };

  handle("app:bootstrap", () => controller.bootstrap());
  handle("app:build-info", () => controller.getBuildInfo());
  handle("onboarding:get", () => controller.getOnboarding());
  handle("onboarding:update", (patch: Partial<OnboardingState>) => controller.updateOnboarding(patch));
  handle("onboarding:reset", () => controller.resetOnboarding());
  handle("diagnostics:run", () => controller.runDiagnostics());
  handle("diagnostics:support-preview", () => controller.previewSupportBundle());
  handle("diagnostics:support-export", () => controller.exportSupportBundle());
  handle("app-update:check", (force?: boolean) => controller.checkAppUpdate(force));
  handle("app-update:open", (url?: string) => controller.openAppRelease(url));
  handle("workspace:choose", () => controller.chooseWorkspace());
  handle("workspace:set", (cwd: string) => controller.setWorkspace(cwd));
  handle("workspace:discover", (force?: boolean) => controller.discoverWorkspaces(force));
  handle("workspace:pin", (cwd: string, pinned: boolean) => controller.pinWorkspace(cwd, pinned));
  handle("workspace:search-files", (cwd: string, query: string, limit?: number) => controller.searchWorkspaceFiles(cwd, query, limit));
  handle("attachment:inspect-privacy", (cwd: string, attachments: Attachment[]) => controller.inspectAttachmentPrivacy(cwd, attachments));
  handle("session:list", (cwd?: string, query?: string) => controller.listSessions(cwd, query));
  handle("session:create", (cwd: string) => controller.createSession(cwd));
  handle("session:open", (cwd: string, id: string) => controller.openSession(cwd, id));
  handle("session:rename", (id: string, title: string) => controller.renameSession(id, title));
  handle("session:delete", (cwd: string, id: string) => controller.deleteSession(cwd, id));
  handle("session:clear", (cwd: string, keep?: string) => controller.clearSessions(cwd, keep));
  handle("session:pin", (id: string, pinned: boolean) => controller.pinSession(id, pinned));
  handle("session:export-markdown", (cwd: string, id: string) => controller.exportSessionMarkdown(cwd, id));
  handle("session:media-capabilities", (id: string) => controller.getMediaCapabilities(id));
  handle("session:send", (id: string, text: string, attachments: Attachment[]) => controller.sendPrompt(id, text, attachments));
  handle("session:enqueue", (id: string, text: string, attachments: Attachment[]) => controller.enqueuePrompt(id, text, attachments));
  handle("session:interject", (id: string, text: string, attachments: Attachment[]) => controller.interjectPrompt(id, text, attachments));
  handle("session:queue:edit", (sessionId: string, id: string, text: string) => controller.editQueuedPrompt(sessionId, id, text));
  handle("session:queue:remove", (sessionId: string, id: string) => controller.removeQueuedPrompt(sessionId, id));
  handle("session:queue:reorder", (sessionId: string, id: string, position: number) => controller.reorderQueuedPrompt(sessionId, id, position));
  handle("session:queue:clear", (sessionId: string) => controller.clearPromptQueue(sessionId));
  handle("session:queue:interject", (sessionId: string, id: string, text?: string) => controller.interjectQueuedPrompt(sessionId, id, text));
  handle("session:fork", (sessionId: string, pointId?: string) => controller.forkSession(sessionId, pointId));
  handle("session:rewind-points", (sessionId: string) => controller.listRewindPoints(sessionId));
  handle("session:rewind", (sessionId: string, pointId: string, mode: "conversation" | "conversation-and-files" | "files") => controller.rewindSession(sessionId, pointId, mode));
  handle("session:archive", (sessionId: string, archived: boolean) => controller.archiveSession(sessionId, archived));
  handle("tasks:list", () => controller.listBackgroundTasks());
  handle("tasks:kill", (id: string) => controller.killBackgroundTask(id));
  handle("inbox:list", () => controller.listInbox());
  handle("inbox:mark-read", (id: string, read: boolean) => controller.markInboxRead(id, read));
  handle("inbox:clear", () => controller.clearInbox());
  handle("session:cancel", (id: string) => controller.cancelSession(id));
  handle("session:model", (id: string, model: string) => controller.setModel(id, model));
  handle("session:effort", (id: string, effort: ReasoningEffort) => controller.setEffort(id, effort));
  handle("session:mode", (id: string, mode: SessionMode) => controller.setMode(id, mode));
  handle("permission:respond", (id: string, requestId: string | number, optionId: string) => controller.respondPermission(id, requestId, optionId));
  handle("question:respond", (id: string, requestId: string | number, answers: Record<string, string>) => controller.respondQuestion(id, requestId, answers));
  handle("plan:respond", (id: string, requestId: string | number | undefined, verdict: "approved" | "rejected" | "cancelled", comment?: string) => controller.respondPlan(id, requestId, verdict, comment));
  handle("attachments:pick", () => controller.pickAttachments());
  handle("attachments:pick-folders", () => controller.pickAttachmentFolders());
  handle("attachments:paths", (paths: string[]) => controller.attachmentsFromPaths(paths));
  handle("system:open-path", (path: string) => controller.openPath(path));
  handle("system:open-external", (url: string) => controller.openExternal(url));
  handle("settings:get", () => controller.getSettings());
  handle("settings:update", (patch: Partial<AppSettings>) => controller.updateSettings(patch));
  handle("theme:get", () => controller.getTheme());
  handle("theme:update", (patch: Partial<ThemeSettings>) => controller.updateTheme(patch));
  handle("theme:pick-background", () => controller.pickThemeBackground());
  handle("theme:remove-background", () => controller.removeThemeBackground());
  handle("auth:list", () => controller.listAccounts());
  handle("auth:login-device", () => controller.loginDevice());
  handle("auth:login-api-key", (label: string, key: string) => controller.loginApiKey(label, key));
  handle("auth:logout", () => controller.logout());
  handle("auth:switch", (id: string) => controller.switchAccount(id));
  handle("auth:remove", (id: string) => controller.removeAccount(id));
  handle("codex:list", (cwd: string, includeArchived?: boolean, force?: boolean) => controller.listCodexSessions(cwd, includeArchived, force));
  handle("codex:open", (id: string) => controller.openCodexSession(id));
  handle("codex:refresh", (id: string) => controller.refreshCodexSession(id));
  handle("codex:hide", (id: string, hidden?: boolean) => controller.hideCodexSession(id, hidden));
  handle("codex:continue", (id: string) => controller.continueCodexSession(id));
  handle("quota:get", (force?: boolean) => controller.getQuota(force));
  handle("providers:list", () => controller.listProviders());
  handle("providers:upsert", (input: CustomProviderInput) => controller.upsertProvider(input));
  handle("providers:remove", (id: string) => controller.removeProvider(id));
  handle("providers:test", (id: string) => controller.testProvider(id));
  handle("providers:pull-models", (id: string) => controller.pullProviderModels(id));
  handle("providers:set-desktop-default", (modelId: string) => controller.setProviderDesktopDefault(modelId));
  handle("providers:set-cli-default", (modelId: string) => controller.setProviderCliDefault(modelId));
  handle("providers:reload", () => controller.reloadProviders());
  handle("automations:list", () => controller.listAutomations());
  handle("automations:create", (input: AutomationTaskInput) => controller.createAutomation(input));
  handle("automations:update", (id: string, patch: Partial<AutomationTaskInput>) => controller.updateAutomation(id, patch));
  handle("automations:delete", (id: string) => controller.deleteAutomation(id));
  handle("automations:pause", (id: string, paused: boolean) => controller.pauseAutomation(id, paused));
  handle("automations:run-now", (id: string) => controller.runAutomationNow(id));
  handle("automations:runs", (taskId?: string) => controller.listAutomationRuns(taskId));
  handle("automations:policy:get", () => controller.getAutomationGlobalPolicy());
  handle("automations:policy:update", (patch: Partial<AutomationGlobalPolicy>) => controller.updateAutomationGlobalPolicy(patch));
  handle("automations:policy:apply-all", () => controller.applyAutomationPolicyToAll());
  handle("automations:pending:respond", (id: string, approved: boolean) => controller.respondAutomationPending(id, approved));
  handle("automations:repair", () => controller.repairAutomationRegistrations());
  handle("draft:get", (key: string) => controller.getDraft(key));
  handle("draft:set", (key: string, text: string, capability?: ComposerCapabilitySelection) => controller.setDraft(key, text, capability));
  handle("draft:clear", (key: string) => controller.clearDraft(key));
  handle("prompt-history:list", (cwd: string) => controller.listPromptHistory(cwd));
  handle("prompt-history:append", (cwd: string, text: string) => controller.appendPromptHistory(cwd, text));
  handle("extensions:plugins:list", (force?: boolean) => controller.listPlugins(force));
  handle("extensions:plugins:details", (id: string) => controller.getPluginDetails(id));
  handle("extensions:plugins:preview", (source: string) => controller.previewPlugin(source));
  handle("extensions:plugins:action", (id: string, action: "enable" | "disable" | "update" | "uninstall" | "reload") => controller.pluginAction(id, action));
  handle("extensions:plugins:install", (source: string, trust: boolean, expectedFingerprint?: string) => controller.installPlugin(source, trust, expectedFingerprint));
  handle("extensions:marketplace:list", (force?: boolean) => controller.listMarketplace(force));
  handle("extensions:marketplace:install", (source: string, name: string, trust: boolean) => controller.installMarketplacePlugin(source, name, trust));
  handle("extensions:skills:list", () => controller.listSkills());
  handle("extensions:mcp:list", (force?: boolean) => controller.listMcpServers(force));
  handle("extensions:mcp:diagnose", (name?: string) => controller.diagnoseMcp(name));
  handle("extensions:mcp:toggle", (name: string, enabled: boolean) => controller.toggleMcp(name, enabled));
  handle("extensions:mcp:upsert", (input: McpServerInput) => controller.upsertMcp(input));
  handle("extensions:mcp:auth", (name: string) => controller.triggerMcpAuth(name));
  handle("extensions:mcp:remove", (name: string) => controller.removeMcp(name));
  handle("extensions:hooks:list", () => controller.listHooks());
  handle("extensions:reload", () => controller.reloadExtensions());
  handle("extensions:codex:scan", (force?: boolean) => controller.scanCodexPlugins(force));
  handle("extensions:codex:adapt", (id: string) => controller.adaptCodexPlugin(id));
  handle("extensions:codex:remove-adapter", (id: string) => controller.removeCodexPluginAdapter(id));
  handle("computer:capability", () => controller.getComputerCapability());
  handle("computer:list-apps", () => controller.listComputerApps());
  handle("computer:list-windows", (appId?: string) => controller.listComputerWindows(appId));
  handle("computer:start", (input: { sessionId: string; appId: string; windowId?: string }) => controller.startComputer(input));
  handle("computer:pause", (sessionId: string) => controller.pauseComputer(sessionId));
  handle("computer:resume", (sessionId: string) => controller.resumeComputer(sessionId));
  handle("computer:stop", (sessionId: string) => controller.stopComputer(sessionId));
  handle("computer:permission", (requestId: string, decision: "once" | "always" | "deny") => controller.respondComputerAppPermission(requestId, decision));
  handle("computer:risk", (requestId: string, approved: boolean) => controller.respondComputerRisk(requestId, approved));
  handle("computer:settings:get", () => controller.getComputerSettings());
  handle("computer:settings:update", (patch: Partial<ComputerUseSettings>) => controller.updateComputerSettings(patch));
  handle("cli:check-update", () => controller.checkCliUpdate());
  handle("cli:apply-update", () => controller.applyCliUpdate());
  handle("cli:update-history", () => controller.getCliUpdateHistory());
  handle("logs:export", () => controller.exportLogs());
}

function assertTrustedIpcSender(event: IpcMainInvokeEvent, window: BrowserWindow, policy: RendererTrustPolicy): void {
  const frame = event.senderFrame;
  const mainFrame = event.sender.mainFrame;
  if (window.isDestroyed() || event.sender.isDestroyed() || !frame || !mainFrame || !isTrustedRendererFrame({
    expectedWebContentsId: window.webContents.id,
    senderWebContentsId: event.sender.id,
    frameProcessId: frame.processId,
    frameRoutingId: frame.routingId,
    mainFrameProcessId: mainFrame.processId,
    mainFrameRoutingId: mainFrame.routingId,
    frameUrl: frame.url,
  }, policy)) {
    throw new Error("拒绝来自非受信任页面或子框架的 IPC 调用");
  }
}
