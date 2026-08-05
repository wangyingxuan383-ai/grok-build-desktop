import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatEvent } from "../../shared/types";
import { GrokAcpAdapter } from "./grok-acp-adapter";
import { LogService } from "./log-service";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 75 }))));

describe.skipIf(process.platform !== "win32")("Grok terminal turn contract", () => {
  it("settles a prompt and clears working when turn_completed arrives without a prompt response", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-terminal-turn-")); roots.push(root);
    const fakeScript = join(root, "fake-terminal-grok.mjs");
    const fakeCommand = join(root, "grok.cmd");
    await writeFile(fakeScript, `
import { createInterface } from "node:readline";
const rl = createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") return send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } });
  if (message.method === "session/new") return send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "terminal-session", models: { currentModelId: "fixture", availableModels: [{ modelId: "fixture", name: "Fixture" }] } } });
  if (message.method === "session/set_mode") return send({ jsonrpc: "2.0", id: message.id, result: {} });
  if (message.method === "session/prompt") {
    send({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "final answer" } } } });
    send({ jsonrpc: "2.0", method: "_x.ai/session/update", params: { update: { sessionUpdate: "turn_completed", usage: { totalTokens: 12 } } } });
    return; // Deliberately omit the JSON-RPC response: this is the real regression.
  }
  if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, result: {} });
});
`, "utf8");
    await writeFile(fakeCommand, `@echo off\r\n"${process.execPath}" "${fakeScript}" %*\r\n`, "utf8");

    const events: ChatEvent[] = [];
    const log = new LogService(join(root, "adapter.log"));
    const adapter = new GrokAcpAdapter({
      cliPath: fakeCommand, cwd: root, env: process.env, effort: "", mode: "plan",
      log,
    });
    adapter.on("event", (event: ChatEvent) => events.push(event));
    try {
      await adapter.start();
      await expect(Promise.race([
        adapter.prompt("continue planning"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("prompt remained pending")), 2_000)),
      ])).resolves.toBeUndefined();
      expect(adapter.working).toBe(false);
      expect(adapter.needsUser).toBe(false);
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "message-chunk", text: "final answer" }),
        expect.objectContaining({ type: "turn-completed", presentation: expect.objectContaining({ outcome: "completed" }) }),
        expect.objectContaining({ type: "status", status: "idle", text: "已完成" }),
      ]));
      expect(events.filter((event) => event.type === "turn-completed")).toHaveLength(1);
    } finally {
      await adapter.dispose(500);
      await log.flush();
    }
  });

  it("settles a queued prompt by promptId when its turn completes without a prompt response", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-terminal-queued-turn-")); roots.push(root);
    const fakeScript = join(root, "fake-queued-terminal-grok.mjs");
    const fakeCommand = join(root, "grok.cmd");
    await writeFile(fakeScript, `
import { createInterface } from "node:readline";
const rl = createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") return send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } });
  if (message.method === "session/new") return send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "queued-terminal-session", models: { currentModelId: "fixture", availableModels: [{ modelId: "fixture", name: "Fixture" }] } } });
  if (message.method === "session/set_mode") return send({ jsonrpc: "2.0", id: message.id, result: {} });
  if (message.method === "session/prompt" && message.params?._meta?.promptId) {
    const promptId = message.params._meta.promptId;
    send({ jsonrpc: "2.0", method: "_x.ai/queue/changed", params: { runningPromptId: promptId, queue: [{ id: promptId, text: "queued follow-up", state: "sending", position: 0 }] } });
    send({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "queued final answer" } } } });
    send({ jsonrpc: "2.0", method: "_x.ai/session/update", params: { update: { sessionUpdate: "turn_completed", usage: { totalTokens: 7 } } } });
    return; // Deliberately omit the queued session/prompt response too.
  }
  if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, result: {} });
});
`, "utf8");
    await writeFile(fakeCommand, `@echo off\r\n"${process.execPath}" "${fakeScript}" %*\r\n`, "utf8");

    const events: ChatEvent[] = [];
    const log = new LogService(join(root, "adapter.log"));
    const adapter = new GrokAcpAdapter({
      cliPath: fakeCommand, cwd: root, env: process.env, effort: "", mode: "agent",
      log,
    });
    adapter.on("event", (event: ChatEvent) => events.push(event));
    try {
      await adapter.start();
      await adapter.queuePrompt("queued follow-up");
      await waitFor(() => events.some((event) => event.type === "turn-completed") && !adapter.working);
      expect(adapter.needsUser).toBe(false);
      expect((adapter as any).pending.size).toBe(0);
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "user-message", text: "queued follow-up", delivery: "sent" }),
        expect.objectContaining({ type: "message-chunk", text: "queued final answer" }),
        expect.objectContaining({ type: "turn-completed", presentation: expect.objectContaining({ outcome: "completed" }) }),
        expect.objectContaining({ type: "status", status: "idle", text: "已完成" }),
      ]));
      expect(events.filter((event) => event.type === "turn-completed")).toHaveLength(1);
    } finally {
      await adapter.dispose(500);
      await log.flush();
    }
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting for queued terminal state");
}
