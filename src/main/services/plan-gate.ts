import { isAbsolute, relative, resolve } from "node:path";

// This is deliberately a deny-by-default lexical gate rather than a partial
// PowerShell parser. Braces and parentheses can execute script blocks or
// nested pipelines even when the visible pipeline stage starts with a benign
// command (for example `Where-Object { Remove-Item ... }`). Square brackets
// are also rejected because PowerShell static method calls can mutate the
// machine without invoking a normally mutating command name.
const UNSAFE_SHELL_SYNTAX = /[\0\r\n;&<>`^{}()[\]]|\|\||\$\(|\$\{|@\(|%|![A-Za-z_][A-Za-z0-9_]*!/;
const SIMPLE_READ_ONLY_COMMAND = /^(?:pwd|dir|ls|Get-(?:ChildItem|Content|Item|Location)|type|cat|head|tail|findstr|rg|grep)(?:\s+.*)?$/i;
const READ_ONLY_PIPELINE_STAGE = /^(?:Where-Object|Select-(?:Object|String)|Sort-Object|Group-Object|Measure-Object|Format-(?:Table|List|Wide)|findstr|grep|head|tail|more)(?:\s+.*)?$/i;
const SAFE_GIT_QUERY = /^git\s+(?:status|diff|log|show)(?:\s+.*)?$/i;
const SAFE_GIT_BRANCH_QUERY = /^git\s+branch(?:\s+--(?:show-current|list|all|remotes)(?:\s+[^-\s][^\s]*)*)?$/i;
const SAFE_NODE_QUERY = /^node\s+(?:--version|-v)$/i;
const SAFE_NPM_QUERY = /^npm\s+(?:--version|-v|view(?:\s+.+)?)$/i;
const SAFE_GROK_QUERY = /^grok\s+(?:--version|version|models|inspect)(?:\s+.*)?$/i;
// `git diff/show --textconv` is not necessarily read-only: Git may invoke an
// arbitrary external text-conversion driver from repository configuration.
// Keep Plan mode limited to Git's built-in object/diff readers.
const WRITE_CAPABLE_QUERY_FLAG = /(?:^|\s)(?:--output(?:=|\s)|--ext-diff\b|--textconv\b|--exec\b|-exec(?:dir)?\b|-delete\b|-fprint(?:f)?\b|--pre(?:-glob)?\b)/i;

export function isWithinWorkspace(candidate: string, workspaceRoot: string): boolean {
  const target = resolve(candidate);
  const root = resolve(workspaceRoot);
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function isCurrentSessionPlanFile(path: string, planFilePath?: string): boolean {
  if (!planFilePath) return false;
  return resolve(path).toLocaleLowerCase() === resolve(planFilePath).toLocaleLowerCase();
}

export function shouldBlockWrite(_path: string, _workspaceRoot: string, _planActive: boolean, _planFilePath?: string): boolean {
  // Plan is a planning workflow, not a write sandbox. Desktop no longer
  // rejects edits or non-plan.md files while a session is in Plan mode.
  return false;
}

export function shouldBlockCommand(_command: string, _planActive: boolean): boolean {
  return false;
}

export function isReadOnlyCommand(command: string): boolean {
  const value = command.trim();
  if (!value || UNSAFE_SHELL_SYNTAX.test(value) || WRITE_CAPABLE_QUERY_FLAG.test(value)) return false;
  const pipeline = value.split("|").map((stage) => stage.trim());
  if (pipeline.some((stage) => !stage)) return false;
  const first = pipeline[0]!;
  const firstIsReadOnly = SIMPLE_READ_ONLY_COMMAND.test(first)
    || SAFE_GIT_QUERY.test(first)
    || SAFE_GIT_BRANCH_QUERY.test(first)
    || SAFE_NODE_QUERY.test(first)
    || SAFE_NPM_QUERY.test(first)
    || SAFE_GROK_QUERY.test(first);
  return firstIsReadOnly && pipeline.slice(1).every((stage) => READ_ONLY_PIPELINE_STAGE.test(stage));
}

/**
 * Plan mode may inspect the workspace without interrupting for every read.
 * This is intentionally narrower than "always approve": only explicit ACP
 * read/search/fetch/think kinds, known Grok read aliases and commands already
 * accepted by the read-only shell gate are allowed. Human-readable titles and
 * tool names are presentation metadata and must never turn an unknown tool into
 * a trusted one.
 */
export function isPlanSafeToolCall(toolCall: unknown): boolean {
  if (!toolCall || typeof toolCall !== "object") return false;
  const value = toolCall as Record<string, unknown>;
  const raw = value.rawInput && typeof value.rawInput === "object" ? value.rawInput as Record<string, unknown> : undefined;
  const kind = String(value.kind || (!value.kind ? raw?.kind : "") || "").trim().toLowerCase();
  // ACP tool identifiers commonly use read_file/list_directory/search_files.
  // `_` is a word character in JavaScript regexes, so matching the raw value
  // with `\b` misses those tools and needlessly opens a permission card.
  const normalizedKind = kind.replace(/[_./:-]+/g, " ").replace(/\s+/g, " ").trim();
  const executeLike = /^(?:execute|terminal|shell|run terminal command)$/.test(normalizedKind);
  const command = firstCommand(value, raw);
  // A command hidden in a non-execute tool is contradictory wire metadata.
  // Reject it rather than trusting the icon/title supplied by the server.
  if (command && !executeLike) return false;
  if (executeLike) {
    return command ? isReadOnlyCommand(command) : false;
  }
  return [
    "read", "read file", "read files", "read many files", "read text file",
    "view", "view file", "view files", "stat", "get file info",
    "search", "search files", "search code", "search text", "code search", "web search",
    "list", "list directory", "list files",
    "glob", "grep", "find", "inspect", "think", "fetch", "fetch url",
  ].includes(normalizedKind);
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
