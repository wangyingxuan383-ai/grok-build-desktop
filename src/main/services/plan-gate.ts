import { pathWithin } from "../../shared/path-utils";

const UNSAFE_SHELL_SYNTAX = /[\0\r\n;&|<>`^]|\$\(|\$\{|@\(|%|![A-Za-z_][A-Za-z0-9_]*!/;
const SIMPLE_READ_ONLY_COMMAND = /^(?:pwd|dir|ls|Get-(?:ChildItem|Content|Item|Location)|type|cat|head|tail|findstr|rg|grep)(?:\s+.*)?$/i;
const SAFE_GIT_QUERY = /^git\s+(?:status|diff|log|show)(?:\s+.*)?$/i;
const SAFE_GIT_BRANCH_QUERY = /^git\s+branch(?:\s+--(?:show-current|list|all|remotes)(?:\s+[^-\s][^\s]*)*)?$/i;
const SAFE_NODE_QUERY = /^node\s+(?:--version|-v)$/i;
const SAFE_NPM_QUERY = /^npm\s+(?:--version|-v|view(?:\s+.+)?)$/i;
const SAFE_GROK_QUERY = /^grok\s+(?:--version|version|models|inspect)(?:\s+.*)?$/i;
const WRITE_CAPABLE_QUERY_FLAG = /(?:^|\s)(?:--output(?:=|\s)|--ext-diff\b|--exec\b|-exec(?:dir)?\b|-delete\b|-fprint(?:f)?\b|--pre(?:-glob)?\b)/i;

export function isWithinWorkspace(candidate: string, workspaceRoot: string): boolean {
  return pathWithin(candidate, workspaceRoot);
}

export function shouldBlockWrite(path: string, workspaceRoot: string, planActive: boolean): boolean {
  return planActive && isWithinWorkspace(path, workspaceRoot);
}

export function shouldBlockCommand(command: string, planActive: boolean): boolean {
  return planActive && !isReadOnlyCommand(command);
}

export function isReadOnlyCommand(command: string): boolean {
  const value = command.trim();
  if (!value || UNSAFE_SHELL_SYNTAX.test(value) || WRITE_CAPABLE_QUERY_FLAG.test(value)) return false;
  return SIMPLE_READ_ONLY_COMMAND.test(value)
    || SAFE_GIT_QUERY.test(value)
    || SAFE_GIT_BRANCH_QUERY.test(value)
    || SAFE_NODE_QUERY.test(value)
    || SAFE_NPM_QUERY.test(value)
    || SAFE_GROK_QUERY.test(value);
}

/**
 * Plan mode may inspect the workspace without interrupting for every read.
 * This is intentionally narrower than "always approve": ACP read/search/fetch
 * tools and commands already accepted by the read-only shell gate are allowed;
 * edits, deletes, moves, mode switches and unknown tools still require a
 * decision (and workspace writes remain blocked by shouldBlockWrite).
 */
export function isPlanSafeToolCall(toolCall: unknown): boolean {
  if (!toolCall || typeof toolCall !== "object") return false;
  const value = toolCall as Record<string, unknown>;
  const raw = value.rawInput && typeof value.rawInput === "object" ? value.rawInput as Record<string, unknown> : undefined;
  const kind = String(value.kind || raw?.kind || "").trim().toLowerCase();
  const descriptor = `${kind} ${String(value.title || "")} ${String(raw?.name || raw?.tool || "")}`.toLowerCase();
  if (/\b(?:edit|write|create|delete|remove|move|rename|patch|apply|execute|terminal|shell|switch_mode)\b/.test(descriptor) && kind !== "execute") return false;
  if (["read", "search", "think", "fetch"].includes(kind)) return true;
  if (kind === "execute") {
    const command = firstCommand(value, raw);
    return command ? isReadOnlyCommand(command) : false;
  }
  return /\b(?:read|search|list|glob|grep|find|inspect|fetch|think)\b/.test(descriptor);
}

function firstCommand(toolCall: Record<string, unknown>, raw?: Record<string, unknown>): string | undefined {
  for (const candidate of [raw?.command, raw?.cmd, raw?.script, toolCall.command]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  const content = Array.isArray(toolCall.content) ? toolCall.content : [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const nested = record.content && typeof record.content === "object" ? record.content as Record<string, unknown> : undefined;
    for (const candidate of [record.command, nested?.command, nested?.text]) {
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
  }
  return undefined;
}
