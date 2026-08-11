import { useEffect, useRef, useState } from "react";
import type { ClaudeSessionSummary, CodexSessionSummary, ExternalOpenTool, SessionSummary } from "../../../shared/types";
import { preferredOpenLocation } from "../session-ui-guards";
import { useAppStore } from "../store";
import { useWorkbenchStore, type WorkbenchView } from "../workbench-store";
import { UiIcon } from "../ui-icons";

export type TopBarPanel = "settings" | "accounts" | "extensions" | "tasks" | "history" | "media";

export function TopBar({ session, codex, claude, workspace, workbenchView, view, busy, rightToolOpen, onView, onPanel, onToggleSidebar, onToggleRightTool, onReturnToChat }: { session?: SessionSummary; codex?: CodexSessionSummary; claude?: ClaudeSessionSummary; workspace: string; workbenchView: WorkbenchView; view: ReturnType<typeof useAppStore.getState>["views"][string] | undefined; busy: boolean; rightToolOpen: boolean; onView(view: WorkbenchView): void; onPanel(panel: TopBarPanel): void; onToggleSidebar(): void; onToggleRightTool(): void; onReturnToChat(): void }): React.JSX.Element {
  const activeWorkspace = useAppStore((state) => state.settings?.activeWorkspace);
  const setSessions = useAppStore((state) => state.setSessions);
  const activeEditorPath = useWorkbenchStore((state) => state.tabs.find((tab) => tab.key === state.activeTabKey)?.document.path);
  const [locationFeedback, setLocationFeedback] = useState<{ message: string; kind: "success" | "error" }>();
  const [openTools, setOpenTools] = useState<ExternalOpenTool[]>([]);
  const locationOperationRef = useRef(0);
  const activeAccount = useAppStore((state) => state.accounts.find((value) => value.active));
  const source = session?.originKind === "automation" ? " · 定时任务" : session?.originKind === "codex-continuation" ? " · Codex 接力" : session?.originKind === "claude-continuation" ? " · Claude 接力" : session?.originKind === "fork" ? " · 分叉会话" : "";
  const title = workbenchView === "files" ? "文件工作台" : workbenchView === "source-control" ? "源代码管理" : workbenchView === "worktrees" ? "隔离 Worktree" : workbenchView === "memory" ? "跨会话 Memory" : workbenchView === "agents" ? "Agent 与 Persona 中心" : workbenchView === "profiles" ? "会话执行配置档" : workbenchView === "dashboard" ? "Agent Dashboard" : claude?.title || codex?.title || session?.title || "新会话";
  const contextLabel = workbenchView === "files" ? " · 轻量编辑器" : workbenchView === "source-control" ? " · Git 工作台" : workbenchView === "worktrees" ? " · 安全应用与清理" : workbenchView === "memory" ? " · 原生布局与安全编辑" : workbenchView === "agents" ? " · 来源、校验与原子保存" : workbenchView === "profiles" ? " · 全局与项目 AppData" : workbenchView === "dashboard" ? " · 父子 Agent 生命周期" : claude ? " · Claude 只读镜像" : codex ? " · Codex 只读镜像" : source;
  const location = preferredOpenLocation({ claudeCwd: claude?.cwd, codexCwd: codex?.cwd, executionRoot: workspace, sessionCwd: session?.cwd });
  useEffect(() => {
    locationOperationRef.current += 1;
    setLocationFeedback(undefined);
  }, [location]);
  useEffect(() => { void window.grokDesktop.listOpenTargetTools().then(setOpenTools).catch(() => setOpenTools([])); }, []);
  const refresh = async (): Promise<void> => { const cwd = activeWorkspace || session?.cwd; if (cwd) setSessions(await window.grokDesktop.listSessions(cwd)); };
  const rename = async (): Promise<void> => { if (!session) return; const value = window.prompt("重命名任务", session.title); if (value?.trim()) { await window.grokDesktop.renameSession(session.id, value.trim()); await refresh(); } };
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
  return <header className="topbar"><button className="icon-button sidebar-toggle" title="显示或隐藏左侧栏" onClick={onToggleSidebar}><UiIcon name="panel"/></button>{workbenchView !== "chat" && <button className="return-to-chat" onClick={onReturnToChat}><span className="return-arrow">‹</span>返回会话</button>}<div className="topbar-copy">{workbenchView === "chat" && session ? <details className="task-title-menu"><summary className="topbar-heading"><UiIcon name="folder" size={15}/><strong>{title}</strong><UiIcon name="chevron-down" size={12}/></summary><div className="task-title-popover"><button onClick={() => void rename()}><UiIcon name="edit"/>重命名</button><button onClick={() => void window.grokDesktop.pinSession(session.id, !session.pinned).then(refresh)}><UiIcon name="pin"/>{session.pinned ? "取消置顶" : "置顶"}</button><button onClick={() => void window.grokDesktop.archiveSession(session.id, !session.archived).then(refresh)}><UiIcon name="archive"/>{session.archived ? "取消归档" : "归档"}</button><button onClick={() => onPanel("history")}><UiIcon name="history"/>分叉 / 回退</button><section><strong>任务信息</strong><dl><dt>状态</dt><dd>{view?.status || "未知"}</dd><dt>消息</dt><dd>{session.messageCount}</dd><dt>模型</dt><dd>{view?.currentModelId || "未知"}</dd><dt>执行目录</dt><dd title={session.cwd}>{session.cwd || "未知"}</dd></dl></section></div></details> : <div className="topbar-heading"><UiIcon name={workbenchView === "chat" ? "folder" : "workbench"} size={15}/><strong>{title}</strong></div>}<span>{location || "请选择工作区"}{contextLabel}</span></div><div className="top-actions">{location && <div className="open-location-group"><button className="open-location" onClick={() => void openLocation("open")}><UiIcon name="folder" size={14}/><span>打开位置</span></button><details><summary aria-label="打开位置选项"><UiIcon name="chevron-down" size={11}/></summary><div className="open-location-menu"><button onClick={() => void openLocation("open")}>在资源管理器打开执行目录</button><button onClick={() => void openLocation("copy-path")}>复制执行目录路径</button>{activeEditorPath && <button onClick={() => void openLocation("reveal", activeEditorPath)}>定位当前文件</button>}{directoryTools.length > 0 && <><span className="menu-section-label">使用应用打开项目</span>{directoryTools.map((tool) => <button key={`dir:${tool.id}`} title={tool.detail} onClick={() => void openWith(tool, location)}>{tool.label}</button>)}</>}{fileTools.length > 0 && activeEditorPath && <><span className="menu-section-label">打开当前文件</span>{fileTools.map((tool) => <button key={`file:${tool.id}`} title={tool.detail} onClick={() => void openWith(tool, activeEditorPath)}>{tool.label}</button>)}</>}</div></details>{locationFeedback && <span className={`open-location-feedback ${locationFeedback.kind}`} role={locationFeedback.kind === "error" ? "alert" : "status"}>{locationFeedback.message}</span>}</div>}{workbenchView === "chat" && <button className={`review-toggle ${rightToolOpen ? "active" : ""}`} title="显示或隐藏右侧工具" onClick={onToggleRightTool}><UiIcon name="panel"/><span>侧栏</span></button>}<span className={`connection ${busy ? "working" : ""}`} title={busy ? "Grok 正在工作" : "空闲"}/><details className="topbar-more"><summary className="icon-button" title="更多"><UiIcon name="more"/></summary><div className="topbar-menu"><button onClick={() => onView("memory")}><UiIcon name="memory"/>Memory</button><button onClick={() => onPanel("tasks")}><UiIcon name="tasks"/>任务中心</button><button onClick={() => onPanel("extensions")}><UiIcon name="extensions"/>扩展</button>{workbenchView === "chat" && <button onClick={() => onPanel("media")}><UiIcon name="sparkles"/>创作</button>}{activeAccount && <button onClick={() => onPanel("accounts")}><UiIcon name="account"/>{activeAccount.label}</button>}<button onClick={() => onPanel("settings")}><UiIcon name="settings"/>设置</button></div></details></div></header>;
}
