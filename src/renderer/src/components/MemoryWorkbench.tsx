import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { MemoryEntry, MemorySaveResult, MemorySettings, MemoryStructuredEntry } from "../../../shared/types";

const MonacoEditor = lazy(async () => {
  (await import("../monaco")).configureMonaco();
  const module = await import("@monaco-editor/react");
  return { default: module.default };
});

interface Dialogs {
  askConfirm(message: string, options?: { title?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>;
  askText(message: string, initialValue: string, options?: { title?: string; confirmLabel?: string }): Promise<string | null>;
  setError(message: string): void;
}

export function MemoryWorkbench({ workspace, activeSessionId, dialogs }: { workspace: string; activeSessionId: string; dialogs: Dialogs }): React.JSX.Element {
  const [settings, setSettings] = useState<MemorySettings>();
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [selectedId, setSelectedId] = useState("workspace");
  const [query, setQuery] = useState("");
  const [buffer, setBuffer] = useState("");
  const [baseline, setBaseline] = useState<MemoryEntry>();
  const [conflict, setConflict] = useState<MemorySaveResult["conflict"]>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [structured, setStructured] = useState<MemoryStructuredEntry[]>([]);
  const [structuredId, setStructuredId] = useState("");
  const selected = entries.find((value) => value.id === selectedId) ?? entries[0];
  const dirty = Boolean(baseline && buffer !== baseline.content);
  const light = document.documentElement.dataset.themeResolved === "light";

  const load = useCallback(async (search = query, preferredId = selectedId): Promise<void> => {
    if (!workspace) { setEntries([]); setSettings(undefined); setBaseline(undefined); return; }
    setBusy(true);
    try {
      const [nextSettings, nextEntries, nextStructured] = await Promise.all([window.grokDesktop.getMemorySettings(workspace), window.grokDesktop.listMemory(workspace, search), window.grokDesktop.listMemoryStructuredEntries(workspace)]);
      setSettings(nextSettings);
      setEntries(nextEntries);
      const next = nextEntries.find((value) => value.id === preferredId) ?? nextEntries[0];
      setSelectedId(next?.id ?? "");
      setBaseline(next);
      setBuffer(next?.content ?? "");
      setConflict(undefined);
      setStructured(nextStructured);
      setStructuredId((current) => nextStructured.some((value) => value.id === current) ? current : nextStructured.find((value) => value.scope === next?.scope)?.id ?? "");
    } catch (error) { dialogs.setError(errorMessage(error)); }
    finally { setBusy(false); }
  }, [dialogs, query, selectedId, workspace]);

  useEffect(() => { void load("", "workspace"); }, [workspace]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.key.toLowerCase() !== "s" || !baseline || baseline.readOnly) return;
      event.preventDefault();
      void save(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [baseline, buffer, workspace]);

  const choose = async (entry: MemoryEntry): Promise<void> => {
    if (dirty && !await dialogs.askConfirm(`“${baseline?.title}”有未保存修改，仍要切换？`, { title: "切换 Memory", confirmLabel: "不保存并切换", danger: true })) return;
    setSelectedId(entry.id); setBaseline(entry); setBuffer(entry.content); setConflict(undefined); setNotice("");
  };

  const save = async (overwrite: boolean): Promise<void> => {
    if (!workspace || !baseline || baseline.readOnly || baseline.scope === "session") return;
    setBusy(true);
    try {
      const result = await window.grokDesktop.saveMemory({ workspacePath: workspace, scope: baseline.scope, content: buffer, expectedHash: baseline.hash ?? "", expectedModifiedAt: baseline.modifiedAt ?? "", overwrite });
      if (!result.saved || !result.entry) { setConflict(result.conflict); return; }
      setBaseline(result.entry); setEntries((values) => values.map((value) => value.id === result.entry!.id ? result.entry! : value)); setBuffer(result.entry.content); setConflict(undefined); setNotice("Memory 已原子保存");
    } catch (error) { dialogs.setError(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const remember = async (): Promise<void> => {
    if (!workspace) return;
    const scope = baseline?.scope === "global" ? "global" : "workspace";
    const text = await dialogs.askText("输入要保存的长期记忆。确认前会显示目标范围与完整内容。", "", { title: "记住", confirmLabel: "预览" });
    if (!text?.trim()) return;
    try {
      const preview = await window.grokDesktop.previewRemember(workspace, scope, text);
      const confirmed = await dialogs.askConfirm(`范围：${scope === "global" ? "全局" : "当前仓库"}\n\n将写入：\n${preview.text}`, { title: "记忆保存预览", confirmLabel: "确认保存" });
      if (!confirmed) return;
      const entry = await window.grokDesktop.rememberMemory(preview, preview.confirmationToken, true, activeSessionId);
      await load(query, entry.id); setNotice("原生 /remember 已整理并保存记忆");
    } catch (error) { dialogs.setError(errorMessage(error)); }
  };

  const removeStructured = async (): Promise<void> => {
    const item = structured.find((value) => value.id === structuredId && value.scope === baseline?.scope);
    if (!item) return;
    try {
      const preview = await window.grokDesktop.previewDeleteMemoryEntry(workspace, item.id);
      const confirmed = await dialogs.askConfirm(`范围：${item.scope === "global" ? "全局" : "当前仓库"}\n标题：${item.heading}\n行：${item.lineStart}–${item.lineEnd}\n\n将精确删除：\n${item.text}`, { title: "删除 Memory 条目预览", confirmLabel: "精确删除", danger: true });
      if (!confirmed) return;
      const entry = await window.grokDesktop.deleteMemoryEntry(preview, preview.confirmationToken, true);
      await load(query, entry.id); setNotice("Memory 条目已精确删除");
    } catch (error) { dialogs.setError(errorMessage(error)); }
  };

  const removeSession = async (): Promise<void> => {
    if (!selected || selected.scope !== "session") return;
    const confirmed = await dialogs.askConfirm(`永久删除会话摘要“${selected.title}”？`, { title: "删除会话 Memory", confirmLabel: "永久删除", danger: true });
    if (!confirmed) return;
    try { await window.grokDesktop.deleteSessionMemory(workspace, selected.id, true); await load(query, "workspace"); }
    catch (error) { dialogs.setError(errorMessage(error)); }
  };

  const clear = async (scope: "workspace" | "global" | "all"): Promise<void> => {
    const label = scope === "workspace" ? "当前仓库" : scope === "global" ? "全局" : "全部";
    const confirmed = await dialogs.askConfirm(`通过 grok memory clear 清空${label} Memory？此操作不可撤销。`, { title: "清空 Memory", confirmLabel: `清空${label}`, danger: true });
    if (!confirmed) return;
    setBusy(true);
    try { await window.grokDesktop.clearMemory(workspace, scope, true); await load("", scope === "global" ? "global" : "workspace"); setNotice(`${label} Memory 已清空`); }
    catch (error) { dialogs.setError(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const updateSetting = async (patch: Partial<Pick<MemorySettings, "enabled" | "saveOnSessionEnd" | "autoDream">>): Promise<void> => {
    if (!workspace) return;
    try { setSettings(await window.grokDesktop.updateMemorySettings(workspace, patch, activeSessionId || undefined)); setNotice(activeSessionId && patch.enabled !== undefined ? "设置已保存，当前会话已热切换或受控恢复" : "设置已保存；Memory 启停会用于新建或重新打开的会话"); }
    catch (error) { dialogs.setError(errorMessage(error)); }
  };

  const command = async (name: "flush" | "dream"): Promise<void> => {
    if (!activeSessionId) return;
    setBusy(true);
    try { setSettings(await window.grokDesktop.runMemoryCommand(activeSessionId, name)); setNotice(name === "flush" ? "当前会话 Flush 已完成" : "当前会话 Dream 已完成"); await load(query, selectedId); }
    catch (error) { setSettings(await window.grokDesktop.getMemorySettings(workspace).catch(() => settings)); dialogs.setError(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const grouped = useMemo(() => ({ global: entries.filter((value) => value.scope === "global"), workspace: entries.filter((value) => value.scope === "workspace"), session: entries.filter((value) => value.scope === "session") }), [entries]);
  if (!workspace) return <div className="memory-empty"><h2>跨会话 Memory</h2><p>请选择工作区。</p></div>;

  return <section className="memory-workbench">
    <aside className="memory-navigator">
      <header><div><strong>Memory</strong><span>{settings?.enabled ? "已启用" : "默认关闭"}</span></div><button disabled={busy} onClick={() => void load()}>↻</button></header>
      <form className="memory-search" onSubmit={(event) => { event.preventDefault(); void load(query, selectedId); }}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 Memory"/><button>搜索</button></form>
      {(["global", "workspace", "session"] as const).map((scope) => <div className="memory-group" key={scope}><h4>{scope === "global" ? "全局" : scope === "workspace" ? "当前仓库" : `会话摘要（${grouped.session.length}）`}</h4>{grouped[scope].map((entry) => <button key={entry.id} className={selected?.id === entry.id ? "selected" : ""} onClick={() => void choose(entry)}><span>{entry.scope === "session" ? "◷" : "M"}</span><div><strong>{entry.title}</strong><small>{entry.modifiedAt ? relativeTime(entry.modifiedAt) : "尚未创建"}</small></div></button>)}</div>)}
      <div className="memory-settings"><h4>工作区设置</h4><label><input type="checkbox" checked={settings?.enabled ?? false} onChange={(event) => void updateSetting({ enabled: event.target.checked })}/>启用 Memory</label><label><input type="checkbox" checked={settings?.saveOnSessionEnd ?? true} onChange={(event) => void updateSetting({ saveOnSessionEnd: event.target.checked })}/>会话结束保存</label><label><input type="checkbox" checked={settings?.autoDream ?? true} onChange={(event) => void updateSetting({ autoDream: event.target.checked })}/>自动 Dream</label></div>
    </aside>
    <div className="memory-editor">
      <div className="memory-status"><div><strong>{baseline?.title ?? "Memory"}</strong><span>{baseline?.scope === "global" ? "全局" : baseline?.scope === "workspace" ? "当前仓库" : "只读会话摘要"} · 索引 {indexLabel(settings?.indexStatus)}</span></div><div><small>Flush {formatTime(settings?.lastFlushAt)} · Dream {settings?.dreamStatus === "running" ? "运行中…" : formatTime(settings?.lastDreamAt)}</small></div></div>
      <div className="memory-toolbar"><button className="primary" disabled={!dirty || baseline?.readOnly || busy} onClick={() => void save(false)}>{busy ? "处理中…" : "保存"}</button><button disabled={busy || !activeSessionId || !settings?.enabled} title={!activeSessionId ? "需要已加载会话以运行原生 /remember" : undefined} onClick={() => void remember()}>＋ 记住</button><select aria-label="Memory 条目" disabled={baseline?.scope === "session" || busy} value={structured.some((value) => value.id === structuredId && value.scope === baseline?.scope) ? structuredId : ""} onChange={(event) => setStructuredId(event.target.value)}><option value="">选择精确条目…</option>{structured.filter((value) => value.scope === baseline?.scope).map((value) => <option key={value.id} value={value.id}>{value.lineStart}–{value.lineEnd} · {value.text.slice(0, 48)}</option>)}</select><button className="danger" disabled={!structured.some((value) => value.id === structuredId && value.scope === baseline?.scope) || busy} onClick={() => void removeStructured()}>删除条目</button><button disabled={!activeSessionId || !settings?.enabled || busy} onClick={() => void command("flush")}>Flush</button><button disabled={!activeSessionId || !settings?.enabled || busy} onClick={() => void command("dream")}>Dream</button>{selected?.scope === "session" && <button className="danger" disabled={busy} onClick={() => void removeSession()}>删除摘要</button>}<span/><button disabled={busy} onClick={() => void clear(selected?.scope === "global" ? "global" : "workspace")}>清空当前范围</button><button disabled={busy} onClick={() => void clear("all")}>清空全部</button></div>
      {notice && <div className="memory-notice">{notice}</div>}
      {conflict && <div className="editor-conflict"><strong>Memory 已在外部修改</strong><span>当前缓冲区未被覆盖。</span><button onClick={() => { setBuffer(conflict.diskContent ?? ""); setBaseline((value) => value ? { ...value, content: conflict.diskContent ?? "", hash: conflict.actualHash, modifiedAt: conflict.actualModifiedAt } : value); setConflict(undefined); }}>重新加载磁盘</button><button onClick={() => void save(true)}>覆盖磁盘</button></div>}
      <div className="monaco-host"><Suspense fallback={<div className="editor-loading">正在加载 Monaco 编辑器…</div>}><MonacoEditor path={baseline?.path || `memory://${selectedId}`} language="markdown" value={buffer} theme={light ? "light" : "vs-dark"} options={{ readOnly: baseline?.readOnly ?? true, automaticLayout: true, minimap: { enabled: false }, wordWrap: "on", fontSize: 13, scrollBeyondLastLine: false }} onChange={(value) => setBuffer(value ?? "")}/></Suspense></div>
    </div>
  </section>;
}

function indexLabel(value: MemorySettings["indexStatus"]): string { return value === "ready" ? "就绪" : value === "building" ? "构建中" : value === "failed" ? "失败" : value === "disabled" ? "关闭" : "待建立"; }
function formatTime(value?: string): string { return value ? new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "尚无"; }
function relativeTime(value: string): string { const delta = Date.now() - new Date(value).getTime(); if (delta < 60_000) return "刚刚"; if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`; if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`; return new Date(value).toLocaleDateString("zh-CN"); }
function errorMessage(value: unknown): string { return value instanceof Error ? value.message : String(value); }
