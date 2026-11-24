import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Check, FolderGit2, GitMerge, LoaderCircle, X } from "lucide-react";
import type {
  MergeBackPreview,
  SessionExecutionAssignment,
  SessionSummary,
  StagedMergeBackRecord,
  WorktreeApplyPreview,
} from "../../../shared/types";
import { errorMessage } from "../error-message";
import { useGitStore } from "../git-store";
import { useAppStore } from "../store";
import { useWorktreeStore } from "../worktree-store";

export interface StagedMergeBackCardProps {
  sessionId: string;
  sessionStatus?: string;
  assignment?: SessionExecutionAssignment;
  session?: SessionSummary;
  workspace: string;
  onOpenReview?(): void;
  onMerged?(message: string): void;
  onSelectParent?(parentSessionId: string, cwd: string): void;
  onError?(message: string): void;
}

export const StagedMergeBackCard = memo(function StagedMergeBackCard({
  sessionId,
  sessionStatus,
  assignment,
  session,
  workspace,
  onOpenReview,
  onMerged,
  onSelectParent,
  onError,
}: StagedMergeBackCardProps): React.JSX.Element | null {
  const worktreeId = assignment?.worktreeId || session?.worktreeId || "";
  const sourceWorkspace = assignment?.sourceWorkspacePath || workspace;
  const parentSessionId = session?.parentSessionId || "";

  const [preview, setPreview] = useState<WorktreeApplyPreview>();
  const [mergeBackPreview, setMergeBackPreview] = useState<MergeBackPreview>();
  const [parentStagedRecords, setParentStagedRecords] = useState<StagedMergeBackRecord[]>([]);
  const [cleanupAfterMerge, setCleanupAfterMerge] = useState(false);
  const [applying, setApplying] = useState(false);
  const [distilling, setDistilling] = useState(false);
  const [dismissedKey, setDismissedKey] = useState("");
  const reqGenRef = useRef(0);

  const loadPreview = useCallback(async () => {
    if (sessionStatus === "working") return;
    const gen = ++reqGenRef.current;
    try {
      const [wtPreview, mbPreview, runtimePrefs] = await Promise.all([
        worktreeId && sourceWorkspace
          ? window.grokDesktop.previewWorktreeApply(sourceWorkspace, worktreeId).catch(() => undefined)
          : Promise.resolve(undefined),
        parentSessionId && typeof window.grokDesktop.previewMergeBackSession === "function"
          ? window.grokDesktop.previewMergeBackSession(sessionId, parentSessionId).catch(() => undefined)
          : Promise.resolve(undefined),
        typeof window.grokDesktop.getSessionRuntimePreferences === "function"
          ? window.grokDesktop.getSessionRuntimePreferences(sessionId).catch(() => undefined)
          : Promise.resolve(undefined),
      ]);
      if (gen === reqGenRef.current) {
        setPreview(wtPreview);
        setMergeBackPreview(mbPreview);
        setParentStagedRecords(runtimePrefs?.stagedMergeBacks ?? []);
      }
    } catch {
      if (gen === reqGenRef.current) {
        setPreview(undefined);
        setMergeBackPreview(undefined);
      }
    }
  }, [parentSessionId, sessionId, sessionStatus, sourceWorkspace, worktreeId]);

  useEffect(() => {
    setPreview(undefined);
    setMergeBackPreview(undefined);
    setParentStagedRecords([]);
    return () => {
      reqGenRef.current += 1;
    };
  }, [sessionId, worktreeId]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  if (sessionStatus === "working") return null;
  const hasWorktreeChanges = Boolean(
    worktreeId && sourceWorkspace && preview && (preview.commits.length > 0 || preview.files.length > 0),
  );
  const canDistillToParent = Boolean(
    parentSessionId && mergeBackPreview?.canMergeBack && mergeBackPreview.confirmationToken,
  );
  const hasParentStaged = parentStagedRecords.length > 0;
  if (!hasWorktreeChanges && !canDistillToParent && !hasParentStaged) return null;

  const snapshotKey = `${sessionId}:${worktreeId}:${preview?.headRef ?? ""}:${preview?.files.length ?? 0}:${parentStagedRecords.length}`;
  if (dismissedKey === snapshotKey) return null;

  const handleApply = async (): Promise<void> => {
    if (applying || !preview?.canApply || !preview.confirmationToken) return;
    setApplying(true);
    try {
      const result = await window.grokDesktop.applyWorktree(
        sourceWorkspace,
        worktreeId,
        preview.confirmationToken,
        true,
        cleanupAfterMerge,
      );
      setPreview(undefined);
      const [items, gitStatus] = await Promise.all([
        window.grokDesktop.listWorktrees(sourceWorkspace).catch(() => []),
        window.grokDesktop.getGitStatus(sourceWorkspace).catch(() => undefined),
      ]);
      useWorktreeStore.getState().setItems(sourceWorkspace, items);
      if (gitStatus) useGitStore.getState().setStatus(gitStatus);
      onMerged?.(result.message);
    } catch (error) {
      onError?.(errorMessage(error));
    } finally {
      setApplying(false);
    }
  };

  const handleDistillMergeBack = async (): Promise<void> => {
    if (distilling || !parentSessionId || !mergeBackPreview?.confirmationToken) return;
    setDistilling(true);
    try {
      const res = await window.grokDesktop.mergeBackSession({
        sessionId,
        targetSessionId: parentSessionId,
        applyWorktree: false,
        settleChild: false,
        confirmationToken: mergeBackPreview.confirmationToken,
        confirmed: true,
      });
      onMerged?.(res.message);
      const targetParentId = res.parentSessionId || parentSessionId;
      const parentSummary = useAppStore.getState().sessions.find((s) => s.id === targetParentId);
      const parentCwd = parentSummary?.cwd || sourceWorkspace;
      if (targetParentId && parentCwd) {
        onSelectParent?.(targetParentId, parentCwd);
      }
    } catch (error) {
      onError?.(errorMessage(error));
    } finally {
      setDistilling(false);
    }
  };

  const handleDismissStagedRecord = async (childId: string): Promise<void> => {
    try {
      await window.grokDesktop.dismissStagedMergeBack?.(sessionId, childId);
      setParentStagedRecords((prev) => prev.filter((item) => item.childSessionId !== childId));
    } catch (error) {
      onError?.(errorMessage(error));
    }
  };

  return (
    <section className="staged-merge-card" role="region" aria-label="分叉与隔离 Worktree 回并操作">
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: "1 1 260px" }}>
        <FolderGit2 size={15} style={{ color: "var(--color-accent)", flex: "none" }} />
        <div style={{ minWidth: 0, display: "grid", gap: 2 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <strong>
              {hasWorktreeChanges
                ? "隔离 Worktree 改动就绪"
                : hasParentStaged
                  ? `已挂载 ${parentStagedRecords.length} 个子会话回并结论`
                  : "分叉探索会话可回并结论"}
            </strong>
            {preview && hasWorktreeChanges && (
              <>
                <span className="ui-badge ui-badge-accent" style={{ height: 18, fontSize: 10 }}>
                  {preview.commits.length} 提交 · {preview.files.length} 文件
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                  <i style={{ color: "var(--color-success)", fontStyle: "normal" }}>+{preview.additions}</i>
                  {" / "}
                  <b style={{ color: "var(--color-danger)", fontWeight: 600 }}>−{preview.deletions}</b>
                </span>
              </>
            )}
          </div>
          <span style={{ color: preview && !preview.canApply ? "var(--color-warning)" : "var(--color-fg-subtle)", overflowWrap: "anywhere" }}>
            {hasWorktreeChanges && preview
              ? preview.canApply
                ? `主目录干净，可安全合入 ${sourceWorkspace.split(/[\\/]/).filter(Boolean).at(-1) || "主工作区"}`
                : preview.reason || "主目录存在未提交冲突改动，请先审查或整理"
              : hasParentStaged
                ? `下一轮发送消息时将自动注入：${parentStagedRecords.map((r) => r.childTitle).join("、")}`
                : "可将当前分叉会话的研究结论与文件摘要幂等回填至父会话草稿槽，不污染父分支代码"}
          </span>
        </div>
      </div>

      <div style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 8, flex: "none" }}>
        {hasParentStaged &&
          parentStagedRecords.map((rec) => (
            <button
              key={rec.childSessionId}
              type="button"
              className="ui-btn ui-btn-ghost ui-btn-sm"
              onClick={() => void handleDismissStagedRecord(rec.childSessionId)}
              title={`移除子会话「${rec.childTitle}」待注入摘要`}
            >
              移除 {rec.childTitle.slice(0, 12)} ×
            </button>
          ))}

        {canDistillToParent && (
          <button
            type="button"
            className="ui-btn ui-btn-secondary ui-btn-sm"
            disabled={distilling || applying}
            title="将此子会话的最终结论与改动摘要挂载到父会话草稿（T3 Merge Back 非破坏性回并）"
            onClick={() => void handleDistillMergeBack()}
          >
            {distilling ? <LoaderCircle size={12} className="ui-spin" /> : <GitMerge size={12} />}
            回并结论到父会话
          </button>
        )}
        {hasWorktreeChanges && preview && (
          <>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--color-fg-subtle)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={cleanupAfterMerge}
                disabled={applying}
                onChange={(e) => setCleanupAfterMerge(e.target.checked)}
              />
              <span>合入后清理</span>
            </label>
            {onOpenReview && (
              <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={onOpenReview}>
                审查 Diff
              </button>
            )}
            <button
              type="button"
              className="ui-btn ui-btn-primary ui-btn-sm"
              disabled={!preview.canApply || !preview.confirmationToken || applying}
              onClick={() => void handleApply()}
            >
              {applying ? <LoaderCircle size={12} className="ui-spin" /> : <Check size={12} />}
              合入主目录
            </button>
          </>
        )}
        <button
          type="button"
          className="ui-icon-btn ui-icon-btn-sm"
          aria-label="暂不处理此回并提醒"
          title="稍后处理"
          onClick={() => setDismissedKey(snapshotKey)}
        >
          <X size={13} />
        </button>
      </div>
    </section>
  );
});
