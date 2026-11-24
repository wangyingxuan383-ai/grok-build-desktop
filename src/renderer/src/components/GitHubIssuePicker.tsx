import { useCallback, useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, CircleDot, LoaderCircle, Plus, Search, X } from "lucide-react";
import type { GitHubIssueSummary } from "../../../shared/workspace-tools";

export type { GitHubIssueSummary };

const GITHUB_ISSUE_URL_RE = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/issues\/\d+$/;

export interface GitHubIssuePickerProps {
  workspace: string;
  sessionId?: string;
  linkedNumbers: number[];
  disabled?: boolean;
  onToggleIssue(issueNumber: number, issue?: GitHubIssueSummary): void;
}

export function extractClosesIssueNumbers(body: string): number[] {
  const matches = body.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi);
  const set = new Set<number>();
  for (const m of matches) {
    const num = Number(m[1]);
    if (Number.isSafeInteger(num) && num > 0) set.add(num);
  }
  return [...set];
}

export function syncClosesDirectiveInBody(body: string, issueNumber: number, shouldLink: boolean): string {
  const pattern = new RegExp(
    `(?:^|\\n)\\s*(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+#${issueNumber}\\b[^\\n]*`,
    "gi",
  );
  if (!shouldLink) {
    return body.replace(pattern, "").replace(/\n{3,}/g, "\n\n").trim();
  }
  if (extractClosesIssueNumbers(body).includes(issueNumber)) return body;
  const trimmed = body.trimEnd();
  return trimmed ? `${trimmed}\n\nCloses #${issueNumber}` : `Closes #${issueNumber}`;
}

function parseManualIssueNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  const hashMatch = /^#?(\d+)$/.exec(trimmed);
  if (hashMatch) {
    const n = Number(hashMatch[1]);
    return Number.isSafeInteger(n) && n > 0 ? n : undefined;
  }
  const urlMatch = /\/issues\/(\d+)(?:[/?#]|$)/i.exec(trimmed);
  if (urlMatch) {
    const n = Number(urlMatch[1]);
    return Number.isSafeInteger(n) && n > 0 ? n : undefined;
  }
  return undefined;
}

export function GitHubIssuePicker({
  workspace,
  sessionId,
  linkedNumbers,
  disabled = false,
  onToggleIssue,
}: GitHubIssuePickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [issues, setIssues] = useState<GitHubIssueSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [unavailableReason, setUnavailableReason] = useState<string>("");
  const reqGenRef = useRef(0);

  const fetchIssues = useCallback(
    async (q: string) => {
      const gen = ++reqGenRef.current;
      if (!workspace || typeof window.grokDesktop.listGitHubIssues !== "function") {
        setUnavailableReason("可直接输入 #编号（如 #42）或粘贴 Issue URL 回车插入 Closes #N。");
        setIssues([]);
        return;
      }
      setLoading(true);
      try {
        const res = await window.grokDesktop.listGitHubIssues(workspace, {
          ...(q.trim() ? { search: q.trim() } : {}),
          state: "open",
          limit: 30,
        });
        if (gen !== reqGenRef.current) return;
        if (!res.available) {
          setUnavailableReason(res.reason || "GitHub CLI 暂未连接，可直接输入 #编号关联。");
          setIssues([]);
        } else {
          setUnavailableReason("");
          setIssues(Array.isArray(res.issues) ? res.issues : []);
        }
      } catch (err) {
        if (gen !== reqGenRef.current) return;
        setUnavailableReason(err instanceof Error ? err.message : "读取 GitHub Issue 失败，可直接输入 #编号关联。");
        setIssues([]);
      } finally {
        if (gen === reqGenRef.current) setLoading(false);
      }
    },
    [workspace],
  );

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      void fetchIssues(query);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [fetchIssues, open, query]);

  const handleToggle = (issueNumber: number, issue?: GitHubIssueSummary): void => {
    const alreadyLinked = linkedNumbers.includes(issueNumber);
    onToggleIssue(issueNumber, issue);
    if (sessionId && typeof window.grokDesktop.linkSessionIssue === "function") {
      if (alreadyLinked) {
        void window.grokDesktop.linkSessionIssue(sessionId, null).catch(() => undefined);
      } else if (issue?.url) {
        const repoMatch = GITHUB_ISSUE_URL_RE.exec(issue.url);
        if (repoMatch) {
          void window.grokDesktop
            .linkSessionIssue(sessionId, {
              number: issue.number,
              title: issue.title,
              url: issue.url,
              ...(issue.state ? { state: issue.state } : {}),
              ...(repoMatch[1] ? { repository: repoMatch[1] } : {}),
              linkedAt: new Date().toISOString(),
            })
            .catch(() => undefined);
        }
      }
    }
  };

  const manualNum = parseManualIssueNumber(query);

  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="ui-btn ui-btn-secondary ui-btn-sm"
            disabled={disabled || !workspace}
            title="搜索或输入 GitHub Issue 编号，自动插入 Closes #N 并绑定当前会话"
          >
            <CircleDot size={12} style={{ color: "var(--color-success)" }} />
            <span>关联 Issue (Closes #N)</span>
          </button>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            className="ui-popover"
            align="start"
            sideOffset={6}
            collisionPadding={10}
            style={{ width: 320, display: "grid", gap: 8 }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: 30,
                padding: "0 8px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--color-border-strong)",
                background: "var(--color-input)",
              }}
            >
              <Search size={12} style={{ color: "var(--color-fg-subtlest)", flex: "none" }} />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && manualNum) {
                    e.preventDefault();
                    handleToggle(manualNum);
                    setQuery("");
                  }
                }}
                placeholder="搜索 Issue 标题，或直接输入 #123 回车…"
                style={{
                  width: "100%",
                  border: 0,
                  outline: 0,
                  background: "transparent",
                  color: "var(--color-fg)",
                  fontSize: "var(--text-xs)",
                }}
              />
              {loading && <LoaderCircle size={12} className="ui-spin" />}
            </div>

            {manualNum && !issues.some((i) => i.number === manualNum) && (
              <button
                type="button"
                className="ui-btn ui-btn-secondary ui-btn-sm"
                style={{ justifyContent: "flex-start" }}
                onClick={() => {
                  handleToggle(manualNum);
                  setQuery("");
                }}
              >
                <Plus size={12} />
                <span>
                  {linkedNumbers.includes(manualNum) ? `移除 Closes #${manualNum}` : `添加 Closes #${manualNum}`}
                </span>
              </button>
            )}

            <div style={{ maxHeight: 190, overflowY: "auto", display: "grid", gap: 2 }}>
              {issues.map((issue) => {
                const linked = linkedNumbers.includes(issue.number);
                return (
                  <button
                    key={issue.number}
                    type="button"
                    onClick={() => handleToggle(issue.number, issue)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      padding: "6px 8px",
                      border: 0,
                      borderRadius: "var(--radius-md)",
                      background: linked ? "var(--color-selected)" : "transparent",
                      color: "var(--color-fg)",
                      fontSize: "var(--text-xs)",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <strong style={{ color: "var(--color-accent)", marginRight: 5 }}>#{issue.number}</strong>
                      {issue.title}
                    </span>
                    {linked && <Check size={12} style={{ color: "var(--color-success)", flex: "none" }} />}
                  </button>
                );
              })}

              {!loading && issues.length === 0 && (
                <small style={{ padding: "6px 4px", color: "var(--color-fg-subtlest)", fontSize: "var(--text-xs)" }}>
                  {unavailableReason || "暂无打开的 Issue，可直接输入 #编号 或 GitHub Issue 链接回车关联。"}
                </small>
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {linkedNumbers.map((num) => (
        <span key={num} className="ui-badge ui-badge-success" style={{ height: 22, gap: 4 }}>
          <span>Closes #{num}</span>
          <button
            type="button"
            aria-label={`移除 Closes #${num}`}
            disabled={disabled}
            onClick={() => handleToggle(num)}
            style={{
              border: 0,
              padding: 0,
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
              display: "inline-grid",
              placeItems: "center",
            }}
          >
            <X size={11} />
          </button>
        </span>
      ))}
    </div>
  );
}
