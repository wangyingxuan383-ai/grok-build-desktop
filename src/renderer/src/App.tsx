import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { VirtuosoHandle } from "react-virtuoso";
import type { AppMenuCommand, AppSettings, Attachment, ChatEvent, ClaudeSessionDetail, ClaudeSessionSummary, CodexSessionDetail, CodexSessionSummary, ComposerCapabilitySelection, ComputerAppPermissionRequest, ComputerRiskConfirmation, ComputerTaskState, ComputerUseSettings, CustomProviderProfile, ExecutionProfileLaunchInput, GitRepositoryStatus, GrokQuotaSnapshot, GrokWorktreeSummary, MediaAspectRatio, MediaCreationKind, MediaCreationRequest, MediaGenerationJob, MediaVideoDuration, MediaVideoResolution, NavigationIntent, NewTaskDraft, PromptQueueEntry, ReasoningEffort, RewindPoint, SessionExecutionAssignment, SessionExecutionProfile, SessionMode, SessionOriginKind, SessionSummary, SkillSummary, ThemeSettings, TurnFailure, WorkspaceFileCandidate, WorkspaceSummary } from "../../shared/types";
import { resolveComputerMention } from "../../shared/computer-mentions";
import { buildComposerCommand, normalizeSkillCommand } from "../../shared/composer-capability";
import { LazyMarkdownView } from "./components/LazyMarkdownView";
import { buildChatTurns, useAppStore } from "./store";
import { resolveMediaSessionTarget } from "./media-session-target";
import { hasSessionSubmission, sessionSubmissionKeys, updateSessionSubmissions } from "./session-submission-state";
import { useWorkbenchStore, type WorkbenchView } from "./workbench-store";
import { applyShellPreferencesToDocument, applyThemeToDocument, cacheThemeForEarlyStartup, contrastRatio, DARK_COLORS, LIGHT_COLORS, themeBackgroundClass } from "./theme";
import { groupSessionsByOrigin, sessionSourceLabel } from "./session-groups";
import { effortControlState } from "./model-capabilities";
import { useWorktreeStore } from "./worktree-store";
import { useGitStore } from "./git-store";
import { UiIcon, type UiIconName } from "./ui-icons";
import { TokenActivityPanel } from "./components/TokenActivityPanel";
import type { RightTool } from "./components/RightUtilityPane";
import { Composer } from "./components/Composer";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { findStaleReviewComment, formatReviewComments, type ReviewCommentDraft } from "./review-comments";
import { useOverlayFocusTrap } from "./hooks/use-overlay-focus-trap";
import { ActionDialog, ComputerPermissionDialog, ComputerRiskDialog, type DialogState } from "./components/AppDialogs";
import { ControlPanel, SessionHistoryPanel } from "./components/AppAuxiliaryPanels";
import { RightDock } from "./components/RightDock";
import { useSessionDraft } from "./hooks/use-session-draft";
import { ConversationViewport } from "./components/ConversationViewport";
import { useShallow } from "zustand/react/shallow";
import { useConversationDerivedState } from "./hooks/use-conversation-derived-state";
import { useNavigationController } from "./hooks/use-navigation-controller";

const LazyExtensionsPanel = lazy(() => import("./components/ExtensionsPanel").then((module) => ({ default: module.ExtensionsPanel })));
const LazyDiagnosticsPanel = lazy(() => import("./components/DiagnosticsPanel").then((module) => ({ default: module.DiagnosticsPanel })));
const LazyOnboardingPanel = lazy(() => import("./components/OnboardingPanel").then((module) => ({ default: module.OnboardingPanel })));
const LazyProviderManagerDialog = lazy(() => import("./components/ProviderManagerDialog").then((module) => ({ default: module.ProviderManagerDialog })));
const LazyTaskCenterPanel = lazy(() => import("./components/TaskCenterPanel").then((module) => ({ default: module.TaskCenterPanel })));
const LazyFileWorkbench = lazy(() => import("./components/FileWorkbench").then((module) => ({ default: module.FileWorkbench })));
const LazyGitWorkbench = lazy(() => import("./components/GitWorkbench").then((module) => ({ default: module.GitWorkbench })));
const LazyWorktreeWorkbench = lazy(() => import("./components/WorktreeWorkbench").then((module) => ({ default: module.WorktreeWorkbench })));
const LazyMemoryWorkbench = lazy(() => import("./components/MemoryWorkbench").then((module) => ({ default: module.MemoryWorkbench })));
const LazyAgentPersonaWorkbench = lazy(() => import("./components/AgentPersonaWorkbench").then((module) => ({ default: module.AgentPersonaWorkbench })));
const LazyExecutionProfileWorkbench = lazy(() => import("./components/ExecutionProfileWorkbench").then((module) => ({ default: module.ExecutionProfileWorkbench })));
const LazyAgentDashboardWorkbench = lazy(() => import("./components/AgentDashboardWorkbench").then((module) => ({ default: module.AgentDashboardWorkbench })));
const LazyFailureDiagnosisPanel = lazy(() => import("./components/FailureDiagnosisPanel").then((module) => ({ default: module.FailureDiagnosisPanel })));
const LazyMediaStudioPanel = lazy(() => import("./components/MediaStudioPanel").then((module) => ({ default: module.MediaStudioPanel })));

type Panel = "settings" | "accounts" | "providers" | "about" | "media" | "extensions" | "diagnostics" | "onboarding" | "tasks" | "history" | null;
export default function App(): React.JSX.Element {
  const store = useAppStore(useShallow((state) => ({
    accounts: state.accounts,
    activeSessionId: state.activeSessionId,
    addAttachments: state.addAttachments,
    appVersion: state.appVersion,
    attachments: state.attachments,
    claudeSessions: state.claudeSessions,
    clearAttachments: state.clearAttachments,
    cli: state.cli,
    codexSessions: state.codexSessions,
    error: state.error,
    handleEvent: state.handleEvent,
    loading: state.loading,
    onboarding: state.onboarding,
    removeAttachment: state.removeAttachment,
    resolveMessage: state.resolveMessage,
    sessions: state.sessions,
    setActiveSession: state.setActiveSession,
    setClaudeSessions: state.setClaudeSessions,
    setCodexSessions: state.setCodexSessions,
    setError: state.setError,
    setOnboarding: state.setOnboarding,
    setSessions: state.setSessions,
    setSettings: state.setSettings,
    settings: state.settings,
    setWorkspaces: state.setWorkspaces,
    workspaces: state.workspaces,
  })));
  const view = useAppStore((state) => state.views[state.activeSessionId]);
  const draftModels = useAppStore(useShallow((state) => Array.from(new Map(Object.values(state.views).flatMap((candidate) => candidate.models).map((model) => [model.modelId, model])).values())));
  const activeWorkbenchView = useWorkbenchStore((state) => state.activeView);
  const setWorkbenchView = useWorkbenchStore((state) => state.setActiveView);
  const [panel, setPanel] = useState<Panel>(null);
  const [search, setSearch] = useState("");
  const [activeCodexId, setActiveCodexId] = useState("");
  const [codexDetail, setCodexDetail] = useState<CodexSessionDetail | null>(null);
  const [activeClaudeId, setActiveClaudeId] = useState("");
  const [claudeDetail, setClaudeDetail] = useState<ClaudeSessionDetail | null>(null);
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [operationBusy, setOperationBusy] = useState(false);
  const [sendingSessionIds, setSendingSessionIds] = useState<ReadonlySet<string>>(() => new Set());
  const [composerNotice, setComposerNotice] = useState("");
  const [diagnosingFailure, setDiagnosingFailure] = useState<TurnFailure>();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [computerTasks, setComputerTasks] = useState<Record<string, ComputerTaskState>>({});
  const [computerPermissions, setComputerPermissions] = useState<Record<string, ComputerAppPermissionRequest>>({});
  const [computerRisks, setComputerRisks] = useState<Record<string, ComputerRiskConfirmation>>({});
  const [fileMatches, setFileMatches] = useState<WorkspaceFileCandidate[]>([]);
  const [conversationSearch, setConversationSearch] = useState("");
  const [conversationSearchOpen, setConversationSearchOpen] = useState(false);
  const [conversationMatch, setConversationMatch] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth < 1000);
  const [rightTool, setRightTool] = useState<RightTool | null>(null);
  const [reviewInitialScope, setReviewInitialScope] = useState<"unstaged" | "last-turn">("unstaged");

  useEffect(() => {
    if (!composerNotice) return;
    const timer = window.setTimeout(() => setComposerNotice((current) => current === composerNotice ? "" : current), 5_000);
    return () => window.clearTimeout(timer);
  }, [composerNotice]);
  const [reviewComments, setReviewComments] = useState<ReviewCommentDraft[]>([]);
  const [executionAssignment, setExecutionAssignment] = useState<SessionExecutionAssignment>();
  const [offlineFixtureActive, setOfflineFixtureActive] = useState(false);
  const [returnToOnboarding, setReturnToOnboarding] = useState(false);
  const activeComputerPermission = computerPermissions[store.activeSessionId] ?? null;
  const activeComputerRisk = computerRisks[store.activeSessionId] ?? null;
  const hasBlockingOverlay = Boolean(panel || dialog || activeComputerPermission || activeComputerRisk);
  useOverlayFocusTrap(hasBlockingOverlay);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const atBottomRef = useRef(true);
  const forceFollowRef = useRef(false);
  const followTurnRef = useRef(false);
  const openRequestRef = useRef(0);
  const listRequestRef = useRef(0);
  const offlineFixtureRef = useRef(false);
  const openConversationTargetRef = useRef<(target: { cwd: string; sessionId: string }) => Promise<void>>(async () => undefined);
  const sendingSessionIdsRef = useRef<ReadonlySet<string>>(new Set());

  const updateSendingSessions = useCallback((keys: Iterable<string>, active: boolean) => {
    const next = updateSessionSubmissions(sendingSessionIdsRef.current, keys, active);
    sendingSessionIdsRef.current = next;
    setSendingSessionIds(next);
  }, []);

  const focusComposer = useCallback(() => {
    if (useWorkbenchStore.getState().activeView !== "chat") return;
    // Portaled controls may unmount in a later React commit. Focus once after
    // the current event and once after that commit so removing the focused
    // palette/dialog button cannot leave focus on <body>.
    window.setTimeout(() => composerRef.current?.focus({ preventScroll: true }), 0);
    window.setTimeout(() => composerRef.current?.focus({ preventScroll: true }), 60);
  }, []);

  const scrollConversationNow = useCallback((behavior: "auto" | "smooth" = "auto") => {
    const current = useAppStore.getState().views[useAppStore.getState().activeSessionId];
    const index = buildChatTurns(current?.messages ?? [], current?.status).length - 1;
    if (index < 0) return;
    // react-virtuoso's index API positions the virtual item, while the native
    // scroller removes any residual offset caused by late Markdown measuring.
    virtuosoRef.current?.scrollToIndex({ index, align: "end", behavior });
    const scroller = document.querySelector<HTMLElement>(".conversation");
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior });
  }, []);

  const settleConversationBottom = useCallback((sessionId: string) => {
    // Restored events and Markdown measurements can arrive after the IPC call
    // resolves. Retry a few bounded times, always against the current store,
    // and finish with the same smooth alignment as the proven manual action.
    for (const [delay, behavior] of [[0, "auto"], [100, "auto"], [350, "auto"], [800, "smooth"]] as const) {
      window.setTimeout(() => {
        if (!followTurnRef.current || useAppStore.getState().activeSessionId !== sessionId) return;
        const current = useAppStore.getState().views[sessionId];
        if (!(current?.messages.length)) return;
        scrollConversationNow(behavior);
        if (delay === 800) window.setTimeout(() => {
          if (useAppStore.getState().activeSessionId !== sessionId) return;
          scrollConversationNow("auto");
          followTurnRef.current = false;
          forceFollowRef.current = false;
          atBottomRef.current = true;
          setAtBottom(true);
        }, 450);
      }, delay);
    }
  }, [scrollConversationNow]);

  const askConfirm = useCallback((message: string, options: { title?: string; confirmLabel?: string; danger?: boolean } = {}): Promise<boolean> => new Promise((resolve) => {
    setDialog({ title: options.title || "请确认", message, confirmLabel: options.confirmLabel, danger: options.danger, resolve: (value) => resolve(value === true) });
  }), []);

  const askText = useCallback((message: string, initialValue: string, options: { title?: string; confirmLabel?: string } = {}): Promise<string | null> => new Promise((resolve) => {
    setDialog({ title: options.title || "输入内容", message, input: { value: initialValue }, confirmLabel: options.confirmLabel || "保存", resolve: (value) => resolve(typeof value === "string" ? value : null) });
  }), []);
  const workbenchDialogs = useMemo(() => ({ askConfirm, askText, setError: store.setError }), [askConfirm, askText, store.setError]);
  const profileDialogs = useMemo(() => ({ askConfirm, setError: store.setError }), [askConfirm, store.setError]);

  const closeDialog = useCallback((value: string | boolean | null) => {
    const current = dialog;
    setDialog(null);
    current?.resolve(value);
    if (panel) window.setTimeout(() => document.querySelector<HTMLElement>(".control-panel button")?.focus(), 0);
    else focusComposer();
  }, [dialog, focusComposer, panel]);

  useEffect(() => {
    let queued: ChatEvent[] = [];
    let frame = 0;
    const flush = (): void => {
      frame = 0;
      const events = queued;
      queued = [];
      if (events.length) useAppStore.getState().handleEvents(events);
    };
    const enqueue = (event: ChatEvent): void => {
      if (event.type === "status" && ["working", "idle", "error"].includes(event.status)) {
        // `session:send` resolves only after the full model turn. The first
        // working status is the transport acknowledgement: release the short
        // submission lock so this session can queue/interject and other
        // sessions remain entirely independent.
        updateSendingSessions([event.sessionId], false);
      }
      if (event.type === "computer-permission") setComputerPermissions((current) => ({ ...current, [event.sessionId]: event.request }));
      if (event.type === "computer-risk") setComputerRisks((current) => ({ ...current, [event.sessionId]: event.request }));
      if (event.type === "computer-state") {
        setComputerTasks((current) => ({ ...current, [event.sessionId]: event.state }));
        if (["stopped", "completed", "error"].includes(event.state.status)) {
          setComputerPermissions((current) => omitRecordKey(current, event.sessionId));
          setComputerRisks((current) => omitRecordKey(current, event.sessionId));
        }
      }
      const previous = queued.at(-1);
      if ((event.type === "message-chunk" || event.type === "thought-chunk") && previous?.type === event.type && previous.sessionId === event.sessionId) {
        previous.text += event.text;
      } else queued.push(event);
      if (!frame) frame = window.requestAnimationFrame(flush);
    };
    const removeEvent = window.grokDesktop.onEvent(enqueue);
    const removeLogin = window.grokDesktop.onLogin((state) => useAppStore.getState().setLogin(state));
    const removeDrop = window.grokDesktop.onDroppedAttachments((attachments) => useAppStore.getState().addAttachments(attachments));
    const removeNavigate = window.grokDesktop.onNavigateSession((target) => { void openConversationTargetRef.current(target).catch((error) => useAppStore.getState().setError(errorMessage(error))); });
    const removeComputer = window.grokDesktop.onComputerStateChanged((state) => {
      setComputerTasks((current) => ({ ...current, [state.sessionId]: state }));
      if (["stopped", "completed", "error"].includes(state.status)) {
        setComputerPermissions((current) => omitRecordKey(current, state.sessionId));
        setComputerRisks((current) => omitRecordKey(current, state.sessionId));
      }
    });
    const removeAutomation = window.grokDesktop.onAutomationEvent(() => {
      const state = useAppStore.getState();
      const cwd = state.settings?.activeWorkspace;
      if (cwd) void window.grokDesktop.listSessions(cwd).then(state.setSessions).catch(() => undefined);
    });
    void window.grokDesktop.bootstrap().then(async (data) => {
      const fixture = await window.grokDesktop.getOfflineUiFixture();
      offlineFixtureRef.current = Boolean(fixture);
      useAppStore.getState().bootstrap(data);
      if (fixture) {
        setOfflineFixtureActive(true);
        useAppStore.getState().setSessions(fixture.sessions?.length ? fixture.sessions : [fixture.session]);
        useAppStore.getState().setActiveSession(fixture.activeSessionId || fixture.session.id);
        useAppStore.getState().handleEvents(fixture.events);
      } else if (!data.onboarding.completed && !data.onboarding.skipped) setPanel("onboarding");
      void window.grokDesktop.discoverWorkspaces().then((values) => useAppStore.getState().setWorkspaces(values)).catch(() => undefined);
      if (data.settings.activeWorkspace) {
        void window.grokDesktop.listCodexSessions(data.settings.activeWorkspace, data.settings.showArchivedCodex).then((values) => useAppStore.getState().setCodexSessions(values)).catch(() => undefined);
        void window.grokDesktop.listClaudeSessions(data.settings.activeWorkspace).then((values) => useAppStore.getState().setClaudeSessions(values)).catch(() => undefined);
      }
      window.setTimeout(() => void window.grokDesktop.checkCliUpdate().then((cli) => useAppStore.getState().setCli(cli)).catch(() => undefined), 250);
      window.setTimeout(() => void window.grokDesktop.checkAppUpdate().then((release) => useAppStore.getState().setAppRelease(release)).catch(() => undefined), 1200);
    }).catch((error) => useAppStore.getState().setError(error instanceof Error ? error.message : String(error)));
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      flush();
      removeEvent(); removeLogin(); removeDrop(); removeNavigate(); removeComputer(); removeAutomation();
    };
  }, [updateSendingSessions]);

  useEffect(() => {
    const cwd = store.settings?.activeWorkspace || "";
    if (!cwd) { store.setCodexSessions([]); store.setClaudeSessions([]); return; }
    void window.grokDesktop.listCodexSessions(cwd, store.settings?.showArchivedCodex).then(store.setCodexSessions).catch((error) => store.setError(errorMessage(error)));
    void window.grokDesktop.listClaudeSessions(cwd).then(store.setClaudeSessions).catch((error) => store.setError(errorMessage(error)));
    void window.grokDesktop.discoverWorkspaces().then(store.setWorkspaces).catch(() => undefined);
    void window.grokDesktop.listPromptHistory(cwd).then(setPromptHistory).catch(() => setPromptHistory([]));
    setHistoryIndex(-1);
  }, [store.settings?.activeWorkspace, store.settings?.showArchivedCodex]);

  const resetSessionTransients = useCallback(() => {
    // Composer-adjacent transient UI belongs to one conversation. Do not
    // carry a Stop/queue notice, diagnosis, or line comment draft into the
    // session the user switches to while background work continues.
    setComposerNotice("");
    setReviewComments([]);
    setDiagnosingFailure(undefined);
  }, []);
  const activeWorkspaceSummary = store.workspaces.find((workspace) => sameWorkspacePath(workspace.cwd, store.settings?.activeWorkspace || ""));
  const newDraftKey = activeWorkspaceSummary ? `new:${activeWorkspaceSummary.projectId}` : store.settings?.activeWorkspace ? `new:${normalizedWorkspacePath(store.settings.activeWorkspace)}` : "";
  const { draftKey, activeSending, composer, setComposer, capability, setCapability, newTask, setNewTask } = useSessionDraft({
    activeSessionId: store.activeSessionId,
    workspace: store.settings?.activeWorkspace || "",
    newDraftKey,
    foreignSessionOpen: Boolean(activeCodexId || activeClaudeId),
    sendingSessionIds,
    attachments: store.attachments,
    clearAttachments: store.clearAttachments,
    addAttachments: store.addAttachments,
    onSessionChange: resetSessionTransients,
  });

  useEffect(() => {
    const theme = store.settings?.theme;
    if (!theme) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (): void => { applyThemeToDocument(theme, media.matches); cacheThemeForEarlyStartup(theme); };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [store.settings?.theme]);

  // Reading preferences belong on the document root: #overlay-root is a sibling
  // of #root, so every portaled dialog sits outside .app-shell and inherited
  // neither the text-size nor the density setting.
  useEffect(() => {
    applyShellPreferencesToDocument(store.settings?.fontScale ?? 100, store.settings?.uiDensity ?? "balanced");
  }, [store.settings?.fontScale, store.settings?.uiDensity]);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--conversation-content-width", `${store.settings?.conversationContentWidth ?? 780}px`);
    root.style.setProperty("--conversation-font-scale", `${(store.settings?.conversationFontScale ?? 100) / 100}`);
  }, [store.settings?.conversationContentWidth, store.settings?.conversationFontScale]);

  useEffect(() => {
    const onFocus = (): void => {
      const state = useAppStore.getState();
      const cwd = state.settings?.activeWorkspace;
      if (cwd && !offlineFixtureRef.current) void window.grokDesktop.listSessions(cwd).then((sessions) => {
        // The workspace may have changed while the asynchronous catalog read
        // was in flight. Do not replace the next project's task list.
        if (useAppStore.getState().settings?.activeWorkspace === cwd) useAppStore.getState().setSessions(sessions);
      }).catch(() => undefined);
      if (panel || dialog) return;
      const active = document.activeElement;
      if (!active || active === document.body || active === document.documentElement) focusComposer();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [dialog, focusComposer, panel]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "f" && useWorkbenchStore.getState().activeView === "chat") { event.preventDefault(); setConversationSearchOpen(true); window.setTimeout(() => document.querySelector<HTMLInputElement>("#conversation-search")?.focus(), 0); }
      else if (event.ctrlKey && event.key.toLowerCase() === "n") { event.preventDefault(); useWorkbenchStore.getState().setActiveView("chat"); void openNewSessionDialog(); }
      else if (event.ctrlKey && event.key.toLowerCase() === "f" && useWorkbenchStore.getState().activeView === "chat") { event.preventDefault(); document.querySelector<HTMLInputElement>("#session-search")?.focus(); }
      else if (event.ctrlKey && event.key.toLowerCase() === "l") { event.preventDefault(); useWorkbenchStore.getState().setActiveView("chat"); window.setTimeout(focusComposer, 0); }
      else if (event.key === "Escape" && dialog) { event.preventDefault(); event.stopImmediatePropagation(); closeDialog(dialog.input ? null : false); }
      else if (event.key === "Escape" && activeComputerRisk) { event.preventDefault(); event.stopImmediatePropagation(); void window.grokDesktop.respondComputerRisk(activeComputerRisk.requestId, false).finally(() => { setComputerRisks((current) => omitRecordKey(current, activeComputerRisk.sessionId)); focusComposer(); }); }
      else if (event.key === "Escape" && activeComputerPermission) { event.preventDefault(); event.stopImmediatePropagation(); void window.grokDesktop.respondComputerAppPermission(activeComputerPermission.requestId, "deny").finally(() => { setComputerPermissions((current) => omitRecordKey(current, activeComputerPermission.sessionId)); focusComposer(); }); }
      // The composer palette is a later-mounted overlay and owns the topmost
      // Escape press. Do not let an onboarding/settings panel underneath it
      // consume that key first.
      else if (event.key === "Escape" && document.querySelector(".add-palette")) return;
      else if (event.key === "Escape" && panel) { event.preventDefault(); event.stopImmediatePropagation(); setPanel(null); focusComposer(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeComputerPermission, activeComputerRisk, closeDialog, dialog, focusComposer, panel]);

  useEffect(() => {
    const resize = (): void => { if (window.innerWidth < 1000) setSidebarCollapsed(true); };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    const cwd = store.settings?.activeWorkspace;
    if (!cwd) return;
    let cancelled = false;
    void (async () => {
      const capability = await window.grokDesktop.getGitWorkspaceCapability(cwd);
      let status: GitRepositoryStatus | undefined;
      let items: GrokWorktreeSummary[] = [];
      if (capability.available) [status, items] = await Promise.all([window.grokDesktop.getGitStatus(cwd), window.grokDesktop.listWorktrees(cwd)]);
      if (!cancelled) { useGitStore.getState().setRepository(cwd, undefined, status); useWorktreeStore.getState().setItems(cwd, items); }
    })().catch(() => {
      if (!cancelled) { useGitStore.getState().setRepository(cwd, undefined, undefined); useWorktreeStore.getState().setItems(cwd, []); }
    });
    return () => { cancelled = true; };
  }, [store.settings?.activeWorkspace]);

  useEffect(() => {
    if (!store.activeSessionId) { setExecutionAssignment(undefined); return; }
    let cancelled = false;
    void window.grokDesktop.getSessionExecutionAssignment(store.activeSessionId).then((value) => { if (!cancelled) setExecutionAssignment(value); }).catch(() => { if (!cancelled) setExecutionAssignment(undefined); });
    return () => { cancelled = true; };
  }, [store.activeSessionId]);

  useEffect(() => {
    if (offlineFixtureActive || offlineFixtureRef.current) return;
    if (!store.settings) return;
    const requestId = ++listRequestRef.current;
    const workspace = store.settings.activeWorkspace;
    const timer = setTimeout(() => void window.grokDesktop.listSessions(workspace, search).then((sessions) => {
      if (!offlineFixtureRef.current && requestId === listRequestRef.current) useAppStore.getState().setSessions(sessions);
    }).catch((error) => useAppStore.getState().setError(errorMessage(error))), 180);
    return () => clearTimeout(timer);
  }, [offlineFixtureActive, search, store.settings?.activeWorkspace]);

  const activeSession = store.sessions.find((value) => value.id === store.activeSessionId);
  const activeCodex = store.codexSessions.find((value) => value.id === activeCodexId);
  const activeClaude = store.claudeSessions.find((value) => value.id === activeClaudeId);
  const executionRoot = executionAssignment?.cwd || activeSession?.cwd || store.settings?.activeWorkspace || "";
  const { planWaiting, turns, lastTurnPaths, utilityTurn } = useConversationDerivedState(view, executionRoot);
  const navigate = useNavigationController({ setWorkbenchView, setRightTool, setReviewInitialScope });
  const currentComputerTask = computerTasks[store.activeSessionId];
  const activeComputerTask = currentComputerTask && ["running", "paused", "awaiting-risk-confirmation"].includes(currentComputerTask.status) ? currentComputerTask : null;
  const lastMessageRevision = useMemo(() => {
    const last = view?.messages.at(-1);
    if (!last) return "0";
    if ("text" in last) return `${view!.messages.length}:${last.id}:${last.text?.length ?? 0}`;
    if (last.kind === "tool") return `${view!.messages.length}:${last.id}:${last.tool.status}:${last.tool.output?.length ?? 0}`;
    return `${view!.messages.length}:${last.id}`;
  }, [view?.messages]);
  const commandMatches = useMemo(() => {
    if (!composer.startsWith("/") || composer.includes(" ")) return [];
    const needle = composer.toLowerCase();
    return (view?.commands ?? []).filter((value) => `/${value.name.replace(/^\//, "")}`.toLowerCase().startsWith(needle)).slice(0, 8);
  }, [composer, view?.commands]);
  useEffect(() => {
    const match = composer.match(/(?:^|\s)@([^\s@]{0,80})$/u);
    const cwd = store.settings?.activeWorkspace || "";
    if (!match || !cwd || /^computer$/i.test(match[1] || "")) { setFileMatches([]); return; }
    const timer = window.setTimeout(() => void window.grokDesktop.searchWorkspaceFiles(cwd, match[1] || "", 10).then(setFileMatches).catch(() => setFileMatches([])), 120);
    return () => window.clearTimeout(timer);
  }, [composer, store.settings?.activeWorkspace]);
  const conversationMatches = useMemo(() => {
    const needle = conversationSearch.trim().toLocaleLowerCase();
    if (!needle) return [];
    return turns.map((turn, index) => ({ turn, index })).filter(({ turn }) => [turn.user?.text, turn.final?.text, ...turn.groups.flatMap((group) => group.items.map((item) => item.kind === "tool" ? `${item.tool.title} ${item.tool.output || ""}` : "text" in item ? item.text : ""))].join("\n").toLocaleLowerCase().includes(needle)).map(({ index }) => index);
  }, [conversationSearch, turns]);
  useEffect(() => { setConversationMatch(0); }, [conversationSearch]);
  useEffect(() => { const index = conversationMatches[conversationMatch]; if (index !== undefined) virtuosoRef.current?.scrollToIndex({ index, align: "center", behavior: "smooth" }); }, [conversationMatch, conversationMatches]);

  useEffect(() => {
    const count = view?.messages.length ?? 0;
    if (!count || (!atBottomRef.current && !forceFollowRef.current)) return;
    window.requestAnimationFrame(() => {
      scrollConversationNow("auto");
      window.requestAnimationFrame(() => scrollConversationNow("auto"));
    });
  }, [lastMessageRevision, scrollConversationNow, store.activeSessionId]);

  const refreshSessions = async (): Promise<void> => {
    if (offlineFixtureActive || offlineFixtureRef.current) return;
    const workspace = useAppStore.getState().settings?.activeWorkspace;
    if (!workspace) return;
    const requestId = ++listRequestRef.current;
    const sessions = await window.grokDesktop.listSessions(workspace, search);
    if (requestId === listRequestRef.current && useAppStore.getState().settings?.activeWorkspace === workspace) store.setSessions(sessions);
  };

  const createSession = async (launch?: ExecutionProfileLaunchInput): Promise<string | undefined> => {
    let cwd = launch?.workspacePath || useAppStore.getState().settings?.activeWorkspace || "";
    if (!cwd) {
      cwd = await window.grokDesktop.chooseWorkspace() || "";
      if (!cwd) return;
      store.setSettings(await window.grokDesktop.getSettings());
      store.setSessions(await window.grokDesktop.listSessions(cwd));
    }
    setOperationBusy(true);
    try {
      const result = await window.grokDesktop.createSession(launch ?? cwd);
      setActiveCodexId(""); setCodexDetail(null);
      setActiveClaudeId(""); setClaudeDetail(null);
      store.setActiveSession(result.sessionId);
      forceFollowRef.current = true;
      followTurnRef.current = false;
      atBottomRef.current = true;
      setAtBottom(true);
      focusComposer();
      void refreshSessions().catch((error) => store.setError(errorMessage(error)));
      return result.sessionId;
    } catch (error) {
      store.setError(errorMessage(error));
    } finally { setOperationBusy(false); }
  };

  const openNewSessionDialog = async (): Promise<void> => {
    let cwd = useAppStore.getState().settings?.activeWorkspace || "";
    if (!cwd) {
      cwd = await window.grokDesktop.chooseWorkspace() || "";
      if (!cwd) return;
      store.setSettings(await window.grokDesktop.getSettings());
      store.setSessions(await window.grokDesktop.listSessions(cwd));
    }
    setWorkbenchView("chat");
    setPanel(null);
    setRightTool(null);
    setActiveCodexId(""); setCodexDetail(null);
    setActiveClaudeId(""); setClaudeDetail(null);
    store.setActiveSession("");
    const workspaces = await window.grokDesktop.discoverWorkspaces(true).catch(() => useAppStore.getState().workspaces);
    store.setWorkspaces(workspaces);
    const project = workspaces.find((workspace) => sameWorkspacePath(workspace.cwd, cwd));
    const profiles = await window.grokDesktop.listExecutionProfiles(cwd).catch(() => []);
    const profileId = profiles.find((profile) => profile.effective && profile.id === "builtin-normal")?.id
      ?? profiles.find((profile) => profile.effective)?.id;
    const settings = useAppStore.getState().settings;
    const projectId = project?.projectId ?? normalizedWorkspacePath(cwd);
    const existingDraft = await window.grokDesktop.getDraft(`new:${projectId}`).catch(() => null);
    if (!existingDraft) {
      setNewTask({
        projectId,
        workspacePath: project?.canonicalPath ?? cwd,
        profileId,
        modelId: settings?.defaultModel || undefined,
        effort: settings?.defaultEffort,
        mode: settings?.defaultMode,
      });
      store.setWorkspaces(workspaces.map((workspace) => workspace.projectId === projectId
        ? { ...workspace, draftCount: Math.max(1, workspace.draftCount) }
        : workspace));
    }
    window.setTimeout(focusComposer, 0);
  };

  const openSession = async (session: SessionSummary): Promise<void> => {
    const requestId = ++openRequestRef.current;
    setOperationBusy(true);
    setActiveCodexId(""); setCodexDetail(null);
    setActiveClaudeId(""); setClaudeDetail(null);
    store.setActiveSession(session.id);
    forceFollowRef.current = true;
    followTurnRef.current = true;
    atBottomRef.current = true;
    setAtBottom(true);
    try {
      const preview = await window.grokDesktop.previewSession(session.cwd, session.id).catch(() => undefined);
      if (requestId !== openRequestRef.current) return;
      if (preview?.projection) store.handleEvent({ type: "conversation-projection-restore", sessionId: session.id, projection: preview.projection });
      if (preview?.presentations.length) store.handleEvent({ type: "turn-presentations-restore", sessionId: session.id, presentations: preview.presentations });
      setOperationBusy(false);
      const result = await window.grokDesktop.openSession(session.cwd, session.id);
      if (requestId !== openRequestRef.current) return;
      if (result.hydration === "offline") setComposerNotice(`已显示本地历史；CLI 暂未连接：${result.message || "可稍后重试"}`);
      settleConversationBottom(session.id);
      focusComposer();
      void refreshSessions().catch((error) => store.setError(errorMessage(error)));
    } catch (error) { if (requestId === openRequestRef.current) store.setError(errorMessage(error)); }
    finally { if (requestId === openRequestRef.current) setOperationBusy(false); }
  };

  const openConversationTarget = async (target: { cwd: string; sessionId: string }): Promise<void> => {
    setWorkbenchView("chat");
    setRightTool(null);
    setPanel(null);
    if (offlineFixtureRef.current) {
      const session = useAppStore.getState().sessions.find((value) => value.id === target.sessionId);
      if (!session) throw new Error("离线夹具会话不存在");
      useAppStore.getState().setActiveSession(session.id);
      window.requestAnimationFrame(() => { window.dispatchEvent(new Event("resize")); focusComposer(); });
      return;
    }
    if (!sameWorkspacePath(useAppStore.getState().settings?.activeWorkspace || "", target.cwd)) {
      useAppStore.getState().setSessions(await window.grokDesktop.setWorkspace(target.cwd));
      useAppStore.getState().setSettings(await window.grokDesktop.getSettings());
    }
    const sessions = await window.grokDesktop.listSessions(target.cwd);
    useAppStore.getState().setSessions(sessions);
    const session = sessions.find((value) => value.id === target.sessionId);
    if (!session) throw new Error("会话历史已不存在");
    await openSession(session);
    window.requestAnimationFrame(() => { window.dispatchEvent(new Event("resize")); focusComposer(); });
  };
  openConversationTargetRef.current = openConversationTarget;

  useEffect(() => {
    if (activeWorkbenchView !== "chat") return;
    const target = document.querySelector<HTMLElement>(".conversation-surface");
    if (!target) return;
    const observer = new ResizeObserver(() => {
      window.dispatchEvent(new Event("resize"));
      if (atBottomRef.current) window.requestAnimationFrame(() => scrollConversationNow("auto"));
    });
    observer.observe(target);
    window.requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    return () => observer.disconnect();
  }, [activeWorkbenchView, scrollConversationNow, store.activeSessionId]);

  const openCodexSession = async (session: CodexSessionSummary): Promise<void> => {
    setOperationBusy(true);
    setActiveClaudeId("");
    setClaudeDetail(null);
    setActiveCodexId(session.id);
    store.setActiveSession("");
    setCodexDetail(null);
    try { setCodexDetail(await window.grokDesktop.openCodexSession(session.id)); }
    catch (error) { store.setError(errorMessage(error)); }
    finally { setOperationBusy(false); }
  };

  const openClaudeSession = async (session: ClaudeSessionSummary): Promise<void> => {
    setOperationBusy(true);
    setActiveCodexId("");
    setCodexDetail(null);
    setActiveClaudeId(session.id);
    store.setActiveSession("");
    setClaudeDetail(null);
    try { setClaudeDetail(await window.grokDesktop.openClaudeSession(session.id)); }
    catch (error) { store.setError(errorMessage(error)); }
    finally { setOperationBusy(false); }
  };

  const send = async (delivery: "normal" | "queue" | "interject" = "normal"): Promise<void> => {
    const text = composer.trim();
    const sourceDraftKey = draftKey;
    if ((!text && !store.attachments.length && !reviewComments.length)
      || hasSessionSubmission(sendingSessionIdsRef.current, store.activeSessionId, sourceDraftKey)
      || view?.status === "needs-user"
      || (delivery === "normal" && view?.status === "working")) return;
    const attachments = [...store.attachments];
    const trackedSubmissionKeys = new Set(sessionSubmissionKeys(store.activeSessionId, sourceDraftKey));
    updateSendingSessions(trackedSubmissionKeys, true);
    let sessionId = store.activeSessionId;
    const submittedCapability = capability;
    try {
      if (!sessionId) sessionId = await createSession(newTask ? { ...newTask } : undefined) || "";
      if (!sessionId) return;
      if (sourceDraftKey && sourceDraftKey !== sessionId) await window.grokDesktop.moveDraft(sourceDraftKey, sessionId);
      for (const key of sessionSubmissionKeys(sessionId, sourceDraftKey)) trackedSubmissionKeys.add(key);
      updateSendingSessions(trackedSubmissionKeys, true);
      const cwd = store.settings?.activeWorkspace || activeSession?.cwd || "";
      if (attachments.length) {
        const findings = await window.grokDesktop.inspectAttachmentPrivacy(cwd, attachments).catch(() => []);
        if (findings.length && !(await askConfirm(`以下附件可能包含敏感信息：\n\n${findings.map((item) => `• ${item.message}`).join("\n")}\n\n仍要发送吗？`, { title: "附件隐私提醒", confirmLabel: "仍要发送", danger: findings.some((item) => item.severity === "high") }))) return;
      }
      if (reviewComments.length) {
        const staleComment = await findStaleReviewComment(reviewComments, async (scope) => (await window.grokDesktop.getGitReview(executionRoot, scope)).id);
        if (staleComment) { store.setError(`审核批注 ${staleComment.path}:L${staleComment.line} 所依据的变更已更新，请在 Review 中重新定位。`); return; }
      }
      setComposer("");
      setCapability(undefined);
      if (cwd && text) {
        void window.grokDesktop.appendPromptHistory(cwd, text);
        setPromptHistory((values) => [text, ...values.filter((value) => value !== text)].slice(0, 50));
        setHistoryIndex(-1);
      }
      store.clearAttachments();
      setReviewComments([]);
      if (sourceDraftKey) await window.grokDesktop.clearDraft(sourceDraftKey);
      if (sessionId !== sourceDraftKey) await window.grokDesktop.clearDraft(sessionId);
      if (sourceDraftKey.startsWith("new:")) {
        void window.grokDesktop.discoverWorkspaces(true).then(store.setWorkspaces).catch(() => undefined);
      }
      if (delivery === "normal") { forceFollowRef.current = true; followTurnRef.current = true; atBottomRef.current = true; setAtBottom(true); }
      focusComposer();
      const reviewText = formatReviewComments(reviewComments);
      let outboundText = buildComposerCommand([text, reviewText].filter(Boolean).join("\n\n"), submittedCapability);
      if (!submittedCapability && /^@/i.test(text)) {
        const generic = resolveComputerMention(text);
        if (generic) outboundText = generic.command;
        else try {
          const apps = await window.grokDesktop.listComputerApps();
          const targets = await Promise.all(apps.map(async (app) => ({ app, windows: await window.grokDesktop.listComputerWindows(app.id) })));
          outboundText = resolveComputerMention(text, targets)?.command || text;
        } catch (error) { store.setError(`无法解析 Computer 提及：${errorMessage(error)}`); }
      }
      const clientMessageId = crypto.randomUUID();
      if (delivery === "interject") {
        const receipt = await window.grokDesktop.interjectPrompt(sessionId, outboundText, attachments, clientMessageId);
        setComposerNotice(receipt.message);
      }
      else if (delivery === "queue") {
        const receipt = await window.grokDesktop.enqueuePrompt(sessionId, outboundText, attachments, clientMessageId);
        setComposerNotice(receipt.message);
      }
      else await window.grokDesktop.sendPrompt({ sessionId, text: outboundText, attachments, clientMessageId });
      if (delivery !== "normal") window.setTimeout(() => setComposerNotice(""), 4_000);
    }
    catch (error) {
      await window.grokDesktop.setDraft(sessionId || sourceDraftKey, text, submittedCapability, attachments, sessionId ? undefined : newTask).catch(() => undefined);
      const current = useAppStore.getState();
      const currentWorkspace = current.workspaces.find((workspace) => sameWorkspacePath(workspace.cwd, current.settings?.activeWorkspace || ""));
      const currentDraftKey = current.activeSessionId || (currentWorkspace ? `new:${currentWorkspace.projectId}` : current.settings?.activeWorkspace ? `new:${normalizedWorkspacePath(current.settings.activeWorkspace)}` : "");
      if (currentDraftKey === sessionId || currentDraftKey === sourceDraftKey) {
        setComposer(text);
        setCapability(submittedCapability);
        current.addAttachments(attachments);
        store.setError(errorMessage(error));
      }
    }
    finally {
      updateSendingSessions(trackedSubmissionKeys, false);
      if (delivery === "normal" && followTurnRef.current) settleConversationBottom(sessionId);
      if (useAppStore.getState().activeSessionId === sessionId) focusComposer();
      void refreshSessions().catch((error) => store.setError(errorMessage(error)));
    }
  };

  const sendBtw = async (): Promise<void> => {
    const text = composer.trim();
    const sessionId = store.activeSessionId;
    if (!text || !sessionId || !view?.commands.some((command) => command.name.replace(/^\//, "").toLowerCase() === "btw")) return;
    try {
      const receipt = await window.grokDesktop.sendBtwPrompt(sessionId, text);
      if (receipt.accepted) setComposer("");
      setComposerNotice(receipt.message || (receipt.accepted ? "旁路提问已发送，不会打断当前回合。" : "当前 CLI 不支持旁路提问。"));
      window.setTimeout(() => setComposerNotice(""), 4_000);
    } catch (error) {
      setComposerNotice(`旁路提问失败：${errorMessage(error)}`);
      window.setTimeout(() => setComposerNotice(""), 6_000);
    }
  };

  const navigatePromptHistory = (direction: -1 | 1): void => {
    if (!promptHistory.length) return;
    const next = direction === -1 ? Math.min(promptHistory.length - 1, historyIndex + 1) : Math.max(-1, historyIndex - 1);
    setHistoryIndex(next);
    setComposer(next < 0 ? "" : promptHistory[next] || "");
  };

  const createMedia = async (request: MediaCreationRequest): Promise<MediaGenerationJob> => {
    // Media is an independent task. A busy or waiting Grok turn is still the
    // correct destination; rejecting it here silently created a second chat.
    let sessionId = resolveMediaSessionTarget(store.activeSessionId, Boolean(activeCodexId || activeClaudeId));
    if (!sessionId) sessionId = await createSession() || "";
    if (!sessionId) throw new Error("未能创建媒体会话");
    setActiveCodexId("");
    setCodexDetail(null);
    setActiveClaudeId("");
    setClaudeDetail(null);
    store.setActiveSession(sessionId);
    forceFollowRef.current = true;
    followTurnRef.current = true;
    atBottomRef.current = true;
    setAtBottom(true);
    return window.grokDesktop.startMediaGeneration({ ...request, sessionId });
  };

  const chooseComputerCapability = (): void => {
    setCapability({ kind: "computer", label: "Computer", command: "/computer", source: "内置 Grok Computer Use" });
    focusComposer();
  };

  const stopActiveSession = useCallback(async (): Promise<void> => {
    const sessionId = store.activeSessionId;
    if (!sessionId) return;
    setComposerNotice("正在停止当前回合…");
    try {
      await window.grokDesktop.cancelSession(sessionId);
      const notice = "当前回合已停止；若 CLI 未响应，会话已自动恢复。";
      setComposerNotice(notice);
      window.setTimeout(() => setComposerNotice((current) => current === notice ? "" : current), 4_000);
    } catch (error) {
      const message = `停止失败：${errorMessage(error)}`;
      setComposerNotice(message);
      store.setError(message);
    }
  }, [store.activeSessionId]);

  useEffect(() => window.grokDesktop.onMenuCommand((command: AppMenuCommand) => {
    if (command === "new-session") { setWorkbenchView("chat"); void openNewSessionDialog(); }
    else if (command === "choose-workspace") void (async () => {
      const cwd = await window.grokDesktop.chooseWorkspace();
      if (!cwd) return;
      store.setSettings(await window.grokDesktop.getSettings());
      store.setSessions(await window.grokDesktop.listSessions(cwd));
      store.setActiveSession(""); setActiveCodexId(""); setCodexDetail(null); setActiveClaudeId(""); setClaudeDetail(null);
    })();
    else if (command === "add-attachment") void window.grokDesktop.pickAttachments().then(store.addAttachments).catch((error) => store.setError(errorMessage(error))).finally(focusComposer);
    else if (command === "export-session" && activeSession) void window.grokDesktop.exportSessionMarkdown(activeSession.cwd, activeSession.id);
    else if (command === "search-sessions") document.querySelector<HTMLInputElement>("#session-search")?.focus();
    else if (command === "search-conversation") { setConversationSearchOpen(true); window.setTimeout(() => document.querySelector<HTMLInputElement>("#conversation-search")?.focus(), 0); }
    else if (command === "focus-composer") { setWorkbenchView("chat"); window.setTimeout(focusComposer, 0); }
    else if (command === "stop-generation" && store.activeSessionId) void stopActiveSession();
    else if (command === "copy-final-answer") { const answer = turns.toReversed().find((turn) => turn.final)?.final; if (answer && "text" in answer) void navigator.clipboard.writeText(answer.text); }
    else if (command === "toggle-sidebar") setSidebarCollapsed((value) => !value);
    else if (command === "open-accounts") setPanel("accounts");
    else if (command === "open-media") setPanel("media");
    else if (command === "open-extensions") setPanel("extensions");
    else if (command === "open-computer") chooseComputerCapability();
    else if (command === "open-settings") setPanel("settings");
    else if (command === "open-diagnostics") setPanel("diagnostics");
    else if (command === "open-onboarding") void window.grokDesktop.resetOnboarding().then((state) => { store.setOnboarding(state); setPanel("onboarding"); });
    else if (command === "open-about") setPanel("about");
    else if (command === "open-task-center") setPanel("tasks");
  }), [activeSession?.id, focusComposer, setWorkbenchView, stopActiveSession, store.activeSessionId, turns]);

  if (store.loading) return <div className="splash"><div className="grok-mark">G</div><h1>Grok Build Desktop</h1><p>正在连接本机 Grok CLI…</p></div>;

  return (
    <div className={`app-shell density-${store.settings?.uiDensity ?? "balanced"} ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${rightTool && activeWorkbenchView === "chat" ? "right-tool-open" : ""} ${store.settings?.theme ? themeBackgroundClass(store.settings.theme) : ""}`}>
      <Sidebar
        version={store.appVersion}
        settings={store.settings}
        sessions={store.sessions}
        codexSessions={store.codexSessions}
        claudeSessions={store.claudeSessions}
        workspaces={store.workspaces}
        activeSessionId={store.activeSessionId}
        activeCodexId={activeCodexId}
        activeClaudeId={activeClaudeId}
        search={search}
        busy={operationBusy}
        activeView={activeWorkbenchView}
        onView={setWorkbenchView}
        dialogs={workbenchDialogs}
        onSearch={setSearch}
        onNew={() => { setWorkbenchView("chat"); void openNewSessionDialog(); }}
        onOpen={(session) => { void openConversationTarget({ cwd: session.cwd, sessionId: session.id }).catch((error) => store.setError(errorMessage(error))); }}
        onOpenConversationTarget={(target) => { void openConversationTarget(target).catch((error) => store.setError(errorMessage(error))); }}
        onOpenCodex={(session) => { setWorkbenchView("chat"); void openCodexSession(session); }}
        onOpenClaude={(session) => { setWorkbenchView("chat"); void openClaudeSession(session); }}
        onChooseWorkspace={async () => {
          ++listRequestRef.current;
          const cwd = await window.grokDesktop.chooseWorkspace();
          if (!cwd) return;
          const settings = await window.grokDesktop.getSettings();
          store.setSettings(settings);
          store.setActiveSession("");
          setActiveCodexId(""); setCodexDetail(null);
          setActiveClaudeId(""); setClaudeDetail(null);
          store.setSessions(await window.grokDesktop.listSessions(cwd));
          store.setWorkspaces(await window.grokDesktop.discoverWorkspaces(true));
        }}
        onRecent={async (cwd) => {
          ++listRequestRef.current;
          store.setSessions(await window.grokDesktop.setWorkspace(cwd));
          store.setSettings(await window.grokDesktop.getSettings());
          store.setActiveSession("");
          setActiveCodexId(""); setCodexDetail(null);
          setActiveClaudeId(""); setClaudeDetail(null);
          store.setWorkspaces(await window.grokDesktop.discoverWorkspaces(true));
        }}
        onRename={async (session) => {
          const title = await askText("输入新的会话名称。", session.title);
          if (title?.trim()) { await window.grokDesktop.renameSession(session.id, title.trim()); await refreshSessions(); }
        }}
        onDelete={async (session) => {
          if (await askConfirm(`永久删除“${session.title}”？`, { title: "删除会话", confirmLabel: "永久删除", danger: true })) {
            try {
              await window.grokDesktop.deleteSession(session.cwd, session.id);
            } catch (error) {
              const detail = errorMessage(error);
              const localOnly = await askConfirm(
                `Grok CLI 未删除该会话：${detail}\n\n是否仅清理 Desktop 的投影、附件、媒体和 Token 明细？Grok CLI 原会话仍会保留。`,
                { title: "CLI 会话删除失败", confirmLabel: "仅清理 Desktop 数据", danger: true },
              );
              if (!localOnly) return;
              await window.grokDesktop.deleteDesktopSessionData(session.cwd, session.id);
            }
            if (store.activeSessionId === session.id) {
              store.setActiveSession("");
              store.clearAttachments();
            }
            await refreshSessions();
          }
        }}
        onPin={async (session) => { await window.grokDesktop.pinSession(session.id, !session.pinned); await refreshSessions(); }}
        onArchive={async (session) => { await window.grokDesktop.archiveSession(session.id, !session.archived); await refreshSessions(); }}
        onExport={async (session) => { await window.grokDesktop.exportSessionMarkdown(session.cwd, session.id); }}
        onHideCodex={async (session) => { await window.grokDesktop.hideCodexSession(session.id, true); store.setCodexSessions(await window.grokDesktop.listCodexSessions(session.cwd, store.settings?.showArchivedCodex, true)); if (activeCodexId === session.id) { setActiveCodexId(""); setCodexDetail(null); } }}
        onHideClaude={async (session) => { await window.grokDesktop.hideClaudeSession(session.id, true); store.setClaudeSessions(await window.grokDesktop.listClaudeSessions(session.cwd, true)); if (activeClaudeId === session.id) { setActiveClaudeId(""); setClaudeDetail(null); } }}
        onToggleCodex={async (collapsed) => { if (!store.settings) return; store.setSettings(await window.grokDesktop.updateSettings({ codexGroupCollapsed: collapsed })); }}
        onToggleClaude={async (collapsed) => { if (!store.settings) return; store.setSettings(await window.grokDesktop.updateSettings({ claudeGroupCollapsed: collapsed })); }}
        onToggleSessionGroup={async (kind, collapsed) => { if (!store.settings) return; store.setSettings(await window.grokDesktop.updateSettings({ sessionGroupCollapsed: { ...store.settings.sessionGroupCollapsed, [kind]: collapsed } })); }}
        onToggleArchived={async (value) => { if (!store.settings) return; store.setSettings(await window.grokDesktop.updateSettings({ showArchivedCodex: value })); }}
        onPinWorkspace={async (workspace) => store.setWorkspaces(await window.grokDesktop.pinWorkspace(workspace.cwd, !workspace.pinned))}
        onHideWorkspace={async (workspace) => store.setWorkspaces(await window.grokDesktop.setWorkspaceHidden(workspace.cwd, true))}
        onDeleteDraft={() => { void (async () => { if (!newDraftKey) return; if (!await askConfirm("删除这个尚未发送的本地草稿？不会影响任何 Grok 会话。", { title: "删除草稿", confirmLabel: "删除", danger: true })) return; await window.grokDesktop.clearDraft(newDraftKey); if (!store.activeSessionId) { setComposer(""); setCapability(undefined); setNewTask(undefined); store.clearAttachments(); } store.setWorkspaces(await window.grokDesktop.discoverWorkspaces(true)); })().catch((error) => store.setError(errorMessage(error))); }}
        onClear={async () => {
          const cwd = store.settings?.activeWorkspace;
          if (cwd && await askConfirm("永久清空当前工作区的全部 Grok 会话？", { title: "清空会话", confirmLabel: "永久清空", danger: true })) {
            await window.grokDesktop.clearSessions(cwd);
            store.setActiveSession("");
            await refreshSessions();
          }
        }}
        onPanel={(value) => setPanel(value)}
      />
      <div className="workspace-shell">
      <main className="main-pane">
        <TopBar session={activeSession} codex={activeCodex} claude={activeClaude} workspace={executionRoot || store.settings?.activeWorkspace || ""} workbenchView={activeWorkbenchView} view={view} busy={operationBusy || activeSending || view?.status === "working" || view?.compacting === true} rightToolOpen={Boolean(rightTool)} onView={setWorkbenchView} onPanel={setPanel} onToggleSidebar={() => setSidebarCollapsed((value) => !value)} onToggleRightTool={() => setRightTool((value) => value ? null : "launcher")} onReturnToChat={() => { setWorkbenchView("chat"); window.requestAnimationFrame(() => { window.dispatchEvent(new Event("resize")); focusComposer(); }); }} />
        {activeComputerTask && <ComputerLiveStrip task={activeComputerTask} onPause={() => void window.grokDesktop.pauseComputer(activeComputerTask.sessionId)} onResume={() => void window.grokDesktop.resumeComputer(activeComputerTask.sessionId)} onStop={() => void window.grokDesktop.stopComputer(activeComputerTask.sessionId)} />}
        <Suspense fallback={<div className="workbench-loading" role="status"><div className="spinner"/><span>正在加载工作台…</span></div>}>
        {activeWorkbenchView === "files" ? <LazyFileWorkbench workspace={store.settings?.activeWorkspace || ""} dialogs={workbenchDialogs} onChatReference={({ prompt, path }) => { setWorkbenchView("chat"); setComposer((value) => `${value}${value && !/\s$/.test(value) ? " " : ""}${prompt}`); if (path) void window.grokDesktop.attachmentsFromPaths([path]).then(store.addAttachments).catch((error) => store.setError(errorMessage(error))); window.setTimeout(focusComposer, 0); }} /> : activeWorkbenchView === "source-control" ? <LazyGitWorkbench workspace={store.settings?.activeWorkspace || ""} dialogs={workbenchDialogs} /> : activeWorkbenchView === "worktrees" ? <LazyWorktreeWorkbench workspace={store.settings?.activeWorkspace || ""} dialogs={workbenchDialogs} onOpenConversation={(target) => { void openConversationTarget(target).catch((error) => store.setError(errorMessage(error))); }} /> : activeWorkbenchView === "memory" ? <LazyMemoryWorkbench workspace={store.settings?.activeWorkspace || ""} activeSessionId={store.activeSessionId} dialogs={workbenchDialogs} /> : activeWorkbenchView === "agents" ? <LazyAgentPersonaWorkbench workspace={store.settings?.activeWorkspace || ""} dialogs={workbenchDialogs} /> : activeWorkbenchView === "profiles" ? <LazyExecutionProfileWorkbench workspace={store.settings?.activeWorkspace || ""} dialogs={profileDialogs} /> : activeWorkbenchView === "dashboard" ? <LazyAgentDashboardWorkbench workspace={store.settings?.activeWorkspace || ""} setError={store.setError} onOpenSession={(sessionId) => { void openConversationTarget({ cwd: store.settings?.activeWorkspace || "", sessionId }).catch((error) => store.setError(errorMessage(error))); }} onOpenWorktree={(worktreeId) => { useWorktreeStore.getState().setSelected(worktreeId); setWorkbenchView("worktrees"); }} onOpenDefinition={() => setWorkbenchView("agents")} /> : <div className="conversation-surface"><div className="conversation-content">
        {conversationSearchOpen && <div className="conversation-search-bar"><input id="conversation-search" value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)} placeholder="搜索当前会话"/><span>{conversationMatches.length ? `${conversationMatch + 1}/${conversationMatches.length}` : "0 项"}</span><button disabled={!conversationMatches.length} onClick={() => setConversationMatch((value) => (value - 1 + conversationMatches.length) % conversationMatches.length)}>↑</button><button disabled={!conversationMatches.length} onClick={() => setConversationMatch((value) => (value + 1) % conversationMatches.length)}>↓</button><button onClick={() => { setConversationSearchOpen(false); setConversationSearch(""); focusComposer(); }}>×</button></div>}
        {!store.cli?.found ? <EmptyState title="未找到 Grok CLI" text="请在设置中指定 grok.exe 路径。" action="打开设置" onAction={() => setPanel("settings")} />
          : activeCodexId ? <ForeignSessionMirror source="Codex" detail={codexDetail} busy={operationBusy} onRefresh={async () => setCodexDetail(await window.grokDesktop.refreshCodexSession(activeCodexId))} onContinue={async () => { setOperationBusy(true); try { const result = await window.grokDesktop.continueCodexSession(activeCodexId); await openConversationTarget(result); } catch (error) { store.setError(errorMessage(error)); } finally { setOperationBusy(false); } }} onHide={async () => { await window.grokDesktop.hideCodexSession(activeCodexId, true); store.setCodexSessions(await window.grokDesktop.listCodexSessions(store.settings?.activeWorkspace || "", store.settings?.showArchivedCodex, true)); setActiveCodexId(""); setCodexDetail(null); }} />
          : activeClaudeId ? <ForeignSessionMirror source="Claude" detail={claudeDetail} busy={operationBusy} onRefresh={async () => setClaudeDetail(await window.grokDesktop.refreshClaudeSession(activeClaudeId))} onContinue={async () => { setOperationBusy(true); try { const result = await window.grokDesktop.continueClaudeSession(activeClaudeId); await openConversationTarget(result); } catch (error) { store.setError(errorMessage(error)); } finally { setOperationBusy(false); } }} onHide={async () => { await window.grokDesktop.hideClaudeSession(activeClaudeId, true); store.setClaudeSessions(await window.grokDesktop.listClaudeSessions(store.settings?.activeWorkspace || "", true)); setActiveClaudeId(""); setClaudeDetail(null); }} />
          : !activeSession && !view ? <WorkspaceEmptyState workspaces={store.workspaces} onNew={() => void openNewSessionDialog()} onOpen={async (cwd) => { store.setSessions(await window.grokDesktop.setWorkspace(cwd)); store.setSettings(await window.grokDesktop.getSettings()); }} />
          : <ConversationViewport
            turns={turns}
            sessionId={store.activeSessionId}
            navigationRoot={executionRoot}
            showThinking={store.settings?.showThinking ?? false}
            expandTools={store.settings?.expandToolDetails ?? false}
            matchIndex={conversationMatches[conversationMatch]}
            atBottom={atBottom}
            virtuosoRef={virtuosoRef}
            shouldFollow={(isAtBottom) => isAtBottom || forceFollowRef.current}
            onAtBottom={(value) => { atBottomRef.current = value; if (value && !followTurnRef.current) forceFollowRef.current = false; setAtBottom(value); }}
            onWheelUp={() => { followTurnRef.current = false; forceFollowRef.current = false; }}
            onScrollBottom={() => { followTurnRef.current = false; forceFollowRef.current = true; atBottomRef.current = true; setAtBottom(true); scrollConversationNow("smooth"); }}
            onNavigate={(intent) => void navigate(intent).catch((error) => store.setError(errorMessage(error)))}
            onOpenReview={() => void window.grokDesktop.getGitWorkspaceCapability(executionRoot).then((capability) => { if (capability.available) { setReviewInitialScope("last-turn"); setRightTool("review"); } else setRightTool("agent-changes"); }).catch((error) => store.setError(errorMessage(error)))}
            onFork={() => setPanel("history")}
            onResolved={(id) => store.resolveMessage(store.activeSessionId, id)}
            onDiagnose={setDiagnosingFailure}
            onRetry={(message, attachments) => { setComposer(message.text); store.clearAttachments(); store.addAttachments(attachments); focusComposer(); }}
          />}</div>
        {diagnosingFailure && createPortal(<LazyFailureDiagnosisPanel failure={diagnosingFailure} onClose={() => setDiagnosingFailure(undefined)} />, document.getElementById("overlay-root")!)}
        {!activeCodexId && !activeClaudeId && Boolean(view?.followUps.length) && <div className="follow-up-suggestions" aria-label="CLI 跟进建议"><span>跟进建议</span>{view!.followUps.map((suggestion) => <button key={suggestion.id} onClick={() => { setComposer(suggestion.text); focusComposer(); }}>{suggestion.text}</button>)}</div>}
        {!activeCodexId && !activeClaudeId && view && view.hydration !== "ready" && view.hydration !== "local" && <div className={`session-hydration-banner ${view.hydration}`} role="status"><span>{view.hydration === "connecting" ? "正在连接 CLI，已先显示本地历史…" : view.hydration === "synchronizing" ? "正在合并 CLI 回放…" : `本地历史仍可用；连接${view.hydration === "offline" ? "离线" : "失败"}${view.hydrationMessage ? `：${view.hydrationMessage}` : ""}`}</span>{(view.hydration === "offline" || view.hydration === "failed") && activeSession && <button onClick={() => void openSession(activeSession)}>重新连接</button>}</div>}
        {!activeCodexId && !activeClaudeId && <Composer
          inputRef={composerRef}
          text={composer}
          setText={setComposer}
          busy={view?.status === "working" || view?.compacting === true}
          controlsDisabled={operationBusy || activeSending || view?.status === "needs-user"}
          modelControlsDisabled={operationBusy || activeSending || (view?.status === "needs-user" && !planWaiting) || ((view?.status === "working" || view?.compacting === true) && !planWaiting)}
          sessionId={store.activeSessionId}
          attachments={store.attachments}
          reviewComments={reviewComments}
          notice={composerNotice}
          onDismissNotice={() => setComposerNotice("")}
          commandMatches={commandMatches}
          fileMatches={fileMatches}
          view={view}
          draft={store.activeSessionId ? undefined : newTask}
          draftModels={draftModels}
          onDraftChange={(patch) => setNewTask((current) => current ? { ...current, ...patch } : current)}
          onSend={() => void send(view?.status === "working" ? "queue" : "normal")}
          onInterject={() => void send("interject")}
          btwAvailable={Boolean(view?.commands.some((command) => command.name.replace(/^\//, "").toLowerCase() === "btw"))}
          onBtw={() => void sendBtw()}
          onBlockedSubmit={() => {
            const reason = view?.status === "needs-user" ? "请先处理当前的计划、权限或问题卡片，然后再发送。"
              : activeSending ? "当前会话的消息正在提交，稍后会自动恢复。"
              : "界面正在处理其它操作，请稍候。";
            setComposerNotice(reason);
            window.setTimeout(() => setComposerNotice(""), 4_000);
          }}
          onStop={() => void stopActiveSession()}
          onAdd={async () => { try { store.addAttachments(await window.grokDesktop.pickAttachments()); } catch (error) { store.setError(errorMessage(error)); } finally { focusComposer(); } }}
          onAddFolders={async () => { try { store.addAttachments(await window.grokDesktop.pickAttachmentFolders()); } catch (error) { store.setError(errorMessage(error)); } finally { focusComposer(); } }}
          onPaste={async (files) => { try { store.addAttachments(await pastedImageAttachments(files)); } catch (error) { store.setError(errorMessage(error)); } }}
          onPasteText={(text) => { void window.grokDesktop.createTextDraftAttachment(draftKey || "new:unassigned", text).then((attachment) => {
            store.addAttachments([attachment]);
            setComposer("");
            setComposerNotice(`已将 ${text.length.toLocaleString()} 字符写入本地文本草稿附件，发送时不会重复放入正文。`);
          }).catch((error) => store.setError(errorMessage(error))); }}
          onConvertText={() => { if (!composer) return; const text = composer; void window.grokDesktop.createTextDraftAttachment(draftKey || "new:unassigned", text).then((attachment) => {
            store.addAttachments([attachment]);
            setComposer("");
            setComposerNotice("已将输入内容写入本地 .txt 草稿附件。");
          }).catch((error) => store.setError(errorMessage(error))); }}
          onRestoreText={(attachment) => { void (async () => {
            const restored = attachment.data
              ? decodeTextAttachment(attachment.data)
              : attachment.path
                ? await window.grokDesktop.readTextDraftAttachment(attachment.path)
                : "";
            if (!restored) return;
            setComposer((current) => current ? `${current}\n\n${restored}` : restored);
            store.removeAttachment(attachment.id);
            if (attachment.draftText && attachment.path) await window.grokDesktop.deleteTextDraftAttachment(attachment.path).catch(() => undefined);
            setComposerNotice("文本附件已恢复到输入框。");
            focusComposer();
          })().catch((error) => store.setError(errorMessage(error))); }}
          onRemove={(id) => {
            const attachment = store.attachments.find((value) => value.id === id);
            store.removeAttachment(id);
            if (attachment?.draftText && attachment.path) void window.grokDesktop.deleteTextDraftAttachment(attachment.path).catch(() => undefined);
          }}
          onRemoveReviewComment={(id) => setReviewComments((values) => values.filter((value) => value.id !== id))}
          onCommand={(name) => { setComposer(`/${name.replace(/^\//, "")} `); focusComposer(); }}
          onFile={async (file) => { try { store.addAttachments(await window.grokDesktop.attachmentsFromPaths([file.path])); setComposer((value) => value.replace(/(?:^|\s)@[^\s@]*$/u, "").trimStart()); setFileMatches([]); } catch (error) { store.setError(errorMessage(error)); } finally { focusComposer(); } }}
          onFileMenu={() => { setComposer((value) => `${value}${value && !/\s$/.test(value) ? " " : ""}@`); focusComposer(); }}
          capability={capability}
          computerTask={currentComputerTask ?? null}
          onCapability={setCapability}
          onComputer={chooseComputerCapability}
          onClearCapability={() => setCapability(undefined)}
          onManageExtensions={() => setPanel("extensions")}
          onHistory={navigatePromptHistory}
          onControlSettled={focusComposer}
        />}</div>}
        </Suspense>
      </main>
      <RightDock tool={rightTool} active={activeWorkbenchView === "chat"} sessionId={store.activeSessionId} cwd={executionRoot} lastTurnPaths={lastTurnPaths} reviewInitialScope={reviewInitialScope} turn={utilityTurn} queue={view?.queue ?? []} runtimeUpdates={view?.runtimeUpdates ?? []} sessionStatus={view?.status} onTool={(tool) => { if (tool === "review") setReviewInitialScope("unstaged"); setRightTool(tool); }} onClose={() => setRightTool(null)} onNavigate={(intent) => void navigate(intent).catch((error) => store.setError(errorMessage(error)))} onAddComment={(comment) => { setReviewComments((values) => [...values, comment]); focusComposer(); }} onExpandResult={() => { setRightTool(null); const index = utilityTurn ? turns.findIndex((turn) => turn.id === utilityTurn.id) : turns.length - 1; if (index >= 0) virtuosoRef.current?.scrollToIndex({ index, align: "end", behavior: "smooth" }); }} onError={store.setError}/>
      </div>
      {createPortal(<Suspense fallback={<div className="modal-backdrop"><section className="control-panel"><div className="panel-body workbench-loading"><div className="spinner"/><span>正在加载…</span></div></section></div>}>
        {store.error && <div className="toast error-toast"><span>{store.error}</span><button onClick={() => window.location.reload()}>重新加载界面</button><button onClick={() => setPanel("diagnostics")}>诊断</button><button onClick={() => store.setError("")}>×</button></div>}
        {panel === "media" && <LazyMediaStudioPanel hasGrokConversation={Boolean(!activeCodexId && !activeClaudeId && store.activeSessionId)} commands={activeCodexId || activeClaudeId ? [] : view?.commands ?? []} onCreate={createMedia} onClose={() => { setPanel(null); focusComposer(); }} />}
        {panel === "extensions" && <Suspense fallback={<div className="modal-backdrop"><section className="control-panel"><div className="panel-body">正在加载扩展中心…</div></section></div>}><LazyExtensionsPanel confirmAction={askConfirm} setError={store.setError} onUseSkill={(command) => { setComposer(command); focusComposer(); }} onClose={() => { setPanel(null); focusComposer(); }} /></Suspense>}
        {panel === "diagnostics" && <LazyDiagnosticsPanel onClose={() => { setPanel(null); focusComposer(); }} />}
        {panel === "onboarding" && store.onboarding && <LazyOnboardingPanel state={store.onboarding} onState={store.setOnboarding} onClose={() => { setReturnToOnboarding(false); setPanel(null); focusComposer(); }} onAccounts={() => { setReturnToOnboarding(true); setPanel("accounts"); }} onWorkspace={() => void window.grokDesktop.chooseWorkspace().then(async (cwd) => { if (cwd) { store.setSettings(await window.grokDesktop.getSettings()); store.setSessions(await window.grokDesktop.listSessions(cwd)); } })} />}
        {panel === "tasks" && <LazyTaskCenterPanel workspace={store.settings?.activeWorkspace || ""} accounts={store.accounts} setError={store.setError} confirmAction={askConfirm} onOpenSession={(task) => { if (!task.sessionId) return; void openConversationTarget({ cwd: task.workspace, sessionId: task.sessionId }).catch((error) => store.setError(errorMessage(error))); }} onClose={() => { setPanel(null); focusComposer(); }} />}
        {panel === "history" && store.activeSessionId && <SessionHistoryPanel sessionId={store.activeSessionId} confirmAction={askConfirm} onForked={async (result) => { setPanel(null); await openConversationTarget(result); }} onRewound={() => { setPanel(null); settleConversationBottom(store.activeSessionId); }} onClose={() => { setPanel(null); focusComposer(); }} />}
        {panel === "providers" && <LazyProviderManagerDialog confirmAction={askConfirm} onError={store.setError} onSettingsChanged={() => void window.grokDesktop.getSettings().then(store.setSettings)} onClose={() => setPanel(null)}/>}
        {panel && !["media", "extensions", "diagnostics", "onboarding", "tasks", "history", "providers"].includes(panel) && <ControlPanel type={panel as "settings" | "accounts" | "about"} confirmAction={askConfirm} onDiagnostics={() => setPanel("diagnostics")} onProviders={() => setPanel("providers")} onOnboarding={async () => { store.setOnboarding(await window.grokDesktop.resetOnboarding()); setPanel("onboarding"); }} onClose={() => { if (returnToOnboarding && panel === "accounts") { setReturnToOnboarding(false); setPanel("onboarding"); } else { setPanel(null); focusComposer(); } }} />}
        {activeComputerPermission && <ComputerPermissionDialog request={activeComputerPermission} onRespond={async (decision) => { try { await window.grokDesktop.respondComputerAppPermission(activeComputerPermission.requestId, decision); } catch (error) { store.setError(errorMessage(error)); } finally { setComputerPermissions((current) => omitRecordKey(current, activeComputerPermission.sessionId)); focusComposer(); } }} />}
        {activeComputerRisk && <ComputerRiskDialog request={activeComputerRisk} onRespond={async (approved) => { try { await window.grokDesktop.respondComputerRisk(activeComputerRisk.requestId, approved); } catch (error) { store.setError(errorMessage(error)); } finally { setComputerRisks((current) => omitRecordKey(current, activeComputerRisk.sessionId)); focusComposer(); } }} />}
        {dialog && <ActionDialog dialog={dialog} onClose={closeDialog} />}
      </Suspense>, document.getElementById("overlay-root")!)}
    </div>
  );
}

function WorkspaceEmptyState({ workspaces, onNew, onOpen }: { workspaces: WorkspaceSummary[]; onNew(): void; onOpen(cwd: string): void }): React.JSX.Element {
  return <div className="workspace-empty"><div className="workspace-empty-intro"><span className="empty-kicker">Grok Build Desktop</span><h2>从一个任务开始</h2><p>选择项目并描述目标。文件、Git、Worktree 和 Agent 工具会围绕当前任务展开。</p><button className="primary" onClick={onNew}><UiIcon name="plus"/>新建任务</button></div>{workspaces.length > 0 && <div className="discovered-workspaces"><h3>最近项目</h3>{workspaces.slice(0, 6).map((workspace) => <button key={workspace.cwd} disabled={!workspace.exists} onClick={() => onOpen(workspace.cwd)}><UiIcon name="folder"/><span><strong>{workspace.name}</strong><small>{workspace.cwd}</small></span><em>{workspace.exists ? `${workspace.grokSessions} 个任务` : "路径已失效"}</em><UiIcon name="chevron-right" size={14}/></button>)}</div>}</div>;
}

function ForeignSessionMirror({ source, detail, busy, onRefresh, onContinue, onHide }: { source: "Codex" | "Claude"; detail: CodexSessionDetail | ClaudeSessionDetail | null; busy: boolean; onRefresh(): Promise<void>; onContinue(): Promise<void>; onHide(): Promise<void> }): React.JSX.Element {
  if (!detail) return <div className="empty-state"><div className="spinner" /><h2>正在只读加载 {source} 会话…</h2></div>;
  const turns: Array<{ user?: string; process: Array<(CodexSessionDetail | ClaudeSessionDetail)["turns"][number]>; final?: string }> = [];
  let current: { user?: string; process: Array<(CodexSessionDetail | ClaudeSessionDetail)["turns"][number]>; final?: string } | undefined;
  for (const item of detail.turns) {
    if (item.role === "user") { if (current) turns.push(current); current = { user: item.text, process: [] }; }
    else {
      current ??= { process: [] };
      if (item.role === "assistant") { if (current.final) current.process.push({ role: "assistant", text: current.final }); current.final = item.text; }
      else current.process.push(item);
    }
  }
  if (current) turns.push(current);
  return <div className={`codex-mirror foreign-session-mirror ${source.toLocaleLowerCase()}`}><div className="codex-readonly-bar"><span>{source} 只读镜像 · 原文件不会被修改</span><button disabled={busy} onClick={() => void onRefresh()}>刷新</button><button className="primary" disabled={busy} onClick={() => void onContinue()}>在 Grok 中继续</button><button disabled={busy} onClick={() => void onHide()}>从列表隐藏</button></div><div className="codex-turns" tabIndex={0} aria-label={`${source} 只读会话内容，可滚动`}>{turns.map((turn, index) => <article className="chat-turn completed" key={`${detail.id}-${index}`}>{turn.user && <div className="message-row user"><div className="bubble user-bubble"><LazyMarkdownView text={turn.user} /></div></div>}{turn.process.length > 0 && <details className="execution-process"><summary><span className="process-dot" /><strong>执行过程</strong><span className="process-summary">{turn.process.length} 项</span></summary><div className="codex-process-items">{turn.process.map((item, itemIndex) => <details key={itemIndex} className="activity-group"><summary>{item.role === "thought" ? "思考" : item.role === "tool" ? "工具" : "过程说明"}</summary><LazyMarkdownView text={item.text || JSON.stringify(item.toolCalls || item.toolResults, null, 2)} /></details>)}</div></details>}{turn.final && <div className="final-answer"><div className="final-answer-toolbar"><span>最终回复</span><button onClick={() => void navigator.clipboard.writeText(turn.final!)}>复制</button></div><LazyMarkdownView text={turn.final} /></div>}</article>)}</div>{detail.warnings.length > 0 && <div className="codex-warnings">{detail.warnings.join("；")}</div>}</div>;
}

function ComputerLiveStrip({ task, onPause, onResume, onStop }: { task: ComputerTaskState; onPause(): void; onResume(): void; onStop(): void }): React.JSX.Element {
  const waiting = task.status === "awaiting-risk-confirmation";
  return <div className={`computer-live-strip ${task.status} ${task.manualInterventionRequired ? "manual" : ""} ${task.interventionKind === "elevation-blocked" ? "blocked" : ""}`} role="status" aria-live="polite"><span className="computer-live-dot" /><div><strong>{task.headline || (task.manualInterventionRequired ? "等待你手动完成 Windows 确认" : waiting ? "等待高影响操作确认" : task.status === "paused" ? "Computer Use 已暂停" : `Grok 正在控制 ${task.appName || "Windows 应用"}`)}</strong><span>{task.message || "正在观察目标窗口"} · {task.stepCount} 步</span></div><kbd>Esc 停止</kbd><div className="computer-live-actions">{task.status === "running" && <button onClick={onPause}>暂停</button>}{task.status === "paused" && task.interventionKind !== "elevation-blocked" && <button className="primary" onClick={onResume}>{task.manualInterventionRequired ? "已手动完成，继续" : "继续"}</button>}<button onClick={onStop}>停止</button></div></div>;
}


function EmptyState({ title, text, action, onAction }: { title: string; text: string; action: string; onAction(): void }): React.JSX.Element { return <div className="empty-state"><div className="empty-logo">G</div><h2>{title}</h2><p>{text}</p><button className="primary" onClick={onAction}>{action}</button></div>; }
function omitRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const copy = { ...record };
  delete copy[key];
  return copy;
}
function errorMessage(value: unknown): string { return value instanceof Error ? value.message : String(value); }
function normalizedWorkspacePath(value: string): string { return value.replace(/[\\/]+$/, "").toLocaleLowerCase(); }
function sameWorkspacePath(left: string, right: string): boolean { return normalizedWorkspacePath(left) === normalizedWorkspacePath(right); }
function shortPath(value: string): string { const parts = value.split(/[\\/]/).filter(Boolean); return parts.at(-1) || value; }
function relativeTime(value: string): string { const time = Date.parse(value); if (!Number.isFinite(time)) return "未知时间"; const delta = Date.now() - time; if (delta < 60_000) return "刚刚"; if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`; if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`; return `${Math.floor(delta / 86_400_000)} 天前`; }
function formatTokens(value: number): string { return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${Math.round(value / 1_000)}K` : String(value); }
function localFileUrl(path: string): string { return `file:///${path.replace(/^\\\\\?\\/, "").replace(/\\/g, "/")}`; }

async function pastedImageAttachments(files: File[]): Promise<Attachment[]> {
  return Promise.all(files.map(async (file): Promise<Attachment> => {
    if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name || "粘贴的图片"} 超过 20 MiB 图片限制`);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error("无法读取粘贴图片"));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(file);
    });
    return {
      id: crypto.randomUUID(),
      name: file.name || `pasted-image-${Date.now()}.png`,
      kind: "image",
      mimeType: file.type || "image/png",
      size: file.size,
      data: dataUrl.replace(/^data:[^;]+;base64,/, ""),
    };
  }));
}

function decodeTextAttachment(data: string): string {
  const binary = atob(data);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
