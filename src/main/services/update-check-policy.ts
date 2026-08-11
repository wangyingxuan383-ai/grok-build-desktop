import type { AppSettings } from "../../shared/types";

export const AUTOMATIC_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1_000;

export type AutomaticUpdateCheckDecision =
  | { shouldCheck: false; reason: "disabled" }
  | { shouldCheck: false; reason: "throttled"; checkedAt: string; nextCheckAt: string }
  | { shouldCheck: true; reason: "due"; nextCheckAt: string };

/** Pure policy shared by startup and tests. Network checks remain explicit in
 * AppController; this function proves the user toggle and 24-hour throttle. */
export function automaticUpdateCheckDecision(
  settings: Pick<AppSettings, "automaticUpdateChecks" | "lastAutomaticUpdateCheckAt">,
  now = Date.now(),
): AutomaticUpdateCheckDecision {
  if (settings.automaticUpdateChecks === false) return { shouldCheck: false, reason: "disabled" };
  const last = settings.lastAutomaticUpdateCheckAt ? Date.parse(settings.lastAutomaticUpdateCheckAt) : Number.NaN;
  if (Number.isFinite(last) && now - last < AUTOMATIC_UPDATE_INTERVAL_MS) {
    return {
      shouldCheck: false,
      reason: "throttled",
      checkedAt: settings.lastAutomaticUpdateCheckAt!,
      nextCheckAt: new Date(last + AUTOMATIC_UPDATE_INTERVAL_MS).toISOString(),
    };
  }
  return { shouldCheck: true, reason: "due", nextCheckAt: new Date(now + AUTOMATIC_UPDATE_INTERVAL_MS).toISOString() };
}
