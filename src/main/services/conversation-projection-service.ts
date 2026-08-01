import { createReadStream } from "node:fs";
import { appendFile, copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { join } from "node:path";
import type { ChatEvent, ConversationProjection } from "../../shared/types";

interface ProjectionSnapshot {
  version: 1;
  sessionId: string;
  updatedAt: string;
  events: ChatEvent[];
}

interface PendingChunk {
  type: "message-chunk" | "thought-chunk";
  text: string;
  timer: NodeJS.Timeout;
}

export interface LegacyProjectionRecovery {
  status: "recovered" | "not-found" | "unreliable";
  message: string;
  projection?: ConversationProjection;
}

/**
 * Durable, local-only projection of what the user actually saw in chat.
 *
 * The Grok CLI remains authoritative for transport, but its replay can omit a
 * partial assistant response. This journal therefore records visible blocks
 * independently and is restored only after ACP replay. It is deliberately
 * outside logs/support bundles and uses hashed file names.
 */
export class ConversationProjectionService {
  private readonly root: string;
  private readonly sessionsRoot: string;
  private readonly queues = new Map<string, Promise<void>>();
  private readonly pending = new Map<string, PendingChunk>();
  private readonly appended = new Map<string, number>();

  constructor(userDataPath: string, options: { sessionsRoot?: string } = {}) {
    this.root = join(userDataPath, "conversation-projections");
    this.sessionsRoot = options.sessionsRoot ?? join(homedir(), ".grok", "sessions");
  }

  async record(event: ChatEvent): Promise<void> {
    if (!event.sessionId || !isPersistable(event)) return;
    if (event.type === "message-chunk" || event.type === "thought-chunk") {
      const current = this.pending.get(event.sessionId);
      if (current?.type === event.type) {
        current.text += event.text;
        return;
      }
      await this.flush(event.sessionId);
      const timer = setTimeout(() => void this.flush(event.sessionId), 250);
      timer.unref?.();
      this.pending.set(event.sessionId, { type: event.type, text: event.text, timer });
      return;
    }
    await this.flush(event.sessionId);
    await this.append(event.sessionId, sanitizeEvent(event));
  }

  async restore(sessionId: string): Promise<ConversationProjection | undefined> {
    await this.flush(sessionId);
    const { snapshotPath, recoveryPath, journalPath } = this.paths(sessionId);
    const snapshot = await readProjectionSnapshot(snapshotPath, sessionId)
      ?? await readProjectionSnapshot(recoveryPath, sessionId);
    const journal = await readFile(journalPath, "utf8").catch(() => "");
    const events = [
      ...(snapshot?.sessionId === sessionId ? snapshot.events : []),
      ...journal.split(/\r?\n/).filter(Boolean).flatMap((line) => {
        try {
          const event = JSON.parse(line) as ChatEvent;
          return event.sessionId === sessionId && isPersistable(event) ? [event] : [];
        } catch {
          return [];
        }
      }),
    ];
    if (!events.length) return undefined;
    if (journal.length > 512 * 1024 || events.length > 400) await this.compact(sessionId, events);
    return { version: 1, sessionId, updatedAt: snapshot?.updatedAt ?? new Date().toISOString(), events };
  }

  async delete(sessionId: string): Promise<void> {
    const pending = this.pending.get(sessionId);
    if (pending) clearTimeout(pending.timer);
    this.pending.delete(sessionId);
    await this.enqueue(sessionId, async () => {
      const { snapshotPath, recoveryPath, journalPath } = this.paths(sessionId);
      await Promise.all([rm(snapshotPath, { force: true }), rm(recoveryPath, { force: true }), rm(journalPath, { force: true })]);
    });
  }

  /**
   * One-time, read-only recovery for pre-0.6.16 conversations whose ACP replay
   * has metrics but no visible assistant blocks. Only the strict
   * user_message -> agent_message sequence is accepted; ambiguous orphan
   * chunks are deliberately not assigned to a turn.
   */
  async recoverLegacy(sessionId: string, cwd: string): Promise<LegacyProjectionRecovery> {
    const existing = await this.restore(sessionId);
    if (existing) return { status: "recovered", message: "已存在本地可见消息投影", projection: existing };
    const workspace = await resolvePersistedWorkspace(cwd, this.sessionsRoot);
    const path = join(workspace, sessionId, "updates.jsonl");
    if (!(await stat(path).catch(() => undefined))?.isFile()) {
      return { status: "not-found", message: "未找到可用于恢复的历史更新流" };
    }
    const events: ChatEvent[] = [];
    let pendingUserText = "";
    let turnOrdinal = 0;
    let hasUserBoundary = false;
    let hasVisibleAssistant = false;
    let orphanAssistant = false;
    let lines = 0;
    let bytes = 0;
    const flushUser = (): void => {
      const text = pendingUserText;
      pendingUserText = "";
      if (!text) return;
      turnOrdinal += 1;
      events.push({
        type: "user-message",
        sessionId,
        clientMessageId: `legacy-${turnOrdinal}`,
        text,
        delivery: "sent",
      });
      hasUserBoundary = true;
    };
    const input = createReadStream(path, { encoding: "utf8" });
    const reader = createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const line of reader) {
        lines += 1;
        bytes += Buffer.byteLength(line);
        if (lines > 200_000 || bytes > 256 * 1024 * 1024) {
          input.destroy();
          return { status: "unreliable", message: "历史更新流超过安全恢复上限" };
        }
        let raw: unknown;
        try { raw = JSON.parse(line); } catch { continue; }
        const update = legacyUpdate(raw, sessionId);
        if (!update) continue;
        const kind = stringValue(update.sessionUpdate);
        const text = legacyContentText(update.content);
        if (kind === "user_message_chunk") {
          if (hasUserBoundary && (hasVisibleAssistant || events.some((event) => event.type === "turn-completed"))) {
            hasUserBoundary = false;
            hasVisibleAssistant = false;
          }
          if (text) pendingUserText += text;
          continue;
        }
        flushUser();
        if (kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
          if (!hasUserBoundary) { if (text) orphanAssistant = true; continue; }
          if (!text) continue;
          events.push({ type: kind === "agent_message_chunk" ? "message-chunk" : "thought-chunk", sessionId, text: bound(text, 500_000) ?? "" });
          if (kind === "agent_message_chunk") hasVisibleAssistant = true;
          continue;
        }
        if (kind === "turn_completed" && hasUserBoundary) {
          events.push({ type: "turn-completed", sessionId });
          hasUserBoundary = false;
          hasVisibleAssistant = false;
        }
      }
    } finally {
      reader.close();
      input.destroy();
    }
    flushUser();
    const assistantCount = events.filter((event) => event.type === "message-chunk" && event.text.trim()).length;
    if (!assistantCount) {
      return {
        status: "unreliable",
        message: orphanAssistant ? "历史回答缺少可确认的用户回合边界，无法可靠恢复" : "历史更新流中没有可恢复的 assistant 正文",
      };
    }
    await this.enqueue(sessionId, () => this.compactWithoutQueue(sessionId, events));
    const projection = await this.restore(sessionId);
    return projection
      ? { status: "recovered", message: `已从历史更新流恢复 ${assistantCount} 段回答`, projection }
      : { status: "unreliable", message: "历史更新流解析成功，但本地投影写入失败" };
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.pending.keys()].map((sessionId) => this.flush(sessionId)));
    await Promise.all(this.queues.values());
  }

  private async flush(sessionId: string): Promise<void> {
    const pending = this.pending.get(sessionId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(sessionId);
    await this.append(sessionId, { type: pending.type, sessionId, text: pending.text });
  }

  private async append(sessionId: string, event: ChatEvent): Promise<void> {
    await this.enqueue(sessionId, async () => {
      await mkdir(this.root, { recursive: true });
      const { journalPath } = this.paths(sessionId);
      await appendFile(journalPath, `${JSON.stringify(event)}\n`, "utf8");
      const count = (this.appended.get(sessionId) ?? 0) + 1;
      this.appended.set(sessionId, count);
      if (count >= 200 || ((await stat(journalPath).catch(() => undefined))?.size ?? 0) > 2 * 1024 * 1024) {
        const projection = await this.restoreWithoutQueue(sessionId);
        if (projection.events.length) await this.compactWithoutQueue(sessionId, projection.events);
      }
    });
  }

  private async compact(sessionId: string, events: ChatEvent[]): Promise<void> {
    await this.enqueue(sessionId, () => this.compactWithoutQueue(sessionId, events));
  }

  private async compactWithoutQueue(sessionId: string, events: ChatEvent[]): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const { snapshotPath, recoveryPath, journalPath } = this.paths(sessionId);
    const temp = `${snapshotPath}.${process.pid}.${randomUUID()}.tmp`;
    const snapshot: ProjectionSnapshot = {
      version: 1,
      sessionId,
      updatedAt: new Date().toISOString(),
      events: trimProjection(events),
    };
    await writeFile(temp, JSON.stringify(snapshot), "utf8");
    await rename(temp, snapshotPath);
    // Keep a private, body-containing recovery copy beside the projection.
    // It is never included in logs/support bundles and lets a torn/corrupted
    // primary snapshot recover without touching the original Grok history.
    await copyFile(snapshotPath, recoveryPath);
    await writeFile(journalPath, "", "utf8");
    this.appended.set(sessionId, 0);
  }

  private async restoreWithoutQueue(sessionId: string): Promise<{ events: ChatEvent[] }> {
    const { snapshotPath, recoveryPath, journalPath } = this.paths(sessionId);
    const snapshot = await readProjectionSnapshot(snapshotPath, sessionId)
      ?? await readProjectionSnapshot(recoveryPath, sessionId);
    const journal = await readFile(journalPath, "utf8").catch(() => "");
    return {
      events: [
        ...(snapshot?.sessionId === sessionId ? snapshot.events : []),
        ...journal.split(/\r?\n/).filter(Boolean).flatMap((line) => {
          try {
            const event = JSON.parse(line) as ChatEvent;
            return event && typeof event === "object" && event.sessionId === sessionId && isPersistable(event) ? [event] : [];
          } catch { return []; }
        }),
      ],
    };
  }

  private enqueue(sessionId: string, action: () => Promise<void>): Promise<void> {
    const previous = this.queues.get(sessionId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(action);
    let tracked!: Promise<void>;
    tracked = next.finally(() => {
      if (this.queues.get(sessionId) === tracked) this.queues.delete(sessionId);
    });
    this.queues.set(sessionId, tracked);
    return tracked;
  }

  private paths(sessionId: string): { snapshotPath: string; recoveryPath: string; journalPath: string } {
    const key = createHash("sha256").update(sessionId).digest("hex");
    return {
      snapshotPath: join(this.root, `${key}.snapshot.json`),
      recoveryPath: join(this.root, `${key}.snapshot.recovery.json`),
      journalPath: join(this.root, `${key}.jsonl`),
    };
  }
}

function isPersistable(event: ChatEvent): boolean {
  return !["session-reset", "session-ready", "commands", "mode", "meta", "status", "prompt-queue", "turn-presentations-restore", "user-attachments-restore", "conversation-projection-restore", "history-recovery"].includes(event.type);
}

function sanitizeEvent(event: ChatEvent): ChatEvent {
  if (event.type === "tool-call") {
    const content = event.tool.content?.map((item) => {
      if (!item || typeof item !== "object") return item;
      const value = item as Record<string, unknown>;
      return value.type === "image" && typeof value.data === "string" && value.data.length > 512 * 1024
        ? { ...value, data: "" }
        : item;
    });
    return {
      ...event,
      tool: {
        ...event.tool,
        output: bound(event.tool.output, 200_000),
        error: bound(event.tool.error, 50_000),
        oldText: bound(event.tool.oldText, 200_000),
        newText: bound(event.tool.newText, 200_000),
        content,
      },
    };
  }
  if (event.type === "computer-state") {
    const lastState = event.state.lastState
      ? { ...event.state.lastState, screenshot: undefined, detailScreenshot: undefined }
      : undefined;
    return { ...event, state: { ...event.state, lastState } };
  }
  if (event.type === "error") return { ...event, message: bound(event.message, 100_000) ?? "" };
  return structuredClone(event);
}

function trimProjection(events: ChatEvent[]): ChatEvent[] {
  let bytes = 0;
  const kept: ChatEvent[] = [];
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!;
    const size = Buffer.byteLength(JSON.stringify(event));
    if (kept.length >= 20_000 || bytes + size > 32 * 1024 * 1024) break;
    kept.push(event);
    bytes += size;
  }
  return kept.reverse();
}

function bound(value: string | undefined, limit: number): string | undefined {
  if (!value || value.length <= limit) return value;
  return `${value.slice(0, limit)}\n…（本地投影已截断 ${value.length - limit} 字符）`;
}

async function readProjectionSnapshot(path: string, sessionId: string): Promise<ProjectionSnapshot | undefined> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<ProjectionSnapshot>;
    if (value.version !== 1 || value.sessionId !== sessionId || typeof value.updatedAt !== "string" || !Array.isArray(value.events)) return undefined;
    const events = value.events.filter((event): event is ChatEvent => Boolean(
      event
      && typeof event === "object"
      && event.sessionId === sessionId
      && isPersistable(event),
    ));
    return { version: 1, sessionId, updatedAt: value.updatedAt, events };
  } catch { return undefined; }
}

async function resolvePersistedWorkspace(cwd: string, sessionsRoot: string): Promise<string> {
  const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const wanted = cwd.toLocaleLowerCase();
  const workspace = entries.find((entry) => {
    if (!entry.isDirectory()) return false;
    try { return decodeURIComponent(entry.name).toLocaleLowerCase() === wanted; } catch { return false; }
  });
  return workspace ? join(sessionsRoot, workspace.name) : join(sessionsRoot, encodeURIComponent(cwd));
}

function legacyUpdate(value: unknown, expectedSessionId: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const params = (value as Record<string, unknown>).params;
  if (!params || typeof params !== "object") return undefined;
  const payload = params as Record<string, unknown>;
  if (typeof payload.sessionId === "string" && payload.sessionId !== expectedSessionId) return undefined;
  const update = payload.update;
  return update && typeof update === "object" ? update as Record<string, unknown> : undefined;
}

function legacyContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!content || typeof content !== "object") return "";
  const value = content as Record<string, unknown>;
  return typeof value.text === "string" ? value.text : "";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
