import { useEffect, useMemo, useState } from "react";
import type { GitReviewFile, GitReviewFileSummary, GitReviewIndex, GitReviewScope, GitWorkspaceCapability, NavigationIntent } from "../../../shared/types";
import { UiIcon } from "../ui-icons";
import type { ReviewCommentDraft } from "../review-comments";

type ScopeKind = GitReviewScope["kind"];

export function ReviewPane({ cwd, sessionId, lastTurnPaths, initialKind = "unstaged", onClose, onNavigate, onAddComment, onError }: {
  cwd: string;
  sessionId?: string;
  lastTurnPaths: string[];
  initialKind?: ScopeKind;
  onClose(): void;
  onNavigate(intent: NavigationIntent): void;
  onAddComment(comment: ReviewCommentDraft): void;
  onError(message: string): void;
}): React.JSX.Element {
  const [kind, setKind] = useState<ScopeKind>(initialKind);
  const [commit, setCommit] = useState("");
  const [branch, setBranch] = useState("");
  const [commits, setCommits] = useState<Array<{ hash: string; shortHash: string; subject: string }>>([]);
  const [branches, setBranches] = useState<Array<{ name: string; current: boolean }>>([]);
  const [index, setIndex] = useState<GitReviewIndex>();
  const [selectedFileId, setSelectedFileId] = useState("");
  const [selectedFile, setSelectedFile] = useState<GitReviewFile>();
  const [fileFilter, setFileFilter] = useState("");
  const [capability, setCapability] = useState<GitWorkspaceCapability>();
  const [loading, setLoading] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [busy, setBusy] = useState("");
  const [commentTarget, setCommentTarget] = useState<{ path: string; line: number; side: "old" | "new" }>();
  const [commentBody, setCommentBody] = useState("");
  const [width, setWidth] = useState(() => Math.max(420, Math.min(760, Number(localStorage.getItem("grok:right-width:review")) || 620)));

  const scope = useMemo<GitReviewScope>(() => {
    if (kind === "commit") return { kind, revision: commit || "HEAD" };
    if (kind === "branch") return { kind, base: branch || "HEAD~1" };
    if (kind === "last-turn") return { kind, paths: lastTurnPaths };
    return { kind };
  }, [branch, commit, kind, lastTurnPaths]);
  const filteredFiles = useMemo(() => {
    const query = fileFilter.trim().toLocaleLowerCase();
    return index?.files.filter((file) => !query || file.path.toLocaleLowerCase().includes(query) || file.oldPath?.toLocaleLowerCase().includes(query)) ?? [];
  }, [fileFilter, index]);
  useEffect(() => setKind(initialKind), [initialKind]);

  const refresh = async (): Promise<void> => {
    if (!cwd) {
      setCapability({ available: false, cwd: "", reason: "no-workspace", message: "请选择工作区后再查看变更" });
      setIndex(undefined);
      setSelectedFile(undefined);
      return;
    }
    setLoading(true);
    try {
      const nextCapability = await window.grokDesktop.getGitWorkspaceCapability(cwd);
      setCapability(nextCapability);
      if (!nextCapability.available) {
        setIndex(undefined);
        setSelectedFile(undefined);
        return;
      }
      const next = await window.grokDesktop.getGitReviewIndex(cwd, scope);
      setIndex(next);
      setSelectedFileId((current) => next.files.some((file) => file.id === current) ? current : next.files[0]?.id ?? "");
    } catch (error) {
      setIndex(undefined);
      setSelectedFile(undefined);
      onError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [cwd, scope]);
  useEffect(() => {
    if (!index || !selectedFileId) { setSelectedFile(undefined); return; }
    let cancelled = false;
    setLoadingFile(true);
    void window.grokDesktop.getGitReviewFileDetail(cwd, scope, index.id, selectedFileId)
      .then((value) => { if (!cancelled) setSelectedFile(value.file); })
      .catch((error) => { if (!cancelled) { setSelectedFile(undefined); onError(errorMessage(error)); } })
      .finally(() => { if (!cancelled) setLoadingFile(false); });
    return () => { cancelled = true; };
  }, [cwd, index?.id, scope, selectedFileId]);
  useEffect(() => {
    if (!cwd || capability?.available !== true) return;
    void Promise.all([window.grokDesktop.listGitHistory(cwd, 30), window.grokDesktop.listGitBranches(cwd)]).then(([history, values]) => {
      setCommits(history);
      setBranches(values);
      setCommit((current) => current || history[0]?.hash || "HEAD");
      setBranch((current) => current || values.find((value) => !value.current)?.name || values[0]?.name || "HEAD~1");
    }).catch(() => undefined);
  }, [capability?.available, cwd]);

  const runFileAction = async (file: GitReviewFile, action: "stage" | "unstage" | "revert"): Promise<void> => {
    if (!cwd) return;
    if (action === "revert" && !window.confirm(`恢复 ${file.path} 的全部未暂存修改？此操作无法撤销。`)) return;
    setBusy(`${action}:${file.id}`);
    try {
      if (action === "stage") await window.grokDesktop.stageGitChanges(cwd, [file.path]);
      else if (action === "unstage") await window.grokDesktop.unstageGitChanges(cwd, [file.path]);
      else await window.grokDesktop.discardGitChanges(cwd, { trackedPaths: file.kind === "untracked" ? [] : [file.path], untrackedPaths: file.kind === "untracked" ? [file.path] : [], confirmedPaths: [file.path] });
      await refresh();
    } catch (error) { onError(errorMessage(error)); }
    finally { setBusy(""); }
  };

  const runHunkAction = async (file: GitReviewFile, hunkId: string, action: "stage" | "unstage" | "revert"): Promise<void> => {
    if (!index || (scope.kind !== "unstaged" && scope.kind !== "staged")) return;
    if (action === "revert" && !window.confirm(`恢复 ${file.path} 的这个区块？此操作无法撤销。`)) return;
    setBusy(`${action}:${hunkId}`);
    try {
      await window.grokDesktop.applyGitReviewHunk(cwd, { snapshotId: index.id, scope, fileId: file.id, hunkId, action, confirmed: action === "revert" });
      await refresh();
    } catch (error) { onError(errorMessage(error)); await refresh(); }
    finally { setBusy(""); }
  };

  const beginResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const move = (moveEvent: PointerEvent): void => setWidth(Math.max(420, Math.min(760, startWidth + startX - moveEvent.clientX)));
    const finish = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      setWidth((current) => { localStorage.setItem("grok:right-width:review", String(current)); return current; });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
  };

  return <aside className="review-pane" aria-label="变更审核" style={{ width }}>
    <div className="review-resizer" role="separator" aria-orientation="vertical" aria-label="调整 Review 宽度" onPointerDown={beginResize}/>
    <header className="review-header"><div><strong>Review</strong><span>{index ? `${index.files.length} 个文件 · +${index.additions} −${index.deletions}` : "代码变更"}</span></div><button className="icon-button" aria-label="关闭审核" title="关闭 Review" onClick={onClose}><UiIcon name="close" /></button></header>
    <nav className="review-scopes" aria-label="审核范围">
      {(["unstaged", "staged", "commit", "branch", "last-turn"] as ScopeKind[]).map((value) => <button key={value} className={kind === value ? "active" : ""} onClick={() => setKind(value)}>{scopeLabel(value)}</button>)}
    </nav>
    {kind === "commit" && <select className="review-reference" aria-label="选择提交" value={commit} onChange={(event) => setCommit(event.target.value)}>{commits.map((value) => <option key={value.hash} value={value.hash}>{value.shortHash} {value.subject}</option>)}</select>}
    {kind === "branch" && <select className="review-reference" aria-label="选择基准分支" value={branch} onChange={(event) => setBranch(event.target.value)}>{branches.map((value) => <option key={value.name} value={value.name}>{value.name}{value.current ? "（当前）" : ""}</option>)}</select>}
    {kind === "last-turn" && !lastTurnPaths.length && <div className="review-empty compact">最近一回合没有可确认的写入路径。</div>}
    <div className="review-toolbar"><button onClick={() => void refresh()} disabled={loading}><UiIcon name="refresh" /> 刷新</button>{index && !index.readOnly && index.files.length > 0 && <button onClick={() => void (kind === "staged" ? window.grokDesktop.unstageGitChanges(cwd) : window.grokDesktop.stageGitChanges(cwd)).then(refresh).catch((error) => onError(errorMessage(error)))}>{kind === "staged" ? "全部取消暂存" : "全部暂存"}</button>}</div>
    {loading && <div className="review-empty">正在建立文件索引…</div>}
    {!loading && capability && !capability.available && <div className="review-empty review-capability-empty"><UiIcon name="folder" /><strong>{capability.message}</strong><span>{capability.reason === "not-repository" ? "仍可在“最近文件”中查看本回合写入内容；Review 只在 Git 工作区中启用。" : "选择可用的 Git 工作区后刷新。"}</span></div>}
    {!loading && index && <div className="review-body">
      <main className="review-selected-file">
        {loadingFile && <div className="review-empty">正在读取所选文件 Diff…</div>}
        {!loadingFile && selectedFile && <ReviewFileDetail file={selectedFile} index={index} kind={kind} busy={busy} cwd={cwd} sessionId={sessionId} onNavigate={onNavigate} onFileAction={runFileAction} onHunkAction={runHunkAction} onComment={(path, line, side) => { setCommentTarget({ path, line, side }); setCommentBody(""); }} />}
        {!loadingFile && !selectedFile && index.files.length > 0 && <div className="review-empty">从文件列表中选择一个文件。</div>}
        {!index.files.length && <div className="review-empty"><UiIcon name="check" /><strong>此范围没有变更</strong><span>切换范围或继续修改文件后刷新。</span></div>}
      </main>
      <aside className="review-file-navigator" aria-label="变更文件列表">
        <label className="review-file-search"><UiIcon name="search"/><input value={fileFilter} onChange={(event) => setFileFilter(event.target.value)} placeholder="筛选文件…" aria-label="筛选审核文件"/></label>
        <div className="review-file-list">{filteredFiles.map((file) => <FileSummary key={file.id} file={file} active={file.id === selectedFileId} onSelect={() => setSelectedFileId(file.id)}/>)}</div>
        <footer>{filteredFiles.length} / {index.files.length} 个文件</footer>
      </aside>
    </div>}
    {commentTarget && index && <div className="review-comment-editor"><strong>{commentTarget.path}:{commentTarget.line}</strong><textarea autoFocus value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="写下审核意见…" /><div><button onClick={() => setCommentTarget(undefined)}>取消</button><button className="primary" disabled={!commentBody.trim()} onClick={() => { onAddComment({ id: crypto.randomUUID(), ...commentTarget, body: commentBody.trim(), snapshotId: index.id, scope }); setCommentTarget(undefined); setCommentBody(""); }}>加入消息</button></div></div>}
  </aside>;
}

function FileSummary({ file, active, onSelect }: { file: GitReviewFileSummary; active: boolean; onSelect(): void }): React.JSX.Element {
  return <button className={`review-file-summary ${active ? "active" : ""}`} onClick={onSelect} title={file.path}>
    <span className={`review-file-status kind-${file.kind}`}>{statusGlyph(file.kind)}</span>
    <span><strong>{file.path.split("/").at(-1)}</strong><small>{file.path}</small></span>
    <span className="diff-stat"><b>+{file.additions}</b><i>−{file.deletions}</i></span>
  </button>;
}

function ReviewFileDetail({ file, index, kind, busy, cwd, sessionId, onNavigate, onFileAction, onHunkAction, onComment }: {
  file: GitReviewFile;
  index: GitReviewIndex;
  kind: ScopeKind;
  busy: string;
  cwd: string;
  sessionId?: string;
  onNavigate(intent: NavigationIntent): void;
  onFileAction(file: GitReviewFile, action: "stage" | "unstage" | "revert"): Promise<void>;
  onHunkAction(file: GitReviewFile, hunkId: string, action: "stage" | "unstage" | "revert"): Promise<void>;
  onComment(path: string, line: number, side: "old" | "new"): void;
}): React.JSX.Element {
  return <div className="review-file-detail">
    <header><div><strong>{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</strong><span>{statusLabel(file.kind)} · +{file.additions} −{file.deletions}</span></div><div className="review-file-actions"><button onClick={() => onNavigate({ sessionId, executionRoot: cwd, targetPath: file.path, surface: "diff" })}>完整 Diff</button><button onClick={() => onNavigate({ sessionId, executionRoot: cwd, targetPath: file.path, surface: "editor" })}>编辑文件</button>{!index.readOnly && kind === "unstaged" && <button disabled={Boolean(busy)} onClick={() => void onFileAction(file, "stage")}>暂存</button>}{!index.readOnly && kind === "staged" && <button disabled={Boolean(busy)} onClick={() => void onFileAction(file, "unstage")}>取消暂存</button>}{!index.readOnly && kind === "unstaged" && <button className="danger-text" disabled={Boolean(busy)} onClick={() => void onFileAction(file, "revert")}>恢复</button>}</div></header>
    {file.binary ? <div className="review-empty compact">二进制文件不显示行级 Diff</div> : file.hunks.map((hunk) => <section className="review-hunk" key={hunk.id}>
      <header><code>{hunk.header}</code><span>{hunk.mutable && kind === "unstaged" && <><button onClick={() => void onHunkAction(file, hunk.id, "stage")}>暂存区块</button><button className="danger-text" onClick={() => void onHunkAction(file, hunk.id, "revert")}>恢复区块</button></>}{hunk.mutable && kind === "staged" && <button onClick={() => void onHunkAction(file, hunk.id, "unstage")}>取消暂存</button>}</span></header>
      <div className="review-lines">{hunk.lines.map((line, position) => {
        const targetLine = line.newLine ?? line.oldLine;
        const side = line.newLine !== undefined ? "new" : "old";
        return <div className={`review-line ${line.kind}`} key={`${position}:${line.oldLine}:${line.newLine}`}><button className="review-comment-button" disabled={!targetLine} title="添加行级批注" onClick={() => targetLine && onComment(file.path, targetLine, side)}>+</button><button className="line-number" onClick={() => targetLine && onNavigate({ sessionId, executionRoot: cwd, targetPath: file.path, line: targetLine, surface: "editor" })}>{line.oldLine ?? ""}</button><button className="line-number" onClick={() => targetLine && onNavigate({ sessionId, executionRoot: cwd, targetPath: file.path, line: targetLine, surface: "editor" })}>{line.newLine ?? ""}</button><code>{line.kind === "addition" ? "+" : line.kind === "deletion" ? "−" : " "}{line.text}</code></div>;
      })}</div>
    </section>)}
  </div>;
}

function scopeLabel(kind: ScopeKind): string { return ({ unstaged: "Unstaged", staged: "Staged", commit: "Commit", branch: "Branch", "last-turn": "Last turn" })[kind]; }
function statusGlyph(kind: GitReviewFile["kind"]): string { return ({ added: "A", modified: "M", deleted: "D", renamed: "R", copied: "C", untracked: "U", conflicted: "!", unknown: "?" })[kind]; }
function statusLabel(kind: GitReviewFile["kind"]): string { return ({ added: "新增", modified: "修改", deleted: "删除", renamed: "重命名", copied: "复制", untracked: "未跟踪", conflicted: "冲突", unknown: "未知" })[kind]; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
