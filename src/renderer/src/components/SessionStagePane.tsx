import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  ArrowUpRight,
  Eraser,
  LoaderCircle,
  MessageSquare,
  Plus,
  Send,
  Square,
  SquareTerminal,
  X,
  Zap,
} from "lucide-react";
import type {
  Attachment,
  ModelInfo,
  NavigationIntent,
  ReasoningEffort,
  SessionMode,
  TurnFailure,
} from "../../../shared/types";
import type { WorkspaceTerminal, WorkspaceTerminalEvent } from "../../../shared/workspace-tools";
import { errorMessage } from "../error-message";
import { useGitStore } from "../git-store";
import { useSessionDraft } from "../hooks/use-session-draft";
import { effortControlState } from "../model-capabilities";
import { SESSION_MODE_OPTIONS } from "../session-mode-labels";
import { buildChatTurns, reduceEvent, useAppStore, type UiMessage } from "../store";
import { getActiveTerminalTheme } from "../theme";
import { useWorkbenchStore } from "../workbench-store";
import type { ContentTarget, PaneSurfaceMode } from "../workspace-layout";
import { AutomationConfirmations } from "./AutomationConfirmations";
import { PaneReader } from "./PaneReader";
import { PromptQueueStack } from "./PromptQueueStack";
import { TurnCard } from "./TurnCard";
import "../styles/thread-stage.css";

const LazyFailureDiagnosisPanel = lazy(() =>
  import("./FailureDiagnosisPanel").then((m) => ({ default: m.FailureDiagnosisPanel })),
);

export { PromptQueueStack };

export interface SessionStagePaneProps {
  paneId: string;
  paneIndex?: number;
  target?: ContentTarget;
  surfaceMode?: PaneSurfaceMode;
  onToggleSurfaceMode?(): void;
  onActivate(): void;
  onError(message: string): void;
}

export function semanticSessionStatus(
  status?: string,
  compacting?: boolean,
): "working" | "needs-user" | "error" | "unread" | "queued" | "idle" {
  if (status === "needs-user") return "needs-user";
  if (status === "error") return "error";
  if (status === "working" || compacting) return "working";
  if (status === "unread") return "unread";
  if (status === "queued") return "queued";
  return "idle";
}

function panePtyStorageKey(paneId: string, workspace: string): string {
  return `grok.pane-pty.v1:${paneId}:${workspace.replace(/[\\/]+$/, "").toLowerCase()}`;
}

export function InPanePtySurface({
  paneId,
  workspace,
  onFlipToChat,
  onError,
}: {
  paneId: string;
  workspace: string;
  onFlipToChat?(): void;
  onError(message: string): void;
}): React.JSX.Element {
  const [terminals, setTerminals] = useState<WorkspaceTerminal[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const generationRef = useRef(0);
  const initialSnapshotsRef = useRef<Map<string, WorkspaceTerminal>>(new Map());
  const themeSettings = useAppStore((s) => s.settings?.theme);

  const rememberId = useCallback(
    (id: string) => {
      setActiveId(id);
      if (id && workspace) {
        try {
          sessionStorage.setItem(panePtyStorageKey(paneId, workspace), id);
        } catch {
          // Ignore storage unavailability
        }
      }
    },
    [paneId, workspace],
  );

  useEffect(() => {
    const gen = ++generationRef.current;
    if (!workspace) {
      setTerminals([]);
      setActiveId("");
      return;
    }
    let disposed = false;
    void (async () => {
      try {
        let rows = await window.grokDesktop.listWorkspaceTerminals(workspace);
        if (disposed || gen !== generationRef.current) return;
        if (rows.length === 0) {
          setBusy(true);
          const created = await window.grokDesktop.createWorkspaceTerminal(workspace);
          if (disposed || gen !== generationRef.current) return;
          rows = [created];
        }
        initialSnapshotsRef.current = new Map(rows.map((r) => [r.id, r]));
        setTerminals(rows);
        let preferred = "";
        try {
          preferred = sessionStorage.getItem(panePtyStorageKey(paneId, workspace)) || "";
        } catch {
          preferred = "";
        }
        const chosen = rows.find((r) => r.id === preferred)?.id ?? rows[0]?.id ?? "";
        rememberId(chosen);
      } catch (err) {
        if (!disposed && gen === generationRef.current) onError(errorMessage(err));
      } finally {
        if (!disposed && gen === generationRef.current) setBusy(false);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [onError, paneId, rememberId, workspace]);

  useEffect(() => {
    return window.grokDesktop.onWorkspaceTerminal((event) => {
      if (event.exitCode !== undefined) {
        setTerminals((rows) =>
          rows.map((t) => (t.id === event.id ? { ...t, status: "exited", exitCode: event.exitCode } : t)),
        );
      }
    });
  }, []);

  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = getActiveTerminalTheme(themeSettings);
    }
  }, [themeSettings]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !activeId || !workspace) return;
    let disposed = false;
    let ready = false;
    let sequence = 0;
    const pending: WorkspaceTerminalEvent[] = [];

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, "Microsoft YaHei UI", monospace',
      fontSize: 12.5,
      scrollback: 5000,
      theme: getActiveTerminalTheme(useAppStore.getState().settings?.theme),
    });
    termRef.current = terminal;
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminal.focus();

    const syncTheme = (): void => {
      terminal.options.theme = getActiveTerminalTheme();
    };
    document.documentElement.addEventListener("grok-theme-change", syncTheme);

    let resizeRaf = 0;
    const resize = (): void => {
      if (disposed || !host || host.clientWidth < 12 || host.clientHeight < 12) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      if (ready) {
        void window.grokDesktop
          .resizeWorkspaceTerminal(
            activeId,
            Math.max(2, Math.min(500, terminal.cols)),
            Math.max(2, Math.min(300, terminal.rows)),
          )
          .catch(() => undefined);
      }
    };
    const scheduleResize = (): void => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(resize);
    };

    const applyEvent = (event: WorkspaceTerminalEvent): void => {
      if (event.id !== activeId || disposed) return;
      if (!ready) {
        pending.push(event);
        return;
      }
      if (event.sequence <= sequence) return;
      sequence = event.sequence;
      if (event.exitCode !== undefined) terminal.options.disableStdin = true;
      terminal.write(event.data);
    };

    const hydrateSnapshot = (snapshot: WorkspaceTerminal | undefined): void => {
      if (disposed || !snapshot) return;
      terminal.options.disableStdin = snapshot.status === "exited";
      if (snapshot.output) terminal.write(snapshot.output);
      sequence = snapshot.sequence;
      ready = true;
      pending.splice(0).forEach(applyEvent);
      resize();
    };

    const offTerminal = window.grokDesktop.onWorkspaceTerminal(applyEvent);
    const cachedSnapshot = initialSnapshotsRef.current.get(activeId);
    if (cachedSnapshot) {
      initialSnapshotsRef.current.delete(activeId);
      hydrateSnapshot(cachedSnapshot);
    } else {
      void window.grokDesktop
        .listWorkspaceTerminals(workspace)
        .then((rows) => {
          hydrateSnapshot(rows.find((r) => r.id === activeId));
        })
        .catch((err) => {
          if (!disposed) onError(errorMessage(err));
        });
    }

    const inputSub = terminal.onData((data) => {
      void window.grokDesktop.writeWorkspaceTerminal(activeId, data).catch((err) => onError(errorMessage(err)));
    });

    const observer = new ResizeObserver(scheduleResize);
    observer.observe(host);
    resize();

    return () => {
      disposed = true;
      cancelAnimationFrame(resizeRaf);
      termRef.current = null;
      document.documentElement.removeEventListener("grok-theme-change", syncTheme);
      offTerminal();
      inputSub.dispose();
      observer.disconnect();
      terminal.dispose();
    };
  }, [activeId, onError, workspace]);

  const createNewShell = async (): Promise<void> => {
    if (!workspace || busy) return;
    setBusy(true);
    try {
      const created = await window.grokDesktop.createWorkspaceTerminal(workspace);
      initialSnapshotsRef.current.set(created.id, created);
      setTerminals((rows) => [...rows, created]);
      rememberId(created.id);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const closeShell = async (id: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await window.grokDesktop.closeWorkspaceTerminal(id).catch(() => undefined);
      initialSnapshotsRef.current.delete(id);
      const remaining = terminals.filter((t) => t.id !== id);
      if (remaining.length === 0 && workspace) {
        const replacement = await window.grokDesktop.createWorkspaceTerminal(workspace);
        initialSnapshotsRef.current.set(replacement.id, replacement);
        setTerminals([replacement]);
        rememberId(replacement.id);
      } else {
        setTerminals(remaining);
        if (activeId === id) rememberId(remaining[0]?.id ?? "");
      }
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const folderName = workspace.split(/[\\/]/).filter(Boolean).at(-1) || workspace;

  return (
    <section className="in-pane-pty" aria-label={`窗格终端：${folderName}`}>
      <header className="in-pane-pty-bar">
        <div className="in-pane-pty-tabs">
          <SquareTerminal size={13} style={{ color: "var(--color-accent)", flex: "none" }} />
          <small title={workspace} className="in-pane-pty-cwd">
            {folderName}
          </small>
          {terminals.map((tab, idx) => (
            <span
              key={tab.id}
              className={`in-pane-pty-tab${tab.id === activeId ? " active" : ""}`}
              style={{ display: "inline-flex", alignItems: "center", gap: 3, paddingRight: 3 }}
            >
              <button
                type="button"
                style={{ border: 0, background: "transparent", color: "inherit", font: "inherit", padding: "0 2px", cursor: "pointer" }}
                onClick={() => rememberId(tab.id)}
              >
                Shell {idx + 1}
                {tab.status === "exited" ? ` (${tab.exitCode ?? 0})` : ""}
              </button>
              <button
                type="button"
                aria-label={`关闭 Shell ${idx + 1}`}
                title="关闭此终端"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  void closeShell(tab.id);
                }}
                style={{ border: 0, background: "transparent", color: "inherit", opacity: 0.7, padding: 1, display: "inline-grid", placeItems: "center", cursor: "pointer" }}
              >
                <X size={10} />
              </button>
            </span>
          ))}
          <button
            type="button"
            className="ui-icon-btn ui-icon-btn-sm"
            style={{ width: 20, height: 20 }}
            disabled={busy || !workspace}
            title="在此工作区新建终端"
            aria-label="新建窗格终端"
            onClick={() => void createNewShell()}
          >
            <Plus size={12} />
          </button>
        </div>

        <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <button
            type="button"
            className="ui-icon-btn ui-icon-btn-sm"
            style={{ width: 22, height: 22 }}
            title="清屏"
            aria-label="清空终端屏幕"
            onClick={() => termRef.current?.clear()}
          >
            <Eraser size={12} />
          </button>
          {onFlipToChat && (
            <button
              type="button"
              className="ui-btn ui-btn-ghost ui-btn-sm"
              style={{ height: 22, padding: "0 7px", fontSize: "var(--text-xs)" }}
              onClick={onFlipToChat}
              title="翻转回会话视图 (Ctrl+`)"
            >
              <MessageSquare size={12} />
              <span>返回对话</span>
            </button>
          )}
        </div>
      </header>

      {!workspace ? (
        <div className="empty-copy">
          <p>此窗格尚未绑定工作区路径。</p>
        </div>
      ) : (
        <div ref={hostRef} className="in-pane-pty-surface" />
      )}
    </section>
  );
}

export const SessionStagePane = memo(function SessionStagePane({
  paneId,
  paneIndex,
  target,
  surfaceMode = "chat",
  onToggleSurfaceMode,
  onActivate,
  onError,
}: SessionStagePaneProps): React.JSX.Element {
  const sessionId = target?.kind === "session" ? target.id : "";
  const isForeign = sessionId.startsWith("codex:") || sessionId.startsWith("claude:");

  const view = useAppStore((state) => (sessionId && !isForeign ? state.views[sessionId] : undefined));
  const summary = useAppStore((state) => state.sessions.find((item) => item.id === sessionId));
  const showThinking = useAppStore((state) => state.settings?.showThinking ?? false);
  const expandTools = useAppStore((state) => state.settings?.expandToolDetails ?? false);
  const resolveMessage = useAppStore((state) => state.resolveMessage);
  const handleEvent = useAppStore((state) => state.handleEvent);

  const [fallbackMessages, setFallbackMessages] = useState<UiMessage[]>([]);
  const [hydrating, setHydrating] = useState(false);
  const [sending, setSending] = useState(false);
  const [switchingControl, setSwitchingControl] = useState<"" | "model" | "effort" | "mode">("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [fallbackCatalog, setFallbackCatalog] = useState<ModelInfo[]>([]);
  const [diagnosingFailure, setDiagnosingFailure] = useState<TurnFailure>();

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const sendingSet = useMemo(() => (sending && sessionId ? new Set([sessionId]) : new Set<string>()), [sending, sessionId]);

  const clearAttachments = useCallback(() => setAttachments([]), []);
  const addAttachments = useCallback((values: Attachment[]) => {
    setAttachments((prev) => [
      ...prev,
      ...values.filter((v) => !prev.some((p) => p.path && p.path === v.path)),
    ]);
  }, []);
  const resetTransients = useCallback(() => {
    setDiagnosingFailure(undefined);
  }, []);
  const reportDraftError = useCallback(
    (err: unknown) => onError(`保存分屏草稿失败：${errorMessage(err)}`),
    [onError],
  );

  const {
    composer,
    setComposer,
    capability,
    beginDraftSubmission,
    clearClaimedDraft,
    shouldRestoreClaimedDraft,
    endDraftSubmission,
  } = useSessionDraft({
    activeSessionId: !isForeign ? sessionId : "",
    workspace: target?.workspace || "",
    foreignSessionOpen: isForeign,
    sendingSessionIds: sendingSet,
    attachments,
    clearAttachments,
    addAttachments,
    onSessionChange: resetTransients,
    onError: reportDraftError,
  });

  useEffect(() => {
    if (view?.models.length) return;
    let cancelled = false;
    void window.grokDesktop
      .listModelCatalog(false)
      .then((models) => {
        if (!cancelled && models.length) setFallbackCatalog(models);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [Boolean(view?.models.length)]);

  useEffect(() => {
    setFallbackMessages([]);
    if (!sessionId || isForeign || !target?.workspace || view?.messages.length) return;
    let cancelled = false;
    setHydrating(true);
    void window.grokDesktop
      .previewSession(target.workspace, sessionId)
      .then((preview) => {
        if (cancelled || !preview) return;
        if (preview.projection) {
          handleEvent({
            type: "conversation-projection-restore",
            sessionId,
            projection: preview.projection,
            live: preview.live,
          });
        } else {
          return window.grokDesktop.inspectSession(target.workspace, sessionId).then((proj) => {
            if (cancelled || !proj) return;
            const reduced = reduceEvent(
              { ...useAppStore.getState(), views: {} },
              { type: "conversation-projection-restore", sessionId, projection: proj },
            );
            setFallbackMessages(reduced.views?.[sessionId]?.messages ?? []);
          });
        }
        if (preview.presentations?.length) {
          handleEvent({
            type: "turn-presentations-restore",
            sessionId,
            presentations: preview.presentations,
          });
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setHydrating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [handleEvent, isForeign, sessionId, target?.workspace, Boolean(view?.messages.length)]);

  const messages = view?.messages.length ? view.messages : fallbackMessages;
  const turns = useMemo(
    () => buildChatTurns(messages, view?.status, view?.turnPresentations),
    [messages, view?.status, view?.turnPresentations],
  );

  const availableModels = view?.models.length ? view.models : fallbackCatalog;
  const currentModelId = view?.currentModelId || summary?.modelId || availableModels[0]?.modelId || "";
  const currentEffort = (view?.effort ?? (summary?.effort as ReasoningEffort | undefined) ?? "") as ReasoningEffort;
  const currentMode: SessionMode = view?.mode ?? "agent";
  const effortState = useMemo(
    () => effortControlState(availableModels, currentModelId, currentEffort),
    [availableModels, currentEffort, currentModelId],
  );

  useEffect(() => {
    if (view?.status === "error" && sending) {
      setSending(false);
    }
  }, [sending, view?.status]);

  if (surfaceMode === "pty" && target?.workspace) {
    return (
      <InPanePtySurface
        paneId={paneId}
        workspace={target.workspace}
        onFlipToChat={onToggleSurfaceMode}
        onError={onError}
      />
    );
  }

  if (!target || target.kind !== "session" || isForeign) {
    return <PaneReader paneId={paneId} target={target} onActivate={onActivate} />;
  }

  const semanticStatus = semanticSessionStatus(view?.status || summary?.status, view?.compacting);
  const isBusy = view?.status === "working" || view?.compacting === true;
  const isWaiting = view?.status === "needs-user";
  const modelLocked = Boolean(view?.modelSelectionRequired);

  const ensureSessionReady = async (): Promise<void> => {
    if (!view || view.hydration !== "ready") {
      await window.grokDesktop.openSession(target.workspace, sessionId);
    }
  };

  const sendInline = async (delivery: "normal" | "queue" | "interject" = "normal"): Promise<void> => {
    const trimmed = composer.trim();
    if ((!trimmed && !attachments.length) || sending || isWaiting || modelLocked) return;
    const claimId = beginDraftSubmission();
    const draftSubmissionId = crypto.randomUUID();
    const submittedAttachments = [...attachments];
    const submittedCapability = capability;
    setSending(true);
    try {
      await window.grokDesktop.setDraft(
        sessionId,
        trimmed,
        submittedCapability,
        submittedAttachments,
        undefined,
        draftSubmissionId,
      );
      await ensureSessionReady();
      clearClaimedDraft(claimId);
      const clientMessageId = crypto.randomUUID();
      const toolSelection = submittedCapability?.kind === "mcp" ? submittedCapability.selection : undefined;

      if (delivery === "interject" && isBusy) {
        await window.grokDesktop.interjectPrompt(
          sessionId,
          trimmed,
          submittedAttachments,
          clientMessageId,
          sessionId,
          draftSubmissionId,
          toolSelection,
        );
      } else if (isBusy || delivery === "queue") {
        await window.grokDesktop.enqueuePrompt(
          sessionId,
          trimmed,
          submittedAttachments,
          clientMessageId,
          sessionId,
          draftSubmissionId,
          toolSelection,
        );
      } else {
        await window.grokDesktop.sendPrompt({
          sessionId,
          text: trimmed,
          attachments: submittedAttachments,
          clientMessageId,
          draftKey: sessionId,
          draftSubmissionId,
          toolSelection,
        });
      }
    } catch (err) {
      if (shouldRestoreClaimedDraft(claimId)) {
        setComposer(trimmed);
        addAttachments(submittedAttachments);
      }
      onError(errorMessage(err));
    } finally {
      endDraftSubmission(claimId);
      setSending(false);
    }
  };

  const stopInline = async (): Promise<void> => {
    try {
      await window.grokDesktop.cancelSession(sessionId);
    } catch (err) {
      onError(errorMessage(err));
    }
  };

  const changeRuntimeControl = async (
    kind: "model" | "effort" | "mode",
    action: () => Promise<void>,
  ): Promise<void> => {
    if (switchingControl) return;
    setSwitchingControl(kind);
    try {
      await ensureSessionReady();
      await action();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setSwitchingControl("");
    }
  };

  const handleStageNavigate = async (intent: NavigationIntent): Promise<void> => {
    const root = intent.executionRoot || target.workspace;
    try {
      if (intent.surface === "editor") {
        const opened = await window.grokDesktop.openEditorDocument(root, intent.targetPath);
        if (opened.kind === "external") {
          await window.grokDesktop.openPath(opened.path);
          return;
        }
        if (opened.document) {
          useWorkbenchStore.getState().openDocument(opened.document);
          const fileTarget: ContentTarget = {
            kind: "file",
            workspace: opened.document.workspacePath,
            id: `${opened.document.workspacePath}\0${opened.document.relativePath}`,
            title: opened.document.relativePath,
          };
          window.dispatchEvent(new CustomEvent("grok:open-in-split", { detail: fileTarget }));
        }
        return;
      }
      useGitStore.getState().setSelection({ path: intent.targetPath, staged: false });
      const reviewTarget: ContentTarget = {
        kind: "review",
        workspace: root,
        id: JSON.stringify({ path: intent.targetPath, staged: false }),
        title: intent.targetPath,
      };
      window.dispatchEvent(new CustomEvent("grok:open-in-split", { detail: reviewTarget }));
    } catch (err) {
      onError(errorMessage(err));
    }
  };

  const handleStageFork = async (): Promise<void> => {
    try {
      const forked = await window.grokDesktop.forkSession(sessionId, undefined, {
        workspacePath: target.workspace,
      });
      const updated = await window.grokDesktop.listSessions(forked.cwd);
      useAppStore.getState().setSessions(updated);
      const forkedSummary = updated.find((s) => s.id === forked.sessionId);
      window.dispatchEvent(
        new CustomEvent<ContentTarget>("grok:open-in-split", {
          detail: {
            kind: "session",
            workspace: forked.cwd,
            id: forked.sessionId,
            title: forkedSummary?.title || "分叉会话",
          },
        }),
      );
    } catch (err) {
      onError(errorMessage(err));
    }
  };

  const folderName = target.workspace.split(/[\\/]/).filter(Boolean).at(-1) || target.workspace;

  return (
    <section
      className={`thread-stage cmux-stage-${semanticStatus}`}
      aria-label={`并排会话：${summary?.title || target.title}`}
    >
      <header className="thread-stage-header">
        <div className="thread-stage-meta">
          {paneIndex !== undefined && (
            <span className="stage-pane-index" title={`Alt+${paneIndex + 1} 聚焦此窗格`}>
              {paneIndex + 1}
            </span>
          )}
          <span className={`status-dot ${semanticStatus}`} aria-hidden="true" />
          <strong title={summary?.title || target.title}>{summary?.title || target.title}</strong>
          <small title={target.workspace}>{folderName}</small>
          {semanticStatus === "needs-user" && (
            <span className="ui-badge ui-badge-warning" style={{ height: 18, padding: "0 5px" }}>
              待确认
            </span>
          )}
        </div>

        <div style={{ display: "inline-flex", alignItems: "center", gap: 4, flex: "none" }}>
          {onToggleSurfaceMode && (
            <button
              type="button"
              className="ui-icon-btn ui-icon-btn-sm"
              style={{ width: 24, height: 24 }}
              onClick={onToggleSurfaceMode}
              title={`切换窗格内终端 (Ctrl+\`) · ${folderName}`}
              aria-label="切换窗格内终端"
            >
              <SquareTerminal size={13} />
            </button>
          )}
          <button
            type="button"
            className="ui-btn ui-btn-ghost ui-btn-sm"
            onClick={onActivate}
            title="切换为主焦点窗格"
          >
            <ArrowUpRight size={13} />
            <span>设为主窗格</span>
          </button>
        </div>
      </header>

      <AutomationConfirmations sessionId={sessionId} onError={onError} />

      {view?.modelSelectionRequired && (
        <div className="stage-model-gate" role="status">
          {view.modelSelectionRequired}
        </div>
      )}

      <div className="thread-stage-body">
        {hydrating && turns.length === 0 ? (
          <div className="empty-copy">
            <p>正在同步会话内容…</p>
          </div>
        ) : turns.length === 0 ? (
          <div className="empty-copy">
            <p>尚无消息记录，可直接在下方发送指令。</p>
          </div>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            className="conversation thread-stage-conversation"
            data={turns}
            computeItemKey={(_index, turn) => turn.id}
            followOutput="auto"
            itemContent={(_index, turn) => (
              <TurnCard
                turn={turn}
                sessionId={sessionId}
                navigationRoot={target.workspace}
                showThinking={showThinking}
                expandTools={expandTools}
                onResolved={(id) => resolveMessage(sessionId, id)}
                onDiagnose={(failure) => setDiagnosingFailure(failure)}
                onRetry={(msg) => {
                  setComposer(msg.text);
                  composerRef.current?.focus();
                }}
                onNavigate={(intent) => void handleStageNavigate(intent)}
                onOpenReview={onActivate}
                onFork={() => void handleStageFork()}
              />
            )}
          />
        )}
      </div>

      {diagnosingFailure &&
        typeof document !== "undefined" &&
        document.getElementById("overlay-root") &&
        createPortal(
          <Suspense fallback={null}>
            <LazyFailureDiagnosisPanel
              failure={diagnosingFailure}
              onClose={() => setDiagnosingFailure(undefined)}
            />
          </Suspense>,
          document.getElementById("overlay-root")!,
        )}

      <PromptQueueStack sessionId={sessionId} entries={view?.queue ?? []} compact />

      <footer className="thread-stage-composer">
        <textarea
          ref={composerRef}
          rows={1}
          className="stage-composer-textarea"
          value={composer}
          placeholder={
            isWaiting
              ? "请先处理上方确认卡片…"
              : isBusy
                ? "Enter 加入队列，Ctrl+Enter 插话，Shift+Enter 换行…"
                : "向此分屏会话发送消息（Shift+Enter 换行）…"
          }
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onChange={(e) => setComposer(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || composingRef.current || e.nativeEvent.keyCode === 229) return;
            if (e.key === "Enter" && e.ctrlKey && !e.shiftKey) {
              e.preventDefault();
              void sendInline(isBusy ? "interject" : "normal");
            } else if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void sendInline(isBusy ? "queue" : "normal");
            }
          }}
        />

        <div className="stage-composer-toolbar">
          <div className="stage-model-pills" aria-busy={Boolean(switchingControl)}>
            <select
              aria-label="分屏模型"
              className="stage-pill-select"
              disabled={Boolean(switchingControl) || isBusy}
              value={modelLocked ? "" : currentModelId}
              onChange={(e) => {
                const nextModel = e.target.value;
                if (!nextModel) return;
                void changeRuntimeControl("model", () =>
                  window.grokDesktop.setModel(sessionId, nextModel),
                );
              }}
            >
              {modelLocked && (
                <option value="" disabled>
                  选择模型
                </option>
              )}
              {availableModels.map((m) => (
                <option key={m.modelId} value={m.modelId}>
                  {m.name}
                </option>
              ))}
            </select>

            <select
              aria-label="分屏推理强度"
              className="stage-pill-select"
              disabled={Boolean(switchingControl) || isBusy || modelLocked || !effortState.supported}
              title={effortState.reason}
              value={currentEffort}
              onChange={(e) => {
                const nextEffort = e.target.value as ReasoningEffort;
                void changeRuntimeControl("effort", () =>
                  window.grokDesktop.setEffort(sessionId, nextEffort),
                );
              }}
            >
              <option value="">默认强度</option>
              {effortState.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            <select
              aria-label="分屏执行模式"
              className={`stage-pill-select mode-${currentMode}`}
              disabled={Boolean(switchingControl) || isBusy}
              value={currentMode}
              onChange={(e) => {
                const nextMode = e.target.value as SessionMode;
                void changeRuntimeControl("mode", () =>
                  window.grokDesktop.setMode(sessionId, nextMode),
                );
              }}
            >
              {SESSION_MODE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} title={opt.description}>
                  {opt.value.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            {isBusy && composer.trim() && (
              <button
                type="button"
                className="ui-btn ui-btn-ghost ui-btn-sm"
                style={{ height: 24, padding: "0 7px", fontSize: "var(--text-xs)" }}
                disabled={sending || isWaiting || modelLocked}
                title="插入当前正在执行的回合 (Ctrl+Enter)"
                onClick={() => void sendInline("interject")}
              >
                <Zap size={11} />
                <span>插话</span>
              </button>
            )}

            {isBusy && !composer.trim() ? (
              <button
                type="button"
                className="ui-btn ui-btn-secondary ui-btn-sm"
                style={{ height: 24 }}
                title="停止此分屏会话"
                aria-label="停止此分屏会话"
                onClick={() => void stopInline()}
              >
                <Square size={11} />
                <span>停止</span>
              </button>
            ) : (
              <button
                type="button"
                className="ui-btn ui-btn-primary ui-btn-sm"
                style={{ height: 24 }}
                disabled={sending || isWaiting || modelLocked || (!composer.trim() && !attachments.length)}
                title={isBusy ? "加入队列" : "发送"}
                onClick={() => void sendInline(isBusy ? "queue" : "normal")}
              >
                {sending ? <LoaderCircle size={11} className="ui-spin" /> : <Send size={11} />}
                <span>{isBusy ? "排队" : "发送"}</span>
              </button>
            )}
          </div>
        </div>
      </footer>
    </section>
  );
});
