import type { AppSettings, AutomaticUpdateCheckResult, AppReleaseStatus, CliVersionStatus } from "../../shared/types";

export const AUTOMATIC_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1_000;

export type AutomaticUpdateCheckDecision =
  | { shouldCheck: false; reason: "disabled" }
  | { shouldCheck: false; reason: "throttled"; checkedAt: string; nextCheckAt: string }
  | { shouldCheck: true; reason: "due"; nextCheckAt: string };

/** Pure policy shared by startup and tests. Network checks remain explicit in
 * Each app launch checks once; the interval applies while it stays open. */
export function automaticUpdateCheckDecision(
  settings: Pick<AppSettings, "automaticUpdateChecks" | "lastAutomaticUpdateCheckAt">,
  now = Date.now(),
  startup = false,
): AutomaticUpdateCheckDecision {
  if (settings.automaticUpdateChecks === false) return { shouldCheck: false, reason: "disabled" };
  const last = settings.lastAutomaticUpdateCheckAt ? Date.parse(settings.lastAutomaticUpdateCheckAt) : Number.NaN;
  if (!startup && Number.isFinite(last) && now - last < AUTOMATIC_UPDATE_INTERVAL_MS) {
    return {
      shouldCheck: false,
      reason: "throttled",
      checkedAt: settings.lastAutomaticUpdateCheckAt!,
      nextCheckAt: new Date(last + AUTOMATIC_UPDATE_INTERVAL_MS).toISOString(),
    };
  }
  return { shouldCheck: true, reason: "due", nextCheckAt: new Date(now + AUTOMATIC_UPDATE_INTERVAL_MS).toISOString() };
}

/** One owner per Desktop process: Renderer reloads and repeated IPC share a check. */
export class AutomaticUpdateChecker {
  private checkedThisLaunch = false;
  private flight?: Promise<AutomaticUpdateCheckResult>;
  private lastResult?: AutomaticUpdateCheckResult;
  constructor(private readonly runtime: {
    settings(): Promise<Pick<AppSettings, "automaticUpdateChecks" | "lastAutomaticUpdateCheckAt">>;
    cli(): Promise<CliVersionStatus>;
    app(): Promise<AppReleaseStatus>;
    record(at: string): Promise<unknown>;
    currentVersion: string;
    now?(): number;
  }) {}
  check(): Promise<AutomaticUpdateCheckResult> {
    if (this.flight) return this.flight;
    this.flight = this.checkOnce().finally(() => { this.flight = undefined; });
    return this.flight;
  }
  private async checkOnce(): Promise<AutomaticUpdateCheckResult> {
    const settings = await this.runtime.settings();
    const now = this.runtime.now?.() ?? Date.now();
    const decision = automaticUpdateCheckDecision(settings, now, !this.checkedThisLaunch);
    if (!decision.shouldCheck) return decision.reason === "disabled"
      ? { checked: false, reason: "disabled" }
      : { ...this.lastResult, checked: false, checkedAt: decision.checkedAt, nextCheckAt: decision.nextCheckAt, reason: "throttled" };
    const checkedAt = new Date(now).toISOString();
    const [cli, app] = await Promise.all([
      this.runtime.cli().catch(error => ({ found: false, error: error instanceof Error ? error.message : String(error) })),
      this.runtime.app().catch(error => ({ configured: false, currentVersion: this.runtime.currentVersion, updateAvailable: false, checkedAt, error: error instanceof Error ? error.message : String(error) })),
    ]);
    this.checkedThisLaunch = true;
    await this.runtime.record(checkedAt);
    return this.lastResult = { checked: true, checkedAt, nextCheckAt: decision.nextCheckAt, reason: "checked", cli, app };
  }
}
