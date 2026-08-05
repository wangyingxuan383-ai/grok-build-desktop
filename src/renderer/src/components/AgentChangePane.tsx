import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { AgentChangeIndex, AgentFileChange, NavigationIntent } from "../../../shared/types";
import { UiIcon } from "../ui-icons";

const DiffEditor = lazy(async () => {
  (await import("../monaco")).configureMonaco();
  const module = await import("@monaco-editor/react");
  return { default: module.DiffEditor };
});

/**
 * Review for workspaces that are not Git repositories, built from the real
 * before/after text of the agent's own writes.
 *
 * This is deliberately not a Git stand-in — there is no staging, committing or
 * branching here, and none is implied. It is also strictly more faithful than
 * `git status` for this question: a file the agent edited and then reverted, or
 * one already committed, still shows up because the agent really did write it.
 */
export function AgentChangePane({ sessionId, onClose, onNavigate, onError }: {
  sessionId?: string;
  onClose(): void;
  onNavigate(intent: NavigationIntent): void;
  onError(message: string): void;
}): React.JSX.Element {
  const [scope, setScope] = useState<"last-turn" | "session">("last-turn");
  const [index, setIndex] = useState<AgentChangeIndex>();
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [light, setLight] = useState(() => document.documentElement.dataset.themeResolved === "light");
  const mountedRef = useRef(true);
  const refreshGenerationRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      refreshGenerationRef.current += 1;
    };
  }, []);
  useEffect(() => {
    const update = (): void => setLight(document.documentElement.dataset.themeResolved === "light");
    document.documentElement.addEventListener("grok-theme-change", update);
    return () => document.documentElement.removeEventListener("grok-theme-change", update);
  }, []);

  const refresh = async (next = scope): Promise<void> => {
    const generation = ++refreshGenerationRef.current;
    const isCurrent = (): boolean => mountedRef.current && generation === refreshGenerationRef.current;
    if (!sessionId) {
      if (isCurrent()) { setIndex(undefined); setLoading(false); }
      return;
    }
    setLoading(true);
    setIndex(undefined);
    try {
      const value = await window.grokDesktop.getAgentChanges(sessionId, next);
      if (isCurrent()) setIndex(value);
    } catch (error) {
      if (isCurrent()) onError(error instanceof Error ? error.message : String(error));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };
  useEffect(() => {
    void refresh(scope);
    return () => { refreshGenerationRef.current += 1; };
  }, [sessionId, scope]);

  const files = index?.files ?? [];
  const selected = useMemo(() => files.find((file) => file.id === selectedId) ?? files[0], [files, selectedId]);

  return <aside className="review-pane agent-change-pane" aria-label="Agent 改动">
    <header className="review-header">
      <div><strong>Agent 改动</strong><span>非 Git 工作区 · 来自本会话真实写入</span></div>
      <button className="icon-button" aria-label="关闭 Agent 改动" onClick={onClose}><UiIcon name="close"/></button>
    </header>
    <div className="review-scopes">
      <button className={scope === "last-turn" ? "active" : ""} onClick={() => setScope("last-turn")}>本回合</button>
      <button className={scope === "session" ? "active" : ""} onClick={() => setScope("session")}>整个会话</button>
      <button onClick={() => void refresh()} disabled={loading}><UiIcon name="refresh"/> 刷新</button>
    </div>
    {loading && <div className="review-empty">正在读取本会话的写入记录…</div>}
    {!loading && !sessionId && <div className="review-empty">请先打开一个会话。</div>}
    {!loading && sessionId && files.length === 0 && <div className="review-empty">
      <strong>{scope === "last-turn" ? "最近一回合没有写入文件" : "本会话还没有写入文件"}</strong>
      <span>这里只显示 Agent 真实执行过的写入，不会读取工作区里你自己的改动。</span>
    </div>}
    {!loading && files.length > 0 && <div className="review-body">
      <nav className="agent-change-list">{files.map((file) => <button
        key={file.id}
        className={`${selected?.id === file.id ? "active" : ""} ${file.status === "failed" ? "failed" : ""}`}
        title={file.absolutePath}
        onClick={() => setSelectedId(file.id)}
      >
        <span className="agent-change-path">{file.path}</span>
        <span className="agent-change-tag">{file.additions !== undefined || file.deletions !== undefined ? <><i>+{file.additions ?? 0}</i> <b>-{file.deletions ?? 0}</b></> : baselineLabel(file)}</span>
      </button>)}</nav>
      <main className="review-selected-file">{selected ? <AgentChangeDetail file={selected} light={light} onNavigate={onNavigate} cwd={index?.cwd ?? ""} sessionId={sessionId}/> : null}</main>
    </div>}
  </aside>;
}

function AgentChangeDetail({ file, light, cwd, sessionId, onNavigate }: {
  file: AgentFileChange; light: boolean; cwd: string; sessionId?: string; onNavigate(intent: NavigationIntent): void;
}): React.JSX.Element {
  const [wrap, setWrap] = useState(true);
  const noBaseline = file.baseline !== "captured";
  return <>
    <header className="agent-change-header">
      <strong title={file.path}>{file.path}</strong>
      <span className="agent-change-actions">
        {(file.additions !== undefined || file.deletions !== undefined) && <em className="agent-change-stats"><i>+{file.additions ?? 0}</i><b>-{file.deletions ?? 0}</b></em>}
        <button type="button" aria-pressed={wrap} onClick={() => setWrap((value) => !value)}>{wrap ? "取消换行" : "自动换行"}</button>
        <button type="button" onClick={() => onNavigate({ sessionId, executionRoot: cwd, targetPath: file.path, surface: "editor" })}>打开文件</button>
      </span>
    </header>
    {file.status === "failed" && <p className="agent-change-note failed">这次写入被记录为失败，下面的内容是 Agent 当时尝试写入的结果。</p>}
    {(file.beforeTruncated || file.afterTruncated) && <p className="agent-change-note">内容较大，仅保留前 256 KiB 用于对比。</p>}
    {noBaseline
      ? <>
          <p className="agent-change-note">
            {file.baseline === "missing-before"
              ? "没有捕获到写入前的内容，因此无法给出对比；下面是写入后的结果。"
              : "这次写入没有留下可对比的文本内容。"}
          </p>
          {file.after !== undefined && <pre className="agent-change-after">{file.after}</pre>}
        </>
      : <Suspense fallback={<div className="diff-loading">正在加载 Diff…</div>}>
          <DiffEditor
            height="100%"
            original={file.before}
            modified={file.after ?? ""}
            theme={light ? "vs" : "vs-dark"}
            options={{
              readOnly: true,
              renderSideBySide: false,
              wordWrap: wrap ? "on" : "off",
              diffWordWrap: wrap ? "on" : "off",
              minimap: { enabled: false },
              automaticLayout: true,
              scrollBeyondLastLine: false,
              lineNumbersMinChars: 3,
              overviewRulerLanes: 0,
              scrollbar: { horizontalScrollbarSize: 8, verticalScrollbarSize: 8 },
            }}
          />
        </Suspense>}
  </>;
}

function baselineLabel(file: AgentFileChange): string {
  if (file.status === "failed") return "失败";
  if (file.baseline === "missing-before") return "无基线";
  if (file.baseline === "none") return "无内容";
  return "可对比";
}
