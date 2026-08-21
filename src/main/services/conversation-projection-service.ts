import { createReadStream } from "node:fs";
import { copyFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { join } from "node:path";
import type { ChatEvent, ConversationProjection, PersistedPromptQueue, SessionRuntimePreferences } from "../../shared/types";
import { withCrossProcessFileLock } from "./json-store";

const MAX_PROJECTION_EVENTS = 20_000;
const MAX_PROJECTION_BYTES = 32 * 1024 * 1024;
const MAX_SNAPSHOT_FILE_BYTES = 40 * 1024 * 1024;

interface ProjectionRecord {
  id: string;
  event: ChatEvent;
}

interface ProjectionSnapshot {
  version: 1 | 2;
  sessionId: string;
  updatedAt: string;
  events: ChatEvent[];
  eventIds?: string[];
  truncatedEventCount?: number;
  runtime?: SessionRuntimePreferences;
  queue?: PersistedPromptQueue;
}

interface LoadedProjectionRecords {
  snapshot?: ProjectionSnapshot;
  records: ProjectionRecord[];
  journalBytes: number;
  truncatedEventCount: number;
  needsMigration: boolean;
}

interface PendingChunk {
  type: "message-chunk" | "thought-chunk";
  text: string;
  timer: NodeJS.Timeout;
  truncated?: boolean;
}

interface ProjectionState {
  runtime?: SessionRuntimePreferences;
  queue?: PersistedPromptQueue;
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
  private readonly states = new Map<string, ProjectionState>();

  constructor(userDataPath: string, private readonly options: {
    sessionsRoot?: string;
    runtime?: (sessionId: string) => Promise<SessionRuntimePreferences | undefined>;
    queue?: (sessionId: string) => Promise<PersistedPromptQueue | undefined>;
    maxStreamBlockBytes?: number;
    maxEventBytes?: number;
    maxProjectionEvents?: number;
    maxProjectionBytes?: number;
    maxSnapshotFileBytes?: number;
    isSessionActive?: (sessionId: string) => boolean | Promise<boolean>;
    interruptQueue?: (sessionId: string) => void | Promise<void>;
    now?: () => Date;
  } = {}) {
    this.root = join(userDataPath, "conversation-projections");
    this.sessionsRoot = options.sessionsRoot ?? join(homedir(), ".grok", "sessions");
  }

  async record(event: ChatEvent): Promise<void> {
    if (!event.sessionId) return;
    if (event.type === "prompt-queue" || event.type === "session-ready" || event.type === "mode") {
      await this.recordState(event);
      return;
    }
    if (!isPersistable(event)) return;
    if (event.type === "message-chunk" || event.type === "thought-chunk") {
      const current = this.pending.get(event.sessionId);
      if (current?.type === event.type) {
        if (!current.truncated) {
          const bounded = boundUtf8(`${current.text}${event.text}`, this.options.maxStreamBlockBytes ?? 1024 * 1024);
          current.text = bounded.text;
          current.truncated = bounded.truncated;
        }
        return;
      }
      await this.flush(event.sessionId);
      const timer = setTimeout(() => void this.flush(event.sessionId), 250);
      timer.unref?.();
      const bounded = boundUtf8(event.text, this.options.maxStreamBlockBytes ?? 1024 * 1024);
      this.pending.set(event.sessionId, { type: event.type, text: bounded.text, timer, truncated: bounded.truncated });
      return;
    }
    await this.flush(event.sessionId);
    await this.append(event.sessionId, enforceEventLimit(sanitizeEvent(event), this.options.maxEventBytes ?? 2 * 1024 * 1024));
  }

  async restore(sessionId: string): Promise<ConversationProjection | undefined> {
    await this.flush(sessionId);
    return this.enqueue(sessionId, () => this.withSessionLock(sessionId, async () => {
      let loaded = await this.restoreRecordsWithoutLock(sessionId);
      if (!(await this.options.isSessionActive?.(sessionId))) {
        const reconciled = reconcileHostExitLease(sessionId, loaded.records, this.options.now?.() ?? new Date());
        await this.options.interruptQueue?.(sessionId);
        if (reconciled.changed) {
          const compacted = await this.compactWithoutLock(sessionId, reconciled.records, loaded.truncatedEventCount);
          loaded = { ...loaded, records: compacted.records, truncatedEventCount: compacted.truncatedEventCount, journalBytes: 0, needsMigration: false };
        }
      }
      const loadedState = await this.loadState(sessionId, loaded.snapshot);
      if (!loaded.records.length && !loaded.truncatedEventCount && !loadedState.runtime && !loadedState.queue) return undefined;
      let updatedAt = loaded.journalBytes ? new Date().toISOString() : loaded.snapshot?.updatedAt ?? new Date().toISOString();
      if (loaded.journalBytes > 512 * 1024 || loaded.needsMigration) {
        const compacted = await this.compactWithoutLock(sessionId, loaded.records, loaded.truncatedEventCount);
        loaded = { ...loaded, records: compacted.records, truncatedEventCount: compacted.truncatedEventCount, journalBytes: 0, needsMigration: false };
        updatedAt = compacted.updatedAt;
      }
      return {
        version: 2,
        sessionId,
        updatedAt,
        events: visibleProjectionEvents(sessionId, loaded.records, loaded.truncatedEventCount),
        ...loadedState,
      };
    }));
  }

  /**
   * Reconcile an ACP history replay with the local visible projection.
   *
   * The local projection wins for blocks the user already saw. Replay may add
   * a missing trailing turn or the missing suffix of a partially persisted
   * assistant/thought stream. It must never append a second copy of an answer
   * merely because the CLI chunks it differently on reload.
   */
  async mergeReplay(sessionId: string, replayEvents: ChatEvent[]): Promise<ConversationProjection | undefined> {
    await this.flush(sessionId);
    const replay = replayEvents
      .filter((event) => event.sessionId === sessionId && isPersistable(event))
      .map((event) => enforceEventLimit(sanitizeEvent(event), this.options.maxEventBytes ?? 2 * 1024 * 1024));
    if (!replay.length) return this.restore(sessionId);
    return this.enqueue(sessionId, () => this.withSessionLock(sessionId, async () => {
      const loaded = await this.restoreRecordsWithoutLock(sessionId);
      const mergedEvents = mergeVisibleReplay(loaded.records.map((record) => record.event), replay);
      const mergedRecords = dedupeProjectionRecords(mergedEvents.map((event) => projectionRecord(event)));
      const compacted = await this.compactWithoutLock(sessionId, mergedRecords, loaded.truncatedEventCount);
      const state = await this.loadState(sessionId);
      return {
        version: 2,
        sessionId,
        updatedAt: compacted.updatedAt,
        events: visibleProjectionEvents(sessionId, compacted.records, compacted.truncatedEventCount),
        ...state,
      };
    }));
  }

  async delete(sessionId: string): Promise<void> {
    const pending = this.pending.get(sessionId);
    if (pending) clearTimeout(pending.timer);
    this.pending.delete(sessionId);
    this.states.delete(sessionId);
    await this.enqueue(sessionId, () => this.withSessionLock(sessionId, async () => {
      const { snapshotPath, recoveryPath, journalPath } = this.paths(sessionId);
      await Promise.all([rm(snapshotPath, { force: true }), rm(recoveryPath, { force: true }), rm(journalPath, { force: true })]);
    }));
  }

  /** Copies the Desktop-visible history to an official fork immediately. */
  async cloneSession(sourceSessionId: string, targetSessionId: string, targetCwd: string): Promise<ConversationProjection | undefined> {
    const source = await this.restore(sourceSessionId);
    if (!source) return undefined;
    const events = source.events
      .filter(isChatEventRecord)
      .map((event) => ({ ...structuredClone(event), sessionId: targetSessionId } as ChatEvent));
    const runtime = source.runtime
      ? { ...structuredClone(source.runtime), sessionId: targetSessionId, cwd: targetCwd, updatedAt: new Date().toISOString() }
      : undefined;
    const queue = source.queue
      ? {
          ...structuredClone(source.queue),
          sessionId: targetSessionId,
          updatedAt: new Date().toISOString(),
          entries: source.queue.entries.map((entry) => ({ ...entry, sessionId: targetSessionId })),
          terminalEntries: source.queue.terminalEntries?.map((entry) => ({ ...entry, sessionId: targetSessionId })),
        }
      : undefined;
    if (runtime || queue) this.states.set(targetSessionId, { runtime, queue });
    await this.enqueue(targetSessionId, () => this.withSessionLock(targetSessionId, async () => {
      await this.compactWithoutLock(targetSessionId, events.map((event) => projectionRecord(event)), 0);
    }));
    return this.restore(targetSessionId);
  }

  /** Keep the visible projection attached to the same logical session after a project move. */
  async rebindRuntime(sessionId: string, targetCwd: string): Promise<void> {
    await this.flush(sessionId);
    const state = await this.loadState(sessionId);
    if (state.runtime) {
      const previousTime = Date.parse(state.runtime.updatedAt);
      const updatedAt = new Date(Math.max(Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : 0)).toISOString();
      state.runtime = { ...state.runtime, cwd: targetCwd, updatedAt };
      this.states.set(sessionId, state);
    }
    await this.enqueue(sessionId, () => this.withSessionLock(sessionId, async () => {
      const current = await this.restoreRecordsWithoutLock(sessionId);
      await this.compactWithoutLock(sessionId, current.records, current.truncatedEventCount);
    }));
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
    await this.enqueue(sessionId, () => this.withSessionLock(sessionId, async () => {
      await this.compactWithoutLock(sessionId, events.map((event) => projectionRecord(event)), 0);
    }));
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

  private async recordState(event: Extract<ChatEvent, { type: "prompt-queue" | "session-ready" | "mode" }>): Promise<void> {
    await this.flush(event.sessionId);
    const previous = await this.loadState(event.sessionId);
    if (event.type === "prompt-queue") {
      previous.queue = { version: 1, sessionId: event.sessionId, updatedAt: new Date().toISOString(), entries: structuredClone(event.entries) };
    } else {
      const runtime = previous.runtime ?? { sessionId: event.sessionId, cwd: "", effort: "", mode: "agent", updatedAt: new Date().toISOString() };
      if (event.type === "session-ready") {
        runtime.modelId = event.currentModelId ?? runtime.modelId;
        runtime.effort = event.effort ?? runtime.effort;
      } else runtime.mode = event.mode === "plan" || event.mode === "auto" ? event.mode : "agent";
      runtime.updatedAt = new Date().toISOString();
      previous.runtime = runtime;
    }
    this.states.set(event.sessionId, previous);
    await this.enqueue(event.sessionId, () => this.withSessionLock(event.sessionId, async () => {
      const current = await this.restoreRecordsWithoutLock(event.sessionId);
      await this.compactWithoutLock(event.sessionId, current.records, current.truncatedEventCount);
    }));
  }

  private async append(sessionId: string, event: ChatEvent): Promise<void> {
    await this.enqueue(sessionId, () => this.withSessionLock(sessionId, async () => {
      await mkdir(this.root, { recursive: true });
      const { journalPath } = this.paths(sessionId);
      await appendProjectionRecord(journalPath, projectionRecord(event));
      const count = (this.appended.get(sessionId) ?? 0) + 1;
      this.appended.set(sessionId, count);
      if (count >= 200 || ((await stat(journalPath).catch(() => undefined))?.size ?? 0) > 2 * 1024 * 1024) {
        const projection = await this.restoreRecordsWithoutLock(sessionId);
        if (projection.records.length) await this.compactWithoutLock(sessionId, projection.records, projection.truncatedEventCount);
      }
    }));
  }

  private async compactWithoutLock(sessionId: string, records: ProjectionRecord[], previousTruncatedEventCount: number): Promise<{ records: ProjectionRecord[]; truncatedEventCount: number; updatedAt: string }> {
    await mkdir(this.root, { recursive: true });
    const { snapshotPath, recoveryPath, journalPath } = this.paths(sessionId);
    const temp = `${snapshotPath}.${process.pid}.${randomUUID()}.tmp`;
    const recoveryTemp = `${recoveryPath}.${process.pid}.${randomUUID()}.tmp`;
    const state = await this.loadState(sessionId);
    const initiallyTrimmed = trimProjectionRecords(
      dedupeProjectionRecords(records),
      this.options.maxProjectionEvents ?? MAX_PROJECTION_EVENTS,
      this.options.maxProjectionBytes ?? MAX_PROJECTION_BYTES,
    );
    const updatedAt = new Date().toISOString();
    const fitted = fitProjectionSnapshot(
      sessionId,
      updatedAt,
      initiallyTrimmed.records,
      previousTruncatedEventCount + initiallyTrimmed.dropped,
      state,
      this.options.maxSnapshotFileBytes ?? MAX_SNAPSHOT_FILE_BYTES,
    );
    try {
      const handle = await open(temp, "wx");
      try {
        await handle.writeFile(fitted.serialized, "utf8");
        await handle.sync();
      } finally { await handle.close(); }
      await rename(temp, snapshotPath);
      // Keep a private, body-containing recovery copy beside the projection.
      await copyFile(snapshotPath, recoveryTemp);
      await rename(recoveryTemp, recoveryPath);
      await writeFile(journalPath, "", "utf8");
      this.appended.set(sessionId, 0);
      return { records: fitted.records, truncatedEventCount: fitted.truncatedEventCount, updatedAt };
    } finally {
      await Promise.all([rm(temp, { force: true }), rm(recoveryTemp, { force: true })]).catch(() => undefined);
    }
  }

  private async restoreRecordsWithoutLock(sessionId: string): Promise<LoadedProjectionRecords> {
    const { snapshotPath, recoveryPath, journalPath } = this.paths(sessionId);
    const snapshotLimit = this.options.maxSnapshotFileBytes ?? MAX_SNAPSHOT_FILE_BYTES;
    const snapshot = await readProjectionSnapshot(snapshotPath, sessionId, snapshotLimit)
      ?? await readProjectionSnapshot(recoveryPath, sessionId, snapshotLimit);
    if (snapshot) {
      const memory = this.states.get(sessionId);
      this.states.set(sessionId, {
        runtime: memory?.runtime ?? snapshot.runtime,
        queue: memory?.queue ?? snapshot.queue,
      });
    }
    const journal = await readFile(journalPath, "utf8").catch(() => "");
    let needsMigration = Boolean(snapshot && (!snapshot.eventIds || snapshot.eventIds.length !== snapshot.events.length));
    const snapshotRecords = snapshot?.events.map((event, index) => ({
      id: snapshot.eventIds?.[index] ?? legacyProjectionRecordId("snapshot", index, event),
      event,
    })) ?? [];
    const journalRecords = journal.split(/\r?\n/).filter(Boolean).flatMap((line, index) => {
      try {
        const value = JSON.parse(line) as unknown;
        const record = parseProjectionRecord(value, sessionId);
        if (record) return [record];
        const event = value as ChatEvent;
        if (event && typeof event === "object" && event.sessionId === sessionId && isPersistable(event)) {
          needsMigration = true;
          return [{ id: legacyProjectionRecordId("journal", index, event), event }];
        }
        return [];
      } catch { return []; }
    });
    return {
      snapshot,
      records: dedupeProjectionRecords([...snapshotRecords, ...journalRecords]),
      journalBytes: Buffer.byteLength(journal, "utf8"),
      truncatedEventCount: snapshot?.truncatedEventCount ?? 0,
      needsMigration,
    };
  }

  private async loadState(sessionId: string, snapshot?: ProjectionSnapshot): Promise<ProjectionState> {
    const memory = this.states.get(sessionId);
    const [runtime, queue] = await Promise.all([
      this.options.runtime?.(sessionId).catch(() => undefined),
      this.options.queue?.(sessionId).catch(() => undefined),
    ]);
    // Session-ready is emitted before ProcessManager has finished committing
    // the exact cwd/provider identity. Conversely a mode/queue event may be
    // newer than the external store write. Merge the records instead of
    // picking one wholesale, otherwise the first partial state can
    // permanently erase Provider identity, cwd or terminal queue evidence.
    const result: ProjectionState = {
      runtime: mergeRuntimeStates(sessionId, snapshot?.runtime, runtime, memory?.runtime),
      queue: mergeQueueStates(sessionId, snapshot?.queue, queue, memory?.queue),
    };
    this.states.set(sessionId, structuredClone(result));
    return result;
  }

  private enqueue<R>(sessionId: string, action: () => Promise<R>): Promise<R> {
    const previous = this.queues.get(sessionId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(action);
    let tracked!: Promise<void>;
    tracked = result.then(() => undefined, () => undefined).finally(() => {
      if (this.queues.get(sessionId) === tracked) this.queues.delete(sessionId);
    });
    this.queues.set(sessionId, tracked);
    return result;
  }

  private withSessionLock<R>(sessionId: string, action: () => Promise<R>): Promise<R> {
    return withCrossProcessFileLock(this.paths(sessionId).lockPath, action, { timeoutMs: 60_000 });
  }

  private paths(sessionId: string): { snapshotPath: string; recoveryPath: string; journalPath: string; lockPath: string } {
    const key = createHash("sha256").update(sessionId).digest("hex");
    return {
      snapshotPath: join(this.root, `${key}.snapshot.json`),
      recoveryPath: join(this.root, `${key}.snapshot.recovery.json`),
      journalPath: join(this.root, `${key}.jsonl`),
      lockPath: join(this.root, `${key}.lock`),
    };
  }
}

function mergeRuntimeStates(
  sessionId: string,
  ...values: Array<SessionRuntimePreferences | undefined>
): SessionRuntimePreferences | undefined {
  const candidates = values
    .filter((value): value is SessionRuntimePreferences => value?.sessionId === sessionId)
    .sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt));
  if (!candidates.length) return undefined;
  let merged = structuredClone(candidates[0]!);
  for (const candidate of candidates.slice(1)) {
    merged = {
      ...merged,
      ...candidate,
      // A provisional session-ready projection uses an empty cwd until the
      // ProcessManager commit arrives; never let that placeholder erase a
      // canonical execution root.
      cwd: candidate.cwd || merged.cwd,
      sessionId,
      updatedAt: laterTimestamp(merged.updatedAt, candidate.updatedAt),
    };
  }
  return merged;
}

function mergeQueueStates(
  sessionId: string,
  ...values: Array<PersistedPromptQueue | undefined>
): PersistedPromptQueue | undefined {
  const candidates = values
    .filter((value): value is PersistedPromptQueue => value?.sessionId === sessionId && Array.isArray(value.entries))
    .sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt));
  if (!candidates.length) return undefined;
  const newest = candidates.at(-1)!;
  const terminal = new Map<string, PersistedPromptQueue["entries"][number]>();
  for (const candidate of candidates) {
    for (const entry of candidate.terminalEntries ?? []) terminal.set(entry.id, structuredClone(entry));
  }
  return {
    version: 1,
    sessionId,
    updatedAt: newest.updatedAt,
    entries: structuredClone(newest.entries),
    ...(terminal.size ? { terminalEntries: [...terminal.values()].slice(-256) } : {}),
  };
}

function laterTimestamp(left: string, right: string): string {
  return Date.parse(right) >= Date.parse(left) ? right : left;
}

function isPersistable(event: ChatEvent): boolean {
  return !["session-reset", "session-ready", "commands", "mode", "prompt-queue", "turn-presentations-restore", "user-attachments-restore", "conversation-projection-restore", "history-recovery", "follow-ups"].includes(event.type);
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

interface ReplayTurnGroup {
  user?: Extract<ChatEvent, { type: "user-message" }>;
  events: ChatEvent[];
}

function mergeVisibleReplay(localEvents: ChatEvent[], replayEvents: ChatEvent[]): ChatEvent[] {
  const local = splitReplayTurns(localEvents);
  const replay = splitReplayTurns(replayEvents);
  local.prefix = mergeReplayBlock(local.prefix, replay.prefix);
  if (!local.turns.length) return [...local.prefix, ...replay.turns.flatMap((turn) => turn.events)];

  let localCursor = 0;
  let lastMatchedReplay = -1;
  for (let replayIndex = 0; replayIndex < replay.turns.length; replayIndex += 1) {
    const replayTurn = replay.turns[replayIndex]!;
    const match = local.turns.findIndex((candidate, index) => index >= localCursor && sameReplayUser(candidate.user, replayTurn.user));
    if (match < 0) continue;
    local.turns[match] = {
      user: local.turns[match]!.user ?? replayTurn.user,
      events: mergeReplayBlock(local.turns[match]!.events, replayTurn.events),
    };
    localCursor = match + 1;
    lastMatchedReplay = replayIndex;
  }

  // If the durable projection ended before the CLI replay, append only the
  // unmatched trailing turns. Missing turns in the middle are ambiguous (for
  // example after projection truncation) and are deliberately not invented.
  if (lastMatchedReplay >= 0 && localCursor === local.turns.length) {
    for (const turn of replay.turns.slice(lastMatchedReplay + 1)) {
      if (!local.turns.some((candidate) => sameReplayUser(candidate.user, turn.user))) local.turns.push(turn);
    }
  }
  return [...local.prefix, ...local.turns.flatMap((turn) => turn.events)];
}

function splitReplayTurns(events: ChatEvent[]): { prefix: ChatEvent[]; turns: ReplayTurnGroup[] } {
  const prefix: ChatEvent[] = [];
  const turns: ReplayTurnGroup[] = [];
  let current: ReplayTurnGroup | undefined;
  for (const event of events) {
    if (event.type === "user-message") {
      current = { user: event, events: [event] };
      turns.push(current);
    } else if (current) current.events.push(event);
    else prefix.push(event);
  }
  return { prefix, turns };
}

function sameReplayUser(left?: Extract<ChatEvent, { type: "user-message" }>, right?: Extract<ChatEvent, { type: "user-message" }>): boolean {
  if (!left || !right) return false;
  const leftId = left.clientMessageId ?? left.id;
  const rightId = right.clientMessageId ?? right.id;
  if (leftId && rightId && leftId === rightId) return true;
  return left.text === right.text
    && JSON.stringify((left.attachments ?? []).map((item) => [item.name, item.size, item.mimeType]))
      === JSON.stringify((right.attachments ?? []).map((item) => [item.name, item.size, item.mimeType]));
}

function mergeReplayBlock(localEvents: ChatEvent[], replayEvents: ChatEvent[]): ChatEvent[] {
  const output = localEvents.map((event) => structuredClone(event));
  for (const type of ["thought-chunk", "message-chunk"] as const) {
    const localText = output.flatMap((event) => event.type === type ? [event.text] : []).join("");
    const replayText = replayEvents.flatMap((event) => event.type === type ? [event.text] : []).join("");
    if (!replayText || localText === replayText || localText.startsWith(replayText)) continue;
    let missing = "";
    if (!localText) missing = replayText;
    else if (replayText.startsWith(localText)) missing = replayText.slice(localText.length);
    else {
      const overlap = longestReplayOverlap(localText, replayText);
      if (overlap >= Math.min(32, replayText.length)) missing = replayText.slice(overlap);
    }
    if (missing) insertBeforeTurnTerminal(output, { type, sessionId: replayEvents[0]?.sessionId ?? localEvents[0]?.sessionId ?? "", text: missing });
  }

  for (const event of replayEvents) {
    if (event.type === "message-chunk" || event.type === "thought-chunk") continue;
    if (event.type === "user-message") {
      const localUserIndex = output.findIndex((candidate) => candidate.type === "user-message" && sameReplayUser(candidate, event));
      if (localUserIndex >= 0) {
        if (preferReplayEvent(output[localUserIndex]!, event)) output[localUserIndex] = structuredClone(event);
        continue;
      }
    }
    const key = replayEventKey(event);
    const existingIndex = output.findIndex((candidate) => replayEventKey(candidate) === key);
    if (existingIndex < 0) {
      insertBeforeTurnTerminal(output, structuredClone(event));
      continue;
    }
    const preferred = preferReplayEvent(output[existingIndex]!, event);
    if (preferred) output[existingIndex] = structuredClone(event);
  }
  return output;
}

function replayEventKey(event: ChatEvent): string {
  if (event.type === "user-message") return `user:${event.clientMessageId ?? event.id ?? createHash("sha256").update(event.text).digest("hex")}`;
  if (event.type === "user-message-status") return `user-status:${event.clientMessageId}`;
  if (event.type === "interjection") return `interjection:${event.id}`;
  if (event.type === "tool-call") return `tool:${event.tool.toolCallId}`;
  if (event.type === "permission") return `permission:${String(event.request.requestId)}`;
  if (event.type === "question" || event.type === "plan" || event.type === "interaction-resolved") return `${event.type}:${String(event.requestId ?? "")}`;
  if (event.type === "turn-started" || event.type === "turn-completed") return `${event.type}:${event.presentation?.turnId ?? "unknown"}`;
  if (event.type === "media") return `media:${event.media}:${event.source}`;
  if (event.type === "error") return `error:${event.failure?.failureId ?? event.message}`;
  return `${event.type}:${createHash("sha256").update(JSON.stringify(event)).digest("hex")}`;
}

function preferReplayEvent(local: ChatEvent, replay: ChatEvent): boolean {
  if (local.type === "tool-call" && replay.type === "tool-call") {
    return ["pending", "in_progress"].includes(local.tool.status) && ["completed", "failed"].includes(replay.tool.status);
  }
  if (local.type === "user-message" && replay.type === "user-message") return local.delivery !== "sent" && replay.delivery === "sent";
  if (local.type === "user-message-status" && replay.type === "user-message-status") return local.delivery !== replay.delivery;
  if (local.type === "turn-completed" && replay.type === "turn-completed") {
    return !local.presentation?.usage && Boolean(replay.presentation?.usage);
  }
  return false;
}

function insertBeforeTurnTerminal(events: ChatEvent[], event: ChatEvent): void {
  const terminal = events.findIndex((value) => value.type === "turn-completed");
  if (terminal >= 0) events.splice(terminal, 0, event);
  else events.push(event);
}

function longestReplayOverlap(localText: string, replayText: string): number {
  const max = Math.min(localText.length, replayText.length);
  for (let length = max; length > 0; length -= 1) {
    if (localText.endsWith(replayText.slice(0, length))) return length;
  }
  return 0;
}

function trimProjectionRecords(records: ProjectionRecord[], maxEvents: number, maxBytes: number): { records: ProjectionRecord[]; dropped: number } {
  let bytes = 0;
  const kept: ProjectionRecord[] = [];
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index]!;
    const size = Buffer.byteLength(JSON.stringify(record), "utf8");
    if (kept.length >= maxEvents || bytes + size > maxBytes) break;
    kept.push(record);
    bytes += size;
  }
  kept.reverse();
  return { records: kept, dropped: records.length - kept.length };
}

function fitProjectionSnapshot(
  sessionId: string,
  updatedAt: string,
  records: ProjectionRecord[],
  alreadyTruncated: number,
  state: ProjectionState,
  maxFileBytes: number,
): { records: ProjectionRecord[]; truncatedEventCount: number; serialized: string } {
  const serialize = (kept: ProjectionRecord[]): { serialized: string; truncatedEventCount: number } => {
    const truncatedEventCount = alreadyTruncated + records.length - kept.length;
    const snapshot: ProjectionSnapshot = {
      version: 2,
      sessionId,
      updatedAt,
      events: kept.map((record) => record.event),
      eventIds: kept.map((record) => record.id),
      ...(truncatedEventCount ? { truncatedEventCount } : {}),
      ...state,
    };
    return { serialized: JSON.stringify(snapshot), truncatedEventCount };
  };
  const full = serialize(records);
  if (Buffer.byteLength(full.serialized, "utf8") <= maxFileBytes) return { records, ...full };

  // Keep the largest suffix that still fits. Old visible records are the only
  // data discarded here; runtime/queue state remains authoritative and the
  // dropped count becomes an explicit recovery marker on the next restore.
  let low = 0;
  let high = records.length;
  let best: { records: ProjectionRecord[]; serialized: string; truncatedEventCount: number } | undefined;
  while (low <= high) {
    const count = Math.floor((low + high) / 2);
    const kept = count ? records.slice(records.length - count) : [];
    const candidate = serialize(kept);
    if (Buffer.byteLength(candidate.serialized, "utf8") <= maxFileBytes) {
      best = { records: kept, ...candidate };
      low = count + 1;
    } else high = count - 1;
  }
  if (!best) throw new Error(`会话投影状态超过快照大小上限（${maxFileBytes} 字节）`);
  return best;
}

async function appendProjectionRecord(journalPath: string, record: ProjectionRecord): Promise<void> {
  const handle = await open(journalPath, "a");
  try {
    await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
    // The journal is the crash boundary between visible UI and the next
    // snapshot. Do not acknowledge record() while bytes only live in the OS
    // page cache; a power loss would otherwise resurrect the old UI state.
    await handle.datasync();
  } finally { await handle.close(); }
}

function projectionRecord(event: ChatEvent): ProjectionRecord {
  return { id: stableProjectionRecordId(event) ?? randomUUID(), event };
}

function stableProjectionRecordId(event: ChatEvent): string | undefined {
  let identity: string | undefined;
  if (event.type === "user-message") identity = event.clientMessageId ?? event.id;
  else if (event.type === "user-message-status") identity = event.clientMessageId;
  else if (event.type === "interjection") {
    // A local x.ai/interject receipt and the later session broadcast describe
    // the same current-turn injection. Keep one durable record even when the
    // broadcast carries slightly different presentation metadata.
    return `stable-${createHash("sha256").update(`interjection\0${event.id}`).digest("hex")}`;
  }
  else if (event.type === "tool-call") identity = event.tool.toolCallId;
  else if (event.type === "permission") identity = String(event.request.requestId);
  else if (event.type === "question" || event.type === "plan" || event.type === "interaction-resolved") identity = String(event.requestId ?? "");
  else if (event.type === "turn-started" || event.type === "turn-completed") identity = event.presentation?.turnId;
  else if (event.type === "session-recap") identity = `${event.turnId ?? "session"}:${event.contentHash}`;
  else if (event.type === "error") identity = event.failure?.failureId;
  if (!identity) return undefined;
  const digest = createHash("sha256").update(`${event.type}\0${identity}\0${JSON.stringify(event)}`).digest("hex");
  return `stable-${digest}`;
}

function parseProjectionRecord(value: unknown, sessionId: string): ProjectionRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<ProjectionRecord>;
  if (typeof candidate.id !== "string" || !candidate.id || candidate.id.length > 128 || candidate.id.includes("\0")) return undefined;
  const event = candidate.event;
  if (!event || typeof event !== "object" || event.sessionId !== sessionId || !isPersistable(event)) return undefined;
  return { id: candidate.id, event };
}

function legacyProjectionRecordId(source: "snapshot" | "journal", index: number, event: ChatEvent): string {
  return `legacy-${source}-${createHash("sha256").update(`${index}\0${JSON.stringify(event)}`).digest("hex")}`;
}

function dedupeProjectionRecords(records: ProjectionRecord[]): ProjectionRecord[] {
  const ids = new Set<string>();
  const output: ProjectionRecord[] = [];
  for (const record of records) {
    if (ids.has(record.id)) continue;
    ids.add(record.id);
    output.push(record);
  }
  return output;
}

function visibleProjectionEvents(sessionId: string, records: ProjectionRecord[], truncatedEventCount: number): ChatEvent[] {
  const events = records.map((record) => record.event);
  if (!truncatedEventCount) return events;
  return [{
    type: "history-recovery",
    sessionId,
    status: "unavailable",
    message: `较早的 ${truncatedEventCount} 条本地可见记录已达到投影容量上限并被截断。`,
  }, ...events];
}

function reconcileHostExitLease(sessionId: string, records: ProjectionRecord[], now: Date): { records: ProjectionRecord[]; changed: boolean } {
  const completed = new Set(records.flatMap((record) => record.event.type === "turn-completed" && record.event.presentation?.turnId
    ? [record.event.presentation.turnId]
    : []));
  let startIndex = -1;
  let started: Extract<ChatEvent, { type: "turn-started" }> | undefined;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const event = records[index]!.event;
    if (event.type === "turn-started" && event.presentation?.turnId && !completed.has(event.presentation.turnId)) {
      startIndex = index;
      started = event;
      break;
    }
  }
  if (!started || startIndex < 0) return { records, changed: false };

  const additions: ProjectionRecord[] = [];
  const resolved = new Set(records.slice(startIndex + 1).flatMap((record) => record.event.type === "interaction-resolved"
    ? [`${record.event.interaction}:${String(record.event.requestId)}`]
    : []));
  for (const record of records.slice(startIndex + 1)) {
    const event = record.event;
    const interaction = event.type === "permission" ? { kind: "permission" as const, id: event.request.requestId }
      : event.type === "question" ? { kind: "question" as const, id: event.requestId }
        : event.type === "plan" && event.requestId !== undefined ? { kind: "plan" as const, id: event.requestId }
          : undefined;
    if (!interaction || resolved.has(`${interaction.kind}:${String(interaction.id)}`)) continue;
    resolved.add(`${interaction.kind}:${String(interaction.id)}`);
    additions.push(projectionRecord({ type: "interaction-resolved", sessionId, interaction: interaction.kind, requestId: interaction.id, outcome: "host-interrupted" }));
  }

  const completedAt = now.toISOString();
  const startedAtMs = Date.parse(started.presentation.startedAt);
  const durationMs = Number.isFinite(startedAtMs) ? Math.max(0, now.getTime() - startedAtMs) : undefined;
  additions.push(projectionRecord({
    type: "turn-completed",
    sessionId,
    presentation: {
      ...started.presentation,
      completedAt,
      ...(durationMs !== undefined ? { durationMs } : {}),
      outcome: "interrupted",
    },
  }));
  additions.push(projectionRecord({ type: "error", sessionId, message: "上次运行在 Desktop 主进程退出时中断；旧交互已结束，可重新发送或继续。" }));
  return { records: dedupeProjectionRecords([...records, ...additions]), changed: true };
}

function bound(value: string | undefined, limit: number): string | undefined {
  if (!value || value.length <= limit) return value;
  return `${value.slice(0, limit)}\n…（本地投影已截断 ${value.length - limit} 字符）`;
}

function boundUtf8(value: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes) return { text: value, truncated: false };
  const suffix = "\n…（本地投影流式块已达到字节上限）";
  const room = Math.max(0, maxBytes - Buffer.byteLength(suffix, "utf8"));
  let end = room;
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return { text: bytes.subarray(0, end).toString("utf8") + suffix, truncated: true };
}

function enforceEventLimit(event: ChatEvent, maxBytes: number): ChatEvent {
  if (Buffer.byteLength(JSON.stringify(event), "utf8") <= maxBytes) return event;
  if (event.type === "user-message") return { ...event, text: boundUtf8(event.text, maxBytes / 2).text, attachments: event.attachments?.slice(0, 100) };
  if (event.type === "command-output") return { ...event, output: boundUtf8(event.output, maxBytes / 2).text, truncated: true };
  if (event.type === "plan") return { ...event, text: boundUtf8(event.text, maxBytes / 2).text };
  if (event.type === "media" && event.isData) return { ...event, source: "", isData: false };
  if (event.type === "tool-call") return { ...event, tool: { ...event.tool, content: [], output: bound(event.tool.output, 32_000), oldText: undefined, newText: undefined } };
  throw new Error(`本地投影事件 ${event.type} 超过 ${maxBytes} 字节硬限制`);
}

async function readProjectionSnapshot(path: string, sessionId: string, maxBytes = MAX_SNAPSHOT_FILE_BYTES): Promise<ProjectionSnapshot | undefined> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > maxBytes) return undefined;
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<ProjectionSnapshot>;
    if ((value.version !== 1 && value.version !== 2) || value.sessionId !== sessionId || typeof value.updatedAt !== "string" || !Array.isArray(value.events)) return undefined;
    const rawIds = Array.isArray(value.eventIds) ? value.eventIds : undefined;
    const events: ChatEvent[] = [];
    const eventIds: string[] = [];
    let idsValid = Boolean(rawIds && rawIds.length === value.events.length);
    value.events.forEach((event, index) => {
      if (!event || typeof event !== "object" || event.sessionId !== sessionId || !isPersistable(event)) return;
      events.push(event);
      const id = rawIds?.[index];
      if (typeof id === "string" && id && id.length <= 128 && !id.includes("\0")) eventIds.push(id);
      else idsValid = false;
    });
    if (eventIds.length !== events.length) idsValid = false;
    const truncatedEventCount = Number.isSafeInteger(value.truncatedEventCount) && (value.truncatedEventCount ?? 0) > 0
      ? Math.min(value.truncatedEventCount!, Number.MAX_SAFE_INTEGER)
      : 0;
    return {
      version: value.version,
      sessionId,
      updatedAt: value.updatedAt,
      events,
      ...(idsValid ? { eventIds } : {}),
      ...(truncatedEventCount ? { truncatedEventCount } : {}),
      ...(value.runtime?.sessionId === sessionId ? { runtime: value.runtime } : {}),
      ...(value.queue?.sessionId === sessionId && Array.isArray(value.queue.entries) ? { queue: value.queue } : {}),
    };
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

function isChatEventRecord(event: Record<string, unknown>): event is ChatEvent {
  return typeof event.type === "string" && typeof event.sessionId === "string";
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
