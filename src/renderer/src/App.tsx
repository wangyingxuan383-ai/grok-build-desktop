import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { AppMenuCommand, AppSettings, Attachment, ChatEvent, ClaudeSessionDetail, ClaudeSessionSummary, CodexSessionDetail, CodexSessionSummary, ComposerCapabilitySelection, ComputerAppPermissionRequest, ComputerRiskConfirmation, ComputerTaskState, ComputerUseSettings, CustomProviderProfile, ExecutionProfileLaunchInput, GitRepositoryStatus, GrokQuotaSnapshot, GrokWorktreeSummary, MediaAspectRatio, MediaCreationKind, MediaCreationRequest, MediaGenerationJob, MediaVideoDuration, MediaVideoResolution, NavigationIntent, PromptQueueEntry, ReasoningEffort, RewindPoint, SessionExecutionAssignment, SessionExecutionProfile, SessionMode, SessionOriginKind, SessionSummary, SkillSummary, ThemeSettings, TurnFailure, WorkspaceFileCandidate, WorkspaceSummary } from "../../shared/types";
import { resolveComputerMention } from "../../shared/computer-mentions";
import { buildComposerCommand, normalizeSkillCommand } from "../../shared/composer-capability";
import { LazyMarkdownView } from "./components/LazyMarkdownView";
import { TurnCard } from "./components/TurnCard";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { OnboardingPanel } from "./components/OnboardingPanel";
import { ProviderManagerDialog } from "./components/ProviderManagerDialog";
import { TaskCenterPanel } from "./components/TaskCenterPanel";
import { FileExplorer, FileWorkbench } from "./components/FileWorkbench";
import { GitExplorer, GitWorkbench } from "./components/GitWorkbench";
import { WorktreeExplorer, WorktreeWorkbench } from "./components/WorktreeWorkbench";
import { MemoryWorkbench } from "./components/MemoryWorkbench";
import { AgentPersonaWorkbench } from "./components/AgentPersonaWorkbench";
import { ExecutionProfileWorkbench, SessionLaunchDialog } from "./components/ExecutionProfileWorkbench";
import { AgentDashboardWorkbench } from "./components/AgentDashboardWorkbench";
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
import { ReviewPane } from "./components/ReviewPane";
import { FailureDiagnosisPanel } from "./components/FailureDiagnosisPanel";
import { AgentChangePane } from "./components/AgentChangePane";
import { TokenActivityPanel } from "./components/TokenActivityPanel";
import { RightUtilityPane, type RightTool } from "./components/RightUtilityPane";
import { Composer } from "./components/Composer";
import { MediaStudioPanel } from "./components/MediaStudioPanel";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { findStaleReviewComment, formatReviewComments, type ReviewCommentDraft } from "./review-comments";

const LazyExtensionsPanel = lazy(() => import("./components/ExtensionsPanel").then((module) => ({ default: module.ExtensionsPanel })));

type Panel = "settings" | "accounts" | "providers" | "about" | "media" | "extensions" | "diagnostics" | "onboarding" | "tasks" | "history" | "new-session" | null;
type DialogState = {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  input?: { value: string; placeholder?: string };
  resolve(value: string | boolean | null): void;
};

export default function App(): React.JSX.Element {
  const store = useAppStore();
  const activeWorkbenchView = useWorkbenchStore((state) => state.activeView);
  const setWorkbenchView = useWorkbenchStore((state) => state.setActiveView);
  const [panel, setPanel] = useState<Panel>(null);
  const [search, setSearch] = useState("");
  const [composer, setComposer] = useState("");
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
  const [capability, setCapability] = useState<ComposerCapabilitySelection | undefined>();
  const [computerTask, setComputerTask] = useState<ComputerTaskState | null>(null);
  const [computerPermission, setComputerPermission] = useState<ComputerAppPermissionRequest | null>(null);
  const [computerRisk, setComputerRisk] = useState<ComputerRiskConfirmation | null>(null);
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
  const hasBlockingOverlay = Boolean(panel || dialog || computerPermission || computerRisk);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const atBottomRef = useRef(true);
  const forceFollowRef = useRef(false);
  const followTurnRef = useRef(false);
  const openRequestRef = useRef(0);
  const listRequestRef = useRef(0);
  const draftLoadedKeyRef = useRef("");
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

  useEffect(() => {
    if (!hasBlockingOverlay) return;
    const root = document.getElementById("overlay-root");
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const isVisible = (element: HTMLElement): boolean => {
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    };
    const topLayer = (): HTMLElement | undefined => root ? Array.from(root.children).filter((element): element is HTMLElement => element instanceof HTMLElement && isVisible(element)).at(-1) : undefined;
    const focusTopLayer = (): void => {
      if (root?.contains(document.activeElement)) return;
      topLayer()?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')?.focus();
    };
    const focusFirst = window.setTimeout(focusTopLayer, 0);
    // A lazy panel initially mounts a Suspense fallback with no focusable
    // controls. Retry when that fallback is replaced instead of leaving focus
    // behind the modal on the composer/body. The guard above prevents async
    // panel content updates from stealing focus once the user is inside it.
    const focusObserver = new MutationObserver(() => window.setTimeout(focusTopLayer, 0));
    if (root) focusObserver.observe(root, { childList: true, subtree: true });
    const trapFocus = (event: KeyboardEvent): void => {
      const layer = topLayer();
      if (event.key !== "Tab" || !layer) return;
      const focusable = Array.from(layer.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')).filter(isVisible);
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", trapFocus, true);
    return () => {
      window.clearTimeout(focusFirst);
      focusObserver.disconnect();
      window.removeEventListener("keydown", trapFocus, true);
      document.body.style.overflow = previousOverflow;
      window.setTimeout(() => previousFocus?.focus(), 0);
    };
  }, [hasBlockingOverlay, panel, dialog, computerPermission, computerRisk]);

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
      if (event.type === "computer-permission") setComputerPermission(event.request);
      if (event.type === "computer-risk") setComputerRisk(event.request);
      if (event.type === "computer-state") {
        setComputerTask(event.state);
        if (["stopped", "completed", "error"].includes(event.state.status)) { setComputerPermission(null); setComputerRisk(null); }
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
      setComputerTask(state);
      if (["stopped", "completed", "error"].includes(state.status)) { setComputerPermission(null); setComputerRisk(null); }
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
        useAppStore.getState().setSessions([fixture.session]);
        useAppStore.getState().setActiveSession(fixture.session.id);
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

  const draftKey = store.activeSessionId || (store.settings?.activeWorkspace ? `new:${store.settings.activeWorkspace}` : "");
  const activeSending = hasSessionSubmission(sendingSessionIds, store.activeSessionId, draftKey);
  useEffect(() => {
    let cancelled = false;
    draftLoadedKeyRef.current = "";
    store.clearAttachments();
    if (!draftKey || activeCodexId || activeClaudeId) { setComposer(""); setCapability(undefined); return; }
    setCapability(undefined);
    void window.grokDesktop.getDraft(draftKey).then((draft) => {
      if (cancelled) return;
      setComposer(draft?.text || "");
      setCapability(draft?.capability);
      store.clearAttachments();
      if (draft?.attachments?.length) store.addAttachments(draft.attachments);
      draftLoadedKeyRef.current = draftKey;
    }).catch(() => { if (!cancelled) draftLoadedKeyRef.current = draftKey; });
    return () => { cancelled = true; };
  }, [draftKey, activeCodexId, activeClaudeId]);

  useEffect(() => {
    if (!draftKey || draftLoadedKeyRef.current !== draftKey || activeCodexId || activeClaudeId || activeSending) return;
    const timer = window.setTimeout(() => void window.grokDesktop.setDraft(draftKey, composer, capability, store.attachments), 250);
    return () => window.clearTimeout(timer);
  }, [composer, capability, store.attachments, draftKey, activeCodexId, activeClaudeId, activeSending]);

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
    const onFocus = (): void => {
      const state = useAppStore.getState();
      const cwd = state.settings?.activeWorkspace;
      if (cwd) void window.grokDesktop.listSessions(cwd).then(state.setSessions).catch(() => undefined);
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
      else if (event.key === "Escape" && computerRisk) { event.preventDefault(); event.stopImmediatePropagation(); void window.grokDesktop.respondComputerRisk(computerRisk.requestId, false).finally(() => { setComputerRisk(null); focusComposer(); }); }
      else if (event.key === "Escape" && computerPermission) { event.preventDefault(); event.stopImmediatePropagation(); void window.grokDesktop.respondComputerAppPermission(computerPermission.requestId, "deny").finally(() => { setComputerPermission(null); focusComposer(); }); }
      // The composer palette is a later-mounted overlay and owns the topmost
      // Escape press. Do not let an onboarding/settings panel underneath it
      // consume that key first.
      else if (event.key === "Escape" && document.querySelector(".add-palette")) return;
      else if (event.key === "Escape" && panel) { event.preventDefault(); event.stopImmediatePropagation(); setPanel(null); focusComposer(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeDialog, computerPermission, computerRisk, dialog, focusComposer, panel]);

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

  const view = store.views[store.activeSessionId];
  const activeSession = store.sessions.find((value) => value.id === store.activeSessionId);
  const activeCodex = store.codexSessions.find((value) => value.id === activeCodexId);
  const activeClaude = store.claudeSessions.find((value) => value.id === activeClaudeId);
  const turns = useMemo(() => buildChatTurns(view?.messages ?? [], view?.status, view?.turnPresentations), [view?.messages, view?.status, view?.turnPresentations]);
  const executionRoot = executionAssignment?.cwd || activeSession?.cwd || store.settings?.activeWorkspace || "";
  const lastTurnPaths = useMemo(() => {
    for (let index = turns.length - 1; index >= 0; index--) {
      const paths = Array.from(new Set(turns[index]!.groups.filter((group) => group.kind === "files").flatMap((group) => group.items.flatMap((message) => message.kind === "tool" ? (message.tool.locations ?? []).map((location) => location.path).filter((path): path is string => typeof path === "string" && path.length > 0 && isPathInExecutionRoot(path, executionRoot)) : []))));
      if (paths.length) return paths;
    }
    return [];
  }, [executionRoot, turns]);
  const utilityTurn = useMemo(() => [...turns].reverse().find((turn) => turn.final || turn.pending.some((item) => item.kind === "plan") || turn.groups.some((group) => group.items.some((item) => item.kind === "plan"))) ?? turns.at(-1), [turns]);
  const navigate = useCallback(async (intent: NavigationIntent): Promise<void> => {
    if (intent.surface === "review") {
      setWorkbenchView("chat");
      const capability = await window.grokDesktop.getGitWorkspaceCapability(intent.executionRoot);
      if (capability.available) { setReviewInitialScope("last-turn"); setRightTool("review"); }
      else setRightTool("files");
      return;
    }
    if (intent.surface === "diff") {
      const status = await window.grokDesktop.getGitStatus(intent.executionRoot);
      const change = status.changes.find((value) => value.path === intent.targetPath || value.oldPath === intent.targetPath);
      const staged = Boolean(change?.staged && !change.workingTree);
      useGitStore.getState().setRepository(intent.executionRoot, undefined, status);
      useGitStore.getState().setSelection({ path: change?.path || intent.targetPath, staged });
      useGitStore.getState().setDiff(await window.grokDesktop.getGitDiff(intent.executionRoot, staged, change?.path || intent.targetPath));
      setWorkbenchView("source-control");
      return;
    }
    const result = await window.grokDesktop.openEditorDocument(intent.executionRoot, intent.targetPath);
    if (result.kind === "external") { await window.grokDesktop.openPath(result.path); return; }
    if (!result.document) return;
    useWorkbenchStore.getState().openDocument(result.document);
    useWorkbenchStore.getState().setSelectedPath(result.relativePath);
    const activeKey = useWorkbenchStore.getState().activeTabKey;
    useWorkbenchStore.getState().updateCursor(activeKey, { lineNumber: Math.max(1, intent.line ?? 1), column: Math.max(1, intent.column ?? 1) });
    setWorkbenchView("files");
  }, [setWorkbenchView]);
  const activeComputerTask = computerTask && ["running", "paused", "awaiting-risk-confirmation"].includes(computerTask.status) ? computerTask : null;
  const lastMessageRevision = useMemo(() => {
    const last = view?.messages.at(-1);
    if (!last) return "0";
    if ("text" in last) return `${view!.messages.length}:${last.id}:${last.text.length}`;
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
    setPanel("new-session");
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
      await window.grokDesktop.openSession(session.cwd, session.id);
      if (requestId !== openRequestRef.current) return;
      settleConversationBottom(session.id);
      focusComposer();
      void refreshSessions().catch((error) => store.setError(errorMessage(error)));
    } catch (error) { store.setError(errorMessage(error)); }
    finally { if (requestId === openRequestRef.current) setOperationBusy(false); }
  };

  const openConversationTarget = async (target: { cwd: string; sessionId: string }): Promise<void> => {
    setWorkbenchView("chat");
    setRightTool(null);
    setPanel(null);
    if (useAppStore.getState().settings?.activeWorkspace.toLocaleLowerCase() !== target.cwd.toLocaleLowerCase()) {
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
      if (!sessionId) sessionId = await createSession() || "";
      if (!sessionId) return;
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
      await window.grokDesktop.setDraft(sessionId || sourceDraftKey, text, submittedCapability, attachments).catch(() => undefined);
      const current = useAppStore.getState();
      const currentDraftKey = current.activeSessionId || (current.settings?.activeWorkspace ? `new:${current.settings.activeWorkspace}` : "");
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
    else if (command === "stop-generation" && store.activeSessionId) void window.grokDesktop.cancelSession(store.activeSessionId);
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
  }), [activeSession?.id, focusComposer, setWorkbenchView, store.activeSessionId, turns]);

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
        }}
        onRename={async (session) => {
          const title = await askText("输入新的会话名称。", session.title);
          if (title?.trim()) { await window.grokDesktop.renameSession(session.id, title.trim()); await refreshSessions(); }
        }}
        onDelete={async (session) => {
          if (await askConfirm(`永久删除“${session.title}”？`, { title: "删除会话", confirmLabel: "永久删除", danger: true })) {
            await window.grokDesktop.deleteSession(session.cwd, session.id);
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
        <TopBar session={activeSession} codex={activeCodex} claude={activeClaude} workspace={executionRoot || store.settings?.activeWorkspace || ""} workbenchView={activeWorkbenchView} view={view} busy={operationBusy || activeSending || view?.status === "working"} rightToolOpen={Boolean(rightTool)} onView={setWorkbenchView} onPanel={setPanel} onToggleSidebar={() => setSidebarCollapsed((value) => !value)} onToggleRightTool={() => setRightTool((value) => value ? null : "launcher")} onReturnToChat={() => { setWorkbenchView("chat"); window.requestAnimationFrame(() => { window.dispatchEvent(new Event("resize")); focusComposer(); }); }} />
        {activeComputerTask && <ComputerLiveStrip task={activeComputerTask} onPause={() => void window.grokDesktop.pauseComputer(activeComputerTask.sessionId)} onResume={() => void window.grokDesktop.resumeComputer(activeComputerTask.sessionId)} onStop={() => void window.grokDesktop.stopComputer(activeComputerTask.sessionId)} />}
        {activeWorkbenchView === "files" ? <FileWorkbench workspace={store.settings?.activeWorkspace || ""} dialogs={workbenchDialogs} onChatReference={({ prompt, path }) => { setWorkbenchView("chat"); setComposer((value) => `${value}${value && !/\s$/.test(value) ? " " : ""}${prompt}`); if (path) void window.grokDesktop.attachmentsFromPaths([path]).then(store.addAttachments).catch((error) => store.setError(errorMessage(error))); window.setTimeout(focusComposer, 0); }} /> : activeWorkbenchView === "source-control" ? <GitWorkbench workspace={store.settings?.activeWorkspace || ""} dialogs={workbenchDialogs} /> : activeWorkbenchView === "worktrees" ? <WorktreeWorkbench workspace={store.settings?.activeWorkspace || ""} dialogs={workbenchDialogs} /> : activeWorkbenchView === "memory" ? <MemoryWorkbench workspace={store.settings?.activeWorkspace || ""} activeSessionId={store.activeSessionId} dialogs={workbenchDialogs} /> : activeWorkbenchView === "agents" ? <AgentPersonaWorkbench workspace={store.settings?.activeWorkspace || ""} dialogs={workbenchDialogs} /> : activeWorkbenchView === "profiles" ? <ExecutionProfileWorkbench workspace={store.settings?.activeWorkspace || ""} dialogs={profileDialogs} /> : activeWorkbenchView === "dashboard" ? <AgentDashboardWorkbench workspace={store.settings?.activeWorkspace || ""} setError={store.setError} onOpenSession={(sessionId) => { void openConversationTarget({ cwd: store.settings?.activeWorkspace || "", sessionId }).catch((error) => store.setError(errorMessage(error))); }} onOpenWorktree={(worktreeId) => { useWorktreeStore.getState().setSelected(worktreeId); setWorkbenchView("worktrees"); }} onOpenDefinition={() => setWorkbenchView("agents")} /> : <div className="conversation-surface"><div className="conversation-content">
        {conversationSearchOpen && <div className="conversation-search-bar"><input id="conversation-search" value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)} placeholder="搜索当前会话"/><span>{conversationMatches.length ? `${conversationMatch + 1}/${conversationMatches.length}` : "0 项"}</span><button disabled={!conversationMatches.length} onClick={() => setConversationMatch((value) => (value - 1 + conversationMatches.length) % conversationMatches.length)}>↑</button><button disabled={!conversationMatches.length} onClick={() => setConversationMatch((value) => (value + 1) % conversationMatches.length)}>↓</button><button onClick={() => { setConversationSearchOpen(false); setConversationSearch(""); focusComposer(); }}>×</button></div>}
        {!store.cli?.found ? <EmptyState title="未找到 Grok CLI" text="请在设置中指定 grok.exe 路径。" action="打开设置" onAction={() => setPanel("settings")} />
          : activeCodexId ? <ForeignSessionMirror source="Codex" detail={codexDetail} busy={operationBusy} onRefresh={async () => setCodexDetail(await window.grokDesktop.refreshCodexSession(activeCodexId))} onContinue={async () => { setOperationBusy(true); try { const result = await window.grokDesktop.continueCodexSession(activeCodexId); store.setSessions(await window.grokDesktop.setWorkspace(result.cwd)); store.setSettings(await window.grokDesktop.getSettings()); setActiveCodexId(""); setCodexDetail(null); store.setActiveSession(result.sessionId); await refreshSessions(); } catch (error) { store.setError(errorMessage(error)); } finally { setOperationBusy(false); } }} onHide={async () => { await window.grokDesktop.hideCodexSession(activeCodexId, true); store.setCodexSessions(await window.grokDesktop.listCodexSessions(store.settings?.activeWorkspace || "", store.settings?.showArchivedCodex, true)); setActiveCodexId(""); setCodexDetail(null); }} />
          : activeClaudeId ? <ForeignSessionMirror source="Claude" detail={claudeDetail} busy={operationBusy} onRefresh={async () => setClaudeDetail(await window.grokDesktop.refreshClaudeSession(activeClaudeId))} onContinue={async () => { setOperationBusy(true); try { const result = await window.grokDesktop.continueClaudeSession(activeClaudeId); store.setSessions(await window.grokDesktop.setWorkspace(result.cwd)); store.setSettings(await window.grokDesktop.getSettings()); setActiveClaudeId(""); setClaudeDetail(null); store.setActiveSession(result.sessionId); await refreshSessions(); } catch (error) { store.setError(errorMessage(error)); } finally { setOperationBusy(false); } }} onHide={async () => { await window.grokDesktop.hideClaudeSession(activeClaudeId, true); store.setClaudeSessions(await window.grokDesktop.listClaudeSessions(store.settings?.activeWorkspace || "", true)); setActiveClaudeId(""); setClaudeDetail(null); }} />
          : !activeSession && !view ? <WorkspaceEmptyState workspaces={store.workspaces} onNew={() => void openNewSessionDialog()} onOpen={async (cwd) => { store.setSessions(await window.grokDesktop.setWorkspace(cwd)); store.setSettings(await window.grokDesktop.getSettings()); }} />
          : <div className="conversation-wrap" onWheelCapture={(event) => { if (event.deltaY < 0) { followTurnRef.current = false; forceFollowRef.current = false; } }}><Virtuoso ref={virtuosoRef} className="conversation" data={turns} computeItemKey={(_index, turn) => turn.id} followOutput={(isAtBottom) => (isAtBottom || forceFollowRef.current) ? "auto" : false} atBottomStateChange={(value) => { atBottomRef.current = value; if (value && !followTurnRef.current) forceFollowRef.current = false; setAtBottom(value); }} itemContent={(index, turn) => <div className={conversationMatches[conversationMatch] === index ? "conversation-match-active" : ""}><TurnCard turn={turn} sessionId={store.activeSessionId} navigationRoot={executionRoot} showThinking={store.settings?.showThinking ?? false} expandTools={store.settings?.expandToolDetails ?? false} onNavigate={(intent) => void navigate(intent).catch((error) => store.setError(errorMessage(error)))} onOpenReview={() => void window.grokDesktop.getGitWorkspaceCapability(executionRoot).then((capability) => { if (capability.available) { setReviewInitialScope("last-turn"); setRightTool("review"); } else setRightTool("agent-changes"); }).catch((error) => store.setError(errorMessage(error)))} onFork={index === turns.length - 1 ? () => setPanel("history") : undefined} onResolved={(id) => store.resolveMessage(store.activeSessionId, id)} onDiagnose={setDiagnosingFailure} onRetry={(message) => { setComposer(message.text); store.clearAttachments(); store.addAttachments((message.attachments ?? []).filter((attachment) => attachment.availability === "ready" && Boolean(attachment.source)).map((attachment) => ({ id: attachment.id, name: attachment.name, kind: attachment.kind, mimeType: attachment.mimeType, size: attachment.size, ...(attachment.isData ? { data: attachment.source } : { path: attachment.source }) }))); focusComposer(); }} /></div>} />{!atBottom && !!turns.length && <button className="scroll-to-bottom" onClick={() => { followTurnRef.current = false; forceFollowRef.current = true; atBottomRef.current = true; setAtBottom(true); scrollConversationNow("smooth"); }}>↓ 回到底部</button>}</div>}</div>
        {diagnosingFailure && createPortal(<FailureDiagnosisPanel failure={diagnosingFailure} onClose={() => setDiagnosingFailure(undefined)} />, document.getElementById("overlay-root")!)}
        {!activeCodexId && !activeClaudeId && <Composer
          inputRef={composerRef}
          text={composer}
          setText={setComposer}
          busy={view?.status === "working"}
          controlsDisabled={operationBusy || activeSending || view?.status === "needs-user"}
          sessionId={store.activeSessionId}
          attachments={store.attachments}
          reviewComments={reviewComments}
          notice={composerNotice}
          onDismissNotice={() => setComposerNotice("")}
          commandMatches={commandMatches}
          fileMatches={fileMatches}
          view={view}
          onSend={() => void send(view?.status === "working" ? "queue" : "normal")}
          onInterject={() => void send("interject")}
          onBlockedSubmit={() => {
            const reason = view?.status === "needs-user" ? "请先处理当前的计划、权限或问题卡片，然后再发送。"
              : activeSending ? "当前会话的消息正在提交，稍后会自动恢复。"
              : "界面正在处理其它操作，请稍候。";
            setComposerNotice(reason);
            window.setTimeout(() => setComposerNotice(""), 4_000);
          }}
          onStop={() => store.activeSessionId && void window.grokDesktop.cancelSession(store.activeSessionId)}
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
          computerTask={computerTask?.sessionId === store.activeSessionId ? computerTask : null}
          onCapability={setCapability}
          onComputer={chooseComputerCapability}
          onClearCapability={() => setCapability(undefined)}
          onManageExtensions={() => setPanel("extensions")}
          onHistory={navigatePromptHistory}
          onControlSettled={focusComposer}
        />}</div>}
      </main>
      {rightTool === "agent-changes" && activeWorkbenchView === "chat" && <AgentChangePane sessionId={store.activeSessionId} onClose={() => setRightTool(null)} onNavigate={(intent) => void navigate(intent).catch((error) => store.setError(errorMessage(error)))} onError={store.setError} />}
      {rightTool === "review" && activeWorkbenchView === "chat" && <ReviewPane cwd={executionRoot} sessionId={store.activeSessionId} lastTurnPaths={lastTurnPaths} initialKind={reviewInitialScope} onClose={() => setRightTool(null)} onNavigate={(intent) => void navigate(intent).catch((error) => store.setError(errorMessage(error)))} onAddComment={(comment) => { setReviewComments((values) => [...values, comment]); focusComposer(); }} onError={store.setError} />}
      {rightTool && rightTool !== "review" && rightTool !== "agent-changes" && activeWorkbenchView === "chat" && <RightUtilityPane tool={rightTool} turn={utilityTurn} cwd={executionRoot} sessionId={store.activeSessionId} paths={lastTurnPaths} queue={view?.queue ?? []} sessionStatus={view?.status} onTool={(tool) => { if (tool === "review") setReviewInitialScope("unstaged"); setRightTool(tool); }} onClose={() => setRightTool(null)} onNavigate={(intent) => void navigate(intent).catch((error) => store.setError(errorMessage(error)))} onExpandResult={() => { setRightTool(null); const index = utilityTurn ? turns.findIndex((turn) => turn.id === utilityTurn.id) : turns.length - 1; if (index >= 0) virtuosoRef.current?.scrollToIndex({ index, align: "end", behavior: "smooth" }); }} onError={store.setError}/>}
      </div>
      {createPortal(<>
        {store.error && <div className="toast error-toast"><span>{store.error}</span><button onClick={() => window.location.reload()}>重新加载界面</button><button onClick={() => setPanel("diagnostics")}>诊断</button><button onClick={() => store.setError("")}>×</button></div>}
        {panel === "media" && <MediaStudioPanel hasGrokConversation={Boolean(!activeCodexId && !activeClaudeId && store.activeSessionId)} commands={activeCodexId || activeClaudeId ? [] : view?.commands ?? []} onCreate={createMedia} onClose={() => { setPanel(null); focusComposer(); }} />}
        {panel === "extensions" && <Suspense fallback={<div className="modal-backdrop"><section className="control-panel"><div className="panel-body">正在加载扩展中心…</div></section></div>}><LazyExtensionsPanel confirmAction={askConfirm} setError={store.setError} onUseSkill={(command) => { setComposer(command); focusComposer(); }} onClose={() => { setPanel(null); focusComposer(); }} /></Suspense>}
        {panel === "diagnostics" && <DiagnosticsPanel onClose={() => { setPanel(null); focusComposer(); }} />}
        {panel === "onboarding" && store.onboarding && <OnboardingPanel state={store.onboarding} onState={store.setOnboarding} onClose={() => { setReturnToOnboarding(false); setPanel(null); focusComposer(); }} onAccounts={() => { setReturnToOnboarding(true); setPanel("accounts"); }} onWorkspace={() => void window.grokDesktop.chooseWorkspace().then(async (cwd) => { if (cwd) { store.setSettings(await window.grokDesktop.getSettings()); store.setSessions(await window.grokDesktop.listSessions(cwd)); } })} />}
        {panel === "tasks" && <TaskCenterPanel workspace={store.settings?.activeWorkspace || ""} accounts={store.accounts} setError={store.setError} confirmAction={askConfirm} onOpenSession={(task) => { if (!task.sessionId) return; void openConversationTarget({ cwd: task.workspace, sessionId: task.sessionId }).catch((error) => store.setError(errorMessage(error))); }} onClose={() => { setPanel(null); focusComposer(); }} />}
        {panel === "history" && store.activeSessionId && <SessionHistoryPanel sessionId={store.activeSessionId} confirmAction={askConfirm} onForked={async (result) => { setPanel(null); await window.grokDesktop.openSession(result.cwd, result.sessionId); store.setSessions(await window.grokDesktop.listSessions(store.settings?.activeWorkspace || result.cwd)); store.setActiveSession(result.sessionId); settleConversationBottom(result.sessionId); }} onRewound={() => { setPanel(null); settleConversationBottom(store.activeSessionId); }} onClose={() => { setPanel(null); focusComposer(); }} />}
        {panel === "new-session" && store.settings?.activeWorkspace && <SessionLaunchDialog workspace={store.settings.activeWorkspace} onClose={() => { setPanel(null); focusComposer(); }} onLaunch={async (input) => { const sessionId = await createSession(input); if (sessionId) setPanel(null); }}/>}
        {panel === "providers" && <ProviderManagerDialog confirmAction={askConfirm} onError={store.setError} onSettingsChanged={() => void window.grokDesktop.getSettings().then(store.setSettings)} onClose={() => setPanel(null)}/>}
        {panel && !["media", "extensions", "diagnostics", "onboarding", "tasks", "history", "new-session", "providers"].includes(panel) && <ControlPanel type={panel as "settings" | "accounts" | "about"} confirmAction={askConfirm} onDiagnostics={() => setPanel("diagnostics")} onProviders={() => setPanel("providers")} onOnboarding={async () => { store.setOnboarding(await window.grokDesktop.resetOnboarding()); setPanel("onboarding"); }} onClose={() => { if (returnToOnboarding && panel === "accounts") { setReturnToOnboarding(false); setPanel("onboarding"); } else { setPanel(null); focusComposer(); } }} />}
        {computerPermission && <ComputerPermissionDialog request={computerPermission} onRespond={async (decision) => { try { await window.grokDesktop.respondComputerAppPermission(computerPermission.requestId, decision); } catch (error) { store.setError(errorMessage(error)); } finally { setComputerPermission(null); focusComposer(); } }} />}
        {computerRisk && <ComputerRiskDialog request={computerRisk} onRespond={async (approved) => { try { await window.grokDesktop.respondComputerRisk(computerRisk.requestId, approved); } catch (error) { store.setError(errorMessage(error)); } finally { setComputerRisk(null); focusComposer(); } }} />}
        {dialog && <ActionDialog dialog={dialog} onClose={closeDialog} />}
      </>, document.getElementById("overlay-root")!)}
    </div>
  );
}

function SessionHistoryPanel({ sessionId, onClose, onForked, onRewound, confirmAction }: { sessionId: string; onClose(): void; onForked(result: { sessionId: string; parentSessionId: string; cwd: string }): void; onRewound(): void; confirmAction(message: string, options?: { title?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> }): React.JSX.Element {
  const [points, setPoints] = useState<RewindPoint[]>([]); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("");
  const [profiles, setProfiles] = useState<SessionExecutionProfile[]>([]); const [profileId, setProfileId] = useState(""); const [workspace, setWorkspace] = useState(""); const [worktreeName, setWorktreeName] = useState(""); const [worktreeRef, setWorktreeRef] = useState("");
  useEffect(() => { setNotice(""); void (async () => { const assignment = await window.grokDesktop.getSessionExecutionAssignment(sessionId); const cwd = assignment?.sourceWorkspacePath || useAppStore.getState().sessions.find((value) => value.id === sessionId)?.cwd || useAppStore.getState().settings?.activeWorkspace || ""; setWorkspace(cwd); const values = (await window.grokDesktop.listExecutionProfiles(cwd)).filter((value) => value.effective); setProfiles(values); setProfileId(assignment?.profileId && values.some((value) => value.id === assignment.profileId) ? assignment.profileId : values.find((value) => value.id === "builtin-normal")?.id || values[0]?.id || ""); setPoints(await window.grokDesktop.listRewindPoints(sessionId)); })().catch((error) => setNotice(errorMessage(error))).finally(() => setLoading(false)); }, [sessionId]);
  const selectedProfile = profiles.find((value) => value.id === profileId);
  const fork = async (pointId?: string): Promise<void> => { setBusy(true); setNotice(""); try { onForked(await window.grokDesktop.forkSession(sessionId, pointId, workspace && profileId ? { workspacePath: workspace, profileId, ...(selectedProfile?.worktree ? { worktreeName: worktreeName.trim() || undefined, worktreeRef: worktreeRef.trim() || undefined } : {}) } : undefined)); } catch (error) { setNotice(`当前 CLI 无法创建分叉：${errorMessage(error)}`); } finally { setBusy(false); } };
  const rewind = async (point: RewindPoint, mode: "conversation" | "conversation-and-files" | "files"): Promise<void> => { const affectsFiles = mode !== "conversation"; if (!await confirmAction(affectsFiles ? `回退到“${point.label}”并恢复文件？预计影响 ${point.filesChanged ?? "若干"} 个文件。` : `仅将对话回退到“${point.label}”？工作区文件不会改变。`, { title: "回退会话", confirmLabel: affectsFiles ? "确认回退文件" : "回退对话", danger: affectsFiles })) return; setBusy(true); setNotice(""); try { await window.grokDesktop.rewindSession(sessionId, point.id, mode); onRewound(); } catch (error) { setNotice(`当前 CLI 无法回退：${errorMessage(error)}`); } finally { setBusy(false); } };
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="control-panel session-history-panel" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><header><div><h2>分叉与回退</h2><small>分叉不会修改原会话；涉及文件的回退会先确认。</small></div><button onClick={onClose}>×</button></header><div className="panel-scroll"><div className="fork-profile-picker"><label>分叉执行配置档<select value={profileId} onChange={(event) => setProfileId(event.target.value)}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>{selectedProfile?.worktree && <><label>Worktree 名称<input value={worktreeName} onChange={(event) => setWorktreeName(event.target.value)} placeholder="留空自动生成"/></label><label>基础 Ref<input value={worktreeRef} onChange={(event) => setWorktreeRef(event.target.value)} placeholder={selectedProfile.worktreeRef || "当前 HEAD"}/></label></>}</div><button className="primary" disabled={busy || !profileId} onClick={() => void fork()}>从当前末尾创建分叉</button>{notice && <p className="inline-error" role="status">{notice}</p>}{loading ? <p>正在读取可用回退点…</p> : points.length ? <div className="rewind-list">{points.map((point) => <article key={point.id}><div><strong>{point.label}</strong><span>{point.userMessage || point.createdAt || point.id}</span><small>{point.filesChanged !== undefined ? `${point.filesChanged} 个文件变更` : "文件影响由 CLI 在执行前确定"}</small></div><div className="provider-actions"><button disabled={busy || !profileId} onClick={() => void fork(point.id)}>从这里分叉</button><button disabled={busy} onClick={() => void rewind(point, "conversation")}>仅回退对话</button><button disabled={busy} onClick={() => void rewind(point, "conversation-and-files")}>对话和文件</button><button disabled={busy} onClick={() => void rewind(point, "files")}>仅文件</button></div></article>)}</div> : <p className="empty-copy">当前 CLI 没有提供回退点，或此会话尚无可回退内容。</p>}</div></section></div>;
}

function ControlPanel({ type, onClose, confirmAction, onDiagnostics, onProviders, onOnboarding }: { type: "settings" | "accounts" | "about"; onClose(): void; onDiagnostics(): void; onProviders(): void; onOnboarding(): void; confirmAction(message: string, options?: { title?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> }): React.JSX.Element {
  const store = useAppStore();
  const [apiLabel, setApiLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(store.settings!);
  const [quota, setQuota] = useState<GrokQuotaSnapshot | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const activeAccountId = store.accounts.find((value) => value.active)?.id;
  // Keep the account currently driving the CLI visible even when a user has
  // many saved profiles; the bounded list scrolls instead of growing the
  // dialog or squeezing every row.
  const displayAccounts = [...store.accounts].sort((left, right) => Number(right.active) - Number(left.active));
  const refreshQuota = useCallback(async (force = false): Promise<void> => {
    setQuotaLoading(true);
    try { setQuota(await window.grokDesktop.getQuota(force)); }
    catch (error) { store.setError(errorMessage(error)); }
    finally { setQuotaLoading(false); }
  }, []);
  useEffect(() => { if (type === "accounts" && activeAccountId) void refreshQuota(false); }, [type, activeAccountId, refreshQuota]);
  const refreshAccounts = async (): Promise<void> => store.setAccounts(await window.grokDesktop.listAccounts());
  const knownModels = Array.from(new Map(Object.values(store.views).flatMap((view) => view.models).map((model) => [model.modelId, model])).values());
  if ((type as string) === "settings") return <SettingsDialog initial={settingsDraft} knownModels={knownModels} onClose={onClose} onDiagnostics={onDiagnostics} onProviders={onProviders} />;
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="control-panel" onMouseDown={(event) => event.stopPropagation()}><header><h2>{type === "accounts" ? "账号" : type === "settings" ? "设置" : "关于"}</h2><button onClick={onClose}>×</button></header>
    {type === "accounts" && <div className="panel-body"><div className="account-list-heading"><strong>已保存账号</strong><span>{store.accounts.length} 个</span></div><div className="account-list">{displayAccounts.map((account) => <div className={`account-row ${account.active ? "active" : ""}`} key={account.id}><span className="avatar">{account.label.slice(0, 1).toUpperCase()}</span><div><strong title={account.label}>{account.label}</strong><span title={account.email || undefined}>{account.email || (account.kind === "api-key" ? "API Key 配置档" : "OAuth 账号")}</span></div>{account.active ? <b>当前</b> : <button onClick={async () => { setSaving(true); try { store.setAccounts(await window.grokDesktop.switchAccount(account.id)); } catch (error) { store.setError(errorMessage(error)); } finally { setSaving(false); } }}>切换</button>}<button className="danger-link" onClick={async () => { if (await confirmAction("移除此账号配置？", { title: "移除账号", confirmLabel: "移除", danger: true })) store.setAccounts(await window.grokDesktop.removeAccount(account.id)); }}>移除</button></div>)}</div><QuotaPanel quota={quota} loading={quotaLoading} onRefresh={() => void refreshQuota(true)} /><div className="login-box"><h3>添加账号</h3><button className="primary full" disabled={store.login.running || saving} onClick={async () => { try { store.setLogin(await window.grokDesktop.loginDevice()); await refreshAccounts(); } catch (error) { store.setError(errorMessage(error)); } }}>使用浏览器/设备码登录</button>{store.login.message && <p>{store.login.message}</p>}{store.login.url && <div className="device-card"><code>{store.login.url}</code>{store.login.code && <strong>{store.login.code}</strong>}<div className="button-row"><button onClick={() => void navigator.clipboard.writeText(store.login.code || store.login.url!)}>复制</button><button onClick={() => void window.grokDesktop.openExternal(store.login.url!)}>重新打开浏览器</button></div></div>}<div className="separator"><span>或使用 API Key</span></div><input placeholder="配置名称" value={apiLabel} onChange={(event) => setApiLabel(event.target.value)} /><input type="password" placeholder="xAI API Key" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /><button disabled={!apiKey.trim()} onClick={async () => { try { store.setAccounts(await window.grokDesktop.loginApiKey(apiLabel, apiKey)); setApiKey(""); setApiLabel(""); } catch (error) { store.setError(errorMessage(error)); } }}>保存并验证 API Key</button></div>{store.accounts.some((value) => value.active) && <button className="danger full" onClick={async () => { if (await confirmAction("退出会清除当前凭据配置，继续吗？", { title: "退出账号", confirmLabel: "退出", danger: true })) { await window.grokDesktop.logout(); await refreshAccounts(); } }}>退出当前账号</button>}<section className="provider-entry-card"><div><h3>自定义提供商</h3><p>使用独立管理中心测试连接、发现和批量导入模型。</p></div><button onClick={onProviders}>管理提供商</button></section></div>}
    {type === "settings" && <div className="panel-body settings-form"><label>Grok CLI 路径<input value={settingsDraft.cliPath} placeholder="自动发现 %USERPROFILE%\\.grok\\bin\\grok.exe" onChange={(event) => setSettingsDraft({ ...settingsDraft, cliPath: event.target.value })} /></label><label>默认模型<input list="known-models" value={settingsDraft.defaultModel} placeholder="由 CLI 动态提供" onChange={(event) => setSettingsDraft({ ...settingsDraft, defaultModel: event.target.value })} /><datalist id="known-models">{knownModels.map((model) => <option key={model.modelId} value={model.modelId}>{model.name}</option>)}</datalist></label><label>新会话默认推理强度<select value={settingsDraft.defaultEffort} onChange={(event) => setSettingsDraft({ ...settingsDraft, defaultEffort: event.target.value as ReasoningEffort })}><option value="">CLI 默认</option>{["auto", "none", "minimal", "low", "medium", "high", "xhigh", "max"].map((value) => <option key={value}>{value}</option>)}</select></label><label>默认模式<select value={settingsDraft.defaultMode} onChange={(event) => setSettingsDraft({ ...settingsDraft, defaultMode: event.target.value as SessionMode })}><option value="agent">Agent</option><option value="plan">Plan</option><option value="auto">自动批准</option></select></label><label>HTTP 代理<input value={settingsDraft.httpProxy} onChange={(event) => setSettingsDraft({ ...settingsDraft, httpProxy: event.target.value })} /></label><label>HTTPS 代理<input value={settingsDraft.httpsProxy} onChange={(event) => setSettingsDraft({ ...settingsDraft, httpsProxy: event.target.value })} /></label><label>文字大小 <strong>{settingsDraft.fontScale}%</strong><input type="range" min="85" max="130" step="5" value={settingsDraft.fontScale} onChange={(event) => setSettingsDraft({ ...settingsDraft, fontScale: Number(event.target.value) })} /><small>只调整文字；建议保持 100%。</small></label><label>界面密度<select value={settingsDraft.uiDensity} onChange={(event) => setSettingsDraft({ ...settingsDraft, uiDensity: event.target.value as AppSettings["uiDensity"] })}><option value="compact">紧凑（更多内容）</option><option value="balanced">标准（推荐）</option><option value="comfortable">宽松</option></select><small>独立调整侧栏、间距和输入区大小，不会缩小文字。</small></label><label className="check"><input type="checkbox" checked={settingsDraft.showThinking} onChange={(event) => setSettingsDraft({ ...settingsDraft, showThinking: event.target.checked })} />显示完整思考过程</label><label className="check"><input type="checkbox" checked={settingsDraft.expandToolDetails} onChange={(event) => setSettingsDraft({ ...settingsDraft, expandToolDetails: event.target.checked })} />默认展开工具详情和 Diff</label><ThemeEditor theme={settingsDraft.theme} onChanged={(settings) => { setSettingsDraft((current) => ({ ...current, theme: settings.theme })); store.setSettings(settings); }} setError={store.setError} /><button className="primary" onClick={async () => { const settings = await window.grokDesktop.updateSettings(settingsDraft); store.setSettings(settings); onClose(); }}>保存设置</button><button onClick={() => void window.grokDesktop.exportLogs()}>导出脱敏日志</button></div>}
    {type === "about" && <div className="panel-body about"><div className="about-logo">G</div><h3>Grok Build Desktop {store.appVersion}</h3><p>非官方社区客户端，与 xAI 无隶属关系。Grok CLI 与模型服务由 xAI 提供。</p><dl><dt>应用渠道</dt><dd>{store.buildInfo?.channel || "stable"}</dd><dt>构建提交</dt><dd>{store.buildInfo?.commit || "未知"}</dd><dt>CLI</dt><dd>{store.cli?.currentVersion || "未知"}</dd><dt>CLI 渠道</dt><dd>{store.cli?.channel || "未知"}</dd></dl><h4>应用更新</h4><p>{store.appRelease?.error || (store.appRelease?.updateAvailable ? `发现 ${store.appRelease.latestVersion}，请在 GitHub Release 下载并手动核对 SHA-256。` : store.appRelease ? "当前已是最新稳定版。" : "尚未检查。")}</p><div className="button-row"><button onClick={async () => store.setAppRelease(await window.grokDesktop.checkAppUpdate(true))}>检查应用更新</button>{store.appRelease?.releaseUrl && <button className="primary" onClick={() => window.grokDesktop.openAppRelease(store.appRelease?.releaseUrl)}>打开 GitHub Release</button>}</div><div className="button-row"><button onClick={onDiagnostics}>兼容诊断中心</button><button onClick={onOnboarding}>重新运行首次设置</button></div><h4>Grok CLI 更新</h4><div className="button-row"><button onClick={async () => store.setCli(await window.grokDesktop.checkCliUpdate())}>检查 CLI 更新</button>{store.cli?.updateAvailable && <button className="primary" onClick={async () => { if (!await confirmAction("更新会停止所有实时会话，继续吗？", { title: "更新 Grok CLI", confirmLabel: "更新并验证" })) return; try { store.setCli(await window.grokDesktop.applyCliUpdate()); store.setUpdateHistory(await window.grokDesktop.getCliUpdateHistory()); } catch (error) { store.setError(errorMessage(error)); } }}>更新并验证</button>}</div><h4>CLI 更新历史</h4><div className="history-list">{store.updateHistory.slice(0, 10).map((record, index) => <div key={`${record.at}-${index}`}><strong>{record.status}</strong><span>{new Date(record.at).toLocaleString()}</span><p>{record.message}</p></div>)}</div><h4>应用更新日志</h4><pre className="changelog">{store.changelog}</pre></div>}
  </section></div>;
}

function ThemeEditor({ theme, onChanged, setError }: { theme: ThemeSettings; onChanged(settings: AppSettings): void; setError(message: string): void }): React.JSX.Element {
  const update = async (patch: Partial<ThemeSettings>): Promise<void> => {
    try { onChanged(await window.grokDesktop.updateTheme(patch)); }
    catch (error) { setError(errorMessage(error)); }
  };
  const updateBackground = (patch: Partial<ThemeSettings["background"]>): void => { void update({ background: { ...theme.background, ...patch } }); };
  const ratio = contrastRatio(theme.colors.text, theme.colors.background);
  const colorLabels: Array<[keyof ThemeSettings["colors"], string]> = [["background", "页面背景"], ["surface", "面板/卡片"], ["text", "主文字"], ["muted", "次要文字"], ["accent", "强调色"], ["border", "边框"]];
  return <fieldset className="theme-editor"><legend>外观与背景</legend><label>主题<select value={theme.mode} onChange={(event) => void update({ mode: event.target.value as ThemeSettings["mode"] })}><option value="dark">经典深色</option><option value="light">经典浅色</option><option value="system">跟随 Windows</option><option value="custom">自定义颜色</option></select></label>{theme.mode === "custom" && <><label>自定义主题基础<select value={theme.customBase} onChange={(event) => void update({ customBase: event.target.value as ThemeSettings["customBase"] })}><option value="dark">深色基础</option><option value="light">浅色基础</option></select></label><div className="theme-color-grid">{colorLabels.map(([key, label]) => <label key={key}>{label}<span><input type="color" value={theme.colors[key]} onChange={(event) => void update({ colors: { ...theme.colors, [key]: event.target.value } })} /><code>{theme.colors[key]}</code></span></label>)}</div><div className={`contrast-note ${ratio < 4.5 ? "warning" : "ok"}`}>文字与背景对比度 {ratio.toFixed(2)}:1{ratio < 4.5 ? "，建议提高到 4.5:1 以上" : "，可读性良好"}</div><div className="button-row"><button onClick={() => void update({ colors: DARK_COLORS, customBase: "dark" })}>深色预设</button><button onClick={() => void update({ colors: LIGHT_COLORS, customBase: "light" })}>浅色预设</button></div></>}<div className="theme-background"><div className="button-row"><button onClick={async () => { try { const settings = await window.grokDesktop.pickThemeBackground(); if (settings) onChanged(settings); } catch (error) { setError(errorMessage(error)); } }}>选择背景图片…</button>{theme.background.enabled && <><button onClick={() => updateBackground({ fit: "cover", position: "center", opacity: 1, blur: 0, dim: 0 })}>重置背景参数</button><button onClick={async () => { try { onChanged(await window.grokDesktop.removeThemeBackground()); } catch (error) { setError(errorMessage(error)); } }}>移除背景图片</button></>}</div>{theme.background.enabled && <><label>背景范围<select value={theme.background.scope} onChange={(event) => updateBackground({ scope: event.target.value as ThemeSettings["background"]["scope"] })}><option value="conversation">仅对话区</option><option value="window">整个应用窗口</option></select></label><label>适配方式<select value={theme.background.fit} onChange={(event) => updateBackground({ fit: event.target.value as ThemeSettings["background"]["fit"] })}><option value="cover">覆盖区域</option><option value="contain">完整显示</option></select></label><label>位置<select value={theme.background.position} onChange={(event) => updateBackground({ position: event.target.value as ThemeSettings["background"]["position"] })}><option value="center">居中</option><option value="top">顶部</option><option value="bottom">底部</option><option value="left">左侧</option><option value="right">右侧</option></select></label><label>图片透明度 <strong>{Math.round(theme.background.opacity * 100)}%</strong><input type="range" min="0.05" max="1" step="0.05" value={theme.background.opacity} onChange={(event) => updateBackground({ opacity: Number(event.target.value) })} /></label><label>模糊 <strong>{theme.background.blur}px</strong><input type="range" min="0" max="24" step="1" value={theme.background.blur} onChange={(event) => updateBackground({ blur: Number(event.target.value) })} /></label><label>遮罩 <strong>{Math.round(theme.background.dim * 100)}%</strong><input type="range" min="0" max="0.9" step="0.05" value={theme.background.dim} onChange={(event) => updateBackground({ dim: Number(event.target.value) })} /></label></>}</div></fieldset>;
}

type SettingsCategory = "general" | "appearance" | "models" | "tokens" | "project" | "worktree" | "agents" | "accounts" | "computer" | "updates" | "archived";

function SettingsDialog({ initial, knownModels, onClose, onDiagnostics, onProviders }: { initial: AppSettings; knownModels: Array<{ modelId: string; name: string }>; onClose(): void; onDiagnostics(): void; onProviders(): void }): React.JSX.Element {
  const store = useAppStore();
  const [draft, setDraft] = useState(initial);
  const [category, setCategory] = useState<SettingsCategory>("general");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [computer, setComputer] = useState<ComputerUseSettings>();
  const [updateActions, setUpdateActions] = useState<Record<string, { state: "running" | "success" | "error" | "cancelled"; message: string; at: string }>>({});
  useEffect(() => { if (category === "computer" && !computer) void window.grokDesktop.getComputerSettings().then(setComputer).catch((error) => store.setError(errorMessage(error))); }, [category, computer]);
  const categories: Array<{ id: SettingsCategory; label: string; icon: UiIconName }> = [
    { id: "general", label: "常规", icon: "settings" }, { id: "appearance", label: "外观", icon: "sparkles" }, { id: "models", label: "模型与会话", icon: "chat" }, { id: "tokens", label: "Token 活动", icon: "dashboard" },
    { id: "project", label: "项目与 Git", icon: "git" }, { id: "worktree", label: "Worktree 与 Memory", icon: "worktree" }, { id: "agents", label: "Agent", icon: "agents" },
    { id: "accounts", label: "账号与提供商", icon: "account" }, { id: "computer", label: "Computer Use", icon: "workbench" }, { id: "updates", label: "更新与诊断", icon: "download" }, { id: "archived", label: "已归档会话", icon: "archive" },
  ];
  const save = async (): Promise<void> => { setSaveState("saving"); try { const value = await window.grokDesktop.updateSettings(draft); store.setSettings(value); setDraft(value); setSaveState("saved"); window.setTimeout(() => setSaveState("idle"), 1400); } catch (error) { setSaveState("idle"); store.setError(errorMessage(error)); } };
  const updateComputer = async (patch: Partial<ComputerUseSettings>): Promise<void> => { try { setComputer(await window.grokDesktop.updateComputerSettings(patch)); } catch (error) { store.setError(errorMessage(error)); } };
  const runUpdateAction = async (key: string, action: () => Promise<string>): Promise<void> => {
    if (updateActions[key]?.state === "running") return;
    setUpdateActions((value) => ({ ...value, [key]: { state: "running", message: "正在执行…", at: new Date().toISOString() } }));
    try {
      const message = await action();
      setUpdateActions((value) => ({ ...value, [key]: { state: message === "已取消" ? "cancelled" : "success", message, at: new Date().toISOString() } }));
    } catch (error) {
      setUpdateActions((value) => ({ ...value, [key]: { state: "error", message: errorMessage(error), at: new Date().toISOString() } }));
    }
  };
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="settings-dialog" role="dialog" aria-modal="true" aria-label="设置" onMouseDown={(event) => event.stopPropagation()}>
    <header><div><h2>设置</h2><span>{saveState === "saving" ? "正在保存…" : saveState === "saved" ? "已保存" : "Grok Build Desktop"}</span></div><button className="icon-button" aria-label="关闭设置" onClick={onClose}><UiIcon name="close"/></button></header>
    <div className="settings-layout"><nav aria-label="设置分类">{categories.map((item) => <button key={item.id} className={category === item.id ? "active" : ""} onClick={() => setCategory(item.id)}><UiIcon name={item.icon}/><span>{item.label}</span></button>)}</nav><main className="settings-content">
      {category === "general" && <SettingsSection title="常规" description="调整整个桌面应用的阅读密度和本地 CLI 位置。"><label>Grok CLI 路径<input value={draft.cliPath} placeholder="自动发现 %USERPROFILE%\\.grok\\bin\\grok.exe" onChange={(event) => setDraft({ ...draft, cliPath: event.target.value })}/></label><label>文字大小 <strong>{draft.fontScale}%</strong><input type="range" min="85" max="130" step="5" value={draft.fontScale} onChange={(event) => setDraft({ ...draft, fontScale: Number(event.target.value) })}/></label><label>界面密度<select value={draft.uiDensity} onChange={(event) => setDraft({ ...draft, uiDensity: event.target.value as AppSettings["uiDensity"] })}><option value="compact">紧凑</option><option value="balanced">标准（推荐）</option><option value="comfortable">宽松</option></select></label></SettingsSection>}
      {category === "appearance" && <SettingsSection title="外观" description="背景参数实时生效；消息和代码卡片自行保证可读性。"><div className="background-preview" style={{ backgroundImage: "var(--theme-background-image)", backgroundSize: draft.theme.background.fit, backgroundPosition: draft.theme.background.position }}><span>会话背景预览</span><small>{draft.theme.background.scope === "conversation" ? "仅会话区" : "整个应用窗口"} · 透明度 {Math.round(draft.theme.background.opacity * 100)}% · 遮罩 {Math.round(draft.theme.background.dim * 100)}%</small></div><ThemeEditor theme={draft.theme} onChanged={(settings) => { setDraft((current) => ({ ...current, theme: settings.theme })); store.setSettings(settings); }} setError={store.setError}/></SettingsSection>}
      {category === "models" && <SettingsSection title="模型与会话" description="这些选项用于新会话；活动会话仍使用输入框中的实时控件。"><label>默认模型<input list="settings-known-models" value={draft.defaultModel} placeholder="由 CLI 动态提供" onChange={(event) => setDraft({ ...draft, defaultModel: event.target.value })}/><datalist id="settings-known-models">{knownModels.map((model) => <option key={model.modelId} value={model.modelId}>{model.name}</option>)}</datalist></label><label>默认推理强度<select value={draft.defaultEffort} onChange={(event) => setDraft({ ...draft, defaultEffort: event.target.value as ReasoningEffort })}><option value="">CLI 默认</option>{["auto", "none", "minimal", "low", "medium", "high", "xhigh", "max"].map((value) => <option key={value}>{value}</option>)}</select></label><label>默认模式<select value={draft.defaultMode} onChange={(event) => setDraft({ ...draft, defaultMode: event.target.value as SessionMode })}><option value="agent">Agent</option><option value="plan">Plan</option><option value="auto">自动批准</option></select></label><label className="check"><input type="checkbox" checked={draft.showThinking} onChange={(event) => setDraft({ ...draft, showThinking: event.target.checked })}/>显示完整思考过程</label><label className="check"><input type="checkbox" checked={draft.expandToolDetails} onChange={(event) => setDraft({ ...draft, expandToolDetails: event.target.checked })}/>默认展开工具详情和 Diff</label></SettingsSection>}
      {category === "project" && <SettingsSection title="项目与 Git" description="Review 使用真实会话/Worktree 执行目录，并在主进程校验仓库边界。"><label>HTTP 代理<input value={draft.httpProxy} onChange={(event) => setDraft({ ...draft, httpProxy: event.target.value })}/></label><label>HTTPS 代理<input value={draft.httpsProxy} onChange={(event) => setDraft({ ...draft, httpsProxy: event.target.value })}/></label><dl className="settings-facts"><dt>当前项目</dt><dd>{draft.activeWorkspace || "未选择"}</dd><dt>Git 写操作</dt><dd>固定参数数组与 stdin，不经过 shell</dd></dl></SettingsSection>}
      {category === "worktree" && <SettingsSection title="Worktree 与 Memory" description="创建、应用和清理 Worktree，以及 Memory 的结构化编辑，位于左侧“开发工具”中。"><p className="settings-note">执行配置档可决定新任务是否自动创建隔离 Worktree；Memory 的保存、删除和 Dream 操作继续由主进程完成。</p></SettingsSection>}
      {category === "agents" && <SettingsSection title="Agent" description="Agent、Persona 与 Profiles 在项目范围内验证并原子保存。"><p className="settings-note">打开左侧“开发工具”中的 Agent 或 Profiles，可管理真实定义来源、启用状态和会话分配。</p></SettingsSection>}
      {category === "accounts" && <SettingsSection title="账号与提供商" description="账号凭据仍保存在系统安全存储中；提供商使用独立管理流程。"><dl className="settings-facts"><dt>活动账号</dt><dd>{store.accounts.find((value) => value.active)?.label || "未登录"}</dd><dt>提供商</dt><dd>连接测试只访问模型列表端点，不发送推理请求</dd></dl><div className="settings-action-list"><button onClick={onProviders}>管理自定义提供商与模型</button></div></SettingsSection>}
      {category === "computer" && <SettingsSection title="Computer Use" description="仅控制已明确选择的 Windows 应用。">{computer ? <><label className="check"><input type="checkbox" checked={computer.enabled} onChange={(event) => void updateComputer({ enabled: event.target.checked })}/>启用 Computer Use</label><label className="check"><input type="checkbox" checked={computer.confirmNewApps} onChange={(event) => void updateComputer({ confirmNewApps: event.target.checked })}/>首次控制新应用时确认</label><label>截图最大边长 <strong>{computer.maxScreenshotEdge}px</strong><input type="range" min="640" max="1920" step="128" value={computer.maxScreenshotEdge} onChange={(event) => void updateComputer({ maxScreenshotEdge: Number(event.target.value) })}/></label><dl className="settings-facts"><dt>紧急停止</dt><dd>{computer.emergencyShortcut}</dd><dt>始终允许应用</dt><dd>{computer.alwaysAllowedAppIds.length}</dd></dl></> : <p>正在读取 Computer Use 设置…</p>}</SettingsSection>}
      {category === "updates" && <SettingsSection title="更新与诊断" description="应用更新采用手动下载安装；每项操作都会在此显示结果。"><div className="settings-action-list">
        <button disabled={updateActions.app?.state === "running"} onClick={() => void runUpdateAction("app", async () => { const value = await window.grokDesktop.checkAppUpdate(true); store.setAppRelease(value); if (value.error) throw new Error(value.error); return value.updateAvailable ? `发现 ${value.latestVersion}，请打开 GitHub Release 手动下载并核对 SHA-256。` : `当前 ${value.currentVersion} 已是最新稳定版。`; })}>检查应用更新</button>
        <button disabled={updateActions.cli?.state === "running"} onClick={() => void runUpdateAction("cli", async () => { const value = await window.grokDesktop.checkCliUpdate(); store.setCli(value); if (value.error) throw new Error(value.error); return value.updateAvailable ? `CLI ${value.currentVersion} 可更新到 ${value.latestVersion}。` : `Grok CLI ${value.currentVersion || "未知"} 已是最新版本。`; })}>检查 Grok CLI 更新</button>
        <button onClick={() => { setUpdateActions((value) => ({ ...value, diagnostics: { state: "success", message: "已打开诊断中心", at: new Date().toISOString() } })); onDiagnostics(); }}>打开诊断中心</button>
        <button disabled={updateActions.logs?.state === "running"} onClick={() => void runUpdateAction("logs", async () => { const path = await window.grokDesktop.exportLogs(); return path ? `脱敏日志已导出：${path}` : "已取消"; })}>导出脱敏日志</button>
      </div><div className="settings-action-results" aria-live="polite">{Object.entries(updateActions).map(([key, value]) => <article className={value.state} key={key}><strong>{({ app: "应用更新", cli: "CLI 更新", diagnostics: "诊断中心", logs: "脱敏日志" } as Record<string, string>)[key] || key}</strong><span>{value.message}</span><time>{new Date(value.at).toLocaleString()}</time>{value.state !== "running" && <button type="button" onClick={() => void navigator.clipboard.writeText(value.message)}>复制</button>}</article>)}</div></SettingsSection>}
      {category === "tokens" && <SettingsSection title="Token 活动" description="只统计 CLI 或提供商真实返回的用量；失败与取消的回合不会返回用量，因此同时显示覆盖情况。"><TokenActivityPanel onError={store.setError}/></SettingsSection>}
      {category === "archived" && <SettingsSection title="已归档会话" description="归档任务不会出现在默认任务列表中。"><div className="archived-settings-list">{store.sessions.filter((session) => session.archived).map((session) => <div key={session.id}><span><strong>{session.title}</strong><small>{relativeTime(session.updatedAt)}</small></span><button onClick={async () => { await window.grokDesktop.archiveSession(session.id, false); if (draft.activeWorkspace) store.setSessions(await window.grokDesktop.listSessions(draft.activeWorkspace)); }}>取消归档</button></div>)}{!store.sessions.some((session) => session.archived) && <p className="settings-note">当前项目没有已归档会话。</p>}</div></SettingsSection>}
    </main></div><footer><button onClick={onClose}>取消</button><button className="primary" disabled={saveState === "saving"} onClick={() => void save()}>{saveState === "saving" ? "保存中…" : "保存设置"}</button></footer>
  </section></div>;
}

function SettingsSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }): React.JSX.Element {
  return <section className="settings-section"><header><h3>{title}</h3><p>{description}</p></header><div className="settings-section-body">{children}</div></section>;
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

function ComputerPermissionDialog({ request, onRespond }: { request: ComputerAppPermissionRequest; onRespond(decision: "once" | "always" | "deny"): void }): React.JSX.Element {
  return <div className="modal-backdrop computer-approval-backdrop"><section className="action-dialog computer-approval" role="dialog" aria-modal="true"><h2>允许 Grok 控制此应用？</h2><div className="computer-app-summary"><strong>{request.app.name}</strong><span>{request.window?.title}</span><small>{request.window ? `${request.window.bounds.width}×${request.window.bounds.height} · ${request.window.dpi} DPI` : ""}</small></div><p>授权只适用于这个应用。高影响操作仍会在执行前单独确认；按 <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Esc</kbd> 可随时紧急停止。</p><div className="button-row three"><button className="danger" onClick={() => onRespond("deny")}>拒绝</button><button onClick={() => onRespond("once")}>仅本次允许</button><button className="primary" onClick={() => onRespond("always")}>始终允许</button></div></section></div>;
}

function ComputerRiskDialog({ request, onRespond }: { request: ComputerRiskConfirmation; onRespond(approved: boolean): void }): React.JSX.Element {
  const labels: Record<ComputerRiskConfirmation["category"], string> = { delete: "删除数据", "external-communication": "外部发送或提交", financial: "金融或订阅", install: "安装或执行", "account-access": "账号权限或密钥", "security-settings": "安全/隐私设置", "sensitive-transfer": "敏感数据传输" };
  return <div className="modal-backdrop computer-approval-backdrop"><section className="action-dialog computer-approval risk" role="alertdialog" aria-modal="true"><h2>高影响操作确认</h2><span className="risk-label">{labels[request.category]}</span><p><strong>{request.appName}</strong> 将执行：{request.summary}</p><p>此确认只允许当前这一个动作，不会改变应用授权。</p><div className="button-row"><button onClick={() => onRespond(false)}>取消并停止</button><button className="danger" onClick={() => onRespond(true)}>确认执行一次</button></div></section></div>;
}

function QuotaPanel({ quota, loading, onRefresh }: { quota: GrokQuotaSnapshot | null; loading: boolean; onRefresh(): void }): React.JSX.Element {
  return <section className="quota-panel"><header><div><h3>账号额度</h3>{quota && <small>{quota.stale ? "缓存数据" : "更新于"} {new Date(quota.fetchedAt).toLocaleString()}</small>}</div><button disabled={loading} onClick={onRefresh}>{loading ? "刷新中…" : "刷新"}</button></header>{!quota ? <p>正在查询额度…</p> : !quota.supported ? <p>{quota.diagnostics[0]}</p> : <div className="quota-grid">{quota.rolling24h && <QuotaCard value={quota.rolling24h} />}{quota.weekly && <QuotaCard value={quota.weekly} />}{quota.monthly && <QuotaCard value={quota.monthly} />}{quota.onDemand && <QuotaCard value={quota.onDemand} />}{quota.diagnostics.length > 0 && <div className="quota-diagnostics">{quota.diagnostics.map((value) => <p key={value}>{value}</p>)}</div>}</div>}</section>;
}

function QuotaCard({ value }: { value: NonNullable<GrokQuotaSnapshot["weekly"]> }): React.JSX.Element {
  const percent = value.unit === "percent" ? value.used : value.limit && value.used !== undefined ? value.used / value.limit * 100 : undefined;
  return <div className={`quota-card${value.expired ? " expired" : ""}`}><strong>{value.label}</strong>{percent !== undefined && <div className="quota-progress"><i style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} /></div>}<div><b>{value.used === undefined ? "使用率未返回" : value.unit === "percent" ? `${value.used.toFixed(1)}% 已用` : `${quotaAmount(value.used, value.unit)} / ${quotaAmount(value.limit, value.unit)}`}</b>{value.remaining !== undefined && value.unit !== "percent" && <span>剩余 {quotaAmount(value.remaining, value.unit)}</span>}</div>{value.products?.map((product) => <small key={product.label}>{product.label}{product.usedPercent === undefined ? "" : `：${product.usedPercent.toFixed(1)}%`}</small>)}{value.source && <small>来源：{value.source === "cli-error" ? "CLI 限额响应" : "账单接口"}{value.modelId ? ` · ${value.modelId}` : ""}</small>}{value.observedAt && <small>观测：{new Date(value.observedAt).toLocaleString()}{value.expired ? " · 已过期" : ""}</small>}{value.resetAt && <small>重置：{formatQuotaReset(value.resetAt)}</small>}</div>;
}

function quotaAmount(value: number | undefined, unit: NonNullable<GrokQuotaSnapshot["weekly"]>["unit"]): string { return value === undefined ? "—" : unit === "tokens" ? `${formatTokens(value)} Token` : `$${(value / 100).toFixed(2)}`; }
function formatQuotaReset(value: string): string { const parsed = Date.parse(value); return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : value; }

function ActionDialog({ dialog, onClose }: { dialog: DialogState; onClose(value: string | boolean | null): void }): React.JSX.Element {
  const [value, setValue] = useState(dialog.input?.value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { (dialog.input ? inputRef.current : confirmRef.current)?.focus(); }, []);
  const confirm = (): void => onClose(dialog.input ? value : true);
  return <div className="modal-backdrop action-dialog-backdrop" role="presentation" onMouseDown={() => onClose(dialog.input ? null : false)}><section className="action-dialog" role="dialog" aria-modal="true" aria-labelledby="action-dialog-title" onMouseDown={(event) => event.stopPropagation()}><h2 id="action-dialog-title">{dialog.title}</h2><p>{dialog.message}</p>{dialog.input && <input ref={inputRef} value={value} placeholder={dialog.input.placeholder} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && value.trim()) confirm(); }} />}<div className="button-row"><button onClick={() => onClose(dialog.input ? null : false)}>取消</button><button ref={confirmRef} className={dialog.danger ? "danger" : "primary"} disabled={!!dialog.input && !value.trim()} onClick={confirm}>{dialog.confirmLabel || "确定"}</button></div></section></div>;
}

function EmptyState({ title, text, action, onAction }: { title: string; text: string; action: string; onAction(): void }): React.JSX.Element { return <div className="empty-state"><div className="empty-logo">G</div><h2>{title}</h2><p>{text}</p><button className="primary" onClick={onAction}>{action}</button></div>; }
function errorMessage(value: unknown): string { return value instanceof Error ? value.message : String(value); }
function isPathInExecutionRoot(path: string, root: string): boolean {
  if (!root) return false;
  const normalize = (value: string): string => value.replace(/^\\\\\?\\/, "").replace(/\//g, "\\").replace(/\\+$/, "").toLocaleLowerCase();
  const target = normalize(path);
  const base = normalize(root);
  if (!/^[a-z]:\\|^\\\\/.test(target)) return true;
  return target === base || target.startsWith(`${base}\\`);
}
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
