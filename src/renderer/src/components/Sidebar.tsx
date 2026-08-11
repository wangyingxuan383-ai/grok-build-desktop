import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { AppSettings, ClaudeSessionSummary, CodexSessionSummary, SessionOriginKind, SessionSummary, WorkspaceSummary } from "../../../shared/types";
import { groupSessionsByOrigin, sessionSourceLabel } from "../session-groups";
import { useAppStore } from "../store";
import type { WorkbenchView } from "../workbench-store";
import { UiIcon, type UiIconName } from "../ui-icons";

const LazyFileExplorer = lazy(() => import("./FileWorkbench").then((module) => ({ default: module.FileExplorer })));
const LazyGitExplorer = lazy(() => import("./GitWorkbench").then((module) => ({ default: module.GitExplorer })));
const LazyWorktreeExplorer = lazy(() => import("./WorktreeWorkbench").then((module) => ({ default: module.WorktreeExplorer })));

export type SidebarPanel = "settings" | "accounts" | "about" | "tasks" | "extensions";

export function Sidebar(props: {
  version: string;
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
  dialogs: { askConfirm(message: string, options?: { title?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>; askText(message: string, initialValue: string, options?: { title?: string; confirmLabel?: string }): Promise<string | null>; setError(message: string): void };
  onSearch(value: string): void;
  onNew(): void;
  onOpen(session: SessionSummary): void;
  onOpenConversationTarget(target: { cwd: string; sessionId: string }): void;
  onOpenCodex(session: CodexSessionSummary): void;
  onOpenClaude(session: ClaudeSessionSummary): void;
  onChooseWorkspace(): void;
  onRecent(cwd: string): void;
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
  const [showRecent, setShowRecent] = useState(false);
  const closeWorkspaceMenu = useCallback(() => setShowRecent(false), []);
  const [projectToolsOpen, setProjectToolsOpen] = useState(() => props.settings?.projectToolsOpen ?? false);
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
  const liveSessionCount = props.sessions.filter((session) => session.status === "working" || session.status === "needs-user").length;
  const activeWorkspace = props.workspaces.find((workspace) => samePath(workspace.cwd, props.settings?.activeWorkspace || ""));
  const projectTools: Array<{ view: WorkbenchView; label: string; icon: UiIconName }> = [
    { view: "worktrees", label: "Worktree", icon: "worktree" },
    { view: "memory", label: "Memory", icon: "memory" },
    { view: "agents", label: "Agent 与 Persona", icon: "agents" },
    { view: "profiles", label: "Profiles", icon: "profiles" },
    { view: "dashboard", label: "Dashboard", icon: "dashboard" },
  ];
  const renderSession = (session: SessionSummary): React.JSX.Element => {
    const sourceLabel = sessionSourceLabel(session);
    const liveLabel = session.status === "working" ? "运行中" : session.status === "needs-user" ? "等待操作" : session.status === "queued" ? "等待处理" : session.status === "unread" ? "后台已完成" : session.status === "error" ? "运行失败" : "";
    const runAction = (event: React.MouseEvent<HTMLButtonElement>, action: () => void): void => {
      event.stopPropagation();
      setOpenSessionMenu("");
      action();
    };
    return <div key={session.id} className={`session-row ${session.archived ? "archived" : ""} ${props.activeSessionId === session.id ? "active" : ""}`} onClick={() => props.onOpen(session)}><span className={`status-dot ${session.status}`} />{session.pinned && <span className="pin-mark"><UiIcon name="pin" size={11}/></span>}<div className="session-copy"><strong>{session.title}{sourceLabel && <em className={`session-source-badge ${session.originKind}`}>{sourceLabel}</em>}</strong>{session.preview && session.preview !== session.title && <small className="session-preview" title={session.preview}>{session.preview}</small>}<span>{liveLabel && <>{liveLabel} · </>}{relativeTime(session.updatedAt)} · {session.messageCount} 条消息{session.archived ? " · 已归档" : ""}</span></div><div className="session-quick-actions"><button title={session.pinned ? "取消置顶" : "置顶"} onClick={(event) => runAction(event, () => props.onPin(session))}><UiIcon name="pin" size={14}/></button><button title={session.archived ? "取消归档" : "归档"} onClick={(event) => runAction(event, () => props.onArchive(session))}><UiIcon name="archive" size={14}/></button></div><details className="session-actions" data-session-id={session.id} open={openSessionMenu === session.id} onClick={(event) => event.stopPropagation()}><summary title="更多操作" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpenSessionMenu(openSessionMenu === session.id ? "" : session.id); }}><UiIcon name="more" size={15}/></summary><div className="session-action-menu"><button onClick={(event) => runAction(event, () => props.onExport(session))}><UiIcon name="download"/>导出 Markdown</button><button onClick={(event) => runAction(event, () => props.onRename(session))}><UiIcon name="edit"/>重命名</button><button className="danger-link" onClick={(event) => runAction(event, () => props.onDelete(session))}><UiIcon name="trash"/>删除</button></div></details></div>;
  };
  return <aside className="sidebar">
    <div className="brand"><button className="brand-product" title="Grok Build Desktop"><span className="brand-wordmark">G</span><strong>Grok</strong><UiIcon name="chevron-down" size={13}/></button><button className="icon-button brand-search" title="搜索会话" onClick={() => document.getElementById("session-search")?.focus()}><UiIcon name="search"/></button></div>
    <button className="new-task-button" disabled={props.busy} onClick={props.onNew}><UiIcon name="plus"/><span>新建任务</span></button>
    <div className="sidebar-context"><button className="workspace-button" onClick={() => setShowRecent(!showRecent)}><UiIcon name="folder"/><span className="workspace-name">{shortPath(props.settings?.activeWorkspace || "选择工作区")}</span><UiIcon name="chevron-down" size={13}/></button></div>
    <section className="project-tools"><button className="project-tools-heading" onClick={() => setProjectToolsOpen((value) => { const next = !value; void window.grokDesktop.updateSettings({ projectToolsOpen: next }).catch(() => undefined); return next; })} aria-expanded={projectToolsOpen}><span><UiIcon name={projectToolsOpen ? "chevron-down" : "chevron-right"} size={13}/>开发工具</span></button>{projectToolsOpen && <nav>{projectTools.map((item) => <button key={item.view} className={item.view === props.activeView ? "active" : ""} onClick={() => props.onView(item.view)}><UiIcon name={item.icon}/><span>{item.label}</span></button>)}<button onClick={() => props.onPanel("tasks")}><UiIcon name="tasks"/><span>任务</span></button><button onClick={() => props.onPanel("extensions")}><UiIcon name="extensions"/><span>扩展</span></button></nav>}</section>
    {showRecent && <WorkspaceMenu workspaces={props.workspaces} active={props.settings?.activeWorkspace || ""} onClose={closeWorkspaceMenu} onChoose={props.onChooseWorkspace} onSelect={(cwd) => { props.onRecent(cwd); setShowRecent(false); }} onOpenOffline={(workspace) => { props.onOpenWorkspaceOffline(workspace); setShowRecent(false); }} onPin={props.onPinWorkspace} onHide={props.onHideWorkspace} onRebind={props.onRebindWorkspace} onClear={props.onClear} />}
    <Suspense fallback={<div className="sidebar-tool-loading" role="status"><div className="spinner"/>加载项目工具…</div>}>
    {props.activeView === "files" ? <LazyFileExplorer workspace={props.settings?.activeWorkspace || ""} dialogs={props.dialogs} /> : props.activeView === "source-control" ? <LazyGitExplorer workspace={props.settings?.activeWorkspace || ""} dialogs={props.dialogs} /> : props.activeView === "worktrees" ? <LazyWorktreeExplorer workspace={props.settings?.activeWorkspace || ""} dialogs={props.dialogs} onOpenConversation={props.onOpenConversationTarget} /> : <>
    <div className="search"><UiIcon name="search" size={14}/><input id="session-search" value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder="搜索任务" /></div>
    <div className="session-list">
      <div className="workspace-task-group current"><div><UiIcon name="chevron-down" size={12}/><strong>{shortPath(props.settings?.activeWorkspace || "当前项目")}</strong><span>{[liveSessionCount ? `${liveSessionCount} 运行` : "", activeWorkspace?.draftCount ? `${activeWorkspace.draftCount} 草稿` : "", `${props.sessions.length} 会话`].filter(Boolean).join(" · ")}</span></div></div>
      {Boolean(activeWorkspace?.draftCount) && <div className={`session-row draft ${props.activeSessionId ? "" : "active"}`} onClick={props.onNew}><span className="status-dot cold"/><div className="session-copy"><strong>未发送草稿</strong><span>尚未启动 Grok CLI</span></div><div className="session-quick-actions"><button title="删除草稿" onClick={(event) => { event.stopPropagation(); props.onDeleteDraft(); }}><UiIcon name="trash" size={14}/></button></div></div>}
      {sessionGroups.filter((group) => group.kind === "normal" || group.sessions.length > 0).map((group) => { const collapsed = props.settings?.sessionGroupCollapsed?.[group.kind] ?? group.kind !== "normal"; return <div className={`session-origin-group ${group.kind}`} key={group.kind}><button className="session-group-heading" onClick={() => props.onToggleSessionGroup(group.kind, !collapsed)}><strong>{collapsed ? "›" : "⌄"} {group.label}</strong><span>{group.sessions.length}</span></button>{!collapsed && group.sessions.map(renderSession)}</div>; })}
      <button className="session-group-heading codex-toggle" onClick={() => props.onToggleCodex(!props.settings?.codexGroupCollapsed)}><strong>{props.settings?.codexGroupCollapsed ? "›" : "⌄"} Codex 会话</strong><span>{props.codexSessions.length}</span></button>
      {!props.settings?.codexGroupCollapsed && <><label className="archived-toggle"><input type="checkbox" checked={props.settings?.showArchivedCodex ?? false} onChange={(event) => props.onToggleArchived(event.target.checked)} />显示归档</label>{props.codexSessions.map((session) => <div key={session.id} className={`session-row codex ${props.activeCodexId === session.id ? "active" : ""}`} onClick={() => props.onOpenCodex(session)}><span className="codex-mark">C</span><div className="session-copy"><strong>{session.title}</strong><span>{relativeTime(session.updatedAt)}{session.archived ? " · 已归档" : ""}</span></div><div className="session-actions"><button title="从镜像列表隐藏" onClick={(event) => { event.stopPropagation(); props.onHideCodex(session); }}>×</button></div></div>)}</>}
      <button className="session-group-heading claude-toggle" onClick={() => props.onToggleClaude(!props.settings?.claudeGroupCollapsed)}><strong>{props.settings?.claudeGroupCollapsed ? "›" : "⌄"} Claude 会话</strong><span>{props.claudeSessions.length}</span></button>
      {!props.settings?.claudeGroupCollapsed && props.claudeSessions.map((session) => <div key={session.id} className={`session-row claude ${props.activeClaudeId === session.id ? "active" : ""}`} onClick={() => props.onOpenClaude(session)}><span className="claude-mark">A</span><div className="session-copy"><strong>{session.title}</strong><span>{relativeTime(session.updatedAt)}{session.model ? ` · ${session.model}` : ""}</span></div><div className="session-actions"><button title="从镜像列表隐藏" onClick={(event) => { event.stopPropagation(); props.onHideClaude(session); }}>×</button></div></div>)}
      {props.workspaces.filter((workspace) => workspace.exists && workspace.cwd.toLocaleLowerCase() !== (props.settings?.activeWorkspace || "").toLocaleLowerCase()).slice(0, 8).map((workspace) => <button className="workspace-task-group collapsed" key={workspace.cwd} title={`${workspace.cwd} · 点击后按需加载任务`} onClick={() => props.onRecent(workspace.cwd)}><UiIcon name="chevron-right" size={12}/><strong>{workspace.name}</strong><span>{workspace.grokSessions}</span></button>)}
    </div></>}
    </Suspense>
    <div className="sidebar-footer"><button onClick={() => props.onPanel("accounts")}><span className="avatar">{activeAccount?.label.slice(0, 1).toUpperCase() || "?"}</span><span>{activeAccount?.label || "登录账号"}</span></button><button title="版本与更新" onClick={() => props.onPanel("about")}><UiIcon name="download"/><span>{props.version}</span></button><button className="icon-button" title="设置" onClick={() => props.onPanel("settings")}><UiIcon name="settings"/></button></div>
  </aside>;
}

function WorkspaceMenu({ workspaces, active, onClose, onChoose, onSelect, onOpenOffline, onPin, onHide, onRebind, onClear }: { workspaces: WorkspaceSummary[]; active: string; onClose(): void; onChoose(): void; onSelect(cwd: string): void; onOpenOffline(workspace: WorkspaceSummary): void; onPin(workspace: WorkspaceSummary): void; onHide(workspace: WorkspaceSummary): void; onRebind(workspace: WorkspaceSummary): void; onClear(): void }): React.JSX.Element {
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
  const groups: Array<{ source: WorkspaceSummary["sources"][number]; label: string }> = [{ source: "pinned", label: "置顶" }, { source: "recent", label: "最近" }, { source: "grok", label: "已有 Grok 历史" }, { source: "codex", label: "已有 Codex 项目" }, { source: "claude", label: "已有 Claude 项目" }];
  const seen = new Set<string>();
  return <div className="workspace-menu" ref={menuRef} role="dialog" aria-label="选择工作区"><header><strong>选择工作区</strong><button className="icon-button" aria-label="关闭工作区选择器" onClick={onClose}><UiIcon name="close"/></button></header><label className="workspace-menu-search"><UiIcon name="search" size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目或路径" /></label><button className="choose-workspace" onClick={onChoose}><UiIcon name="folder"/>选择其他文件夹…</button><div className="workspace-menu-scroll">{groups.map((group) => {
    const needle = query.trim().toLocaleLowerCase();
    const rows = workspaces.filter((row) => row.sources.includes(group.source) && !seen.has(row.projectId) && (!needle || `${row.name} ${row.displayPath}`.toLocaleLowerCase().includes(needle)));
    rows.forEach((row) => seen.add(row.projectId));
    return rows.length ? <div className="workspace-group" key={group.source}><strong>{group.label}</strong>{rows.map((workspace) => <div className={`workspace-row ${samePath(workspace.cwd, active) ? "active" : ""}`} key={workspace.projectId}><button title={workspace.exists ? workspace.displayPath : `${workspace.diagnostic || "路径已失效"}；点击离线查看本地历史`} onClick={() => workspace.exists ? onSelect(workspace.cwd) : onOpenOffline(workspace)}><span>{workspace.name}</span><small>{workspace.exists ? `${workspace.grokSessions} Grok · ${workspace.codexSessions} Codex · ${workspace.claudeSessions} Claude${workspace.draftCount ? ` · ${workspace.draftCount} 草稿` : ""}` : `${workspace.grokSessions} Grok · 路径已失效 · 可离线查看`}</small></button>{!workspace.exists && <button title="把这些会话重新绑定到新项目位置" onClick={() => onRebind(workspace)}>迁移</button>}<button title={workspace.pinned ? "取消置顶" : "置顶"} onClick={() => onPin(workspace)}>◆</button><button title={samePath(workspace.cwd, active) ? "当前项目不能隐藏" : "从项目列表隐藏"} disabled={samePath(workspace.cwd, active)} onClick={() => onHide(workspace)}>×</button></div>)}</div> : null;
  })}</div>{active && <button className="danger-link workspace-clear" onClick={onClear}>清空当前工作区会话…</button>}</div>;
}


function shortPath(value: string): string { const parts = value.split(/[\\/]/).filter(Boolean); return parts.at(-1) || value; }
function samePath(left: string, right: string): boolean { return left.replace(/[\\/]+$/, "").toLocaleLowerCase() === right.replace(/[\\/]+$/, "").toLocaleLowerCase(); }
function relativeTime(value: string): string { const time = Date.parse(value); if (!Number.isFinite(time)) return "未知时间"; const delta = Date.now() - time; if (delta < 60_000) return "刚刚"; if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`; if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`; return `${Math.floor(delta / 86_400_000)} 天前`; }
