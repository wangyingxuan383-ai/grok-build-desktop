import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { GitCommitDetails, GitCommitSummary, GitFileChange, GitRepositoryStatus } from "../../../shared/types";
import { useGitStore, type GitSelection } from "../git-store";
import { useWorkbenchStore } from "../workbench-store";

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

export function GitExplorer({ workspace, dialogs }: { workspace: string; dialogs: Dialogs }): React.JSX.Element {
  const git = useGitStore();

  const refresh = useCallback(async (): Promise<void> => {
    if (!workspace) return useGitStore.getState().reset();
    useGitStore.getState().setLoading(true);
    try {
      const [trust, status] = await Promise.all([
        window.grokDesktop.getGitRepositoryTrust(workspace),
        window.grokDesktop.getGitStatus(workspace),
      ]);
      useGitStore.getState().setRepository(workspace, trust, status);
    } catch (error) {
      useGitStore.getState().reset(workspace);
      dialogs.setError(errorMessage(error));
    } finally {
      useGitStore.getState().setLoading(false);
    }
  }, [dialogs, workspace]);

  useEffect(() => { void refresh(); }, [refresh]);

  const trustRepository = async (): Promise<void> => {
    if (!git.trust) return;
    const confirmed = await dialogs.askConfirm(`当前工作区位于仓库子目录。Git 修改会作用于整个仓库：\n${git.trust.repositoryRoot}`, { title: "信任完整 Git 仓库范围", confirmLabel: "信任并继续" });
    if (!confirmed) return;
    try { git.setTrust(await window.grokDesktop.setGitRepositoryTrust(workspace, git.trust.repositoryRoot, true)); }
    catch (error) { dialogs.setError(errorMessage(error)); }
  };

  const mutate = async (action: "stage" | "unstage", paths?: string[]): Promise<void> => {
    git.setLoading(true);
    try {
      const status = action === "stage" ? await window.grokDesktop.stageGitChanges(workspace, paths) : await window.grokDesktop.unstageGitChanges(workspace, paths);
      git.setStatus(status);
    } catch (error) { dialogs.setError(errorMessage(error)); }
    finally { git.setLoading(false); }
  };

  const groups = groupChanges(git.status);
  return <section className="git-explorer" aria-label="源代码管理">
    <header><strong>源代码管理</strong><button title="刷新 Git 状态" disabled={!workspace || git.loading} onClick={() => void refresh()}>↻</button></header>
    {!workspace ? <p className="file-empty">请选择工作区</p> : !git.status ? <p className="file-empty">{git.loading ? "正在读取 Git…" : "当前工作区不是 Git 仓库"}</p> : <>
      <div className="git-branch-summary"><strong>{git.status.branch?.detached ? "分离 HEAD" : git.status.branch?.name || "未知分支"}</strong><span>{branchTrack(git.status)}</span></div>
      {git.trust?.required && !git.trust.trusted && <div className="git-trust"><p>只读状态可用；修改前需信任完整仓库范围。</p><button className="primary" onClick={() => void trustRepository()}>查看并信任范围</button></div>}
      {groups.map((group) => <section className="git-change-group" key={group.id}>
        <header><strong>{group.label}</strong><span>{group.items.length}</span>{group.id === "staged" && <button disabled={git.loading || !canMutate(git)} title="全部取消暂存" onClick={() => void mutate("unstage")}>−</button>}{group.id !== "staged" && <button disabled={git.loading || !canMutate(git)} title="全部暂存" onClick={() => void mutate("stage", group.items.map((item) => item.path))}>＋</button>}</header>
        {group.items.map((change) => <GitChangeRow key={`${group.id}:${change.path}`} change={change} staged={group.id === "staged"} selected={git.selection?.path === change.path && git.selection.staged === (group.id === "staged")} disabled={git.loading || !canMutate(git)} onSelect={(selection) => { git.setSelection(selection); useWorkbenchStore.getState().setActiveView("source-control"); }} onMutate={(path) => void mutate(group.id === "staged" ? "unstage" : "stage", [path])} />)}
      </section>)}
      {git.status.clean && <p className="git-clean">✓ 工作树干净</p>}
    </>}
  </section>;
}

function GitChangeRow({ change, staged, selected, disabled, onSelect, onMutate }: { change: GitFileChange; staged: boolean; selected: boolean; disabled: boolean; onSelect(selection: GitSelection): void; onMutate(path: string): void }): React.JSX.Element {
  return <div role="button" tabIndex={0} className={`git-change-row ${selected ? "selected" : ""}`} onClick={() => onSelect({ path: change.path, staged })} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect({ path: change.path, staged }); }} title={change.oldPath ? `${change.oldPath} → ${change.path}` : change.path}>
    <span className={`git-change-kind ${change.kind}`}>{changeBadge(change)}</span><span>{change.path}</span><button disabled={disabled} title={staged ? "取消暂存" : "暂存"} onClick={(event) => { event.stopPropagation(); onMutate(change.path); }}>{staged ? "−" : "+"}</button>
  </div>;
}

export function GitWorkbench({ workspace, dialogs }: { workspace: string; dialogs: Dialogs }): React.JSX.Element {
  const git = useGitStore();
  const [commitMessage, setCommitMessage] = useState("");
  const [branches, setBranches] = useState<Array<{ name: string; current: boolean }>>([]);
  const [history, setHistory] = useState<GitCommitSummary[]>([]);
  const [details, setDetails] = useState<GitCommitDetails>();
  const [operation, setOperation] = useState<{ id: string; kind: "pull" | "push" }>();
  const [operationSummary, setOperationSummary] = useState("");
  const light = document.documentElement.dataset.themeResolved === "light";
  const diffSides = useMemo(() => splitUnifiedPatch(git.diff?.patch ?? ""), [git.diff?.patch]);

  const refreshMetadata = useCallback(async (): Promise<void> => {
    if (!workspace || !git.status) return;
    try {
      const [nextBranches, nextHistory] = await Promise.all([window.grokDesktop.listGitBranches(workspace), window.grokDesktop.listGitHistory(workspace, 30)]);
      setBranches(nextBranches); setHistory(nextHistory);
    } catch (error) { dialogs.setError(errorMessage(error)); }
  }, [dialogs, git.status?.repositoryRoot, workspace]);

  useEffect(() => { void refreshMetadata(); }, [refreshMetadata]);
  useEffect(() => {
    if (!workspace || !git.selection) return git.setDiff(undefined);
    let cancelled = false;
    void window.grokDesktop.getGitDiff(workspace, git.selection.staged, git.selection.path).then((value) => { if (!cancelled) git.setDiff(value); }).catch((error) => { if (!cancelled) dialogs.setError(errorMessage(error)); });
    return () => { cancelled = true; };
  }, [dialogs, git.selection?.path, git.selection?.staged, workspace]);

  const updateStatus = (status: GitRepositoryStatus): void => { git.setStatus(status); void refreshMetadata(); };
  const createBranch = async (): Promise<void> => {
    const name = await dialogs.askText("输入新分支名称。", "", { title: "创建并切换分支", confirmLabel: "创建" });
    if (!name?.trim()) return;
    if (!ensureEditorClean(dialogs)) return;
    try { updateStatus(await window.grokDesktop.createGitBranch(workspace, name.trim())); }
    catch (error) { dialogs.setError(errorMessage(error)); }
  };
  const switchBranch = async (name: string): Promise<void> => {
    if (!name || name === git.status?.branch?.name || !ensureEditorClean(dialogs)) return;
    try { updateStatus(await window.grokDesktop.switchGitBranch(workspace, name)); }
    catch (error) { dialogs.setError(errorMessage(error)); }
  };
  const commit = async (): Promise<void> => {
    if (!commitMessage.trim()) return;
    git.setLoading(true);
    try { await window.grokDesktop.commitGitChanges(workspace, commitMessage); setCommitMessage(""); updateStatus(await window.grokDesktop.getGitStatus(workspace)); }
    catch (error) { dialogs.setError(errorMessage(error)); }
    finally { git.setLoading(false); }
  };
  const runNetwork = async (kind: "pull" | "push"): Promise<void> => {
    const id = `${kind}-${crypto.randomUUID()}`;
    setOperation({ id, kind }); setOperationSummary("");
    try {
      const result = kind === "pull" ? await window.grokDesktop.pullGitRepository(workspace, id) : await window.grokDesktop.pushGitRepository(workspace, id);
      setOperationSummary(result.summary); updateStatus(await window.grokDesktop.getGitStatus(workspace));
    } catch (error) { dialogs.setError(errorMessage(error)); }
    finally { setOperation(undefined); }
  };
  const discard = async (): Promise<void> => {
    const change = git.status?.changes.find((value) => value.path === git.selection?.path);
    if (!change || !canMutate(git)) return;
    const confirmed = await dialogs.askConfirm(`永久丢弃以下文件的 Git 修改？\n${change.path}`, { title: change.kind === "untracked" ? "删除未跟踪文件" : "丢弃文件修改", confirmLabel: change.kind === "untracked" ? "永久删除" : "丢弃修改", danger: true });
    if (!confirmed) return;
    try {
      updateStatus(await window.grokDesktop.discardGitChanges(workspace, { trackedPaths: change.kind === "untracked" ? [] : [change.path], untrackedPaths: change.kind === "untracked" ? [change.path] : [], confirmedPaths: [change.path] }));
    } catch (error) { dialogs.setError(errorMessage(error)); }
  };
  const openEditor = async (): Promise<void> => {
    if (!git.selection) return;
    try {
      const result = await window.grokDesktop.openEditorDocument(workspace, git.selection.path);
      if (result.kind === "external") await window.grokDesktop.openPath(result.path);
      else if (result.document) useWorkbenchStore.getState().openDocument(result.document);
    } catch (error) { dialogs.setError(errorMessage(error)); }
  };

  if (!workspace) return <div className="git-workbench-empty"><h2>源代码管理</h2><p>请选择工作区。</p></div>;
  if (!git.status) return <div className="git-workbench-empty"><h2>源代码管理</h2><p>{git.loading ? "正在读取 Git 仓库…" : "当前工作区不是 Git 仓库。"}</p></div>;
  const editable = canMutate(git);
  return <div className="git-workbench">
    <header className="git-workbench-toolbar">
      <div><strong>{git.status.branch?.name || "Git"}</strong>{git.status.remote && <span>{git.status.remote.name} · {git.status.remote.displayUrl}</span>}</div>
      <select aria-label="切换分支" value={git.status.branch?.detached ? "" : git.status.branch?.name || ""} disabled={!editable || Boolean(operation)} onChange={(event) => void switchBranch(event.target.value)}><option value="" disabled>选择分支</option>{branches.map((branch) => <option key={branch.name}>{branch.name}</option>)}</select>
      <button disabled={!editable || Boolean(operation)} onClick={() => void createBranch()}>新建分支</button>
      <button disabled={!editable || Boolean(operation)} onClick={() => void runNetwork("pull")}>Pull</button>
      <button disabled={!editable || Boolean(operation)} onClick={() => void runNetwork("push")}>Push</button>
      {operation && <button className="danger-link" onClick={() => void window.grokDesktop.cancelGitOperation(operation.id)}>取消 {operation.kind}</button>}
      {operationSummary && <span className="git-operation-summary">{operationSummary}</span>}
    </header>
    <div className="git-main-grid">
      <section className="git-diff-pane">
        <header><strong>{git.selection ? `${git.selection.staged ? "暂存区" : "工作区"} · ${git.selection.path}` : "Git Diff"}</strong><div><button disabled={!git.selection} onClick={() => void openEditor()}>在编辑器打开</button><button className="danger-link" disabled={!git.selection || !editable} onClick={() => void discard()}>丢弃</button></div></header>
        {!git.selection ? <div className="git-placeholder">从左侧选择一个变更以查看 Diff。</div> : !git.diff ? <div className="git-placeholder">正在加载 Diff…</div> : git.diff.binary ? <div className="git-placeholder">二进制文件无法显示文本 Diff。</div> : <Suspense fallback={<div className="git-placeholder">正在加载 Diff 编辑器…</div>}><MonacoDiffEditor height="100%" theme={light ? "light" : "vs-dark"} original={diffSides.original} modified={diffSides.modified} language={languageFromPath(git.selection.path)} options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, automaticLayout: true, wordWrap: "on" }} /></Suspense>}
      </section>
      <aside className="git-details-pane">
        <section className="git-commit-box"><h3>提交</h3><textarea value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="提交信息（通过 stdin 传给 Git）" /><button className="primary" disabled={!editable || git.loading || !commitMessage.trim() || !git.status.changes.some((change) => change.staged)} onClick={() => void commit()}>提交已暂存更改</button></section>
        <section className="git-history"><h3>最近提交</h3>{history.map((item) => <button key={item.hash} className={details?.hash === item.hash ? "selected" : ""} onClick={() => void window.grokDesktop.getGitCommitDetails(workspace, item.hash).then(setDetails).catch((error) => dialogs.setError(errorMessage(error)))}><strong>{item.subject}</strong><span>{item.shortHash} · {item.author}</span></button>)}</section>
        {details && <section className="git-commit-details"><h3>{details.subject}</h3><p>{details.body || "无提交正文"}</p><span>{details.shortHash} · {new Date(details.authoredAt).toLocaleString()}</span><ul>{details.files.map((file) => <li key={`${file.oldPath}:${file.path}`}><b>{changeBadge(file)}</b><span>{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</span><small>{file.additions ?? "–"}+ / {file.deletions ?? "–"}−</small></li>)}</ul></section>}
      </aside>
    </div>
  </div>;
}

function groupChanges(status?: GitRepositoryStatus): Array<{ id: "conflicts" | "staged" | "changes" | "untracked"; label: string; items: GitFileChange[] }> {
  if (!status) return [];
  const conflicts = status.changes.filter((change) => change.kind === "conflicted");
  const staged = status.changes.filter((change) => change.staged && change.kind !== "conflicted");
  const changes = status.changes.filter((change) => change.workingTree && change.kind !== "untracked" && change.kind !== "conflicted");
  const untracked = status.changes.filter((change) => change.kind === "untracked");
  return [
    { id: "conflicts" as const, label: "合并冲突", items: conflicts },
    { id: "staged" as const, label: "已暂存的更改", items: staged },
    { id: "changes" as const, label: "更改", items: changes },
    { id: "untracked" as const, label: "未跟踪", items: untracked },
  ].filter((group) => group.items.length);
}

function canMutate(git: ReturnType<typeof useGitStore.getState>): boolean {
  return !git.trust?.required || Boolean(git.trust.trusted);
}

function ensureEditorClean(dialogs: Dialogs): boolean {
  const dirty = useWorkbenchStore.getState().tabs.filter((tab) => tab.dirty);
  if (!dirty.length) return true;
  dialogs.setError(`切换分支前请先保存或关闭 ${dirty.length} 个未保存编辑器标签。`);
  return false;
}

function branchTrack(status: GitRepositoryStatus): string {
  const branch = status.branch;
  if (!branch?.upstream) return "无上游";
  if (!branch.ahead && !branch.behind) return branch.upstream;
  return `${branch.upstream} · ↑${branch.ahead ?? 0} ↓${branch.behind ?? 0}`;
}

function changeBadge(change: Pick<GitFileChange, "kind">): string {
  return ({ untracked: "U", modified: "M", added: "A", deleted: "D", renamed: "R", copied: "C", conflicted: "!", unknown: "?" } as const)[change.kind];
}

function splitUnifiedPatch(patch: string): { original: string; modified: string } {
  const original: string[] = [];
  const modified: string[] = [];
  let inHunk = false;
  for (const line of patch.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("@@")) { inHunk = true; continue; }
    if (!inHunk || line.startsWith("\\ No newline")) continue;
    if (line.startsWith("-")) original.push(line.slice(1));
    else if (line.startsWith("+")) modified.push(line.slice(1));
    else if (line.startsWith(" ")) { original.push(line.slice(1)); modified.push(line.slice(1)); }
  }
  return { original: original.join("\n"), modified: modified.join("\n") };
}

function languageFromPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  return ({ ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", json: "json", css: "css", scss: "scss", html: "html", md: "markdown", py: "python", ps1: "powershell", sh: "shell", toml: "ini", yaml: "yaml", yml: "yaml" } as Record<string, string>)[extension ?? ""] ?? "plaintext";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
