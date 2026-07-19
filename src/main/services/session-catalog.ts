import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { LiveStatus, SessionSummary } from "../../shared/types";
import { JsonStore } from "./json-store";

interface SessionMetadata {
  renames: Record<string, string>;
  unread: Record<string, "ok" | "error">;
  pinned: Record<string, boolean>;
}

interface GrokSummary {
  created_at?: string;
  updated_at?: string;
  last_active_at?: string;
  num_chat_messages?: number;
  num_messages?: number;
  current_model_id?: string;
  reasoning_effort?: string;
  generated_title?: string;
  session_summary?: string;
}

export class SessionCatalog {
  private readonly meta: JsonStore<SessionMetadata>;

  constructor(
    userDataPath: string,
    private readonly grokHome = join(homedir(), ".grok"),
  ) {
    this.meta = new JsonStore(join(userDataPath, "session-metadata.json"), { renames: {}, unread: {}, pinned: {} });
  }

  sessionRoot(cwd: string): string {
    return join(this.grokHome, "sessions", encodeURIComponent(cwd));
  }

  async resolveSessionRoot(cwd: string): Promise<string> {
    const sessionsRoot = join(this.grokHome, "sessions");
    const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
    const wanted = cwd.toLocaleLowerCase();
    const match = entries.find((entry) => {
      if (!entry.isDirectory()) return false;
      try { return decodeURIComponent(entry.name).toLocaleLowerCase() === wanted; } catch { return false; }
    });
    return match ? join(sessionsRoot, match.name) : this.sessionRoot(cwd);
  }

  async list(cwd: string, query = "", live = new Map<string, LiveStatus>()): Promise<SessionSummary[]> {
    if (!cwd) return [];
    const root = await this.resolveSessionRoot(cwd);
    const dirs = await readdir(root, { withFileTypes: true }).catch(() => []);
    const metadata = await this.meta.get();
    const rows = await Promise.all(dirs.filter((entry) => entry.isDirectory()).map(async (entry): Promise<SessionSummary | null> => {
      try {
        const summary = JSON.parse(await readFile(join(root, entry.name, "summary.json"), "utf8")) as GrokSummary;
        const title = metadata.renames[entry.name] || summary.generated_title || summary.session_summary || "新会话";
        const unread = metadata.unread[entry.name];
        const status = live.get(entry.name) ?? (unread === "error" ? "error" : unread === "ok" ? "unread" : "cold");
        return {
          id: entry.name,
          cwd,
          title,
          createdAt: summary.created_at || "",
          updatedAt: summary.last_active_at || summary.updated_at || summary.created_at || "",
          messageCount: summary.num_chat_messages ?? summary.num_messages ?? 0,
          modelId: summary.current_model_id,
          effort: summary.reasoning_effort,
          status,
          pinned: Boolean(metadata.pinned?.[entry.name]),
        };
      } catch {
        return null;
      }
    }));
    const normalized = query.trim().toLowerCase();
    return rows
      .filter((row): row is SessionSummary => Boolean(row))
      .filter((row) => !normalized || row.title.toLowerCase().includes(normalized) || row.id.includes(normalized))
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt.localeCompare(a.updatedAt));
  }

  async rename(sessionId: string, title: string): Promise<void> {
    const metadata = await this.meta.get();
    metadata.renames[sessionId] = title.trim() || "新会话";
    await this.meta.set(metadata);
  }

  async markUnread(sessionId: string, error = false): Promise<void> {
    const metadata = await this.meta.get();
    metadata.unread[sessionId] = error ? "error" : "ok";
    await this.meta.set(metadata);
  }

  async markRead(sessionId: string): Promise<void> {
    const metadata = await this.meta.get();
    delete metadata.unread[sessionId];
    await this.meta.set(metadata);
  }

  async pin(sessionId: string, pinned: boolean): Promise<void> {
    const metadata = await this.meta.get();
    if (pinned) metadata.pinned[sessionId] = true;
    else delete metadata.pinned[sessionId];
    await this.meta.set(metadata);
  }

  async delete(cwd: string, sessionId: string): Promise<void> {
    const root = await this.resolveSessionRoot(cwd);
    const target = resolve(root, sessionId);
    const rel = relative(resolve(root), target);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("非法会话路径");
    await rm(target, { recursive: true, force: true });
    const metadata = await this.meta.get();
    delete metadata.renames[sessionId];
    delete metadata.unread[sessionId];
    delete metadata.pinned[sessionId];
    await this.meta.set(metadata);
  }

  async clear(cwd: string, keepSessionId?: string): Promise<void> {
    const root = await this.resolveSessionRoot(cwd);
    await mkdir(root, { recursive: true });
    const dirs = await readdir(root, { withFileTypes: true });
    for (const entry of dirs) {
      if (entry.isDirectory() && entry.name !== keepSessionId) await this.delete(cwd, entry.name);
    }
  }

  async exportMarkdown(cwd: string, sessionId: string): Promise<string> {
    const root = await this.resolveSessionRoot(cwd);
    const target = resolve(root, sessionId);
    const rel = relative(resolve(root), target);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("非法会话路径");
    const summary = (await this.list(cwd)).find((row) => row.id === sessionId);
    const content = await readFile(join(target, "chat_history.jsonl"), "utf8");
    const output = [`# ${summary?.title || "Grok 会话"}`, "", `- 会话 ID: \`${sessionId}\``, `- 工作区: \`${cwd}\``, ""];
    for (const line of content.split(/\r?\n/)) {
      try {
        const row = JSON.parse(line) as { type?: string; content?: unknown; synthetic_reason?: string };
        if ((row.type !== "user" && row.type !== "assistant") || row.synthetic_reason) continue;
        const text = historyText(row.content).trim();
        if (!text || /<user_info>|<system-reminder>/.test(text)) continue;
        output.push(row.type === "user" ? "## 用户" : "## Grok", "", text, "");
      } catch { /* ignore incomplete trailing rows */ }
    }
    return `${output.join("\n").trim()}\n`;
  }
}

function historyText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item) => {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return "";
    const row = item as Record<string, unknown>;
    return String(row.text || row.content || "");
  }).filter(Boolean).join("\n\n");
}
