import { session } from "electron";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AppSettings, GrokQuotaSnapshot, QuotaWindow } from "../../shared/types";
import type { AccountVault } from "./account-vault";
import type { LogService } from "./log-service";

const WEEKLY_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const MONTHLY_URL = "https://cli-chat-proxy.grok.com/v1/billing";

type BillingPayload = { config?: Record<string, unknown> };
type QuotaRequester = (url: string, headers: Record<string, string>, proxy: string) => Promise<BillingPayload>;

export class GrokQuotaService {
  private cache = new Map<string, GrokQuotaSnapshot>();

  constructor(
    private readonly vault: AccountVault,
    private readonly getSettings: () => Promise<AppSettings>,
    private readonly getCliVersion: () => Promise<string>,
    private readonly log: LogService,
    private readonly requester: QuotaRequester = electronRequest,
    private readonly readCurrentAuth: () => Promise<string> = () => readFile(join(homedir(), ".grok", "auth.json"), "utf8"),
  ) {}

  async get(force = false): Promise<GrokQuotaSnapshot> {
    const active = await this.vault.active();
    if (!active) return unsupported("尚未登录 Grok 账号");
    if (active.profile.kind !== "oauth" || !active.payload.authJson) return { ...unsupported("API Key 配置档不支持订阅额度查询"), accountId: active.profile.id };
    const cached = this.cache.get(active.profile.id);
    if (!force && cached && Date.now() - Date.parse(cached.fetchedAt) < 5 * 60_000) return structuredClone(cached);

    const currentAuth = await this.readCurrentAuth().catch(() => active.payload.authJson!);
    const credential = parseOAuthCredential(currentAuth) ?? parseOAuthCredential(active.payload.authJson);
    if (!credential) return { ...unsupported("OAuth 凭据缺少访问令牌或用户 ID"), accountId: active.profile.id };
    const settings = await this.getSettings();
    const proxy = settings.httpsProxy || settings.httpProxy;
    const cliVersion = await this.getCliVersion().catch(() => "unknown");
    const headers = {
      Authorization: `Bearer ${credential.token}`,
      "x-userid": credential.userId,
      "x-xai-token-auth": "xai-grok-cli",
      "x-grok-client-version": cliVersion,
      "user-agent": `grok-cli/${cliVersion} (${process.platform}; ${process.arch})`,
      Accept: "application/json",
    };

    const [weeklyResult, monthlyResult] = await Promise.allSettled([
      this.requestWith401Retry(WEEKLY_URL, headers, proxy),
      this.requestWith401Retry(MONTHLY_URL, headers, proxy),
    ]);
    const diagnostics: string[] = [];
    if (weeklyResult.status === "rejected") diagnostics.push(classifyError("周额度", weeklyResult.reason));
    if (monthlyResult.status === "rejected") diagnostics.push(classifyError("月度额度", monthlyResult.reason));
    const weekly = weeklyResult.status === "fulfilled" ? parseWeekly(weeklyResult.value) : undefined;
    const monthlyParsed = monthlyResult.status === "fulfilled" ? parseMonthly(monthlyResult.value) : {};
    if (weekly && weekly.used === undefined) diagnostics.push("周额度接口未返回使用率；仍显示本周周期与重置时间。");

    const previous = this.cache.get(active.profile.id);
    const bothFailed = weeklyResult.status === "rejected" && monthlyResult.status === "rejected";
    if (bothFailed && previous) {
      const stale = { ...previous, stale: true, partial: true, diagnostics, fetchedAt: previous.fetchedAt };
      this.cache.set(active.profile.id, stale);
      return structuredClone(stale);
    }
    if (bothFailed) {
      const failed: GrokQuotaSnapshot = { accountId: active.profile.id, supported: true, fetchedAt: new Date().toISOString(), stale: false, partial: true, diagnostics };
      return failed;
    }

    const snapshot: GrokQuotaSnapshot = {
      accountId: active.profile.id,
      supported: true,
      fetchedAt: new Date().toISOString(),
      stale: false,
      partial: weeklyResult.status === "rejected" || monthlyResult.status === "rejected",
      weekly: weekly ?? (weeklyResult.status === "rejected" ? previous?.weekly : undefined),
      monthly: monthlyParsed.monthly ?? (monthlyResult.status === "rejected" ? previous?.monthly : undefined),
      onDemand: monthlyParsed.onDemand ?? (monthlyResult.status === "rejected" ? previous?.onDemand : undefined),
      prepaidBalance: weeklyResult.status === "fulfilled" ? moneyValue(weeklyResult.value.config?.prepaidBalance) : previous?.prepaidBalance,
      diagnostics,
    };
    this.cache.set(active.profile.id, snapshot);
    return structuredClone(snapshot);
  }

  clear(): void { this.cache.clear(); }

  private async requestWith401Retry(url: string, headers: Record<string, string>, proxy: string): Promise<BillingPayload> {
    try { return await this.requester(url, headers, proxy); }
    catch (error) {
      if (!/HTTP 401/.test(error instanceof Error ? error.message : String(error))) throw error;
      const refreshed = parseOAuthCredential(await this.readCurrentAuth());
      if (!refreshed) throw error;
      return this.requester(url, { ...headers, Authorization: `Bearer ${refreshed.token}`, "x-userid": refreshed.userId }, proxy);
    }
  }
}

export function parseWeekly(payload: BillingPayload): QuotaWindow | undefined {
  const config = payload.config;
  if (!config) return undefined;
  const period = record(config.currentPeriod) ?? {};
  const percent = numberValue(config.creditUsagePercent ?? config.credit_usage_percent);
  const start = stringValue(period.start ?? config.billingPeriodStart ?? config.billing_period_start);
  const end = stringValue(period.end ?? config.billingPeriodEnd ?? config.billing_period_end);
  const productUsage = Array.isArray(config.productUsage ?? config.product_usage) ? (config.productUsage ?? config.product_usage) as unknown[] : [];
  const products = productUsage.map((item, index) => ({ label: stringValue(record(item)?.product) || `产品 ${index + 1}`, usedPercent: numberValue(record(item)?.usagePercent ?? record(item)?.usage_percent) }));
  const productPercent = products.map((item) => item.usedPercent).filter((value): value is number => value !== undefined);
  const used = percent ?? (productPercent.length ? Math.max(...productPercent) : undefined);
  if (used === undefined && !start && !end) return undefined;
  return { label: "周额度", used, limit: used === undefined ? undefined : 100, remaining: used === undefined ? undefined : Math.max(0, 100 - used), unit: "percent", periodStart: start, periodEnd: end, resetAt: end, products };
}

export function parseMonthly(payload: BillingPayload): { monthly?: QuotaWindow; onDemand?: QuotaWindow } {
  const config = payload.config;
  if (!config) return {};
  const limitCents = moneyValue(config.monthlyLimit ?? config.monthly_limit);
  const usedCents = moneyValue(config.used);
  const onDemandCap = moneyValue(config.onDemandCap ?? config.on_demand_cap);
  const explicitOnDemand = moneyValue(config.onDemandUsed ?? config.on_demand_used);
  const includedUsed = usedCents === undefined ? undefined : limitCents !== undefined ? Math.min(usedCents, limitCents) : usedCents;
  const onDemandUsed = explicitOnDemand ?? (usedCents !== undefined && limitCents !== undefined ? Math.max(0, usedCents - limitCents) : undefined);
  const start = stringValue(config.billingPeriodStart ?? config.billing_period_start);
  const end = stringValue(config.billingPeriodEnd ?? config.billing_period_end);
  const monthly = limitCents === undefined && usedCents === undefined ? undefined : {
    label: "月度赠送额度", used: includedUsed, limit: limitCents,
    remaining: limitCents === undefined || includedUsed === undefined ? undefined : Math.max(0, limitCents - includedUsed),
    unit: "credits" as const, periodStart: start, periodEnd: end, resetAt: end,
  };
  const onDemand = onDemandCap === undefined && onDemandUsed === undefined ? undefined : {
    label: "按量付费", used: onDemandUsed, limit: onDemandCap,
    remaining: onDemandCap === undefined || onDemandUsed === undefined ? undefined : Math.max(0, onDemandCap - onDemandUsed),
    unit: "credits" as const, periodStart: start, periodEnd: end, resetAt: end,
  };
  return { monthly, onDemand };
}

function parseOAuthCredential(raw: string): { token: string; userId: string } | undefined {
  try {
    const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    const value = Object.values(parsed)[0];
    const token = stringValue(value?.key ?? value?.access_token);
    const userId = stringValue(value?.user_id ?? value?.principal_id);
    return token && userId ? { token, userId } : undefined;
  } catch { return undefined; }
}

async function electronRequest(url: string, headers: Record<string, string>, proxy: string): Promise<BillingPayload> {
  const partition = session.fromPartition("grok-quota", { cache: false });
  await partition.setProxy(proxy ? { proxyRules: proxy } : { mode: "system" });
  const response = await partition.fetch(url, { method: "GET", headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 240)}`);
  return JSON.parse(text) as BillingPayload;
}

function unsupported(message: string): GrokQuotaSnapshot {
  return { supported: false, fetchedAt: new Date().toISOString(), stale: false, partial: false, diagnostics: [message] };
}

function classifyError(label: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/HTTP 401/.test(message)) return `${label}：登录已失效（401），请重新登录。`;
  if (/HTTP 403/.test(message)) return `${label}：当前账号无权访问额度接口（403）。`;
  if (/timeout|timed out|ERR_TIMED_OUT/i.test(message)) return `${label}：请求超时，请检查代理。`;
  return `${label}：${message.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").slice(0, 300)}`;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function numberValue(value: unknown): number | undefined {
  const nested = record(value)?.val;
  const number = Number(nested ?? value);
  return Number.isFinite(number) ? number : undefined;
}
function moneyValue(value: unknown): number | undefined { return numberValue(value); }
function stringValue(value: unknown): string | undefined { return typeof value === "string" && value ? value : undefined; }

export { WEEKLY_URL, MONTHLY_URL };
