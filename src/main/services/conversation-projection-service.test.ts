import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationProjectionService } from "./conversation-projection-service";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "grok-projection-"));
  roots.push(root);
  return root;
}

describe("ConversationProjectionService", { timeout: 60_000 }, () => {
  it("rebinds the persisted runtime cwd without cloning visible events", async () => {
    const root = await tempRoot();
    const service = new ConversationProjectionService(root);
    await service.record({ type: "session-ready", sessionId: "same", models: [], currentModelId: "grok-4.5", effort: "high" });
    await service.record({ type: "user-message", sessionId: "same", text: "keep me" });
    await service.restore("same");
    await service.rebindRuntime("same", "C:\\new");

    const projection = await service.restore("same");
    expect(projection?.runtime?.cwd).toBe("C:\\new");
    expect(projection?.events).toEqual([expect.objectContaining({ type: "user-message", text: "keep me" })]);
  });

  it("clones visible projection ownership to an official cross-directory fork", async () => {
    const root = await tempRoot();
    const service = new ConversationProjectionService(root);
    await service.record({ type: "user-message", sessionId: "parent", text: "迁移我" });
    await service.record({ type: "message-chunk", sessionId: "parent", text: "已保留" });
    const cloned = await service.cloneSession("parent", "child", "C:\\moved");
    expect(cloned?.events).toEqual([
      expect.objectContaining({ type: "user-message", sessionId: "child", text: "迁移我" }),
      expect.objectContaining({ type: "message-chunk", sessionId: "child", text: "已保留" }),
    ]);
  });
  it("persists partial assistant text across restart and ignores transport resets", async () => {
    const root = await tempRoot();
    const first = new ConversationProjectionService(root);
    await first.record({ type: "user-message", sessionId: "session", clientMessageId: "client", text: "hello", delivery: "sent" });
    await first.record({ type: "message-chunk", sessionId: "session", text: "partial " });
    await first.record({ type: "message-chunk", sessionId: "session", text: "answer" });
    await first.record({ type: "session-reset", sessionId: "session" });
    await first.record({ type: "error", sessionId: "session", message: "cancelled" });
    await first.dispose();

    const restarted = new ConversationProjectionService(root);
    const projection = await restarted.restore("session");
    expect(projection?.events).toEqual([
      expect.objectContaining({ type: "user-message", text: "hello" }),
      expect.objectContaining({ type: "message-chunk", text: "partial answer" }),
      expect.objectContaining({ type: "error", message: "cancelled" }),
    ]);
  });

  it("settles an orphaned host turn and its interaction once on the next restore", async () => {
    const root = await tempRoot();
    const first = new ConversationProjectionService(root, { isSessionActive: () => true });
    await first.record({ type: "user-message", sessionId: "host-exit", clientMessageId: "client", text: "work", delivery: "sent" });
    await first.record({ type: "turn-started", sessionId: "host-exit", presentation: { turnId: "turn", clientMessageId: "client", ordinal: 0, startedAt: "2026-08-20T00:00:00.000Z" } });
    await first.record({ type: "message-chunk", sessionId: "host-exit", text: "partial body" });
    await first.record({ type: "permission", sessionId: "host-exit", request: { requestId: 7, sessionId: "host-exit", toolCall: {}, options: [] } });
    await first.dispose();

    let queueInterrupts = 0;
    const restarted = new ConversationProjectionService(root, {
      isSessionActive: () => false,
      interruptQueue: async () => { queueInterrupts += 1; },
      now: () => new Date("2026-08-20T00:01:00.000Z"),
    });
    const projection = await restarted.restore("host-exit");
    expect(projection?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "message-chunk", text: "partial body" }),
      expect.objectContaining({ type: "interaction-resolved", interaction: "permission", requestId: 7, outcome: "host-interrupted" }),
      expect.objectContaining({ type: "turn-completed", presentation: expect.objectContaining({ turnId: "turn", outcome: "interrupted", durationMs: 60_000 }) }),
      expect.objectContaining({ type: "error", message: expect.stringContaining("主进程退出时中断") }),
    ]));
    expect(queueInterrupts).toBe(1);
    await restarted.restore("host-exit");
    expect(queueInterrupts).toBe(1);
  });

  it("does not settle a turn while its session is still active in this host", async () => {
    const root = await tempRoot();
    const service = new ConversationProjectionService(root, { isSessionActive: () => true });
    await service.record({ type: "turn-started", sessionId: "active", presentation: { turnId: "turn", ordinal: 0, startedAt: "2026-08-20T00:00:00.000Z" } });
    const projection = await service.restore("active");
    expect(projection?.events.some((event) => event.type === "turn-completed")).toBe(false);
  });

  it("reopens a current 300-turn projection repeatedly without losing media or answer blocks", async () => {
    const root = await tempRoot();
    const sessionId = "large-current";
    const replay = Array.from({ length: 300 }, (_, index) => [
      { type: "user-message" as const, sessionId, id: `user-${index}`, clientMessageId: `client-${index}`, text: `请求 ${index}`, delivery: "sent" as const },
      { type: "turn-started" as const, sessionId, presentation: { turnId: `turn-${index}`, clientMessageId: `client-${index}`, ordinal: index, startedAt: "2026-08-20T00:00:00.000Z" } },
      { type: "thought-chunk" as const, sessionId, text: `思考 ${index}` },
      { type: "message-chunk" as const, sessionId, text: `回答 ${index}` },
      ...(index % 10 === 0 ? [{ type: "media" as const, sessionId, media: "image" as const, source: `grok-media://access/00000000-0000-0000-0000-${String(index).padStart(12, "0")}` }] : []),
      { type: "turn-completed" as const, sessionId, presentation: { turnId: `turn-${index}`, clientMessageId: `client-${index}`, ordinal: index, startedAt: "2026-08-20T00:00:00.000Z", completedAt: "2026-08-20T00:00:01.000Z", durationMs: 1_000, outcome: "completed" as const } },
    ]).flat();
    const first = new ConversationProjectionService(root);
    const created = await first.mergeReplay(sessionId, replay);
    expect(created?.events.filter((event) => event.type === "media")).toHaveLength(30);
    await first.dispose();
    const second = await new ConversationProjectionService(root).restore(sessionId);
    const third = await new ConversationProjectionService(root).restore(sessionId);
    expect(second?.events).toEqual(third?.events);
    expect(second?.events.filter((event) => event.type === "message-chunk")).toHaveLength(300);
    expect(second?.events.filter((event) => event.type === "media")).toHaveLength(30);
  });

  it("writes a V2 snapshot with runtime, queue, status and terminal usage", async () => {
    const root = await tempRoot();
    const service = new ConversationProjectionService(root);
    await service.record({ type: "session-ready", sessionId: "v2", models: [], currentModelId: "custom-model", effort: "xhigh" });
    await service.record({ type: "mode", sessionId: "v2", mode: "plan" });
    await service.record({ type: "prompt-queue", sessionId: "v2", entries: [{ id: "queued", sessionId: "v2", text: "later", position: 0, createdAt: new Date().toISOString(), state: "queued" }] });
    await service.record({ type: "status", sessionId: "v2", status: "working", text: "running" });
    await service.record({ type: "turn-completed", sessionId: "v2", presentation: { turnId: "turn", ordinal: 0, startedAt: "2026-08-01T00:00:00Z", completedAt: "2026-08-01T00:00:01Z", durationMs: 1_000, outcome: "completed", usage: { totalTokens: 7, source: "acp-turn", exact: true } } });
    await service.dispose();
    const projection = await new ConversationProjectionService(root).restore("v2");
    expect(projection).toMatchObject({ version: 2, runtime: { modelId: "custom-model", effort: "xhigh", mode: "plan" }, queue: { entries: [{ id: "queued" }] } });
    expect(projection?.events).toEqual([
      expect.objectContaining({ type: "status", status: "working" }),
      expect.objectContaining({ type: "turn-completed", presentation: expect.objectContaining({ usage: expect.objectContaining({ totalTokens: 7 }) }) }),
    ]);
  });

  it("merges the exact runtime and queue terminal state committed after provisional session-ready", async () => {
    const root = await tempRoot();
    let runtime: any;
    let queue: any;
    const service = new ConversationProjectionService(root, {
      runtime: async () => runtime,
      queue: async () => queue,
    });
    await service.record({ type: "session-ready", sessionId: "managed", models: [], currentModelId: "upstream-alias", effort: "high" });
    runtime = {
      sessionId: "managed",
      cwd: "E:\\workspace\\provider",
      modelId: "local-provider-model",
      providerId: "provider-a",
      effort: "high",
      mode: "agent",
      updatedAt: "2099-08-04T00:00:00.000Z",
    };
    queue = {
      version: 1,
      sessionId: "managed",
      updatedAt: "2099-08-04T00:00:01.000Z",
      entries: [],
      terminalEntries: [{ id: "done", sessionId: "managed", text: "queued", position: 0, createdAt: "2099-08-04T00:00:00.000Z", state: "completed" }],
    };
    await service.record({ type: "status", sessionId: "managed", status: "idle", text: "ready" });
    const projection = await service.restore("managed");
    expect(projection?.runtime).toMatchObject({ cwd: "E:\\workspace\\provider", modelId: "local-provider-model", providerId: "provider-a" });
    expect(projection?.queue?.terminalEntries).toEqual([expect.objectContaining({ id: "done", state: "completed" })]);
  });

  it("hard-bounds one UTF-8 streaming block without splitting a character", async () => {
    const root = await tempRoot();
    const service = new ConversationProjectionService(root, { maxStreamBlockBytes: 128 });
    for (let index = 0; index < 20; index += 1) await service.record({ type: "message-chunk", sessionId: "bounded", text: "界".repeat(20) });
    await service.dispose();
    const event = (await service.restore("bounded"))?.events.find((value) => value.type === "message-chunk");
    expect(event?.text).toContain("达到字节上限");
    expect(event?.text).not.toContain("�");
    expect(Buffer.byteLength(String(event?.text), "utf8")).toBeLessThanOrEqual(128);
  });

  it("survives a third reopen without losing the partial body", async () => {
    const root = await tempRoot();
    const first = new ConversationProjectionService(root);
    await first.record({ type: "message-chunk", sessionId: "three", text: "durable partial" });
    await first.dispose();
    const second = new ConversationProjectionService(root);
    expect((await second.restore("three"))?.events).toEqual([expect.objectContaining({ text: "durable partial" })]);
    await second.dispose();
    const third = new ConversationProjectionService(root);
    expect((await third.restore("three"))?.events).toEqual([expect.objectContaining({ text: "durable partial" })]);
  });

  it("merges only the missing replay suffix into a partially persisted answer", async () => {
    const root = await tempRoot();
    const service = new ConversationProjectionService(root);
    await service.record({ type: "user-message", sessionId: "partial-replay", clientMessageId: "local-1", text: "question", delivery: "sent" });
    await service.record({ type: "message-chunk", sessionId: "partial-replay", text: "partial " });
    await service.record({ type: "turn-completed", sessionId: "partial-replay" });

    const projection = await service.mergeReplay("partial-replay", [
      { type: "user-message", sessionId: "partial-replay", clientMessageId: "cli-1", text: "question", delivery: "sent" },
      { type: "message-chunk", sessionId: "partial-replay", text: "partial answer" },
      { type: "turn-completed", sessionId: "partial-replay" },
    ]);

    expect(projection?.events.filter((event) => event.type === "user-message")).toHaveLength(1);
    expect(projection?.events.flatMap((event) => event.type === "message-chunk" ? [event.text] : []).join("")).toBe("partial answer");
  });

  it("does not duplicate a complete replay when ACP changes chunk boundaries", async () => {
    const root = await tempRoot();
    const service = new ConversationProjectionService(root);
    await service.record({ type: "user-message", sessionId: "rechunked", text: "same question", delivery: "sent" });
    await service.record({ type: "message-chunk", sessionId: "rechunked", text: "complete " });
    await service.record({ type: "message-chunk", sessionId: "rechunked", text: "answer" });
    await service.record({ type: "turn-completed", sessionId: "rechunked" });

    const projection = await service.mergeReplay("rechunked", [
      { type: "user-message", sessionId: "rechunked", id: "cli-user", text: "same question", delivery: "sent" },
      { type: "message-chunk", sessionId: "rechunked", text: "complete answer" },
      { type: "turn-completed", sessionId: "rechunked" },
    ]);

    expect(projection?.events.flatMap((event) => event.type === "message-chunk" ? [event.text] : []).join("")).toBe("complete answer");
    expect(projection?.events.filter((event) => event.type === "turn-completed")).toHaveLength(1);
  });

  it("appends a replayed trailing turn after the durable projection ends", async () => {
    const root = await tempRoot();
    const service = new ConversationProjectionService(root);
    await service.record({ type: "user-message", sessionId: "trailing", text: "first", delivery: "sent" });
    await service.record({ type: "message-chunk", sessionId: "trailing", text: "one" });
    await service.record({ type: "turn-completed", sessionId: "trailing" });

    const projection = await service.mergeReplay("trailing", [
      { type: "user-message", sessionId: "trailing", text: "first", delivery: "sent" },
      { type: "message-chunk", sessionId: "trailing", text: "one" },
      { type: "turn-completed", sessionId: "trailing" },
      { type: "user-message", sessionId: "trailing", text: "second", delivery: "sent" },
      { type: "message-chunk", sessionId: "trailing", text: "two" },
      { type: "turn-completed", sessionId: "trailing" },
    ]);

    expect(projection?.events.flatMap((event) => event.type === "user-message" ? [event.text] : [])).toEqual(["first", "second"]);
    expect(projection?.events.flatMap((event) => event.type === "message-chunk" ? [event.text] : []).join("|")).toBe("one|two");
  });

  it("does not invent an unmatched replay turn in the middle of durable history", async () => {
    const root = await tempRoot();
    const service = new ConversationProjectionService(root);
    for (const [question, answer] of [["first", "one"], ["third", "three"]] as const) {
      await service.record({ type: "user-message", sessionId: "middle", text: question, delivery: "sent" });
      await service.record({ type: "message-chunk", sessionId: "middle", text: answer });
      await service.record({ type: "turn-completed", sessionId: "middle" });
    }

    const replay = [["first", "one"], ["second", "two"], ["third", "three"]].flatMap(([question, answer]) => [
      { type: "user-message" as const, sessionId: "middle", text: question!, delivery: "sent" as const },
      { type: "message-chunk" as const, sessionId: "middle", text: answer! },
      { type: "turn-completed" as const, sessionId: "middle" },
    ]);
    const projection = await service.mergeReplay("middle", replay);

    expect(projection?.events.flatMap((event) => event.type === "user-message" ? [event.text] : [])).toEqual(["first", "third"]);
    expect(JSON.stringify(projection)).not.toContain("second");
    expect(JSON.stringify(projection)).not.toContain("two");
  });

  it("deletes only the selected session projection", async () => {
    const root = await tempRoot();
    const service = new ConversationProjectionService(root);
    await service.record({ type: "message-chunk", sessionId: "one", text: "one" });
    await service.record({ type: "message-chunk", sessionId: "two", text: "two" });
    await service.delete("one");
    expect(await service.restore("one")).toBeUndefined();
    expect(await service.restore("two")).toMatchObject({ sessionId: "two" });
  });

  it("persists interaction resolution so an answered card cannot revive", async () => {
    const root = await tempRoot();
    const service = new ConversationProjectionService(root);
    await service.record({ type: "permission", sessionId: "session", request: { requestId: 7, sessionId: "session", toolCall: {}, options: [] } });
    await service.record({ type: "interaction-resolved", sessionId: "session", interaction: "permission", requestId: 7, outcome: "allow_once" });
    await service.dispose();
    expect((await service.restore("session"))?.events).toEqual([
      expect.objectContaining({ type: "permission" }),
      expect.objectContaining({ type: "interaction-resolved", requestId: 7 }),
    ]);
  });

  it("recovers only assistant chunks that have reliable user turn boundaries", async () => {
    const root = await tempRoot();
    const sessionsRoot = join(root, "sessions");
    const cwd = "E:\\workspace\\sample";
    const sessionId = "legacy-session";
    const directory = join(sessionsRoot, encodeURIComponent(cwd), sessionId);
    await mkdir(directory, { recursive: true });
    const line = (sessionUpdate: string, content?: unknown) => JSON.stringify({
      method: "session/update",
      params: { sessionId, update: { sessionUpdate, ...(content === undefined ? {} : { content }) } },
    });
    await writeFile(join(directory, "updates.jsonl"), [
      line("agent_message_chunk", { type: "text", text: "orphan" }),
      line("user_message_chunk", { type: "text", text: "hello" }),
      line("agent_thought_chunk", { type: "text", text: "thinking" }),
      line("agent_message_chunk", { type: "text", text: "visible answer" }),
      line("turn_completed"),
    ].join("\n"), "utf8");
    const service = new ConversationProjectionService(root, { sessionsRoot });
    const result = await service.recoverLegacy(sessionId, cwd);
    expect(result.status).toBe("recovered");
    expect(result.projection?.events).toEqual([
      expect.objectContaining({ type: "user-message", text: "hello" }),
      expect.objectContaining({ type: "thought-chunk", text: "thinking" }),
      expect.objectContaining({ type: "message-chunk", text: "visible answer" }),
      expect.objectContaining({ type: "turn-completed" }),
    ]);
    expect(JSON.stringify(result.projection)).not.toContain("orphan");
  });

  it("falls back to the private recovery snapshot when the primary snapshot is damaged", async () => {
    const root = await tempRoot();
    const service = new ConversationProjectionService(root);
    for (let index = 0; index < 205; index += 1) {
      await service.record({ type: "message-chunk", sessionId: "damaged", text: `${index},` });
      await service.record({ type: "turn-completed", sessionId: "damaged" });
    }
    await service.dispose();
    const directory = join(root, "conversation-projections");
    const primary = (await readdir(directory)).find((name) => name.endsWith(".snapshot.json"));
    expect(primary).toBeTruthy();
    await writeFile(join(directory, primary!), JSON.stringify({ version: 1, sessionId: "damaged", updatedAt: "invalid", events: {} }), "utf8");
    const restarted = new ConversationProjectionService(root);
    const projection = await restarted.restore("damaged");
    expect(projection?.events.some((event) => event.type === "message-chunk" && String(event.text).includes("0,"))).toBe(true);
    expect(projection?.events.some((event) => event.type === "message-chunk" && String(event.text).includes("204,"))).toBe(true);
  });

  it("deduplicates a journal record already committed to the snapshot", async () => {
    const root = await tempRoot();
    const service = new ConversationProjectionService(root);
    for (let index = 0; index < 205; index += 1) {
      await service.record({ type: "error", sessionId: "dedupe", message: `event-${index}` });
    }
    await service.dispose();
    const directory = join(root, "conversation-projections");
    const names = await readdir(directory);
    const snapshotPath = join(directory, names.find((name) => name.endsWith(".snapshot.json"))!);
    const journalPath = join(directory, names.find((name) => name.endsWith(".jsonl"))!);
    const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as { events: unknown[]; eventIds: string[] };
    await appendFile(journalPath, `${JSON.stringify({ id: snapshot.eventIds[0], event: snapshot.events[0] })}\n`, "utf8");
    const projection = await new ConversationProjectionService(root).restore("dedupe");
    expect(projection?.events.filter((event) => event.type === "error")).toHaveLength(205);
  });

  it("deduplicates replayed events that carry a stable client identity", async () => {
    const root = await tempRoot();
    const service = new ConversationProjectionService(root);
    const event = { type: "user-message" as const, sessionId: "stable-event", clientMessageId: "client-1", text: "只显示一次", delivery: "sent" as const };
    await service.record(event);
    await service.record(structuredClone(event));
    const projection = await service.restore("stable-event");
    expect(projection?.events.filter((value) => value.type === "user-message")).toHaveLength(1);
  });

  it("persists one current-turn interjection when local receipt and CLI broadcast share an id", async () => {
    const root = await tempRoot();
    const service = new ConversationProjectionService(root);
    await service.record({
      type: "interjection",
      sessionId: "interjection-session",
      id: "interjection-1",
      text: "补充当前回合",
      clientMessageId: "client-1",
      source: "local",
    });
    await service.record({
      type: "interjection",
      sessionId: "interjection-session",
      id: "interjection-1",
      text: "补充当前回合",
      source: "remote",
    });
    const projection = await service.restore("interjection-session");
    expect(projection?.events.filter((value) => value.type === "interjection")).toHaveLength(1);
  });

  it("serializes two projection instances without losing concurrent events", async () => {
    const root = await tempRoot();
    const first = new ConversationProjectionService(root);
    const second = new ConversationProjectionService(root);
    const writes: Array<Promise<void>> = [];
    for (let index = 0; index < 205; index += 1) {
      writes.push(first.record({ type: "error", sessionId: "shared", message: `first-${index}` }));
      writes.push(second.record({ type: "error", sessionId: "shared", message: `second-${index}` }));
    }
    await expect(Promise.all(writes)).resolves.toHaveLength(410);
    const projection = await new ConversationProjectionService(root).restore("shared");
    const messages = projection?.events.flatMap((event) => event.type === "error" ? [event.message] : []) ?? [];
    expect(messages).toHaveLength(410);
    expect(new Set(messages).size).toBe(410);
  });

  it("surfaces an explicit marker when compaction truncates old visible events", async () => {
    const root = await tempRoot();
    const service = new ConversationProjectionService(root, { maxProjectionEvents: 3, maxProjectionBytes: 1024 * 1024 });
    for (let index = 0; index < 5; index += 1) await service.record({ type: "error", sessionId: "trimmed", message: `event-${index}` });
    await service.record({ type: "session-ready", sessionId: "trimmed", models: [] });
    const projection = await service.restore("trimmed");
    expect(projection?.events[0]).toMatchObject({ type: "history-recovery", status: "unavailable", message: expect.stringContaining("2 条") });
    expect(projection?.events.filter((event) => event.type === "error")).toHaveLength(3);
  });

  it("never writes an oversized snapshot and marks records removed to fit the file cap", async () => {
    const root = await tempRoot();
    const service = new ConversationProjectionService(root, {
      maxProjectionEvents: 100,
      maxProjectionBytes: 1024 * 1024,
      maxSnapshotFileBytes: 2_000,
    });
    for (let index = 0; index < 8; index += 1) {
      await service.record({ type: "error", sessionId: "snapshot-cap", message: `${index}-${"x".repeat(500)}` });
    }
    await service.record({ type: "session-ready", sessionId: "snapshot-cap", models: [] });
    const directory = join(root, "conversation-projections");
    const snapshot = (await readdir(directory)).find((name) => name.endsWith(".snapshot.json"));
    expect(snapshot).toBeTruthy();
    expect(Buffer.byteLength(await readFile(join(directory, snapshot!), "utf8"), "utf8")).toBeLessThanOrEqual(2_000);
    const projection = await service.restore("snapshot-cap");
    expect(projection?.events[0]).toMatchObject({ type: "history-recovery", status: "unavailable" });
    expect(projection?.events.some((event) => event.type === "error" && String(event.message).startsWith("7-"))).toBe(true);
  });

  it("does not read an oversized primary snapshot and falls back to recovery", async () => {
    const root = await tempRoot();
    const service = new ConversationProjectionService(root);
    for (let index = 0; index < 205; index += 1) await service.record({ type: "error", sessionId: "oversized", message: `event-${index}` });
    await service.dispose();
    const directory = join(root, "conversation-projections");
    const primary = (await readdir(directory)).find((name) => name.endsWith(".snapshot.json"));
    expect(primary).toBeTruthy();
    await truncate(join(directory, primary!), 40 * 1024 * 1024 + 1);
    const projection = await new ConversationProjectionService(root).restore("oversized");
    expect(projection?.events.some((event) => event.type === "error" && event.message === "event-204")).toBe(true);
  });

  it("surfaces a storage failure and accepts later writes after storage recovers", async () => {
    const root = await tempRoot();
    const blocked = join(root, "conversation-projections");
    await writeFile(blocked, "not-a-directory", "utf8");
    const service = new ConversationProjectionService(root);
    await expect(service.record({ type: "status", sessionId: "disk", status: "working", text: "before" })).rejects.toThrow();
    await rm(blocked, { force: true });
    await service.record({ type: "status", sessionId: "disk", status: "working", text: "after" });
    expect((await service.restore("disk"))?.events).toEqual([expect.objectContaining({ text: "after" })]);
  });
});
