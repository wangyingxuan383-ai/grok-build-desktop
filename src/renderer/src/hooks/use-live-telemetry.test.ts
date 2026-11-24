import { afterEach, describe, expect, it } from "vitest";
import type { SessionSummary } from "../../../shared/types";
import { useAppStore, type SessionView } from "../store";
import {
  clearSessionTelemetrySnooze,
  computeSessionTelemetry,
  formatTelemetryElapsed,
  getSessionTiming,
  isSessionTelemetrySnoozed,
  snoozeSessionTelemetry,
  STALL_THRESHOLD_MS,
} from "./use-live-telemetry";

function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "sess-telemetry",
    cwd: "D:/repo",
    title: "Telemetry Session",
    createdAt: "2026-11-24T00:00:00.000Z",
    updatedAt: "2026-11-24T00:00:00.000Z",
    messageCount: 2,
    status: "working",
    ...overrides,
  };
}

function makeView(overrides: Partial<SessionView> = {}): SessionView {
  return {
    hydration: "ready",
    hydrationGeneration: 1,
    status: "working",
    mode: "agent",
    currentModelId: "grok-4",
    effort: "",
    meta: {},
    compacting: false,
    models: [],
    commands: [],
    messages: [],
    queue: [],
    followUps: [],
    runtimeUpdates: [],
    turnPresentations: [],
    ...overrides,
  };
}

describe("use-live-telemetry stall attribution, snooze & cleanup", () => {
  afterEach(() => {
    clearSessionTelemetrySnooze("sess-telemetry");
    useAppStore.setState({ sessions: [], views: {} });
  });

  it("detects stalled sessions after 25s and attributes MCP, shell, subagent, and first-byte waits", () => {
    const start = 10_000;
    const beforeStall = start + STALL_THRESHOLD_MS - 1;
    const atStall = start + STALL_THRESHOLD_MS;

    const emptyWorking = computeSessionTelemetry(
      "sess-telemetry",
      makeView({ messages: [{ id: "u1", kind: "user", text: "hello" }] }),
      makeSummary(),
      { startedAtMs: start, lastEventAtMs: start },
      beforeStall,
    );
    expect(emptyWorking.isWorking).toBe(true);
    expect(emptyWorking.isStalled).toBe(false);

    const firstByteStall = computeSessionTelemetry(
      "sess-telemetry",
      makeView({ messages: [{ id: "u1", kind: "user", text: "hello" }] }),
      makeSummary(),
      { startedAtMs: start, lastEventAtMs: start },
      atStall,
    );
    expect(firstByteStall.isStalled).toBe(true);
    expect(firstByteStall.stalledReason).toContain("首字节响应");

    const shellStall = computeSessionTelemetry(
      "sess-telemetry",
      makeView({
        messages: [
          { id: "u1", kind: "user", text: "run tests" },
          {
            id: "t1",
            kind: "tool",
            tool: {
              toolCallId: "tc-1",
              title: "Run Vitest",
              kind: "execute",
              status: "in_progress",
              command: "npm test",
              locations: [{ path: "src/App.tsx" }],
            },
          },
        ],
      }),
      makeSummary(),
      { startedAtMs: start, lastEventAtMs: start },
      atStall + 5_000,
    );
    expect(shellStall.isStalled).toBe(true);
    expect(shellStall.stalledReason).toContain("等待终端命令完成");
    expect(shellStall.filesTouched).toBe(1);
    expect(shellStall.toolsRun).toBe(1);
    expect(formatTelemetryElapsed(shellStall.elapsedMs)).toBe("30s");
  });

  it("never flags needs-user sessions as stalled", () => {
    const res = computeSessionTelemetry(
      "sess-telemetry",
      makeView({ status: "needs-user" }),
      makeSummary({ status: "needs-user" }),
      { startedAtMs: 1_000, lastEventAtMs: 1_000 },
      90_000,
    );
    expect(res.isStalled).toBe(false);
  });

  it("supports snoozing and cleans up timing/snooze entries when a session is removed", () => {
    useAppStore.setState({
      sessions: [makeSummary({ id: "sess-telemetry", status: "working" })],
      views: { "sess-telemetry": makeView({ status: "working" }) },
    });
    snoozeSessionTelemetry("sess-telemetry", 60_000);
    expect(isSessionTelemetrySnoozed("sess-telemetry")).toBe(true);

    // Removing the session from store cleans up timing and snooze maps
    useAppStore.setState({ sessions: [], views: {} });
    expect(getSessionTiming("sess-telemetry")).toBeUndefined();
    expect(isSessionTelemetrySnoozed("sess-telemetry")).toBe(false);
  });
});
