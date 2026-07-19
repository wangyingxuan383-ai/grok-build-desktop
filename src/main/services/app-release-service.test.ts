import { describe, expect, it } from "vitest";
import type { BuildInfo } from "../../shared/types";
import { compareVersions, parseGitHubRelease } from "./app-release-service";

const build: BuildInfo = { productName: "Grok Build Desktop", version: "0.4.0", channel: "stable", commit: "test", builtAt: "2026-01-01T00:00:00Z", repository: "owner/repo", profile: "public", packaged: true, signed: false, unofficial: true };

describe("application releases", () => {
  it("parses stable GitHub releases without enabling execution", () => {
    const value = parseGitHubRelease({ tag_name: "v0.5.0", html_url: "https://github.com/owner/repo/releases/tag/v0.5.0", body: "notes" }, build);
    expect(value.updateAvailable).toBe(true);
    expect(value).not.toHaveProperty("downloadUrl");
  });
  it("compares semantic versions", () => {
    expect(compareVersions("0.4.1", "0.4.0")).toBeGreaterThan(0);
    expect(compareVersions("0.4.0", "0.4.0")).toBe(0);
  });
});
