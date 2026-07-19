import { describe, expect, it } from "vitest";
import type { AppSettings } from "../../shared/types";
import { buildCliEnv, isLockedBinaryError, parseVersion } from "./cli-locator";

const settings: AppSettings = {
  cliPath: "",
  httpProxy: "http://127.0.0.1:8080",
  httpsProxy: "http://127.0.0.1:8080",
  defaultModel: "",
  defaultEffort: "high",
  defaultMode: "agent",
  showThinking: true,
  expandToolDetails: false,
  fontScale: 100,
  uiDensity: "balanced",
  recentWorkspaces: [],
  activeWorkspace: "",
};

describe("CLI locator helpers", () => {
  it("parses semantic versions embedded in CLI output", () => {
    expect(parseVersion("0.1.101 (5bc4b5dfad)")).toEqual([0, 1, 101]);
    expect(parseVersion("grok v11.4.8-alpha.1")).toEqual([11, 4, 8]);
    expect(parseVersion("missing")).toBeUndefined();
  });

  it("recognises Windows binary lock errors", () => {
    expect(isLockedBinaryError("Access is denied. (os error 5)")).toBe(true);
    expect(isLockedBinaryError("locked executable")).toBe(true);
    expect(isLockedBinaryError("network timeout")).toBe(false);
  });

  it("overrides proxy and API key without discarding the process environment", () => {
    const env = buildCliEnv(settings, "synthetic-test-key");
    expect(env.HTTP_PROXY).toBe(settings.httpProxy);
    expect(env.HTTPS_PROXY).toBe(settings.httpsProxy);
    expect(env.XAI_API_KEY).toBe("synthetic-test-key");
    expect(env.PATH).toBe(process.env.PATH);
  });
});
