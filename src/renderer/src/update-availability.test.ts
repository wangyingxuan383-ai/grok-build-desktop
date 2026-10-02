import { describe, expect, it } from "vitest";
import { updateAvailability } from "./update-availability";

describe("update indicators", () => {
  const cli = { found: true, updateAvailable: true, latestVersion: "1.0.41" };
  const app = { configured: true, currentVersion: "0.10.4", updateAvailable: true, latestVersion: "0.11.0", checkedAt: "2026-10-02T00:00:00Z" };
  it("includes both confirmed updates and honors the disabled preference", () => {
    expect(updateAvailability(cli, app)).toEqual(["桌面 0.11.0", "Grok CLI 1.0.41"]);
    expect(updateAvailability(cli, app, false)).toEqual([]);
  });
  it("never treats errors, a missing CLI or incomplete metadata as an update", () => {
    expect(updateAvailability({ ...cli, error: "network failed" }, { ...app, error: "limited" })).toEqual([]);
    expect(updateAvailability({ ...cli, found: false }, { ...app, latestVersion: undefined })).toEqual([]);
    expect(updateAvailability(undefined, { ...app, updateAvailable: false, currentAhead: true })).toEqual([]);
  });
});
