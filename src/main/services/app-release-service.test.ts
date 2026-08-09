import { describe, expect, it, vi } from "vitest";
import type { BuildInfo } from "../../shared/types";
import { AppReleaseService, compareVersions, parseGitHubRelease } from "./app-release-service";
import type { LogService } from "./log-service";

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
  it("reports an unreleased local candidate as ahead of the public release", () => {
    const candidate = { ...build, version: "0.7.3" } satisfies BuildInfo;
    const value = parseGitHubRelease({ tag_name: "v0.6.22", html_url: "https://github.com/owner/repo/releases/tag/v0.6.22" }, candidate);
    expect(value).toMatchObject({ latestVersion: "0.6.22", updateAvailable: false, currentAhead: true });
  });
  it("aborts an update check that never returns headers", async () => {
    const log = { log: vi.fn(async () => undefined) } as unknown as LogService;
    const service = new AppReleaseService(build, log, (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }), 10);
    const result = await service.check(true);
    expect(result.error).toBe("应用更新检查响应超时");
    expect(log.log).toHaveBeenCalled();
  });
  it("rejects oversized release metadata before parsing", async () => {
    const service = new AppReleaseService(build, { log: vi.fn(async () => undefined) } as unknown as LogService, async () => ({
      ok: true, status: 200, json: async () => ({}), text: async () => "x".repeat(2 * 1024 * 1024 + 1),
    }));
    expect((await service.check(true)).error).toContain("2 MiB");
  });
});
