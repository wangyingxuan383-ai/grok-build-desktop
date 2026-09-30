import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TurnPresentation } from "../../shared/types";
import { TokenActivityService } from "./token-activity-service";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const NOW = new Date("2026-07-26T12:00:00.000Z");
async function service(now = NOW, timeZone?: string): Promise<{ service: TokenActivityService; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "token-activity-")); roots.push(root);
  return { service: new TokenActivityService(root, () => now, timeZone), root };
}

function turn(patch: Partial<TurnPresentation> & { at?: string; usage?: TurnPresentation["usage"] } = {}): TurnPresentation {
  const { at = NOW.toISOString(), ...rest } = patch;
  return {
    turnId: `t-${Math.random().toString(16).slice(2)}`, ordinal: 0,
    startedAt: at, completedAt: at, outcome: "completed", ...rest,
  } as TurnPresentation;
}

const usage = (input: number, output: number) => ({ inputTokens: input, outputTokens: output, totalTokens: input + output, source: "acp-turn", exact: true } as TurnPresentation["usage"]);

describe("token activity recording", () => {
  it("retains totals, filters and deduplication beyond 20000 recent turns", async () => {
    const { service: activity, root } = await service(NOW, "Asia/Shanghai");
    const turns = Array.from({ length: 20000 }, (_, index) => ({
      at: NOW.toISOString(), sessionId: "s1", turnId: `turn-${index}`, hasUsage: true,
      totalTokens: 1, modelId: "fixture", source: "acp-turn",
    }));
    await writeFile(join(root, "token-activity.json"), JSON.stringify({ schemaVersion: 2, turns, days: {}, anonymousDays: {}, legacyUtcDays: {} }));
    await activity.record("s1", turn({ turnId: "new", usage: { ...usage(1, 0)!, modelId: "fixture" } }));
    await activity.record("s1", turn({ turnId: "turn-0", usage: { ...usage(1, 0)!, modelId: "fixture" } }));
    const report = await activity.report({ modelId: "fixture" });
    expect(report.windows.today).toMatchObject({ turns: 20001, totalTokens: 20001 });
    expect(report.days.at(-1)?.totalTokens).toBe(20001);
  });
  it("rebinds per-turn ownership without changing aggregate totals", async () => {
    const { service: activity } = await service();
    await activity.record("parent", turn({ usage: usage(10, 2) }), { workspace: "E:\\old" });
    await activity.rebindSession("parent", "child", "C:\\new");
    const all = await activity.report();
    const moved = await activity.report({ workspace: "C:\\new" });
    expect(all.windows.today.totalTokens).toBe(12);
    expect(moved.windows.today).toMatchObject({ turns: 1, totalTokens: 12 });
  });
  it("sums only what was actually reported", async () => {
    const { service: activity } = await service();
    await activity.record("s1", turn({ usage: usage(100, 20) }));
    await activity.record("s1", turn({ usage: usage(50, 5) }));
    const report = await activity.report();
    expect(report.windows.today).toMatchObject({ turns: 2, turnsWithUsage: 2, inputTokens: 150, outputTokens: 25, totalTokens: 175 });
  });

  it("does not synthesize a missing total by adding reasoning to input/output", async () => {
    const { service: activity } = await service();
    await activity.record("s1", turn({ usage: { inputTokens: 10, outputTokens: 2, reasoningTokens: 50, source: "acp-turn", exact: true } }));
    const today = (await activity.report()).windows.today;
    expect(today).toMatchObject({ turns: 1, turnsWithUsage: 1, turnsWithTotal: 0, inputTokens: 10, outputTokens: 2, reasoningTokens: 50, totalTokens: 0 });
  });

  it("counts an unmeasured turn in coverage but never invents tokens for it", async () => {
    const { service: activity } = await service();
    await activity.record("s1", turn({ usage: usage(100, 20) }));
    // A failed or cancelled turn carries no usage at all.
    await activity.record("s1", turn({ outcome: "failed" }));
    const today = (await activity.report()).windows.today;
    expect(today).toMatchObject({ turns: 2, turnsWithUsage: 1, totalTokens: 120 });
  });

  it("does not double count when the same turn is recorded twice", async () => {
    const { service: activity } = await service();
    const presentation = turn({ usage: usage(10, 1) });
    await activity.record("s1", presentation);
    await activity.record("s1", presentation);
    expect((await activity.report()).windows.today.turns).toBe(1);
  });

  it("replaces an ordinary prompt result with later authoritative usage for the same turn", async () => {
    const { service: activity } = await service();
    const base = turn({ turnId: "corrected-turn", usage: { ...usage(10, 1)!, source: "prompt-result" } });
    await activity.record("s1", base);
    await activity.record("s1", {
      ...base,
      usage: { ...usage(25, 5)!, cachedReadTokens: 20, source: "acp-turn" },
    });

    const report = await activity.report();
    expect(report.windows.today).toMatchObject({
      turns: 1,
      turnsWithUsage: 1,
      inputTokens: 25,
      outputTokens: 5,
      cachedReadTokens: 20,
      totalTokens: 30,
    });
    expect(report.days.at(-1)).toMatchObject({ turns: 1, turnsWithUsage: 1, totalTokens: 30 });
  });

  it("upgrades an unmeasured ordinary result when authoritative usage arrives", async () => {
    const { service: activity } = await service();
    const base = turn({ turnId: "late-usage" });
    await activity.record("s1", base);
    await activity.record("s1", { ...base, usage: usage(40, 4) });
    expect((await activity.report()).windows.today).toMatchObject({ turns: 1, turnsWithUsage: 1, totalTokens: 44 });
  });

  it("does not lose concurrent turns or their anonymous rollup", async () => {
    const { service: activity } = await service();
    await Promise.all([
      activity.record("s1", turn({ turnId: "concurrent-a", usage: usage(10, 1) })),
      activity.record("s2", turn({ turnId: "concurrent-b", usage: usage(20, 2) })),
    ]);
    const report = await activity.report();
    expect(report.windows.today).toMatchObject({ turns: 2, turnsWithUsage: 2, totalTokens: 33 });
    expect(report.days.at(-1)).toMatchObject({ turns: 2, turnsWithUsage: 2, totalTokens: 33 });
  });

  it("separates rolling windows from calendar windows", async () => {
    const { service: activity } = await service(NOW, "UTC");
    // 20 hours ago: inside rolling 24h, but on the previous calendar day.
    await activity.record("s1", turn({ at: "2026-07-25T16:00:00.000Z", usage: usage(7, 3) }));
    await activity.record("s1", turn({ at: NOW.toISOString(), usage: usage(1, 1) }));
    const report = await activity.report();
    expect(report.windows.rolling24h.totalTokens).toBe(12);
    expect(report.windows.today.totalTokens).toBe(2);
    expect(report.windows.month.totalTokens).toBe(12);
  });

  it("keeps the anonymous daily rollup after per-turn detail is forgotten with the session", async () => {
    const { service: activity } = await service();
    await activity.record("s1", turn({ usage: usage(100, 20) }));
    await activity.forgetSession("s1");
    const report = await activity.report();
    // Detail is gone…
    expect(report.windows.today.turns).toBe(0);
    // …but the day still records that the work happened.
    expect(report.days.at(-1)).toMatchObject({ day: "2026-07-26", turns: 1, totalTokens: 120 });
  });

  it("removes several sessions in one transaction without losing a concurrent turn", async () => {
    const { service: activity } = await service();
    await activity.record("s1", turn({ turnId: "old-a", usage: usage(10, 1) }));
    await activity.record("s2", turn({ turnId: "old-b", usage: usage(20, 2) }));
    await Promise.all([
      activity.forgetSessions(["s1", "s2"]),
      activity.record("s3", turn({ turnId: "new-c", usage: usage(30, 3) })),
    ]);
    expect((await activity.report()).windows.today).toMatchObject({ turns: 1, totalTokens: 33 });
  });

  it("emits a full 53-week day series including empty days", async () => {
    const { service: activity } = await service();
    await activity.record("s1", turn({ usage: usage(5, 5) }));
    const days = (await activity.report()).days;
    expect(days).toHaveLength(371);
    expect(days.at(-1)?.day).toBe("2026-07-26");
    expect(days.filter((bucket) => bucket.totalTokens > 0)).toHaveLength(1);
  });

  it("filters by model without leaking other models into the totals", async () => {
    const { service: activity } = await service();
    await activity.record("s1", turn({ usage: { ...usage(10, 1)!, modelId: "a" } }));
    await activity.record("s1", turn({ usage: { ...usage(90, 9)!, modelId: "b" } }));
    expect((await activity.report({ modelId: "a" })).windows.today.totalTokens).toBe(11);
    expect((await activity.report({ modelId: "a" })).days.at(-1)).toMatchObject({ totalTokens: 11, source: "turn-details" });
    expect((await activity.report()).models).toEqual(["a", "b"]);
  });

  it("uses the selected local timezone for the day boundary", async () => {
    const now = new Date("2026-07-26T16:30:00.000Z"); // 00:30 on July 27 in Beijing.
    const { service: activity } = await service(now, "Asia/Shanghai");
    await activity.record("s1", turn({ turnId: "before-local-midnight", at: "2026-07-26T15:50:00.000Z", usage: usage(3, 1) }));
    await activity.record("s1", turn({ turnId: "after-local-midnight", at: "2026-07-26T16:10:00.000Z", usage: usage(7, 2) }));
    const report = await activity.report();
    expect(report.timeZone).toBe("Asia/Shanghai");
    expect(report.windows.today.totalTokens).toBe(9);
    expect(report.days.at(-1)).toMatchObject({ day: "2026-07-27", totalTokens: 9 });
    expect(report.days.at(-2)).toMatchObject({ day: "2026-07-26", totalTokens: 4 });
  });

  it("keeps legacy UTC aggregates marked and excludes anonymous totals from filters", async () => {
    const { service: activity, root } = await service();
    await writeFile(join(root, "token-activity.json"), JSON.stringify({
      turns: [{ at: "2026-07-26T02:00:00.000Z", sessionId: "live", turnId: "old-live", modelId: "m", hasUsage: true, inputTokens: 10, outputTokens: 1, reasoningTokens: 5 }],
      days: { "2026-07-26": { day: "2026-07-26", turns: 2, turnsWithUsage: 2, inputTokens: 30, outputTokens: 8, totalTokens: 36 } },
    }), "utf8");
    const all = await activity.report();
    expect(all.days.at(-1)).toMatchObject({ source: "mixed", turns: 2, totalTokens: 20 });
    const filtered = await activity.report({ modelId: "m" });
    expect(filtered.anonymousExcludedByFilter).toBe(true);
    expect(filtered.days.at(-1)).toMatchObject({ source: "turn-details", turns: 1, totalTokens: 0 });
    expect(filtered.sources).toEqual([]);
  });

  it("survives a restart", async () => {
    const { service: activity, root } = await service();
    await activity.record("s1", turn({ usage: usage(42, 8) }));
    const reopened = new TokenActivityService(root, () => NOW);
    expect((await reopened.report()).windows.today.totalTokens).toBe(50);
  });
});
