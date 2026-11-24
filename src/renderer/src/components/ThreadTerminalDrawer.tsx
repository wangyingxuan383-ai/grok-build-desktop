import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  ChevronDown,
  Columns2,
  Eraser,
  MessageSquarePlus,
  Plus,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import type { WorkspaceTerminal, WorkspaceTerminalEvent } from "../../../shared/workspace-tools";
import { useAppStore } from "../store";
import { getActiveTerminalTheme } from "../theme";
import { useWorkbenchStore } from "../workbench-store";
import "../styles/thread-terminal-drawer.css";

const HEIGHT_STORAGE_KEY = "grok.thread-terminal-drawer.height.v1";
const MIN_DRAWER_HEIGHT = 140;
const DEFAULT_DRAWER_HEIGHT = 240;

export interface ThreadTerminalDrawerProps {
  workspace: string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?(open: boolean): void;
  onError(message: string): void;
}

interface XtermControlHandle {
  clear(): void;
  focus(): void;
  fit(): void;
}

function getMaxDrawerHeight(): number {
  return typeof window !== "undefined" ? Math.max(MIN_DRAWER_HEIGHT + 40, Math.floor(window.innerHeight * 0.65)) : 600;
}

function clampDrawerHeight(height: number): number {
  return Math.max(MIN_DRAWER_HEIGHT, Math.min(getMaxDrawerHeight(), Math.round(height)));
}

function readStoredHeight(): number {
  try {
    const raw = Number(localStorage.getItem(HEIGHT_STORAGE_KEY));
    if (Number.isFinite(raw) && raw >= MIN_DRAWER_HEIGHT) return clampDrawerHeight(raw);
  } catch {
    // Ignore storage read failure
  }
  return DEFAULT_DRAWER_HEIGHT;
}

function activeTerminalStorageKey(workspace: string): string {
  return `grok.active-terminal.v1:${workspace.toLocaleLowerCase()}`;
}

function readRememberedTerminalId(workspace: string): string {
  try {
    return localStorage.getItem(activeTerminalStorageKey(workspace)) || "";
  } catch {
    return "";
  }
}

export function ThreadTerminalDrawer({
  workspace,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  onError,
}: ThreadTerminalDrawerProps): React.JSX.Element | null {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isOpen = controlledOpen ?? uncontrolledOpen;
  const setOpen = useCallback((next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }, [controlledOpen, onOpenChange]);

  const [height, setHeight] = useState(readStoredHeight);
  const [tabs, setTabs] = useState<WorkspaceTerminal[]>([]);
  const [primaryId, setPrimaryId] = useState(() => readRememberedTerminalId(workspace));
  const [secondaryId, setSecondaryId] = useState<string>("");
  const [focusedSlot, setFocusedSlot] = useState<"primary" | "secondary">("primary");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const generationRef = useRef(0);
  const handlesRef = useRef(new Map<string, XtermControlHandle>());
  const dragStartRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const tablistRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onToggle = (): void => setOpen(!isOpen);
    const onOpenExplicit = (): void => setOpen(true);
    window.addEventListener("grok:toggle-terminal", onToggle);
    window.addEventListener("grok:open-terminal", onOpenExplicit);
    return () => {
      window.removeEventListener("grok:toggle-terminal", onToggle);
      window.removeEventListener("grok:open-terminal", onOpenExplicit);
    };
  }, [isOpen, setOpen]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(HEIGHT_STORAGE_KEY, String(height));
      } catch {
        // Ignore storage failure
      }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [height]);

  useEffect(() => {
    const onWindowResize = (): void => setHeight((prev) => clampDrawerHeight(prev));
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, []);

  const rememberPrimary = useCallback((id: string) => {
    setPrimaryId(id);
    if (id && workspace) {
      try {
        localStorage.setItem(activeTerminalStorageKey(workspace), id);
      } catch {
        // Ignore storage error
      }
    }
  }, [workspace]);

  useEffect(() => {
    const gen = ++generationRef.current;
    setSecondaryId("");
    setFocusedSlot("primary");
    if (!workspace) {
      setTabs([]);
      setPrimaryId("");
      return;
    }
    if (!isOpen) return;

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
        setTabs(rows);
        const workbenchPreferred = useWorkbenchStore.getState().activeTerminalWorkspace === workspace
          ? useWorkbenchStore.getState().activeTerminalId
          : "";
        const remembered = workbenchPreferred || readRememberedTerminalId(workspace);
        const target = rows.find((item) => item.id === remembered)?.id ?? rows[0]?.id ?? "";
        rememberPrimary(target);
      } catch (error) {
        if (!disposed && gen === generationRef.current) {
          onError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!disposed && gen === generationRef.current) setBusy(false);
      }
    })();

    return () => {
      disposed = true;
    };
  }, [isOpen, onError, rememberPrimary, workspace]);

  useEffect(() => {
    return window.grokDesktop.onWorkspaceTerminal((event) => {
      if (event.exitCode !== undefined) {
        setTabs((rows) => rows.map((tab) => (tab.id === event.id ? { ...tab, status: "exited", exitCode: event.exitCode } : tab)));
      }
    });
  }, []);

  const createShell = async (assignToSecondary = false): Promise<WorkspaceTerminal | undefined> => {
    if (!workspace || busy) return undefined;
    const gen = generationRef.current;
    setBusy(true);
    try {
      const tab = await window.grokDesktop.createWorkspaceTerminal(workspace);
      if (gen !== generationRef.current) return undefined;
      setTabs((rows) => [...rows, tab]);
      if (assignToSecondary) {
        setSecondaryId(tab.id);
        setFocusedSlot("secondary");
      } else if (focusedSlot === "secondary" && secondaryId) {
        setSecondaryId(tab.id);
      } else {
        rememberPrimary(tab.id);
      }
      return tab;
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
      return undefined;
    } finally {
      if (gen === generationRef.current) setBusy(false);
    }
  };

  const killShell = async (id: string): Promise<void> => {
    if (!id) return;
    const gen = generationRef.current;
    try {
      await window.grokDesktop.closeWorkspaceTerminal(id);
      if (gen !== generationRef.current) return;
      handlesRef.current.delete(id);
      setTabs((prev) => {
        const remaining = prev.filter((item) => item.id !== id);
        if (primaryId === id) {
          const replacement = remaining.find((item) => item.id !== secondaryId)?.id ?? remaining[0]?.id ?? "";
          rememberPrimary(replacement);
          if (replacement === secondaryId) setSecondaryId("");
        }
        if (secondaryId === id) {
          setSecondaryId("");
          setFocusedSlot("primary");
        }
        return remaining;
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  const toggleSplit = async (): Promise<void> => {
    if (secondaryId) {
      setSecondaryId("");
      setFocusedSlot("primary");
      return;
    }
    const candidate = tabs.find((item) => item.id !== primaryId);
    if (candidate) {
      setSecondaryId(candidate.id);
      setFocusedSlot("secondary");
    } else {
      await createShell(true);
    }
  };

  const activeFocusedId = focusedSlot === "secondary" && secondaryId ? secondaryId : primaryId;
  const resolvedFocusedId = tabs.some((tab) => tab.id === activeFocusedId) ? activeFocusedId : (tabs[0]?.id ?? "");

  const handleSelectTab = (id: string): void => {
    if (secondaryId) {
      if (id === primaryId) {
        setFocusedSlot("primary");
        handlesRef.current.get(id)?.focus();
        return;
      }
      if (id === secondaryId) {
        setFocusedSlot("secondary");
        handlesRef.current.get(id)?.focus();
        return;
      }
      if (focusedSlot === "secondary") {
        setSecondaryId(id);
      } else {
        rememberPrimary(id);
      }
    } else {
      rememberPrimary(id);
    }
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number, tabId: string): void => {
    if (event.key === "Delete") {
      event.preventDefault();
      void killShell(tabId);
      return;
    }
    if (!tabs.length) return;
    let nextIndex = -1;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    if (!nextTab) return;
    handleSelectTab(nextTab.id);
    tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
  };

  const finishResize = (target: HTMLDivElement, pointerId: number): void => {
    dragStartRef.current = null;
    setDragging(false);
    if (target.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
  };

  if (!isOpen) return null;

  const drawerVars = { "--drawer-height": `${height}px` } as React.CSSProperties;

  return (
    <section
      className="thread-terminal-drawer"
      aria-label="工作区底部终端抽屉"
      style={drawerVars}
    >
      <div
        className={`thread-terminal-resizer${dragging ? " is-dragging" : ""}`}
        role="separator"
        aria-orientation="horizontal"
        aria-label="拖动调整底部终端高度"
        aria-valuenow={height}
        aria-valuemin={MIN_DRAWER_HEIGHT}
        aria-valuemax={getMaxDrawerHeight()}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            setHeight((prev) => clampDrawerHeight(prev + (event.key === "ArrowUp" ? 24 : -24)));
          }
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragStartRef.current = { startY: event.clientY, startHeight: height };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (!dragStartRef.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const delta = dragStartRef.current.startY - event.clientY;
          setHeight(clampDrawerHeight(dragStartRef.current.startHeight + delta));
        }}
        onPointerUp={(event) => finishResize(event.currentTarget, event.pointerId)}
        onPointerCancel={(event) => finishResize(event.currentTarget, event.pointerId)}
      />

      <header className="thread-terminal-header">
        <div className="thread-terminal-lead">
          <span className="thread-terminal-label">
            <SquareTerminal size={13} aria-hidden="true" />
            <span>终端</span>
          </span>

          <div
            ref={tablistRef}
            className="thread-terminal-tablist"
            role="tablist"
            aria-label="终端会话标签"
            aria-orientation="horizontal"
          >
            {tabs.map((tab, index) => {
              const isShown = tab.id === primaryId || (Boolean(secondaryId) && tab.id === secondaryId);
              const isFocused = tab.id === resolvedFocusedId;
              const panelId = secondaryId && tab.id === secondaryId
                ? "thread-terminal-panel-secondary"
                : "thread-terminal-panel-primary";
              return (
                <button
                  key={tab.id}
                  id={`thread-terminal-tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={isFocused}
                  aria-controls={isShown ? panelId : undefined}
                  aria-keyshortcuts="Delete"
                  tabIndex={isFocused ? 0 : -1}
                  className={`thread-terminal-tab${isShown ? " is-shown" : ""}${isFocused ? " is-focused" : ""}`}
                  onClick={() => handleSelectTab(tab.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, index, tab.id)}
                >
                  <span
                    aria-hidden="true"
                    className={`thread-terminal-dot${tab.status === "exited" ? " is-exited" : ""}`}
                  />
                  <span className="thread-terminal-tab-title">
                    {tab.title || "Shell"} {index + 1}
                    {tab.status === "exited" ? ` (${tab.exitCode ?? 0})` : ""}
                  </span>
                  <span
                    role="presentation"
                    aria-hidden="true"
                    className="thread-terminal-tab-close"
                    title={`结束终端 ${index + 1} (Delete)`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void killShell(tab.id);
                    }}
                  >
                    <X size={11} />
                  </span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className="ui-icon-btn ui-icon-btn-sm thread-terminal-new-btn"
            disabled={!workspace || busy}
            title="新建终端 Shell"
            aria-label="新建终端"
            onClick={() => void createShell(false)}
          >
            <Plus size={13} />
          </button>
        </div>

        <div className="thread-terminal-actions">
          <button
            type="button"
            className="thread-terminal-quote-btn"
            disabled={!activeFocusedId}
            title="将当前终端最近输出作为上下文插入对话 (@terminal)"
            aria-label="引用输出到对话"
            onClick={() => {
              if (!activeFocusedId) return;
              useWorkbenchStore.getState().focusTerminal(activeFocusedId, workspace);
              window.dispatchEvent(
                new CustomEvent("grok:quote-terminal", {
                  detail: { workspace, terminalId: activeFocusedId },
                }),
              );
            }}
          >
            <MessageSquarePlus size={12} />
            <span>引用输出到对话</span>
          </button>

          <button
            type="button"
            className={`ui-icon-btn ui-icon-btn-sm thread-terminal-action-btn${secondaryId ? " is-active" : ""}`}
            disabled={!workspace || busy}
            title={secondaryId ? "取消终端分屏" : "并排双终端视图"}
            aria-label="并排双终端视图"
            aria-pressed={Boolean(secondaryId)}
            onClick={() => void toggleSplit()}
          >
            <Columns2 size={13} />
          </button>

          <button
            type="button"
            className="ui-icon-btn ui-icon-btn-sm thread-terminal-action-btn"
            disabled={!activeFocusedId}
            title="清空当前终端屏幕"
            aria-label="清空当前终端屏幕"
            onClick={() => {
              if (activeFocusedId) handlesRef.current.get(activeFocusedId)?.clear();
            }}
          >
            <Eraser size={13} />
          </button>

          <button
            type="button"
            className="ui-icon-btn ui-icon-btn-sm thread-terminal-action-btn"
            disabled={!activeFocusedId}
            title="结束当前终端进程"
            aria-label="结束当前终端进程"
            onClick={() => {
              if (activeFocusedId) void killShell(activeFocusedId);
            }}
          >
            <Trash2 size={13} />
          </button>

          <button
            type="button"
            className="ui-icon-btn ui-icon-btn-sm thread-terminal-action-btn"
            title="收起终端抽屉 (Ctrl+J，后台保留进程)"
            aria-label="收起终端抽屉"
            onClick={() => setOpen(false)}
          >
            <ChevronDown size={14} />
          </button>
        </div>
      </header>

      {!workspace ? (
        <div className="ui-empty thread-terminal-empty">
          <p>请先打开一个项目工作区以启动终端。</p>
        </div>
      ) : !primaryId ? (
        <div className="ui-empty thread-terminal-empty">
          <p>{busy ? "正在启动工作区终端…" : "点击左上角 + 新建一个终端会话。"}</p>
        </div>
      ) : (
        <div className={`thread-terminal-body${secondaryId ? " is-split" : ""}`}>
          <div
            id="thread-terminal-panel-primary"
            role="tabpanel"
            aria-labelledby={tabs.some((tab) => tab.id === primaryId) ? `thread-terminal-tab-${primaryId}` : undefined}
            aria-label="主终端面板"
            className="thread-terminal-slot"
            onMouseDown={() => setFocusedSlot("primary")}
          >
            <DrawerTerminalPane
              key={primaryId}
              id={primaryId}
              workspace={workspace}
              handlesRef={handlesRef}
              onError={onError}
            />
          </div>

          {secondaryId && (
            <>
              <div className="thread-terminal-split-divider" aria-hidden="true" />
              <div
                id="thread-terminal-panel-secondary"
                role="tabpanel"
                aria-labelledby={tabs.some((tab) => tab.id === secondaryId) ? `thread-terminal-tab-${secondaryId}` : undefined}
                aria-label="副终端面板"
                className="thread-terminal-slot"
                onMouseDown={() => setFocusedSlot("secondary")}
              >
                <DrawerTerminalPane
                  key={secondaryId}
                  id={secondaryId}
                  workspace={workspace}
                  handlesRef={handlesRef}
                  onError={onError}
                />
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function DrawerTerminalPane({
  id,
  workspace,
  handlesRef,
  onError,
}: {
  id: string;
  workspace: string;
  handlesRef: React.MutableRefObject<Map<string, XtermControlHandle>>;
  onError(message: string): void;
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const themeSettings = useAppStore((state) => state.settings?.theme);
  const terminalRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = getActiveTerminalTheme(themeSettings);
    }
  }, [themeSettings]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let ready = false;
    let sequence = 0;
    const pending: WorkspaceTerminalEvent[] = [];

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, "Microsoft YaHei UI", monospace',
      fontSize: 13,
      scrollback: 5000,
      theme: getActiveTerminalTheme(useAppStore.getState().settings?.theme),
    });
    terminalRef.current = terminal;

    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);

    const syncFromDomTheme = (): void => {
      terminal.options.theme = getActiveTerminalTheme();
    };
    document.documentElement.addEventListener("grok-theme-change", syncFromDomTheme);

    const resize = (): void => {
      if (disposed || !host || host.clientWidth < 12 || host.clientHeight < 12) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      if (ready) {
        void window.grokDesktop.resizeWorkspaceTerminal(
          id,
          Math.max(2, Math.min(500, terminal.cols)),
          Math.max(2, Math.min(300, terminal.rows)),
        ).catch(() => undefined);
      }
    };

    handlesRef.current.set(id, {
      clear: () => terminal.clear(),
      focus: () => terminal.focus(),
      fit: resize,
    });

    const applyEvent = (event: WorkspaceTerminalEvent): void => {
      if (event.id !== id || disposed) return;
      if (!ready) {
        pending.push(event);
        return;
      }
      if (event.sequence <= sequence) return;
      sequence = event.sequence;
      if (event.exitCode !== undefined) terminal.options.disableStdin = true;
      terminal.write(event.data);
    };

    const unsubscribe = window.grokDesktop.onWorkspaceTerminal(applyEvent);

    void window.grokDesktop.listWorkspaceTerminals(workspace)
      .then((rows) => {
        if (disposed) return;
        const snapshot = rows.find((row) => row.id === id);
        if (!snapshot) return;
        terminal.options.disableStdin = snapshot.status === "exited";
        if (snapshot.output) terminal.write(snapshot.output);
        sequence = snapshot.sequence;
        ready = true;
        pending.splice(0).forEach(applyEvent);
        resize();
      })
      .catch((error) => {
        if (!disposed) onError(error instanceof Error ? error.message : String(error));
      });

    const inputSub = terminal.onData((data) => {
      void window.grokDesktop.writeWorkspaceTerminal(id, data).catch((error) => {
        onError(error instanceof Error ? error.message : String(error));
      });
    });

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    return () => {
      disposed = true;
      handlesRef.current.delete(id);
      terminalRef.current = null;
      document.documentElement.removeEventListener("grok-theme-change", syncFromDomTheme);
      unsubscribe();
      inputSub.dispose();
      observer.disconnect();
      terminal.dispose();
    };
  }, [handlesRef, id, onError, workspace]);

  return <div ref={hostRef} className="thread-terminal-surface" />;
}
