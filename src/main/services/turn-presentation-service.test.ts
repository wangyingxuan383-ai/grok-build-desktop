import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TurnPresentationService } from "./turn-presentation-service";

describe("TurnPresentationService", () => {
  it("deduplicates completion updates and preserves measured duration", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok turns "));
    const service = new TurnPresentationService(root);
    const started = { turnId: "turn-1", ordinal: 0, clientMessageId: "message-1", startedAt: "2026-07-22T00:00:00.000Z" };
    await service.recordForSession("session-1", started);
    await service.recordForSession("session-1", { ...started, completedAt: "2026-07-22T00:00:01.234Z", durationMs: 1234, outcome: "completed" });
    await service.recordForSession("session-1", { ...started, completedAt: "2026-07-22T00:00:01.234Z", durationMs: 1234, outcome: "completed" });
    expect(await service.list("session-1")).toEqual([{ ...started, completedAt: "2026-07-22T00:00:01.234Z", durationMs: 1234, outcome: "completed" }]);
  });

  it("removes only the deleted session metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok turns delete "));
    const service = new TurnPresentationService(root);
    await service.recordForSession("first", { turnId: "a", ordinal: 0, startedAt: "2026-07-22T00:00:00.000Z" });
    await service.recordForSession("second", { turnId: "b", ordinal: 0, startedAt: "2026-07-22T00:00:00.000Z" });
    await service.delete("first");
    expect(await service.list("first")).toEqual([]);
    expect(await service.list("second")).toHaveLength(1);
  });

  it("persists failed and cancelled outcomes without inventing elapsed data", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok turns outcomes "));
    const service = new TurnPresentationService(root);
    await service.recordForSession("session", { turnId: "failed", ordinal: 0, startedAt: "2026-07-22T00:00:00.000Z", completedAt: "2026-07-22T00:00:00.500Z", durationMs: 500, outcome: "failed" });
    await service.recordForSession("session", { turnId: "cancelled", ordinal: 1, startedAt: "2026-07-22T00:00:01.000Z", completedAt: "2026-07-22T00:00:01.250Z", durationMs: 250, outcome: "cancelled" });
    await service.recordForSession("session", { turnId: "legacy", ordinal: 2, startedAt: "" });
    expect((await service.list("session")).map(({ turnId, outcome, durationMs }) => ({ turnId, outcome, durationMs }))).toEqual([
      { turnId: "failed", outcome: "failed", durationMs: 500 },
      { turnId: "cancelled", outcome: "cancelled", durationMs: 250 },
      { turnId: "legacy", outcome: undefined, durationMs: undefined },
    ]);
  });
});
