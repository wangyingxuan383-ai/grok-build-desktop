import { join } from "node:path";
import { createHash } from "node:crypto";
import type { GrokQuotaSnapshot, QuotaWindow } from "../../shared/types";
import { JsonStore } from "./json-store";

export interface QuotaWarning { key: string; title: string; detail: string }

/** Pure selection: never requests credentials, billing endpoints or estimates a burn rate. */
export function quotaWarning(snapshot: GrokQuotaSnapshot, threshold: number, now = Date.now()): QuotaWarning | undefined {
  if (!threshold || threshold < 1 || threshold > 100 || !snapshot.supported || snapshot.stale || !snapshot.accountId) return;
  const window: QuotaWindow | undefined = snapshot.currentAllowance?.source === "cli-extension" ? snapshot.currentAllowance : snapshot.rolling24h?.source === "cli-error" ? snapshot.rolling24h : undefined;
  if (!window || window.expired) return;
  const end = window.resetAt ?? window.periodEnd;
  if (!end || !Number.isFinite(Date.parse(end)) || Date.parse(end) <= now) return;
  const observed = window.observedAt ?? snapshot.fetchedAt;
  if (!Number.isFinite(Date.parse(observed)) || now - Date.parse(observed) > 10 * 60_000 || Date.parse(observed) > now + 60_000) return;
  let percent: number | undefined;
  if (window.unit === "percent" && Number.isFinite(window.used)) percent = window.used;
  else if (Number.isFinite(window.used) && Number.isFinite(window.limit) && window.limit! > 0) percent = window.used! / window.limit! * 100;
  if (percent === undefined || percent < threshold || percent < 0 || percent > 100) return;
  const key = createHash("sha256").update(JSON.stringify([snapshot.accountId, window.label, window.modelId ?? "", end, threshold])).digest("hex");
  return { key, title: "额度接近上限", detail: `${window.label}已用 ${Math.round(percent)}%。重置时间：${new Date(end).toLocaleString()}。` };
}

/** One warning per account, period and selected threshold, across restarts. */
export class QuotaWarningService {
  private readonly store: JsonStore<{ sent: string[] }>;
  constructor(userData: string) { this.store = new JsonStore(join(userData, "quota-warnings.json"), { sent: [] }); }
  async observe(snapshot: GrokQuotaSnapshot, threshold: number, publish: (warning: QuotaWarning) => Promise<void>): Promise<void> {
    const warning = quotaWarning(snapshot, threshold);
    if (!warning) return;
    let claimed = false;
    await this.store.mutate(data => {
      if (data.sent.includes(warning.key)) return;
      data.sent = [warning.key, ...data.sent].slice(0, 128);
      claimed = true;
    });
    if (!claimed) return;
    try { await publish(warning); }
    catch (error) {
      await this.store.mutate(data => { data.sent = data.sent.filter(key => key !== warning.key); });
      throw error;
    }
  }
}
