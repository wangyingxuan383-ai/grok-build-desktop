import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppSettings, ClaudeSessionSummary, CodexSessionSummary, SessionOriginKind, SessionSummary, WorkspaceSummary } from "../../../shared/types";
import { useAppStore } from "../store";
import type { WorkbenchView } from "../workbench-store";
import { UiIcon } from "../ui-icons";
import { removeProject } from "../project-removal";
import { SessionListRow, relativeTime } from "./SessionListRow";
import { ActionMenu, type UiAction } from "./ui/ActionMenu";
import { IconButton } from "./ui/Button";
import { ModeSwitch, type AppMode } from "./ModeSwitch";
import { UpdateIndicator } from "./UpdateIndicator";

const LazyFileExplorer = lazy(() => import("./FileWorkbench").then((module) => ({ default: module.FileExplorer })));
const LazyGitExplorer = lazy(() => import("./GitWorkbench").then((module) => ({ default: module.GitExplorer })));
const LazyWorktreeExplorer = lazy(() => import("./WorktreeWorkbench").then((module) => ({ default: module.WorktreeExplorer })));

export type SidebarPanel = "settings" | "accounts" | "about" | "tasks" | "extensions";
export type { AppMode };

/** Projects shown before the "more projects" fold. The active project is always shown. */
const VISIBLE_PROJECTS = 8;
const EXPANDED_KEY = "grok.sidebar-projects.v1";

export function Sidebar(props: {
  version: string;
  mode: AppMode;
  onMode(mode: AppMode): void;
  settings?: AppSettings;
  sessions: SessionSummary[];
  codexSessions: CodexSessionSummary[];
  claudeSessions: ClaudeSessionSummary[];
  workspaces: WorkspaceSummary[];
  activeSessionId: string;
  activeCodexId: string;
  activeClaudeId: string;
  search: string;
  busy: boolean;
  activeView: WorkbenchView;
  onView(view: WorkbenchView): void;
  onPreviewArtifact(path: string): void;
  dialogs: { askConfirm(message: string, options?: { title?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>; askText(message: string, initialValue: string, options?: { title?: string; confirmLabel?: string }): Promise<string | null>; setError(message: string): void };
  onSearch(value: string): void;
  onNew(): void;
  onOpen(session: SessionSummary): void;
  onOpenConversationTarget(target: { cwd: string; sessionId: string }): void;
  onOpenCodex(session: CodexSessionSummary): void;
  onOpenClaude(session: ClaudeSessionSummary): void;
  onChooseWorkspace(): void;
  onRecent(cwd: string): void | Promise<void>;
  onOpenWorkspaceOffline(workspace: WorkspaceSummary): void;
  onRename(session: SessionSummary): void;
  onDelete(session: SessionSummary): void;
  onPin(session: SessionSummary): void;
  onArchive(session: SessionSummary): void;
  onExport(session: SessionSummary): void;
  onHideCodex(session: CodexSessionSummary): void;
  onHideClaude(session: ClaudeSessionSummary): void;
  onToggleCodex(collapsed: boolean): void;
  onToggleClaude(collapsed: boolean): void;
  onToggleSessionGroup(kind: SessionOriginKind, collapsed: boolean): void;
  onToggleArchived(value: boolean): void;
  onPinWorkspace(workspace: WorkspaceSummary): void;
  onHideWorkspace(workspace: WorkspaceSummary): void;
  onRebindWorkspace(workspace: WorkspaceSummary): void;
  onDeleteDraft(): void;
  onClear(): void;
  onPanel(panel: SidebarPanel): void;
}): React.JSX.Element {
  const [openSessionMenu, setOpenSessionMenu] = useState("");
  const activeAccount = useAppStore((state) => state.accounts.find((value) => value.active));
  // Offline / fixture starts have no active workspace yet; the open session's folder stands in for it.
  const activeCwd = props.settings?.activeWorkspace || props.sessions.find((session) => session.id === props.activeSessionId)?.cwd || props.sessions[0]?.cwd || "";
  const [expanded, setExpanded] = useState<Record<string, boolean>>(readExpanded);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [archivesOpen, setArchivesOpen] = useState<Record<string, boolean>>({});
  const [refreshTick, setRefreshTick] = useState(0);
  const remote = useProjectSessions(props.workspaces, activeCwd, expanded, props.search, refreshTick);
  // Row actions in a non-active project must refresh that project's fetched list too.
  const afterAction = (action: () => unknown) => () => { void Promise.resolve(action()).finally(() => setRefreshTick((value) => value + 1)); };

  const persistExpanded = useCallback((next: Record<string, boolean>) => {
    setExpanded(next);
    try { localStorage.setItem(EXPANDED_KEY, JSON.stringify(next)); } catch { /* the tree still works without persistence */ }
  }, []);
  const isExpanded = (workspace: WorkspaceSummary): boolean => expanded[workspace.projectId] ?? samePath(workspace.cwd, activeCwd);
  const toggleProject = (workspace: WorkspaceSummary): void => persistExpanded({ ...expanded, [workspace.projectId]: !isExpanded(workspace) });

  const projects = useMemo(() => {
    // The active folder is always a project, even before discovery has listed it
    // (fresh install, offline start), so its sessions are never orphaned.
    const known = props.workspaces.some((workspace) => samePath(workspace.cwd, activeCwd));
    const withActive = !known && activeCwd ? [{ projectId: `active:${activeCwd}`, cwd: activeCwd, displayPath: activeCwd, canonicalPath: activeCwd, name: shortName(activeCwd), exists: true, hidden: false, pinned: false, sources: ["recent" as const], grokSessions: props.sessions.length, codexSessions: 0, claudeSessions: 0, draftCount: 0, activeSessions: 0 }, ...props.workspaces] : props.workspaces;
    const rows = withActive.filter((workspace) => !workspace.hidden && (workspace.exists || workspace.grokSessions > 0 || workspace.sources.some((source) => source === "pinned" || source === "recent")));
    return rows.sort((left, right) => Number(samePath(right.cwd, activeCwd)) - Number(samePath(left.cwd, activeCwd)) || Number(right.pinned) - Number(left.pinned) || (right.lastUsedAt ?? "").localeCompare(left.lastUsedAt ?? ""));
  }, [props.workspaces, props.sessions.length, activeCwd]);
  const visibleProjects = showAllProjects ? projects : projects.filter((workspace, index) => index < VISIBLE_PROJECTS || samePath(workspace.cwd, activeCwd));
  const hiddenCount = projects.length - visibleProjects.length;

  const openNewIn = async (workspace: WorkspaceSummary): Promise<void> => {
    if (!samePath(workspace.cwd, activeCwd)) await props.onRecent(workspace.cwd);
    props.onNew();
  };

  const tools: UiAction[] = [
    { id: "files", label: "文件", icon: <UiIcon name="file" />, run: () => props.onView("files") },
    { id: "git", label: "源代码管理", icon: <UiIcon name="branch" />, run: () => props.onView("source-control") },
    { id: "terminal", label: "终端", icon: <UiIcon name="terminal" />, run: () => props.onView("terminal") },
    { id: "browser", label: "网页预览（手动）", icon: <UiIcon name="globe" />, run: () => props.onView("browser") },
    { id: "artifacts", label: "产物预览", icon: <UiIcon name="images" />, run: () => props.onView("artifacts") },
    { id: "worktrees", label: "Worktree", icon: <UiIcon name="worktree" />, separatorBefore: true, run: () => props.onView("worktrees") },
    { id: "memory", label: "Memory", icon: <UiIcon name="memory" />, run: () => props.onView("memory") },
    { id: "agents", label: "Agent 与 Persona", icon: <UiIcon name="agents" />, run: () => props.onView("agents") },
    { id: "profiles", label: "执行配置档", icon: <UiIcon name="profiles" />, run: () => props.onView("profiles") },
    { id: "dashboard", label: "子智能体看板", icon: <UiIcon name="dashboard" />, run: () => props.onView("dashboard") },
  ];
  const explorer = props.activeView === "files" || props.activeView === "source-control" || props.activeView === "worktrees";
  const onError = props.dialogs.setError;

  const sessionRow = (session: SessionSummary, child = false): React.JSX.Element => (
    <SessionListRow
      key={session.id}
      session={session}
      child={child}
      active={props.activeSessionId === session.id}
      menuOpen={openSessionMenu === session.id}
      onOpen={() => (samePath(session.cwd, activeCwd) ? props.onOpen(session) : props.onOpenConversationTarget({ cwd: session.cwd, sessionId: session.id }))}
      onMenu={(open) => setOpenSessionMenu((current) => (open ? session.id : current === session.id ? "" : current))}
      onPin={afterAction(() => props.onPin(session))}
      onArchive={afterAction(() => props.onArchive(session))}
      onExport={() => props.onExport(session)}
      onRename={afterAction(() => props.onRename(session))}
      onDelete={afterAction(() => props.onDelete(session))}
    />
  );

  const renderSessions = (workspace: WorkspaceSummary, sessions: SessionSummary[] | undefined): React.JSX.Element => {
    if (!sessions) return <div className="sb-hint">正在加载会话…</div>;
    const live = sessions.filter((session) => !session.archived);
    const archived = sessions.filter((session) => session.archived);
    const ids = new Set(live.map((session) => session.id));
    const childrenOf = new Map<string, SessionSummary[]>();
    for (const session of live) {
      if (session.parentSessionId && ids.has(session.parentSessionId)) childrenOf.set(session.parentSessionId, [...(childrenOf.get(session.parentSessionId) ?? []), session]);
    }
    const roots = live.filter((session) => !(session.parentSessionId && ids.has(session.parentSessionId)));
    const archiveOpen = archivesOpen[workspace.projectId] || Boolean(props.search.trim());
    const draft = samePath(workspace.cwd, activeCwd) && workspace.draftCount > 0;
    return (
      <>
        {draft && (
          <div className={`sb-session draft${props.activeSessionId ? "" : " active"}`}>
            <button type="button" className="session-open" onClick={props.onNew} aria-current={!props.activeSessionId ? "page" : undefined}>
              <span className="status-dot cold" aria-hidden="true" />
              <span className="sb-session-title">未发送草稿</span>
              <span className="sb-session-meta">尚未启动</span>
            </button>
            <button type="button" className="sb-session-more sb-draft-remove" title="删除草稿" aria-label="删除未发送草稿" onClick={props.onDeleteDraft}><UiIcon name="trash" size={14} /></button>
          </div>
        )}
        {roots.map((session) => (
          <div key={session.id} className="sb-session-group">
            {sessionRow(session)}
            {childrenOf.get(session.id)?.map((child) => sessionRow(child, true))}
          </div>
        ))}
        {!roots.length && !draft && !archived.length && <div className="sb-hint">{props.search.trim() ? "没有匹配的会话" : "还没有会话"}</div>}
        {archived.length > 0 && (
          <div className="sb-archived">
            <button type="button" className="sb-subhead" aria-expanded={archiveOpen} onClick={() => setArchivesOpen((value) => ({ ...value, [workspace.projectId]: !archiveOpen }))}>
              <UiIcon name={archiveOpen ? "chevron-down" : "chevron-right"} size={12} />已归档<span>{archived.length}</span>
            </button>
            {archiveOpen && archived.map((session) => sessionRow(session))}
          </div>
        )}
      </>
    );
  };

  const projectActions = (workspace: WorkspaceSummary): UiAction[] => {
    const active = samePath(workspace.cwd, activeCwd);
    return [
      { id: "new", label: "在此项目新建会话", icon: <UiIcon name="new-chat" />, disabled: !workspace.exists || props.busy, run: () => openNewIn(workspace) },
      { id: "pin", label: workspace.pinned ? "取消置顶" : "置顶项目", icon: <UiIcon name="pin" />, run: () => props.onPinWorkspace(workspace) },
      ...(!workspace.exists ? [{ id: "rebind", label: "迁移到新位置…", icon: <UiIcon name="folder" />, run: () => props.onRebindWorkspace(workspace) }] : []),
      { id: "hide", label: "从列表隐藏", icon: <UiIcon name="close" />, disabled: active, reason: active ? "当前项目不能隐藏" : undefined, run: () => props.onHideWorkspace(workspace) },
      ...(active ? [{ id: "clear", label: "清空此项目的会话…", icon: <UiIcon name="trash" />, danger: true, separatorBefore: true, run: props.onClear }] : []),
      { id: "delete", label: "删除项目…", icon: <UiIcon name="trash" />, danger: true, separatorBefore: !active, reason: "删除项目入口及其 Grok 会话，保留磁盘文件", run: () => removeProject(workspace.cwd, props.dialogs.askConfirm).catch((error) => onError(String(error))) },
    ];
  };

  return (
    <aside className="sidebar">
      <ModeSwitch mode={props.mode} onMode={props.onMode} />
      <nav className="sb-nav" aria-label="主要入口">
        <button type="button" className="sb-nav-row is-primary" disabled={props.busy} onClick={props.onNew}><UiIcon name="new-chat" /><span>新建会话</span><kbd>Ctrl N</kbd></button>
        <button type="button" className="sb-nav-row" onClick={() => window.dispatchEvent(new Event("grok:command-search"))} aria-label="搜索命令和会话"><UiIcon name="search" /><span>搜索</span><kbd>Ctrl K</kbd></button>
        <button type="button" className="sb-nav-row" onClick={() => props.onPanel("tasks")}><UiIcon name="clock" /><span>定时任务</span></button>
        <button type="button" className="sb-nav-row" onClick={() => props.onPanel("extensions")}><UiIcon name="extensions" /><span>技能与扩展</span></button>
        <ActionMenu align="start" actions={tools} onError={onError} trigger={<button type="button" className="sb-nav-row"><UiIcon name="grid" /><span>更多工具</span><UiIcon name="chevron-right" size={13} className="sb-nav-tail" /></button>} />
      </nav>

      <Suspense fallback={<div className="sb-hint" role="status">加载项目工具…</div>}>
        {explorer ? (
          <div className="sb-explorer">
            <button type="button" className="sb-back" onClick={() => props.onView("chat")}><UiIcon name="chevron-left" size={14} />返回会话</button>
            {props.activeView === "files" ? <LazyFileExplorer workspace={activeCwd} dialogs={props.dialogs} onPreviewArtifact={props.onPreviewArtifact} />
              : props.activeView === "source-control" ? <LazyGitExplorer workspace={activeCwd} dialogs={props.dialogs} />
                : <LazyWorktreeExplorer workspace={activeCwd} dialogs={props.dialogs} onOpenConversation={props.onOpenConversationTarget} />}
          </div>
        ) : (
          <>
            <div className="sb-section-head">
              <span>项目</span>
              <IconButton icon="plus" size="sm" label="添加项目文件夹" onClick={props.onChooseWorkspace} />
            </div>
            <div className="sb-search">
              <UiIcon name="search" size={14} />
              <input id="session-search" value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder="筛选会话" aria-label="筛选所有项目的会话" />
              {props.search && <IconButton icon="close" size="sm" label="清除会话筛选" onClick={()=>props.onSearch("")} />}
            </div>
            <div className="sb-scroll">
              {!projects.length && <div className="sb-hint">还没有项目。点击右上角 + 添加一个文件夹。</div>}
              {visibleProjects.map((workspace) => {
                const open = isExpanded(workspace);
                const active = samePath(workspace.cwd, activeCwd);
                const sessions = active ? props.sessions : remote[workspace.projectId];
                const running = active ? props.sessions.filter((session) => session.status === "working" || session.status === "needs-user").length : workspace.activeSessions;
                return (
                  <section key={workspace.projectId} className={`sb-project${active ? " active" : ""}${workspace.exists ? "" : " missing"}`}>
                    <div className="sb-project-head">
                      <button type="button" className="sb-project-toggle" aria-expanded={open} title={workspace.exists ? workspace.displayPath : `${workspace.diagnostic || "路径已失效"}；点击后可离线查看本地历史`} onClick={() => (workspace.exists || open ? toggleProject(workspace) : props.onOpenWorkspaceOffline(workspace))}>
                        <UiIcon name={open ? "chevron-down" : "chevron-right"} size={13} />
                        <UiIcon name="folder" size={15} />
                        <span className="sb-project-name">{workspace.name}</span>
                        {workspace.pinned && <UiIcon name="pin" size={11} className="sb-pin" aria-label="已置顶" />}
                        {running > 0 && <span className="sb-running" title={`${running} 个会话运行中`} />}
                        {!workspace.exists && <em className="sb-missing">路径失效</em>}
                        <span className="sb-project-count">{sessions ? sessions.filter((session) => !session.archived).length : workspace.grokSessions}</span>
                      </button>
                      <ActionMenu actions={projectActions(workspace)} onError={onError} trigger={<button type="button" className="sb-project-more" aria-label={`${workspace.name}的项目操作`}><UiIcon name="more" size={15} /></button>} />
                    </div>
                    {open && (workspace.exists || sessions?.length) && <div className="sb-project-body">{renderSessions(workspace, sessions)}</div>}
                    {open && !workspace.exists && !sessions?.length && (
                      <div className="sb-project-body"><button type="button" className="sb-link" onClick={() => props.onOpenWorkspaceOffline(workspace)}>离线查看本地历史</button></div>
                    )}
                  </section>
                );
              })}
              {hiddenCount > 0 && <button type="button" className="sb-more-projects" onClick={() => setShowAllProjects(true)}>显示另外 {hiddenCount} 个项目</button>}
              {showAllProjects && projects.length > VISIBLE_PROJECTS && <button type="button" className="sb-more-projects" onClick={() => setShowAllProjects(false)}>收起</button>}

              <div className="sb-section-head sb-other-head"><span>其他来源</span></div>
              <section className="sb-other">
                <button type="button" className="sb-subhead wide" aria-expanded={!props.settings?.codexGroupCollapsed} onClick={() => props.onToggleCodex(!props.settings?.codexGroupCollapsed)}>
                  <UiIcon name={props.settings?.codexGroupCollapsed ? "chevron-right" : "chevron-down"} size={12} />Codex 会话<span>{props.codexSessions.length}</span>
                </button>
                {!props.settings?.codexGroupCollapsed && (
                  <>
                    <label className="sb-check"><input type="checkbox" checked={props.settings?.showArchivedCodex ?? false} onChange={(event) => props.onToggleArchived(event.target.checked)} />显示归档</label>
                    {props.codexSessions.map((session) => (
                      <div key={session.id} className={`sb-session external${props.activeCodexId === session.id ? " active" : ""}`}>
                        <button type="button" className="session-open" onClick={() => props.onOpenCodex(session)}>
                          <span className="sb-mark codex">C</span>
                          <span className="sb-session-title">{session.title}</span>
                          <span className="sb-session-meta">{relativeTime(session.updatedAt)}{session.archived ? " · 归档" : ""}</span>
                        </button>
                        <button type="button" className="sb-session-more" title="从镜像列表隐藏" aria-label={`隐藏 ${session.title}`} onClick={() => props.onHideCodex(session)}><UiIcon name="close" size={13} /></button>
                      </div>
                    ))}
                  </>
                )}
                <button type="button" className="sb-subhead wide" aria-expanded={!props.settings?.claudeGroupCollapsed} onClick={() => props.onToggleClaude(!props.settings?.claudeGroupCollapsed)}>
                  <UiIcon name={props.settings?.claudeGroupCollapsed ? "chevron-right" : "chevron-down"} size={12} />Claude 会话<span>{props.claudeSessions.length}</span>
                </button>
                {!props.settings?.claudeGroupCollapsed && props.claudeSessions.map((session) => (
                  <div key={session.id} className={`sb-session external${props.activeClaudeId === session.id ? " active" : ""}`}>
                    <button type="button" className="session-open" onClick={() => props.onOpenClaude(session)}>
                      <span className="sb-mark claude">A</span>
                      <span className="sb-session-title">{session.title}</span>
                      <span className="sb-session-meta">{relativeTime(session.updatedAt)}</span>
                    </button>
                    <button type="button" className="sb-session-more" title="从镜像列表隐藏" aria-label={`隐藏 ${session.title}`} onClick={() => props.onHideClaude(session)}><UiIcon name="close" size={13} /></button>
                  </div>
                ))}
              </section>
            </div>
          </>
        )}
      </Suspense>

      <div className="sb-foot">
        <button type="button" className="sb-account" onClick={() => props.onPanel("accounts")} title="账号与用量">
          <span className="avatar">{activeAccount?.label.slice(0, 1).toUpperCase() || "?"}</span>
          <span className="sb-account-name">{activeAccount?.label || "登录账号"}</span>
        </button>
        <UpdateIndicator showVersion onOpen={() => props.onPanel("about")} />
        <IconButton icon="settings" label="设置" onClick={() => props.onPanel("settings")} />
      </div>
    </aside>
  );
}

/**
 * Sessions of projects other than the active one. They are fetched only while
 * the project is expanded and re-fetched when the filter text changes, so a
 * long project list costs nothing until the user opens a project.
 */
function useProjectSessions(workspaces: WorkspaceSummary[], activeCwd: string, expanded: Record<string, boolean>, query: string, refreshTick: number): Record<string, SessionSummary[]> {
  const [rows, setRows] = useState<Record<string, SessionSummary[]>>({});
  const requested = useRef(new Map<string, number>());
  useEffect(() => {
    const open = workspaces.filter((workspace) => workspace.exists && expanded[workspace.projectId] && !samePath(workspace.cwd, activeCwd));
    let cancelled = false;
    const timer = window.setTimeout(() => {
      for (const workspace of open) {
        const ticket = (requested.current.get(workspace.projectId) ?? 0) + 1;
        requested.current.set(workspace.projectId, ticket);
        void window.grokDesktop.listSessions(workspace.cwd, query.trim() || undefined).then((sessions) => {
          if (!cancelled && requested.current.get(workspace.projectId) === ticket) setRows((current) => ({ ...current, [workspace.projectId]: sessions }));
        }).catch(() => undefined);
      }
    }, query.trim() ? 250 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [workspaces, activeCwd, expanded, query, refreshTick]);
  return rows;
}

function readExpanded(): Record<string, boolean> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(EXPANDED_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([, open]) => typeof open === "boolean")) : {};
  } catch { return {}; }
}

function shortName(value: string): string { return value.split(/[\/]/).filter(Boolean).at(-1) || value; }

function samePath(left: string, right: string): boolean {
  return left.replace(/[\\/]+$/, "").toLocaleLowerCase() === right.replace(/[\\/]+$/, "").toLocaleLowerCase();
}
