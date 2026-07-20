import type { ThemeColors, ThemeSettings } from "../../shared/types";

const THEME_CACHE_KEY = "grok-build-desktop.theme.v1";

export const DARK_COLORS: ThemeColors = { background: "#0d0f12", surface: "#171a1f", text: "#e7e9ec", muted: "#9299a3", accent: "#45a9df", border: "#292e35" };
export const LIGHT_COLORS: ThemeColors = { background: "#f6f7f9", surface: "#ffffff", text: "#202328", muted: "#68707b", accent: "#1677a8", border: "#d7dbe0" };

export function resolvedTheme(theme: ThemeSettings, systemDark: boolean): "dark" | "light" {
  if (theme.mode === "system") return systemDark ? "dark" : "light";
  if (theme.mode === "custom") return theme.customBase;
  return theme.mode;
}

export function themeBackgroundClass(theme: ThemeSettings): string {
  return theme.background.enabled ? `has-background background-${theme.background.scope}` : "";
}

export function themeCssVariables(theme: ThemeSettings, systemDark: boolean): Record<string, string> {
  const resolved = resolvedTheme(theme, systemDark);
  const colors = theme.mode === "custom" ? theme.colors : resolved === "light" ? LIGHT_COLORS : DARK_COLORS;
  return {
    "--bg": colors.background,
    "--main": colors.background,
    "--panel": colors.surface,
    "--panel-2": mix(colors.surface, colors.text, resolved === "light" ? 0.035 : 0.045),
    "--panel-3": mix(colors.surface, colors.text, resolved === "light" ? 0.075 : 0.09),
    "--input-bg": mix(colors.background, colors.text, resolved === "light" ? 0.018 : 0.025),
    "--elevated": mix(colors.surface, colors.text, resolved === "light" ? 0.025 : 0.065),
    "--button-bg": mix(colors.surface, colors.text, resolved === "light" ? 0.06 : 0.095),
    "--hover": mix(colors.surface, colors.text, resolved === "light" ? 0.085 : 0.12),
    "--chip-bg": mix(colors.surface, colors.text, resolved === "light" ? 0.055 : 0.08),
    "--border": colors.border,
    "--border-strong": mix(colors.border, colors.text, 0.18),
    "--muted": colors.muted,
    "--text": colors.text,
    "--text-secondary": mix(colors.text, colors.muted, 0.42),
    "--text-strong": mix(colors.text, resolved === "light" ? "#000000" : "#ffffff", 0.12),
    "--accent": colors.accent,
    "--accent-2": mix(colors.accent, resolved === "light" ? "#000000" : "#ffffff", 0.18),
    "--accent-soft": mix(colors.background, colors.accent, resolved === "light" ? 0.1 : 0.16),
    "--surface-translucent": withAlpha(colors.surface, resolved === "light" ? 0.86 : 0.84),
    "--shadow": resolved === "light" ? "#16202a24" : "#00000088",
    "--danger": resolved === "light" ? "#b73742" : "#ef6c72",
    "--success": resolved === "light" ? "#247a56" : "#56c596",
    "--warning": resolved === "light" ? "#8a6811" : "#e7b75d",
    "--background-opacity": String(theme.background.opacity),
    "--background-blur": `${theme.background.blur}px`,
    "--background-dim": String(theme.background.dim),
    "--background-mask": resolved === "light" ? "255 255 255" : "0 0 0",
    "--background-fit": theme.background.fit,
    "--background-position": theme.background.position,
    "--theme-background-image": theme.background.enabled ? 'url("grok-theme://background/current")' : "none",
  };
}

export function applyThemeToDocument(theme: ThemeSettings, systemDark: boolean, root: HTMLElement = document.documentElement): void {
  const resolved = resolvedTheme(theme, systemDark);
  root.dataset.theme = theme.mode;
  root.dataset.themeResolved = resolved;
  root.style.colorScheme = resolved;
  for (const [name, value] of Object.entries(themeCssVariables(theme, systemDark))) root.style.setProperty(name, value);
  root.dispatchEvent(new CustomEvent("grok-theme-change", { detail: { resolved } }));
}

/**
 * Keeps only non-sensitive appearance values in Renderer storage so a known
 * theme can be painted before React and the asynchronous settings IPC mount.
 * Main-process settings remain authoritative and overwrite this cache after
 * bootstrap.
 */
export function cacheThemeForEarlyStartup(theme: ThemeSettings, storage: Pick<Storage, "setItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage): void {
  try { storage?.setItem(THEME_CACHE_KEY, JSON.stringify(theme)); } catch { /* a disabled storage partition only loses early paint */ }
}

export function readCachedThemeForEarlyStartup(storage: Pick<Storage, "getItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage): ThemeSettings | undefined {
  try {
    const raw = storage?.getItem(THEME_CACHE_KEY);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<ThemeSettings>;
    if (!["dark", "light", "system", "custom"].includes(value.mode || "")) return undefined;
    if (!["dark", "light"].includes(value.customBase || "")) return undefined;
    if (!value.colors || !value.background) return undefined;
    if (!Object.values(value.colors).every((color) => /^#[0-9a-f]{6}$/i.test(color))) return undefined;
    if (!["conversation", "window"].includes(value.background.scope)) return undefined;
    if (!["cover", "contain"].includes(value.background.fit)) return undefined;
    return value as ThemeSettings;
  } catch { return undefined; }
}

export function contrastRatio(foreground: string, background: string): number {
  const left = luminance(foreground);
  const right = luminance(background);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

function luminance(color: string): number {
  const [red, green, blue] = parseHex(color).map((value) => { const channel = value / 255; return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

function mix(left: string, right: string, weight: number): string {
  const a = parseHex(left); const b = parseHex(right);
  return `#${a.map((value, index) => Math.round(value + ((b[index] ?? value) - value) * weight).toString(16).padStart(2, "0")).join("")}`;
}
function withAlpha(color: string, alpha: number): string { return `${color}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`; }
function parseHex(color: string): number[] { const normalized = /^#[0-9a-f]{6}$/i.test(color) ? color.slice(1) : "000000"; return [0, 2, 4].map((index) => Number.parseInt(normalized.slice(index, index + 2), 16)); }
