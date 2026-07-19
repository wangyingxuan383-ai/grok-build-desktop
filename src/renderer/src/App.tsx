import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { AppSettings, Attachment, ChatEvent, CodexSessionDetail, CodexSessionSummary, ComputerApp, ComputerAppPermissionRequest, ComputerRiskConfirmation, ComputerTaskState, ComputerWindow, GrokQuotaSnapshot, MediaAspectRatio, MediaCreationKind, MediaCreationRequest, MediaVideoDuration, MediaVideoResolution, ReasoningEffort, SessionMode, SessionSummary, WorkspaceFileCandidate, WorkspaceSummary } from "../../shared/types";
import { buildMediaSlashCommand, detectMediaCapabilities } from "../../shared/media";
import { resolveComputerMention } from "../../shared/computer-mentions";
import { LazyMarkdownView } from "./components/LazyMarkdownView";
import { TurnCard } from "./components/TurnCard";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { OnboardingPanel } from "./components/OnboardingPanel";
import { buildChatTurns, useAppStore } from "./store";

const LazyExtensionsPanel = lazy(() => import("./components/ExtensionsPanel").then((module) => ({ default: module.ExtensionsPanel })));

type Panel = "settings" | "accounts" | "about" | "media" | "extensions" | "computer" | "diagnostics" | "onboarding" | null;
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
  const [computerTarget, setComputerTarget] = useState<{ app: ComputerApp; window: ComputerWindow } | null>(null);
  const [computerTask, setComputerTask] = useState<ComputerTaskState | null>(null);
  const [computerPermission, setComputerPermission] = useState<ComputerAppPermissionRequest | null>(null);
  const [computerRisk, setComputerRisk] = useState<ComputerRiskConfirmation | null>(null);
  const [fileMatches, setFileMatches] = useState<WorkspaceFileCandidate[]>([]);
  const [conversationSearch, setConversationSearch] = useState("");
  const [conversationSearchOpen, setConversationSearchOpen] = useState(false);
  const [conversationMatch, setConversationMatch] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth < 960);
  const [returnToOnboarding, setReturnToOnboarding] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const atBottomRef = useRef(true);
  const forceFollowRef = useRef(false);
  const followTurnRef = useRef(false);
  const openRequestRef = useRef(0);
  const listRequestRef = useRef(0);
  const draftLoadedKeyRef = useRef("");

  const focusComposer = useCallback(() => {
    window.setTimeout(() => composerRef.current?.focus({ preventScroll: true }), 0);
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

  const askText = useCallback((message: string, initialValue: string): Promise<string | null> => new Promise((resolve) => {
    setDialog({ title: "重命名会话", message, input: { value: initialValue }, confirmLabel: "保存", resolve: (value) => resolve(typeof value === "string" ? value : null) });
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
        if (["stopped", "completed", "error"].includes(event.state.status)) { setComputerTarget(null); setComputerPermission(null); setComputerRisk(null); }
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
    const removeNavigate = window.grokDesktop.onNavigateSession((target) => {
      void (async () => {
        if (useAppStore.getState().settings?.activeWorkspace.toLocaleLowerCase() !== target.cwd.toLocaleLowerCase()) {
          useAppStore.getState().setSessions(await window.grokDesktop.setWorkspace(target.cwd));
          useAppStore.getState().setSettings(await window.grokDesktop.getSettings());
        }
        const session = (await window.grokDesktop.listSessions(target.cwd)).find((value) => value.id === target.sessionId);
        if (session) {
          setActiveCodexId(""); setCodexDetail(null);
          useAppStore.getState().setActiveSession(session.id);
          await window.grokDesktop.openSession(session.cwd, session.id);
        }
      })().catch((error) => useAppStore.getState().setError(errorMessage(error)));
    });
    const removeComputer = window.grokDesktop.onComputerStateChanged((state) => {
      setComputerTask(state);
      if (["stopped", "completed", "error"].includes(state.status)) { setComputerTarget(null); setComputerPermission(null); setComputerRisk(null); }
    });
    void window.grokDesktop.bootstrap().then((data) => {
      useAppStore.getState().bootstrap(data);
      if (!data.onboarding.completed && !data.onboarding.skipped) setPanel("onboarding");
      void window.grokDesktop.discoverWorkspaces().then((values) => useAppStore.getState().setWorkspaces(values)).catch(() => undefined);
      if (data.settings.activeWorkspace) void window.grokDesktop.listCodexSessions(data.settings.activeWorkspace, data.settings.showArchivedCodex).then((values) => useAppStore.getState().setCodexSessions(values)).catch(() => undefined);
      window.setTimeout(() => void window.grokDesktop.checkCliUpdate().then((cli) => useAppStore.getState().setCli(cli)).catch(() => undefined), 250);
      window.setTimeout(() => void window.grokDesktop.checkAppUpdate().then((release) => useAppStore.getState().setAppRelease(release)).catch(() => undefined), 1200);
    }).catch((error) => useAppStore.getState().setError(error instanceof Error ? error.message : String(error)));
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      flush();
      removeEvent(); removeLogin(); removeDrop(); removeNavigate(); removeComputer();
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
    if (!draftKey || activeCodexId) { setComposer(""); return; }
    void window.grokDesktop.getDraft(draftKey).then((draft) => {
      if (cancelled) return;
      setComposer(draft?.text || "");
      draftLoadedKeyRef.current = draftKey;
    }).catch(() => { if (!cancelled) draftLoadedKeyRef.current = draftKey; });
    return () => { cancelled = true; };
  }, [draftKey, activeCodexId]);

  useEffect(() => {
    if (!draftKey || draftLoadedKeyRef.current !== draftKey || activeCodexId) return;
    const timer = window.setTimeout(() => void window.grokDesktop.setDraft(draftKey, composer), 250);
    return () => window.clearTimeout(timer);
  }, [composer, draftKey, activeCodexId]);

  useEffect(() => {
    const onFocus = (): void => {
      if (panel || dialog) return;
      const active = document.activeElement;
      if (!active || active === document.body || active === document.documentElement) focusComposer();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [dialog, focusComposer, panel]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "f") { event.preventDefault(); setConversationSearchOpen(true); window.setTimeout(() => document.querySelector<HTMLInputElement>("#conversation-search")?.focus(), 0); }
      else if (event.ctrlKey && event.key.toLowerCase() === "n") { event.preventDefault(); void createSession(); }
      else if (event.ctrlKey && event.key.toLowerCase() === "f") { event.preventDefault(); document.querySelector<HTMLInputElement>("#session-search")?.focus(); }
      else if (event.ctrlKey && event.key.toLowerCase() === "l") { event.preventDefault(); focusComposer(); }
      else if (event.key === "Escape" && panel) { event.preventDefault(); setPanel(null); focusComposer(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusComposer, panel]);

  useEffect(() => {
    const resize = (): void => { if (window.innerWidth < 960) setSidebarCollapsed(true); };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    if (!store.settings) return;
    const requestId = ++listRequestRef.current;
    const workspace = store.settings.activeWorkspace;
    const timer = setTimeout(() => void window.grokDesktop.listSessions(workspace, search).then((sessions) => {
      if (requestId === listRequestRef.current) useAppStore.getState().setSessions(sessions);
    }).catch((error) => useAppStore.getState().setError(errorMessage(error))), 180);
    return () => clearTimeout(timer);
  }, [search, store.settings?.activeWorkspace]);

  const view = store.views[store.activeSessionId];
  const activeSession = store.sessions.find((value) => value.id === store.activeSessionId);
  const activeCodex = store.codexSessions.find((value) => value.id === activeCodexId);
  const turns = useMemo(() => buildChatTurns(view?.messages ?? [], view?.status), [view?.messages, view?.status]);
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
    const workspace = useAppStore.getState().settings?.activeWorkspace;
    if (!workspace) return;
    const requestId = ++listRequestRef.current;
    const sessions = await window.grokDesktop.listSessions(workspace, search);
    if (requestId === listRequestRef.current && useAppStore.getState().settings?.activeWorkspace === workspace) store.setSessions(sessions);
  };

  const createSession = async (): Promise<string | undefined> => {
    let cwd = useAppStore.getState().settings?.activeWorkspace || "";
    if (!cwd) {
      cwd = await window.grokDesktop.chooseWorkspace() || "";
      if (!cwd) return;
      store.setSettings(await window.grokDesktop.getSettings());
      store.setSessions(await window.grokDesktop.listSessions(cwd));
    }
    setOperationBusy(true);
    try {
      const result = await window.grokDesktop.createSession(cwd);
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

  const openCodexSession = async (session: CodexSessionSummary): Promise<void> => {
    setOperationBusy(true);
    setActiveCodexId(session.id);
    store.setActiveSession("");
    setCodexDetail(null);
    try { setCodexDetail(await window.grokDesktop.openCodexSession(session.id)); }
    catch (error) { store.setError(errorMessage(error)); }
    finally { setOperationBusy(false); }
  };

  const send = async (): Promise<void> => {
    const text = composer.trim();
    if ((!text && !store.attachments.length) || sending || view?.status === "working" || view?.status === "needs-user") return;
    let sessionId = store.activeSessionId;
    if (!sessionId) sessionId = await createSession() || "";
    if (!sessionId) return;
    const attachments = store.attachments;
    const cwd = store.settings?.activeWorkspace || activeSession?.cwd || "";
    if (attachments.length) {
      const findings = await window.grokDesktop.inspectAttachmentPrivacy(cwd, attachments).catch(() => []);
      if (findings.length && !(await askConfirm(`以下附件可能包含敏感信息：\n\n${findings.map((item) => `• ${item.message}`).join("\n")}\n\n仍要发送吗？`, { title: "附件隐私提醒", confirmLabel: "仍要发送", danger: findings.some((item) => item.severity === "high") }))) return;
    }
    setComposer("");
    if (draftKey) void window.grokDesktop.clearDraft(draftKey);
    if (cwd && text) {
      void window.grokDesktop.appendPromptHistory(cwd, text);
      setPromptHistory((values) => [text, ...values.filter((value) => value !== text)].slice(0, 50));
      setHistoryIndex(-1);
    }
    store.clearAttachments();
    setSending(true);
    forceFollowRef.current = true;
    followTurnRef.current = true;
    atBottomRef.current = true;
    setAtBottom(true);
    focusComposer();
    let outboundText = computerTarget ? `/computer 控制目标应用：${computerTarget.app.name}；精确窗口：${computerTarget.window.title}；窗口 ID：${computerTarget.window.id}。\n\n${text}` : text;
    if (!computerTarget && /^@/i.test(text)) {
      const generic = resolveComputerMention(text);
      if (generic) outboundText = generic.command;
      else try {
        const apps = await window.grokDesktop.listComputerApps();
        const targets = await Promise.all(apps.map(async (app) => ({ app, windows: await window.grokDesktop.listComputerWindows(app.id) })));
        outboundText = resolveComputerMention(text, targets)?.command || text;
      } catch (error) { store.setError(`无法解析 Computer 提及：${errorMessage(error)}`); }
    }
    try { await window.grokDesktop.sendPrompt({ sessionId, text: outboundText, attachments }); }
    catch (error) { store.setError(errorMessage(error)); }
    finally {
      setSending(false);
      if (followTurnRef.current) settleConversationBottom(sessionId);
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

  const openComputerPicker = async (): Promise<void> => {
    let sessionId = store.activeSessionId;
    if (!sessionId) sessionId = await createSession() || "";
    if (!sessionId) return;
    setPanel("computer");
  };

  if (store.loading) return <div className="splash"><div className="grok-mark">G</div><h1>Grok Build Desktop</h1><p>正在连接本机 Grok CLI…</p></div>;

  return (
    <div className={`app-shell density-${store.settings?.uiDensity ?? "balanced"} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`} style={{ fontSize: `${store.settings?.fontScale ?? 100}%` }}>
      <Sidebar
        settings={store.settings}
        sessions={store.sessions}
        codexSessions={store.codexSessions}
        workspaces={store.workspaces}
        activeSessionId={store.activeSessionId}
        activeCodexId={activeCodexId}
        search={search}
        busy={operationBusy}
        onSearch={setSearch}
        onNew={() => void createSession()}
        onOpen={(session) => void openSession(session)}
        onOpenCodex={(session) => void openCodexSession(session)}
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
        onExport={async (session) => { await window.grokDesktop.exportSessionMarkdown(session.cwd, session.id); }}
        onHideCodex={async (session) => { await window.grokDesktop.hideCodexSession(session.id, true); store.setCodexSessions(await window.grokDesktop.listCodexSessions(session.cwd, store.settings?.showArchivedCodex, true)); if (activeCodexId === session.id) { setActiveCodexId(""); setCodexDetail(null); } }}
        onToggleCodex={async (collapsed) => { if (!store.settings) return; store.setSettings(await window.grokDesktop.updateSettings({ codexGroupCollapsed: collapsed })); }}
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
      <main className="main-pane">
        <TopBar session={activeSession} codex={activeCodex} workspace={store.settings?.activeWorkspace || ""} view={view} busy={operationBusy || sending || view?.status === "working"} onPanel={setPanel} onToggleSidebar={() => setSidebarCollapsed((value) => !value)} />
        {activeComputerTask && <ComputerLiveStrip task={activeComputerTask} onPause={() => void window.grokDesktop.pauseComputer(activeComputerTask.sessionId)} onResume={() => void window.grokDesktop.resumeComputer(activeComputerTask.sessionId)} onStop={() => void window.grokDesktop.stopComputer(activeComputerTask.sessionId)} />}
        {conversationSearchOpen && <div className="conversation-search-bar"><input id="conversation-search" value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)} placeholder="搜索当前会话"/><span>{conversationMatches.length ? `${conversationMatch + 1}/${conversationMatches.length}` : "0 项"}</span><button disabled={!conversationMatches.length} onClick={() => setConversationMatch((value) => (value - 1 + conversationMatches.length) % conversationMatches.length)}>↑</button><button disabled={!conversationMatches.length} onClick={() => setConversationMatch((value) => (value + 1) % conversationMatches.length)}>↓</button><button onClick={() => { setConversationSearchOpen(false); setConversationSearch(""); focusComposer(); }}>×</button></div>}
        {!store.cli?.found ? <EmptyState title="未找到 Grok CLI" text="请在设置中指定 grok.exe 路径。" action="打开设置" onAction={() => setPanel("settings")} />
          : activeCodexId ? <CodexMirror detail={codexDetail} busy={operationBusy} onRefresh={async () => setCodexDetail(await window.grokDesktop.refreshCodexSession(activeCodexId))} onContinue={async () => { setOperationBusy(true); try { const result = await window.grokDesktop.continueCodexSession(activeCodexId); store.setSessions(await window.grokDesktop.setWorkspace(result.cwd)); store.setSettings(await window.grokDesktop.getSettings()); setActiveCodexId(""); setCodexDetail(null); store.setActiveSession(result.sessionId); await refreshSessions(); } catch (error) { store.setError(errorMessage(error)); } finally { setOperationBusy(false); } }} onHide={async () => { await window.grokDesktop.hideCodexSession(activeCodexId, true); store.setCodexSessions(await window.grokDesktop.listCodexSessions(store.settings?.activeWorkspace || "", store.settings?.showArchivedCodex, true)); setActiveCodexId(""); setCodexDetail(null); }} />
          : !activeSession && !view ? <WorkspaceEmptyState workspaces={store.workspaces} onNew={() => void createSession()} onOpen={async (cwd) => { store.setSessions(await window.grokDesktop.setWorkspace(cwd)); store.setSettings(await window.grokDesktop.getSettings()); }} />
          : <div className="conversation-wrap" onWheelCapture={(event) => { if (event.deltaY < 0) { followTurnRef.current = false; forceFollowRef.current = false; } }}><Virtuoso ref={virtuosoRef} className="conversation" data={turns} computeItemKey={(_index, turn) => turn.id} followOutput={(isAtBottom) => (isAtBottom || forceFollowRef.current) ? "auto" : false} atBottomStateChange={(value) => { atBottomRef.current = value; if (value && !followTurnRef.current) forceFollowRef.current = false; setAtBottom(value); }} itemContent={(index, turn) => <div className={conversationMatches[conversationMatch] === index ? "conversation-match-active" : ""}><TurnCard turn={turn} sessionId={store.activeSessionId} showThinking={store.settings?.showThinking ?? false} expandTools={store.settings?.expandToolDetails ?? false} onResolved={(id) => store.resolveMessage(store.activeSessionId, id)} /></div>} />{!atBottom && !!turns.length && <button className="scroll-to-bottom" onClick={() => { followTurnRef.current = false; forceFollowRef.current = true; atBottomRef.current = true; setAtBottom(true); scrollConversationNow("smooth"); }}>↓ 回到底部</button>}</div>}
        {!activeCodexId && <Composer
          inputRef={composerRef}
          text={composer}
          setText={setComposer}
          busy={sending || view?.status === "working"}
          controlsDisabled={operationBusy || sending || view?.status === "working" || view?.status === "needs-user"}
          sessionId={store.activeSessionId}
          attachments={store.attachments}
          commandMatches={commandMatches}
          fileMatches={fileMatches}
          view={view}
          onSend={() => void send()}
          onStop={() => store.activeSessionId && void window.grokDesktop.cancelSession(store.activeSessionId)}
          onAdd={async () => { try { store.addAttachments(await window.grokDesktop.pickAttachments()); } catch (error) { store.setError(errorMessage(error)); } finally { focusComposer(); } }}
          onPaste={async (files) => { try { store.addAttachments(await pastedImageAttachments(files)); } catch (error) { store.setError(errorMessage(error)); } }}
          onRemove={store.removeAttachment}
          onCommand={(name) => { setComposer(`/${name.replace(/^\//, "")} `); focusComposer(); }}
          onFile={async (file) => { try { store.addAttachments(await window.grokDesktop.attachmentsFromPaths([file.path])); setComposer((value) => value.replace(/(?:^|\s)@[^\s@]*$/u, "").trimStart()); setFileMatches([]); } catch (error) { store.setError(errorMessage(error)); } finally { focusComposer(); } }}
          onFileMenu={() => { setComposer((value) => `${value}${value && !/\s$/.test(value) ? " " : ""}@`); focusComposer(); }}
          computerTarget={computerTarget}
          computerTask={computerTask?.sessionId === store.activeSessionId ? computerTask : null}
          onComputer={() => void openComputerPicker()}
          onClearComputer={() => { if (computerTask?.sessionId) void window.grokDesktop.stopComputer(computerTask.sessionId).catch(() => undefined); setComputerTarget(null); }}
          onHistory={navigatePromptHistory}
          onControlSettled={focusComposer}
        />}
      </main>
      {store.error && <div className="toast error-toast"><span>{store.error}</span><button onClick={() => window.location.reload()}>重新加载界面</button><button onClick={() => setPanel("diagnostics")}>诊断</button><button onClick={() => store.setError("")}>×</button></div>}
      {panel === "media" && <MediaStudioPanel commands={activeCodexId ? [] : view?.commands ?? []} onCreate={createMedia} onClose={() => { setPanel(null); focusComposer(); }} />}
      {panel === "extensions" && <Suspense fallback={<div className="modal-backdrop"><section className="control-panel"><div className="panel-body">正在加载扩展中心…</div></section></div>}><LazyExtensionsPanel confirmAction={askConfirm} setError={store.setError} onUseSkill={(command) => { setComposer(command); focusComposer(); }} onClose={() => { setPanel(null); focusComposer(); }} /></Suspense>}
      {panel === "computer" && <ComputerPickerPanel sessionId={store.activeSessionId} onSelect={(app, window) => { setComputerTarget({ app, window }); setPanel(null); setComposer((value) => value || "请完成以下操作："); focusComposer(); }} onClose={() => { setPanel(null); focusComposer(); }} />}
      {panel === "diagnostics" && <DiagnosticsPanel onClose={() => { setPanel(null); focusComposer(); }} />}
      {panel === "onboarding" && store.onboarding && <OnboardingPanel state={store.onboarding} onState={store.setOnboarding} onClose={() => { setReturnToOnboarding(false); setPanel(null); focusComposer(); }} onAccounts={() => { setReturnToOnboarding(true); setPanel("accounts"); }} onWorkspace={() => void window.grokDesktop.chooseWorkspace().then(async (cwd) => { if (cwd) { store.setSettings(await window.grokDesktop.getSettings()); store.setSessions(await window.grokDesktop.listSessions(cwd)); } })} />}
      {panel && !["media", "extensions", "computer", "diagnostics", "onboarding"].includes(panel) && <ControlPanel type={panel as "settings" | "accounts" | "about"} confirmAction={askConfirm} onDiagnostics={() => setPanel("diagnostics")} onOnboarding={async () => { store.setOnboarding(await window.grokDesktop.resetOnboarding()); setPanel("onboarding"); }} onClose={() => { if (returnToOnboarding && panel === "accounts") { setReturnToOnboarding(false); setPanel("onboarding"); } else { setPanel(null); focusComposer(); } }} />}
      {computerPermission && <ComputerPermissionDialog request={computerPermission} onRespond={async (decision) => { try { await window.grokDesktop.respondComputerAppPermission(computerPermission.requestId, decision); } catch (error) { store.setError(errorMessage(error)); } finally { setComputerPermission(null); focusComposer(); } }} />}
      {computerRisk && <ComputerRiskDialog request={computerRisk} onRespond={async (approved) => { try { await window.grokDesktop.respondComputerRisk(computerRisk.requestId, approved); } catch (error) { store.setError(errorMessage(error)); } finally { setComputerRisk(null); focusComposer(); } }} />}
      {dialog && <ActionDialog dialog={dialog} onClose={closeDialog} />}
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
  onSearch(value: string): void;
  onNew(): void;
  onOpen(session: SessionSummary): void;
  onOpenCodex(session: CodexSessionSummary): void;
  onChooseWorkspace(): void;
  onRecent(cwd: string): void;
  onRename(session: SessionSummary): void;
  onDelete(session: SessionSummary): void;
  onPin(session: SessionSummary): void;
  onExport(session: SessionSummary): void;
  onHideCodex(session: CodexSessionSummary): void;
  onToggleCodex(collapsed: boolean): void;
  onToggleArchived(value: boolean): void;
  onPinWorkspace(workspace: WorkspaceSummary): void;
  onClear(): void;
  onPanel(panel: Panel): void;
}): React.JSX.Element {
  const [showRecent, setShowRecent] = useState(false);
  const activeAccount = useAppStore((state) => state.accounts.find((value) => value.active));
  return <aside className="sidebar">
    <div className="brand"><div className="brand-icon">G</div><strong>Grok Build</strong><button className="icon-button" title="新建会话" disabled={props.busy} onClick={props.onNew}>＋</button></div>
    <button className="workspace-button" onClick={() => setShowRecent(!showRecent)}><span>⌘</span><span className="workspace-name">{shortPath(props.settings?.activeWorkspace || "选择工作区")}</span><span>⌄</span></button>
    {showRecent && <WorkspaceMenu workspaces={props.workspaces} active={props.settings?.activeWorkspace || ""} onChoose={props.onChooseWorkspace} onSelect={(cwd) => { props.onRecent(cwd); setShowRecent(false); }} onPin={props.onPinWorkspace} onClear={props.onClear} />}
    <div className="search"><span>⌕</span><input id="session-search" value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder="搜索会话" /></div>
    <div className="session-list">
      <div className="session-group-heading"><strong>Grok 会话</strong><span>{props.sessions.length}</span></div>
      {props.sessions.map((session) => <div key={session.id} className={`session-row ${props.activeSessionId === session.id ? "active" : ""}`} onClick={() => props.onOpen(session)}><span className={`status-dot ${session.status}`} />{session.pinned && <span className="pin-mark">◆</span>}<div className="session-copy"><strong>{session.title}</strong><span>{relativeTime(session.updatedAt)} · {session.messageCount} 条消息</span></div><div className="session-actions"><button title={session.pinned ? "取消置顶" : "置顶"} onClick={(event) => { event.stopPropagation(); props.onPin(session); }}>◆</button><button title="导出 Markdown" onClick={(event) => { event.stopPropagation(); props.onExport(session); }}>⇩</button><button title="重命名" onClick={(event) => { event.stopPropagation(); props.onRename(session); }}>✎</button><button title="删除" onClick={(event) => { event.stopPropagation(); props.onDelete(session); }}>×</button></div></div>)}
      <button className="session-group-heading codex-toggle" onClick={() => props.onToggleCodex(!props.settings?.codexGroupCollapsed)}><strong>{props.settings?.codexGroupCollapsed ? "›" : "⌄"} Codex 会话</strong><span>{props.codexSessions.length}</span></button>
      {!props.settings?.codexGroupCollapsed && <><label className="archived-toggle"><input type="checkbox" checked={props.settings?.showArchivedCodex ?? false} onChange={(event) => props.onToggleArchived(event.target.checked)} />显示归档</label>{props.codexSessions.map((session) => <div key={session.id} className={`session-row codex ${props.activeCodexId === session.id ? "active" : ""}`} onClick={() => props.onOpenCodex(session)}><span className="codex-mark">C</span><div className="session-copy"><strong>{session.title}</strong><span>{relativeTime(session.updatedAt)}{session.archived ? " · 已归档" : ""}</span></div><div className="session-actions"><button title="从镜像列表隐藏" onClick={(event) => { event.stopPropagation(); props.onHideCodex(session); }}>×</button></div></div>)}</>}
    </div>
    <div className="sidebar-footer"><button onClick={() => props.onPanel("accounts")}><span className="avatar">{activeAccount?.label.slice(0, 1).toUpperCase() || "?"}</span><span>{activeAccount?.label || "登录账号"}</span></button><button className="icon-button" title="扩展中心" onClick={() => props.onPanel("extensions")}>▦</button><button className="icon-button" title="设置" onClick={() => props.onPanel("settings")}>⚙</button><button className="icon-button" title="关于" onClick={() => props.onPanel("about")}>ⓘ</button></div>
  </aside>;
}

function TopBar({ session, codex, workspace, view, busy, onPanel, onToggleSidebar }: { session?: SessionSummary; codex?: CodexSessionSummary; workspace: string; view: ReturnType<typeof useAppStore.getState>["views"][string] | undefined; busy: boolean; onPanel(panel: Panel): void; onToggleSidebar(): void }): React.JSX.Element {
  const activeAccount = useAppStore((state) => state.accounts.find((value) => value.active));
  return <header className="topbar"><button className="icon-button sidebar-toggle" title="显示或隐藏侧栏" onClick={onToggleSidebar}>☰</button><div><strong>{codex?.title || session?.title || "新会话"}</strong><span>{codex?.cwd || session?.cwd || workspace || "请选择工作区"}{codex ? " · Codex 只读镜像" : ""}</span></div><div className="top-actions"><button className="extensions-entry" onClick={() => onPanel("extensions")}>▦ 扩展</button><button className="media-entry" onClick={() => onPanel("media")}>✦ 创作</button><span className={`connection ${busy ? "working" : ""}`} />{activeAccount && <button className="account-pill" onClick={() => onPanel("accounts")}>{activeAccount.label}</button>}<button className="icon-button" onClick={() => onPanel("settings")}>⚙</button></div></header>;
}

function Composer(props: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  text: string;
  setText(value: string): void;
  busy: boolean;
  controlsDisabled: boolean;
  sessionId: string;
  attachments: ReturnType<typeof useAppStore.getState>["attachments"];
  commandMatches: Array<{ name: string; description?: string }>;
  fileMatches: WorkspaceFileCandidate[];
  view: ReturnType<typeof useAppStore.getState>["views"][string] | undefined;
  onSend(): void;
  onStop(): void;
  onAdd(): void;
  onPaste(files: File[]): void;
  onRemove(id: string): void;
  onCommand(name: string): void;
  onFile(file: WorkspaceFileCandidate): void;
  onFileMenu(): void;
  computerTarget: { app: ComputerApp; window: ComputerWindow } | null;
  computerTask: ComputerTaskState | null;
  onComputer(): void;
  onClearComputer(): void;
  onHistory(direction: -1 | 1): void;
  onControlSettled(): void;
}): React.JSX.Element {
  const [addOpen, setAddOpen] = useState(false);
  const composingRef = useRef(false);
  const tokenTotal = props.view?.meta.totalTokens ?? 0;
  const selectedModel = props.view?.models.find((value) => value.modelId === props.view?.currentModelId);
  const tokenWindow = selectedModel?.totalContextTokens ?? 512_000;
  const percent = Math.min(100, Math.round(tokenTotal / tokenWindow * 100));
  return <div className="composer-zone">{props.commandMatches.length > 0 && <div className="slash-menu">{props.commandMatches.map((command) => <button key={command.name} onClick={() => props.onCommand(command.name)}><strong>/{command.name.replace(/^\//, "")}</strong><span>{command.description}</span></button>)}</div>}{props.fileMatches.length > 0 && <div className="slash-menu file-menu">{props.fileMatches.map((file) => <button key={file.path} onClick={() => props.onFile(file)}><strong>@{file.name}</strong><span>{file.relativePath}</span></button>)}</div>}
    <div className="composer">{(props.attachments.length > 0 || props.computerTarget) && <div className="attachment-row">{props.computerTarget && <span className="computer-chip">◉ @Computer · {props.computerTarget.app.name}<small>{props.computerTask?.status === "paused" ? "已暂停" : props.computerTask?.status === "running" ? `运行中 · ${props.computerTask.stepCount} 步` : "已选择"}</small>{props.computerTask?.status === "running" && <button title="暂停" onClick={() => void window.grokDesktop.pauseComputer(props.computerTask!.sessionId)}>Ⅱ</button>}{props.computerTask?.status === "paused" && <button title="继续" onClick={() => void window.grokDesktop.resumeComputer(props.computerTask!.sessionId)}>▶</button>}<button title="停止并移除" onClick={props.onClearComputer}>×</button></span>}{props.attachments.map((attachment) => <span key={attachment.id}>{attachment.kind === "image" ? "▧" : "▤"} {attachment.name}<button onClick={() => props.onRemove(attachment.id)}>×</button></span>)}</div>}
      <textarea ref={props.inputRef} value={props.text} onChange={(event) => props.setText(event.target.value)} onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; }} onPaste={(event) => { const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/")); if (images.length) { event.preventDefault(); props.onPaste(images); } }} onKeyDown={(event) => { if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) { event.preventDefault(); props.onHistory(event.key === "ArrowUp" ? -1 : 1); } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !composingRef.current && event.nativeEvent.keyCode !== 229) { event.preventDefault(); if (!props.busy && !props.controlsDisabled) props.onSend(); } }} placeholder="给 Grok 发送消息…" />
      <div className="composer-toolbar"><div className="toolbar-left"><div className="add-menu-wrap"><button className="icon-button add-button" aria-expanded={addOpen} disabled={props.controlsDisabled} onClick={() => setAddOpen(!addOpen)}>＋</button>{addOpen && <div className="composer-add-menu"><button onClick={() => { setAddOpen(false); props.onFileMenu(); }}>@ 引用工作区文件</button><button onClick={() => { setAddOpen(false); props.onAdd(); }}>▤ 添加文件或图片</button><button onClick={() => { setAddOpen(false); props.onComputer(); }}>◉ 控制电脑 <small>实验性</small></button></div>}</div><TokenDonut percent={percent} label={`${formatTokens(tokenTotal)} / ${formatTokens(tokenWindow)}`} />{props.view && <ModelControls sessionId={props.sessionId} view={props.view} disabled={props.controlsDisabled} onSettled={props.onControlSettled} />}</div>{props.busy ? <button className="send-button stop" onClick={props.onStop}>■</button> : <button className="send-button" disabled={props.controlsDisabled || (!props.text.trim() && !props.attachments.length)} onClick={props.onSend}>↑</button>}</div>
    </div>
  </div>;
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

function ControlPanel({ type, onClose, confirmAction, onDiagnostics, onOnboarding }: { type: "settings" | "accounts" | "about"; onClose(): void; onDiagnostics(): void; onOnboarding(): void; confirmAction(message: string, options?: { title?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> }): React.JSX.Element {
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
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="control-panel" onMouseDown={(event) => event.stopPropagation()}><header><h2>{type === "accounts" ? "账号" : type === "settings" ? "设置" : "关于"}</h2><button onClick={onClose}>×</button></header>
    {type === "accounts" && <div className="panel-body"><div className="account-list">{store.accounts.map((account) => <div className={`account-row ${account.active ? "active" : ""}`} key={account.id}><span className="avatar">{account.label.slice(0, 1).toUpperCase()}</span><div><strong>{account.label}</strong><span>{account.email || (account.kind === "api-key" ? "API Key 配置档" : "OAuth 账号")}</span></div>{account.active ? <b>当前</b> : <button onClick={async () => { setSaving(true); try { store.setAccounts(await window.grokDesktop.switchAccount(account.id)); } catch (error) { store.setError(errorMessage(error)); } finally { setSaving(false); } }}>切换</button>}<button className="danger-link" onClick={async () => { if (await confirmAction("移除此账号配置？", { title: "移除账号", confirmLabel: "移除", danger: true })) store.setAccounts(await window.grokDesktop.removeAccount(account.id)); }}>移除</button></div>)}</div><QuotaPanel quota={quota} loading={quotaLoading} onRefresh={() => void refreshQuota(true)} /><div className="login-box"><h3>添加账号</h3><button className="primary full" disabled={store.login.running || saving} onClick={async () => { try { store.setLogin(await window.grokDesktop.loginDevice()); await refreshAccounts(); } catch (error) { store.setError(errorMessage(error)); } }}>使用浏览器/设备码登录</button>{store.login.message && <p>{store.login.message}</p>}{store.login.url && <div className="device-card"><code>{store.login.url}</code>{store.login.code && <strong>{store.login.code}</strong>}<div className="button-row"><button onClick={() => void navigator.clipboard.writeText(store.login.code || store.login.url!)}>复制</button><button onClick={() => void window.grokDesktop.openExternal(store.login.url!)}>重新打开浏览器</button></div></div>}<div className="separator"><span>或使用 API Key</span></div><input placeholder="配置名称" value={apiLabel} onChange={(event) => setApiLabel(event.target.value)} /><input type="password" placeholder="xAI API Key" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /><button disabled={!apiKey.trim()} onClick={async () => { try { store.setAccounts(await window.grokDesktop.loginApiKey(apiLabel, apiKey)); setApiKey(""); setApiLabel(""); } catch (error) { store.setError(errorMessage(error)); } }}>保存并验证 API Key</button></div>{store.accounts.some((value) => value.active) && <button className="danger full" onClick={async () => { if (await confirmAction("退出会清除当前凭据配置，继续吗？", { title: "退出账号", confirmLabel: "退出", danger: true })) { await window.grokDesktop.logout(); await refreshAccounts(); } }}>退出当前账号</button>}</div>}
    {type === "settings" && <div className="panel-body settings-form"><label>Grok CLI 路径<input value={settingsDraft.cliPath} placeholder="自动发现 %USERPROFILE%\\.grok\\bin\\grok.exe" onChange={(event) => setSettingsDraft({ ...settingsDraft, cliPath: event.target.value })} /></label><label>默认模型<input list="known-models" value={settingsDraft.defaultModel} placeholder="由 CLI 动态提供" onChange={(event) => setSettingsDraft({ ...settingsDraft, defaultModel: event.target.value })} /><datalist id="known-models">{knownModels.map((model) => <option key={model.modelId} value={model.modelId}>{model.name}</option>)}</datalist></label><label>新会话默认推理强度<select value={settingsDraft.defaultEffort} onChange={(event) => setSettingsDraft({ ...settingsDraft, defaultEffort: event.target.value as ReasoningEffort })}><option value="">CLI 默认</option>{["none", "minimal", "low", "medium", "high", "xhigh"].map((value) => <option key={value}>{value}</option>)}</select></label><label>默认模式<select value={settingsDraft.defaultMode} onChange={(event) => setSettingsDraft({ ...settingsDraft, defaultMode: event.target.value as SessionMode })}><option value="agent">Agent</option><option value="plan">Plan</option><option value="auto">自动批准</option></select></label><label>HTTP 代理<input value={settingsDraft.httpProxy} onChange={(event) => setSettingsDraft({ ...settingsDraft, httpProxy: event.target.value })} /></label><label>HTTPS 代理<input value={settingsDraft.httpsProxy} onChange={(event) => setSettingsDraft({ ...settingsDraft, httpsProxy: event.target.value })} /></label><label>文字大小 <strong>{settingsDraft.fontScale}%</strong><input type="range" min="85" max="130" step="5" value={settingsDraft.fontScale} onChange={(event) => setSettingsDraft({ ...settingsDraft, fontScale: Number(event.target.value) })} /><small>只调整文字；建议保持 100%。</small></label><label>界面密度<select value={settingsDraft.uiDensity} onChange={(event) => setSettingsDraft({ ...settingsDraft, uiDensity: event.target.value as AppSettings["uiDensity"] })}><option value="compact">紧凑（更多内容）</option><option value="balanced">标准（推荐）</option><option value="comfortable">宽松</option></select><small>独立调整侧栏、间距和输入区大小，不会缩小文字。</small></label><label className="check"><input type="checkbox" checked={settingsDraft.showThinking} onChange={(event) => setSettingsDraft({ ...settingsDraft, showThinking: event.target.checked })} />显示完整思考过程</label><label className="check"><input type="checkbox" checked={settingsDraft.expandToolDetails} onChange={(event) => setSettingsDraft({ ...settingsDraft, expandToolDetails: event.target.checked })} />默认展开工具详情和 Diff</label><button className="primary" onClick={async () => { const settings = await window.grokDesktop.updateSettings(settingsDraft); store.setSettings(settings); onClose(); }}>保存设置</button><button onClick={() => void window.grokDesktop.exportLogs()}>导出脱敏日志</button></div>}
    {type === "about" && <div className="panel-body about"><div className="about-logo">G</div><h3>Grok Build Desktop {store.appVersion}</h3><p>非官方社区客户端，与 xAI 无隶属关系。Grok CLI 与模型服务由 xAI 提供。</p><dl><dt>应用渠道</dt><dd>{store.buildInfo?.channel || "stable"}</dd><dt>构建提交</dt><dd>{store.buildInfo?.commit || "未知"}</dd><dt>CLI</dt><dd>{store.cli?.currentVersion || "未知"}</dd><dt>CLI 渠道</dt><dd>{store.cli?.channel || "未知"}</dd></dl><h4>应用更新</h4><p>{store.appRelease?.error || (store.appRelease?.updateAvailable ? `发现 ${store.appRelease.latestVersion}，请在 GitHub Release 下载并手动核对 SHA-256。` : store.appRelease ? "当前已是最新稳定版。" : "尚未检查。")}</p><div className="button-row"><button onClick={async () => store.setAppRelease(await window.grokDesktop.checkAppUpdate(true))}>检查应用更新</button>{store.appRelease?.releaseUrl && <button className="primary" onClick={() => window.grokDesktop.openAppRelease(store.appRelease?.releaseUrl)}>打开 GitHub Release</button>}</div><div className="button-row"><button onClick={onDiagnostics}>兼容诊断中心</button><button onClick={onOnboarding}>重新运行首次设置</button></div><h4>Grok CLI 更新</h4><div className="button-row"><button onClick={async () => store.setCli(await window.grokDesktop.checkCliUpdate())}>检查 CLI 更新</button>{store.cli?.updateAvailable && <button className="primary" onClick={async () => { if (!await confirmAction("更新会停止所有实时会话，继续吗？", { title: "更新 Grok CLI", confirmLabel: "更新并验证" })) return; try { store.setCli(await window.grokDesktop.applyCliUpdate()); store.setUpdateHistory(await window.grokDesktop.getCliUpdateHistory()); } catch (error) { store.setError(errorMessage(error)); } }}>更新并验证</button>}</div><h4>CLI 更新历史</h4><div className="history-list">{store.updateHistory.slice(0, 10).map((record, index) => <div key={`${record.at}-${index}`}><strong>{record.status}</strong><span>{new Date(record.at).toLocaleString()}</span><p>{record.message}</p></div>)}</div><h4>应用更新日志</h4><pre className="changelog">{store.changelog}</pre></div>}
  </section></div>;
}

function WorkspaceMenu({ workspaces, active, onChoose, onSelect, onPin, onClear }: { workspaces: WorkspaceSummary[]; active: string; onChoose(): void; onSelect(cwd: string): void; onPin(workspace: WorkspaceSummary): void; onClear(): void }): React.JSX.Element {
  const groups: Array<{ source: WorkspaceSummary["sources"][number]; label: string }> = [{ source: "pinned", label: "置顶" }, { source: "recent", label: "最近" }, { source: "grok", label: "已有 Grok 历史" }, { source: "codex", label: "已有 Codex 项目" }];
  const seen = new Set<string>();
  return <div className="workspace-menu"><button onClick={onChoose}>选择其他文件夹…</button>{groups.map((group) => {
    const rows = workspaces.filter((row) => row.sources.includes(group.source) && !seen.has(row.cwd.toLocaleLowerCase()));
    rows.forEach((row) => seen.add(row.cwd.toLocaleLowerCase()));
    return rows.length ? <div className="workspace-group" key={group.source}><strong>{group.label}</strong>{rows.map((workspace) => <div className={`workspace-row ${workspace.cwd.toLocaleLowerCase() === active.toLocaleLowerCase() ? "active" : ""}`} key={workspace.cwd}><button disabled={!workspace.exists} title={workspace.exists ? workspace.cwd : "路径已失效"} onClick={() => onSelect(workspace.cwd)}><span>{workspace.name}</span><small>{workspace.exists ? `${workspace.grokSessions} Grok · ${workspace.codexSessions} Codex` : "路径已失效"}</small></button><button title={workspace.pinned ? "取消置顶" : "置顶"} onClick={() => onPin(workspace)}>◆</button></div>)}</div> : null;
  })}{active && <button className="danger-link" onClick={onClear}>清空当前工作区会话…</button>}</div>;
}

function WorkspaceEmptyState({ workspaces, onNew, onOpen }: { workspaces: WorkspaceSummary[]; onNew(): void; onOpen(cwd: string): void }): React.JSX.Element {
  return <div className="workspace-empty"><div className="empty-logo">G</div><h2>开始使用 Grok Build</h2><p>新建会话，或打开自动发现的项目。</p><button className="primary" onClick={onNew}>新建会话</button>{workspaces.length > 0 && <div className="discovered-workspaces"><h3>已有项目</h3>{workspaces.slice(0, 8).map((workspace) => <button key={workspace.cwd} disabled={!workspace.exists} onClick={() => onOpen(workspace.cwd)}><strong>{workspace.name}</strong><span>{workspace.exists ? `${workspace.grokSessions} Grok · ${workspace.codexSessions} Codex` : "路径已失效"}</span><small>{workspace.cwd}</small></button>)}</div>}</div>;
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

function ComputerPickerPanel({ sessionId, onSelect, onClose }: { sessionId: string; onSelect(app: ComputerApp, window: ComputerWindow): void; onClose(): void }): React.JSX.Element {
  const [apps, setApps] = useState<ComputerApp[]>([]);
  const [windows, setWindows] = useState<ComputerWindow[]>([]);
  const [selectedApp, setSelectedApp] = useState<ComputerApp | null>(null);
  const [selectedWindow, setSelectedWindow] = useState<ComputerWindow | null>(null);
  const [status, setStatus] = useState("正在检测 Computer Use…");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void Promise.all([window.grokDesktop.getComputerCapability(), window.grokDesktop.getComputerSettings(), window.grokDesktop.listComputerApps()]).then(([capability, settings, values]) => {
    if (!capability.available) setStatus(capability.diagnostics.join("；") || "Windows Harness 不可用");
    else if (!settings.enabled) setStatus("Computer Use 已关闭；可在“扩展 → Computer Use”中重新启用。");
    else { setApps(values); setStatus(values.length ? "选择要控制的前台应用" : "没有发现可见应用窗口"); }
  }).catch((error) => setStatus(errorMessage(error))); }, []);
  const chooseApp = async (app: ComputerApp): Promise<void> => { setSelectedApp(app); setSelectedWindow(null); const values = await window.grokDesktop.listComputerWindows(app.id); setWindows(values); if (values.filter((value) => value.controllable).length === 1) setSelectedWindow(values.find((value) => value.controllable) || null); };
  const start = async (): Promise<void> => { if (!selectedApp || !selectedWindow || busy) return; setBusy(true); try { await window.grokDesktop.startComputer({ sessionId, appId: selectedApp.id, windowId: selectedWindow.id }); onSelect(selectedApp, selectedWindow); } catch (error) { setStatus(errorMessage(error)); } finally { setBusy(false); } };
  return <div className="modal-backdrop" role="presentation" onMouseDown={() => !busy && onClose()}><section className="control-panel computer-picker" role="dialog" aria-modal="true" aria-labelledby="computer-picker-title" onMouseDown={(event) => event.stopPropagation()}><header><div><h2 id="computer-picker-title">控制电脑</h2><small>Windows 当前前台桌面 · 每次只控制一个精确窗口</small></div><button disabled={busy} onClick={onClose}>×</button></header><div className="panel-body"><p className="computer-picker-status">{status}</p><div className="computer-picker-grid"><div><h3>应用</h3>{apps.map((app) => <button className={selectedApp?.id === app.id ? "active" : ""} disabled={!app.controllable} title={app.blockedReason} key={app.id} onClick={() => void chooseApp(app)}><strong>{app.name}</strong><small>{app.windowCount} 个窗口{app.blockedReason ? ` · ${app.blockedReason}` : ""}</small></button>)}</div><div><h3>窗口</h3>{selectedApp && !windows.length && <p>没有可见窗口</p>}{windows.map((value) => <button className={selectedWindow?.id === value.id ? "active" : ""} disabled={!value.controllable} title={value.blockedReason} key={value.id} onClick={() => setSelectedWindow(value)}><strong>{value.title}</strong><small>{value.bounds.width}×{value.bounds.height} · {value.dpi} DPI{value.minimized ? " · 已最小化" : ""}</small></button>)}</div></div><div className="computer-picker-note">普通应用默认直接可用。进入后目标显示器会出现蓝色边框、鼠标会真实移动，顶部持续说明当前动作；按 Esc 随时停止。删除、发送、交易、安装、权限与敏感数据操作仍会逐次确认。UAC/Windows 安全需手动完成，之后可点“继续”。</div><div className="button-row computer-picker-actions"><button disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy || !selectedWindow} onClick={() => void start()}>{busy ? "正在连接…" : "选择此窗口"}</button></div></div></section></div>;
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
  useEffect(() => {
    (dialog.input ? inputRef.current : confirmRef.current)?.focus();
    const onKey = (event: KeyboardEvent): void => { if (event.key === "Escape") onClose(dialog.input ? null : false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const confirm = (): void => onClose(dialog.input ? value : true);
  return <div className="modal-backdrop action-dialog-backdrop" role="presentation" onMouseDown={() => onClose(dialog.input ? null : false)}><section className="action-dialog" role="dialog" aria-modal="true" aria-labelledby="action-dialog-title" onMouseDown={(event) => event.stopPropagation()}><h2 id="action-dialog-title">{dialog.title}</h2><p>{dialog.message}</p>{dialog.input && <input ref={inputRef} value={value} placeholder={dialog.input.placeholder} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && value.trim()) confirm(); }} />}<div className="button-row"><button onClick={() => onClose(dialog.input ? null : false)}>取消</button><button ref={confirmRef} className={dialog.danger ? "danger" : "primary"} disabled={!!dialog.input && !value.trim()} onClick={confirm}>{dialog.confirmLabel || "确定"}</button></div></section></div>;
}

function EmptyState({ title, text, action, onAction }: { title: string; text: string; action: string; onAction(): void }): React.JSX.Element { return <div className="empty-state"><div className="empty-logo">G</div><h2>{title}</h2><p>{text}</p><button className="primary" onClick={onAction}>{action}</button></div>; }
function errorMessage(value: unknown): string { return value instanceof Error ? value.message : String(value); }
function shortPath(value: string): string { const parts = value.split(/[\\/]/).filter(Boolean); return parts.at(-1) || value; }
function relativeTime(value: string): string { const time = Date.parse(value); if (!Number.isFinite(time)) return "未知时间"; const delta = Date.now() - time; if (delta < 60_000) return "刚刚"; if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`; if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`; return `${Math.floor(delta / 86_400_000)} 天前`; }
function formatTokens(value: number): string { return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${Math.round(value / 1_000)}K` : String(value); }

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
