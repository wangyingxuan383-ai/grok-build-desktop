import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  FileText,
  GitBranch,
  GitPullRequest,
  GitPullRequestDraft,
  Layers,
  LoaderCircle,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import type { GitBranchSummary } from "../../../shared/types";
import type { PullRequestStackItem, PullRequestStatus } from "../../../shared/workspace-tools";
import { useWorktreeStore } from "../worktree-store";
import {
  extractClosesIssueNumbers,
  GitHubIssuePicker,
  syncClosesDirectiveInBody,
  type GitHubIssueSummary,
} from "./GitHubIssuePicker";
import { LazyMarkdownView } from "./LazyMarkdownView";
import { Button, IconButton } from "./ui/Button";

export interface PullRequestDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  workspace: string;
  sessionId?: string;
  currentBranch?: string;
  defaultBaseBranch?: string;
  initialStatus?: PullRequestStatus;
  onStatusChange?(status: PullRequestStatus): void;
  onError?(message: string): void;
}

interface PrTemplateCandidate {
  path: string;
  label: string;
  content: string;
}

type CheckTone = "success" | "pending" | "danger" | "neutral";

const STANDARD_PR_TEMPLATE_PATHS = [
  ".github/pull_request_template.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  "docs/pull_request_template.md",
  "pull_request_template.md",
];

function autoSettleStorageKey(workspace: string, sessionId: string): string {
  return `grok.pr-until-merged.v1:${workspace.replace(/[\\/]+$/, "").toLowerCase()}:${sessionId}`;
}

function readAutoSettlePref(workspace: string, sessionId?: string): boolean {
  if (!workspace || !sessionId) return false;
  try {
    return localStorage.getItem(autoSettleStorageKey(workspace, sessionId)) === "1";
  } catch {
    return false;
  }
}

function writeAutoSettlePref(workspace: string, sessionId: string | undefined, value: boolean): void {
  if (!workspace || !sessionId) return;
  try {
    if (value) localStorage.setItem(autoSettleStorageKey(workspace, sessionId), "1");
    else localStorage.removeItem(autoSettleStorageKey(workspace, sessionId));
  } catch {
    // ignore
  }
}

async function discoverPrTemplates(workspace: string): Promise<PrTemplateCandidate[]> {
  if (typeof window.grokDesktop.discoverPullRequestTemplates === "function") {
    const discovered = await window.grokDesktop.discoverPullRequestTemplates(workspace).catch(() => []);
    if (discovered.length > 0) {
      return discovered.map((tpl) => ({
        path: tpl.relativePath,
        label: tpl.name || tpl.relativePath,
        content: tpl.content,
      }));
    }
  }

  const found: PrTemplateCandidate[] = [];
  for (const relPath of STANDARD_PR_TEMPLATE_PATHS) {
    const res = await window.grokDesktop.openEditorDocument(workspace, relPath).catch(() => undefined);
    if (res?.document?.content.trim()) {
      found.push({
        path: res.document.relativePath,
        label: res.document.relativePath,
        content: res.document.content,
      });
      break;
    }
  }

  const dirNodes = await window.grokDesktop
    .listWorkspaceTree(workspace, ".github/PULL_REQUEST_TEMPLATE")
    .catch(() => []);
  for (const node of dirNodes.filter((n) => n.kind === "file" && /\.md$/i.test(n.name)).slice(0, 5)) {
    const res = await window.grokDesktop.openEditorDocument(workspace, node.relativePath).catch(() => undefined);
    if (res?.document?.content.trim() && !found.some((f) => f.path === res.document!.relativePath)) {
      found.push({
        path: res.document.relativePath,
        label: node.name,
        content: res.document.content,
      });
    }
  }
  return found;
}

function classifyCheckState(raw: string): { tone: CheckTone; label: string } {
  const upper = raw.trim().toUpperCase();
  if (["SUCCESS", "PASS", "PASSED", "NEUTRAL", "SKIPPED"].includes(upper)) {
    return { tone: "success", label: "通过" };
  }
  if (["PENDING", "IN_PROGRESS", "QUEUED", "WAITING", "EXPECTED", "REQUESTED"].includes(upper)) {
    return { tone: "pending", label: "运行中" };
  }
  if (
    ["FAILURE", "FAILED", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(upper)
  ) {
    return { tone: "danger", label: "失败" };
  }
  return { tone: "neutral", label: raw || "未知" };
}

export function PullRequestDialog({
  open,
  onOpenChange,
  workspace,
  sessionId,
  currentBranch,
  defaultBaseBranch,
  initialStatus,
  onStatusChange,
  onError,
}: PullRequestDialogProps): React.JSX.Element {
  const [status, setStatus] = useState<PullRequestStatus | undefined>(initialStatus);
  const [stackItems, setStackItems] = useState<PullRequestStackItem[]>([]);
  const [branches, setBranches] = useState<GitBranchSummary[]>([]);
  const [templates, setTemplates] = useState<PrTemplateCandidate[]>([]);
  const [selectedTemplatePath, setSelectedTemplatePath] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [forceCreateMode, setForceCreateMode] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [baseBranch, setBaseBranch] = useState(defaultBaseBranch ?? "");
  const [draft, setDraft] = useState(false);
  const [bodyPreview, setBodyPreview] = useState(false);
  const [watchEnabled, setWatchEnabled] = useState(Boolean(initialStatus?.watching));
  const [untilMergedSettle, setUntilMergedSettle] = useState(() => readAutoSettlePref(workspace, sessionId));
  const [localError, setLocalError] = useState("");
  const [notice, setNotice] = useState("");
  const reqIdRef = useRef(0);
  const settledOnceRef = useRef<Set<string>>(new Set());

  const worktrees = useWorktreeStore((s) => s.items);

  const reportError = useCallback(
    (error: unknown) => {
      const text = error instanceof Error ? error.message : String(error);
      setLocalError(text);
      onError?.(text);
    },
    [onError],
  );

  const headBranch = useMemo(
    () => currentBranch || branches.find((item) => item.current)?.name || "HEAD",
    [branches, currentBranch],
  );

  const stackedChain = useMemo(() => {
    if (stackItems.length >= 2) {
      const firstBase = stackItems[0]?.baseRefName;
      const names = [...(firstBase ? [firstBase] : []), ...stackItems.map((i) => i.headRefName)];
      return [...new Set(names)];
    }
    if (!headBranch || headBranch === "HEAD") return [];
    const branchNames = new Set(branches.map((b) => b.name));
    const chain: string[] = [headBranch];
    const visited = new Set<string>([headBranch]);
    let cursor = headBranch;

    while (chain.length < 6) {
      const wt = worktrees.find((item) => item.branch === cursor);
      const rawParent = wt?.baseRef?.replace(/^origin\//, "");
      if (!rawParent || visited.has(rawParent) || !branchNames.has(rawParent)) break;
      visited.add(rawParent);
      chain.unshift(rawParent);
      cursor = rawParent;
    }

    if (chain.length === 1 && baseBranch && baseBranch !== headBranch) {
      const trunk = branches.find((b) => b.name === "main" || b.name === "master")?.name;
      if (trunk && baseBranch !== trunk) {
        return [trunk, baseBranch, headBranch];
      }
    }
    return chain.length >= 2 ? chain : [];
  }, [baseBranch, branches, headBranch, stackItems, worktrees]);

  const maybeAutoSettleMerged = useCallback(
    async (prStatus: PullRequestStatus): Promise<void> => {
      if (!sessionId || !workspace) return;
      if (!readAutoSettlePref(workspace, sessionId)) return;
      if (prStatus.state?.toUpperCase() !== "MERGED") return;
      const settleKey = `${workspace}:${prStatus.number ?? headBranch}:${sessionId}`;
      if (settledOnceRef.current.has(settleKey)) return;
      settledOnceRef.current.add(settleKey);
      await window.grokDesktop.settleSession?.(sessionId, true).catch(() => undefined);
      setNotice(`PR #${prStatus.number ?? ""} 已合并，已按 until: merged 自动结算当前会话。`);
    },
    [headBranch, sessionId, workspace],
  );

  const loadData = useCallback(
    async (prefill = false): Promise<void> => {
      if (!workspace) return;
      const reqId = ++reqIdRef.current;
      setLoading(true);
      setLocalError("");
      try {
        const [prStatus, branchList, history, discoveredTemplates, prStack] = await Promise.all([
          window.grokDesktop.getPullRequestStatus(workspace),
          window.grokDesktop.listGitBranches(workspace).catch(() => [] as GitBranchSummary[]),
          prefill ? window.grokDesktop.listGitHistory(workspace, 5).catch(() => []) : Promise.resolve([]),
          prefill ? discoverPrTemplates(workspace).catch(() => [] as PrTemplateCandidate[]) : Promise.resolve([]),
          window.grokDesktop.getPullRequestStack?.(workspace).catch(() => undefined) ?? Promise.resolve(undefined),
        ]);
        if (reqId !== reqIdRef.current) return;
        setStatus(prStatus);
        setWatchEnabled(Boolean(prStatus.watching));
        setBranches(branchList);
        if (prStack?.available) setStackItems(prStack.items);
        onStatusChange?.(prStatus);
        void maybeAutoSettleMerged(prStatus);

        if (prefill) {
          setTemplates(discoveredTemplates);
          const current = currentBranch || branchList.find((item) => item.current)?.name || "";
          const wtForCurrent = useWorktreeStore.getState().items.find((w) => w.branch === current);
          const stackedParent = wtForCurrent?.baseRef?.replace(/^origin\//, "");
          const hasStackedParent = Boolean(
            stackedParent && stackedParent !== current && branchList.some((b) => b.name === stackedParent),
          );

          const preferredBase =
            defaultBaseBranch ||
            (hasStackedParent ? stackedParent : undefined) ||
            branchList.find((item) => item.name === "main" && item.name !== current)?.name ||
            branchList.find((item) => item.name === "master" && item.name !== current)?.name ||
            branchList.find((item) => item.name === "develop" && item.name !== current)?.name ||
            branchList.find((item) => !item.current)?.name ||
            "main";
          setBaseBranch((prev) => prev || preferredBase);

          const latestSubject = history[0]?.subject;
          if (latestSubject) {
            setTitle((prev) => prev || latestSubject);
          } else if (current) {
            setTitle((prev) => prev || current.replace(/[-_/]+/g, " "));
          }

          if (discoveredTemplates.length > 0) {
            const primaryTpl = discoveredTemplates[0]!;
            setSelectedTemplatePath(primaryTpl.path);
            setBody((prev) => (prev.trim() ? prev : primaryTpl.content));
          } else if (history.length > 0) {
            const bulletCommits = history.slice(0, 3).map((c) => `- ${c.subject}`).join("\n");
            setBody((prev) => (prev.trim() ? prev : `## 变更摘要\n${bulletCommits}\n\n## 验证方式\n- `));
          }
        }
      } catch (error) {
        if (reqId === reqIdRef.current) reportError(error);
      } finally {
        if (reqId === reqIdRef.current) setLoading(false);
      }
    },
    [currentBranch, defaultBaseBranch, maybeAutoSettleMerged, onStatusChange, reportError, workspace],
  );

  useEffect(() => {
    setUntilMergedSettle(readAutoSettlePref(workspace, sessionId));
  }, [sessionId, workspace]);

  useEffect(() => {
    setTitle("");
    setBody("");
    setBaseBranch(defaultBaseBranch ?? "");
    setSelectedTemplatePath("");
    setStackItems([]);
  }, [currentBranch, defaultBaseBranch, workspace]);

  useEffect(() => {
    if (!open) {
      reqIdRef.current += 1;
      setForceCreateMode(false);
      setBodyPreview(false);
      setLocalError("");
      setNotice("");
      return;
    }
    void loadData(true);
  }, [loadData, open]);

  useEffect(() => {
    const shouldPoll =
      open &&
      workspace &&
      status?.available &&
      (status.pending || (untilMergedSettle && status.state?.toUpperCase() === "OPEN"));
    if (!shouldPoll) return;
    const timer = window.setInterval(() => {
      void loadData(false);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [loadData, open, status?.available, status?.pending, status?.state, untilMergedSettle, workspace]);

  const baseCandidates = useMemo(
    () => branches.filter((item) => item.name !== headBranch),
    [branches, headBranch],
  );

  const hasExistingPr = Boolean(status?.available && status.number) && !forceCreateMode;
  const linkedIssueNumbers = useMemo(() => extractClosesIssueNumbers(body), [body]);

  const checkSummary = useMemo(() => {
    const checks = status?.checks ?? [];
    let passed = 0;
    let pending = 0;
    let failed = 0;
    for (const check of checks) {
      const { tone } = classifyCheckState(check.state);
      if (tone === "success") passed += 1;
      else if (tone === "pending") pending += 1;
      else if (tone === "danger") failed += 1;
    }
    return { total: checks.length, passed, pending, failed };
  }, [status?.checks]);

  const handleToggleWatch = async (enabled: boolean, settleOverride?: boolean): Promise<void> => {
    if (!workspace || !sessionId) return;
    setLocalError("");
    try {
      await window.grokDesktop.watchPullRequest(
        workspace,
        sessionId,
        enabled,
        settleOverride ?? untilMergedSettle,
      );
      setWatchEnabled(enabled);
      if (status) {
        const next = { ...status, watching: enabled };
        setStatus(next);
        onStatusChange?.(next);
      }
    } catch (error) {
      reportError(error);
    }
  };

  const handleToggleUntilMerged = async (checked: boolean): Promise<void> => {
    setUntilMergedSettle(checked);
    writeAutoSettlePref(workspace, sessionId, checked);
    if (!workspace || !sessionId) return;
    if (hasExistingPr && (checked || watchEnabled)) {
      await handleToggleWatch(checked ? true : watchEnabled, checked);
    }
    if (checked && status) {
      await maybeAutoSettleMerged(status);
    }
  };

  const handleToggleIssue = (issueNumber: number, issue?: GitHubIssueSummary): void => {
    const alreadyLinked = linkedIssueNumbers.includes(issueNumber);
    setBody((prev) => syncClosesDirectiveInBody(prev, issueNumber, !alreadyLinked));
    if (!alreadyLinked && issue?.title && !title.trim()) {
      setTitle(issue.title);
    }
  };

  const handleApplyTemplate = (tplPath: string): void => {
    setSelectedTemplatePath(tplPath);
    const matched = templates.find((t) => t.path === tplPath);
    if (!matched) return;
    const preservedCloses = linkedIssueNumbers;
    let nextBody = matched.content;
    for (const num of preservedCloses) {
      nextBody = syncClosesDirectiveInBody(nextBody, num, true);
    }
    setBody(nextBody);
  };

  const handleCreatePr = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!workspace || !title.trim() || creating) return;
    if (!window.grokDesktop.createPullRequest) {
      reportError("当前主进程尚未提供 createPullRequest 接口，请确认 GitHub CLI (gh) 已配置。");
      return;
    }
    setCreating(true);
    setLocalError("");
    setNotice("");
    try {
      let finalBody = body;
      if (stackedChain.length >= 3 && baseBranch && !finalBody.includes("Stacked PR")) {
        finalBody = `> [!NOTE]\n> **Stacked PR 链**：\`${stackedChain.join("` ← `")}\`\n\n${finalBody}`;
      }

      const result = await window.grokDesktop.createPullRequest({
        workspace,
        title: title.trim(),
        body: finalBody,
        ...(baseBranch.trim() ? { base: baseBranch.trim() } : {}),
        draft,
      });
      if (!result.created) {
        throw new Error(result.message || "未能创建 Pull Request");
      }

      if (sessionId && (untilMergedSettle || watchEnabled)) {
        if (untilMergedSettle) writeAutoSettlePref(workspace, sessionId, true);
        await window.grokDesktop
          .watchPullRequest(workspace, sessionId, true, untilMergedSettle)
          .catch(() => undefined);
        setWatchEnabled(true);
      }

      setNotice(result.message || `已创建 PR ${result.number ? `#${result.number}` : ""}`);
      setForceCreateMode(false);
      if (result.status) {
        setStatus(result.status);
        onStatusChange?.(result.status);
      } else {
        await loadData(false);
      }
    } catch (error) {
      reportError(error);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-overlay" />
        <Dialog.Content
          className="ui-dialog pr-dialog"
          style={{
            width: "min(650px, calc(100vw - 32px))",
            maxHeight: "84vh",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
          aria-describedby={undefined}
        >
          <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              {draft && !hasExistingPr ? (
                <GitPullRequestDraft size={18} style={{ color: "var(--color-fg-subtle)", flex: "none" }} />
              ) : (
                <GitPullRequest size={18} style={{ color: "var(--color-accent)", flex: "none" }} />
              )}
              <Dialog.Title style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: 600 }}>
                {hasExistingPr ? `Pull Request #${status?.number}` : "创建 Pull Request"}
              </Dialog.Title>
              {hasExistingPr && status?.state && (
                <span
                  className={`ui-badge ${
                    status.state.toUpperCase() === "OPEN"
                      ? "ui-badge-success"
                      : status.state.toUpperCase() === "MERGED"
                        ? "ui-badge-accent"
                        : ""
                  }`}
                >
                  {status.state}
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <IconButton
                icon="refresh"
                size="sm"
                label="刷新 PR 与 CI 状态"
                disabled={loading || creating}
                onClick={() => void loadData(false)}
              />
              <Dialog.Close asChild>
                <button type="button" className="ui-icon-btn ui-icon-btn-sm" aria-label="关闭">
                  <X size={15} />
                </button>
              </Dialog.Close>
            </div>
          </header>

          {stackedChain.length >= 2 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 6,
                padding: "7px 10px",
                borderRadius: "var(--radius-lg)",
                border: "1px solid var(--color-border)",
                background: "var(--color-card)",
                fontSize: "var(--text-xs)",
              }}
            >
              <Layers size={13} style={{ color: "var(--color-accent)", flex: "none" }} />
              <strong style={{ color: "var(--color-fg)" }}>Stacked PR 栈：</strong>
              {stackedChain.map((branchName, i) => {
                const isHead = branchName === headBranch;
                const stackNode = stackItems.find((item) => item.headRefName === branchName);
                return (
                  <span key={branchName} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    {i > 0 && <span style={{ color: "var(--color-fg-subtlest)" }}>←</span>}
                    <button
                      type="button"
                      disabled={isHead || hasExistingPr}
                      onClick={() => {
                        if (!isHead && !hasExistingPr) setBaseBranch(branchName);
                      }}
                      style={{
                        padding: "1px 6px",
                        borderRadius: "var(--radius-sm)",
                        border: baseBranch === branchName && !hasExistingPr ? "1px solid var(--color-accent)" : "1px solid var(--color-border)",
                        background: isHead ? "var(--color-accent-soft)" : "transparent",
                        color: isHead ? "var(--color-accent)" : "var(--color-fg-subtle)",
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        cursor: isHead || hasExistingPr ? "default" : "pointer",
                      }}
                    >
                      {branchName}
                      {stackNode ? ` (#${stackNode.number})` : ""}
                      {isHead ? " (当前)" : ""}
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          {localError && (
            <div
              role="alert"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                padding: "8px 10px",
                borderRadius: "var(--radius-lg)",
                background: "var(--color-danger-soft)",
                color: "var(--color-danger)",
                fontSize: "var(--text-caption)",
              }}
            >
              <span style={{ overflowWrap: "anywhere" }}>{localError}</span>
              <button
                type="button"
                className="ui-icon-btn ui-icon-btn-sm"
                aria-label="关闭错误提示"
                onClick={() => setLocalError("")}
              >
                <X size={13} />
              </button>
            </div>
          )}

          {notice && (
            <div
              role="status"
              style={{
                padding: "8px 10px",
                borderRadius: "var(--radius-lg)",
                background: "var(--color-success-soft)",
                color: "var(--color-success)",
                fontSize: "var(--text-caption)",
              }}
            >
              {notice}
            </div>
          )}

          {hasExistingPr && status ? (
            <div style={{ display: "grid", gap: 14, overflow: "auto", paddingRight: 2 }}>
              <section
                style={{
                  display: "grid",
                  gap: 8,
                  padding: "12px 14px",
                  borderRadius: "var(--radius-xl)",
                  border: "1px solid var(--color-border)",
                  background: "var(--color-card)",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ display: "block", fontSize: "var(--text-base)", color: "var(--color-fg)", overflowWrap: "anywhere" }}>
                      {status.title || `PR #${status.number}`}
                    </strong>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 4, fontSize: "var(--text-xs)", color: "var(--color-fg-subtle)" }}>
                      <GitBranch size={12} /> {headBranch}
                    </span>
                  </div>
                  {status.url && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void window.grokDesktop.openExternal(status.url!).catch(reportError)}
                    >
                      <ExternalLink size={13} /> 在 GitHub 打开
                    </Button>
                  )}
                </div>

                {sessionId && (
                  <div style={{ display: "grid", gap: 6, paddingTop: 8, borderTop: "1px solid var(--color-border)" }}>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: "var(--text-caption)",
                        color: "var(--color-fg-subtle)",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={watchEnabled}
                        onChange={(event) => void handleToggleWatch(event.target.checked)}
                      />
                      <span>监听 CI 检查并在完成后通知当前会话</span>
                    </label>

                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: "var(--text-caption)",
                        color: "var(--color-fg-subtle)",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={untilMergedSettle}
                        onChange={(event) => void handleToggleUntilMerged(event.target.checked)}
                      />
                      <span>PR 合并后自动结算此会话 (until: merged)</span>
                    </label>
                  </div>
                )}
              </section>

              <section style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <strong style={{ fontSize: "var(--text-caption)", color: "var(--color-fg)" }}>
                    CI 检查状态 ({checkSummary.total})
                  </strong>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {checkSummary.passed > 0 && <span className="ui-badge ui-badge-success">✓ {checkSummary.passed} 通过</span>}
                    {checkSummary.pending > 0 && <span className="ui-badge ui-badge-warning">● {checkSummary.pending} 运行中</span>}
                    {checkSummary.failed > 0 && <span className="ui-badge ui-badge-danger">✕ {checkSummary.failed} 失败</span>}
                  </div>
                </div>

                {status.checks.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 220, overflowY: "auto", padding: 2 }}>
                    {status.checks.map((check) => {
                      const info = classifyCheckState(check.state);
                      const badgeTone =
                        info.tone === "success"
                          ? "ui-badge-success"
                          : info.tone === "pending"
                            ? "ui-badge-warning"
                            : info.tone === "danger"
                              ? "ui-badge-danger"
                              : "";
                      return (
                        <span
                          key={check.name}
                          className={`ui-badge ${badgeTone}`}
                          style={{ height: 24, padding: "0 9px", gap: 5, maxWidth: "100%" }}
                          title={`${check.name} · ${check.state}`}
                        >
                          {info.tone === "success" ? (
                            <CheckCircle2 size={12} />
                          ) : info.tone === "pending" ? (
                            <LoaderCircle size={12} className="ui-spin" />
                          ) : info.tone === "danger" ? (
                            <CircleAlert size={12} />
                          ) : null}
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{check.name}</span>
                          <small style={{ opacity: 0.78 }}>{info.label}</small>
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <p
                    style={{
                      margin: 0,
                      padding: "12px",
                      borderRadius: "var(--radius-lg)",
                      border: "1px dashed var(--color-border)",
                      color: "var(--color-fg-subtle)",
                      fontSize: "var(--text-sm)",
                      textAlign: "center",
                    }}
                  >
                    {loading ? "正在读取 CI 检查…" : "当前分支 PR 暂无上报的 CI 检查项。"}
                  </p>
                )}
              </section>

              <div className="ui-dialog-actions" style={{ marginTop: 4, justifyContent: "space-between" }}>
                <Button variant="ghost" size="sm" onClick={() => setForceCreateMode(true)}>
                  <Plus size={13} /> 新建其他 / Stacked PR
                </Button>
                <Button variant="primary" size="md" onClick={() => onOpenChange(false)}>
                  完成
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={(event) => void handleCreatePr(event)} style={{ display: "grid", gap: 12, overflow: "auto", paddingRight: 2 }}>
              {status && !status.available && status.reason && (
                <p
                  style={{
                    margin: 0,
                    padding: "7px 10px",
                    borderRadius: "var(--radius-lg)",
                    background: "var(--color-hover)",
                    color: "var(--color-fg-subtle)",
                    fontSize: "var(--text-xs)",
                  }}
                >
                  {status.reason}
                </p>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "end", gap: 8 }}>
                <label className="ui-field">
                  <span>目标基准分支 (Base)</span>
                  {baseCandidates.length > 0 ? (
                    <select
                      className="ui-select"
                      value={baseBranch}
                      onChange={(event) => setBaseBranch(event.target.value)}
                      disabled={creating}
                    >
                      {!baseCandidates.some((item) => item.name === baseBranch) && baseBranch && (
                        <option value={baseBranch}>{baseBranch}</option>
                      )}
                      {baseCandidates.map((branch) => (
                        <option key={branch.name} value={branch.name}>
                          {branch.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="ui-input"
                      value={baseBranch}
                      onChange={(event) => setBaseBranch(event.target.value)}
                      placeholder="main"
                      disabled={creating}
                    />
                  )}
                </label>
                <span style={{ paddingBottom: 7, color: "var(--color-fg-subtlest)", fontSize: "var(--text-sm)" }}>←</span>
                <div className="ui-field">
                  <span>当前源分支 (Head)</span>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      height: "var(--control-lg)",
                      padding: "0 10px",
                      borderRadius: "var(--radius-lg)",
                      border: "1px solid var(--color-border)",
                      background: "var(--color-card)",
                      color: "var(--color-fg)",
                      fontSize: "var(--text-caption)",
                    }}
                  >
                    <GitBranch size={13} style={{ color: "var(--color-accent)", flex: "none" }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{headBranch}</span>
                  </div>
                </div>
              </div>

              <label className="ui-field">
                <span>标题</span>
                <input
                  className="ui-input"
                  autoFocus
                  required
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="简要概括此变更集的目的…"
                  disabled={creating}
                />
              </label>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <GitHubIssuePicker
                  workspace={workspace}
                  sessionId={sessionId}
                  linkedNumbers={linkedIssueNumbers}
                  disabled={creating}
                  onToggleIssue={handleToggleIssue}
                />

                {templates.length > 0 && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <FileText size={12} style={{ color: "var(--color-fg-subtle)" }} />
                    {templates.length > 1 ? (
                      <select
                        aria-label="选择 PR 模板"
                        className="ui-select"
                        style={{ height: 24, width: "auto", fontSize: "var(--text-xs)", padding: "0 6px" }}
                        value={selectedTemplatePath}
                        onChange={(e) => handleApplyTemplate(e.target.value)}
                      >
                        {templates.map((tpl) => (
                          <option key={tpl.path} value={tpl.path}>
                            模板：{tpl.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <button
                        type="button"
                        className="ui-btn ui-btn-ghost ui-btn-sm"
                        style={{ height: 24, fontSize: "var(--text-xs)" }}
                        onClick={() => handleApplyTemplate(templates[0]!.path)}
                        title={`重新套用 ${templates[0]!.path}`}
                      >
                        重载 PR 模板
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="ui-field">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--color-fg)", fontWeight: 500 }}>描述 (Markdown)</span>
                  <div className="ui-seg ui-seg-sm" role="group" aria-label="描述编辑模式">
                    <button type="button" aria-pressed={!bodyPreview} onClick={() => setBodyPreview(false)}>
                      编辑
                    </button>
                    <button type="button" aria-pressed={bodyPreview} onClick={() => setBodyPreview(true)}>
                      预览
                    </button>
                  </div>
                </div>
                {bodyPreview ? (
                  <div
                    style={{
                      minHeight: 132,
                      maxHeight: 240,
                      overflow: "auto",
                      padding: "10px 12px",
                      borderRadius: "var(--radius-lg)",
                      border: "1px solid var(--color-border)",
                      background: "var(--color-card)",
                    }}
                  >
                    {body.trim() ? (
                      <LazyMarkdownView text={body} />
                    ) : (
                      <span style={{ color: "var(--color-fg-subtlest)", fontSize: "var(--text-sm)" }}>暂无描述内容</span>
                    )}
                  </div>
                ) : (
                  <textarea
                    className="ui-textarea"
                    rows={5}
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    placeholder={"## 变更摘要\n- 说明关键修改点与动机\n\n## 验证方式\n- 已通过的测试与检查"}
                    disabled={creating}
                  />
                )}
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: "var(--text-caption)",
                    color: "var(--color-fg-subtle)",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={draft}
                    onChange={(event) => setDraft(event.target.checked)}
                    disabled={creating}
                  />
                  <span>作为草稿 (Draft PR) 创建，暂不请求正式合入</span>
                </label>

                {sessionId && (
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: "var(--text-caption)",
                      color: "var(--color-fg-subtle)",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={untilMergedSettle}
                      onChange={(event) => setUntilMergedSettle(event.target.checked)}
                      disabled={creating}
                    />
                    <span>监听此 PR，合并后自动结算当前会话 (until: merged)</span>
                  </label>
                )}
              </div>

              <div className="ui-dialog-actions" style={{ marginTop: 4 }}>
                {status?.available && status.number && (
                  <Button variant="ghost" onClick={() => setForceCreateMode(false)} disabled={creating}>
                    返回当前 PR #{status.number}
                  </Button>
                )}
                <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={creating}>
                  取消
                </Button>
                <Button type="submit" variant="primary" loading={creating} disabled={!title.trim() || !workspace}>
                  <RefreshCw size={13} style={{ display: "none" }} />
                  {draft ? "创建草稿 PR" : "创建 Pull Request"}
                </Button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
