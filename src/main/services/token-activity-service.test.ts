import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TurnPresentation } from "../../shared/types";
import { TokenActivityService } from "./token-activity-service";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const NOW = new Date("2026-07-26T12:00:00.000Z");
async function service(now = NOW): Promise<{ service: TokenActivityService; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "token-activity-")); roots.push(root);
  return { service: new TokenActivityService(root, () => now), root };
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
  it("sums only what was actually reported", async () => {
    const { service: activity } = await service();
    await activity.record("s1", turn({ usage: usage(100, 20) }));
    await activity.record("s1", turn({ usage: usage(50, 5) }));
    const report = await activity.report();
    expect(report.windows.today).toMatchObject({ turns: 2, turnsWithUsage: 2, inputTokens: 150, outputTokens: 25, totalTokens: 175 });
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

  it("separates rolling windows from calendar windows", async () => {
    const { service: activity } = await service();
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

  it("emits a full 53-week day series including empty days", async () => {
    const { service: activity } = await service();
    await activity.record("s1", turn({ usage: usage(5, 5) }));
    const days = (await activity.report()).days;
    expect(days).toHaveLength(372);
    expect(days.at(-1)?.day).toBe("2026-07-26");
    expect(days.filter((bucket) => bucket.totalTokens > 0)).toHaveLength(1);
  });

  it("filters by model without leaking other models into the totals", async () => {
    const { service: activity } = await service();
    await activity.record("s1", turn({ usage: { ...usage(10, 1)!, modelId: "a" } }));
    await activity.record("s1", turn({ usage: { ...usage(90, 9)!, modelId: "b" } }));
    expect((await activity.report({ modelId: "a" })).windows.today.totalTokens).toBe(11);
    expect((await activity.report()).models).toEqual(["a", "b"]);
  });

  it("survives a restart", async () => {
    const { service: activity, root } = await service();
    await activity.record("s1", turn({ usage: usage(42, 8) }));
    const reopened = new TokenActivityService(root, () => NOW);
    expect((await reopened.report()).windows.today.totalTokens).toBe(50);
  });
});
