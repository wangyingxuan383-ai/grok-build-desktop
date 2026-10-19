import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { applyThemeToDocument } from "../src/theme";
import type { QuickEntryApi, QuickEntryContext } from "./contracts";
import "../src/styles/tokens.css";
import "./style.css";

declare global { interface Window { quickEntry: QuickEntryApi; } }

function QuickEntry() {
  const [context, setContext] = useState<QuickEntryContext>();
  const [text, setText] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const busyRef = useRef(false);

  const load = async (cwd?: string) => {
    const version = ++generation.current;
    try {
      const next = await window.quickEntry.context(cwd);
      if (version !== generation.current) return;
      setContext(next); setSessionId(""); setError("");
      if (!context && next.recovery) { setText(next.recovery.text); setSessionId(next.recovery.sessionId); setNotice(next.recovery.message); }
      applyThemeToDocument(next.theme, matchMedia("(prefers-color-scheme: dark)").matches);
      textarea.current?.focus();
    } catch (error) { if (version === generation.current) setError(message(error)); }
  };
  useEffect(() => { void load(); return () => { generation.current++; }; }, []);
  // Context loads before the textarea exists on the first frame. Focus after
  // React commits that frame, and after an explicit project change.
  useEffect(() => { textarea.current?.focus(); }, [context?.draftId, context?.workspace]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => { if (context) applyThemeToDocument(context.theme, media.matches); };
    media.addEventListener("change", update); return () => media.removeEventListener("change", update);
  }, [context?.theme]);

  const action = async (callback: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try { await callback(); } catch (error) { setError(message(error)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const send = () => action(async () => {
    if (!context?.workspace || (!text.trim() && !context.attachments.length)) return;
    await window.quickEntry.send({ draftId: context.draftId, cwd: context.workspace, sessionId, text, attachmentIds: context.attachments.map(row => row.id) });
  });
  const session = context?.sessions.find(row => row.id === sessionId);
  const canSend = context?.workspace && (!sessionId || session && !["working", "needs-user", "queued"].includes(session.status)) && (text.trim() || context?.attachments.length);

  return <main onKeyDownCapture={event => { if (event.key === "Escape" && !busyRef.current && !event.nativeEvent.isComposing) { event.preventDefault(); void window.quickEntry.cancel(); } }}>
    <header><div><h1>{context?.intent === "screenshot" ? "截图提问" : "快速提问"}</h1><p>选择项目与会话，继续手头的工作</p></div><button aria-label="关闭并丢弃草稿" className="close" onClick={() => void window.quickEntry.cancel()}>×</button></header>
    {context ? <>
      <div className="target">
        <label>项目<select value={context.workspace} disabled={busy} onChange={event => { setSessionId(""); void action(() => load(event.target.value)); }}>
          {!context.workspaces.length && <option value="">请先在主窗口添加项目</option>}
          {context.workspaces.map(row => <option value={row.cwd} key={row.cwd}>{row.name}</option>)}
        </select></label>
        <label>会话<select value={sessionId} disabled={busy} onChange={event => setSessionId(event.target.value)}>
          <option value="">新建会话（使用项目默认配置）</option>
          {context.sessions.map(row => <option value={row.id} key={row.id}>{row.title || "未命名会话"}{row.status === "working" ? " · 运行中" : row.status === "needs-user" ? " · 等你处理" : ""}</option>)}
        </select></label>
      </div>
      <label className="composer"><span className="sr-only">提问内容</span><textarea ref={textarea} value={text} disabled={busy} maxLength={100000} placeholder="想让 Grok 帮你做什么？" onChange={event => setText(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && canSend && !busyRef.current) { event.preventDefault(); void send(); } }} /></label>
      {!!context.attachments.length && <ul className="attachments" aria-label="附件">{context.attachments.map(row => <li key={row.id}>
        {row.previewUrl ? <img src={row.previewUrl} alt="截图预览" /> : <span className="file-icon" aria-hidden="true">↗</span>}
        <span title={row.name}>{row.name}</span><button aria-label={`移除 ${row.name}`} disabled={busy} onClick={() => void action(async () => { await window.quickEntry.remove(context.draftId, row.id); setContext({ ...context, attachments: context.attachments.filter(item => item.id !== row.id) }); })}>×</button>
      </li>)}</ul>}
      <div className="tools">
        <button disabled={busy} onClick={() => void action(async () => { const attachments = await window.quickEntry.files(context.draftId); setContext({ ...context, attachments }); })}>添加附件</button>
        <button disabled={busy} onClick={() => void action(async () => { const value = await window.quickEntry.clipboard(context.draftId); setContext({ ...context, attachments: value.attachments }); if (value.text) setText(current => [current, value.text].filter(Boolean).join("\n")); else if (!value.attachments.length) setNotice("剪贴板中没有文字或图片。"); })}>引用剪贴板</button>
        <button disabled={busy} onClick={() => void action(async () => { await window.quickEntry.snip(context.draftId); setNotice("完成系统截图后，点“引用剪贴板”附上截图；取消截图则无需引用。"); })}>系统截图…</button>
      </div>
      {(notice || context.intent === "screenshot") && <p className="hint" role="status">{notice || "点“系统截图”选择区域，再点“引用剪贴板”。截图会留在草稿中，等你确认发送。"}</p>}
      {context.warnings.map(warning => <p key={warning} className="warning">{warning}</p>)}
      <footer><span>Enter 发送 · Shift+Enter 换行 · Esc 关闭<br />关闭会丢弃此草稿，主窗口草稿保留。</span><button className="primary" disabled={busy || !canSend} onClick={() => void send()}>{busy ? "请稍候…" : "发送到会话"}</button></footer>
    </> : <p className="hint">正在读取项目与会话…</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </main>;
}
function message(error: unknown): string { return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : String(error); }
createRoot(document.getElementById("root")!).render(<QuickEntry />);
