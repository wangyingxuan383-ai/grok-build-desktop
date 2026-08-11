import type { GitFileChange, GitFileChangeKind, GitRepositoryStatus } from "../../shared/types";

type JsonObject = Record<string, unknown>;

/** Converts the structured x.ai/git/status response to the established
 * renderer contract.  Unknown or prompt-only responses deliberately return
 * undefined so callers can fall back to the bounded system Git implementation. */
export function normalizeOfficialGitStatus(value: JsonObject, workspacePath: string): GitRepositoryStatus | undefined {
  const data = object(value.data) ?? value;
  const root = string(data.root);
  const staged = array(data.staged);
  const unstaged = array(data.unstaged);
  if (!root || !staged || !unstaged) return undefined;

  const changes = new Map<string, GitFileChange>();
  for (const row of staged) mergeChange(changes, row, true);
  for (const row of unstaged) mergeChange(changes, row, false);
  const list = Array.from(changes.values());
  const branchName = string(data.branch);
  const upstream = string(data.upstream);
  const remoteUrl = sanitizeRemoteUrl(string(data.remoteUrl));

  return {
    workspacePath,
    repositoryRoot: root,
    branch: branchName || string(data.commit) ? {
      name: branchName || "HEAD",
      current: true,
      detached: !branchName,
      upstream,
      ahead: finiteNumber(data.ahead),
      behind: finiteNumber(data.behind),
      commit: string(data.commit),
    } : undefined,
    remote: remoteUrl ? { name: upstream?.split("/")[0] || "origin", displayUrl: remoteUrl } : undefined,
    clean: list.length === 0,
    changes: list,
    conflicts: list.filter((change) => change.kind === "conflicted").map((change) => change.path),
    checkedAt: new Date().toISOString(),
  };
}

function mergeChange(target: Map<string, GitFileChange>, value: unknown, staged: boolean): void {
  const row = object(value);
  const path = row && string(row.path);
  if (!row || !path) return;
  const oldPath = string(row.oldPath);
  const key = `${path}\0${oldPath || ""}`;
  const existing = target.get(key);
  const kind = changeKind(string(row.type));
  target.set(key, {
    path,
    oldPath,
    kind: existing?.kind === "conflicted" ? existing.kind : kind,
    staged: staged || Boolean(existing?.staged),
    workingTree: !staged || Boolean(existing?.workingTree),
  });
}

function changeKind(value?: string): GitFileChangeKind {
  switch (value?.toLowerCase()) {
    case "create": case "added": return "added";
    case "edit": case "modified": case "typechange": return "modified";
    case "delete": case "deleted": return "deleted";
    case "rename": case "renamed": return "renamed";
    case "copy": case "copied": return "copied";
    case "untracked": return "untracked";
    case "conflict": case "conflicted": return "conflicted";
    default: return "unknown";
  }
}

function sanitizeRemoteUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return value.replace(/^(https?:\/\/)[^/@\s]+@/i, "$1");
  }
}

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}
function array(value: unknown): unknown[] | undefined { return Array.isArray(value) ? value : undefined; }
function string(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value : undefined; }
function finiteNumber(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
