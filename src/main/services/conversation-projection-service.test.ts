import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
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

describe("ConversationProjectionService", () => {
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
});
