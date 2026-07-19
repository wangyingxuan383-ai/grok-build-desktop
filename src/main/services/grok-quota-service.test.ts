import { describe, expect, it } from "vitest";
import { GrokQuotaService, parseMonthly, parseWeekly } from "./grok-quota-service";

describe("Grok quota parsing", () => {
  it("parses weekly utilization and reset window", () => {
    expect(parseWeekly({ config: { creditUsagePercent: 37.5, currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", start: "2026-07-14T00:00:00Z", end: "2026-07-21T00:00:00Z" } } })).toMatchObject({ used: 37.5, remaining: 62.5, resetAt: "2026-07-21T00:00:00Z" });
  });

  it("derives monthly included and on-demand usage", () => {
    const parsed = parseMonthly({ config: { monthlyLimit: { val: 10_000 }, used: { val: 11_500 }, onDemandCap: { val: 5_000 } } });
    expect(parsed.monthly).toMatchObject({ used: 10_000, limit: 10_000, remaining: 0 });
    expect(parsed.onDemand).toMatchObject({ used: 1_500, limit: 5_000, remaining: 3_500 });
  });

  it("accepts snake-case provider responses", () => {
    expect(parseMonthly({ config: { monthly_limit: { val: 1000 }, used: { val: 150 }, on_demand_cap: { val: 0 } } }).monthly).toMatchObject({ remaining: 850 });
  });
});

describe("Grok quota requests", () => {
  const auth = (token = "synthetic-test-token") => JSON.stringify({ account: { key: token, user_id: "TestUser" } });
  const vault = { active: async () => ({ profile: { id: "oauth-TestUser", kind: "oauth" }, payload: { kind: "oauth", authJson: auth() } }) } as never;
  const settings = async () => ({ httpsProxy: "http://127.0.0.1:8080" }) as never;

  it("caches successful results for five minutes", async () => {
    let calls = 0;
    const service = new GrokQuotaService(vault, settings, async () => "0.1.101", {} as never, async (url) => {
      calls++;
      return url.includes("format=credits") ? { config: { creditUsagePercent: 10 } } : { config: { monthlyLimit: { val: 100 }, used: { val: 10 } } };
    }, async () => auth());
    expect((await service.get()).monthly?.remaining).toBe(90);
    await service.get();
    expect(calls).toBe(2);
  });

  it("returns partial data when one endpoint fails", async () => {
    const service = new GrokQuotaService(vault, settings, async () => "0.1.101", {} as never, async (url) => {
      if (!url.includes("format=credits")) throw new Error("HTTP 503");
      return { config: { creditUsagePercent: 11 } };
    }, async () => auth());
    const value = await service.get(true);
    expect(value.partial).toBe(true);
    expect(value.weekly?.used).toBe(11);
    expect(value.diagnostics[0]).toContain("月度额度");
  });

  it("retries a 401 once with the current auth file", async () => {
    const attempts = new Map<string, number>();
    const service = new GrokQuotaService(vault, settings, async () => "0.1.101", {} as never, async (url, headers) => {
      const attempt = (attempts.get(url) ?? 0) + 1; attempts.set(url, attempt);
      if (attempt === 1) throw new Error("HTTP 401");
      expect(headers.Authorization).toBe("Bearer refreshed-test-token");
      return url.includes("format=credits") ? { config: { creditUsagePercent: 5 } } : { config: { monthlyLimit: { val: 100 }, used: { val: 5 } } };
    }, async () => auth("refreshed-test-token"));
    expect((await service.get(true)).partial).toBe(false);
    expect(Array.from(attempts.values())).toEqual([2, 2]);
  });
});
