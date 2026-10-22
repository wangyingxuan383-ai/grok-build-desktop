import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GrokQuotaSnapshot } from "../../shared/types";
import { quotaWarning, QuotaWarningService } from "./quota-warning-service";
const now = Date.now();
const sample = (): GrokQuotaSnapshot => ({ supported: true, accountId: "account-test", fetchedAt: new Date(now).toISOString(), stale: false, partial: false, diagnostics: [], currentAllowance: { label: "本期额度", unit: "percent", used: 91, resetAt: new Date(now + 86400000).toISOString(), source: "cli-extension", periodType: "weekly" } });
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { force: true, recursive: true }))); });
describe("quota warnings", () => {
  it("uses fresh explicitly reported allowance data only", () => {
    expect(quotaWarning(sample(), 90, now)?.detail).toContain("91%");
    expect(quotaWarning(sample(), 0, now)).toBeUndefined();
    expect(quotaWarning({ ...sample(), stale: true }, 90, now)).toBeUndefined();
    expect(quotaWarning({ ...sample(), fetchedAt: new Date(now - 660000).toISOString() }, 90, now)).toBeUndefined();
    for (const patch of [{ used: undefined }, { resetAt: undefined }, { used: 190 }, { source: "billing-api" as const }]) expect(quotaWarning({ ...sample(), currentAllowance: { ...sample().currentAllowance!, ...patch } }, 90, now)).toBeUndefined();
  });
  it("deduplicates concurrent reads, restarts and separates accounts and periods", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quota-warning-")); dirs.push(dir);
    const service = new QuotaWarningService(dir), publish = vi.fn().mockResolvedValue(undefined);
    await Promise.all([service.observe(sample(), 90, publish), service.observe(sample(), 90, publish)]);
    await new QuotaWarningService(dir).observe(sample(), 90, publish);
    expect(publish).toHaveBeenCalledTimes(1);
    await service.observe({ ...sample(), accountId: "different" }, 90, publish);
    expect(publish).toHaveBeenCalledTimes(2);
  });
  it("allows retry after publishing failed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quota-warning-")); dirs.push(dir);
    const service = new QuotaWarningService(dir), publish = vi.fn().mockRejectedValueOnce(Error("disk")).mockResolvedValue(undefined);
    await expect(service.observe(sample(), 90, publish)).rejects.toThrow("disk");
    await service.observe(sample(), 90, publish);
    expect(publish).toHaveBeenCalledTimes(2);
  });
});
