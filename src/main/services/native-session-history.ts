import { open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import type { ChatEvent, ConversationProjection, ToolCallState } from "../../shared/types";
import { historyEvent } from "./native-history-event";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_EVENTS = 2000;
const pathKey = (value: string): string => value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return !!rel && rel !== ".." && !rel.startsWith("..\\") && !rel.startsWith("../") && !isAbsolute(rel);
};

/** Bounded, read-only fallback. Never searches another workspace for the same ID. */
export async function inspectNativeSession(sessionsRoot: string, cwd: string, sessionId: string): Promise<ConversationProjection | undefined> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(sessionId)) throw new Error("无效的会话身份");
  const root = await realpath(sessionsRoot).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
  if (!root) return undefined;
  const candidates = (await readdir(root, { withFileTypes: true })).filter(entry => {
    if (!entry.isDirectory()) return false;
    try { return pathKey(decodeURIComponent(entry.name)) === pathKey(cwd); } catch { return false; }
  });
  if (!candidates.length) return undefined;
  if (candidates.length !== 1) throw new Error("项目历史目录不唯一，无法确认原生记录");
  const workspace = await realpath(join(root, candidates[0]!.name));
  const lexicalSession = join(workspace, sessionId);
  const directory = await realpath(lexicalSession).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
  if (!directory) return undefined;
  const path = await realpath(join(directory, "updates.jsonl")).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
  if (!path) return undefined;
  // Also reject an alias to a different session in the same project.
  if (!inside(root, workspace) || pathKey(directory) !== pathKey(lexicalSession) || !inside(directory, path)) throw new Error("原生历史路径越过所属会话边界");
  const handle = await open(path, "r");
  const events: ChatEvent[] = [];
  const tools = new Map<string, ToolCallState>();
  let truncated = false, skipped = false;
  let updatedAt: string;
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("原生历史不是普通文件");
    updatedAt = info.mtime.toISOString();
    const size = Math.min(info.size, MAX_BYTES);
    const buffer = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const { bytesRead } = await handle.read(buffer, offset, size - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    truncated = info.size > MAX_BYTES;
    let content = buffer.subarray(0, offset).toString("utf8");
    // Never parse a partial record cut by the byte cap.
    if (truncated) content = content.slice(0, content.lastIndexOf("\n") + 1);
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      if (events.length >= MAX_EVENTS) { truncated = true; break; }
      try {
        const raw = JSON.parse(line);
        const envelope = raw?.params ?? raw;
        if (!envelope || typeof envelope !== "object") { skipped = true; continue; }
        const update = envelope.update ?? envelope;
        const ids = [envelope.sessionId, envelope.session_id, update?.sessionId, update?.session_id].filter(id => id !== undefined);
        if (ids.some(id => id !== sessionId)) { skipped = true; continue; }
        const event = historyEvent(update, sessionId, tools);
        const previous = events.at(-1);
        if (event?.type === "user-message" && previous?.type === "user-message") previous.text += event.text;
        else if (event) events.push(event);
      } catch { skipped = true; }
    }
  } finally { await handle.close(); }
  const message = "只读 CLI 原生历史；仅显示可识别的消息与工具记录，不代表完整转录。" + (truncated ? "已达到前 8 MiB / 2000 个事件的显示上限。" : "") + (skipped ? "已跳过损坏、未写完或身份不符的记录。" : "");
  return { version: 2, sessionId, updatedAt, events: [{ type: "history-recovery", sessionId, status: events.length ? "recovered" : "unavailable", message: events.length ? message : "没有可识别的原生消息记录。" + message }, ...events] as unknown as Array<Record<string, unknown>> };
}
