import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleAlert,
  GitCommitHorizontal,
  GitPullRequest,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import type { GitFileChange, GitRepositoryStatus } from "../../../shared/types";
import type { PullRequestStatus } from "../../../shared/workspace-tools";
import { useGitStore } from "../git-store";

const LazyPullRequestDialog = lazy(() =>
  import("./PullRequestDialog").then((module) => ({ default: module.PullRequestDialog })),
);

export interface GitActionsToolbarProps {
  workspace: string;
  sessionId?: string;
  status?: GitRepositoryStatus;
  onStatusChange?(status: GitRepositoryStatus): void;
  onOpenReview?(): void;
  onError?(message: string): void;
}

const NO_DRAG_STYLE = { WebkitAppRegion: "no-drag" } as React.CSSProperties;
const CONVENTIONAL_PREFIXES = ["feat:", "fix:", "refactor:", "chore:", "docs:", "test:"] as const;

function isProtectedBranch(branchName?: string): boolean {
  if (!branchName) return false;
  return /^(?:main|master|production|prod|release\/.+)$/i.test(branchName.trim());
}

function kindBadge(kind: GitFileChange["kind"]): { char: string; color: string } {
  switch (kind) {
    case "added":
    case "untracked":
      return { char: kind === "added" ? "A" : "U", color: "var(--color-success)" };
    case "deleted":
    case "conflicted":
      return { char: kind === "conflicted" ? "!" : "D", color: "var(--color-danger)" };
    case "modified":
    case "renamed":
    default:
      return { char: kind === "renamed" ? "R" : "M", color: "var(--color-warning)" };
  }
}

export function GitActionsToolbar({
  workspace,
  sessionId,
  status: statusProp,
  onStatusChange,
  onOpenReview,
  onError,
}: GitActionsToolbarProps): React.JSX.Element | null {
  const storeStatus = useGitStore((state) => (samePath(state.workspace, workspace) ? state.status : undefined));
  const status = statusProp ?? storeStatus;

  const [commitOpen, setCommitOpen] = useState(false);
  const [prOpen, setPrOpen] = useState(false);
  const [prStatus, setPrStatus] = useState<PullRequestStatus | undefined>(undefined);
  const [commitMessage, setCommitMessage] = useState("");
  const [busyAction, setBusyAction] = useState<"" | "stage" | "commit" | "push" | "pull" | "refresh">("");
  const [feedback, setFeedback] = useState("");
  const generationRef = useRef(0);
  const feedbackTimerRef = useRef<number | undefined>(undefined);

  const reportError = useCallback((error: unknown) => {
    const text = error instanceof Error ? error.message : String(error);
    onError?.(text);
  }, [onError]);

  const publishStatus = useCallback((next: GitRepositoryStatus) => {
    if (samePath(useGitStore.getState().workspace, workspace)) {
      useGitStore.getState().setStatus(next);
    }
    onStatusChange?.(next);
  }, [onStatusChange, workspace]);

  const showFeedback = useCallback((text: string): void => {
    if (feedbackTimerRef.current !== undefined) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    setFeedback(text);
    feedbackTimerRef.current = window.setTimeout(() => {
      feedbackTimerRef.current = undefined;
      setFeedback((current) => (current === text ? "" : current));
    }, 2600);
  }, []);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current !== undefined) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  const refreshGitAndPr = useCallback(async (includePr = true): Promise<void> => {
    if (!workspace) return;
    const gen = ++generationRef.current;
    try {
      const capability = await window.grokDesktop.getGitWorkspaceCapability(workspace);
      if (gen !== generationRef.current) return;
      if (!capability.available) {
        setPrStatus(undefined);
        return;
      }
      const nextStatus = await window.grokDesktop.getGitStatus(workspace);
      if (gen !== generationRef.current) return;
      useGitStore.getState().setRepository(workspace, useGitStore.getState().trust, nextStatus);
      onStatusChange?.(nextStatus);

      if (includePr) {
        const pr = await window.grokDesktop.getPullRequestStatus(workspace).catch(() => undefined);
        if (gen === generationRef.current && pr) setPrStatus(pr);
      }
    } catch {
      // Quietly ignore background probe failures on non-git directories
    }
  }, [onStatusChange, workspace]);

  useEffect(() => {
    setPrStatus(undefined);
    setCommitMessage("");
    setFeedback("");
    if (workspace) void refreshGitAndPr(true);
    return () => { generationRef.current += 1; };
  }, [refreshGitAndPr, workspace]);

  const counts = useMemo(() => {
    const changes = status?.changes ?? [];
    const staged = changes.filter((item) => item.staged).length;
    const unstaged = changes.filter((item) => item.workingTree || item.kind === "untracked").length;
    const conflicts = status?.conflicts.length ?? 0;
    return {
      total: changes.length,
      staged,
      unstaged,
      conflicts,
      ahead: status?.branch?.ahead ?? 0,
      behind: status?.branch?.behind ?? 0,
    };
  }, [status]);

  const prCiDotColor = useMemo(() => {
    if (!prStatus?.available || !prStatus.number) return undefined;
    if (prStatus.checks.some((c) => ["FAILURE", "FAILED", "ERROR", "CANCELLED", "TIMED_OUT"].includes(c.state.toUpperCase()))) {
      return "var(--color-danger)";
    }
    if (prStatus.pending || prStatus.checks.some((c) => ["PENDING", "IN_PROGRESS", "QUEUED"].includes(c.state.toUpperCase()))) {
      return "var(--color-warning)";
    }
    if (prStatus.checks.length > 0) return "var(--color-success)";
    return "var(--color-accent)";
  }, [prStatus]);

  if (!workspace || !status) return null;

  const protectedBranch = isProtectedBranch(status.branch?.name);

  const applyConventionalPrefix = (prefix: string): void => {
    setCommitMessage((current) => {
      const stripped = current.replace(/^(?:feat|fix|refactor|chore|docs|test|perf|ci)(?:\([^)]*\))?:\s*/i, "");
      return `${prefix} ${stripped}`;
    });
  };

  const toggleFileStage = async (change: GitFileChange): Promise<void> => {
    if (busyAction) return;
    setBusyAction("stage");
    try {
      const next = change.staged && !change.workingTree
        ? await window.grokDesktop.unstageGitChanges(workspace, [change.path])
        : await window.grokDesktop.stageGitChanges(workspace, [change.path]);
      publishStatus(next);
    } catch (error) {
      reportError(error);
    } finally {
      setBusyAction("");
    }
  };

  const stageAllOrUnstageAll = async (stageAll: boolean): Promise<void> => {
    if (busyAction) return;
    setBusyAction("stage");
    try {
      const next = stageAll
        ? await window.grokDesktop.stageGitChanges(workspace)
        : await window.grokDesktop.unstageGitChanges(workspace);
      publishStatus(next);
    } catch (error) {
      reportError(error);
    } finally {
      setBusyAction("");
    }
  };

  const handleQuickCommit = async (stageAllFirst: boolean): Promise<void> => {
    const msg = commitMessage.trim();
    if (!msg || busyAction) return;
    setBusyAction("commit");
    try {
      if (stageAllFirst) {
        await window.grokDesktop.stageGitChanges(workspace);
      }
      const summary = await window.grokDesktop.commitGitChanges(workspace, msg);
      setCommitMessage("");
      const next = await window.grokDesktop.getGitStatus(workspace);
      publishStatus(next);
      setCommitOpen(false);
      showFeedback(`已提交 ${summary.shortHash}`);
    } catch (error) {
      reportError(error);
    } finally {
      setBusyAction("");
    }
  };

  const handleNetworkSync = async (kind: "push" | "pull"): Promise<void> => {
    if (busyAction) return;
    setBusyAction(kind);
    const opId = `${kind}-${crypto.randomUUID()}`;
    try {
      const result = kind === "push"
        ? await window.grokDesktop.pushGitRepository(workspace, opId)
        : await window.grokDesktop.pullGitRepository(workspace, opId);
      const next = await window.grokDesktop.getGitStatus(workspace);
      publishStatus(next);
      if (result.completed) showFeedback(kind === "push" ? "已推送" : "已拉取");
    } catch (error) {
      reportError(error);
    } finally {
      setBusyAction("");
    }
  };

  const pillButtonStyle: React.CSSProperties = {
    ...NO_DRAG_STYLE,
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    height: 26,
    padding: "0 8px",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-md)",
    background: "transparent",
    color: "var(--color-fg-subtle)",
    fontSize: "var(--text-xs)",
    fontWeight: 500,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  return (
    <div className="git-actions-toolbar" style={{ ...NO_DRAG_STYLE, display: "inline-flex", alignItems: "center", gap: 4 }}>
      <Popover.Root open={commitOpen} onOpenChange={setCommitOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="git-toolbar-pill"
            style={{
              ...pillButtonStyle,
              borderColor: counts.conflicts > 0
                ? "color-mix(in srgb, var(--color-danger) 55%, var(--color-border))"
                : counts.total > 0
                  ? "color-mix(in srgb, var(--color-warning) 42%, var(--color-border))"
                  : "var(--color-border)",
              color: counts.conflicts > 0
                ? "var(--color-danger)"
                : counts.total > 0
                  ? "var(--color-fg)"
                  : "var(--color-fg-subtle)",
            }}
            title={counts.total > 0 ? `${counts.total} 个未提交变更（点击快速暂存与提交）` : "工作树干净（点击查看 Git 状态）"}
            aria-label="快速暂存与提交"
          >
            {counts.conflicts > 0 ? (
              <CircleAlert size={13} style={{ color: "var(--color-danger)" }} />
            ) : (
              <GitCommitHorizontal size={13} style={{ color: counts.total > 0 ? "var(--color-warning)" : "var(--color-success)" }} />
            )}
            <span>{counts.total > 0 ? `${counts.total}` : "干净"}</span>
          </button>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            className="ui-popover git-quick-commit-popover"
            align="end"
            sideOffset={7}
            collisionPadding={10}
            style={{ width: 348, display: "grid", gap: 9 }}
          >
            <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <strong style={{ display: "block", fontSize: "var(--text-caption)", color: "var(--color-fg)" }}>
                  快速暂存与提交
                </strong>
                <small style={{ color: "var(--color-fg-subtle)", fontSize: "var(--text-xs)" }}>
                  {status.branch?.name || "HEAD"} · 已暂存 {counts.staged} / 共 {counts.total} 项
                </small>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {onOpenReview && (
                  <button
                    type="button"
                    className="ui-btn ui-btn-ghost ui-btn-sm"
                    onClick={() => { setCommitOpen(false); onOpenReview(); }}
                  >
                    审查 Diff
                  </button>
                )}
                <button
                  type="button"
                  className="ui-icon-btn ui-icon-btn-sm"
                  aria-label="刷新 Git 状态"
                  title="刷新 Git 状态"
                  disabled={Boolean(busyAction)}
                  onClick={() => void refreshGitAndPr(false)}
                >
                  <RefreshCw size={13} />
                </button>
              </div>
            </header>

            {protectedBranch && counts.total > 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 8px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid color-mix(in srgb, var(--color-warning) 48%, var(--color-border))",
                  background: "color-mix(in srgb, var(--color-warning) 10%, transparent)",
                  color: "var(--color-warning)",
                  fontSize: 11,
                }}
              >
                <ShieldAlert size={13} style={{ flex: "none" }} />
                <span>当前位于受保护分支 `{status.branch?.name}`，建议移交到隔离 Worktree 或新建分支再提交。</span>
              </div>
            )}

            {counts.total > 0 ? (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--color-fg-subtlest)" }}>变更文件（点击文件名打开审查）</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    {counts.unstaged > 0 && (
                      <button
                        type="button"
                        className="ui-btn ui-btn-ghost ui-btn-sm"
                        style={{ height: 20, padding: "0 6px", fontSize: "var(--text-xs)" }}
                        disabled={Boolean(busyAction)}
                        onClick={() => void stageAllOrUnstageAll(true)}
                      >
                        <Plus size={11} /> 全部暂存
                      </button>
                    )}
                    {counts.staged > 0 && (
                      <button
                        type="button"
                        className="ui-btn ui-btn-ghost ui-btn-sm"
                        style={{ height: 20, padding: "0 6px", fontSize: "var(--text-xs)" }}
                        disabled={Boolean(busyAction)}
                        onClick={() => void stageAllOrUnstageAll(false)}
                      >
                        取消暂存
                      </button>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    maxHeight: 164,
                    overflowY: "auto",
                    display: "grid",
                    gap: 2,
                    padding: 4,
                    borderRadius: "var(--radius-lg)",
                    border: "1px solid var(--color-border)",
                    background: "var(--color-input)",
                  }}
                >
                  {status.changes.slice(0, 25).map((change) => {
                    const badge = kindBadge(change.kind);
                    return (
                      <div
                        key={change.path}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "16px minmax(0, 1fr) auto",
                          alignItems: "center",
                          gap: 6,
                          minHeight: 24,
                          padding: "0 4px",
                          fontSize: "var(--text-xs)",
                        }}
                      >
                        <span style={{ fontWeight: 700, color: badge.color, textAlign: "center", fontFamily: "var(--font-mono)" }}>
                          {badge.char}
                        </span>
                        <button
                          type="button"
                          title={onOpenReview ? `审查 ${change.path}` : change.path}
                          onClick={() => {
                            if (onOpenReview) {
                              setCommitOpen(false);
                              onOpenReview();
                            }
                          }}
                          style={{
                            minWidth: 0,
                            padding: 0,
                            border: 0,
                            background: "transparent",
                            textAlign: "left",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            color: change.staged ? "var(--color-fg)" : "var(--color-fg-subtle)",
                            cursor: onOpenReview ? "pointer" : "default",
                          }}
                        >
                          {change.path}
                        </button>
                        <button
                          type="button"
                          className="ui-btn ui-btn-ghost ui-btn-sm"
                          style={{ height: 20, padding: "0 6px", fontSize: 11 }}
                          disabled={Boolean(busyAction)}
                          onClick={() => void toggleFileStage(change)}
                          title={change.staged && !change.workingTree ? "取消暂存此文件" : "暂存此文件"}
                        >
                          {change.staged && !change.workingTree ? <Check size={11} style={{ color: "var(--color-success)" }} /> : "+"}
                        </button>
                      </div>
                    );
                  })}
                  {status.changes.length > 25 && (
                    <span style={{ padding: "2px 6px", fontSize: 11, color: "var(--color-fg-subtlest)" }}>
                      另有 {status.changes.length - 25} 个文件…
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {CONVENTIONAL_PREFIXES.map((prefix) => (
                    <button
                      key={prefix}
                      type="button"
                      className="ui-btn ui-btn-ghost ui-btn-sm"
                      style={{ height: 20, padding: "0 6px", fontSize: 11, fontFamily: "var(--font-mono)" }}
                      disabled={Boolean(busyAction)}
                      onClick={() => applyConventionalPrefix(prefix)}
                    >
                      {prefix}
                    </button>
                  ))}
                </div>

                <textarea
                  className="ui-textarea"
                  rows={3}
                  style={{ minHeight: 62, fontSize: "var(--text-caption)" }}
                  placeholder="输入提交信息… (Ctrl+Enter 快速提交)"
                  value={commitMessage}
                  disabled={Boolean(busyAction)}
                  onChange={(event) => setCommitMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && commitMessage.trim()) {
                      event.preventDefault();
                      void handleQuickCommit(counts.staged === 0);
                    }
                  }}
                />

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                  {counts.staged > 0 && counts.unstaged > 0 && (
                    <button
                      type="button"
                      className="ui-btn ui-btn-secondary ui-btn-sm"
                      disabled={Boolean(busyAction) || !commitMessage.trim()}
                      onClick={() => void handleQuickCommit(false)}
                    >
                      仅提交已暂存 ({counts.staged})
                    </button>
                  )}
                  <button
                    type="button"
                    className="ui-btn ui-btn-primary ui-btn-sm"
                    disabled={Boolean(busyAction) || !commitMessage.trim() || counts.conflicts > 0}
                    onClick={() => void handleQuickCommit(counts.unstaged > 0)}
                  >
                    {busyAction === "commit" ? <LoaderCircle size={12} className="ui-spin" /> : null}
                    {counts.unstaged > 0 ? "暂存全部并提交" : `提交 (${counts.staged})`}
                  </button>
                </div>
              </>
            ) : (
              <p style={{ margin: 0, padding: "8px 4px", color: "var(--color-fg-subtle)", fontSize: "var(--text-caption)" }}>
                ✓ 当前工作树没有未提交修改。
              </p>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {counts.behind > 0 && (
        <button
          type="button"
          className="git-toolbar-pill"
          style={pillButtonStyle}
          disabled={Boolean(busyAction)}
          title={`拉取远端更新（落后 ${counts.behind} 个提交）`}
          aria-label={`拉取远端更新，落后 ${counts.behind} 个提交`}
          onClick={() => void handleNetworkSync("pull")}
        >
          {busyAction === "pull" ? <LoaderCircle size={12} className="ui-spin" /> : <ArrowDown size={12} />}
          <span>{counts.behind}</span>
        </button>
      )}

      <button
        type="button"
        className="git-toolbar-pill"
        style={{
          ...pillButtonStyle,
          color: counts.ahead > 0 ? "var(--color-accent)" : "var(--color-fg-subtle)",
          borderColor: counts.ahead > 0 ? "color-mix(in srgb, var(--color-accent) 45%, var(--color-border))" : "var(--color-border)",
        }}
        disabled={Boolean(busyAction)}
        title={counts.ahead > 0 ? `推送到远端（领先 ${counts.ahead} 个提交${counts.behind ? `，落后 ${counts.behind}` : ""}）` : "推送当前分支 (git push)"}
        aria-label="推送分支"
        onClick={() => void handleNetworkSync("push")}
      >
        {busyAction === "push" ? <LoaderCircle size={12} className="ui-spin" /> : <ArrowUp size={12} />}
        <span>{counts.ahead > 0 ? `推送 ↑${counts.ahead}` : "推送"}</span>
      </button>

      <button
        type="button"
        className="git-toolbar-pill"
        style={pillButtonStyle}
        title={prStatus?.available && prStatus.number ? `PR #${prStatus.number}：${prStatus.title || ""}（点击查看 CI 状态）` : "创建或查看 Pull Request"}
        aria-label={prStatus?.available && prStatus.number ? `查看 Pull Request #${prStatus.number}` : "创建或查看 Pull Request"}
        onClick={() => setPrOpen(true)}
      >
        <GitPullRequest size={13} style={{ color: prCiDotColor ?? "currentColor" }} />
        <span>{prStatus?.available && prStatus.number ? `#${prStatus.number}` : "PR"}</span>
        {prCiDotColor && (
          <span
            aria-hidden="true"
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: prCiDotColor,
            }}
          />
        )}
      </button>

      {feedback && (
        <span
          role="status"
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--color-success)",
            padding: "0 4px",
            whiteSpace: "nowrap",
          }}
        >
          {feedback}
        </span>
      )}

      {prOpen && (
        <Suspense fallback={null}>
          <LazyPullRequestDialog
            open={prOpen}
            onOpenChange={setPrOpen}
            workspace={workspace}
            sessionId={sessionId}
            currentBranch={status.branch?.name}
            initialStatus={prStatus}
            onStatusChange={setPrStatus}
            onError={onError}
          />
        </Suspense>
      )}
    </div>
  );
}

function samePath(left: string, right: string): boolean {
  return left.replace(/[\\/]+$/, "").toLocaleLowerCase() === right.replace(/[\\/]+$/, "").toLocaleLowerCase();
}
