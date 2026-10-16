import type { CliSessionInfo } from "./types";

export function sessionContextDisplay(info?: CliSessionInfo): { percent?: number; used?: number; total?: number } {
  if (!info?.supported) return {};
  const valid = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  const used = valid(info.contextUsedTokens) ? info.contextUsedTokens : undefined;
  const total = valid(info.contextWindowTokens) && info.contextWindowTokens > 0 ? info.contextWindowTokens : undefined;
  const reported = typeof info.contextUsagePercent === "number" && Number.isFinite(info.contextUsagePercent) && info.contextUsagePercent >= 0
    ? info.contextUsagePercent : undefined;
  return { used, total, percent: used !== undefined && total !== undefined ? Math.min(100, used / total * 100) : reported !== undefined ? Math.min(100, reported) : undefined };
}
