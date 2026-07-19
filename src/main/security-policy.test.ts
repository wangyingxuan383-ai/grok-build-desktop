import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createRendererTrustPolicy,
  isAllowedExternalUrl,
  isTrustedRendererFrame,
  isTrustedRendererUrl,
  trustedDevelopmentUrl,
} from "./security-policy";

describe("Electron renderer trust policy", () => {
  const localEntry = resolve("out/renderer/index.html");
  const localUrl = pathToFileURL(localEntry).href;

  it("accepts loopback development URLs only outside packaged builds", () => {
    expect(trustedDevelopmentUrl("http://localhost:5173/app", false)).toBe("http://localhost:5173/app");
    expect(trustedDevelopmentUrl("https://127.0.0.1:5173", false)).toBe("https://127.0.0.1:5173/");
    expect(trustedDevelopmentUrl("http://[::1]:5173", false)).toBe("http://[::1]:5173/");
    expect(trustedDevelopmentUrl("https://example.com", false)).toBeUndefined();
    expect(trustedDevelopmentUrl("http://localhost.evil.test:5173", false)).toBeUndefined();
    expect(trustedDevelopmentUrl("http://user:pass@localhost:5173", false)).toBeUndefined();
    expect(trustedDevelopmentUrl("http://localhost:5173", true)).toBeUndefined();
  });

  it("allows only the exact local entry or configured development origin", () => {
    const production = createRendererTrustPolicy(localEntry);
    expect(isTrustedRendererUrl(localUrl, production)).toBe(true);
    expect(isTrustedRendererUrl(`${localUrl}#thread`, production)).toBe(true);
    expect(isTrustedRendererUrl(pathToFileURL(resolve("out/renderer/other.html")).href, production)).toBe(false);
    expect(isTrustedRendererUrl("https://example.com", production)).toBe(false);

    const development = createRendererTrustPolicy(localEntry, "http://127.0.0.1:5173/app");
    expect(isTrustedRendererUrl("http://127.0.0.1:5173/", development)).toBe(true);
    expect(isTrustedRendererUrl("http://127.0.0.1:5173/nested?x=1", development)).toBe(true);
    expect(isTrustedRendererUrl("http://127.0.0.1:5174/", development)).toBe(false);
    expect(isTrustedRendererUrl("http://localhost:5173/", development)).toBe(false);
  });

  it("requires the expected webContents and the top-level frame", () => {
    const policy = createRendererTrustPolicy(localEntry);
    const trusted = {
      expectedWebContentsId: 7,
      senderWebContentsId: 7,
      frameProcessId: 10,
      frameRoutingId: 10,
      mainFrameProcessId: 10,
      mainFrameRoutingId: 10,
      frameUrl: localUrl,
    };
    expect(isTrustedRendererFrame(trusted, policy)).toBe(true);
    expect(isTrustedRendererFrame({ ...trusted, senderWebContentsId: 8 }, policy)).toBe(false);
    expect(isTrustedRendererFrame({ ...trusted, frameRoutingId: 11 }, policy)).toBe(false);
    expect(isTrustedRendererFrame({ ...trusted, frameProcessId: 11 }, policy)).toBe(false);
    expect(isTrustedRendererFrame({ ...trusted, frameUrl: "https://example.com" }, policy)).toBe(false);
  });

  it("opens only credential-free HTTP and HTTPS external URLs", () => {
    expect(isAllowedExternalUrl("https://x.ai/path?q=1")).toBe(true);
    expect(isAllowedExternalUrl("http://127.0.0.1:8080")).toBe(true);
    expect(isAllowedExternalUrl("file:///C:/Windows/System32/calc.exe")).toBe(false);
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedExternalUrl("ms-settings:privacy")).toBe(false);
    expect(isAllowedExternalUrl("https://user:pass@example.com")).toBe(false);
  });
});
