import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GrokAcpAdapter } from "./grok-acp-adapter";
import { LogService } from "./log-service";

describe.skipIf(process.platform !== "win32")("Grok Plan mode wire contract", () => {
  it("pins Plan on session/set_mode, direct prompts and queued prompts", async () => {
    const fixture = await createFixture();
    const adapter = new GrokAcpAdapter({
      cliPath: fixture.command,
      cwd: fixture.root,
      env: process.env,
      effort: "high",
      mode: "plan",
      log: new LogService(join(fixture.root, "plan.log")),
    });

    try {
      await adapter.start();
      expect(JSON.parse(await readFile(fixture.modeMarker, "utf8"))).toMatchObject({ modeId: "plan" });

      await adapter.prompt("inspect only");
      expect(JSON.parse(await readFile(fixture.promptMarker, "utf8"))).toMatchObject({
        _meta: { mode: "plan", clientIdentifier: "grok-build-desktop" },
      });

      await adapter.queuePrompt("follow up", []);
      await waitForFile(fixture.queueMarker);
      expect(JSON.parse(await readFile(fixture.queueMarker, "utf8"))).toMatchObject({
        _meta: { mode: "plan", sendNow: false, clientIdentifier: "grok-build-desktop" },
      });
    } finally {
      await adapter.dispose(500);
    }
  });

  it("keeps a replayed Plan session in Plan instead of overwriting it with the constructor default", async () => {
    const fixture = await createFixture();
    const adapter = new GrokAcpAdapter({
      cliPath: fixture.command,
      cwd: fixture.root,
      env: { ...process.env, GROK_TEST_REPLAY_PLAN: "1" },
      effort: "high",
      mode: "agent",
      log: new LogService(join(fixture.root, "replay.log")),
    });

    try {
      await adapter.start("persisted-plan-session");
      expect(adapter.mode).toBe("plan");
      expect(adapter.planActive).toBe(true);
      expect(JSON.parse(await readFile(fixture.modeMarker, "utf8"))).toMatchObject({
        sessionId: "persisted-plan-session",
        modeId: "plan",
      });
    } finally {
      await adapter.dispose(500);
    }
  });
});

async function createFixture(): Promise<{
  root: string;
  command: string;
  modeMarker: string;
  promptMarker: string;
  queueMarker: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "grok-plan-mode-"));
  const script = join(root, "fake-grok.mjs");
  const command = join(root, "grok.cmd");
  const modeMarker = join(root, "mode.json");
  const promptMarker = join(root, "prompt.json");
  const queueMarker = join(root, "queue.json");
  await writeFile(script, `
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
const modeMarker = ${JSON.stringify(modeMarker)};
const promptMarker = ${JSON.stringify(promptMarker)};
const queueMarker = ${JSON.stringify(queueMarker)};
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
createInterface({ input: process.stdin }).on("line", async (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") return send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } });
  if (message.method === "session/new") return send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "new-plan-session", models: { availableModels: [] } } });
  if (message.method === "session/load") {
    if (process.env.GROK_TEST_REPLAY_PLAN === "1") {
      send({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "current_mode_update", currentModeId: "plan" } } });
    }
    return send({ jsonrpc: "2.0", id: message.id, result: { sessionId: message.params.sessionId, models: { availableModels: [] } } });
  }
  if (message.method === "session/set_mode") {
    await writeFile(modeMarker, JSON.stringify(message.params));
    return send({ jsonrpc: "2.0", id: message.id, result: {} });
  }
  if (message.method === "session/prompt") {
    if (message.params?._meta?.promptId) {
      await writeFile(queueMarker, JSON.stringify(message.params));
      return send({ jsonrpc: "2.0", id: message.id, result: { queued: true } });
    }
    await writeFile(promptMarker, JSON.stringify(message.params));
    send({ jsonrpc: "2.0", method: "_x.ai/session/update", params: { update: { sessionUpdate: "turn_completed" } } });
    return send({ jsonrpc: "2.0", id: message.id, result: {} });
  }
  if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, result: {} });
});
`, "utf8");
  await writeFile(command, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`, "utf8");
  return { root, command, modeMarker, promptMarker, queueMarker };
}

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { await readFile(path); return; } catch { await new Promise((resolve) => setTimeout(resolve, 20)); }
  }
  throw new Error(`Timed out waiting for ${path}`);
}
