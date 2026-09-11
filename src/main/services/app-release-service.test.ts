import { describe, expect, it, vi } from "vitest";
import type { AppSettings, BuildInfo } from "../../shared/types";
import { AppReleaseService, compareVersions, createAppReleaseFetcher, parseGitHubRelease } from "./app-release-service";
import type { LogService } from "./log-service";

const build: BuildInfo = { productName: "Grok Build Desktop", version: "0.4.0", channel: "stable", commit: "test", builtAt: "2026-01-01T00:00:00Z", repository: "owner/repo", profile: "public", packaged: true, signed: false, unofficial: true };
const network = vi.hoisted(() => ({ setProxy: vi.fn(async () => undefined), fetch: vi.fn(async () => new Response("{}")) }));
vi.mock("electron", () => ({ net: { fetch: vi.fn() }, session: { fromPartition: vi.fn(() => network) } }));

describe("application releases", () => {
  it("routes release requests via current app proxy and returns to system proxy when cleared", async () => {
    const settings = { httpsProxy: "http://127.0.0.1:12345", httpProxy: "http://127.0.0.1:23456" } as AppSettings;
    const fetcher = createAppReleaseFetcher(build, async () => settings);
    const signal = new AbortController().signal;
    await fetcher("https://api.github.com/repos/owner/repo/releases/latest", { signal });
    expect(network.setProxy).toHaveBeenLastCalledWith({ proxyRules: settings.httpsProxy });
    expect(network.fetch).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ signal, redirect: "error" }));
    settings.httpsProxy = "";
    await fetcher("https://api.github.com/repos/owner/repo/releases/latest");
    expect(network.setProxy).toHaveBeenLastCalledWith({ proxyRules: settings.httpProxy });
    settings.httpProxy = "";
    await fetcher("https://api.github.com/repos/owner/repo/releases/latest");
    expect(network.setProxy).toHaveBeenLastCalledWith({ mode: "system" });
  });
  it("classifies rate limiting, offers the official page, and does not cache errors for six hours", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: false, status: 403, headers: { get: (name: string) => name === "x-ratelimit-remaining" ? "0" : null } })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ tag_name: "v0.5.0", html_url: "https://github.com/owner/repo/releases/tag/v0.5.0" }) });
    const service = new AppReleaseService(build, { log: async () => { throw Error("disk full"); } } as unknown as LogService, fetcher);
    expect(await service.check()).toMatchObject({ error: expect.stringContaining("额度或频率受限"), releaseUrl: "https://github.com/owner/repo/releases" });
    expect(await service.check()).toMatchObject({ latestVersion: "0.5.0", updateAvailable: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not label an unclassified 403 as definitely a proxy failure", async () => {
    const service = new AppReleaseService(build, { log: async () => undefined } as unknown as LogService, async () => ({ ok: false, status: 403, json: async () => ({}) }));
    expect((await service.check()).error).toContain("不能仅凭 403 判定原因");
  });
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
