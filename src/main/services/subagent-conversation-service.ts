import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { historyEvent } from "./native-history-event";
import { readdir, realpath, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import type { AgentDashboardNode, ChatEvent, ConversationProjection, SubagentConversationSnapshot, ToolCallState } from "../../shared/types";

type NodeRecord = Pick<AgentDashboardNode, "id" | "parentId" | "sessionId" | "childSessionId" | "title" | "status" | "summary">;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_EVENTS = 2000;

/** Reads native child history without loading/resuming any CLI session. */
export class SubagentConversationService {
  constructor(
    private readonly record: (nodeId: string) => Promise<NodeRecord | undefined>,
    private readonly projection: (id: string) => Promise<ConversationProjection | undefined>,
    private readonly sessionsRoot = join(process.env.GROK_HOME || join(homedir(), ".grok"), "sessions"),
  ) {}

  async read(nodeId: string): Promise<SubagentConversationSnapshot> {
    // The dashboard record may not exist yet (restored history, card opened before the first
    // persisted update), but the node id itself names the parent session and sub-agent.
    const recorded = await this.record(nodeId);
    const node = recorded ?? syntheticNode(nodeId);
    if (!node?.parentId) throw new Error("此子智能体记录已不存在，请刷新列表");
    const child = node.childSessionId;
    if (!recorded && !(child && await this.findSubagentDirectory(node.sessionId, child))) throw new Error("此子智能体记录已不存在，请刷新列表");
    const result: SubagentConversationSnapshot = { nodeId, parentSessionId: node.sessionId, childSessionId: child, title: node.title, status: node.status, summary: node.summary, source: "summary-only" };
    if (!child || child === node.sessionId || !SAFE_ID.test(child)) return { ...result, notice: "CLI 尚未提供可核验的独立子会话 ID，仅显示子智能体摘要。" };
    const projection = await this.projection(child);
    if (projection?.sessionId === child && projection.events.length) return { ...result, source: "desktop-projection", projection };
    const path = await this.findUpdates(child);
    if (!path) return this.readSubagentFiles(result, node.sessionId, child);
    const events: ChatEvent[] = [];
    const tools = new Map<string, ToolCallState>();
    let bytes = 0, truncated = false;
    const stream = createReadStream(path, { encoding: "utf8" });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        bytes += Buffer.byteLength(line);
        if (bytes > MAX_BYTES || events.length >= MAX_EVENTS) { truncated = true; break; }
        try {
          const raw = JSON.parse(line);
          const envelope = raw.params ?? raw;
          const id = envelope.sessionId ?? envelope.session_id;
          if (id && id !== child) continue;
          const event = historyEvent(envelope.update ?? envelope, child, tools);
          const previous = events.at(-1);
          if (event?.type === "user-message" && previous?.type === "user-message") previous.text += event.text;
          else if (event) events.push(event);
        } catch { /* An incomplete trailing line can still be written by the CLI. */ }
      }
    } finally { lines.close(); stream.destroy(); }
    if (!events.length) return { ...result, notice: "子会话记录格式尚不可识别，仅显示摘要；没有打开父会话代替。" };
    return { ...result, source: "cli-updates", notice: truncated ? "记录较长，仅展示前 2000 个事件或 8 MiB；原始历史保留。" : "只读原生子会话记录；刷新可读取新进展。", projection: { version: 2, sessionId: child, updatedAt: new Date().toISOString(), events: events as unknown as Array<Record<string, unknown>> } };
  }

  /**
   * The CLI keeps no per-child transcript: a sub-agent leaves `meta.json` (the delegated prompt and
   * run facts) and `output.json` (its final answer). Those two records are shown as a real exchange.
   */
  private async readSubagentFiles(result: SubagentConversationSnapshot, parent: string, child: string): Promise<SubagentConversationSnapshot> {
    const directory = await this.findSubagentDirectory(parent, child);
    if (!directory) return { ...result, notice: "CLI 没有为这个子 Agent 留下记录文件，仅显示摘要；查看不会启动或恢复执行。" };
    const meta = await readJson(join(directory, "meta.json"));
    const output = await readJson(join(directory, "output.json"));
    const prompt = text(meta?.prompt);
    const answer = text(output?.output) ?? result.summary;
    if (!prompt && !answer) return { ...result, notice: "子 Agent 记录文件为空，仅显示摘要。" };
    const events: ChatEvent[] = [];
    if (prompt) events.push({ type: "user-message", sessionId: child, text: prompt });
    if (answer) events.push({ type: "message-chunk", sessionId: child, text: answer }, { type: "turn-completed", sessionId: child });
    const metaStatus = text(meta?.status);
    return {
      ...result,
      title: text(meta?.description) ?? result.title,
      status: statusFromMeta(metaStatus) ?? result.status,
      source: "cli-subagent-files",
      notice: answer ? undefined : "子 Agent 仍在运行，结果返回后会出现在这里。",
      details: {
        type: text(meta?.subagent_type), model: text(meta?.effective_model_id), cwd: text(meta?.child_cwd), startedAt: text(meta?.started_at), completedAt: text(meta?.completed_at),
        durationMs: number(meta?.duration_ms), toolCalls: number(meta?.tool_calls), turns: number(meta?.turns), contextSource: text(meta?.effective_context_source),
      },
      projection: { version: 2, sessionId: child, updatedAt: new Date().toISOString(), events: events as unknown as Array<Record<string, unknown>> },
    };
  }

  private async findSubagentDirectory(parent: string, child: string): Promise<string | undefined> {
    if (!SAFE_ID.test(parent)) return undefined;
    const root = await realpath(this.sessionsRoot).catch(() => undefined);
    if (!root) return undefined;
    const matches: string[] = [];
    for (const directory of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!directory.isDirectory()) continue;
      const candidate = await realpath(join(root, directory.name, parent, "subagents", child)).catch(() => undefined);
      if (!candidate) continue;
      const rel = relative(root, candidate);
      if (!rel || rel.startsWith("..") || isAbsolute(rel)) continue;
      if ((await stat(candidate)).isDirectory()) matches.push(candidate);
    }
    return matches.length === 1 ? matches[0] : undefined;
  }

  private async findUpdates(child: string): Promise<string | undefined> {
    const root = await realpath(this.sessionsRoot).catch(() => undefined);
    if (!root) return undefined;
    const matches: string[] = [];
    for (const directory of await readdir(root, { withFileTypes: true })) {
      if (!directory.isDirectory()) continue;
      const candidate = await realpath(join(root, directory.name, child, "updates.jsonl")).catch(() => undefined);
      if (!candidate) continue;
      const rel = relative(root, candidate);
      if (!rel || rel.startsWith("..") || isAbsolute(rel)) continue;
      if ((await stat(candidate)).isFile()) matches.push(candidate);
    }
    // Stale migration copies must not be mistaken for the authoritative child.
    return matches.length === 1 ? matches[0] : undefined;
  }
}


/** `session:<parent>:subagent:<child>` — see AgentDashboardService. */
function syntheticNode(nodeId: string): NodeRecord | undefined {
  const match = /^session:(.+):subagent:(.+)$/.exec(nodeId);
  if (!match) return undefined;
  const [, parent, child] = match as unknown as [string, string, string];
  return { id: nodeId, parentId: `session:${parent}`, sessionId: parent, childSessionId: child, title: "子 Agent", status: "unknown" };
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    if ((await stat(path)).size > MAX_BYTES) return undefined;
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value : undefined;
const number = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;

function statusFromMeta(status: string | undefined): AgentDashboardNode["status"] | undefined {
  if (!status) return undefined;
  const value = status.toLowerCase();
  if (["completed", "success", "succeeded"].includes(value)) return "completed";
  if (["failed", "error"].includes(value)) return "failed";
  if (["cancelled", "canceled", "stopped", "aborted"].includes(value)) return "stopped";
  if (["running", "in_progress"].includes(value)) return "running";
  return undefined;
}
