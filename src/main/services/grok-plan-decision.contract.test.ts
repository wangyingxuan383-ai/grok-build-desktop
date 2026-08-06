import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatEvent } from "../../shared/types";
import { GrokAcpAdapter } from "./grok-acp-adapter";
import { LogService } from "./log-service";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, {
  recursive: true,
  force: true,
  maxRetries: 8,
  retryDelay: 75,
}))));

describe.skipIf(process.platform !== "win32")("plan decision ACP contract", () => {
  it.each(["approved", "rejected", "cancelled"] as const)("answers %s exactly once without creating a second prompt", async (verdict) => {
    const root = await mkdtemp(join(tmpdir(), "grok-plan-contract-")); roots.push(root);
    const fakeScript = join(root, "fake-plan-grok.mjs");
    const fakeCommand = join(root, "grok.cmd");
    const responseMarker = join(root, "plan-response.json");
    const promptMarker = join(root, "prompt-count.txt");
    await writeFile(promptMarker, "0");
    await writeFile(fakeScript, `
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
const responseMarker = ${JSON.stringify(responseMarker)};
const promptMarker = ${JSON.stringify(promptMarker)};
const rl = createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
rl.on("line", async (line) => {
  const message = JSON.parse(line);
  if (message.id === "server-plan") {
    await writeFile(responseMarker, JSON.stringify(message));
    return;
  }
  if (message.method === "initialize") return send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } });
  if (message.method === "session/new") {
    send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "plan-session", models: { currentModelId: "fixture", availableModels: [{ modelId: "fixture", name: "Fixture" }, { modelId: "fixture-plan-model", name: "Fixture plan model" }] } } });
    setTimeout(() => send({ jsonrpc: "2.0", id: "server-plan", method: "x.ai/exit_plan_mode", params: { planContent: "# Fixture plan" } }), 20);
    return;
  }
  if (message.method === "session/set_mode") return send({ jsonrpc: "2.0", id: message.id, result: {} });
  if (message.method === "session/set_model") return send({ jsonrpc: "2.0", id: message.id, result: { _meta: { model: { Ok: message.params.modelId } } } });
  if (message.method === "session/prompt") {
    const count = Number(await readFile(promptMarker, "utf8")) + 1;
    await writeFile(promptMarker, String(count));
    return send({ jsonrpc: "2.0", id: message.id, result: {} });
  }
  if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, result: {} });
});
`, "utf8");
    await writeFile(fakeCommand, `@echo off\r\n"${process.execPath}" "${fakeScript}" %*\r\n`, "utf8");
    const events: ChatEvent[] = [];
    const adapter = new GrokAcpAdapter({
      cliPath: fakeCommand, cwd: root, env: process.env, effort: "", mode: "plan",
      log: new LogService(join(root, "adapter.log")),
    });
    adapter.on("event", (event: ChatEvent) => events.push(event));
    try {
      await adapter.start();
      await waitFor(() => events.some((event) => event.type === "plan" && event.requestId === "server-plan"));
      await adapter.setModel("fixture-plan-model");
      expect(adapter.currentModelId).toBe("fixture-plan-model");
      const first = await adapter.respondPlan("server-plan", verdict, "fixture note");
      const duplicate = await adapter.respondPlan("server-plan", verdict, "duplicate note");
      expect(first).toMatchObject({ verdict, state: "accepted" });
      expect(duplicate).toMatchObject({ verdict, state: "duplicate" });
      const response = await waitForJson<Record<string, any>>(responseMarker);
      if (verdict === "approved") {
        expect(response.result).toEqual({ outcome: "approved" });
      } else if (verdict === "rejected") {
        expect(response.result).toEqual({ outcome: "cancelled", feedback: "fixture note" });
      } else {
        expect(response.result).toEqual({ outcome: "abandoned" });
      }
      expect(response).not.toHaveProperty("error");
      expect(await readFile(promptMarker, "utf8")).toBe("0");
    } finally {
      await adapter.dispose();
    }
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for fixture event");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function waitForJson<T>(path: string, timeoutMs = 5_000): Promise<T> {
  const started = Date.now();
  while (true) {
    try {
      const text = await readFile(path, "utf8");
      if (text.trim()) return JSON.parse(text) as T;
    } catch {}
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${path}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
