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
    const queueMarker = join(root, "queue-request.json");
    const queueEditMarker = join(root, "queue-edit.json");
    const queueInterjectMarker = join(root, "queue-interject.json");
    const interjectMarker = join(root, "interject.json");
    const forkMarker = join(root, "fork-request.json");
    const rewindMarker = join(root, "rewind-request.json");
    await writeFile(fakeScript, `
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
const marker = ${JSON.stringify(marker)};
const argsMarker = ${JSON.stringify(argsMarker)};
const effortMarker = ${JSON.stringify(effortMarker)};
const queueMarker = ${JSON.stringify(queueMarker)};
const queueEditMarker = ${JSON.stringify(queueEditMarker)};
const queueInterjectMarker = ${JSON.stringify(queueInterjectMarker)};
const interjectMarker = ${JSON.stringify(interjectMarker)};
const forkMarker = ${JSON.stringify(forkMarker)};
const rewindMarker = ${JSON.stringify(rewindMarker)};
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
    if (message.params?._meta?.promptId) {
      await writeFile(queueMarker, JSON.stringify(message.params));
      send({ jsonrpc: "2.0", method: "_x.ai/queue/changed", params: { sessionId: "fake-session", entries: [{ id: message.params._meta.promptId, version: 2, owner: "grok-build-desktop", kind: "prompt", text: "queued text", position: 0 }] } });
      return send({ jsonrpc: "2.0", id: message.id, result: { queued: true } });
    }
    send({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "thinking" } } } });
    send({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } } } });
    send({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "tool_call", toolCallId: "call-image", title: "image_gen", status: "in_progress" } } });
    send({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "tool_call_update", toolCallId: "call-image", title: "image_gen", status: "completed", content: [{ type: "content", content: { type: "text", text: JSON.stringify({ path: generatedImage }) } }] } } });
    send({ jsonrpc: "2.0", method: "_x.ai/session/update", params: { update: { sessionUpdate: "task_backgrounded", tool_call_id: "call-bg", task_id: "task-1", command: "echo hello", description: "Background echo" } } });
    send({ jsonrpc: "2.0", method: "_x.ai/session/update", params: { update: { sessionUpdate: "task_completed", task_snapshot: { task_id: "task-1", command: "echo hello", completed: true, exit_code: 0, output: "hello", truncated: true } } } });
    send({ jsonrpc: "2.0", method: "_x.ai/session/update", params: { update: { sessionUpdate: "turn_completed", usage: { totalTokens: 41 } } } });
    return send({ jsonrpc: "2.0", id: message.id, result: { _meta: { totalTokens: 42, modelId: "grok-test" } } });
  }
  if (message.method === "x.ai/interject") { await writeFile(interjectMarker, JSON.stringify(message.params)); return send({ jsonrpc: "2.0", id: message.id, result: { result: { status: "queued" } } }); }
  if (message.method?.startsWith("x.ai/queue/")) { await writeFile(message.method === "x.ai/queue/interject" ? queueInterjectMarker : queueEditMarker, JSON.stringify(message)); return; }
  if (message.method === "x.ai/session/fork") { await writeFile(forkMarker, JSON.stringify(message.params)); return send({ jsonrpc: "2.0", id: message.id, result: { newSessionId: "forked-session", parentSessionId: "fake-session", newCwd: ${JSON.stringify(root)}, chatMessagesCopied: 1, updatesCopied: 1, planStateCopied: false } }); }
  if (message.method === "x.ai/rewind/points") return send({ jsonrpc: "2.0", id: message.id, result: { rewind_points: [{ prompt_index: 3, prompt_preview: "before change", num_file_snapshots: 2, created_at: "2026-07-20T00:00:00Z" }] } });
  if (message.method === "x.ai/rewind/execute") { await writeFile(rewindMarker, JSON.stringify(message.params)); return send({ jsonrpc: "2.0", id: message.id, result: {} }); }
  if (message.method === "x.ai/task/list") return send({ jsonrpc: "2.0", id: message.id, result: { result: { tasks: [{ taskId: "task-1", status: "running" }] } } });
  if (message.method === "x.ai/task/kill") return send({ jsonrpc: "2.0", id: message.id, result: { result: { taskId: message.params.taskId, outcome: "killed" } } });
  if (message.method === "x.ai/subagent/list_running") return send({ jsonrpc: "2.0", id: message.id, result: { result: { subagents: [{ subagentId: "sub-1", description: "review", status: "running" }] } } });
  if (message.method === "x.ai/subagent/cancel") return send({ jsonrpc: "2.0", id: message.id, result: { result: { subagentId: message.params.subagentId, cancelled: true, outcome: { kind: "cancelled" } } } });
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
      await adapter.queuePrompt("queued text", []);
      await waitForFile(queueMarker);
      const queued = JSON.parse(await readFile(queueMarker, "utf8"));
      expect(queued._meta).toMatchObject({ sendNow: false, clientIdentifier: "grok-build-desktop" });
      expect(queued._meta.promptId).toMatch(/^[0-9a-f-]{36}$/i);
      await adapter.editQueuedPrompt(queued._meta.promptId, "edited queue text");
      await waitForFile(queueEditMarker);
      expect(JSON.parse(await readFile(queueEditMarker, "utf8"))).toMatchObject({ method: "x.ai/queue/edit", params: { sessionId: "fake-session", id: queued._meta.promptId, newText: "edited queue text" } });
      await adapter.interjectQueuedPrompt(queued._meta.promptId);
      await waitForFile(queueInterjectMarker);
      expect(JSON.parse(await readFile(queueInterjectMarker, "utf8"))).toMatchObject({ method: "x.ai/queue/interject", params: { sessionId: "fake-session", id: queued._meta.promptId, expectedVersion: 2 } });
      await adapter.interjectPrompt("same turn");
      await waitForFile(interjectMarker);
      expect(JSON.parse(await readFile(interjectMarker, "utf8"))).toMatchObject({ sessionId: "fake-session", text: "same turn", interjectionId: expect.stringMatching(/^[0-9a-f-]{36}$/i) });
      expect(await adapter.fork("3")).toMatchObject({ newSessionId: "forked-session" });
      await waitForFile(forkMarker);
      expect(JSON.parse(await readFile(forkMarker, "utf8"))).toMatchObject({ sourceSessionId: "fake-session", sourceCwd: root, newCwd: root, targetPromptIndex: 3 });
      expect(await adapter.rewindPoints()).toEqual([{ id: "3", label: "before change", userMessage: "before change", filesChanged: 2, createdAt: "2026-07-20T00:00:00Z" }]);
      await adapter.rewind("3", "conversation-and-files");
      await waitForFile(rewindMarker);
      expect(JSON.parse(await readFile(rewindMarker, "utf8"))).toMatchObject({ sessionId: "fake-session", targetPromptIndex: 3, force: false, mode: "all" });
      expect(await adapter.taskList()).toMatchObject({ tasks: [{ taskId: "task-1" }] });
      await adapter.taskKill("task-1");
      expect(await adapter.subagentListRunning()).toMatchObject({ subagents: [{ subagentId: "sub-1" }] });
      await adapter.subagentCancel("sub-1");
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
        expect.objectContaining({ type: "prompt-queue", sessionId: "fake-session", entries: [expect.objectContaining({ text: "queued text", state: "queued", version: 2 })] }),
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
