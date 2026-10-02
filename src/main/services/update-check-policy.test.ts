import { describe, expect, it, vi } from "vitest";
import { AUTOMATIC_UPDATE_INTERVAL_MS, AutomaticUpdateChecker, automaticUpdateCheckDecision } from "./update-check-policy";

describe("automatic update check policy", () => {
  const now = Date.parse("2026-08-10T00:00:00.000Z");

  it("honors the user's disabled toggle", () => {
    expect(automaticUpdateCheckDecision({ automaticUpdateChecks: false }, now)).toEqual({ shouldCheck: false, reason: "disabled" });
  });

  it("throttles checks until a full 24-hour interval has elapsed", () => {
    const checkedAt = new Date(now - AUTOMATIC_UPDATE_INTERVAL_MS + 1).toISOString();
    expect(automaticUpdateCheckDecision({ automaticUpdateChecks: true, lastAutomaticUpdateCheckAt: checkedAt }, now)).toEqual({
      shouldCheck: false,
      reason: "throttled",
      checkedAt,
      nextCheckAt: new Date(Date.parse(checkedAt) + AUTOMATIC_UPDATE_INTERVAL_MS).toISOString(),
    });
  });

  it("checks on first run and once the interval is due", () => {
    expect(automaticUpdateCheckDecision({ automaticUpdateChecks: true }, now)).toMatchObject({ shouldCheck: true, reason: "due" });
    expect(automaticUpdateCheckDecision({ automaticUpdateChecks: true, lastAutomaticUpdateCheckAt: new Date(now - AUTOMATIC_UPDATE_INTERVAL_MS).toISOString() }, now))
      .toMatchObject({ shouldCheck: true, reason: "due" });
  });

  it("checks every new app launch even if another launch checked today, but honors disabled", () => {
    const settings = { lastAutomaticUpdateCheckAt: new Date(now).toISOString() };
    expect(automaticUpdateCheckDecision(settings, now, true).shouldCheck).toBe(true);
    expect(automaticUpdateCheckDecision({ ...settings, automaticUpdateChecks: false }, now, true).shouldCheck).toBe(false);
  });

  it("shares simultaneous IPC checks, retains badges on reload and checks again after one day", async () => {
    let clock = now;
    let checkedAt = new Date(now).toISOString();
    const cli = vi.fn(async () => ({ found: true, updateAvailable: true, latestVersion: "1.0.41" }));
    const app = vi.fn(async () => ({ configured: true, currentVersion: "0.10.4", updateAvailable: false, checkedAt }));
    const runtime = { settings: async () => ({ lastAutomaticUpdateCheckAt: checkedAt }), cli, app,
      currentVersion: "0.10.4", now: () => clock, record: async (at: string) => { checkedAt = at; } };
    const checker = new AutomaticUpdateChecker(runtime);
    await Promise.all([checker.check(), checker.check()]);
    expect(cli).toHaveBeenCalledTimes(1);
    expect(app).toHaveBeenCalledTimes(1);
    expect(await checker.check()).toMatchObject({ checked: false, reason: "throttled", cli: { updateAvailable: true } });
    clock += AUTOMATIC_UPDATE_INTERVAL_MS;
    expect(await checker.check()).toMatchObject({ checked: true });
    expect(cli).toHaveBeenCalledTimes(2);
    await new AutomaticUpdateChecker(runtime).check();
    expect(cli).toHaveBeenCalledTimes(3);
  });

  it("isolates an unavailable CLI from the app result and does no work while disabled", async () => {
    const cli = vi.fn(async () => { throw Error("CLI unavailable"); });
    const app = vi.fn(async () => ({ configured: true, currentVersion: "0.10.4", latestVersion: "0.11.0", updateAvailable: true, checkedAt: new Date(now).toISOString() }));
    let enabled = false;
    const checker = new AutomaticUpdateChecker({ settings: async () => ({ automaticUpdateChecks: enabled }), cli, app, currentVersion: "0.10.4", record: vi.fn() });
    expect(await checker.check()).toEqual({ checked: false, reason: "disabled" });
    expect(cli).not.toHaveBeenCalled();
    enabled = true;
    expect(await checker.check()).toMatchObject({ checked: true, cli: { error: "CLI unavailable" }, app: { updateAvailable: true } });
  });
});
