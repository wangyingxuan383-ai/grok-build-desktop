import { mkdtemp, readdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChatEvent } from "../../shared/types";
import { GrokAcpAdapter } from "./grok-acp-adapter";
import { LogService } from "./log-service";

const runLive = process.platform === "win32" && process.env.GROK_RUN_PLAN_LIVE === "1";

describe.skipIf(!runLive)("Grok Plan mode live acceptance", () => {
  it("runs a real read-only Plan turn without exposing permission cards or writing the workspace", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "grok-plan-live-workspace-"));
    const logPath = join(tmpdir(), `grok-plan-live-${process.pid}-${Date.now()}.log`);
    const adapter = new GrokAcpAdapter({
      cliPath: join(homedir(), ".grok", "bin", "grok.exe"),
      cwd,
      env: process.env,
      effort: "low",
      mode: "plan",
      log: new LogService(logPath),
    });
    const events: ChatEvent[] = [];
    let planDecision: Promise<unknown> | undefined;
    adapter.on("event", (event: ChatEvent) => {
      events.push(event);
      if (event.type === "plan" && event.requestId !== undefined && !planDecision) {
        // End the isolated acceptance turn without implementing its plan.
        planDecision = adapter.respondPlan(event.requestId, "cancelled");
      }
    });

    try {
      await adapter.start();
      await Promise.race([
        adapter.prompt("使用只读工具列出当前目录，然后给出一句话计划；不要创建、修改或删除任何文件。"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("live Plan turn timed out")), 240_000)),
      ]);
      await planDecision;
      expect(events.some((event) => event.type === "plan" && event.requestId !== undefined)).toBe(true);
      expect(events.filter((event) => event.type === "permission")).toHaveLength(0);
      expect(await readdir(cwd)).toEqual([]);
      const terminalDiagnostic = {
        working: adapter.working,
        activeTurnId: adapter.activeTurnId,
        mode: adapter.mode,
        needsUser: adapter.needsUser,
        terminalEvents: events.filter((event) => event.type === "turn-completed"),
        statusEvents: events.filter((event) => event.type === "status").slice(-8),
      };
      if (adapter.working) console.info("PLAN_LIVE_TERMINAL_DIAGNOSTIC", JSON.stringify(terminalDiagnostic));
      expect(terminalDiagnostic).toMatchObject({ working: false, activeTurnId: undefined, mode: "agent", needsUser: false });
    } finally {
      await adapter.dispose(2_000);
    }
  }, 260_000);
});
