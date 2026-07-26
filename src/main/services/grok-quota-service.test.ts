import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GrokQuotaService, parseMonthly, parseRolling24hQuota, parseWeekly } from "./grok-quota-service";
import { LogService } from "./log-service";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

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

  it("keeps a rolling 24-hour token limit separate from billing windows", () => {
    expect(parseRolling24hQuota("rolling 24-hour window — tokens actual/limit: 1,056,458/1,000,000", "grok-free")).toMatchObject({
      label: "滚动 24 小时 Token", used: 1_056_458, limit: 1_000_000, remaining: 0, unit: "tokens", source: "cli-error", modelId: "grok-free",
    });
    expect(parseRolling24hQuota("monthly actual/limit: 10/20")).toBeUndefined();
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

  it("never rejects when the vault is unavailable, so the error event it rides along with still reaches the user", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-quota-degrade-")); roots.push(root);
    const brokenVault = { active: async () => { throw new Error("credential vault is locked"); } } as never;
    const service = new GrokQuotaService(
      brokenVault,
      settings,
      async () => "0.1.101",
      new LogService(join(root, "logs", "app.log")),
      async () => ({ config: {} }),
      async () => auth(),
      join(root, "quota.json"),
    );

    await expect(service.captureError("rolling 24-hour window, actual/limit: 125/1000 tokens", "grok-free"))
      .resolves.toMatchObject({ used: 125, limit: 1000, unit: "tokens" });
  });

  it("persists rolling 24-hour CLI limits across service restarts", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-quota-store-")); roots.push(root);
    const path = join(root, "quota.json");
    const requester = async (url: string) => url.includes("format=credits")
      ? { config: { creditUsagePercent: 5 } }
      : { config: { monthlyLimit: { val: 100 }, used: { val: 5 } } };
    const first = new GrokQuotaService(vault, settings, async () => "0.1.101", {} as never, requester, async () => auth(), path);
    await first.captureError("rolling 24-hour window, actual/limit: 125/1000 tokens", "grok-free");
    const second = new GrokQuotaService(vault, settings, async () => "0.1.101", {} as never, requester, async () => auth(), path);

    expect((await second.get(true)).rolling24h).toMatchObject({
      used: 125,
      limit: 1000,
      modelId: "grok-free",
      expired: false,
    });
  });

  it("marks persisted rolling limits expired instead of presenting them as current", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-quota-expired-")); roots.push(root);
    const path = join(root, "quota.json");
    await writeFile(path, JSON.stringify({ rolling24h: {
      "oauth-TestUser": {
        label: "滚动 24 小时 Token",
        used: 1000,
        limit: 1000,
        remaining: 0,
        unit: "tokens",
        source: "cli-error",
        observedAt: "2026-01-01T00:00:00.000Z",
      },
    } }));
    const requester = async (url: string) => url.includes("format=credits")
      ? { config: { creditUsagePercent: 5 } }
      : { config: { monthlyLimit: { val: 100 }, used: { val: 5 } } };
    const service = new GrokQuotaService(vault, settings, async () => "0.1.101", {} as never, requester, async () => auth(), path);

    expect((await service.get(true)).rolling24h?.expired).toBe(true);
  });

  it("keeps the persisted rolling window visible when both billing endpoints are offline", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-quota-offline-")); roots.push(root);
    const path = join(root, "quota.json");
    const first = new GrokQuotaService(
      vault,
      settings,
      async () => "0.1.101",
      {} as never,
      async () => { throw new Error("HTTP 503"); },
      async () => auth(),
      path,
    );
    await first.captureError("rolling 24-hour window, actual/limit: 125/1000 tokens", "grok-free");

    const second = new GrokQuotaService(
      vault,
      settings,
      async () => "0.1.101",
      {} as never,
      async () => { throw new Error("HTTP 503"); },
      async () => auth(),
      path,
    );

    expect((await second.get(true)).rolling24h).toMatchObject({
      used: 125,
      limit: 1000,
      source: "cli-error",
    });
  });
});
