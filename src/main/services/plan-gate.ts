import { isAbsolute, relative, resolve } from "node:path";

const UNSAFE_SHELL_SYNTAX = /[\0\r\n;&|<>`^]|\$\(|\$\{|@\(|%|![A-Za-z_][A-Za-z0-9_]*!/;
const SIMPLE_READ_ONLY_COMMAND = /^(?:pwd|dir|ls|Get-(?:ChildItem|Content|Item|Location)|type|cat|head|tail|findstr|rg|grep)(?:\s+.*)?$/i;
const SAFE_GIT_QUERY = /^git\s+(?:status|diff|log|show)(?:\s+.*)?$/i;
const SAFE_GIT_BRANCH_QUERY = /^git\s+branch(?:\s+--(?:show-current|list|all|remotes)(?:\s+[^-\s][^\s]*)*)?$/i;
const SAFE_NODE_QUERY = /^node\s+(?:--version|-v)$/i;
const SAFE_NPM_QUERY = /^npm\s+(?:--version|-v|view(?:\s+.+)?)$/i;
const SAFE_GROK_QUERY = /^grok\s+(?:--version|version|models|inspect)(?:\s+.*)?$/i;
const WRITE_CAPABLE_QUERY_FLAG = /(?:^|\s)(?:--output(?:=|\s)|--ext-diff\b|--exec\b|-exec(?:dir)?\b|-delete\b|-fprint(?:f)?\b|--pre(?:-glob)?\b)/i;

export function isWithinWorkspace(candidate: string, workspaceRoot: string): boolean {
  const target = resolve(candidate);
  const root = resolve(workspaceRoot);
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
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
