import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GrokQuotaService, parseAutoTopupRule, parseCurrentAllowance, parsePayAsYouGo, parseRolling24hQuota } from "./grok-quota-service";
import { LogService } from "./log-service";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("Grok quota parsing", () => {
  it("uses the single period returned by billing?format=credits without inventing a monthly allowance", () => {
    const payload = { config: {
      currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", start: "2026-08-10T00:00:00Z", end: "2026-08-17T00:00:00Z" },
      prepaidBalance: { val: 1250 },
      onDemandCap: { val: 5000 },
      onDemandUsed: { val: 1200 },
      isUnifiedBillingUser: true,
    } };
    expect(parseCurrentAllowance(payload)).toMatchObject({
      label: "本期额度（周）", periodType: "weekly", periodStart: "2026-08-10T00:00:00Z", resetAt: "2026-08-17T00:00:00Z", unifiedBilling: true,
    });
    expect(parseCurrentAllowance(payload)?.used).toBeUndefined();
    expect(parsePayAsYouGo(payload)).toMatchObject({ used: 1200, limit: 5000, remaining: 3800 });
  });

  it("uses currentPeriod rather than deprecated monthly_limit/used fields", () => {
    expect(parseCurrentAllowance({ config: {
      credit_usage_percent: 42,
      current_period: { type: "USAGE_PERIOD_TYPE_MONTHLY", start: "2026-08-01", end: "2026-09-01" },
      monthly_limit: { val: 9999 },
      used: { val: 9999 },
    } })).toMatchObject({ used: 42, limit: 100, remaining: 58, periodType: "monthly", resetAt: "2026-09-01" });
  });

  it("keeps a rolling 24-hour token limit separate from billing windows", () => {
    expect(parseRolling24hQuota("rolling 24-hour window — tokens actual/limit: 1,056,458/1,000,000", "grok-free")).toMatchObject({
      label: "滚动 24 小时 Token", used: 1_056_458, limit: 1_000_000, remaining: 0, unit: "tokens", source: "cli-error", modelId: "grok-free",
    });
    expect(parseRolling24hQuota("monthly actual/limit: 10/20")).toBeUndefined();
  });

  it("parses the 1.0.3 auto top-up rule without inventing omitted values", () => {
    expect(parseAutoTopupRule({ rule: { enabled: true, minBeforeHittingSl: { val: 500 }, topupAmount: { val: 2000 }, maxAmountPerMonth: { val: 10000 } } })).toMatchObject({
      enabled: true, minBeforeLimit: 500, topupAmount: 2000, monthlyCap: 10000, source: "cli-extension",
    });
    expect(parseAutoTopupRule({ rule: {} })).toMatchObject({ enabled: false });
    expect(parseAutoTopupRule({ rule: null })).toMatchObject({ enabled: false });
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
      expect(url).toContain("format=credits");
      return { config: { creditUsagePercent: 10, currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY" } } };
    }, async () => auth());
    expect((await service.get()).currentAllowance?.remaining).toBe(90);
    expect((await service.get()).monthly).toBeUndefined();
    await service.get();
    expect(calls).toBe(1);
  });

  it("prefers the live x.ai/billing extension and does not call the HTTP fallback", async () => {
    let httpCalls = 0;
    const service = new GrokQuotaService(vault, settings, async () => "1.0.3", {} as never, async () => {
      httpCalls++;
      throw new Error("HTTP fallback must not be used");
    }, async () => auth(), undefined, async (method) => method === "x.ai/billing"
      ? { config: { creditUsagePercent: 11, currentPeriod: { type: "USAGE_PERIOD_TYPE_MONTHLY" } }, on_demand_enabled: false, subscription_tier: "SuperGrok Heavy" }
      : { rule: { enabled: true, topupAmount: { val: 2500 } } });
    const value = await service.get(true);
    expect(value.partial).toBe(false);
    expect(value.currentAllowance).toMatchObject({ used: 11, periodType: "monthly", source: "cli-extension" });
    expect(value.monthly?.used).toBe(11);
    expect(value.autoTopupRule).toMatchObject({ enabled: true, topupAmount: 2500 });
    expect(value.payAsYouGoEnabled).toBe(false);
    expect(value.subscriptionTier).toBe("SuperGrok Heavy");
    expect(httpCalls).toBe(0);
  });

  it("falls back to billing?format=credits when x.ai/billing is unavailable", async () => {
    let calls = 0;
    const service = new GrokQuotaService(vault, settings, async () => "1.0.3", {} as never, async (url) => {
      calls++;
      expect(url).toContain("format=credits");
      return { config: { currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", start: "2026-08-10", end: "2026-08-17" } } };
    }, async () => auth(), undefined, async () => { throw new Error("Method not found"); });
    const value = await service.get(true);
    expect(value.currentAllowance).toMatchObject({ periodType: "weekly", source: "billing-api", resetAt: "2026-08-17" });
    expect(value.monthly).toBeUndefined();
    expect(value.diagnostics[0]).toContain("CLI 账单扩展");
    expect(calls).toBe(1);
  });

  it("preserves snake-case prepaid balance and records only the observed billing field names", async () => {
    const service = new GrokQuotaService(vault, settings, async () => "1.0.3", {} as never, async () => ({
      config: {
        prepaid_balance: { val: 321 },
        currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY" },
      },
      on_demand_enabled: true,
      subscription_tier: "SuperGrok",
    }), async () => auth());
    const value = await service.get(true);
    expect(value.prepaidBalance).toBe(321);
    expect(value.evidence?.[0]?.fields).toEqual([
      "config.currentPeriod",
      "config.prepaid_balance",
      "on_demand_enabled",
      "subscription_tier",
    ]);
  });

  it("retries a 401 once with the current auth file", async () => {
    const attempts = new Map<string, number>();
    const service = new GrokQuotaService(vault, settings, async () => "0.1.101", {} as never, async (url, headers) => {
      const attempt = (attempts.get(url) ?? 0) + 1; attempts.set(url, attempt);
      if (attempt === 1) throw new Error("HTTP 401");
      expect(headers.Authorization).toBe("Bearer refreshed-test-token");
      return { config: { creditUsagePercent: 5, currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY" } } };
    }, async () => auth("refreshed-test-token"));
    expect((await service.get(true)).partial).toBe(false);
    expect(Array.from(attempts.values())).toEqual([2]);
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
    const requester = async () => ({ config: { creditUsagePercent: 5, currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY" } } });
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
    const requester = async () => ({ config: { creditUsagePercent: 5, currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY" } } });
    const service = new GrokQuotaService(vault, settings, async () => "0.1.101", {} as never, requester, async () => auth(), path);

    expect((await service.get(true)).rolling24h?.expired).toBe(true);
  });

  it("keeps the persisted rolling window visible when the credits endpoint is offline", async () => {
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
