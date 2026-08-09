import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { AppSettings } from "../../shared/types";
import { buildCliEnv, isLockedBinaryError, isMajorUpgrade, parseVersion, validateGrokCliExecutable } from "./cli-locator";
import { DEFAULT_THEME } from "./theme-service";

const settings: AppSettings = {
  theme: DEFAULT_THEME,
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

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(name: string): Promise<string> {
  const root = join(tmpdir(), `grok-cli-trust-${randomUUID()}`);
  roots.push(root);
  await mkdir(root, { recursive: true });
  const path = join(root, name);
  await writeFile(path, "fixture", "utf8");
  return path;
}

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

  it("distinguishes a stable channel major upgrade from a normal patch update", () => {
    expect(isMajorUpgrade("0.2.118", "1.0.0")).toBe(true);
    expect(isMajorUpgrade("1.0.0", "1.0.1")).toBe(false);
    expect(isMajorUpgrade(undefined, "1.0.0")).toBe(false);
  });

  it("overrides proxy and API key without discarding the process environment", () => {
    const env = buildCliEnv(settings, "synthetic-test-key");
    expect(env.HTTP_PROXY).toBe(settings.httpProxy);
    expect(env.HTTPS_PROXY).toBe(settings.httpsProxy);
    expect(env.XAI_API_KEY).toBe("synthetic-test-key");
    expect(env.PATH).toBe(process.env.PATH);
    expect(env.HOME).toBeTruthy();
  });

  it("preserves an explicit HOME instead of replacing it with USERPROFILE", () => {
    const previous = process.env.HOME;
    process.env.HOME = "X:\\explicit-home";
    try {
      expect(buildCliEnv(settings).HOME).toBe("X:\\explicit-home");
    } finally {
      if (previous === undefined) delete process.env.HOME;
      else process.env.HOME = previous;
    }
  });

  it("accepts only a regular Grok-named executable with a Grok version identity", async () => {
    const path = await fixture(process.platform === "win32" ? "grok.exe" : "grok");
    await expect(validateGrokCliExecutable(path, async () => "grok 0.2.117 (fixture)"))
      .resolves.toBe(path);
  });

  it("rejects arbitrary renderer-selected programs even when their probe returns a version", async () => {
    const path = await fixture(process.platform === "win32" ? "powershell.exe" : "sh");
    await expect(validateGrokCliExecutable(path, async () => "grok 0.2.117"))
      .rejects.toThrow("文件名必须是 grok");
  });

  it("rejects a renamed program that does not identify itself as Grok", async () => {
    const path = await fixture(process.platform === "win32" ? "grok.exe" : "grok");
    await expect(validateGrokCliExecutable(path, async () => "totally-not-grok 1.2.3"))
      .rejects.toThrow("身份验证");
  });

  it("keeps an empty override for normal automatic discovery", async () => {
    await expect(validateGrokCliExecutable("", async () => "not called")).resolves.toBe("");
  });
});
