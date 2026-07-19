import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChatEvent } from "../../shared/types";
import { GrokAcpAdapter } from "./grok-acp-adapter";
import { LogService } from "./log-service";

describe.skipIf(process.platform !== "win32")("Grok ACP contract", () => {
  it("initializes, creates a session, merges streaming events and rejects unknown requests safely", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-fake-acp-"));
    const fakeScript = join(root, "fake-grok.mjs");
    const fakeCommand = join(root, "grok.cmd");
    const marker = join(root, "unknown-response.json");
    const argsMarker = join(root, "args.json");
    const effortMarker = join(root, "effort-request.json");
    await writeFile(fakeScript, `
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
const marker = ${JSON.stringify(marker)};
const argsMarker = ${JSON.stringify(argsMarker)};
const effortMarker = ${JSON.stringify(effortMarker)};
const generatedImage = ${JSON.stringify(join(root, "images", "generated.jpg"))};
await writeFile(argsMarker, JSON.stringify(process.argv.slice(2)));
const rl = createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
rl.on("line", async (line) => {
  const message = JSON.parse(line);
  if (message.id === "server-unknown") {
    await writeFile(marker, JSON.stringify(message));
    return;
  }
  if (message.method === "initialize") return send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } });
  if (message.method === "session/new") {
    send({ jsonrpc: "2.0", id: "server-unknown", method: "x.test/future_request", params: {} });
    send({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "available_commands_update", availableCommands: [{ name: "imagine", description: "Create media" }] } } });
    return send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "fake-session", models: { currentModelId: "grok-test", availableModels: [{ modelId: "grok-test", name: "Grok Test", _meta: { totalContextTokens: 100000 } }] } } });
  }
  if (message.method === "session/set_mode") return send({ jsonrpc: "2.0", id: message.id, result: {} });
  if (message.method === "session/set_model") {
    if (message.params?._meta?.reasoningEffort) await writeFile(effortMarker, JSON.stringify(message.params));
    send({ jsonrpc: "2.0", id: message.id, result: { _meta: { model: { Ok: message.params.modelId } } } });
    if (message.params?._meta?.reasoningEffort) send({ jsonrpc: "2.0", method: "_x.ai/session_notification", params: { sessionId: "fake-session", update: { sessionUpdate: "model_changed", model_id: message.params.modelId, reasoning_effort: message.params._meta.reasoningEffort } } });
    return;
  }
  if (message.method === "session/prompt") {
    send({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "thinking" } } } });
    send({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } } } });
    send({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "tool_call", toolCallId: "call-image", title: "image_gen", status: "in_progress" } } });
    send({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "tool_call_update", toolCallId: "call-image", title: "image_gen", status: "completed", content: [{ type: "content", content: { type: "text", text: JSON.stringify({ path: generatedImage }) } }] } } });
    send({ jsonrpc: "2.0", method: "_x.ai/session/update", params: { update: { sessionUpdate: "task_backgrounded", tool_call_id: "call-bg", task_id: "task-1", command: "echo hello", description: "Background echo" } } });
    send({ jsonrpc: "2.0", method: "_x.ai/session/update", params: { update: { sessionUpdate: "task_completed", task_snapshot: { task_id: "task-1", command: "echo hello", completed: true, exit_code: 0, output: "hello", truncated: true } } } });
    send({ jsonrpc: "2.0", method: "_x.ai/session/update", params: { update: { sessionUpdate: "turn_completed", usage: { totalTokens: 41 } } } });
    return send({ jsonrpc: "2.0", id: message.id, result: { _meta: { totalTokens: 42, modelId: "grok-test" } } });
  }
  if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, result: {} });
});
`, "utf8");
    await writeFile(fakeCommand, `@echo off\r\n"${process.execPath}" "${fakeScript}" %*\r\n`, "utf8");

    const events: ChatEvent[] = [];
    const adapter = new GrokAcpAdapter({
      cliPath: fakeCommand,
      cwd: root,
      env: process.env,
      effort: "high",
      mode: "agent",
      log: new LogService(join(root, "test.log")),
    });
    adapter.on("event", (event: ChatEvent) => events.push(event));
    try {
      const result = await adapter.start();
      expect(result.sessionId).toBe("fake-session");
      expect(adapter.models[0]).toMatchObject({ modelId: "grok-test", totalContextTokens: 100000 });
      expect(await adapter.waitForCommands()).toEqual([{ name: "imagine", description: "Create media", inputHint: undefined }]);
      await adapter.setEffort("low");
      expect(adapter.effort).toBe("low");
      await waitForFile(effortMarker);
      expect(JSON.parse(await readFile(effortMarker, "utf8"))).toEqual({
        sessionId: "fake-session",
        modelId: "grok-test",
        _meta: { reasoningEffort: "low" },
      });
      await adapter.prompt("test");
      await waitForFile(marker);
      expect(JSON.parse(await readFile(marker, "utf8"))).toMatchObject({
        id: "server-unknown",
        error: { code: -32601 },
      });
      expect(JSON.parse(await readFile(argsMarker, "utf8"))).toEqual(["agent", "--reasoning-effort", "high", "stdio"]);
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "thought-chunk", sessionId: "fake-session", text: "thinking" }),
        expect.objectContaining({ type: "message-chunk", sessionId: "fake-session", text: "hello" }),
        expect.objectContaining({ type: "commands", sessionId: "fake-session", commands: [expect.objectContaining({ name: "imagine" })] }),
        expect.objectContaining({ type: "media", sessionId: "fake-session", media: "image", source: join(root, "images", "generated.jpg") }),
        expect.objectContaining({ type: "meta", sessionId: "fake-session", meta: expect.objectContaining({ totalTokens: 42 }) }),
        expect.objectContaining({ type: "session-ready", sessionId: "fake-session", effort: "low" }),
      ]));
      expect(events.filter((event) => event.type === "subagent")).toHaveLength(0);
      expect(events.filter((event) => event.type === "tool-call" && event.tool.toolCallId === "call-bg")).toEqual([
        expect.objectContaining({ tool: expect.objectContaining({ status: "in_progress", kind: "background-task" }) }),
        expect.objectContaining({ tool: expect.objectContaining({ status: "completed", output: "hello", exitCode: 0, truncated: true }) }),
      ]);
    } finally {
      await adapter.dispose(500);
    }
  });
});

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { await readFile(path); return; } catch { await new Promise((resolve) => setTimeout(resolve, 20)); }
  }
  throw new Error(`Timed out waiting for ${path}`);
}
