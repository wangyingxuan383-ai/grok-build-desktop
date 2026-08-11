import { createHash } from "node:crypto";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ToolCallState } from "../../shared/types";
import { isPathInside, resolveExistingWorkspacePath, resolveNewWorkspacePath, resolveWorkspaceRoot } from "./workspace-path-policy";

const MAX_CAPTURE_BYTES = 256 * 1024;
const MAX_CAPTURE_MS = 5_000;
const WRITE_KINDS = new Set(["edit", "write", "create", "patch", "delete", "edit_file", "write_file", "create_file", "patch_file", "delete_file", "apply_patch"]);

interface FileSnapshot {
  absolutePath: string;
  relativePath: string;
  exists: boolean;
  binary: boolean;
  truncated: boolean;
  hash?: string;
  text?: string;
}

interface PendingChange {
  sessionId: string;
  turnId?: string;
  toolCallId: string;
  cwd: string;
  path: string;
  before: FileSnapshot;
}

/**
 * Captures the filesystem baseline before a write tool starts and the actual
 * file after it settles. ACP-provided diff blocks remain useful evidence, but
 * non-Git review no longer depends on the CLI choosing to emit one.
 */
export class TurnFileChangeJournal {
  private readonly pending = new Map<string, PendingChange>();

  async observe(sessionId: string, cwd: string, turnId: string | undefined, tool: ToolCallState): Promise<ToolCallState> {
    if (!isWriteTool(tool)) return tool;
    const key = `${sessionId}\0${tool.toolCallId}`;
    const captured = this.pending.get(key);
    const path = toolPath(tool) ?? ((tool.status === "completed" || tool.status === "failed") ? captured?.path : undefined);
    if (!path || !cwd) {
      if (tool.status === "completed" || tool.status === "failed") this.pending.delete(key);
      return tool;
    }
    if ((tool.status === "pending" || tool.status === "in_progress") && !this.pending.has(key)) {
      const before = await captureTrustedPath(cwd, path);
      this.pending.set(key, { sessionId, turnId, toolCallId: tool.toolCallId, cwd, path, before });
      return tool;
    }
    if (tool.status !== "completed" && tool.status !== "failed") return tool;

    this.pending.delete(key);
    const before = captured?.before;
    const after = await captureTrustedPath(captured?.cwd ?? cwd, path);
    if (before && normalizeCase(before.absolutePath) !== normalizeCase(after.absolutePath)) {
      throw new Error(`同一文件工具调用的目标路径发生变化：${before.relativePath || captured?.path || "未知"} → ${after.relativePath || path}`);
    }
    const enriched: ToolCallState = { ...tool };
    if (before?.exists && !before.binary && enriched.oldText === undefined) enriched.oldText = before.text ?? "";
    if (after.exists && !after.binary && enriched.newText === undefined) enriched.newText = after.text ?? "";
    if (!after.exists && before?.exists && enriched.newText === undefined) enriched.newText = "";
    // Only a baseline captured before the tool started can prove a creation.
    // A completed-only ACP update for an already-existing file has no before
    // image and must not be presented as an all-additions/new-file diff.
    if (captured && !before?.exists && after.exists && enriched.oldText === undefined) enriched.oldText = "";
    if (!enriched.locations?.some((value) => value.path)) {
      enriched.locations = [{ path: after.relativePath || before?.relativePath || path }];
    }
    if (enriched.oldText !== undefined && enriched.newText !== undefined && (enriched.additions === undefined || enriched.deletions === undefined)) {
      Object.assign(enriched, lineStats(enriched.oldText, enriched.newText));
    }
    if ((before?.binary || after.binary) && !enriched.output) {
      enriched.output = `已记录二进制文件改动（${snapshotLabel(before)} → ${snapshotLabel(after)}）`;
    } else if ((before?.truncated || after.truncated) && !enriched.output) {
      enriched.output = "文件改动已记录；文本快照超过 256 KiB，Review 中仅显示受限预览。";
    } else if (!captured && enriched.oldText === undefined && !enriched.output) {
      enriched.output = "文件写入已记录，但 ACP 未提供写入开始事件，历史无可靠基线。";
    }
    return enriched;
  }

  clearSession(sessionId: string): void {
    for (const [key, value] of this.pending) if (value.sessionId === sessionId) this.pending.delete(key);
  }
}

function isWriteTool(tool: ToolCallState): boolean {
  if (tool.kind && WRITE_KINDS.has(tool.kind.toLowerCase())) return true;
  return tool.oldText !== undefined || tool.newText !== undefined || (tool.content ?? []).some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const value = entry as Record<string, unknown>;
    return value.type === "diff" || (value.type === "content" && typeof value.content === "object" && value.content !== null && (value.content as Record<string, unknown>).type === "diff");
  });
}

function toolPath(tool: ToolCallState): string | undefined {
  const location = tool.locations?.find((value) => typeof value.path === "string" && value.path.trim())?.path?.trim();
  if (location) return location;
  if (!tool.rawInput || typeof tool.rawInput !== "object" || Array.isArray(tool.rawInput)) return undefined;
  const input = tool.rawInput as Record<string, unknown>;
  for (const key of ["path", "file", "file_path", "filename", "target"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

async function captureTrustedPath(cwd: string, requestedPath: string): Promise<FileSnapshot> {
  const root = await resolveWorkspaceRoot(cwd);
  const candidate = isAbsolute(requestedPath) ? resolve(requestedPath) : resolve(root, requestedPath);
  const exists = await stat(candidate).then(() => true).catch(() => false);
  const resolved = exists
    ? await resolveExistingWorkspacePath(root, candidate, false)
    : await resolveNewWorkspacePath(root, candidate);
  // Canonical containment blocks symlink/junction escape. Existing leaf links
  // are rejected because a write could retarget them after this baseline.
  if (exists && (await lstat(candidate)).isSymbolicLink()) throw new Error("不记录符号链接目标的文件改动");
  const canonicalRoot = await realpath(root);
  if (!isPathInside(normalizeCase(canonicalRoot), normalizeCase(resolved.path), false)) throw new Error("文件改动路径超出会话工作区");
  const relativePath = relative(canonicalRoot, resolved.path).split(sep).join("/");
  if (!exists) return { absolutePath: resolved.path, relativePath, exists: false, binary: false, truncated: false };
  const handle = await open(resolved.path, "r");
  const captured: Buffer[] = [];
  let info: Awaited<ReturnType<typeof handle.stat>>;
  let stream: ReturnType<typeof handle.createReadStream> | undefined;
  try {
    // Revalidate after opening. Once this handle is open, a later path swap
    // cannot redirect the bytes read through it to another reparse target.
    const reopenedCanonical = await realpath(resolved.path);
    if (normalizeCase(reopenedCanonical) !== normalizeCase(resolved.path)
      || !isPathInside(normalizeCase(canonicalRoot), normalizeCase(reopenedCanonical), false)) {
      throw new Error("文件改动路径在打开期间发生变化");
    }
    info = await handle.stat();
    if (!info.isFile()) throw new Error("文件改动目标不是普通文件");
    const signal = AbortSignal.timeout(MAX_CAPTURE_MS);
    stream = handle.createReadStream({ start: 0, end: MAX_CAPTURE_BYTES - 1, autoClose: false, signal });
    for await (const raw of stream) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      captured.push(chunk);
    }
  } finally {
    stream?.destroy();
    await handle.close().catch(() => undefined);
  }
  const buffer = Buffer.concat(captured);
  const binary = buffer.subarray(0, 8192).includes(0);
  const truncated = info.size > MAX_CAPTURE_BYTES;
  return {
    absolutePath: resolved.path,
    relativePath,
    exists: true,
    binary,
    truncated,
    // A digest of a prefix must never masquerade as the full-file hash.
    ...(!truncated ? { hash: createHash("sha256").update(buffer).digest("hex") } : {}),
    ...(!binary ? { text: new TextDecoder("utf-8", { fatal: false }).decode(buffer) } : {}),
  };
}

function snapshotLabel(snapshot: FileSnapshot | undefined): string {
  if (!snapshot?.exists) return "不存在";
  return snapshot.hash?.slice(0, 12) ?? (snapshot.truncated ? "大文件" : "已存在");
}

function normalizeCase(path: string): string { return process.platform === "win32" ? path.toLowerCase() : path; }

function lineStats(before: string, after: string): { additions: number; deletions: number } {
  if (before === after) return { additions: 0, deletions: 0 };
  const oldLines = before ? before.replace(/\r\n/g, "\n").split("\n") : [];
  const newLines = after ? after.replace(/\r\n/g, "\n").split("\n") : [];
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > prefix && newEnd > prefix && oldLines[oldEnd - 1] === newLines[newEnd - 1]) { oldEnd -= 1; newEnd -= 1; }
  return { additions: newEnd - prefix, deletions: oldEnd - prefix };
}
