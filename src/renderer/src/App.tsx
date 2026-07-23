import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { AppMenuCommand, AppSettings, Attachment, ChatEvent, CodexSessionDetail, CodexSessionSummary, ComposerCapabilitySelection, ComputerAppPermissionRequest, ComputerRiskConfirmation, ComputerTaskState, ComputerUseSettings, ExecutionProfileLaunchInput, GitRepositoryStatus, GrokQuotaSnapshot, GrokWorktreeSummary, MediaAspectRatio, MediaCreationKind, MediaCreationRequest, MediaVideoDuration, MediaVideoResolution, NavigationIntent, PromptQueueEntry, ReasoningEffort, RewindPoint, SessionExecutionAssignment, SessionExecutionProfile, SessionMode, SessionOriginKind, SessionSummary, SkillSummary, ThemeSettings, WorkspaceFileCandidate, WorkspaceSummary } from "../../shared/types";
import { buildMediaSlashCommand, detectMediaCapabilities } from "../../shared/media";
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
import { useWorkbenchStore, type WorkbenchView } from "./workbench-store";
import { applyThemeToDocument, cacheThemeForEarlyStartup, contrastRatio, DARK_COLORS, LIGHT_COLORS, themeBackgroundClass } from "./theme";
import { groupSessionsByOrigin, sessionSourceLabel } from "./session-groups";
import { useWorktreeStore } from "./worktree-store";
import { useGitStore } from "./git-store";
import { UiIcon, type UiIconName } from "./ui-icons";
import { ReviewPane } from "./components/ReviewPane";
import { RightUtilityPane, type RightTool } from "./components/RightUtilityPane";
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
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [operationBusy, setOperationBusy] = useState(false);
  const [sending, setSending] = useState(false);
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
      if (data.settings.activeWorkspace) void window.grokDesktop.listCodexSessions(data.settings.activeWorkspace, data.settings.showArchivedCodex).then((values) => useAppStore.getState().setCodexSessions(values)).catch(() => undefined);
      window.setTimeout(() => void window.grokDesktop.checkCliUpdate().then((cli) => useAppStore.getState().setCli(cli)).catch(() => undefined), 250);
      window.setTimeout(() => void window.grokDesktop.checkAppUpdate().then((release) => useAppStore.getState().setAppRelease(release)).catch(() => undefined), 1200);
    }).catch((error) => useAppStore.getState().setError(error instanceof Error ? error.message : String(error)));
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      flush();
      removeEvent(); removeLogin(); removeDrop(); removeNavigate(); removeComputer(); removeAutomation();
    };
  }, []);

  useEffect(() => {
    const cwd = store.settings?.activeWorkspace || "";
    if (!cwd) { store.setCodexSessions([]); return; }
    void window.grokDesktop.listCodexSessions(cwd, store.settings?.showArchivedCodex).then(store.setCodexSessions).catch((error) => store.setError(errorMessage(error)));
    void window.grokDesktop.discoverWorkspaces().then(store.setWorkspaces).catch(() => undefined);
    void window.grokDesktop.listPromptHistory(cwd).then(setPromptHistory).catch(() => setPromptHistory([]));
    setHistoryIndex(-1);
  }, [store.settings?.activeWorkspace, store.settings?.showArchivedCodex]);

  const draftKey = store.activeSessionId || (store.settings?.activeWorkspace ? `new:${store.settings.activeWorkspace}` : "");
  useEffect(() => {
    let cancelled = false;
    draftLoadedKeyRef.current = "";
    if (!draftKey || activeCodexId) { setComposer(""); setCapability(undefined); return; }
    setCapability(undefined);
    void window.grokDesktop.getDraft(draftKey).then((draft) => {
      if (cancelled) return;
      setComposer(draft?.text || "");
      setCapability(draft?.capability);
      draftLoadedKeyRef.current = draftKey;
    }).catch(() => { if (!cancelled) draftLoadedKeyRef.current = draftKey; });
    return () => { cancelled = true; };
  }, [draftKey, activeCodexId]);

  useEffect(() => {
    if (!draftKey || draftLoadedKeyRef.current !== draftKey || activeCodexId) return;
    const timer = window.setTimeout(() => void window.grokDesktop.setDraft(draftKey, composer, capability), 250);
    return () => window.clearTimeout(timer);
  }, [composer, capability, draftKey, activeCodexId]);

  useEffect(() => {
    const theme = store.settings?.theme;
    if (!theme) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (): void => { applyThemeToDocument(theme, media.matches); cacheThemeForEarlyStartup(theme); };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [store.settings?.theme]);

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
  const turns = useMemo(() => buildChatTurns(view?.messages ?? [], view?.status, view?.turnPresentations), [view?.messages, view?.status, view?.turnPresentations]);
  const executionRoot = executionAssignment?.cwd || activeSession?.cwd || store.settings?.activeWorkspace || "";
  const lastTurnPaths = useMemo(() => {
    for (let index = turns.length - 1; index >= 0; index--) {
      const paths = Array.from(new Set(turns[index]!.groups.flatMap((group) => group.items.flatMap((message) => message.kind === "tool" ? (message.tool.locations ?? []).map((location) => location.path).filter((path): path is string => Boolean(path)) : []))));
      if (paths.length) return paths;
    }
    return [];
  }, [turns]);
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
    setActiveCodexId(session.id);
    store.setActiveSession("");
    setCodexDetail(null);
    try { setCodexDetail(await window.grokDesktop.openCodexSession(session.id)); }
    catch (error) { store.setError(errorMessage(error)); }
    finally { setOperationBusy(false); }
  };

  const send = async (delivery: "normal" | "queue" | "interject" = "normal"): Promise<void> => {
    const text = composer.trim();
    if ((!text && !store.attachments.length && !reviewComments.length) || sending || view?.status === "needs-user" || (delivery === "normal" && view?.status === "working")) return;
    let sessionId = store.activeSessionId;
    if (!sessionId) sessionId = await createSession() || "";
    if (!sessionId) return;
    const attachments = store.attachments;
    const cwd = store.settings?.activeWorkspace || activeSession?.cwd || "";
    if (attachments.length) {
      const findings = await window.grokDesktop.inspectAttachmentPrivacy(cwd, attachments).catch(() => []);
      if (findings.length && !(await askConfirm(`以下附件可能包含敏感信息：\n\n${findings.map((item) => `• ${item.message}`).join("\n")}\n\n仍要发送吗？`, { title: "附件隐私提醒", confirmLabel: "仍要发送", danger: findings.some((item) => item.severity === "high") }))) return;
    }
    if (reviewComments.length) {
      const staleComment = await findStaleReviewComment(reviewComments, async (scope) => (await window.grokDesktop.getGitReview(executionRoot, scope)).id);
      if (staleComment) { store.setError(`审核批注 ${staleComment.path}:L${staleComment.line} 所依据的变更已更新，请在 Review 中重新定位。`); return; }
    }
    const submittedCapability = capability;
    setComposer("");
    setCapability(undefined);
    if (draftKey) void window.grokDesktop.clearDraft(draftKey);
    if (cwd && text) {
      void window.grokDesktop.appendPromptHistory(cwd, text);
      setPromptHistory((values) => [text, ...values.filter((value) => value !== text)].slice(0, 50));
      setHistoryIndex(-1);
    }
    store.clearAttachments();
    setSending(true);
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
    try {
      const clientMessageId = crypto.randomUUID();
      if (delivery === "interject") await window.grokDesktop.interjectPrompt(sessionId, outboundText, attachments, clientMessageId);
      else if (delivery === "queue") await window.grokDesktop.enqueuePrompt(sessionId, outboundText, attachments, clientMessageId);
      else await window.grokDesktop.sendPrompt({ sessionId, text: outboundText, attachments, clientMessageId });
      setReviewComments([]);
    }
    catch (error) {
      setComposer(text);
      setCapability(submittedCapability);
      store.addAttachments(attachments);
      if (draftKey) void window.grokDesktop.setDraft(draftKey, text, submittedCapability);
      store.setError(errorMessage(error));
    }
    finally {
      setSending(false);
      if (delivery === "normal" && followTurnRef.current) settleConversationBottom(sessionId);
      focusComposer();
      void refreshSessions().catch((error) => store.setError(errorMessage(error)));
    }
  };

  const navigatePromptHistory = (direction: -1 | 1): void => {
    if (!promptHistory.length) return;
    const next = direction === -1 ? Math.min(promptHistory.length - 1, historyIndex + 1) : Math.max(-1, historyIndex - 1);
    setHistoryIndex(next);
    setComposer(next < 0 ? "" : promptHistory[next] || "");
  };

  const createMedia = async (request: MediaCreationRequest): Promise<void> => {
    let sessionId = !activeCodexId && store.activeSessionId && view && view.status !== "working" && view.status !== "needs-user"
      ? store.activeSessionId
      : "";
    if (!sessionId) sessionId = await createSession() || "";
    if (!sessionId) return;

    let capabilities;
    try {
      capabilities = await window.grokDesktop.getMediaCapabilities(sessionId);
    } catch {
      const session = useAppStore.getState().sessions.find((value) => value.id === sessionId);
      if (!session) throw new Error("无法检测当前 Grok CLI 的媒体能力");
      await window.grokDesktop.openSession(session.cwd, session.id);
      capabilities = await window.grokDesktop.getMediaCapabilities(sessionId);
    }
    if (!capabilities[request.kind]) throw new Error(capabilities.diagnostic || `当前 Grok CLI 不支持${request.kind === "image" ? "图片" : "视频"}生成`);

    const command = buildMediaSlashCommand(request, capabilities);
    setActiveCodexId("");
    setCodexDetail(null);
    store.setActiveSession(sessionId);
    setPanel(null);
    setSending(true);
    forceFollowRef.current = true;
    followTurnRef.current = true;
    atBottomRef.current = true;
    setAtBottom(true);
    try {
      await window.grokDesktop.sendPrompt({ sessionId, text: command, attachments: [] });
    } catch (error) {
      store.setError(errorMessage(error));
    } finally {
      setSending(false);
      if (followTurnRef.current) settleConversationBottom(sessionId);
      void refreshSessions().catch((error) => store.setError(errorMessage(error)));
    }
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
      store.setActiveSession(""); setActiveCodexId(""); setCodexDetail(null);
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
    <div className={`app-shell density-${store.settings?.uiDensity ?? "balanced"} ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${rightTool ? "right-tool-open" : ""} ${store.settings?.theme ? themeBackgroundClass(store.settings.theme) : ""}`} style={{ fontSize: `${store.settings?.fontScale ?? 100}%` }}>
      <Sidebar
        settings={store.settings}
        sessions={store.sessions}
        codexSessions={store.codexSessions}
        workspaces={store.workspaces}
        activeSessionId={store.activeSessionId}
        activeCodexId={activeCodexId}
        search={search}
        busy={operationBusy}
        activeView={activeWorkbenchView}
        onView={setWorkbenchView}
        dialogs={{ askConfirm, askText, setError: store.setError }}
        onSearch={setSearch}
        onNew={() => { setWorkbenchView("chat"); void openNewSessionDialog(); }}
        onOpen={(session) => { void openConversationTarget({ cwd: session.cwd, sessionId: session.id }).catch((error) => store.setError(errorMessage(error))); }}
        onOpenCodex={(session) => { setWorkbenchView("chat"); void openCodexSession(session); }}
        onChooseWorkspace={async () => {
          ++listRequestRef.current;
          const cwd = await window.grokDesktop.chooseWorkspace();
          if (!cwd) return;
          const settings = await window.grokDesktop.getSettings();
          store.setSettings(settings);
          store.setActiveSession("");
          setActiveCodexId(""); setCodexDetail(null);
          store.setSessions(await window.grokDesktop.listSessions(cwd));
          store.setWorkspaces(await window.grokDesktop.discoverWorkspaces(true));
        }}
        onRecent={async (cwd) => {
          ++listRequestRef.current;
          store.setSessions(await window.grokDesktop.setWorkspace(cwd));
          store.setSettings(await window.grokDesktop.getSettings());
          store.setActiveSession("");
          setActiveCodexId(""); setCodexDetail(null);
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
        onToggleCodex={async (collapsed) => { if (!store.settings) return; store.setSettings(await window.grokDesktop.updateSettings({ codexGroupCollapsed: collapsed })); }}
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
        <TopBar session={activeSession} codex={activeCodex} workspace={executionRoot || store.settings?.activeWorkspace || ""} workbenchView={activeWorkbenchView} view={view} busy={operationBusy || sending || view?.status === "working"} rightToolOpen={Boolean(rightTool)} onView={setWorkbenchView} onPanel={setPanel} onToggleSidebar={() => setSidebarCollapsed((value) => !value)} onToggleRightTool={() => setRightTool((value) => value ? null : "launcher")} onReturnToChat={() => { setWorkbenchView("chat"); window.requestAnimationFrame(() => { window.dispatchEvent(new Event("resize")); focusComposer(); }); }} />
        {activeComputerTask && <ComputerLiveStrip task={activeComputerTask} onPause={() => void window.grokDesktop.pauseComputer(activeComputerTask.sessionId)} onResume={() => void window.grokDesktop.resumeComputer(activeComputerTask.sessionId)} onStop={() => void window.grokDesktop.stopComputer(activeComputerTask.sessionId)} />}
        {activeWorkbenchView === "files" ? <FileWorkbench workspace={store.settings?.activeWorkspace || ""} dialogs={{ askConfirm, askText, setError: store.setError }} onChatReference={({ prompt, path }) => { setWorkbenchView("chat"); setComposer((value) => `${value}${value && !/\s$/.test(value) ? " " : ""}${prompt}`); if (path) void window.grokDesktop.attachmentsFromPaths([path]).then(store.addAttachments).catch((error) => store.setError(errorMessage(error))); window.setTimeout(focusComposer, 0); }} /> : activeWorkbenchView === "source-control" ? <GitWorkbench workspace={store.settings?.activeWorkspace || ""} dialogs={{ askConfirm, askText, setError: store.setError }} /> : activeWorkbenchView === "worktrees" ? <WorktreeWorkbench workspace={store.settings?.activeWorkspace || ""} dialogs={{ askConfirm, askText, setError: store.setError }} /> : activeWorkbenchView === "memory" ? <MemoryWorkbench workspace={store.settings?.activeWorkspace || ""} activeSessionId={store.activeSessionId} dialogs={{ askConfirm, askText, setError: store.setError }} /> : activeWorkbenchView === "agents" ? <AgentPersonaWorkbench workspace={store.settings?.activeWorkspace || ""} dialogs={{ askConfirm, askText, setError: store.setError }} /> : activeWorkbenchView === "profiles" ? <ExecutionProfileWorkbench workspace={store.settings?.activeWorkspace || ""} dialogs={{ askConfirm, setError: store.setError }} /> : activeWorkbenchView === "dashboard" ? <AgentDashboardWorkbench workspace={store.settings?.activeWorkspace || ""} setError={store.setError} onOpenSession={(sessionId) => { void openConversationTarget({ cwd: store.settings?.activeWorkspace || "", sessionId }).catch((error) => store.setError(errorMessage(error))); }} onOpenWorktree={(worktreeId) => { useWorktreeStore.getState().setSelected(worktreeId); setWorkbenchView("worktrees"); }} onOpenDefinition={() => setWorkbenchView("agents")} /> : <div className="conversation-surface"><div className="conversation-content">
        {conversationSearchOpen && <div className="conversation-search-bar"><input id="conversation-search" value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)} placeholder="搜索当前会话"/><span>{conversationMatches.length ? `${conversationMatch + 1}/${conversationMatches.length}` : "0 项"}</span><button disabled={!conversationMatches.length} onClick={() => setConversationMatch((value) => (value - 1 + conversationMatches.length) % conversationMatches.length)}>↑</button><button disabled={!conversationMatches.length} onClick={() => setConversationMatch((value) => (value + 1) % conversationMatches.length)}>↓</button><button onClick={() => { setConversationSearchOpen(false); setConversationSearch(""); focusComposer(); }}>×</button></div>}
        {!store.cli?.found ? <EmptyState title="未找到 Grok CLI" text="请在设置中指定 grok.exe 路径。" action="打开设置" onAction={() => setPanel("settings")} />
          : activeCodexId ? <CodexMirror detail={codexDetail} busy={operationBusy} onRefresh={async () => setCodexDetail(await window.grokDesktop.refreshCodexSession(activeCodexId))} onContinue={async () => { setOperationBusy(true); try { const result = await window.grokDesktop.continueCodexSession(activeCodexId); store.setSessions(await window.grokDesktop.setWorkspace(result.cwd)); store.setSettings(await window.grokDesktop.getSettings()); setActiveCodexId(""); setCodexDetail(null); store.setActiveSession(result.sessionId); await refreshSessions(); } catch (error) { store.setError(errorMessage(error)); } finally { setOperationBusy(false); } }} onHide={async () => { await window.grokDesktop.hideCodexSession(activeCodexId, true); store.setCodexSessions(await window.grokDesktop.listCodexSessions(store.settings?.activeWorkspace || "", store.settings?.showArchivedCodex, true)); setActiveCodexId(""); setCodexDetail(null); }} />
          : !activeSession && !view ? <WorkspaceEmptyState workspaces={store.workspaces} onNew={() => void openNewSessionDialog()} onOpen={async (cwd) => { store.setSessions(await window.grokDesktop.setWorkspace(cwd)); store.setSettings(await window.grokDesktop.getSettings()); }} />
          : <div className="conversation-wrap" onWheelCapture={(event) => { if (event.deltaY < 0) { followTurnRef.current = false; forceFollowRef.current = false; } }}><Virtuoso ref={virtuosoRef} className="conversation" data={turns} computeItemKey={(_index, turn) => turn.id} followOutput={(isAtBottom) => (isAtBottom || forceFollowRef.current) ? "auto" : false} atBottomStateChange={(value) => { atBottomRef.current = value; if (value && !followTurnRef.current) forceFollowRef.current = false; setAtBottom(value); }} itemContent={(index, turn) => <div className={conversationMatches[conversationMatch] === index ? "conversation-match-active" : ""}><TurnCard turn={turn} sessionId={store.activeSessionId} navigationRoot={executionRoot} showThinking={store.settings?.showThinking ?? false} expandTools={store.settings?.expandToolDetails ?? false} onNavigate={(intent) => void navigate(intent).catch((error) => store.setError(errorMessage(error)))} onOpenReview={() => void window.grokDesktop.getGitWorkspaceCapability(executionRoot).then((capability) => { if (capability.available) { setReviewInitialScope("last-turn"); setRightTool("review"); } else setRightTool("files"); }).catch((error) => store.setError(errorMessage(error)))} onFork={index === turns.length - 1 ? () => setPanel("history") : undefined} onResolved={(id) => store.resolveMessage(store.activeSessionId, id)} onRetry={(message) => { setComposer(message.text); store.clearAttachments(); store.addAttachments((message.attachments ?? []).filter((attachment) => attachment.availability === "ready" && Boolean(attachment.source)).map((attachment) => ({ id: attachment.id, name: attachment.name, kind: attachment.kind, mimeType: attachment.mimeType, size: attachment.size, ...(attachment.isData ? { data: attachment.source } : { path: attachment.source }) }))); focusComposer(); }} /></div>} />{!atBottom && !!turns.length && <button className="scroll-to-bottom" onClick={() => { followTurnRef.current = false; forceFollowRef.current = true; atBottomRef.current = true; setAtBottom(true); scrollConversationNow("smooth"); }}>↓ 回到底部</button>}</div>}</div>
        {!activeCodexId && <Composer
          inputRef={composerRef}
          text={composer}
          setText={setComposer}
          busy={view?.status === "working"}
          controlsDisabled={operationBusy || sending || view?.status === "needs-user"}
          sessionId={store.activeSessionId}
          attachments={store.attachments}
          reviewComments={reviewComments}
          commandMatches={commandMatches}
          fileMatches={fileMatches}
          view={view}
          onSend={() => void send(view?.status === "working" ? "queue" : "normal")}
          onInterject={() => void send("interject")}
          onStop={() => store.activeSessionId && void window.grokDesktop.cancelSession(store.activeSessionId)}
          onAdd={async () => { try { store.addAttachments(await window.grokDesktop.pickAttachments()); } catch (error) { store.setError(errorMessage(error)); } finally { focusComposer(); } }}
          onAddFolders={async () => { try { store.addAttachments(await window.grokDesktop.pickAttachmentFolders()); } catch (error) { store.setError(errorMessage(error)); } finally { focusComposer(); } }}
          onPaste={async (files) => { try { store.addAttachments(await pastedImageAttachments(files)); } catch (error) { store.setError(errorMessage(error)); } }}
          onRemove={store.removeAttachment}
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
      {rightTool === "review" && activeWorkbenchView === "chat" && <ReviewPane cwd={executionRoot} sessionId={store.activeSessionId} lastTurnPaths={lastTurnPaths} initialKind={reviewInitialScope} onClose={() => setRightTool(null)} onNavigate={(intent) => void navigate(intent).catch((error) => store.setError(errorMessage(error)))} onAddComment={(comment) => { setReviewComments((values) => [...values, comment]); focusComposer(); }} onError={store.setError} />}
      {rightTool && rightTool !== "review" && activeWorkbenchView === "chat" && <RightUtilityPane tool={rightTool} turn={utilityTurn} cwd={executionRoot} sessionId={store.activeSessionId} paths={lastTurnPaths} queue={view?.queue ?? []} sessionStatus={view?.status} onTool={(tool) => { if (tool === "review") setReviewInitialScope("unstaged"); setRightTool(tool); }} onClose={() => setRightTool(null)} onNavigate={(intent) => void navigate(intent).catch((error) => store.setError(errorMessage(error)))} onExpandResult={() => { setRightTool(null); const index = utilityTurn ? turns.findIndex((turn) => turn.id === utilityTurn.id) : turns.length - 1; if (index >= 0) virtuosoRef.current?.scrollToIndex({ index, align: "end", behavior: "smooth" }); }} onError={store.setError}/>}
      </div>
      {createPortal(<>
        {store.error && <div className="toast error-toast"><span>{store.error}</span><button onClick={() => window.location.reload()}>重新加载界面</button><button onClick={() => setPanel("diagnostics")}>诊断</button><button onClick={() => store.setError("")}>×</button></div>}
        {panel === "media" && <MediaStudioPanel commands={activeCodexId ? [] : view?.commands ?? []} onCreate={createMedia} onClose={() => { setPanel(null); focusComposer(); }} />}
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

function Sidebar(props: {
  settings?: AppSettings;
  sessions: SessionSummary[];
  codexSessions: CodexSessionSummary[];
  workspaces: WorkspaceSummary[];
  activeSessionId: string;
  activeCodexId: string;
  search: string;
  busy: boolean;
  activeView: WorkbenchView;
  onView(view: WorkbenchView): void;
  dialogs: { askConfirm(message: string, options?: { title?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>; askText(message: string, initialValue: string, options?: { title?: string; confirmLabel?: string }): Promise<string | null>; setError(message: string): void };
  onSearch(value: string): void;
  onNew(): void;
  onOpen(session: SessionSummary): void;
  onOpenCodex(session: CodexSessionSummary): void;
  onChooseWorkspace(): void;
  onRecent(cwd: string): void;
  onRename(session: SessionSummary): void;
  onDelete(session: SessionSummary): void;
  onPin(session: SessionSummary): void;
  onArchive(session: SessionSummary): void;
  onExport(session: SessionSummary): void;
  onHideCodex(session: CodexSessionSummary): void;
  onToggleCodex(collapsed: boolean): void;
  onToggleSessionGroup(kind: SessionOriginKind, collapsed: boolean): void;
  onToggleArchived(value: boolean): void;
  onPinWorkspace(workspace: WorkspaceSummary): void;
  onClear(): void;
  onPanel(panel: Panel): void;
}): React.JSX.Element {
  const [showRecent, setShowRecent] = useState(false);
  const [projectToolsOpen, setProjectToolsOpen] = useState(false);
  const [openSessionMenu, setOpenSessionMenu] = useState("");
  useEffect(() => {
    if (!openSessionMenu) return;
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      const target = event.target instanceof Element ? event.target.closest(".session-actions") : null;
      if (target?.getAttribute("data-session-id") !== openSessionMenu) setOpenSessionMenu("");
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [openSessionMenu]);
  const activeAccount = useAppStore((state) => state.accounts.find((value) => value.active));
  const sessionGroups = groupSessionsByOrigin(props.sessions);
  const projectTools: Array<{ view: WorkbenchView; label: string; icon: UiIconName }> = [
    { view: "worktrees", label: "Worktree", icon: "worktree" },
    { view: "memory", label: "Memory", icon: "memory" },
    { view: "agents", label: "Agent 与 Persona", icon: "agents" },
    { view: "profiles", label: "Profiles", icon: "profiles" },
    { view: "dashboard", label: "Dashboard", icon: "dashboard" },
  ];
  const renderSession = (session: SessionSummary): React.JSX.Element => {
    const sourceLabel = sessionSourceLabel(session);
    const runAction = (event: React.MouseEvent<HTMLButtonElement>, action: () => void): void => {
      event.stopPropagation();
      setOpenSessionMenu("");
      action();
    };
    return <div key={session.id} className={`session-row ${session.archived ? "archived" : ""} ${props.activeSessionId === session.id ? "active" : ""}`} onClick={() => props.onOpen(session)}><span className={`status-dot ${session.status}`} />{session.pinned && <span className="pin-mark"><UiIcon name="pin" size={11}/></span>}<div className="session-copy"><strong>{session.title}{sourceLabel && <em className={`session-source-badge ${session.originKind}`}>{sourceLabel}</em>}</strong><span>{relativeTime(session.updatedAt)} · {session.messageCount} 条消息{session.archived ? " · 已归档" : ""}</span></div><div className="session-quick-actions"><button title={session.pinned ? "取消置顶" : "置顶"} onClick={(event) => runAction(event, () => props.onPin(session))}><UiIcon name="pin" size={14}/></button><button title={session.archived ? "取消归档" : "归档"} onClick={(event) => runAction(event, () => props.onArchive(session))}><UiIcon name="archive" size={14}/></button></div><details className="session-actions" data-session-id={session.id} open={openSessionMenu === session.id} onClick={(event) => event.stopPropagation()}><summary title="更多操作" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpenSessionMenu(openSessionMenu === session.id ? "" : session.id); }}><UiIcon name="more" size={15}/></summary><div className="session-action-menu"><button onClick={(event) => runAction(event, () => props.onExport(session))}><UiIcon name="download"/>导出 Markdown</button><button onClick={(event) => runAction(event, () => props.onRename(session))}><UiIcon name="edit"/>重命名</button><button className="danger-link" onClick={(event) => runAction(event, () => props.onDelete(session))}><UiIcon name="trash"/>删除</button></div></details></div>;
  };
  return <aside className="sidebar">
    <div className="brand"><button className="brand-product" title="Grok Build Desktop"><span className="brand-wordmark">G</span><strong>Grok</strong><UiIcon name="chevron-down" size={13}/></button><button className="icon-button brand-search" title="搜索会话" onClick={() => document.getElementById("session-search")?.focus()}><UiIcon name="search"/></button></div>
    <button className="new-task-button" disabled={props.busy} onClick={props.onNew}><UiIcon name="plus"/><span>新建任务</span></button>
    <div className="sidebar-context"><button className="workspace-button" onClick={() => setShowRecent(!showRecent)}><UiIcon name="folder"/><span className="workspace-name">{shortPath(props.settings?.activeWorkspace || "选择工作区")}</span><UiIcon name="chevron-down" size={13}/></button></div>
    <section className="project-tools"><button className="project-tools-heading" onClick={() => setProjectToolsOpen((value) => !value)} aria-expanded={projectToolsOpen}><span><UiIcon name={projectToolsOpen ? "chevron-down" : "chevron-right"} size={13}/>开发工具</span></button>{projectToolsOpen && <nav>{projectTools.map((item) => <button key={item.view} className={item.view === props.activeView ? "active" : ""} onClick={() => props.onView(item.view)}><UiIcon name={item.icon}/><span>{item.label}</span></button>)}<button onClick={() => props.onPanel("tasks")}><UiIcon name="tasks"/><span>任务</span></button><button onClick={() => props.onPanel("extensions")}><UiIcon name="extensions"/><span>扩展</span></button></nav>}</section>
    {showRecent && <WorkspaceMenu workspaces={props.workspaces} active={props.settings?.activeWorkspace || ""} onClose={() => setShowRecent(false)} onChoose={props.onChooseWorkspace} onSelect={(cwd) => { props.onRecent(cwd); setShowRecent(false); }} onPin={props.onPinWorkspace} onClear={props.onClear} />}
    {props.activeView === "files" ? <FileExplorer workspace={props.settings?.activeWorkspace || ""} dialogs={props.dialogs} /> : props.activeView === "source-control" ? <GitExplorer workspace={props.settings?.activeWorkspace || ""} dialogs={props.dialogs} /> : props.activeView === "worktrees" ? <WorktreeExplorer workspace={props.settings?.activeWorkspace || ""} dialogs={props.dialogs} /> : <>
    <div className="search"><UiIcon name="search" size={14}/><input id="session-search" value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder="搜索任务" /></div>
    <div className="session-list">
      <div className="workspace-task-group current"><div><UiIcon name="chevron-down" size={12}/><strong>{shortPath(props.settings?.activeWorkspace || "当前项目")}</strong><span>{props.sessions.length}</span></div></div>
      {sessionGroups.filter((group) => group.kind === "normal" || group.sessions.length > 0).map((group) => { const collapsed = props.settings?.sessionGroupCollapsed?.[group.kind] ?? group.kind !== "normal"; return <div className={`session-origin-group ${group.kind}`} key={group.kind}><button className="session-group-heading" onClick={() => props.onToggleSessionGroup(group.kind, !collapsed)}><strong>{collapsed ? "›" : "⌄"} {group.label}</strong><span>{group.sessions.length}</span></button>{!collapsed && group.sessions.map(renderSession)}</div>; })}
      <button className="session-group-heading codex-toggle" onClick={() => props.onToggleCodex(!props.settings?.codexGroupCollapsed)}><strong>{props.settings?.codexGroupCollapsed ? "›" : "⌄"} Codex 会话</strong><span>{props.codexSessions.length}</span></button>
      {!props.settings?.codexGroupCollapsed && <><label className="archived-toggle"><input type="checkbox" checked={props.settings?.showArchivedCodex ?? false} onChange={(event) => props.onToggleArchived(event.target.checked)} />显示归档</label>{props.codexSessions.map((session) => <div key={session.id} className={`session-row codex ${props.activeCodexId === session.id ? "active" : ""}`} onClick={() => props.onOpenCodex(session)}><span className="codex-mark">C</span><div className="session-copy"><strong>{session.title}</strong><span>{relativeTime(session.updatedAt)}{session.archived ? " · 已归档" : ""}</span></div><div className="session-actions"><button title="从镜像列表隐藏" onClick={(event) => { event.stopPropagation(); props.onHideCodex(session); }}>×</button></div></div>)}</>}
      {props.workspaces.filter((workspace) => workspace.exists && workspace.cwd.toLocaleLowerCase() !== (props.settings?.activeWorkspace || "").toLocaleLowerCase()).slice(0, 8).map((workspace) => <button className="workspace-task-group collapsed" key={workspace.cwd} title={`${workspace.cwd} · 点击后按需加载任务`} onClick={() => props.onRecent(workspace.cwd)}><UiIcon name="chevron-right" size={12}/><strong>{workspace.name}</strong><span>{workspace.grokSessions}</span></button>)}
    </div></>}
    <div className="sidebar-footer"><button onClick={() => props.onPanel("accounts")}><span className="avatar">{activeAccount?.label.slice(0, 1).toUpperCase() || "?"}</span><span>{activeAccount?.label || "登录账号"}</span></button><button title="版本与更新" onClick={() => props.onPanel("about")}><UiIcon name="download"/><span>0.6.4</span></button><button className="icon-button" title="设置" onClick={() => props.onPanel("settings")}><UiIcon name="settings"/></button></div>
  </aside>;
}

function TopBar({ session, codex, workspace, workbenchView, view, busy, rightToolOpen, onView, onPanel, onToggleSidebar, onToggleRightTool, onReturnToChat }: { session?: SessionSummary; codex?: CodexSessionSummary; workspace: string; workbenchView: WorkbenchView; view: ReturnType<typeof useAppStore.getState>["views"][string] | undefined; busy: boolean; rightToolOpen: boolean; onView(view: WorkbenchView): void; onPanel(panel: Panel): void; onToggleSidebar(): void; onToggleRightTool(): void; onReturnToChat(): void }): React.JSX.Element {
  const store = useAppStore();
  const activeAccount = useAppStore((state) => state.accounts.find((value) => value.active));
  const source = session?.originKind === "automation" ? " · 定时任务" : session?.originKind === "codex-continuation" ? " · Codex 接力" : session?.originKind === "fork" ? " · 分叉会话" : "";
  const title = workbenchView === "files" ? "文件工作台" : workbenchView === "source-control" ? "源代码管理" : workbenchView === "worktrees" ? "隔离 Worktree" : workbenchView === "memory" ? "跨会话 Memory" : workbenchView === "agents" ? "Agent 与 Persona 中心" : workbenchView === "profiles" ? "会话执行配置档" : workbenchView === "dashboard" ? "Agent Dashboard" : codex?.title || session?.title || "新会话";
  const contextLabel = workbenchView === "files" ? " · 轻量编辑器" : workbenchView === "source-control" ? " · Git 工作台" : workbenchView === "worktrees" ? " · 安全应用与清理" : workbenchView === "memory" ? " · 原生布局与安全编辑" : workbenchView === "agents" ? " · 来源、校验与原子保存" : workbenchView === "profiles" ? " · 全局与项目 AppData" : workbenchView === "dashboard" ? " · 父子 Agent 生命周期" : codex ? " · Codex 只读镜像" : source;
  const location = codex?.cwd || session?.cwd || workspace;
  const refresh = async (): Promise<void> => { const cwd = store.settings?.activeWorkspace || session?.cwd; if (cwd) store.setSessions(await window.grokDesktop.listSessions(cwd)); };
  const rename = async (): Promise<void> => { if (!session) return; const value = window.prompt("重命名任务", session.title); if (value?.trim()) { await window.grokDesktop.renameSession(session.id, value.trim()); await refresh(); } };
  return <header className="topbar"><button className="icon-button sidebar-toggle" title="显示或隐藏左侧栏" onClick={onToggleSidebar}><UiIcon name="panel"/></button>{workbenchView !== "chat" && <button className="return-to-chat" onClick={onReturnToChat}><span className="return-arrow">‹</span>返回会话</button>}<div className="topbar-copy">{workbenchView === "chat" && session ? <details className="task-title-menu"><summary className="topbar-heading"><UiIcon name="folder" size={15}/><strong>{title}</strong><UiIcon name="chevron-down" size={12}/></summary><div className="task-title-popover"><button onClick={() => void rename()}><UiIcon name="edit"/>重命名</button><button onClick={() => void window.grokDesktop.pinSession(session.id, !session.pinned).then(refresh)}><UiIcon name="pin"/>{session.pinned ? "取消置顶" : "置顶"}</button><button onClick={() => void window.grokDesktop.archiveSession(session.id, !session.archived).then(refresh)}><UiIcon name="archive"/>{session.archived ? "取消归档" : "归档"}</button><button onClick={() => onPanel("history")}><UiIcon name="history"/>分叉 / 回退</button><section><strong>任务信息</strong><dl><dt>状态</dt><dd>{view?.status || "未知"}</dd><dt>消息</dt><dd>{session.messageCount}</dd><dt>模型</dt><dd>{view?.currentModelId || "未知"}</dd><dt>执行目录</dt><dd title={session.cwd}>{session.cwd || "未知"}</dd></dl></section></div></details> : <div className="topbar-heading"><UiIcon name={workbenchView === "chat" ? "folder" : "workbench"} size={15}/><strong>{title}</strong></div>}<span>{location || "请选择工作区"}{contextLabel}</span></div><div className="top-actions">{location && <button className="open-location" onClick={() => void window.grokDesktop.openPath(location)}><UiIcon name="folder" size={14}/><span>打开位置</span></button>}{workbenchView === "chat" && <button className={`review-toggle ${rightToolOpen ? "active" : ""}`} title="显示或隐藏右侧工具" onClick={onToggleRightTool}><UiIcon name="panel"/><span>侧栏</span></button>}<span className={`connection ${busy ? "working" : ""}`} title={busy ? "Grok 正在工作" : "空闲"}/><details className="topbar-more"><summary className="icon-button" title="更多"><UiIcon name="more"/></summary><div className="topbar-menu"><button onClick={() => onView("memory")}><UiIcon name="memory"/>Memory</button><button onClick={() => onPanel("tasks")}><UiIcon name="tasks"/>任务中心</button><button onClick={() => onPanel("extensions")}><UiIcon name="extensions"/>扩展</button>{workbenchView === "chat" && <button onClick={() => onPanel("media")}><UiIcon name="sparkles"/>创作</button>}{activeAccount && <button onClick={() => onPanel("accounts")}><UiIcon name="account"/>{activeAccount.label}</button>}<button onClick={() => onPanel("settings")}><UiIcon name="settings"/>设置</button></div></details></div></header>;
}
function Composer(props: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  text: string;
  setText(value: string): void;
  busy: boolean;
  controlsDisabled: boolean;
  sessionId: string;
  attachments: ReturnType<typeof useAppStore.getState>["attachments"];
  reviewComments: ReviewCommentDraft[];
  commandMatches: Array<{ name: string; description?: string }>;
  fileMatches: WorkspaceFileCandidate[];
  view: ReturnType<typeof useAppStore.getState>["views"][string] | undefined;
  onSend(): void;
  onInterject(): void;
  onStop(): void;
  onAdd(): void;
  onAddFolders(): void;
  onPaste(files: File[]): void;
  onRemove(id: string): void;
  onRemoveReviewComment(id: string): void;
  onCommand(name: string): void;
  onFile(file: WorkspaceFileCandidate): void;
  onFileMenu(): void;
  capability?: ComposerCapabilitySelection;
  computerTask: ComputerTaskState | null;
  onCapability(value: ComposerCapabilitySelection): void;
  onComputer(): void;
  onClearCapability(): void;
  onManageExtensions(): void;
  onHistory(direction: -1 | 1): void;
  onControlSettled(): void;
}): React.JSX.Element {
  const [addOpen, setAddOpen] = useState(false);
  const composingRef = useRef(false);
  const tokenTotal = props.view?.meta.totalTokens ?? 0;
  const selectedModel = props.view?.models.find((value) => value.modelId === props.view?.currentModelId);
  const tokenWindow = selectedModel?.totalContextTokens ?? 512_000;
  const percent = Math.min(100, Math.round(tokenTotal / tokenWindow * 100));
  return <div className="composer-zone">{props.view?.queue.length ? <PromptQueueBar sessionId={props.sessionId} entries={props.view.queue} /> : null}{props.reviewComments.length > 0 && <div className="review-comment-drafts"><span>审核批注草稿</span>{props.reviewComments.map((comment) => <button key={comment.id} title={comment.body} onClick={() => props.onRemoveReviewComment(comment.id)}><code>{comment.path}:L{comment.line}</code><span>{comment.body}</span><b>×</b></button>)}</div>}{props.commandMatches.length > 0 && <div className="slash-menu">{props.commandMatches.map((command) => <button key={command.name} onClick={() => props.onCommand(command.name)}><strong>/{command.name.replace(/^\//, "")}</strong><span>{command.description}</span></button>)}</div>}{props.fileMatches.length > 0 && <div className="slash-menu file-menu">{props.fileMatches.map((file) => <button key={file.path} onClick={() => props.onFile(file)}><strong>@{file.name}</strong><span>{file.relativePath}</span></button>)}</div>}
    {addOpen && createPortal(<AddPalette onClose={() => { setAddOpen(false); props.onControlSettled(); }} onFiles={() => { setAddOpen(false); props.onAdd(); }} onFolders={() => { setAddOpen(false); props.onAddFolders(); }} onWorkspaceFile={() => { setAddOpen(false); props.onFileMenu(); }} onComputer={() => { setAddOpen(false); props.onComputer(); }} onSkill={(skill) => { setAddOpen(false); props.onCapability({ kind: "skill", label: skill.name, command: normalizeSkillCommand(skill.command), source: skill.source }); props.onControlSettled(); }} onManageExtensions={() => { setAddOpen(false); props.onManageExtensions(); }} />, document.getElementById("overlay-root")!)}
    <div className="composer">{(props.attachments.length > 0 || props.capability) && <div className="attachment-row">{props.capability && <span className={`capability-chip ${props.capability.kind}`}>{props.capability.kind === "computer" ? "◉" : "✦"} @{props.capability.label}<small>仅本次消息</small><button title="移除能力" onClick={props.onClearCapability}>×</button></span>}{props.attachments.map((attachment) => <span className={attachment.kind === "image" ? "composer-image-chip" : ""} key={attachment.id}>{attachment.kind === "image" ? <img src={attachment.data ? `data:${attachment.mimeType || "image/png"};base64,${attachment.data}` : attachment.path ? localFileUrl(attachment.path) : ""} alt="" /> : attachment.kind === "folder" ? "▰" : "▤"}<span>{attachment.name}</span><button title={`移除 ${attachment.name}`} onClick={() => props.onRemove(attachment.id)}>×</button></span>)}</div>}
      <textarea ref={props.inputRef} value={props.text} onChange={(event) => props.setText(event.target.value)} onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; }} onPaste={(event) => { const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/")); if (images.length) { event.preventDefault(); props.onPaste(images); } }} onKeyDown={(event) => { if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) { event.preventDefault(); props.onHistory(event.key === "ArrowUp" ? -1 : 1); } else if (event.key === "Enter" && event.ctrlKey && !event.nativeEvent.isComposing && !composingRef.current) { event.preventDefault(); if (props.busy && !props.controlsDisabled) props.onInterject(); } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !composingRef.current && event.nativeEvent.keyCode !== 229) { event.preventDefault(); if (!props.controlsDisabled) props.onSend(); } }} placeholder={props.busy ? "继续输入；Enter 排队，Ctrl+Enter 插话…" : "给 Grok 发送消息…"} />
      <div className="composer-toolbar"><div className="toolbar-left"><button className="icon-button add-button" title="添加文件或能力" aria-expanded={addOpen} aria-haspopup="dialog" disabled={props.controlsDisabled} onClick={() => setAddOpen(!addOpen)}><UiIcon name="plus"/></button><TokenDonut percent={percent} label={`${formatTokens(tokenTotal)} / ${formatTokens(tokenWindow)}`} />{props.view && <ModelControls sessionId={props.sessionId} view={props.view} disabled={props.controlsDisabled || props.busy} onSettled={props.onControlSettled} />}</div>{props.busy ? <div className="busy-send-actions"><button className="queue-send" disabled={props.controlsDisabled || (!props.text.trim() && !props.attachments.length && !props.reviewComments.length)} onClick={props.onSend}>加入队列</button><button className="send-button stop" title="停止" onClick={props.onStop}><UiIcon name="stop"/></button></div> : <button className="send-button" title="发送" disabled={props.controlsDisabled || (!props.text.trim() && !props.attachments.length && !props.reviewComments.length)} onClick={props.onSend}><UiIcon name="send"/></button>}</div>
    </div>
  </div>;
}

function PromptQueueBar({ sessionId, entries }: { sessionId: string; entries: PromptQueueEntry[] }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false); const [editing, setEditing] = useState<string>(); const [text, setText] = useState(""); const setError = useAppStore((state) => state.setError);
  const run = async (action: () => Promise<void>): Promise<void> => { try { await action(); } catch (error) { setError(errorMessage(error)); } };
  return <div className="prompt-queue"><button className="prompt-queue-summary" onClick={() => setExpanded(!expanded)}><span>≡</span><strong>{entries.length} 条消息等待发送</strong><small>{expanded ? "收起" : "展开管理"}</small></button>{expanded && <div className="prompt-queue-list">{entries.map((entry, index) => <div key={entry.id}>{editing === entry.id ? <input autoFocus value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setEditing(undefined); if (event.key === "Enter" && text.trim()) void run(async () => { await window.grokDesktop.editQueuedPrompt(sessionId, entry.id, text.trim()); setEditing(undefined); }); }} /> : <span><b>{index + 1}</b>{entry.text}</span>}<button disabled={index === 0} title="上移" onClick={() => void run(() => window.grokDesktop.reorderQueuedPrompt(sessionId, entry.id, index - 1))}>↑</button><button disabled={index === entries.length - 1} title="下移" onClick={() => void run(() => window.grokDesktop.reorderQueuedPrompt(sessionId, entry.id, index + 1))}>↓</button><button title="立即插入当前回合" onClick={() => void run(() => window.grokDesktop.interjectQueuedPrompt(sessionId, entry.id))}>插话</button><button title="编辑" onClick={() => { setEditing(entry.id); setText(entry.text); }}>✎</button><button title="删除" onClick={() => void run(() => window.grokDesktop.removeQueuedPrompt(sessionId, entry.id))}>×</button></div>)}<button className="clear-queue" onClick={() => void run(() => window.grokDesktop.clearPromptQueue(sessionId))}>清空等待队列</button></div>}</div>;
}

function AddPalette({ onClose, onFiles, onFolders, onWorkspaceFile, onComputer, onSkill, onManageExtensions }: { onClose(): void; onFiles(): void; onFolders(): void; onWorkspaceFile(): void; onComputer(): void; onSkill(skill: SkillSummary): void; onManageExtensions(): void }): React.JSX.Element {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    void window.grokDesktop.listSkills().then(setSkills).catch((value) => setError(errorMessage(value))).finally(() => setLoading(false));
    window.setTimeout(() => panelRef.current?.querySelector<HTMLButtonElement>("button[data-palette-item]")?.focus(), 0);
    const key = (event: KeyboardEvent): void => { if (event.key === "Escape") { event.preventDefault(); closeRef.current(); } };
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = previousOverflow; window.setTimeout(() => previousFocus?.focus(), 0); };
  }, []);
  const move = (event: React.KeyboardEvent, direction: -1 | 1): void => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>("button[data-palette-item]") ?? []);
    if (!buttons.length) return;
    const focusedIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = ((focusedIndex >= 0 ? focusedIndex : activeIndex) + direction + buttons.length) % buttons.length;
    setActiveIndex(next); buttons[next]?.focus();
  };
  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "Enter") {
      const target = event.target instanceof HTMLElement ? event.target.closest<HTMLButtonElement>("button[data-palette-item]") : null;
      if (target) { event.preventDefault(); target.click(); }
      return;
    }
    move(event, event.key === "ArrowUp" ? -1 : 1);
  };
  const item = (icon: string, title: string, description: string, action: () => void, badge?: string): React.JSX.Element => <button data-palette-item onFocus={(event) => { const rows = Array.from(panelRef.current?.querySelectorAll("button[data-palette-item]") ?? []); setActiveIndex(rows.indexOf(event.currentTarget)); }} onClick={action}><i>{icon}</i><span><strong>{title}</strong><small>{description}</small></span>{badge && <em>{badge}</em>}</button>;
  return <div className="add-palette-backdrop" onMouseDown={onClose}><section ref={panelRef} className="add-palette" role="dialog" aria-modal="true" aria-label="添加文件、能力或 Skill" onMouseDown={(event) => event.stopPropagation()} onKeyDown={handleKeyDown}><header><strong>添加</strong><button onClick={onClose}>×</button></header><div className="add-palette-scroll"><h3>添加</h3>{item("▤", "文件和图片", "选择一个或多个文件，支持常见图片格式", onFiles)}{item("▰", "文件夹", "仅引用文件夹路径，不会预先递归读取", onFolders)}{item("@", "工作区文件", "按文件名搜索并引用当前项目中的文件", onWorkspaceFile)}<h3>能力</h3>{item("◉", "控制电脑", "为本次消息启用 Computer Use，执行时再选择目标", onComputer, "实验性")}<h3>插件 Skills</h3>{loading ? <p className="palette-status">正在加载已启用 Skills…</p> : error ? <p className="palette-status warning-text">Skills 暂不可用：{error}</p> : skills.length ? skills.map((skill) => <button data-palette-item key={`${skill.source}-${skill.command}`} onClick={() => onSkill(skill)}><i>✦</i><span><strong>{skill.name}</strong><small>{skill.description || skill.command}</small></span><em>{skill.source || "插件"}</em></button>) : <p className="palette-status">当前没有已启用的插件 Skill。</p>}</div><footer><button onClick={onManageExtensions}>管理扩展和 Skills</button><span>↑↓ 选择 · Enter 使用 · Esc 关闭</span></footer></section></div>;
}

function ModelControls({ sessionId, view, disabled, onSettled }: { sessionId: string; view: NonNullable<ReturnType<typeof useAppStore.getState>["views"][string]>; disabled: boolean; onSettled(): void }): React.JSX.Element {
  const setError = useAppStore((state) => state.setError);
  const setSettings = useAppStore((state) => state.setSettings);
  const [switching, setSwitching] = useState<"model" | "effort" | "mode" | null>(null);
  const locked = disabled || switching !== null;
  const run = async (kind: "model" | "effort" | "mode", action: () => Promise<void>): Promise<void> => {
    if (locked) return;
    setSwitching(kind);
    try { await action(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setSwitching(null); onSettled(); }
  };
  return <div className="model-controls" aria-busy={switching !== null}>
    <select aria-label="模型" title={switching === "model" ? "正在切换模型…" : "模型"} className="model-select" disabled={locked} value={view.currentModelId} onChange={(event) => void run("model", () => window.grokDesktop.setModel(sessionId, event.target.value))}>{view.models.map((model) => <option value={model.modelId} key={model.modelId}>{model.name}</option>)}</select>
    <select aria-label="推理强度" title={switching === "effort" ? "正在应用推理强度…" : "推理强度（直接切换）"} className="effort-select" disabled={locked} value={view.effort || ""} onChange={(event) => { const effort = event.target.value as ReasoningEffort; void run("effort", async () => { await window.grokDesktop.setEffort(sessionId, effort); setSettings(await window.grokDesktop.getSettings()); }); }}><option value="" disabled={view.effort !== ""}>CLI 默认</option>{["none", "minimal", "low", "medium", "high", "xhigh"].map((value) => <option key={value} value={value}>{value}</option>)}</select>
    <select aria-label="执行模式" title={switching === "mode" ? "正在切换模式…" : "执行模式"} className={`mode-select ${view.mode}`} disabled={locked} value={view.mode} onChange={(event) => { const mode = event.target.value as SessionMode; void run("mode", () => window.grokDesktop.setMode(sessionId, mode)); }}><option value="agent">Agent</option><option value="plan">Plan</option><option value="auto">自动批准</option></select>
    {switching && <span className="control-progress">应用中…</span>}
  </div>;
}

function TokenDonut({ percent, label }: { percent: number; label: string }): React.JSX.Element { return <span className="token-meter" title={label}><span style={{ background: `conic-gradient(var(--accent) ${percent}%, #343940 ${percent}% 100%)` }}><i /></span>{label}</span>; }

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
    {type === "accounts" && <div className="panel-body"><div className="account-list">{store.accounts.map((account) => <div className={`account-row ${account.active ? "active" : ""}`} key={account.id}><span className="avatar">{account.label.slice(0, 1).toUpperCase()}</span><div><strong>{account.label}</strong><span>{account.email || (account.kind === "api-key" ? "API Key 配置档" : "OAuth 账号")}</span></div>{account.active ? <b>当前</b> : <button onClick={async () => { setSaving(true); try { store.setAccounts(await window.grokDesktop.switchAccount(account.id)); } catch (error) { store.setError(errorMessage(error)); } finally { setSaving(false); } }}>切换</button>}<button className="danger-link" onClick={async () => { if (await confirmAction("移除此账号配置？", { title: "移除账号", confirmLabel: "移除", danger: true })) store.setAccounts(await window.grokDesktop.removeAccount(account.id)); }}>移除</button></div>)}</div><QuotaPanel quota={quota} loading={quotaLoading} onRefresh={() => void refreshQuota(true)} /><div className="login-box"><h3>添加账号</h3><button className="primary full" disabled={store.login.running || saving} onClick={async () => { try { store.setLogin(await window.grokDesktop.loginDevice()); await refreshAccounts(); } catch (error) { store.setError(errorMessage(error)); } }}>使用浏览器/设备码登录</button>{store.login.message && <p>{store.login.message}</p>}{store.login.url && <div className="device-card"><code>{store.login.url}</code>{store.login.code && <strong>{store.login.code}</strong>}<div className="button-row"><button onClick={() => void navigator.clipboard.writeText(store.login.code || store.login.url!)}>复制</button><button onClick={() => void window.grokDesktop.openExternal(store.login.url!)}>重新打开浏览器</button></div></div>}<div className="separator"><span>或使用 API Key</span></div><input placeholder="配置名称" value={apiLabel} onChange={(event) => setApiLabel(event.target.value)} /><input type="password" placeholder="xAI API Key" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /><button disabled={!apiKey.trim()} onClick={async () => { try { store.setAccounts(await window.grokDesktop.loginApiKey(apiLabel, apiKey)); setApiKey(""); setApiLabel(""); } catch (error) { store.setError(errorMessage(error)); } }}>保存并验证 API Key</button></div>{store.accounts.some((value) => value.active) && <button className="danger full" onClick={async () => { if (await confirmAction("退出会清除当前凭据配置，继续吗？", { title: "退出账号", confirmLabel: "退出", danger: true })) { await window.grokDesktop.logout(); await refreshAccounts(); } }}>退出当前账号</button>}<section className="provider-entry-card"><div><h3>自定义提供商</h3><p>使用独立管理中心测试连接、发现和批量导入模型。</p></div><button onClick={onProviders}>管理提供商</button></section></div>}
    {type === "settings" && <div className="panel-body settings-form"><label>Grok CLI 路径<input value={settingsDraft.cliPath} placeholder="自动发现 %USERPROFILE%\\.grok\\bin\\grok.exe" onChange={(event) => setSettingsDraft({ ...settingsDraft, cliPath: event.target.value })} /></label><label>默认模型<input list="known-models" value={settingsDraft.defaultModel} placeholder="由 CLI 动态提供" onChange={(event) => setSettingsDraft({ ...settingsDraft, defaultModel: event.target.value })} /><datalist id="known-models">{knownModels.map((model) => <option key={model.modelId} value={model.modelId}>{model.name}</option>)}</datalist></label><label>新会话默认推理强度<select value={settingsDraft.defaultEffort} onChange={(event) => setSettingsDraft({ ...settingsDraft, defaultEffort: event.target.value as ReasoningEffort })}><option value="">CLI 默认</option>{["none", "minimal", "low", "medium", "high", "xhigh"].map((value) => <option key={value}>{value}</option>)}</select></label><label>默认模式<select value={settingsDraft.defaultMode} onChange={(event) => setSettingsDraft({ ...settingsDraft, defaultMode: event.target.value as SessionMode })}><option value="agent">Agent</option><option value="plan">Plan</option><option value="auto">自动批准</option></select></label><label>HTTP 代理<input value={settingsDraft.httpProxy} onChange={(event) => setSettingsDraft({ ...settingsDraft, httpProxy: event.target.value })} /></label><label>HTTPS 代理<input value={settingsDraft.httpsProxy} onChange={(event) => setSettingsDraft({ ...settingsDraft, httpsProxy: event.target.value })} /></label><label>文字大小 <strong>{settingsDraft.fontScale}%</strong><input type="range" min="85" max="130" step="5" value={settingsDraft.fontScale} onChange={(event) => setSettingsDraft({ ...settingsDraft, fontScale: Number(event.target.value) })} /><small>只调整文字；建议保持 100%。</small></label><label>界面密度<select value={settingsDraft.uiDensity} onChange={(event) => setSettingsDraft({ ...settingsDraft, uiDensity: event.target.value as AppSettings["uiDensity"] })}><option value="compact">紧凑（更多内容）</option><option value="balanced">标准（推荐）</option><option value="comfortable">宽松</option></select><small>独立调整侧栏、间距和输入区大小，不会缩小文字。</small></label><label className="check"><input type="checkbox" checked={settingsDraft.showThinking} onChange={(event) => setSettingsDraft({ ...settingsDraft, showThinking: event.target.checked })} />显示完整思考过程</label><label className="check"><input type="checkbox" checked={settingsDraft.expandToolDetails} onChange={(event) => setSettingsDraft({ ...settingsDraft, expandToolDetails: event.target.checked })} />默认展开工具详情和 Diff</label><ThemeEditor theme={settingsDraft.theme} onChanged={(settings) => { setSettingsDraft((current) => ({ ...current, theme: settings.theme })); store.setSettings(settings); }} setError={store.setError} /><button className="primary" onClick={async () => { const settings = await window.grokDesktop.updateSettings(settingsDraft); store.setSettings(settings); onClose(); }}>保存设置</button><button onClick={() => void window.grokDesktop.exportLogs()}>导出脱敏日志</button></div>}
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

function WorkspaceMenu({ workspaces, active, onClose, onChoose, onSelect, onPin, onClear }: { workspaces: WorkspaceSummary[]; active: string; onClose(): void; onChoose(): void; onSelect(cwd: string): void; onPin(workspace: WorkspaceSummary): void; onClear(): void }): React.JSX.Element {
  const [query, setQuery] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.setTimeout(() => menuRef.current?.querySelector<HTMLInputElement>("input")?.focus(), 0);
    const key = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !menuRef.current) return;
      const focusable = Array.from(menuRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0]!; const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const outside = (event: PointerEvent): void => { if (event.target instanceof Node && !menuRef.current?.contains(event.target) && !(event.target instanceof Element && event.target.closest(".workspace-button"))) onClose(); };
    window.addEventListener("keydown", key);
    document.addEventListener("pointerdown", outside);
    return () => { window.removeEventListener("keydown", key); document.removeEventListener("pointerdown", outside); window.setTimeout(() => previousFocus?.focus(), 0); };
  }, [onClose]);
  const groups: Array<{ source: WorkspaceSummary["sources"][number]; label: string }> = [{ source: "pinned", label: "置顶" }, { source: "recent", label: "最近" }, { source: "grok", label: "已有 Grok 历史" }, { source: "codex", label: "已有 Codex 项目" }];
  const seen = new Set<string>();
  return <div className="workspace-menu" ref={menuRef} role="dialog" aria-label="选择工作区"><header><strong>选择工作区</strong><button className="icon-button" aria-label="关闭工作区选择器" onClick={onClose}><UiIcon name="close"/></button></header><label className="workspace-menu-search"><UiIcon name="search" size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目或路径" /></label><button className="choose-workspace" onClick={onChoose}><UiIcon name="folder"/>选择其他文件夹…</button><div className="workspace-menu-scroll">{groups.map((group) => {
    const needle = query.trim().toLocaleLowerCase();
    const rows = workspaces.filter((row) => row.sources.includes(group.source) && !seen.has(row.cwd.toLocaleLowerCase()) && (!needle || `${row.name} ${row.cwd}`.toLocaleLowerCase().includes(needle)));
    rows.forEach((row) => seen.add(row.cwd.toLocaleLowerCase()));
    return rows.length ? <div className="workspace-group" key={group.source}><strong>{group.label}</strong>{rows.map((workspace) => <div className={`workspace-row ${workspace.cwd.toLocaleLowerCase() === active.toLocaleLowerCase() ? "active" : ""}`} key={workspace.cwd}><button disabled={!workspace.exists} title={workspace.exists ? workspace.cwd : "路径已失效"} onClick={() => onSelect(workspace.cwd)}><span>{workspace.name}</span><small>{workspace.exists ? `${workspace.grokSessions} Grok · ${workspace.codexSessions} Codex` : "路径已失效"}</small></button><button title={workspace.pinned ? "取消置顶" : "置顶"} onClick={() => onPin(workspace)}>◆</button></div>)}</div> : null;
  })}</div>{active && <button className="danger-link workspace-clear" onClick={onClear}>清空当前工作区会话…</button>}</div>;
}

type SettingsCategory = "general" | "appearance" | "models" | "project" | "worktree" | "agents" | "accounts" | "computer" | "updates" | "archived";

function SettingsDialog({ initial, knownModels, onClose, onDiagnostics, onProviders }: { initial: AppSettings; knownModels: Array<{ modelId: string; name: string }>; onClose(): void; onDiagnostics(): void; onProviders(): void }): React.JSX.Element {
  const store = useAppStore();
  const [draft, setDraft] = useState(initial);
  const [category, setCategory] = useState<SettingsCategory>("general");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [computer, setComputer] = useState<ComputerUseSettings>();
  useEffect(() => { if (category === "computer" && !computer) void window.grokDesktop.getComputerSettings().then(setComputer).catch((error) => store.setError(errorMessage(error))); }, [category, computer]);
  const categories: Array<{ id: SettingsCategory; label: string; icon: UiIconName }> = [
    { id: "general", label: "常规", icon: "settings" }, { id: "appearance", label: "外观", icon: "sparkles" }, { id: "models", label: "模型与会话", icon: "chat" },
    { id: "project", label: "项目与 Git", icon: "git" }, { id: "worktree", label: "Worktree 与 Memory", icon: "worktree" }, { id: "agents", label: "Agent", icon: "agents" },
    { id: "accounts", label: "账号与提供商", icon: "account" }, { id: "computer", label: "Computer Use", icon: "workbench" }, { id: "updates", label: "更新与诊断", icon: "download" }, { id: "archived", label: "已归档会话", icon: "archive" },
  ];
  const save = async (): Promise<void> => { setSaveState("saving"); try { const value = await window.grokDesktop.updateSettings(draft); store.setSettings(value); setDraft(value); setSaveState("saved"); window.setTimeout(() => setSaveState("idle"), 1400); } catch (error) { setSaveState("idle"); store.setError(errorMessage(error)); } };
  const updateComputer = async (patch: Partial<ComputerUseSettings>): Promise<void> => { try { setComputer(await window.grokDesktop.updateComputerSettings(patch)); } catch (error) { store.setError(errorMessage(error)); } };
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="settings-dialog" role="dialog" aria-modal="true" aria-label="设置" onMouseDown={(event) => event.stopPropagation()}>
    <header><div><h2>设置</h2><span>{saveState === "saving" ? "正在保存…" : saveState === "saved" ? "已保存" : "Grok Build Desktop"}</span></div><button className="icon-button" aria-label="关闭设置" onClick={onClose}><UiIcon name="close"/></button></header>
    <div className="settings-layout"><nav aria-label="设置分类">{categories.map((item) => <button key={item.id} className={category === item.id ? "active" : ""} onClick={() => setCategory(item.id)}><UiIcon name={item.icon}/><span>{item.label}</span></button>)}</nav><main className="settings-content">
      {category === "general" && <SettingsSection title="常规" description="调整整个桌面应用的阅读密度和本地 CLI 位置。"><label>Grok CLI 路径<input value={draft.cliPath} placeholder="自动发现 %USERPROFILE%\\.grok\\bin\\grok.exe" onChange={(event) => setDraft({ ...draft, cliPath: event.target.value })}/></label><label>文字大小 <strong>{draft.fontScale}%</strong><input type="range" min="85" max="130" step="5" value={draft.fontScale} onChange={(event) => setDraft({ ...draft, fontScale: Number(event.target.value) })}/></label><label>界面密度<select value={draft.uiDensity} onChange={(event) => setDraft({ ...draft, uiDensity: event.target.value as AppSettings["uiDensity"] })}><option value="compact">紧凑</option><option value="balanced">标准（推荐）</option><option value="comfortable">宽松</option></select></label></SettingsSection>}
      {category === "appearance" && <SettingsSection title="外观" description="背景参数实时生效；消息和代码卡片自行保证可读性。"><div className="background-preview" style={{ backgroundImage: "var(--theme-background-image)", backgroundSize: draft.theme.background.fit, backgroundPosition: draft.theme.background.position }}><span>会话背景预览</span><small>{draft.theme.background.scope === "conversation" ? "仅会话区" : "整个应用窗口"} · 透明度 {Math.round(draft.theme.background.opacity * 100)}% · 遮罩 {Math.round(draft.theme.background.dim * 100)}%</small></div><ThemeEditor theme={draft.theme} onChanged={(settings) => { setDraft((current) => ({ ...current, theme: settings.theme })); store.setSettings(settings); }} setError={store.setError}/></SettingsSection>}
      {category === "models" && <SettingsSection title="模型与会话" description="这些选项用于新会话；活动会话仍使用输入框中的实时控件。"><label>默认模型<input list="settings-known-models" value={draft.defaultModel} placeholder="由 CLI 动态提供" onChange={(event) => setDraft({ ...draft, defaultModel: event.target.value })}/><datalist id="settings-known-models">{knownModels.map((model) => <option key={model.modelId} value={model.modelId}>{model.name}</option>)}</datalist></label><label>默认推理强度<select value={draft.defaultEffort} onChange={(event) => setDraft({ ...draft, defaultEffort: event.target.value as ReasoningEffort })}><option value="">CLI 默认</option>{["none", "minimal", "low", "medium", "high", "xhigh"].map((value) => <option key={value}>{value}</option>)}</select></label><label>默认模式<select value={draft.defaultMode} onChange={(event) => setDraft({ ...draft, defaultMode: event.target.value as SessionMode })}><option value="agent">Agent</option><option value="plan">Plan</option><option value="auto">自动批准</option></select></label><label className="check"><input type="checkbox" checked={draft.showThinking} onChange={(event) => setDraft({ ...draft, showThinking: event.target.checked })}/>显示完整思考过程</label><label className="check"><input type="checkbox" checked={draft.expandToolDetails} onChange={(event) => setDraft({ ...draft, expandToolDetails: event.target.checked })}/>默认展开工具详情和 Diff</label></SettingsSection>}
      {category === "project" && <SettingsSection title="项目与 Git" description="Review 使用真实会话/Worktree 执行目录，并在主进程校验仓库边界。"><label>HTTP 代理<input value={draft.httpProxy} onChange={(event) => setDraft({ ...draft, httpProxy: event.target.value })}/></label><label>HTTPS 代理<input value={draft.httpsProxy} onChange={(event) => setDraft({ ...draft, httpsProxy: event.target.value })}/></label><dl className="settings-facts"><dt>当前项目</dt><dd>{draft.activeWorkspace || "未选择"}</dd><dt>Git 写操作</dt><dd>固定参数数组与 stdin，不经过 shell</dd></dl></SettingsSection>}
      {category === "worktree" && <SettingsSection title="Worktree 与 Memory" description="创建、应用和清理 Worktree，以及 Memory 的结构化编辑，位于左侧“开发工具”中。"><p className="settings-note">执行配置档可决定新任务是否自动创建隔离 Worktree；Memory 的保存、删除和 Dream 操作继续由主进程完成。</p></SettingsSection>}
      {category === "agents" && <SettingsSection title="Agent" description="Agent、Persona 与 Profiles 在项目范围内验证并原子保存。"><p className="settings-note">打开左侧“开发工具”中的 Agent 或 Profiles，可管理真实定义来源、启用状态和会话分配。</p></SettingsSection>}
      {category === "accounts" && <SettingsSection title="账号与提供商" description="账号凭据仍保存在系统安全存储中；提供商使用独立管理流程。"><dl className="settings-facts"><dt>活动账号</dt><dd>{store.accounts.find((value) => value.active)?.label || "未登录"}</dd><dt>提供商</dt><dd>连接测试只访问模型列表端点，不发送推理请求</dd></dl><div className="settings-action-list"><button onClick={onProviders}>管理自定义提供商与模型</button></div></SettingsSection>}
      {category === "computer" && <SettingsSection title="Computer Use" description="仅控制已明确选择的 Windows 应用。">{computer ? <><label className="check"><input type="checkbox" checked={computer.enabled} onChange={(event) => void updateComputer({ enabled: event.target.checked })}/>启用 Computer Use</label><label className="check"><input type="checkbox" checked={computer.confirmNewApps} onChange={(event) => void updateComputer({ confirmNewApps: event.target.checked })}/>首次控制新应用时确认</label><label>截图最大边长 <strong>{computer.maxScreenshotEdge}px</strong><input type="range" min="640" max="1920" step="128" value={computer.maxScreenshotEdge} onChange={(event) => void updateComputer({ maxScreenshotEdge: Number(event.target.value) })}/></label><dl className="settings-facts"><dt>紧急停止</dt><dd>{computer.emergencyShortcut}</dd><dt>始终允许应用</dt><dd>{computer.alwaysAllowedAppIds.length}</dd></dl></> : <p>正在读取 Computer Use 设置…</p>}</SettingsSection>}
      {category === "updates" && <SettingsSection title="更新与诊断" description="检查应用、CLI 和本机兼容状态。"><div className="settings-action-list"><button onClick={async () => store.setAppRelease(await window.grokDesktop.checkAppUpdate(true))}>检查应用更新</button><button onClick={async () => store.setCli(await window.grokDesktop.checkCliUpdate())}>检查 Grok CLI 更新</button><button onClick={onDiagnostics}>打开诊断中心</button><button onClick={() => void window.grokDesktop.exportLogs()}>导出脱敏日志</button></div></SettingsSection>}
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

function CodexMirror({ detail, busy, onRefresh, onContinue, onHide }: { detail: CodexSessionDetail | null; busy: boolean; onRefresh(): Promise<void>; onContinue(): Promise<void>; onHide(): Promise<void> }): React.JSX.Element {
  if (!detail) return <div className="empty-state"><div className="spinner" /><h2>正在只读加载 Codex 会话…</h2></div>;
  const turns: Array<{ user?: string; process: CodexSessionDetail["turns"]; final?: string }> = [];
  let current: { user?: string; process: CodexSessionDetail["turns"]; final?: string } | undefined;
  for (const item of detail.turns) {
    if (item.role === "user") { if (current) turns.push(current); current = { user: item.text, process: [] }; }
    else {
      current ??= { process: [] };
      if (item.role === "assistant") { if (current.final) current.process.push({ role: "assistant", text: current.final }); current.final = item.text; }
      else current.process.push(item);
    }
  }
  if (current) turns.push(current);
  return <div className="codex-mirror"><div className="codex-readonly-bar"><span>只读镜像 · 原文件不会被修改</span><button disabled={busy} onClick={() => void onRefresh()}>刷新</button><button className="primary" disabled={busy} onClick={() => void onContinue()}>在 Grok 中继续</button><button disabled={busy} onClick={() => void onHide()}>从列表隐藏</button></div><div className="codex-turns" tabIndex={0} aria-label="Codex 只读会话内容，可滚动">{turns.map((turn, index) => <article className="chat-turn completed" key={`${detail.id}-${index}`}>{turn.user && <div className="message-row user"><div className="bubble user-bubble"><LazyMarkdownView text={turn.user} /></div></div>}{turn.process.length > 0 && <details className="execution-process"><summary><span className="process-dot" /><strong>执行过程</strong><span className="process-summary">{turn.process.length} 项</span></summary><div className="codex-process-items">{turn.process.map((item, itemIndex) => <details key={itemIndex} className="activity-group"><summary>{item.role === "thought" ? "思考" : item.role === "tool" ? "工具" : "过程说明"}</summary><LazyMarkdownView text={item.text || JSON.stringify(item.toolCalls || item.toolResults, null, 2)} /></details>)}</div></details>}{turn.final && <div className="final-answer"><div className="final-answer-toolbar"><span>最终回复</span><button onClick={() => void navigator.clipboard.writeText(turn.final!)}>复制</button></div><LazyMarkdownView text={turn.final} /></div>}</article>)}</div>{detail.warnings.length > 0 && <div className="codex-warnings">{detail.warnings.join("；")}</div>}</div>;
}

function ComputerLiveStrip({ task, onPause, onResume, onStop }: { task: ComputerTaskState; onPause(): void; onResume(): void; onStop(): void }): React.JSX.Element {
  const waiting = task.status === "awaiting-risk-confirmation";
  return <div className={`computer-live-strip ${task.status} ${task.manualInterventionRequired ? "manual" : ""}`} role="status" aria-live="polite"><span className="computer-live-dot" /><div><strong>{task.manualInterventionRequired ? "等待你手动完成 Windows 确认" : waiting ? "等待高影响操作确认" : task.status === "paused" ? "Computer Use 已暂停" : `Grok 正在控制 ${task.appName || "Windows 应用"}`}</strong><span>{task.message || "正在观察目标窗口"} · {task.stepCount} 步</span></div><kbd>Esc 停止</kbd><div className="computer-live-actions">{task.status === "running" && <button onClick={onPause}>暂停</button>}{task.status === "paused" && <button className="primary" onClick={onResume}>{task.manualInterventionRequired ? "已手动完成，继续" : "继续"}</button>}<button onClick={onStop}>停止</button></div></div>;
}

function ComputerPermissionDialog({ request, onRespond }: { request: ComputerAppPermissionRequest; onRespond(decision: "once" | "always" | "deny"): void }): React.JSX.Element {
  return <div className="modal-backdrop computer-approval-backdrop"><section className="action-dialog computer-approval" role="dialog" aria-modal="true"><h2>允许 Grok 控制此应用？</h2><div className="computer-app-summary"><strong>{request.app.name}</strong><span>{request.window?.title}</span><small>{request.window ? `${request.window.bounds.width}×${request.window.bounds.height} · ${request.window.dpi} DPI` : ""}</small></div><p>授权只适用于这个应用。高影响操作仍会在执行前单独确认；按 <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Esc</kbd> 可随时紧急停止。</p><div className="button-row three"><button className="danger" onClick={() => onRespond("deny")}>拒绝</button><button onClick={() => onRespond("once")}>仅本次允许</button><button className="primary" onClick={() => onRespond("always")}>始终允许</button></div></section></div>;
}

function ComputerRiskDialog({ request, onRespond }: { request: ComputerRiskConfirmation; onRespond(approved: boolean): void }): React.JSX.Element {
  const labels: Record<ComputerRiskConfirmation["category"], string> = { delete: "删除数据", "external-communication": "外部发送或提交", financial: "金融或订阅", install: "安装或执行", "account-access": "账号权限或密钥", "security-settings": "安全/隐私设置", "sensitive-transfer": "敏感数据传输" };
  return <div className="modal-backdrop computer-approval-backdrop"><section className="action-dialog computer-approval risk" role="alertdialog" aria-modal="true"><h2>高影响操作确认</h2><span className="risk-label">{labels[request.category]}</span><p><strong>{request.appName}</strong> 将执行：{request.summary}</p><p>此确认只允许当前这一个动作，不会改变应用授权。</p><div className="button-row"><button onClick={() => onRespond(false)}>取消并停止</button><button className="danger" onClick={() => onRespond(true)}>确认执行一次</button></div></section></div>;
}

function MediaStudioPanel({ commands, onCreate, onClose }: {
  commands: Array<{ name: string; description?: string }>;
  onCreate(request: MediaCreationRequest): Promise<void>;
  onClose(): void;
}): React.JSX.Element {
  const [kind, setKind] = useState<MediaCreationKind>("image");
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<MediaAspectRatio>("16:9");
  const [duration, setDuration] = useState<MediaVideoDuration>(6);
  const [resolution, setResolution] = useState<MediaVideoResolution>("480p");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const capabilities = useMemo(() => detectMediaCapabilities(commands), [commands]);
  const capabilityKnown = commands.length > 0;
  const supported = !capabilityKnown || capabilities[kind];

  useEffect(() => {
    promptRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const submit = async (): Promise<void> => {
    if (!prompt.trim() || busy || !supported) return;
    setBusy(true);
    setError("");
    try {
      await onCreate({ kind, prompt, aspectRatio, duration, resolution });
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={() => !busy && onClose()}>
    <section className="control-panel media-studio" role="dialog" aria-modal="true" aria-labelledby="media-studio-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><h2 id="media-studio-title">Grok 媒体创作</h2><small>使用 Grok CLI 官方 Imagine 工具</small></div><button disabled={busy} onClick={onClose}>×</button></header>
      <div className="panel-body media-studio-body">
        <div className="media-kind-tabs">
          <button className={kind === "image" ? "active" : ""} onClick={() => { setKind("image"); setError(""); }}>图片</button>
          <button className={kind === "video" ? "active" : ""} onClick={() => { setKind("video"); setError(""); }}>视频</button>
        </div>
        <div className={`media-capability ${supported ? "supported" : "unsupported"}`}>
          {capabilityKnown
            ? supported
              ? capabilities.diagnostic || `当前 CLI 已公布 /${kind === "image" ? capabilities.imageCommand : capabilities.videoCommand}`
              : capabilities.diagnostic
            : "提交时将从当前 CLI 会话检测媒体命令，未公布的命令不会发送。"}
        </div>
        <label>创作描述<textarea ref={promptRef} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={kind === "image" ? "例如：雨夜东京街头，一只撑着透明伞的橘猫，电影感光影" : "例如：一艘飞船缓慢穿过云海，镜头从侧后方平稳跟随"} /></label>
        <label>画面比例<select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as MediaAspectRatio)}><option value="auto">自动</option><option value="1:1">1:1 方形</option><option value="16:9">16:9 横屏</option><option value="9:16">9:16 竖屏</option><option value="4:3">4:3</option><option value="3:4">3:4</option></select></label>
        {kind === "video" && <div className="media-video-options"><label>时长<select value={duration} onChange={(event) => setDuration(Number(event.target.value) as MediaVideoDuration)}><option value={6}>6 秒</option><option value={10}>10 秒</option></select></label><label>分辨率<select value={resolution} onChange={(event) => setResolution(event.target.value as MediaVideoResolution)}><option value="480p">480p</option><option value="720p">720p</option></select></label></div>}
        <p className="media-workflow">{kind === "image" ? "图片由 image_gen 生成并保存到当前 Grok 会话。" : "视频会先规划并生成源图，再由 image_to_video 动画化；720p 和 10 秒通常耗时更长。"}</p>
        {error && <p className="error-text">{error}</p>}
        <div className="button-row media-actions"><button disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy || !prompt.trim() || !supported} onClick={() => void submit()}>{busy ? "正在启动…" : `开始生成${kind === "image" ? "图片" : "视频"}`}</button></div>
      </div>
    </section>
  </div>;
}

function QuotaPanel({ quota, loading, onRefresh }: { quota: GrokQuotaSnapshot | null; loading: boolean; onRefresh(): void }): React.JSX.Element {
  return <section className="quota-panel"><header><div><h3>账号额度</h3>{quota && <small>{quota.stale ? "缓存数据" : "更新于"} {new Date(quota.fetchedAt).toLocaleString()}</small>}</div><button disabled={loading} onClick={onRefresh}>{loading ? "刷新中…" : "刷新"}</button></header>{!quota ? <p>正在查询额度…</p> : !quota.supported ? <p>{quota.diagnostics[0]}</p> : <div className="quota-grid">{quota.weekly && <QuotaCard value={quota.weekly} />}{quota.monthly && <QuotaCard value={quota.monthly} />}{quota.onDemand && <QuotaCard value={quota.onDemand} />}{quota.diagnostics.length > 0 && <div className="quota-diagnostics">{quota.diagnostics.map((value) => <p key={value}>{value}</p>)}</div>}</div>}</section>;
}

function QuotaCard({ value }: { value: NonNullable<GrokQuotaSnapshot["weekly"]> }): React.JSX.Element {
  const percent = value.unit === "percent" ? value.used : value.limit && value.used !== undefined ? value.used / value.limit * 100 : undefined;
  return <div className="quota-card"><strong>{value.label}</strong>{percent !== undefined && <div className="quota-progress"><i style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} /></div>}<div><b>{value.used === undefined ? "使用率未返回" : value.unit === "percent" ? `${value.used.toFixed(1)}% 已用` : `${quotaAmount(value.used)} / ${quotaAmount(value.limit)}`}</b>{value.remaining !== undefined && value.unit !== "percent" && <span>剩余 {quotaAmount(value.remaining)}</span>}</div>{value.products?.map((product) => <small key={product.label}>{product.label}{product.usedPercent === undefined ? "" : `：${product.usedPercent.toFixed(1)}%`}</small>)}{value.resetAt && <small>重置：{new Date(value.resetAt).toLocaleString()}</small>}</div>;
}

function quotaAmount(value?: number): string { return value === undefined ? "—" : `$${(value / 100).toFixed(2)}`; }

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
