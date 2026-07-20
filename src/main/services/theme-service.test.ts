import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_THEME, isAllowedThemeBackgroundUrl, mergeThemeSettings, ThemeService } from "./theme-service";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

describe("ThemeService", () => {
  it("normalizes custom colors and bounded background controls", () => {
    const value = mergeThemeSettings(DEFAULT_THEME, { mode: "custom", colors: { ...DEFAULT_THEME.colors, text: "#ABCDEF", accent: "invalid" }, background: { ...DEFAULT_THEME.background, opacity: 8, blur: -3, dim: 2 } });
    expect(value.colors.text).toBe("#abcdef");
    expect(value.colors.accent).toBe(DEFAULT_THEME.colors.accent);
    expect(value.background.opacity).toBe(1);
    expect(value.background.blur).toBe(0);
    expect(value.background.dim).toBe(.9);
  });

  it("copies a validated image under an app-owned fixed name and removes it", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-theme-")); roots.push(root);
    const source = join(root, "来源 图片.png");
    await writeFile(source, Buffer.from("synthetic-image"));
    const service = new ThemeService(join(root, "userdata"), () => true);
    const installed = await service.installBackground(source);
    expect(installed.path).toBe(join(root, "userdata", "themes", "background.png"));
    expect((await service.currentBackground())?.mimeType).toBe("image/png");
    await service.removeBackground();
    expect(await service.currentBackground()).toBeUndefined();
  });

  it("replaces an existing same-format background without deleting the target before the swap", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-theme-replace-")); roots.push(root);
    const first = join(root, "first.png"); const second = join(root, "second.png");
    await writeFile(first, Buffer.from("first-image")); await writeFile(second, Buffer.from("second-image"));
    const service = new ThemeService(join(root, "userdata"), () => true);
    const installed = await service.installBackground(first);
    await service.installBackground(second);
    expect(await import("node:fs/promises").then(({ readFile }) => readFile(installed.path, "utf8"))).toBe("second-image");
  });

  it("allows only the fixed read-only protocol URL", () => {
    expect(isAllowedThemeBackgroundUrl("grok-theme://background/current")).toBe(true);
    expect(isAllowedThemeBackgroundUrl("grok-theme://background/current?path=C:%5Csecret")).toBe(false);
    expect(isAllowedThemeBackgroundUrl("grok-theme://background/../secret")).toBe(false);
    expect(isAllowedThemeBackgroundUrl("file:///C:/secret.png")).toBe(false);
  });

  it("rejects unsupported, invalid and oversized backgrounds", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-theme-reject-")); roots.push(root);
    const unsupported = join(root, "background.svg");
    await writeFile(unsupported, "<svg/>");
    const invalidPng = join(root, "invalid.png");
    await writeFile(invalidPng, "not an image");
    const largePng = join(root, "large.png");
    const file = await open(largePng, "w");
    await file.truncate(20 * 1024 * 1024 + 1);
    await file.close();
    const service = new ThemeService(join(root, "userdata"), (path) => path !== invalidPng);
    await expect(service.installBackground(unsupported)).rejects.toThrow(/仅支持/);
    await expect(service.installBackground(invalidPng)).rejects.toThrow(/无法解析/);
    await expect(service.installBackground(largePng)).rejects.toThrow(/20 MiB/);
    expect(await service.currentBackground()).toBeUndefined();
  });
});
