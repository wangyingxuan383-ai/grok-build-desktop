import { useEffect, useMemo, useRef, useState } from "react";
import { fillPromptSnippet, promptSnippetVariables, searchPromptSnippets, type PromptSnippet, type PromptSnippetApi, type PromptSnippetInput } from "../../../shared/prompt-snippets";
import { errorMessage } from "../error-message";
import { UiDialog } from "./ui/primitives";
import "../styles/snippet-library.css";

export function SnippetLibrary({ seed, query = "", onInsert, onClose }: {
  seed: string;
  query?: string;
  onInsert(text: string): void;
  onClose(): void;
}): React.JSX.Element {
  const [rows, setRows] = useState<PromptSnippet[]>([]);
  const [search, setSearch] = useState(query);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<PromptSnippetInput>();
  const [selected, setSelected] = useState<PromptSnippet>();
  const [deleting, setDeleting] = useState<string>();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const alive = useRef(false);
  const api = window.grokDesktop as typeof window.grokDesktop & Partial<PromptSnippetApi>;
  const matches = useMemo(() => searchPromptSnippets(rows, search), [rows, search]);

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    setLoading(true);
    if (!api.listPromptSnippets) { setError("片段库尚未连接，请更新桌面应用后重试。"); setLoading(false); }
    else void api.listPromptSnippets().then(value => { if (!cancelled) { setRows(value); setError(""); } })
      .catch(reason => { if (!cancelled) setError(errorMessage(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; alive.current = false; };
  }, [revision]);

  const mutate = async (action: () => Promise<PromptSnippet[]>, done: () => void): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try { const value = await action(); if (alive.current) { setRows(value); done(); } }
    catch (reason) { if (alive.current) setError(errorMessage(reason)); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  };
  const close = (): void => { if (!busyRef.current) onClose(); };
  const choose = (snippet: PromptSnippet): void => {
    if (promptSnippetVariables(snippet.body).length) setSelected(snippet);
    else onInsert(snippet.body);
  };

  return <UiDialog title="提示词片段" open onOpenChange={open => { if (!open) close(); }}>
    <div className="snippet-library" aria-busy={loading || busy}>
      {error && <p className="snippet-error" role="alert">{error} <button type="button" disabled={busy} onClick={() => setRevision(value => value + 1)}>重新读取</button></p>}
      {selected ? <SnippetVariableForm key={selected.id} snippet={selected} onInsert={onInsert} onBack={() => setSelected(undefined)} /> : editing ? <form onSubmit={event => {
        event.preventDefault();
        if (!editing.title.trim() || !editing.body.trim() || !api.savePromptSnippet) return;
        void mutate(() => api.savePromptSnippet!({ ...editing, title: editing.title.trim() }), () => setEditing(undefined));
      }}>
        <label>标题<input autoFocus required maxLength={100} value={editing.title} disabled={busy} onChange={event => setEditing({ ...editing, title: event.target.value })} /></label>
        <label>正文<textarea required rows={8} value={editing.body} disabled={busy} onChange={event => setEditing({ ...editing, body: event.target.value })} /></label>
        <small>用 {"{{变量名}}"} 留出填写位置。使用时先填写，再插入草稿。</small>
        <footer><button type="button" disabled={busy} onClick={() => setEditing(undefined)}>返回列表</button><button type="submit" disabled={busy || !api.savePromptSnippet || !editing.title.trim() || !editing.body.trim()}>{busy ? "保存中…" : "保存片段"}</button></footer>
      </form> : <>
        <div className="snippet-library-tools"><input autoFocus aria-label="搜索片段" placeholder="搜索标题和正文…" value={search} onChange={event => { setSearch(event.target.value); setDeleting(undefined); }} /><button type="button" disabled={loading || busy || !api.savePromptSnippet} onClick={() => setEditing({ title: "", body: seed })}>新建片段</button></div>
        <p className="snippet-help">选择后填入草稿；不会自动发送。原生 /命令保持可用。</p>
        {loading ? <p role="status">正在读取片段…</p> : <SnippetList rows={matches} busy={busy} deleting={deleting} onUse={choose} onEdit={snippet => { setDeleting(undefined); setEditing({ ...snippet }); }} onDelete={snippet => {
          if (deleting !== snippet.id) { setDeleting(snippet.id); return; }
          if (api.deletePromptSnippet) void mutate(() => api.deletePromptSnippet!(snippet.id, snippet.updatedAt), () => setDeleting(undefined));
        }} onCancelDelete={() => setDeleting(undefined)} />}
      </>}
    </div>
  </UiDialog>;
}

export function SnippetList({ rows, busy, deleting, onUse, onEdit, onDelete, onCancelDelete }: {
  rows: readonly PromptSnippet[]; busy: boolean; deleting?: string;
  onUse(snippet: PromptSnippet): void; onEdit(snippet: PromptSnippet): void; onDelete(snippet: PromptSnippet): void; onCancelDelete(): void;
}): React.JSX.Element {
  return <div className="snippet-list" aria-label="已保存片段">{rows.length ? rows.map(snippet => <article key={snippet.id}>
    <button type="button" className="snippet-use" disabled={busy} onClick={() => onUse(snippet)}><strong>{snippet.title}</strong><span>{snippet.body}</span><small>{promptSnippetVariables(snippet.body).length ? "填写变量后插入" : "插入草稿"}</small></button>
    <div className="snippet-row-actions"><button type="button" disabled={busy} aria-label={`编辑 ${snippet.title}`} onClick={() => onEdit(snippet)}>编辑</button><button type="button" disabled={busy} aria-label={`${deleting === snippet.id ? "确认删除" : "删除"} ${snippet.title}`} onClick={() => onDelete(snippet)}>{deleting === snippet.id ? "确认删除" : "删除"}</button>{deleting === snippet.id && <button type="button" disabled={busy} onClick={onCancelDelete}>取消</button>}</div>
  </article>) : <p className="snippet-help">没有匹配的片段。可用当前草稿新建。</p>}</div>;
}

export function SnippetVariableForm({ snippet, onInsert, onBack }: { snippet: PromptSnippet; onInsert(text: string): void; onBack(): void }): React.JSX.Element {
  const variables = useMemo(() => promptSnippetVariables(snippet.body), [snippet.body]);
  const [values, setValues] = useState<Record<string, string>>({});
  const result = useMemo(() => fillPromptSnippet(snippet.body, values), [snippet.body, values]);
  return <form className="snippet-variable-form" onSubmit={event => { event.preventDefault(); if (!result.missing.length) onInsert(result.text); }}>
    <strong>{snippet.title}</strong>
    {variables.map((name, index) => <label key={name}>{name}<input autoFocus={index === 0} required value={Object.hasOwn(values, name) ? values[name] : ""} onChange={event => setValues(current => ({ ...current, [name]: event.target.value }))} /></label>)}
    <label>插入预览<textarea readOnly rows={6} value={result.text} /></label>
    <footer><button type="button" onClick={onBack}>返回列表</button><button type="submit" disabled={result.missing.length > 0}>插入草稿</button></footer>
  </form>;
}
