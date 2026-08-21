import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { explicitUserDataDirectory, INSTALLED_APP_NAME, SOURCE_PREVIEW_APP_NAME, sourcePreviewIdentity } from "./source-preview-identity";

describe("source preview identity", () => {
  it("leaves packaged/installed identity unchanged", () => {
    expect(sourcePreviewIdentity({ isPackaged: true, appData: "C:\\Users\\wang\\AppData\\Roaming" })).toBeUndefined();
  });

  it("isolates unpackaged runs from the installed AppData folder", () => {
    const preview = sourcePreviewIdentity({ isPackaged: false, appData: "C:\\Users\\wang\\AppData\\Roaming" });
    expect(preview?.name).toBe(SOURCE_PREVIEW_APP_NAME);
    expect(preview?.userData).toBe(join("C:\\Users\\wang\\AppData\\Roaming", SOURCE_PREVIEW_APP_NAME));
    expect(preview?.userData).not.toBe(join("C:\\Users\\wang\\AppData\\Roaming", INSTALLED_APP_NAME));
  });

  it("preserves an explicit smoke profile instead of redirecting fixtures into shared source AppData", () => {
    const explicit = "C:\\Temp\\Grok-Build-Desktop-smoke-fixture";
    expect(explicitUserDataDirectory(["electron.exe", ".", `--user-data-dir=${explicit}`])).toBe(explicit);
    expect(explicitUserDataDirectory(["electron.exe", ".", "--user-data-dir", explicit])).toBe(explicit);
    expect(sourcePreviewIdentity({ isPackaged: false, appData: "C:\\Users\\wang\\AppData\\Roaming", explicitUserData: explicit })?.userData).toBe(explicit);
  });
});
