import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "../store";
import { useWorkbenchStore, type WorkbenchView } from "../workbench-store";
import { useWorktreeStore } from "../worktree-store";

interface Dialogs {
  askConfirm(message: string, options?: { title?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>;
  askText(message: string, initialValue: string, options?: { title?: string; confirmLabel?: string }): Promise<string | null>;
  setError(message: string): void;
}

export function WorktreeExplorer({ workspace, dialogs }: { workspace: string; dialogs: Dialogs }): React.JSX.Element {
  const store = useWorktreeStore();
  const refresh = useCallback(async (): Promise<void> => {
    if (!workspace) return useWorktreeStore.getState().reset();
    useWorktreeStore.getState().setLoading(true);
    try { useWorktreeStore.getState().setItems(workspace, await window.grokDesktop.listWorktrees(workspace)); }
    catch (error) { useWorktreeStore.getState().reset(workspace); dialogs.setError(errorMessage(error)); }
    finally { useWorktreeStore.getState().setLoading(false); }
  }, [dialogs, workspace]);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async (): Promise<void> => {
    const name = await dialogs.askText("输入隔离 Worktree 的显示名称。", "", { title: "创建 Worktree", confirmLabel: "下一步" });
    if (!name?.trim()) return;
    const baseRef = await dialogs.askText("输入基础分支或提交。", "HEAD", { title: "Worktree 基础 Ref", confirmLabel: "创建" });
    if (!baseRef?.trim()) return;
    store.setLoading(true);
    try {
      const created = await window.grokDesktop.createWorktree({ workspacePath: workspace, name: name.trim(), baseRef: baseRef.trim() });
      const items = await window.grokDesktop.listWorktrees(workspace);
      store.setItems(workspace, items); store.setSelected(created.id);
    } catch (error) { dialogs.setError(errorMessage(error)); }
    finally { store.setLoading(false); }
  };

  const gc = async (): Promise<void> => {
    try {
      const preview = await window.grokDesktop.previewWorktreeGc(workspace);
      if (!preview.candidates.length) return dialogs.setError("没有可清理的孤儿或过期 Worktree 记录。");
      const confirmed = await dialogs.askConfirm(`Git 标记了 ${preview.candidates.length} 项可清理记录：\n${preview.candidates.map((item) => `• ${item.path} — ${item.reason}`).join("\n")}`, { title: "Worktree GC 预览", confirmLabel: "确认清理", danger: true });
      if (!confirmed) return;
      await window.grokDesktop.gcWorktrees(workspace, preview.confirmationToken, true);
      await refresh();
    } catch (error) { dialogs.setError(errorMessage(error)); }
  };

  return <section className="worktree-explorer" aria-label="Worktree">
    <header><strong>Worktree</strong><span>{store.loading ? "处理中…" : `${store.items.length} 个`}</span></header>
    <div className="worktree-toolbar"><button className="primary" disabled={!workspace || store.loading} onClick={() => void create()}>＋ 新建</button><button disabled={!workspace || store.loading} onClick={() => void refresh()}>↻ 刷新</button><button disabled={!workspace || store.loading} onClick={() => void gc()}>GC</button></div>
    {!workspace ? <p className="file-empty">请选择工作区</p> : !store.items.length ? <p className="file-empty">{store.loading ? "正在读取 Worktree…" : "尚无隔离 Worktree"}</p> : <div className="worktree-list">{store.items.map((item) => <button key={item.id} className={store.selectedId === item.id ? "selected" : ""} onClick={() => store.setSelected(item.id)}><span className={`worktree-state ${item.state}`} /><div><strong>{item.name}</strong><span>{item.branch || "无分支"} · {stateLabel(item.state)}</span><small>{item.changedFiles} 个未提交变更 · {item.official ? "Grok 原生" : "Git 兼容层"}</small></div></button>)}</div>}
  </section>;
}

export function WorktreeWorkbench({ workspace, dialogs }: { workspace: string; dialogs: Dialogs }): React.JSX.Element {
  const store = useWorktreeStore();
  const selected = store.items.find((item) => item.id === store.selectedId);
  const [cleanup, setCleanup] = useState(false);
  const [result, setResult] = useState("");

  const refresh = async (): Promise<void> => {
    try { store.setItems(workspace, await window.grokDesktop.listWorktrees(workspace)); }
    catch (error) { dialogs.setError(errorMessage(error)); }
  };
  const preview = async (): Promise<void> => {
    if (!selected) return;
    store.setLoading(true); setResult("");
    try { store.setPreview(await window.grokDesktop.previewWorktreeApply(workspace, selected.id)); }
    catch (error) { dialogs.setError(errorMessage(error)); }
    finally { store.setLoading(false); }
  };
  const apply = async (): Promise<void> => {
    const value = store.preview;
    if (!selected || !value?.canApply || !value.confirmationToken) return;
    const confirmed = await dialogs.askConfirm(`将 ${value.commits.length} 个提交、${value.files.length} 个文件应用到目标工作区。\n+${value.additions} / −${value.deletions}${cleanup ? "\n成功后清理 Worktree。" : "\n成功后保留 Worktree。"}`, { title: "确认安全应用 Worktree", confirmLabel: "应用", danger: false });
    if (!confirmed) return;
    store.setLoading(true);
    try {
      const applied = await window.grokDesktop.applyWorktree(workspace, selected.id, value.confirmationToken, true, cleanup);
      setResult(applied.message); store.setPreview(undefined); await refresh();
      if (applied.conflicted) useWorkbenchStore.getState().setActiveView("source-control");
    } catch (error) { dialogs.setError(errorMessage(error)); }
    finally { store.setLoading(false); }
  };
  const remove = async (): Promise<void> => {
    if (!selected) return;
    const confirmed = await dialogs.askConfirm(`删除 Worktree“${selected.name}”？仅当不存在未提交或未应用变更时才会执行。`, { title: "删除 Worktree", confirmLabel: "删除", danger: true });
    if (!confirmed) return;
    try { await window.grokDesktop.removeWorktree(workspace, selected.id, true); store.setPreview(undefined); await refresh(); }
    catch (error) { dialogs.setError(errorMessage(error)); }
  };
  const openWorkspace = async (view: WorkbenchView): Promise<void> => {
    if (!selected) return;
    try {
      const app = useAppStore.getState();
      app.setSessions(await window.grokDesktop.setWorkspace(selected.path));
      app.setSettings(await window.grokDesktop.getSettings());
      app.setActiveSession("");
      useWorkbenchStore.getState().setActiveView(view);
    } catch (error) { dialogs.setError(errorMessage(error)); }
  };
  const openSession = async (): Promise<void> => {
    if (!selected?.sourceSessionId) return;
    try {
      const app = useAppStore.getState();
      app.setSessions(await window.grokDesktop.setWorkspace(selected.path));
      app.setSettings(await window.grokDesktop.getSettings());
      await window.grokDesktop.openSession(selected.path, selected.sourceSessionId);
      app.setActiveSession(selected.sourceSessionId);
      useWorkbenchStore.getState().setActiveView("chat");
    } catch (error) { dialogs.setError(errorMessage(error)); }
  };

  if (!selected) return <div className="worktree-empty"><h2>隔离 Worktree</h2><p>从左侧新建或选择一个 Worktree。</p></div>;
  const value = store.preview;
  return <div className="worktree-workbench">
    <header><div><h2>{selected.name}</h2><span>{selected.branch || "无分支"} · {selected.official ? "Grok 原生" : "受控 Git 兼容层"}</span></div><div><button onClick={() => void openWorkspace("files")}>打开文件</button><button onClick={() => void openWorkspace("source-control")}>打开 Git</button><button disabled={!selected.sourceSessionId} onClick={() => void openSession()}>打开会话</button><button className="danger-link" disabled={store.loading} onClick={() => void remove()}>删除</button></div></header>
    <section className="worktree-overview"><dl><dt>路径</dt><dd title={selected.path}>{selected.path}</dd><dt>基础 Ref</dt><dd>{selected.baseRef || "未知"}</dd><dt>HEAD</dt><dd>{selected.head?.slice(0, 12) || "未知"}</dd><dt>来源会话</dt><dd>{selected.sourceSessionId || "无"}</dd><dt>Agent</dt><dd>{selected.agentId || "无"}</dd><dt>状态</dt><dd>{stateLabel(selected.state)} · {selected.changedFiles} 个未提交变更</dd></dl><button className="primary" disabled={store.loading} onClick={() => void preview()}>{store.loading ? "检查中…" : "预览安全应用"}</button></section>
    {result && <div className="worktree-result">{result}</div>}
    {value && <section className={`worktree-preview ${value.canApply ? "ready" : "blocked"}`}>
      <header><div><h3>应用预览</h3><span>{value.targetClean ? "目标工作区干净" : "目标工作区有修改"}</span></div><strong>+{value.additions} / −{value.deletions}</strong></header>
      {!value.canApply && <p className="worktree-blocked">{value.reason}</p>}
      <div className="worktree-preview-grid"><div><h4>提交（{value.commits.length}）</h4>{value.commits.map((commit) => <p key={commit.hash}><code>{commit.hash.slice(0, 8)}</code> {commit.subject}</p>)}</div><div><h4>文件（{value.files.length}）</h4>{value.files.map((file) => <p key={file.path}><b>{file.kind}</b><span>{file.path}</span><small>+{file.additions ?? "–"} / −{file.deletions ?? "–"}</small></p>)}</div></div>
      <footer><label><input type="checkbox" checked={cleanup} onChange={(event) => setCleanup(event.target.checked)} />成功后清理 Worktree（默认关闭）</label><button className="primary" disabled={!value.canApply || store.loading} onClick={() => void apply()}>确认并应用</button></footer>
    </section>}
  </div>;
}

function stateLabel(value: string): string { return ({ ready: "就绪", applying: "应用中", conflicted: "有冲突", orphaned: "未关联", stale: "可清理", missing: "路径缺失", unknown: "未知" } as Record<string, string>)[value] ?? value; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
