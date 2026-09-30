import type { ThemeColors, ThemeSettings } from "../../shared/types";

const THEME_CACHE_KEY = "grok-build-desktop.theme.v1";

export const DARK_COLORS: ThemeColors = { background: "#121212", surface: "#191919", text: "#ececec", muted: "#a1a1a1", accent: "#6ea8fe", border: "#2a2a2a" };
export const LIGHT_COLORS: ThemeColors = { background: "#f3f3f2", surface: "#ffffff", text: "#1c1c1c", muted: "#5f5f5f", accent: "#2a6fdb", border: "#e0e0de" };

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
  const dark = resolved === "dark";
  const colors = theme.mode === "custom" ? theme.colors : dark ? DARK_COLORS : LIGHT_COLORS;
  // Brand buttons are monochrome (near-white on dark, near-black on light). A
  // custom theme opts into its own accent as the primary action colour instead.
  const primary = theme.mode === "custom" ? colors.accent : mix(colors.text, dark ? "#ffffff" : "#000000", 0.12);
  const primaryForeground = theme.mode === "custom" ? (contrastRatio("#ffffff", primary) >= contrastRatio("#000000", primary) ? "#ffffff" : "#000000") : colors.background;
  return {
    // Surface ladder: window -> frame -> card -> popover. Hover/selected are
    // derived in tokens.css with color-mix() from --color-fg.
    "--color-window": colors.background,
    "--color-frame": colors.surface,
    "--color-card": mix(colors.surface, colors.text, dark ? 0.045 : 0.03),
    "--color-card-selected": mix(colors.surface, colors.text, dark ? 0.085 : 0.065),
    "--color-popover": dark ? mix(colors.surface, colors.text, 0.065) : colors.surface,
    "--color-input": dark ? mix(colors.surface, colors.text, 0.02) : colors.surface,
    "--color-border": colors.border,
    "--color-border-strong": mix(colors.border, colors.text, 0.18),
    "--color-fg": colors.text,
    "--color-fg-subtle": colors.muted,
    "--color-fg-subtlest": mix(colors.muted, colors.background, 0.42),
    "--color-primary": primary,
    "--color-primary-fg": primaryForeground,
    "--color-accent": colors.accent,
    "--color-success": dark ? "#4cc38a" : "#1f8a5b",
    "--color-warning": dark ? "#e5b454" : "#9a6a0c",
    "--color-danger": dark ? "#f06a6a" : "#c53b3b",
    "--text-strong": mix(colors.text, dark ? "#ffffff" : "#000000", 0.12),
    "--shadow": dark ? "#00000088" : "#16202a24",
    "--shadow-overlay": dark ? "0 10px 30px #00000073, 0 0 0 1px var(--color-border)" : "0 10px 30px #16202a1f, 0 0 0 1px var(--color-border)",
    "--background-opacity": String(theme.background.opacity),
    "--background-blur": `${theme.background.blur}px`,
    "--background-dim": String(theme.background.dim),
    "--background-mask": dark ? "0 0 0" : "255 255 255",
    "--background-fit": theme.background.fit,
    "--background-position": theme.background.position,
    "--theme-background-image": theme.background.enabled ? 'url("grok-theme://background/current")' : "none",
  };
}

/**
 * Applies reading preferences to the document root rather than to `.app-shell`.
 * `#overlay-root` is a sibling of `#root` in index.html, so every portaled
 * dialog, palette and panel sits outside the shell and inherited none of this —
 * the text-size setting visibly did nothing to any of them.
 */
export function applyShellPreferencesToDocument(fontScale: number, density: string, root: HTMLElement = document.documentElement): void {
  const scale = Number.isFinite(fontScale) && fontScale > 0 ? Math.min(200, Math.max(50, fontScale)) : 100;
  root.style.fontSize = `${scale}%`;
  root.dataset.density = density || "balanced";
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
function parseHex(color: string): number[] { const normalized = /^#[0-9a-f]{6}$/i.test(color) ? color.slice(1) : "000000"; return [0, 2, 4].map((index) => Number.parseInt(normalized.slice(index, index + 2), 16)); }
