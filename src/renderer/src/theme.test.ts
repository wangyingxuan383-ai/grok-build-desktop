import { describe, expect, it } from "vitest";
import { DEFAULT_THEME } from "../../main/services/theme-service";
import { cacheThemeForEarlyStartup, contrastRatio, readCachedThemeForEarlyStartup, resolvedTheme, themeBackgroundClass, themeCssVariables } from "./theme";

describe("renderer theme mapping", () => {
  it("resolves system and custom base themes", () => {
    expect(resolvedTheme({ ...DEFAULT_THEME, mode: "system" }, true)).toBe("dark");
    expect(resolvedTheme({ ...DEFAULT_THEME, mode: "system" }, false)).toBe("light");
    expect(resolvedTheme({ ...DEFAULT_THEME, mode: "custom", customBase: "light" }, true)).toBe("light");
  });

  it("maps custom colors and background controls to semantic variables", () => {
    const theme = { ...DEFAULT_THEME, mode: "custom" as const, colors: { ...DEFAULT_THEME.colors, accent: "#123456" }, background: { ...DEFAULT_THEME.background, fit: "contain" as const, position: "top" as const, blur: 7 } };
    const variables = themeCssVariables(theme, false);
    expect(variables["--accent"]).toBe("#123456");
    expect(variables["--background-fit"]).toBe("contain");
    expect(variables["--background-position"]).toBe("top");
    expect(variables["--background-blur"]).toBe("7px");
    expect(variables["--elevated"]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(variables["--button-bg"]).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("reports WCAG contrast ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 2);
  });

  it("scopes a selected background to the conversation or entire window", () => {
    expect(themeBackgroundClass({ ...DEFAULT_THEME, background: { ...DEFAULT_THEME.background, enabled: true, scope: "conversation" } })).toBe("has-background background-conversation");
    expect(themeBackgroundClass({ ...DEFAULT_THEME, background: { ...DEFAULT_THEME.background, enabled: true, scope: "window" } })).toBe("has-background background-window");
    expect(themeBackgroundClass(DEFAULT_THEME)).toBe("");
  });

  it("round-trips a validated non-sensitive theme for pre-React startup paint", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const theme = { ...DEFAULT_THEME, mode: "light" as const };
    cacheThemeForEarlyStartup(theme, storage);
    expect(readCachedThemeForEarlyStartup(storage)).toEqual(theme);
    values.set([...values.keys()][0]!, JSON.stringify({ mode: "light", colors: {} }));
    expect(readCachedThemeForEarlyStartup(storage)).toBeUndefined();
  });
});
