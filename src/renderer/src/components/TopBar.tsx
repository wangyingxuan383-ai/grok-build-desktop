import { ActionMenu, type UiAction } from "./ui/ActionMenu";
import { UiDialog } from "./ui/primitives";
import { useEffect, useRef, useState } from "react";
import type { ClaudeSessionSummary, CodexSessionSummary, ExternalOpenTool, SessionSummary } from "../../../shared/types";
import { preferredOpenLocation } from "../session-ui-guards";
import { useAppStore } from "../store";
import { useWorkbenchStore, type WorkbenchView } from "../workbench-store";
import { UiIcon } from "../ui-icons";
import { Button, IconButton } from "./ui/Button";

export type TopBarPanel = "settings" | "accounts" | "extensions" | "tasks" | "history" | "media";

export function TopBar({ pageTitle, session, codex, claude, workspace, workbenchView, view, busy, rightToolOpen, onView, onPanel, onToggleSidebar, onToggleRightTool, onReturnToChat }: { pageTitle?: string; session?: SessionSummary; codex?: CodexSessionSummary; claude?: ClaudeSessionSummary; workspace: string; workbenchView: WorkbenchView; view: ReturnType<typeof useAppStore.getState>["views"][string] | undefined; busy: boolean; rightToolOpen: boolean; onView(view: WorkbenchView): void; onPanel(panel: TopBarPanel): void; onToggleSidebar(): void; onToggleRightTool(): void; onReturnToChat(): void }): React.JSX.Element {
  const activeWorkspace = useAppStore((state) => state.settings?.activeWorkspace);
  const setSessions = useAppStore((state) => state.setSessions);
  const activeEditorPath = useWorkbenchStore((state) => state.tabs.find((tab) => tab.key === state.activeTabKey)?.document.path);
  const [locationFeedback, setLocationFeedback] = useState<{ message: string; kind: "success" | "error" }>();
  const [openTools, setOpenTools] = useState<ExternalOpenTool[]>([]);
  const locationOperationRef = useRef(0);
  const activeAccount = useAppStore((state) => state.accounts.find((value) => value.active));
  const source = session?.originKind === "automation" ? " · 定时任务" : session?.originKind === "codex-continuation" ? " · Codex 接力" : session?.originKind === "claude-continuation" ? " · Claude 接力" : session?.originKind === "fork" ? " · 分叉会话" : "";
  const title = pageTitle || (workbenchView === "artifacts" ? "产物预览" : workbenchView === "browser" ? "浏览器" : workbenchView === "terminal" ? "终端" : workbenchView === "files" ? "文件工作台" : workbenchView === "source-control" ? "源代码管理" : workbenchView === "worktrees" ? "隔离 Worktree" : workbenchView === "memory" ? "跨会话 Memory" : workbenchView === "agents" ? "Agent 与 Persona 中心" : workbenchView === "profiles" ? "会话执行配置档" : workbenchView === "dashboard" ? "Agent Dashboard" : claude?.title || codex?.title || session?.title || "新会话");
  const contextLabel = workbenchView === "files" ? " · 轻量编辑器" : workbenchView === "source-control" ? " · Git 工作台" : workbenchView === "worktrees" ? " · 安全应用与清理" : workbenchView === "memory" ? " · 原生布局与安全编辑" : workbenchView === "agents" ? " · 来源、校验与原子保存" : workbenchView === "profiles" ? " · 全局与项目 AppData" : workbenchView === "dashboard" ? " · 父子 Agent 生命周期" : claude ? " · Claude 只读镜像" : codex ? " · Codex 只读镜像" : source;
  const location = preferredOpenLocation({ claudeCwd: claude?.cwd, codexCwd: codex?.cwd, executionRoot: workspace, sessionCwd: session?.cwd });
  useEffect(() => {
    locationOperationRef.current += 1;
    setLocationFeedback(undefined);
  }, [location]);
  useEffect(() => { void window.grokDesktop.listOpenTargetTools().then(setOpenTools).catch(() => setOpenTools([])); }, []);
  const refresh = async (): Promise<void> => { const cwd = activeWorkspace || session?.cwd; if (cwd) setSessions(await window.grokDesktop.listSessions(cwd)); };
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const onError = useAppStore(state => state.setError);
  const rename = async () => { if (!session || !renameValue.trim()) return; setRenameBusy(true); try { await window.grokDesktop.renameSession(session.id, renameValue.trim()); await refresh(); setRenameOpen(false); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } finally { setRenameBusy(false); } };
  const openLocation = async (action: "open" | "reveal" | "copy-path", target = location): Promise<void> => {
    if (!target) return;
    const operation = ++locationOperationRef.current;
    try {
      const result = await window.grokDesktop.openTarget({ target, sessionId: session?.id, executionRoot: workspace, action });
      if (operation !== locationOperationRef.current) return;
      setLocationFeedback({ message: result.message, kind: result.ok ? "success" : "error" });
    } catch (error) {
      if (operation !== locationOperationRef.current) return;
      setLocationFeedback({ message: error instanceof Error ? error.message : String(error), kind: "error" });
    }
    window.setTimeout(() => {
      if (operation === locationOperationRef.current) setLocationFeedback(undefined);
    }, 3_000);
  };
  const openWith = async (tool: ExternalOpenTool, target: string, line?: number, column?: number): Promise<void> => {
    const operation = ++locationOperationRef.current;
    try {
      const result = await window.grokDesktop.openTarget({ target, sessionId: session?.id, executionRoot: workspace, action: "open-with", applicationId: tool.id, line, column });
      if (operation !== locationOperationRef.current) return;
      setLocationFeedback({ message: result.message, kind: result.ok ? "success" : "error" });
    } catch (error) {
      if (operation !== locationOperationRef.current) return;
      setLocationFeedback({ message: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  };
  const directoryTools = openTools.filter((tool) => tool.targetKinds.includes("directory") && tool.id !== "explorer");
  const fileTools = activeEditorPath ? openTools.filter((tool) => tool.targetKinds.includes("file") && tool.id !== "explorer") : [];
  const sessionActions: UiAction[] = session ? [
    { id: "rename", label: "重命名", run: () => { setRenameValue(session.title); setRenameOpen(true); } },
    { id: "pin", label: session.pinned ? "取消置顶" : "置顶", run: async () => { await window.grokDesktop.pinSession(session.id, !session.pinned); await refresh(); } },
    { id: "archive", label: session.archived ? "取消归档" : "归档", run: async () => { await window.grokDesktop.archiveSession(session.id, !session.archived); await refresh(); } },
    { id: "history", label: "历史、分叉与回退", run: () => onPanel("history") },
  ] : [];
  const locationActions: UiAction[] = [
    { id: "open", label: "在资源管理器打开", run: () => openLocation("open") },
    { id: "copy", label: "复制执行目录", run: () => openLocation("copy-path") },
    ...(directoryTools.length ? [{ id: "apps", label: "使用应用打开", children: directoryTools.map(tool => ({ id: tool.id, label: tool.label, run: () => openWith(tool, location) })) }] : []),
    ...(activeEditorPath ? [{ id: "file", label: "当前文件", children: [
      { id: "reveal", label: "在资源管理器中定位", run: () => openLocation("reveal", activeEditorPath) },
      ...(fileTools.length ? [{ id: "file-apps", label: "使用应用打开", children: fileTools.map(tool => ({ id: tool.id, label: tool.label, run: () => openWith(tool, activeEditorPath) })) }] : []),
    ] }] : []),
  ];
  const folderName = location.split(/[\\/]/).filter(Boolean).at(-1) || location;
  const onSessionPage = !pageTitle && workbenchView === "chat";
  return <><header className="topbar">
    <IconButton icon="panel-left" label="显示或隐藏左侧栏" onClick={onToggleSidebar} />
    {(pageTitle || workbenchView !== "chat") && <Button variant="ghost" size="sm" icon="chevron-left" className="return-to-chat" onClick={onReturnToChat}>返回会话</Button>}
    <div className="tb-title">
      {onSessionPage && session
        ? <ActionMenu align="start" actions={sessionActions} onError={onError} trigger={<button type="button" className="tb-title-btn" title="会话操作"><strong>{title}</strong><UiIcon name="chevron-down" size={13}/></button>}/>
        : <strong className="tb-title-text">{title}</strong>}
      {contextLabel && <span className="tb-context">{contextLabel.replace(/^ · /, "")}</span>}
    </div>
    {location && <ActionMenu align="start" actions={locationActions} onError={onError} trigger={<button type="button" className="tb-chip" title={`${location}
打开位置与外部应用`}><UiIcon name="folder" size={13}/><span>{folderName}</span></button>}/>}
    {locationFeedback && <span className={`open-location-feedback ${locationFeedback.kind}`} role={locationFeedback.kind === "error" ? "alert" : "status"}>{locationFeedback.message}</span>}
    <span className="tb-spacer"/>
    <IconButton icon="search" label="搜索命令和会话 · Ctrl+K" onClick={() => window.dispatchEvent(new Event("grok:command-search"))} />
    {onSessionPage && <IconButton icon="panel" className="review-toggle" label="显示或隐藏右侧窗格" active={rightToolOpen} onClick={onToggleRightTool} />}
    <span className={`connection ${busy ? "working" : ""}`} title={busy ? "Grok 正在工作" : "空闲"}/>
    <ActionMenu onError={onError} trigger={<button type="button" className="ui-icon-btn ui-icon-btn-md" aria-label="更多工作区操作" title="更多"><UiIcon name="more"/></button>} actions={[
      { id: "tasks", label: "定时任务", icon: <UiIcon name="clock"/>, run: () => onPanel("tasks") },
      { id: "extensions", label: "技能与扩展", icon: <UiIcon name="extensions"/>, run: () => onPanel("extensions") },
      { id: "memory", label: "Memory", icon: <UiIcon name="memory"/>, run: () => onView("memory") },
      { id: "media", label: "创作", icon: <UiIcon name="sparkles"/>, run: () => onPanel("media") },
      { id: "account", label: activeAccount?.label || "账号", icon: <UiIcon name="account"/>, separatorBefore: true, run: () => onPanel("accounts") },
      { id: "settings", label: "设置", icon: <UiIcon name="settings"/>, run: () => onPanel("settings") },
    ]}/>
  </header><UiDialog title="重命名任务" open={renameOpen} onOpenChange={open => { if (!renameBusy) setRenameOpen(open); }}><form onSubmit={event => { event.preventDefault(); void rename(); }}><label className="ui-field"><span>任务名称</span><input className="ui-input" autoFocus value={renameValue} onChange={event => setRenameValue(event.target.value)} disabled={renameBusy}/></label><div className="ui-dialog-actions"><Button variant="ghost" onClick={() => setRenameOpen(false)} disabled={renameBusy}>取消</Button><Button type="submit" variant="primary" loading={renameBusy} disabled={!renameValue.trim()}>保存</Button></div></form></UiDialog></>;
}
