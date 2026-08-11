import { describe, expect, it } from "vitest";
import { AUTOMATIC_UPDATE_INTERVAL_MS, automaticUpdateCheckDecision } from "./update-check-policy";

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
});
