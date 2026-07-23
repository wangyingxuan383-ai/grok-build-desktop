import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OnMount } from "@monaco-editor/react";
import type { EditorDocument, EditorSaveConflict, WorkspaceTreeNode } from "../../../shared/types";
import { useWorkbenchStore, type EditorTabState } from "../workbench-store";
import { UiIcon } from "../ui-icons";

const MonacoEditor = lazy(async () => {
  (await import("../monaco")).configureMonaco();
  const module = await import("@monaco-editor/react");
  return { default: module.default };
});
const MonacoDiffEditor = lazy(async () => {
  (await import("../monaco")).configureMonaco();
  const module = await import("@monaco-editor/react");
  return { default: module.DiffEditor };
});

interface Dialogs {
  askConfirm(message: string, options?: { title?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>;
  askText(message: string, initialValue: string, options?: { title?: string; confirmLabel?: string }): Promise<string | null>;
  setError(message: string): void;
}

export function FileExplorer({ workspace, dialogs }: { workspace: string; dialogs: Dialogs }): React.JSX.Element {
  const store = useWorkbenchStore();
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (directory = "", expand = false): Promise<void> => {
    if (!workspace) return;
    setLoading(true);
    try {
      const nodes = await window.grokDesktop.listWorkspaceTree(workspace, directory, { showIgnored: useWorkbenchStore.getState().showIgnored, showHidden: useWorkbenchStore.getState().showHidden });
      useWorkbenchStore.getState().setTree(directory, nodes);
      if (expand) useWorkbenchStore.getState().toggleExpanded(directory, true);
    } catch (error) {
      dialogs.setError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [dialogs, workspace]);

  useEffect(() => {
    store.resetTree();
    if (workspace) void load();
  }, [workspace, store.showHidden, store.showIgnored]);

  const openNode = async (node: WorkspaceTreeNode): Promise<void> => {
    store.setSelectedPath(node.relativePath);
    if (node.kind === "directory") {
      const expanded = store.expandedDirectories.includes(node.relativePath);
      if (!expanded && !store.treeByDirectory[node.relativePath]) await load(node.relativePath, true);
      else store.toggleExpanded(node.relativePath);
      return;
    }
    if (node.kind !== "file") return;
    try {
      const result = await window.grokDesktop.openEditorDocument(workspace, node.path);
      if (result.kind === "external") await window.grokDesktop.openPath(result.path);
      else if (result.document) store.openDocument(result.document);
    } catch (error) {
      dialogs.setError(errorMessage(error));
    }
  };

  const selectedNode = useMemo(() => Object.values(store.treeByDirectory).flat().find((node) => node.relativePath === store.selectedPath), [store.selectedPath, store.treeByDirectory]);
  const parentDirectory = selectedNode?.kind === "directory" ? selectedNode.relativePath : parentPath(store.selectedPath);
  const mutate = async (action: "file" | "directory" | "rename" | "delete"): Promise<void> => {
    if (!workspace) return;
    try {
      if (action === "file" || action === "directory") {
        const name = await dialogs.askText(action === "file" ? "输入新文件名。" : "输入新目录名。", "", { title: action === "file" ? "新建文件" : "新建目录", confirmLabel: "创建" });
        if (!name?.trim()) return;
        const path = joinRelative(parentDirectory, name.trim());
        if (action === "file") useWorkbenchStore.getState().openDocument(await window.grokDesktop.createEditorFile(workspace, path));
        else await window.grokDesktop.createEditorDirectory(workspace, path);
      } else if (action === "rename" && selectedNode) {
        const name = await dialogs.askText("输入新的文件或目录名称。", selectedNode.name, { title: "重命名", confirmLabel: "保存" });
        if (!name?.trim() || name.trim() === selectedNode.name) return;
        await window.grokDesktop.renameEditorPath(workspace, selectedNode.path, joinRelative(parentPath(selectedNode.relativePath), name.trim()));
      } else if (action === "delete" && selectedNode) {
        const confirmed = await dialogs.askConfirm(`永久删除“${selectedNode.relativePath}”？`, { title: "删除文件或目录", confirmLabel: "永久删除", danger: true });
        if (!confirmed) return;
        await window.grokDesktop.deleteEditorPath(workspace, selectedNode.path, true);
      }
      store.resetTree();
      await load();
    } catch (error) {
      dialogs.setError(errorMessage(error));
    }
  };

  return <section className="file-explorer" aria-label="文件资源管理器">
    <header><strong>文件</strong><span>{loading ? "刷新中…" : ""}</span></header>
    <div className="file-toolbar">
      <button title="新建文件" disabled={!workspace} onClick={() => void mutate("file")}><UiIcon name="file" size={14}/><span className="toolbar-plus">＋</span></button>
      <button title="新建目录" disabled={!workspace} onClick={() => void mutate("directory")}><UiIcon name="folder" size={14}/><span className="toolbar-plus">＋</span></button>
      <button title="刷新" disabled={!workspace || loading} onClick={() => { store.resetTree(); void load(); }}><UiIcon name="refresh" size={14}/></button>
      <button title="在资源管理器中显示" disabled={!selectedNode} onClick={() => selectedNode && void window.grokDesktop.revealEditorPath(workspace, selectedNode.path)}><UiIcon name="external" size={14}/></button>
      <button title="重命名" disabled={!selectedNode || selectedNode.kind === "symlink"} onClick={() => void mutate("rename")}><UiIcon name="edit" size={14}/></button>
      <button title="删除" disabled={!selectedNode || selectedNode.kind === "symlink"} onClick={() => void mutate("delete")}><UiIcon name="trash" size={14}/></button>
    </div>
    <div className="file-options"><label><input type="checkbox" checked={store.showHidden} onChange={(event) => store.setShowHidden(event.target.checked)} />隐藏项</label><label><input type="checkbox" checked={store.showIgnored} onChange={(event) => store.setShowIgnored(event.target.checked)} />忽略项</label></div>
    {!workspace ? <p className="file-empty">请选择工作区</p> : <div className="file-tree" role="tree"><TreeRows directory="" depth={0} onOpen={openNode} /></div>}
  </section>;
}

function TreeRows({ directory, depth, onOpen }: { directory: string; depth: number; onOpen(node: WorkspaceTreeNode): void }): React.JSX.Element {
  const store = useWorkbenchStore();
  const rows = store.treeByDirectory[directory] ?? [];
  return <>{rows.map((node) => {
    const expanded = node.kind === "directory" && store.expandedDirectories.includes(node.relativePath);
    return <div key={node.id}>
      <button className={`file-tree-row ${store.selectedPath === node.relativePath ? "selected" : ""} ${node.ignored ? "ignored" : ""}`} style={{ paddingLeft: `${8 + depth * 14}px` }} onClick={() => onOpen(node)} role="treeitem" aria-expanded={node.kind === "directory" ? expanded : undefined}>
        <span>{node.kind === "directory" ? <UiIcon name={expanded ? "chevron-down" : "chevron-right"} size={13}/> : node.kind === "symlink" ? <UiIcon name="external" size={13}/> : <UiIcon name="file" size={13}/>}</span><span title={node.relativePath}>{node.name}</span>
      </button>
      {expanded && <TreeRows directory={node.relativePath} depth={depth + 1} onOpen={onOpen} />}
    </div>;
  })}</>;
}

export function FileWorkbench({ workspace, dialogs, onChatReference }: { workspace: string; dialogs: Dialogs; onChatReference(value: { prompt: string; path?: string }): void }): React.JSX.Element {
  const store = useWorkbenchStore();
  const tab = store.tabs.find((value) => value.key === store.activeTabKey);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 1, end: 1 });
  const [saving, setSaving] = useState(false);
  const [showConflictDiff, setShowConflictDiff] = useState(false);
  const [editing, setEditing] = useState(false);
  const light = document.documentElement.dataset.themeResolved === "light";
  useEffect(() => { setEditing(false); setShowConflictDiff(false); }, [store.activeTabKey]);
  useEffect(() => {
    if (!tab || !editorRef.current) return;
    editorRef.current.setPosition(tab.cursor);
    editorRef.current.revealLineInCenter(tab.cursor.lineNumber);
  }, [tab?.cursor.column, tab?.cursor.lineNumber, tab?.key]);

  const save = useCallback(async (current: EditorTabState, overwrite = false): Promise<void> => {
    if (!current.document.editable || saving) return;
    setSaving(true);
    try {
      const result = await window.grokDesktop.saveEditorDocument({
        workspacePath: current.document.workspacePath,
        path: current.document.path,
        content: current.buffer,
        encoding: current.document.encoding,
        lineEnding: current.document.lineEnding,
        expectedHash: current.document.hash,
        expectedModifiedAt: current.document.modifiedAt,
        overwrite,
      });
      if (result.document) { store.replaceDocument(result.document); setShowConflictDiff(false); }
      else store.setConflict(current.key, result.conflict);
    } catch (error) {
      dialogs.setError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }, [dialogs, saving, store]);

  const reload = useCallback(async (current: EditorTabState): Promise<void> => {
    try {
      const result = await window.grokDesktop.openEditorDocument(current.document.workspacePath, current.document.path);
      if (result.document) { store.replaceDocument(result.document); setShowConflictDiff(false); }
    } catch (error) { dialogs.setError(errorMessage(error)); }
  }, [dialogs, store]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (store.activeView !== "files" || !tab || !editing || !event.ctrlKey || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      void save(tab);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editing, save, store.activeView, tab]);

  useEffect(() => {
    const onFocus = (): void => {
      const current = useWorkbenchStore.getState().tabs.find((value) => value.key === useWorkbenchStore.getState().activeTabKey);
      if (!current) return;
      void window.grokDesktop.openEditorDocument(current.document.workspacePath, current.document.path).then((result) => {
        if (!result.document || result.document.hash === current.document.hash) return;
        if (!current.dirty) useWorkbenchStore.getState().replaceDocument(result.document);
        else useWorkbenchStore.getState().setConflict(current.key, conflictFromExternal(current, result.document!));
      }).catch(() => undefined);
    };
    window.addEventListener("focus", onFocus);
    onFocus();
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const mount: OnMount = (editor) => {
    editorRef.current = editor;
    const current = useWorkbenchStore.getState().tabs.find((value) => value.key === useWorkbenchStore.getState().activeTabKey);
    if (current) editor.setPosition(current.cursor);
    editor.onDidChangeCursorPosition((event) => {
      const key = useWorkbenchStore.getState().activeTabKey;
      if (key) useWorkbenchStore.getState().updateCursor(key, event.position);
    });
    editor.onDidChangeCursorSelection((event) => setSelection({ start: event.selection.startLineNumber, end: event.selection.endLineNumber }));
    editor.focus();
  };

  const close = async (current: EditorTabState): Promise<void> => {
    if (current.dirty && !await dialogs.askConfirm(`“${current.document.relativePath}”有未保存修改，仍要关闭？`, { title: "关闭编辑器标签", confirmLabel: "不保存并关闭", danger: true })) return;
    store.closeTab(current.key);
  };

  const saveCopy = async (current: EditorTabState): Promise<void> => {
    const target = await dialogs.askText("输入工作区内的副本路径。", copyName(current.document.relativePath), { title: "另存副本", confirmLabel: "保存副本" });
    if (!target?.trim()) return;
    try { store.openDocument(await window.grokDesktop.createEditorFile(current.document.workspacePath, target.trim(), current.buffer)); }
    catch (error) { dialogs.setError(errorMessage(error)); }
  };

  const reference = (kind: "file" | "selection" | "explain" | "modify"): void => {
    if (!tab) return;
    const lines = selection.start === selection.end ? `L${selection.start}` : `L${selection.start}-L${selection.end}`;
    const ref = `@${tab.document.relativePath}${kind === "file" ? "" : `#${lines}`}`;
    const prompt = kind === "explain" ? `请解释 ${ref}` : kind === "modify" ? `请修改 ${ref}：` : ref;
    onChatReference({ prompt, ...(kind === "file" ? { path: tab.document.path } : {}) });
  };

  return <section className="file-workbench">
    <div className="editor-tabs" role="tablist">{store.tabs.map((value) => <button key={value.key} className={store.activeTabKey === value.key ? "active" : ""} onClick={() => store.setActiveTab(value.key)} role="tab"><span>{value.dirty ? "● " : ""}{value.document.relativePath}</span><i onClick={(event) => { event.stopPropagation(); void close(value); }}>×</i></button>)}</div>
    {!tab ? <div className="editor-empty"><strong>轻量编辑器</strong><p>从左侧文件树打开文件。支持多标签、编码/换行保持、冲突检测和原子保存。</p></div> : <>
      <div className="editor-toolbar"><div className="editor-breadcrumbs" title={tab.document.path}>{tab.document.relativePath.split(/[\\/]/).map((part, index, parts) => <span key={`${part}-${index}`}>{part}{index < parts.length - 1 && <i>›</i>}</span>)}</div><small>{editing ? "编辑" : "只读查看"} · {tab.document.encoding.toUpperCase()} · {tab.document.lineEnding.toUpperCase()} · {formatBytes(tab.document.byteLength)}{!tab.document.editable ? ` · ${tab.document.readOnlyReason}` : ""}</small>{editing ? <><button disabled={!tab.dirty || !tab.document.editable || saving} onClick={() => void save(tab)}>{saving ? "保存中…" : "保存"}</button><button onClick={() => setEditing(false)}>结束编辑</button></> : <button className="primary" disabled={!tab.document.editable} onClick={() => setEditing(true)}>编辑文件</button>}<button onClick={() => void window.grokDesktop.revealEditorPath(tab.document.workspacePath, tab.document.path)}>在资源管理器中显示</button><details className="editor-more-actions"><summary>引用…</summary><div><button onClick={() => reference("file")}>添加文件到对话</button><button onClick={() => reference("selection")}>添加选中代码</button><button onClick={() => reference("explain")}>让 Grok 解释</button><button onClick={() => reference("modify")}>让 Grok 修改</button></div></details></div>
      {tab.conflict && <ConflictBar conflict={tab.conflict} onViewDiff={() => setShowConflictDiff((value) => !value)} onReload={() => void reload(tab)} onOverwrite={() => void save(tab, true)} onSaveCopy={() => void saveCopy(tab)} onDismiss={() => { setShowConflictDiff(false); store.setConflict(tab.key); }} />}
      <div className="monaco-host"><Suspense fallback={<div className="editor-loading">正在加载 Monaco 编辑器…</div>}>{showConflictDiff && tab.conflict?.diskContent !== undefined ? <MonacoDiffEditor original={tab.conflict.diskContent} modified={tab.buffer} language={tab.document.languageId} theme={light ? "light" : "vs-dark"} options={{ readOnly: true, automaticLayout: true, minimap: { enabled: false }, renderSideBySide: true }} /> : <MonacoEditor path={tab.document.path} language={tab.document.languageId} value={tab.buffer} theme={light ? "light" : "vs-dark"} options={{ readOnly: !editing || !tab.document.editable, automaticLayout: true, minimap: { enabled: false }, fontSize: 13, wordWrap: "off", renderWhitespace: "selection", scrollBeyondLastLine: false }} onChange={(value) => { if (editing) store.updateBuffer(tab.key, value ?? ""); }} onMount={mount} />}</Suspense></div>
    </>}
  </section>;
}

function ConflictBar({ conflict, onViewDiff, onReload, onOverwrite, onSaveCopy, onDismiss }: { conflict: EditorSaveConflict; onViewDiff(): void; onReload(): void; onOverwrite(): void; onSaveCopy(): void; onDismiss(): void }): React.JSX.Element {
  return <div className="editor-conflict"><strong>{conflict.kind === "deleted" ? "磁盘文件已被删除" : conflict.kind === "type-changed" ? "磁盘路径类型已变化" : "磁盘文件已在外部修改"}</strong><span>未保存缓冲区不会被静默覆盖。</span>{conflict.diskContent !== undefined && <button onClick={onViewDiff}>查看磁盘 Diff</button>}<button onClick={onReload}>重新加载磁盘</button><button onClick={onOverwrite}>覆盖磁盘</button><button onClick={onSaveCopy}>另存副本</button><button onClick={onDismiss}>稍后处理</button></div>;
}

function conflictFromExternal(tab: EditorTabState, disk: EditorDocument): EditorSaveConflict {
  return { kind: "modified", path: tab.document.path, expectedHash: tab.document.hash, actualHash: disk.hash, expectedModifiedAt: tab.document.modifiedAt, actualModifiedAt: disk.modifiedAt, diskContent: disk.content, diskEncoding: disk.encoding, diskLineEnding: disk.lineEnding };
}

function parentPath(value: string): string { const parts = value.replace(/\\/g, "/").split("/"); parts.pop(); return parts.join("/"); }
function joinRelative(parent: string, name: string): string { return [parent, name].filter(Boolean).join("/"); }
function copyName(value: string): string { const dot = value.lastIndexOf("."); return dot > value.lastIndexOf("/") ? `${value.slice(0, dot)}.copy${value.slice(dot)}` : `${value}.copy`; }
function formatBytes(value: number): string { return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MiB` : value >= 1024 ? `${(value / 1024).toFixed(1)} KiB` : `${value} B`; }
function errorMessage(value: unknown): string { return value instanceof Error ? value.message : String(value); }
