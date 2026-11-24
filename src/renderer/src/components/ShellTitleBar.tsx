import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  Bell,
  ChevronDown,
  Code2,
  Columns2,
  Copy,
  ExternalLink,
  Folder,
  FolderGit2,
  GitBranch,
  Menu,
  PanelLeft,
  PanelRight,
  Search,
  Settings,
  SquareTerminal,
} from "lucide-react";
import type { DesktopProductivitySettings } from "../../../shared/productivity";
import type {
  ComputerAppPermissionRequest,
  ComputerRiskConfirmation,
  ExternalOpenTool,
  ExternalOpenToolId,
  GitRepositoryStatus,
  GrokWorktreeSummary,
  SessionExecutionAssignment,
  SessionSummary,
} from "../../../shared/types";
import { shortcutFor } from "../../../shared/shortcuts";
import { useGitStore } from "../git-store";
import { useAppStore } from "../store";
import { TITLEBAR_HEIGHT_PX } from "../theme";
import { useWorkbenchStore } from "../workbench-store";
import { useWorktreeStore } from "../worktree-store";
import { GitActionsToolbar } from "./GitActionsToolbar";
import { TurnCapsule } from "./TurnCapsule";

const LazyProjectScriptsBar = lazy(() =>
  import("./ProjectScriptsBar").then((module) => ({ default: module.ProjectScriptsBar })),
);

const PREFERRED_OPEN_TOOL_KEY = "grok.preferred-open-tool.v1";
const DRAG_STYLE = { WebkitAppRegion: "drag" } as React.CSSProperties;
const NO_DRAG_STYLE = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

export interface ShellTitleBarProps {
  workspace: string;
  session?: SessionSummary;
  assignment?: SessionExecutionAssignment;
  activeWorktree?: GrokWorktreeSummary;
  gitStatus?: GitRepositoryStatus;
  sidebarCollapsed?: boolean;
  terminalOpen?: boolean;
  inspectorOpen?: boolean;
  splitActive?: boolean;
  splitSessionIds?: string[];
  computerPermissions?: Record<string, ComputerAppPermissionRequest>;
  computerRisks?: Record<string, ComputerRiskConfirmation>;
  onSelectSession?(target: { cwd: string; sessionId: string }): void;
  inboxUnreadCount?: number;
  frameless?: boolean;
  productivity?: Partial<DesktopProductivitySettings>;
  onToggleSidebar(): void;
  onSplitPane?(): void;
  onToggleTerminal?(): void;
  onToggleInspector?(): void;
  onOpenInbox?(): void;
  onOpenSettings?(): void;
  onOpenReview?(): void;
  onClickProjectBadge?(): void;
  onOpenCommandSearch?(): void;
  onError?(message: string): void;
}

function readPreferredOpenTool(): ExternalOpenToolId {
  try {
    const raw = localStorage.getItem(PREFERRED_OPEN_TOOL_KEY) as ExternalOpenToolId | null;
    if (raw && ["vscode", "cursor", "explorer", "terminal", "notepad", "codex-cli"].includes(raw)) {
      return raw;
    }
  } catch {
    // Ignore storage unavailability
  }
  return "vscode";
}

function formatKbd(accelerator: string, fallback: string): string {
  const value = accelerator || fallback;
  return value.replace(/^Control\+/i, "Ctrl+").replace(/^Super\+/i, "Win+");
}

function shortFolderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}

export function ShellTitleBar({
  workspace,
  session,
  assignment,
  activeWorktree: activeWorktreeProp,
  gitStatus: gitStatusProp,
  sidebarCollapsed = false,
  terminalOpen = false,
  inspectorOpen = false,
  splitActive = false,
  splitSessionIds,
  computerPermissions,
  computerRisks,
  onSelectSession,
  inboxUnreadCount = 0,
  frameless,
  productivity,
  onToggleSidebar,
  onSplitPane,
  onToggleTerminal,
  onToggleInspector,
  onOpenInbox,
  onOpenSettings,
  onOpenReview,
  onClickProjectBadge,
  onOpenCommandSearch,
  onError,
}: ShellTitleBarProps): React.JSX.Element {
  const settingsProductivity = useAppStore((state) => state.settings?.productivity);
  const effectiveProductivity = productivity ?? settingsProductivity;
  const setStoreError = useAppStore((state) => state.setError);
  const reportError = useCallback((msg: string) => {
    if (onError) onError(msg);
    else setStoreError(msg);
  }, [onError, setStoreError]);

  const storeGitStatus = useGitStore((state) => (samePath(state.workspace, workspace) ? state.status : undefined));
  const gitStatus = gitStatusProp ?? storeGitStatus;
  const worktreeItems = useWorktreeStore((state) => state.items);

  const activeEditorTab = useWorkbenchStore((state) => state.tabs.find((tab) => tab.key === state.activeTabKey));
  const activeEditorPath = activeEditorTab?.document.path;
  const activeCursor = activeEditorTab?.cursor;

  const [openTools, setOpenTools] = useState<ExternalOpenTool[]>([]);
  const [preferredToolId, setPreferredToolId] = useState<ExternalOpenToolId>(readPreferredOpenTool);
  const [openFeedback, setOpenFeedback] = useState("");
  const feedbackTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void window.grokDesktop.listOpenTargetTools()
      .then((tools) => {
        if (!alive) return;
        setOpenTools(tools);
        setPreferredToolId((current) => {
          if (tools.some((tool) => tool.id === current)) return current;
          return tools.find((tool) => tool.id === "vscode")?.id
            ?? tools.find((tool) => tool.id === "cursor")?.id
            ?? tools[0]?.id
            ?? "explorer";
        });
      })
      .catch(() => {
        if (alive) setOpenTools([]);
      });
    return () => {
      alive = false;
      if (feedbackTimerRef.current !== undefined) window.clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  const isWindows = typeof navigator !== "undefined" && /win/i.test(navigator.platform || navigator.userAgent);
  const reserveOverlaySpace = frameless ?? isWindows;

  const resolvedWorktree = useMemo(() => {
    if (activeWorktreeProp) return activeWorktreeProp;
    const worktreeId = assignment?.worktreeId ?? session?.worktreeId;
    if (worktreeId) {
      const matched = worktreeItems.find((item) => item.id === worktreeId);
      if (matched) return matched;
    }
    const targetCwd = assignment?.cwd ?? session?.cwd ?? workspace;
    if (!targetCwd) return undefined;
    return worktreeItems.find((item) => samePath(item.path, targetCwd));
  }, [activeWorktreeProp, assignment?.cwd, assignment?.worktreeId, session?.cwd, session?.worktreeId, workspace, worktreeItems]);

  const isIsolatedWorktree = Boolean(
    resolvedWorktree || assignment?.worktreeId || session?.worktreeId || session?.originKind === "worktree",
  );

  const displayProjectRoot = assignment?.sourceWorkspacePath || workspace || session?.cwd || "";
  const projectLabel = displayProjectRoot ? shortFolderName(displayProjectRoot) : "未选择项目";
  const branchLabel = resolvedWorktree?.branch
    || gitStatus?.branch?.name
    || (isIsolatedWorktree ? resolvedWorktree?.name || "worktree" : "");

  const selectedTool = useMemo(
    () => openTools.find((tool) => tool.id === preferredToolId) ?? openTools[0],
    [openTools, preferredToolId],
  );

  const rememberTool = (toolId: ExternalOpenToolId): void => {
    setPreferredToolId(toolId);
    try {
      localStorage.setItem(PREFERRED_OPEN_TOOL_KEY, toolId);
    } catch {
      // Ignore storage error
    }
  };

  const flashOpenFeedback = (text: string): void => {
    setOpenFeedback(text);
    if (feedbackTimerRef.current !== undefined) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => setOpenFeedback(""), 2400);
  };

  const handleOpenInTool = async (toolId: ExternalOpenToolId): Promise<void> => {
    const target = activeEditorPath || assignment?.cwd || session?.cwd || workspace;
    if (!target) return;
    rememberTool(toolId);
    const tool = openTools.find((item) => item.id === toolId);
    const usePosition = Boolean(activeEditorPath && activeCursor && tool?.supportsPosition);
    try {
      const result = toolId === "explorer"
        ? await window.grokDesktop.openTarget({
            target,
            sessionId: session?.id,
            executionRoot: workspace,
            action: activeEditorPath ? "reveal" : "open",
          })
        : await window.grokDesktop.openTarget({
            target,
            sessionId: session?.id,
            executionRoot: workspace,
            action: "open-with",
            applicationId: toolId,
            ...(usePosition && activeCursor ? { line: activeCursor.lineNumber, column: activeCursor.column } : {}),
          });
      if (!result.ok) reportError(result.message);
    } catch (error) {
      reportError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleCopyPath = async (): Promise<void> => {
    const target = activeEditorPath || assignment?.cwd || session?.cwd || workspace;
    if (!target) return;
    try {
      const result = await window.grokDesktop.openTarget({
        target,
        sessionId: session?.id,
        executionRoot: workspace,
        action: "copy-path",
      });
      if (result.ok) flashOpenFeedback("已复制路径");
      else reportError(result.message);
    } catch (error) {
      reportError(error instanceof Error ? error.message : String(error));
    }
  };

  const handlePopupAppMenu = (event: React.MouseEvent<HTMLButtonElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    void window.grokDesktop.popupAppMenu?.({
      x: Math.round(rect.left),
      y: Math.round(rect.bottom + 4),
    });
  };

  const triggerCommandSearch = (): void => {
    if (onOpenCommandSearch) onOpenCommandSearch();
    else window.dispatchEvent(new Event("grok:command-search"));
  };

  const triggerSplitPane = (): void => {
    if (onSplitPane) onSplitPane();
    else window.dispatchEvent(new Event("grok:split-pane"));
  };

  const triggerToggleTerminal = (): void => {
    if (onToggleTerminal) onToggleTerminal();
    else window.dispatchEvent(new Event("grok:toggle-terminal"));
  };

  const sidebarKbd = formatKbd(shortcutFor("toggle-sidebar", effectiveProductivity), "Ctrl+B");
  const searchKbd = formatKbd(shortcutFor("command-search", effectiveProductivity), "Ctrl+K");
  const splitKbd = formatKbd(shortcutFor("split-pane", effectiveProductivity), "Ctrl+\\");
  const terminalKbd = formatKbd(shortcutFor("toggle-terminal", effectiveProductivity), "Ctrl+J");
  const inspectorKbd = formatKbd(shortcutFor("toggle-inspector", effectiveProductivity), "Ctrl+Shift+B");

  const iconBtnStyle = (active = false): React.CSSProperties => ({
    ...NO_DRAG_STYLE,
    display: "inline-grid",
    placeItems: "center",
    width: 28,
    height: 28,
    padding: 0,
    border: 0,
    borderRadius: "var(--radius-md)",
    background: active ? "var(--color-selected)" : "transparent",
    color: active ? "var(--color-fg)" : "var(--color-fg-subtle)",
    cursor: "pointer",
    position: "relative",
    flex: "none",
  });

  const toolShortLabel = selectedTool?.label
    ?? (preferredToolId === "vscode"
      ? "VS Code"
      : preferredToolId === "cursor"
        ? "Cursor"
        : preferredToolId === "terminal"
          ? "终端"
          : "资源管理器");

  return (
    <header
      className="shell-titlebar"
      style={{
        ...DRAG_STYLE,
        flex: `0 0 var(--titlebar-height, ${TITLEBAR_HEIGHT_PX}px)`,
        height: `var(--titlebar-height, ${TITLEBAR_HEIGHT_PX}px)`,
        minHeight: `var(--titlebar-height, ${TITLEBAR_HEIGHT_PX}px)`,
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(200px, 420px) minmax(0, 1fr)",
        alignItems: "center",
        gap: 8,
        paddingLeft: 8,
        paddingRight: reserveOverlaySpace ? 138 : 10,
        borderBottom: "1px solid var(--color-border)",
        background: "var(--bg-app, var(--color-window))",
        color: "var(--text-primary, var(--color-fg))",
        userSelect: "none",
        zIndex: 30,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, overflow: "hidden" }}>
        <button
          type="button"
          className="ui-icon-btn ui-icon-btn-sm"
          style={iconBtnStyle(false)}
          title="应用菜单"
          aria-label="应用菜单"
          onClick={handlePopupAppMenu}
        >
          <Menu size={15} />
        </button>

        <button
          type="button"
          className={`ui-icon-btn ui-icon-btn-sm${!sidebarCollapsed ? " is-active" : ""}`}
          style={iconBtnStyle(!sidebarCollapsed)}
          title={`显示或隐藏侧边栏 (${sidebarKbd})`}
          aria-label="显示或隐藏侧边栏"
          aria-pressed={!sidebarCollapsed}
          onClick={onToggleSidebar}
        >
          <PanelLeft size={15} />
        </button>

        <button
          type="button"
          className={`shell-project-pill${isIsolatedWorktree ? " is-worktree" : ""}`}
          onClick={onClickProjectBadge}
          title={
            isIsolatedWorktree
              ? `隔离 Worktree：${resolvedWorktree?.path || assignment?.cwd || session?.cwd || workspace}`
              : displayProjectRoot || "选择项目工作区"
          }
          style={{
            ...NO_DRAG_STYLE,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 26,
            maxWidth: "100%",
            minWidth: 0,
            padding: "0 8px",
            borderRadius: "var(--radius-md)",
            border: isIsolatedWorktree
              ? "1px solid color-mix(in srgb, var(--color-accent) 45%, var(--color-border))"
              : "1px solid transparent",
            background: isIsolatedWorktree ? "var(--color-accent-soft)" : "transparent",
            color: "var(--color-fg)",
            fontSize: "var(--text-caption)",
            cursor: onClickProjectBadge ? "pointer" : "default",
          }}
        >
          {isIsolatedWorktree ? (
            <FolderGit2 size={14} style={{ color: "var(--color-accent)", flex: "none" }} />
          ) : (
            <Folder size={14} style={{ color: "var(--color-fg-subtle)", flex: "none" }} />
          )}
          <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {projectLabel}
          </span>
          {branchLabel && (
            <>
              <span style={{ color: "var(--color-fg-subtlest)", flex: "none" }}>/</span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  minWidth: 0,
                  color: isIsolatedWorktree ? "var(--color-accent)" : "var(--color-fg-subtle)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-xs)",
                }}
              >
                <GitBranch size={11} style={{ flex: "none" }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {branchLabel}
                </span>
              </span>
            </>
          )}
          {isIsolatedWorktree && (
            <span
              className="ui-badge ui-badge-accent"
              style={{ height: 17, padding: "0 5px", fontSize: 10, flex: "none" }}
            >
              WT
            </span>
          )}
        </button>
      </div>

      <div style={{ display: "flex", justifyContent: "center", minWidth: 0, overflow: "hidden" }}>
        <button
          type="button"
          className="shell-omni-trigger"
          onClick={triggerCommandSearch}
          aria-label={`搜索会话、文件与命令 (${searchKbd})`}
          title={`搜索会话、文件 (@) 与命令 (>) · ${searchKbd}`}
          style={{
            ...NO_DRAG_STYLE,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            width: "100%",
            maxWidth: 380,
            height: 26,
            padding: "0 9px",
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--color-border)",
            background: "var(--color-input)",
            color: "var(--color-fg-subtle)",
            fontSize: "var(--text-xs)",
            cursor: "pointer",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0, overflow: "hidden" }}>
            <Search size={13} style={{ color: "var(--color-fg-subtlest)", flex: "none" }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              搜索会话、文件与命令…
            </span>
          </span>
          <kbd
            className="ui-kbd"
            style={{
              flex: "none",
              padding: "1px 5px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--color-border)",
              background: "var(--color-card)",
              fontSize: 11,
            }}
          >
            {searchKbd}
          </kbd>
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, minWidth: 0, overflow: "hidden" }}>
        {openFeedback && (
          <span style={{ ...NO_DRAG_STYLE, fontSize: "var(--text-xs)", color: "var(--color-success)", whiteSpace: "nowrap" }}>
            {openFeedback}
          </span>
        )}

        {Boolean(workspace || session?.cwd) && (
          <div
            className="shell-open-in-split"
            style={{
              ...NO_DRAG_STYLE,
              display: "inline-flex",
              alignItems: "center",
              height: 26,
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--color-border)",
              overflow: "hidden",
              flex: "none",
            }}
          >
            <button
              type="button"
              onClick={() => void handleOpenInTool(preferredToolId)}
              title={`在 ${toolShortLabel} 中打开${activeEditorPath ? "当前文件" : "项目目录"}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                height: "100%",
                padding: "0 8px",
                border: 0,
                background: "transparent",
                color: "var(--color-fg-subtle)",
                fontSize: "var(--text-xs)",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <Code2 size={13} />
              <span className="shell-toolbar-label">{toolShortLabel}</span>
            </button>
            <Dropdown.Root modal={false}>
              <Dropdown.Trigger asChild>
                <button
                  type="button"
                  aria-label="切换外部打开工具"
                  title="选择外部打开方式"
                  style={{
                    display: "inline-grid",
                    placeItems: "center",
                    width: 20,
                    height: "100%",
                    padding: 0,
                    border: 0,
                    borderLeft: "1px solid var(--color-border)",
                    background: "transparent",
                    color: "var(--color-fg-subtlest)",
                    cursor: "pointer",
                  }}
                >
                  <ChevronDown size={12} />
                </button>
              </Dropdown.Trigger>
              <Dropdown.Portal>
                <Dropdown.Content className="ui-menu" align="end" sideOffset={6} collisionPadding={8}>
                  {openTools.map((tool) => (
                    <Dropdown.Item
                      key={tool.id}
                      className="ui-menu-item"
                      onSelect={() => void handleOpenInTool(tool.id)}
                    >
                      <ExternalLink size={13} />
                      <span>
                        {tool.label}
                        <small>{tool.detail}</small>
                      </span>
                      <span className="ui-menu-tail">{tool.id === preferredToolId ? "✓" : ""}</span>
                    </Dropdown.Item>
                  ))}
                  {openTools.length > 0 && <Dropdown.Separator className="ui-menu-sep" />}
                  <Dropdown.Item className="ui-menu-item" onSelect={() => void handleCopyPath()}>
                    <Copy size={13} />
                    <span>复制{activeEditorPath ? "当前文件" : "执行目录"}路径</span>
                  </Dropdown.Item>
                </Dropdown.Content>
              </Dropdown.Portal>
            </Dropdown.Root>
          </div>
        )}

        <TurnCapsule
          splitSessionIds={splitSessionIds}
          computerPermissions={computerPermissions}
          computerRisks={computerRisks}
          onSelectSession={onSelectSession}
          onError={reportError}
        />

        {displayProjectRoot && (
          <Suspense fallback={null}>
            <LazyProjectScriptsBar
              workspace={displayProjectRoot}
              executionCwd={assignment?.cwd || session?.cwd || workspace}
              sessionId={session?.id}
              worktreeId={resolvedWorktree?.id || assignment?.worktreeId || session?.worktreeId}
              onError={reportError}
            />
          </Suspense>
        )}

        <GitActionsToolbar
          workspace={assignment?.cwd || session?.cwd || workspace}
          sessionId={session?.id}
          status={gitStatus}
          onOpenReview={onOpenReview}
          onError={reportError}
        />

        <button
          type="button"
          className={`ui-icon-btn ui-icon-btn-sm${splitActive ? " is-active" : ""}`}
          style={iconBtnStyle(splitActive)}
          title={`并排分屏会话 (${splitKbd})`}
          aria-label="并排分屏会话"
          aria-pressed={splitActive}
          onClick={triggerSplitPane}
        >
          <Columns2 size={15} />
        </button>

        <button
          type="button"
          className={`ui-icon-btn ui-icon-btn-sm${terminalOpen ? " is-active" : ""}`}
          style={iconBtnStyle(terminalOpen)}
          title={`显示或隐藏底部终端 (${terminalKbd})`}
          aria-label="显示或隐藏底部终端"
          aria-pressed={terminalOpen}
          onClick={triggerToggleTerminal}
        >
          <SquareTerminal size={15} />
        </button>

        <button
          type="button"
          className={`ui-icon-btn ui-icon-btn-sm review-toggle${inspectorOpen ? " is-active" : ""}`}
          style={iconBtnStyle(inspectorOpen)}
          title={`显示或隐藏右侧检查器 (${inspectorKbd})`}
          aria-label="显示或隐藏右侧检查器"
          aria-pressed={inspectorOpen}
          onClick={onToggleInspector}
        >
          <PanelRight size={15} />
        </button>

        {onOpenInbox && (
          <button
            type="button"
            className="ui-icon-btn ui-icon-btn-sm"
            style={iconBtnStyle(false)}
            title={inboxUnreadCount > 0 ? `通知收件箱（${inboxUnreadCount} 条未读）` : "通知收件箱"}
            aria-label={inboxUnreadCount > 0 ? `通知收件箱，${inboxUnreadCount} 条未读` : "通知收件箱"}
            onClick={onOpenInbox}
          >
            <Bell size={15} />
            {inboxUnreadCount > 0 && (
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  top: 3,
                  right: 2,
                  minWidth: 14,
                  height: 14,
                  padding: "0 3px",
                  borderRadius: 999,
                  background: "var(--color-accent)",
                  color: "var(--color-primary-fg)",
                  fontSize: 9,
                  fontWeight: 700,
                  lineHeight: "14px",
                  textAlign: "center",
                }}
              >
                {inboxUnreadCount > 99 ? "99+" : inboxUnreadCount}
              </span>
            )}
          </button>
        )}

        {onOpenSettings && (
          <button
            type="button"
            className="ui-icon-btn ui-icon-btn-sm"
            style={iconBtnStyle(false)}
            title="设置 (Ctrl+,)"
            aria-label="设置"
            onClick={onOpenSettings}
          >
            <Settings size={15} />
          </button>
        )}
      </div>
    </header>
  );
}

function samePath(left: string, right: string): boolean {
  return left.replace(/[\\/]+$/, "").toLocaleLowerCase() === right.replace(/[\\/]+$/, "").toLocaleLowerCase();
}
