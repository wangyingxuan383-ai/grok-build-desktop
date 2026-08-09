import { useEffect, useMemo, useState } from "react";
import type { BackgroundTaskSummary, CliRuntimeUpdate, EditorDocument, NavigationIntent, PromptQueueEntry } from "../../../shared/types";
import { canOpenRecentFileDiff } from "../session-ui-guards";
import type { UiChatTurn } from "../store";
import { UiIcon, type UiIconName } from "../ui-icons";
import { LazyMarkdownView } from "./LazyMarkdownView";

export type RightUtilityTool = "launcher" | "document" | "files" | "tasks" | "session";
export type RightTool = "review" | "agent-changes" | RightUtilityTool;

export function RightUtilityPane({ tool, turn, cwd, sessionId, paths, queue, runtimeUpdates, sessionStatus, onTool, onClose, onNavigate, onExpandResult, onError }: {
  tool: RightUtilityTool;
  turn?: UiChatTurn;
  cwd: string;
  sessionId?: string;
  paths: string[];
  queue: PromptQueueEntry[];
  runtimeUpdates: CliRuntimeUpdate[];
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
    {tool === "launcher" ? <ToolLauncher cwd={cwd} onTool={onTool}/> : <nav className="right-utility-tabs"><button onClick={() => onTool("launcher")}>‹ 工具</button><button className={tool === "document" ? "active" : ""} onClick={() => onTool("document")}>计划/结果</button><button className={tool === "files" ? "active" : ""} onClick={() => onTool("files")}>文件</button><button className={tool === "tasks" ? "active" : ""} onClick={() => onTool("tasks")}>任务</button><button className={tool === "session" ? "active" : ""} onClick={() => onTool("session")}>会话</button></nav>}
    {tool === "document" && <DocumentTool turn={turn} onExpand={onExpandResult}/>}
    {tool === "files" && <FilesTool cwd={cwd} sessionId={sessionId} paths={paths} onNavigate={onNavigate} onError={onError}/>}
    {tool === "tasks" && <TasksTool sessionId={sessionId} queue={queue} runtimeUpdates={runtimeUpdates} sessionStatus={sessionStatus} onError={onError}/>}
    {tool === "session" && <SessionTool sessionId={sessionId} onError={onError}/>}
  </aside>;
}

function ToolLauncher({ cwd, onTool }: { cwd: string; onTool(tool: RightTool): void }): React.JSX.Element {
  const [gitAvailable, setGitAvailable] = useState<boolean>();
  useEffect(() => {
    let cancelled = false;
    if (!cwd) { setGitAvailable(false); return; }
    void window.grokDesktop.getGitWorkspaceCapability(cwd).then((value) => { if (!cancelled) setGitAvailable(value.available); }).catch(() => { if (!cancelled) setGitAvailable(false); });
    return () => { cancelled = true; };
  }, [cwd]);
  const reviewSurface = reviewSurfaceForCapability(gitAvailable);
  const tools: Array<{ id: RightTool; icon: UiIconName; title: string; text: string }> = [
    ...(reviewSurface === "review" ? [{ id: "review" as const, icon: "git" as const, title: "审阅", text: "Git 变更、逐文件 Diff 与行级批注" }] : []),
    ...(reviewSurface === "agent-changes" ? [{ id: "agent-changes" as const, icon: "file" as const, title: "Agent 改动", text: "非 Git 工作区：本回合/本会话的真实写入" }] : []),
    { id: "document", icon: "file", title: "计划与结果", text: "当前回合的真实计划和最终回答" },
    { id: "files", icon: "folder", title: "最近文件", text: "最近回合写入文件及只读预览" },
    { id: "tasks", icon: "tasks", title: "侧边任务", text: "Agent、后台任务、队列与等待状态" },
    { id: "session", icon: "history", title: "会话信息", text: "官方 CLI 会话元数据与精确用量" },
  ];
  return <div className="right-tool-launcher"><p>{gitAvailable === undefined ? "正在确认当前工作区的审核能力…" : "按需打开当前工作区真实可用的工具。"}</p>{tools.map((item) => <button key={item.id} onClick={() => onTool(item.id)}><UiIcon name={item.icon}/><span><strong>{item.title}</strong><small>{item.text}</small></span><UiIcon name="chevron-right"/></button>)}</div>;
}

function DocumentTool({ turn, onExpand }: { turn?: UiChatTurn; onExpand(): void }): React.JSX.Element {
  const plan = useMemo(() => turn ? [...turn.pending, ...turn.groups.flatMap((group) => group.items)].filter((item) => item.kind === "plan").at(-1) : undefined, [turn]);
  const final = turn?.final;
  return <div className="right-tool-scroll document-tool">
    <section><header><strong>计划</strong>{plan && <button onClick={() => void navigator.clipboard.writeText(plan.text)}>复制</button>}</header>{plan ? <LazyMarkdownView text={plan.text}/> : <p className="right-tool-empty">当前回合没有计划卡。</p>}</section>
    <section><header><strong>{turn?.running ? "正在生成" : "最终结果"}</strong>{final && <span><button onClick={() => void navigator.clipboard.writeText(final.text)}>复制</button><button onClick={onExpand}>在主区展开</button></span>}</header>{final ? turn?.running ? <pre className="streaming-answer">{final.text}</pre> : <LazyMarkdownView text={final.text}/> : <p className="right-tool-empty">当前回合尚无最终回答。</p>}</section>
  </div>;
}

function FilesTool({ cwd, sessionId, paths, onNavigate, onError }: { cwd: string; sessionId?: string; paths: string[]; onNavigate(intent: NavigationIntent): void; onError(message: string): void }): React.JSX.Element {
  const [selected, setSelected] = useState(paths[0] ?? "");
  const [document, setDocument] = useState<EditorDocument>();
  const [wrap, setWrap] = useState(true);
  const [externalPath, setExternalPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [gitAvailable, setGitAvailable] = useState<boolean>();
  useEffect(() => { setSelected((value) => paths.includes(value) ? value : paths[0] ?? ""); }, [paths]);
  useEffect(() => {
    let cancelled = false;
    setGitAvailable(undefined);
    if (!cwd) { setGitAvailable(false); return; }
    void window.grokDesktop.getGitWorkspaceCapability(cwd)
      .then((value) => { if (!cancelled) setGitAvailable(value.available); })
      .catch(() => { if (!cancelled) setGitAvailable(false); });
    return () => { cancelled = true; };
  }, [cwd]);
  useEffect(() => {
    if (!cwd || !selected) { setDocument(undefined); setExternalPath(""); return; }
    let cancelled = false;
    setPreviewError("");
    setExternalPath("");
    setLoading(true);
    void window.grokDesktop.openEditorDocument(cwd, selected).then((result) => { if (!cancelled) { setDocument(result.kind === "document" ? result.document : undefined); setExternalPath(result.kind === "external" ? result.path : ""); if (result.kind !== "document") setPreviewError(result.reason || "此文件需要使用外部应用打开。"); } }).catch((error) => { if (!cancelled) { setDocument(undefined); setExternalPath(""); setPreviewError(message(error)); } }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cwd, onError, selected]);
  return <div className="right-files-tool">
    <aside>{paths.map((path) => <button className={selected === path ? "active" : ""} key={path} title={path} onClick={() => setSelected(path)}><UiIcon name="file"/><span>{relativeDisplayPath(path, cwd)}</span></button>)}{!paths.length && <p className="right-tool-empty">最近回合没有可确认的写入文件。</p>}</aside>
    <main>{loading ? <p className="right-tool-empty">正在读取文件…</p> : document ? <><header><strong>{document.relativePath}</strong><span><button aria-pressed={wrap} onClick={() => setWrap((value) => !value)}>{wrap ? "不换行" : "自动换行"}</button>{canOpenRecentFileDiff(gitAvailable) && <button onClick={() => onNavigate({ sessionId, executionRoot: cwd, targetPath: document.relativePath, surface: "diff" })}>查看 Diff</button>}<button onClick={() => onNavigate({ sessionId, executionRoot: cwd, targetPath: document.relativePath, surface: "editor" })}>编辑文件</button></span></header><pre className={wrap ? "wrap" : ""}>{document.content}</pre></> : selected ? <div className="right-tool-empty"><strong>无法预览此文件</strong><p>{previewError || "文件不存在、已移动或不在当前会话的受信任执行目录内。"}</p>{externalPath && <button onClick={() => void window.grokDesktop.openPath(externalPath).catch((error) => onError(message(error)))}>用系统默认应用打开</button>}</div> : null}</main>
  </div>;
}

function TasksTool({ sessionId, queue, runtimeUpdates, sessionStatus, onError }: { sessionId?: string; queue: PromptQueueEntry[]; runtimeUpdates: CliRuntimeUpdate[]; sessionStatus?: string; onError(message: string): void }): React.JSX.Element {
  const [tasks, setTasks] = useState<BackgroundTaskSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    const refresh = (): void => { void window.grokDesktop.listBackgroundTasks().then((values) => { if (!cancelled) setTasks(values.filter((value) => !sessionId || !value.sessionId || value.sessionId === sessionId)); }).catch((error) => { if (!cancelled) onError(message(error)); }); };
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [onError, sessionId]);
  return <div className="right-tool-scroll tasks-tool"><section><header><strong>会话状态</strong><span className={`utility-status status-${sessionStatus ?? "idle"}`}>{sessionStatusLabel(sessionStatus)}</span></header>{queue.length ? queue.map((item) => <article key={item.id}><UiIcon name="tasks"/><div><strong>{item.text || "附件消息"}</strong><small>队列 #{item.position} · {item.state}</small></div></article>) : <p className="right-tool-empty">没有排队消息。</p>}</section><section><header><strong>后台与 Agent</strong><span>{tasks.length}</span></header>{tasks.map((task) => <article key={task.id}><span className={`task-dot status-${task.status}`}/><div><strong>{task.title}</strong><small>{task.kind} · {task.status} · {new Date(task.updatedAt).toLocaleTimeString()}</small>{task.detail && <p>{task.detail}</p>}</div></article>)}{!tasks.length && <p className="right-tool-empty">当前没有后台任务或等待事项。</p>}</section>{runtimeUpdates.length > 0 && <section><header><strong>CLI 运行时间线</strong><span>{runtimeUpdates.length}</span></header>{runtimeUpdates.slice(-20).reverse().map((item) => <article key={`${item.at}-${item.name}`}><span className="task-dot status-completed"/><div><strong>{item.name}</strong><small>{item.kind} · {new Date(item.at).toLocaleTimeString()}</small>{item.summary && <p>{item.summary}</p>}</div></article>)}</section>}</div>;
}

export function reviewSurfaceForCapability(available?: boolean): "review" | "agent-changes" | undefined {
  return available === true ? "review" : available === false ? "agent-changes" : undefined;
}

function SessionTool({ sessionId, onError }: { sessionId?: string; onError(message: string): void }): React.JSX.Element {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof window.grokDesktop.getCliSessionInfo>>>();
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof window.grokDesktop.getCliSessionUsage>>>();
  const [loading, setLoading] = useState(false);
  const refresh = (): void => {
    if (!sessionId) return;
    setLoading(true);
    void Promise.all([
      window.grokDesktop.getCliSessionInfo(sessionId),
      window.grokDesktop.getCliSessionUsage(sessionId),
    ]).then(([nextInfo, nextUsage]) => { setInfo(nextInfo); setUsage(nextUsage); }).catch((error) => onError(message(error))).finally(() => setLoading(false));
  };
  useEffect(() => { setInfo(undefined); setUsage(undefined); refresh(); }, [sessionId]);
  return <div className="right-tool-scroll session-tool">
    <section><header><strong>官方会话</strong><button onClick={refresh} disabled={loading || !sessionId}>{loading ? "读取中…" : "刷新"}</button></header>
      {!sessionId ? <p className="right-tool-empty">当前没有活动会话。</p> : info?.supported === false ? <p className="right-tool-empty">当前 CLI 未声明 session/info；不会用全局默认值猜测旧会话配置。</p> : <dl className="session-detail-list"><dt>会话 ID</dt><dd title={info?.sessionId}>{info?.sessionId || "—"}</dd><dt>标题</dt><dd>{info?.title || "未命名"}</dd><dt>工作目录</dt><dd title={info?.cwd}>{info?.cwd || "—"}</dd><dt>模型</dt><dd>{info?.modelId || "—"}</dd><dt>模式</dt><dd>{info?.mode || "CLI 未返回"}</dd><dt>思考档位</dt><dd>{info?.effort || "CLI 默认/未返回"}</dd></dl>}
    </section>
    <section><header><strong>会话用量</strong><span>{usage?.supported === false ? "未声明" : "仅显示 CLI 返回值"}</span></header>{usage?.supported === false ? <p className="right-tool-empty">当前 CLI 未提供 session/usage；不会推算 Token。</p> : <dl className="session-detail-list"><dt>输入</dt><dd>{formatOptionalTokens(usage?.inputTokens)}</dd><dt>输出</dt><dd>{formatOptionalTokens(usage?.outputTokens)}</dd><dt>缓存读取</dt><dd>{formatOptionalTokens(usage?.cachedReadTokens)}</dd><dt>推理</dt><dd>{formatOptionalTokens(usage?.reasoningTokens)}</dd><dt>总计</dt><dd>{formatOptionalTokens(usage?.totalTokens)}</dd></dl>}</section>
  </div>;
}

function readWidth(tool: RightUtilityTool): number { return Math.max(420, Math.min(760, Number(localStorage.getItem(`grok:right-width:${tool}`)) || 560)); }
function toolTitle(tool: RightUtilityTool): string { return ({ launcher: "侧栏工具", document: "计划与结果", files: "最近文件", tasks: "侧边任务", session: "会话信息" })[tool]; }
function toolSubtitle(tool: RightUtilityTool): string { return ({ launcher: "选择当前任务需要的工具", document: "当前回合", files: "最近回合实际写入", tasks: "Agent、后台、队列与等待", session: "官方 CLI 元数据与用量" })[tool]; }
function formatOptionalTokens(value?: number): string { return value === undefined ? "未返回" : value.toLocaleString(); }
function sessionStatusLabel(status?: string): string { return ({ working: "运行中", "needs-user": "等待操作", error: "失败", idle: "空闲" } as Record<string, string>)[status ?? "idle"] ?? status ?? "空闲"; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export function relativeDisplayPath(path: string, root: string): string {
  const slashPath = path.replace(/\//g, "\\");
  const slashRoot = root.replace(/\//g, "\\").replace(/\\+$/, "");
  if (!/^[A-Za-z]:\\|^\\\\/.test(slashPath) || !slashRoot) return slashPath;
  const target = slashPath.toLocaleLowerCase();
  const base = slashRoot.toLocaleLowerCase();
  return target.startsWith(`${base}\\`) ? slashPath.slice(slashRoot.length + 1) : slashPath;
}
