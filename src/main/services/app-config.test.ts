import { afterEach, describe, expect, it } from "vitest";
import { createBuildInfo, validateConfig } from "./app-config";

const originalProfile = process.env.APP_BUILD_PROFILE;
afterEach(() => { if (originalProfile === undefined) delete process.env.APP_BUILD_PROFILE; else process.env.APP_BUILD_PROFILE = originalProfile; });

describe("public application configuration", () => {
  it("rejects local CLI overrides in a public build", () => {
    process.env.APP_BUILD_PROFILE = "public";
    expect(() => validateConfig({ channel: "stable", repository: "", allowPrerelease: false, debug: false, mockCliPath: "D:\\Tools\\fake-grok.exe" })).toThrow(/公开构建/);
  });

  it("accepts owner/repository and omits machine paths from BuildInfo", () => {
    process.env.APP_BUILD_PROFILE = "public";
    const config = { channel: "stable", repository: "example/grok-build-desktop", allowPrerelease: false, debug: false, mockCliPath: "" };
    validateConfig(config);
    const build = createBuildInfo(config, "0.4.0", true);
    expect(build).toMatchObject({ productName: "Grok Build Desktop", repository: "example/grok-build-desktop", profile: "public", signed: false, unofficial: true });
    expect(JSON.stringify(build)).not.toMatch(/[A-Z]:\\Users\\/i);
  });

  it("rejects update repositories that are not owner/repository identifiers", () => {
    expect(() => validateConfig({ channel: "stable", repository: "https://example.com/repo", allowPrerelease: false, debug: false, mockCliPath: "" })).toThrow(/owner\/repo/);
  });
});
