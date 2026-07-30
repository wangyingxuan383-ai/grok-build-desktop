import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChatEvent } from "../../shared/types";
import { GrokAcpAdapter } from "./grok-acp-adapter";
import { LogService } from "./log-service";

describe.skipIf(process.platform !== "win32")("Grok ACP custom-provider failure contract", () => {
  it("preserves the requested local model id and emits one structured prompt failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-provider-error-"));
    const fakeScript = join(root, "fake-grok.mjs");
    const fakeCommand = join(root, "grok.cmd");
    await writeFile(fakeScript, `
import { createInterface } from "node:readline";
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") return send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } });
  if (message.method === "session/new") return send({
    jsonrpc: "2.0",
    id: message.id,
    result: {
      sessionId: "provider-error-session",
      models: {
        currentModelId: "grok-4.5",
        availableModels: [
          { modelId: "grok-4.5", name: "Grok 4.5" },
          { modelId: "openai-compatible-grok-4.5", name: "CPA 兼容 · grok-4.5" }
        ]
      }
    }
  });
  if (message.method === "session/set_mode") return send({ jsonrpc: "2.0", id: message.id, result: {} });
  if (message.method === "session/prompt") {
    send({
      jsonrpc: "2.0",
      method: "_x.ai/session_notification",
      params: { sessionId: "provider-error-session", update: { sessionUpdate: "model_changed", model_id: "grok-4.5" } }
    });
    return send({
      jsonrpc: "2.0",
      id: message.id,
      error: {
        code: -32603,
        message: "Internal error",
        data: { message: "inference rejected", http_status: 401 }
      }
    });
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
      effort: "",
      mode: "agent",
      modelId: "openai-compatible-grok-4.5",
      providerScopeId: "provider-process-scope",
      log: new LogService(join(root, "test.log")),
    });
    adapter.on("event", (event: ChatEvent) => events.push(event));
    try {
      await adapter.start();
      expect(adapter.currentModelId).toBe("openai-compatible-grok-4.5");
      await expect(adapter.prompt("test")).rejects.toThrow("Internal error");
      expect(adapter.currentModelId).toBe("openai-compatible-grok-4.5");
      const failures = events.filter((event): event is Extract<ChatEvent, { type: "error" }> => event.type === "error");
      expect(failures).toHaveLength(1);
      expect(failures[0]?.failure).toMatchObject({
        classification: "auth-expired",
        httpStatus: 401,
        jsonRpcCode: -32603,
        modelId: "openai-compatible-grok-4.5",
        gatewayScopeId: "provider-process-scope",
        turnId: expect.any(String),
      });
      expect(events.filter((event) => event.type === "status" && event.status === "error")).toEqual([
        expect.objectContaining({ type: "status", status: "error", text: undefined }),
      ]);
    } finally {
      await adapter.dispose(500);
      await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 75 });
    }
  });
});
