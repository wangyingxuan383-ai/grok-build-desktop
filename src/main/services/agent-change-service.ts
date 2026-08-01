import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { AgentChangeIndex, AgentFileChange, ToolCallState } from "../../shared/types";

const MAX_TEXT_BYTES = 256 * 1024;
const MAX_FILES_PER_SESSION = 400;

/** Tool kinds that represent the agent actually writing to a file. */
const WRITE_KINDS = new Set(["edit", "write", "create", "patch", "delete", "edit_file", "write_file", "create_file", "patch_file", "delete_file", "apply_patch"]);

interface SessionChanges {
  cwd: string;
  latestTurnId?: string;
  /** Keyed by tool call id so a streamed update replaces rather than duplicates. */
  byToolCall: Map<string, AgentFileChange>;
  order: string[];
}

/**
 * Records what the agent actually wrote, from the before/after text the ACP
 * tool call already carries. This is a real baseline, not a reconstruction:
 * it is what the agent did, which is also more accurate than `git status` for
 * a file the agent edited and then reverted, or one already committed.
 *
 * Deliberately not a git substitute — nothing here stages, commits or branches.
 */
export class AgentChangeService {
  private readonly sessions = new Map<string, SessionChanges>();

  beginTurn(sessionId: string, cwd: string, turnId: string): void {
    const entry = this.sessions.get(sessionId) ?? { cwd, byToolCall: new Map<string, AgentFileChange>(), order: [] };
    entry.cwd = cwd || entry.cwd;
    entry.latestTurnId = turnId;
    this.sessions.set(sessionId, entry);
  }

  /** Returns true when the tool call was a real write worth recording. */
  record(sessionId: string, cwd: string, turnId: string | undefined, tool: ToolCallState): boolean {
    const currentSession = this.sessions.get(sessionId);
    const previous = currentSession?.byToolCall.get(String(tool.toolCallId));
    if (!isWriteTool(tool) && !previous) return false;
    const diff = nestedToolDiff(tool);
    const path = firstPath(tool) ?? diff.path ?? previous?.absolutePath;
    if (!path) return false;
    const entry: SessionChanges = currentSession ?? { cwd, byToolCall: new Map<string, AgentFileChange>(), order: [] };
    entry.cwd = cwd || entry.cwd;
    if (turnId) entry.latestTurnId = turnId;

    const absolutePath = isAbsolute(path) ? resolve(path) : resolve(entry.cwd || ".", path);
    const incomingBefore = tool.oldText ?? diff.oldText;
    const incomingAfter = tool.newText ?? diff.newText;
    const change: AgentFileChange = {
      id: `${tool.toolCallId}`,
      path: previous?.path ?? workspaceRelative(absolutePath, entry.cwd),
      absolutePath,
      toolCallId: tool.toolCallId,
      at: previous?.at ?? new Date().toISOString(),
      status: tool.status === "failed" ? "failed" : "applied",
      ...((turnId ?? previous?.turnId) ? { turnId: turnId ?? previous?.turnId } : {}),
      ...(incomingBefore === undefined && previous?.before !== undefined
        ? { before: previous.before, ...(previous.beforeTruncated ? { beforeTruncated: true } : {}) }
        : boundedText("before", incomingBefore)),
      ...(incomingAfter === undefined && previous?.after !== undefined
        ? { after: previous.after, ...(previous.afterTruncated ? { afterTruncated: true } : {}) }
        : boundedText("after", incomingAfter)),
    };
    const stats = tool.additions !== undefined && tool.deletions !== undefined
      ? { additions: tool.additions, deletions: tool.deletions }
      : incomingBefore === undefined && incomingAfter === undefined && previous?.additions !== undefined && previous?.deletions !== undefined
        ? { additions: previous.additions, deletions: previous.deletions }
        : change.before !== undefined && change.after !== undefined ? lineStats(change.before, change.after) : undefined;
    if (stats) Object.assign(change, stats);
    // A write with neither side captured tells the user nothing beyond "it was
    // touched", and saying so is better than rendering an empty diff.
    change.baseline = change.before === undefined ? (change.after === undefined ? previous?.baseline ?? "none" : "missing-before") : "captured";

    if (!entry.byToolCall.has(change.id)) entry.order.push(change.id);
    entry.byToolCall.set(change.id, change);
    while (entry.order.length > MAX_FILES_PER_SESSION) {
      const dropped = entry.order.shift();
      if (dropped) entry.byToolCall.delete(dropped);
    }
    this.sessions.set(sessionId, entry);
    return true;
  }

  index(sessionId: string, scope: "last-turn" | "session"): AgentChangeIndex {
    const entry = this.sessions.get(sessionId);
    const all = entry ? entry.order.map((id) => entry.byToolCall.get(id)!).filter(Boolean) : [];
    const latestTurn = entry?.latestTurnId ?? all.filter((change) => change.turnId).at(-1)?.turnId;
    const files = scope === "session" || !latestTurn ? all : all.filter((change) => change.turnId === latestTurn);
    return {
      cwd: entry?.cwd ?? "",
      scope,
      files: dedupeByPathKeepingLatest(files),
      createdAt: new Date().toISOString(),
    };
  }

  clear(sessionId: string): void { this.sessions.delete(sessionId); }
}

function isWriteTool(tool: ToolCallState): boolean {
  if (tool.kind && WRITE_KINDS.has(tool.kind.toLowerCase())) return true;
  // Some CLIs report a generic kind but still carry a diff; that is still a write.
  const diff = nestedToolDiff(tool);
  return Boolean(tool.oldText !== undefined || tool.newText !== undefined || diff.oldText !== undefined || diff.newText !== undefined);
}

function firstPath(tool: ToolCallState): string | undefined {
  const location = (tool.locations ?? []).find((value) => typeof value.path === "string" && value.path.trim());
  return location?.path?.trim();
}

function nestedToolDiff(tool: ToolCallState): { path?: string; oldText?: string; newText?: string } {
  for (const raw of tool.content ?? []) {
    if (!raw || typeof raw !== "object") continue;
    const outer = raw as Record<string, unknown>;
    const value = outer.type === "content" && outer.content && typeof outer.content === "object"
      ? outer.content as Record<string, unknown>
      : outer;
    if (value.type !== "diff" && typeof value.oldText !== "string" && typeof value.newText !== "string") continue;
    return {
      ...(typeof value.path === "string" ? { path: value.path } : {}),
      ...(typeof value.oldText === "string" ? { oldText: value.oldText } : {}),
      ...(typeof value.newText === "string" ? { newText: value.newText } : {}),
    };
  }
  return {};
}

function lineStats(before: string, after: string): { additions: number; deletions: number } {
  if (before === after) return { additions: 0, deletions: 0 };
  const oldLines = before ? before.replace(/\r\n/g, "\n").split("\n") : [];
  const newLines = after ? after.replace(/\r\n/g, "\n").split("\n") : [];
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > prefix && newEnd > prefix && oldLines[oldEnd - 1] === newLines[newEnd - 1]) { oldEnd -= 1; newEnd -= 1; }
  const oldMiddle = oldLines.slice(prefix, oldEnd);
  const newMiddle = newLines.slice(prefix, newEnd);
  if (!oldMiddle.length || !newMiddle.length || oldMiddle.length * newMiddle.length > 2_000_000) {
    return { additions: newMiddle.length, deletions: oldMiddle.length };
  }
  let previous = new Uint32Array(newMiddle.length + 1);
  for (const oldLine of oldMiddle) {
    const current = new Uint32Array(newMiddle.length + 1);
    for (let index = 1; index <= newMiddle.length; index += 1) current[index] = oldLine === newMiddle[index - 1] ? previous[index - 1]! + 1 : Math.max(previous[index]!, current[index - 1]!);
    previous = current;
  }
  const unchanged = previous[newMiddle.length] ?? 0;
  return { additions: newMiddle.length - unchanged, deletions: oldMiddle.length - unchanged };
}

function workspaceRelative(absolutePath: string, cwd: string): string {
  if (!cwd) return absolutePath;
  const rel = relative(resolve(cwd), absolutePath);
  return !rel || rel.startsWith("..") || isAbsolute(rel) ? absolutePath : rel.split(sep).join("/");
}

function boundedText(field: "before" | "after", value: string | undefined): Partial<AgentFileChange> {
  if (value === undefined) return {};
  if (Buffer.byteLength(value, "utf8") <= MAX_TEXT_BYTES) return field === "before" ? { before: value } : { after: value };
  const bytes = Buffer.from(value, "utf8");
  let end = MAX_TEXT_BYTES;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let clipped = "";
  while (end > 0) {
    try { clipped = decoder.decode(bytes.subarray(0, end)); break; }
    catch { end -= 1; }
  }
  return field === "before" ? { before: clipped, beforeTruncated: true } : { after: clipped, afterTruncated: true };
}

/** The same file edited repeatedly in one scope should read as one change. */
function dedupeByPathKeepingLatest(files: AgentFileChange[]): AgentFileChange[] {
  const byPath = new Map<string, AgentFileChange>();
  for (const change of files) {
    const previous = byPath.get(change.path);
    // Keep the earliest captured baseline and the latest result, so a file
    // edited three times shows the whole journey rather than the last step.
    if (!previous) {
      byPath.set(change.path, change);
      continue;
    }
    const baseline = previous.before !== undefined
      ? { before: previous.before, beforeTruncated: previous.beforeTruncated }
      : { before: change.before, beforeTruncated: change.beforeTruncated };
    const merged: AgentFileChange = {
      ...change,
      ...baseline,
      baseline: previous.baseline === "captured" ? "captured" : change.baseline,
    };
    if (merged.before !== undefined && merged.after !== undefined) Object.assign(merged, lineStats(merged.before, merged.after));
    byPath.set(change.path, merged);
  }
  return [...byPath.values()];
}

export function agentChangeDigest(change: AgentFileChange): string {
  return createHash("sha256").update(`${change.path}\0${change.before ?? ""}\0${change.after ?? ""}`).digest("hex").slice(0, 16);
}
