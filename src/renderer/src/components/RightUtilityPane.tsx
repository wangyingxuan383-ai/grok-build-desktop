import { useEffect, useMemo, useState } from "react";
import type { BackgroundTaskSummary, EditorDocument, NavigationIntent, PromptQueueEntry } from "../../../shared/types";
import type { UiChatTurn } from "../store";
import { UiIcon, type UiIconName } from "../ui-icons";
import { LazyMarkdownView } from "./LazyMarkdownView";

export type RightUtilityTool = "launcher" | "document" | "files" | "tasks";
export type RightTool = "review" | RightUtilityTool;

export function RightUtilityPane({ tool, turn, cwd, sessionId, paths, queue, sessionStatus, onTool, onClose, onNavigate, onExpandResult, onError }: {
  tool: RightUtilityTool;
  turn?: UiChatTurn;
  cwd: string;
  sessionId?: string;
  paths: string[];
  queue: PromptQueueEntry[];
  sessionStatus?: string;
  onTool(tool: RightTool): void;
  onClose(): void;
  onNavigate(intent: NavigationIntent): void;
  onExpandResult(): void;
  onError(message: string): void;
}): React.JSX.Element {
  const [width, setWidth] = useState(() => readWidth(tool));
  useEffect(() => setWidth(readWidth(tool)), [tool]);
  const beginResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const move = (value: PointerEvent): void => setWidth(Math.max(420, Math.min(760, startWidth + startX - value.clientX)));
    const finish = (): void => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); setWidth((current) => { localStorage.setItem(`grok:right-width:${tool}`, String(current)); return current; }); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
  };
  return <aside className="right-utility-pane" style={{ width }} aria-label={toolTitle(tool)}>
    <div className="review-resizer" role="separator" aria-orientation="vertical" aria-label="调整侧栏宽度" onPointerDown={beginResize}/>
    <header><div><strong>{toolTitle(tool)}</strong><span>{toolSubtitle(tool)}</span></div><button className="icon-button" aria-label="关闭侧栏" onClick={onClose}><UiIcon name="close"/></button></header>
    {tool === "launcher" ? <ToolLauncher onTool={onTool}/> : <nav className="right-utility-tabs"><button onClick={() => onTool("launcher")}>‹ 工具</button><button className={tool === "document" ? "active" : ""} onClick={() => onTool("document")}>计划/结果</button><button className={tool === "files" ? "active" : ""} onClick={() => onTool("files")}>文件</button><button className={tool === "tasks" ? "active" : ""} onClick={() => onTool("tasks")}>任务</button></nav>}
    {tool === "document" && <DocumentTool turn={turn} onExpand={onExpandResult}/>}
    {tool === "files" && <FilesTool cwd={cwd} sessionId={sessionId} paths={paths} onNavigate={onNavigate} onError={onError}/>}
    {tool === "tasks" && <TasksTool sessionId={sessionId} queue={queue} sessionStatus={sessionStatus} onError={onError}/>}
  </aside>;
}

function ToolLauncher({ onTool }: { onTool(tool: RightTool): void }): React.JSX.Element {
  const tools: Array<{ id: RightTool; icon: UiIconName; title: string; text: string }> = [
    { id: "review", icon: "git", title: "审阅", text: "Git 变更、逐文件 Diff 与行级批注" },
    { id: "document", icon: "file", title: "计划与结果", text: "当前回合的真实计划和最终回答" },
    { id: "files", icon: "folder", title: "最近文件", text: "最近回合写入文件及只读预览" },
    { id: "tasks", icon: "tasks", title: "侧边任务", text: "Agent、后台任务、队列与等待状态" },
  ];
  return <div className="right-tool-launcher"><p>按需打开真实工具。未实现的终端或浏览器不会作为占位入口出现。</p>{tools.map((item) => <button key={item.id} onClick={() => onTool(item.id)}><UiIcon name={item.icon}/><span><strong>{item.title}</strong><small>{item.text}</small></span><UiIcon name="chevron-right"/></button>)}</div>;
}

function DocumentTool({ turn, onExpand }: { turn?: UiChatTurn; onExpand(): void }): React.JSX.Element {
  const plan = useMemo(() => turn ? [...turn.pending, ...turn.groups.flatMap((group) => group.items)].filter((item) => item.kind === "plan").at(-1) : undefined, [turn]);
  const final = turn?.final;
  return <div className="right-tool-scroll document-tool">
    <section><header><strong>计划</strong>{plan && <button onClick={() => void navigator.clipboard.writeText(plan.text)}>复制</button>}</header>{plan ? <LazyMarkdownView text={plan.text}/> : <p className="right-tool-empty">当前回合没有计划卡。</p>}</section>
    <section><header><strong>最终结果</strong>{final && <span><button onClick={() => void navigator.clipboard.writeText(final.text)}>复制</button><button onClick={onExpand}>在主区展开</button></span>}</header>{final ? <LazyMarkdownView text={final.text}/> : <p className="right-tool-empty">当前回合尚无最终回答。</p>}</section>
  </div>;
}

function FilesTool({ cwd, sessionId, paths, onNavigate, onError }: { cwd: string; sessionId?: string; paths: string[]; onNavigate(intent: NavigationIntent): void; onError(message: string): void }): React.JSX.Element {
  const [selected, setSelected] = useState(paths[0] ?? "");
  const [document, setDocument] = useState<EditorDocument>();
  const [loading, setLoading] = useState(false);
  useEffect(() => { setSelected((value) => paths.includes(value) ? value : paths[0] ?? ""); }, [paths]);
  useEffect(() => {
    if (!cwd || !selected) { setDocument(undefined); return; }
    let cancelled = false;
    setLoading(true);
    void window.grokDesktop.openEditorDocument(cwd, selected).then((result) => { if (!cancelled) setDocument(result.kind === "document" ? result.document : undefined); }).catch((error) => { if (!cancelled) onError(message(error)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cwd, onError, selected]);
  return <div className="right-files-tool">
    <aside>{paths.map((path) => <button className={selected === path ? "active" : ""} key={path} title={path} onClick={() => setSelected(path)}><UiIcon name="file"/><span>{path}</span></button>)}{!paths.length && <p className="right-tool-empty">最近回合没有可确认的写入文件。</p>}</aside>
    <main>{loading ? <p className="right-tool-empty">正在读取文件…</p> : document ? <><header><strong>{document.relativePath}</strong><span><button onClick={() => onNavigate({ sessionId, executionRoot: cwd, targetPath: document.relativePath, surface: "diff" })}>查看 Diff</button><button onClick={() => onNavigate({ sessionId, executionRoot: cwd, targetPath: document.relativePath, surface: "editor" })}>编辑文件</button></span></header><pre>{document.content}</pre></> : selected ? <p className="right-tool-empty">此文件无法在应用内预览。</p> : null}</main>
  </div>;
}

function TasksTool({ sessionId, queue, sessionStatus, onError }: { sessionId?: string; queue: PromptQueueEntry[]; sessionStatus?: string; onError(message: string): void }): React.JSX.Element {
  const [tasks, setTasks] = useState<BackgroundTaskSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    const refresh = (): void => { void window.grokDesktop.listBackgroundTasks().then((values) => { if (!cancelled) setTasks(values.filter((value) => !sessionId || !value.sessionId || value.sessionId === sessionId)); }).catch((error) => { if (!cancelled) onError(message(error)); }); };
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [onError, sessionId]);
  return <div className="right-tool-scroll tasks-tool"><section><header><strong>会话状态</strong><span className={`utility-status status-${sessionStatus ?? "idle"}`}>{sessionStatusLabel(sessionStatus)}</span></header>{queue.length ? queue.map((item) => <article key={item.id}><UiIcon name="tasks"/><div><strong>{item.text || "附件消息"}</strong><small>队列 #{item.position} · {item.state}</small></div></article>) : <p className="right-tool-empty">没有排队消息。</p>}</section><section><header><strong>后台与 Agent</strong><span>{tasks.length}</span></header>{tasks.map((task) => <article key={task.id}><span className={`task-dot status-${task.status}`}/><div><strong>{task.title}</strong><small>{task.kind} · {task.status} · {new Date(task.updatedAt).toLocaleTimeString()}</small>{task.detail && <p>{task.detail}</p>}</div></article>)}{!tasks.length && <p className="right-tool-empty">当前没有后台任务或等待事项。</p>}</section></div>;
}

function readWidth(tool: RightUtilityTool): number { return Math.max(420, Math.min(760, Number(localStorage.getItem(`grok:right-width:${tool}`)) || 560)); }
function toolTitle(tool: RightUtilityTool): string { return ({ launcher: "侧栏工具", document: "计划与结果", files: "最近文件", tasks: "侧边任务" })[tool]; }
function toolSubtitle(tool: RightUtilityTool): string { return ({ launcher: "选择当前任务需要的工具", document: "当前回合", files: "最近回合实际写入", tasks: "Agent、后台、队列与等待" })[tool]; }
function sessionStatusLabel(status?: string): string { return ({ working: "运行中", "needs-user": "等待操作", error: "失败", idle: "空闲" } as Record<string, string>)[status ?? "idle"] ?? status ?? "空闲"; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
