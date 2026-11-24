import type { ThemeAuroraPreset, ThemeBase, ThemeColors, ThemeSettings } from "../../shared/types";
import { sanitizeThemeCss } from "./theme-css-sanitizer";
import {
  DEFAULT_DARK_ANSI_PALETTE,
  DEFAULT_LIGHT_ANSI_PALETTE,
  getThemePresetById,
  THEME_PRESETS,
  type AnsiPalette,
  type MonacoThemeDefinition,
  type MonacoTokenRule,
  type ThemePreset,
  type ThemePresetId,
} from "./theme-presets";

export {
  DEFAULT_DARK_ANSI_PALETTE,
  DEFAULT_LIGHT_ANSI_PALETTE,
  getThemePresetById,
  THEME_PRESETS,
  type AnsiPalette,
  type MonacoThemeDefinition,
  type MonacoTokenRule,
  type ThemeAuroraPreset,
  type ThemePreset,
  type ThemePresetId,
};

const THEME_CACHE_KEY = "grok-build-desktop.theme.v1";
const CUSTOM_CSS_STYLE_ID = "grok-custom-theme-css";
export const TITLEBAR_HEIGHT_PX = 38;

export const DARK_COLORS: ThemeColors = { background: "#121212", surface: "#191919", text: "#ececec", muted: "#a1a1a1", accent: "#6ea8fe", border: "#2a2a2a" };
export const LIGHT_COLORS: ThemeColors = { background: "#f3f3f2", surface: "#ffffff", text: "#1c1c1c", muted: "#5f5f5f", accent: "#2a6fdb", border: "#e0e0de" };

export const AURORA_PRESETS: ReadonlyArray<{ id: ThemeAuroraPreset; label: string; subtitle: string }> = [
  { id: "none", label: "无极光", subtitle: "纯色或仅显示壁纸" },
  { id: "nebula", label: "Nebula · 星云靛", subtitle: "深空紫蓝与青色微光" },
  { id: "cedar", label: "Cedar · 雪松珀", subtitle: "暖木琥珀与暮色微光" },
  { id: "jade", label: "Jade · 翠微青", subtitle: "松石翡翠与薄雾微光" },
];

export function resolveAuroraGradient(aurora: ThemeAuroraPreset | undefined, dark: boolean): string {
  switch (aurora) {
    case "nebula":
      return dark
        ? "radial-gradient(ellipse 68% 54% at 16% 12%, rgb(139 92 246 / 0.22), transparent 66%), radial-gradient(ellipse 60% 50% at 86% 16%, rgb(56 189 248 / 0.16), transparent 64%), radial-gradient(ellipse 72% 56% at 52% 94%, rgb(192 132 252 / 0.14), transparent 70%)"
        : "radial-gradient(ellipse 68% 54% at 16% 12%, rgb(124 58 237 / 0.13), transparent 66%), radial-gradient(ellipse 60% 50% at 86% 16%, rgb(14 165 233 / 0.10), transparent 64%), radial-gradient(ellipse 72% 56% at 52% 94%, rgb(168 85 247 / 0.09), transparent 70%)";
    case "cedar":
      return dark
        ? "radial-gradient(ellipse 66% 52% at 18% 14%, rgb(234 138 76 / 0.21), transparent 65%), radial-gradient(ellipse 58% 48% at 84% 20%, rgb(214 95 120 / 0.15), transparent 62%), radial-gradient(ellipse 70% 56% at 48% 92%, rgb(180 120 68 / 0.13), transparent 68%)"
        : "radial-gradient(ellipse 66% 52% at 18% 14%, rgb(217 119 6 / 0.13), transparent 65%), radial-gradient(ellipse 58% 48% at 84% 20%, rgb(225 29 72 / 0.08), transparent 62%), radial-gradient(ellipse 70% 56% at 48% 92%, rgb(180 83 9 / 0.09), transparent 68%)";
    case "jade":
      return dark
        ? "radial-gradient(ellipse 66% 52% at 15% 15%, rgb(52 211 153 / 0.19), transparent 65%), radial-gradient(ellipse 60% 50% at 85% 18%, rgb(34 211 238 / 0.14), transparent 63%), radial-gradient(ellipse 72% 56% at 50% 92%, rgb(16 185 129 / 0.12), transparent 68%)"
        : "radial-gradient(ellipse 66% 52% at 15% 15%, rgb(16 185 129 / 0.13), transparent 65%), radial-gradient(ellipse 60% 50% at 85% 18%, rgb(6 182 212 / 0.10), transparent 63%), radial-gradient(ellipse 72% 56% at 50% 92%, rgb(5 150 105 / 0.08), transparent 68%)";
    default:
      return "none";
  }
}

export function deriveThemeFromSeeds(
  canvasSeed: string,
  accentSeed: string,
  preferredBase?: ThemeBase,
): { base: ThemeBase; colors: ThemeColors } {
  const background = normalizeHexSeed(canvasSeed, "#121212");
  const rawAccent = normalizeHexSeed(accentSeed, "#6ea8fe");
  const lum = luminance(background);
  const isDark = preferredBase ? preferredBase === "dark" : lum < 0.34;
  const base: ThemeBase = isDark ? "dark" : "light";

  const [cH, cS, cL] = rgbToHsl(...(parseHex(background) as [number, number, number]));
  const surface = isDark
    ? mix(background, mix("#ffffff", rawAccent, 0.08), 0.055)
    : cL > 0.97
      ? mix(background, "#000000", 0.03)
      : mix(background, "#ffffff", 0.72);
  const border = isDark
    ? mix(background, mix("#ffffff", rawAccent, 0.1), 0.115)
    : mix(background, "#000000", 0.11);

  const candidateText = isDark
    ? hslToHex(cH, Math.min(0.14, cS * 0.25), 0.94)
    : hslToHex(cH, Math.min(0.2, cS * 0.3), 0.11);
  const candidateMuted = isDark
    ? hslToHex(cH, Math.min(0.12, cS * 0.28), 0.66)
    : hslToHex(cH, Math.min(0.16, cS * 0.3), 0.38);

  const text = clampForegroundContrast(candidateText, background, 7.0, isDark);
  const muted = clampForegroundContrast(candidateMuted, background, 4.5, isDark);
  const accent = clampForegroundContrast(rawAccent, background, 3.2, isDark);

  return {
    base,
    colors: { background, surface, text, muted, accent, border },
  };
}

function normalizeHexSeed(input: string, fallback: string): string {
  const trimmed = input.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const r = trimmed[1]!;
    const g = trimmed[2]!;
    const b = trimmed[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fallback;
}

export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface MonacoEditorNamespaceLike {
  editor: {
    defineTheme(themeName: string, themeData: MonacoThemeDefinition): void;
    setTheme?(themeName: string): void;
  };
}

function inferSystemDark(systemDark?: boolean): boolean {
  if (typeof systemDark === "boolean") return systemDark;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  if (typeof document !== "undefined") {
    return document.documentElement.dataset.themeResolved !== "light";
  }
  return true;
}

export function resolveActiveThemePreset(theme: ThemeSettings, systemDark?: boolean): ThemePreset | undefined {
  const isSystemDark = inferSystemDark(systemDark);
  if (theme.mode === "custom") return undefined;
  if (theme.mode === "system") {
    const preferredId = isSystemDark ? theme.darkPresetId : theme.lightPresetId;
    if (preferredId) {
      const explicit = getThemePresetById(preferredId);
      if (explicit) return explicit;
    }
    const fallback = getThemePresetById(theme.presetId);
    if (fallback && fallback.base === (isSystemDark ? "dark" : "light")) return fallback;
    return undefined;
  }
  const direct = getThemePresetById(theme.presetId);
  if (direct) return direct;
  const modeSpecific = getThemePresetById(theme.mode === "dark" ? theme.darkPresetId : theme.lightPresetId);
  return modeSpecific && modeSpecific.base === theme.mode ? modeSpecific : undefined;
}

export function resolvedTheme(theme: ThemeSettings, systemDark: boolean): "dark" | "light" {
  if (theme.mode === "system") {
    const preset = resolveActiveThemePreset(theme, systemDark);
    return preset ? preset.base : systemDark ? "dark" : "light";
  }
  if (theme.mode === "custom") return theme.customBase;
  const preset = getThemePresetById(theme.presetId);
  if (preset) return preset.base;
  return theme.mode;
}

export function resolveThemeColors(theme: ThemeSettings, systemDark: boolean): ThemeColors {
  if (theme.mode === "custom") return theme.colors;
  const preset = resolveActiveThemePreset(theme, systemDark);
  if (preset) return preset.colors;
  return resolvedTheme(theme, systemDark) === "dark" ? DARK_COLORS : LIGHT_COLORS;
}

export function resolveAnsiPalette(theme: ThemeSettings, systemDark: boolean): AnsiPalette {
  const preset = resolveActiveThemePreset(theme, systemDark) ?? getThemePresetById(theme.presetId);
  if (preset) return preset.ansiPalette;
  return resolvedTheme(theme, systemDark) === "dark" ? DEFAULT_DARK_ANSI_PALETTE : DEFAULT_LIGHT_ANSI_PALETTE;
}

export function themeBackgroundClass(theme: ThemeSettings): string {
  const parts: string[] = [];
  if (theme.background.enabled) {
    parts.push("has-background", `background-${theme.background.scope}`);
  }
  if (theme.aurora && theme.aurora !== "none") {
    parts.push("has-aurora", `aurora-${theme.aurora}`);
  }
  return parts.join(" ");
}

export function themeCssVariables(theme: ThemeSettings, systemDark: boolean): Record<string, string> {
  const resolved = resolvedTheme(theme, systemDark);
  const dark = resolved === "dark";
  const preset = resolveActiveThemePreset(theme, systemDark);
  const colors = resolveThemeColors(theme, systemDark);
  const ansi = resolveAnsiPalette(theme, systemDark);
  const useAccentPrimary = theme.mode === "custom" || Boolean(preset);
  const primary = useAccentPrimary ? colors.accent : mix(colors.text, dark ? "#ffffff" : "#000000", 0.12);
  const primaryForeground = useAccentPrimary
    ? (contrastRatio("#ffffff", primary) >= contrastRatio("#000000", primary) ? "#ffffff" : "#000000")
    : colors.background;

  const cardColor = mix(colors.surface, colors.text, dark ? 0.045 : 0.03);
  const popover = dark ? mix(colors.surface, colors.text, 0.065) : colors.surface;
  const selectionBg = `${colors.accent}${dark ? "38" : "26"}`;
  const [accH, accS] = rgbToHsl(...(parseHex(colors.accent) as [number, number, number]));
  const chartL = dark ? 0.66 : 0.46;
  const chartSat = Math.max(0.55, Math.min(0.82, accS || 0.65));

  const ansiVariables: Record<string, string> = {};
  ansi.forEach((hex, index) => {
    ansiVariables[`--terminal-ansi-${index}`] = hex;
  });

  return {
    "--titlebar-height": `${TITLEBAR_HEIGHT_PX}px`,
    "--color-window": colors.background,
    "--color-frame": colors.surface,
    "--color-card": cardColor,
    "--color-card-selected": mix(colors.surface, colors.text, dark ? 0.085 : 0.065),
    "--color-popover": popover,
    "--color-input": dark ? mix(colors.surface, colors.text, 0.02) : colors.surface,
    "--color-border": colors.border,
    "--color-border-strong": mix(colors.border, colors.text, 0.18),
    "--color-fg": colors.text,
    "--color-fg-subtle": colors.muted,
    "--color-fg-subtlest": mix(colors.muted, colors.background, dark ? 0.36 : 0.24),
    "--color-primary": primary,
    "--color-primary-fg": primaryForeground,
    "--color-accent": colors.accent,
    "--color-success": dark ? "#4cc38a" : "#1f8a5b",
    "--color-warning": dark ? "#e5b454" : "#9a6a0c",
    "--color-danger": dark ? "#f06a6a" : "#c53b3b",
    "--chart-1": colors.accent,
    "--chart-2": ansi[6] || hslToHex(accH + 48, chartSat, chartL),
    "--chart-3": dark ? "#4cc38a" : "#1f8a5b",
    "--chart-4": dark ? "#e5b454" : "#b45309",
    "--chart-5": ansi[5] || hslToHex(accH + 280, chartSat, chartL),
    "--chart-6": dark ? "#f06a6a" : "#c53b3b",
    "--surface-glass-sidebar": `color-mix(in srgb, ${colors.background} ${dark ? "64%" : "72%"}, transparent)`,
    "--surface-glass-pane": `color-mix(in srgb, ${colors.surface} ${dark ? "78%" : "84%"}, transparent)`,
    "--surface-glass-card": `color-mix(in srgb, ${cardColor} ${dark ? "88%" : "92%"}, transparent)`,
    "--surface-glass-elevated": `color-mix(in srgb, ${popover} ${dark ? "90%" : "94%"}, transparent)`,
    "--border-glass-hairline": `color-mix(in srgb, ${colors.text} ${dark ? "10%" : "8%"}, ${colors.border} 52%)`,
    "--text-strong": mix(colors.text, dark ? "#ffffff" : "#000000", 0.12),
    "--shadow": dark ? "#00000088" : "#16202a24",
    "--shadow-overlay": dark ? "0 10px 30px #00000073, 0 0 0 1px var(--color-border)" : "0 10px 30px #16202a1f, 0 0 0 1px var(--color-border)",
    "--bg-app": colors.background,
    "--bg-surface": colors.surface,
    "--bg-elevated": popover,
    "--text-primary": colors.text,
    "--text-muted": colors.muted,
    "--border-subtle": colors.border,
    "--terminal-bg": colors.background,
    "--terminal-fg": colors.text,
    "--terminal-cursor": colors.accent,
    "--terminal-selection": selectionBg,
    ...ansiVariables,
    "--background-opacity": String(theme.background.opacity),
    "--background-blur": `${theme.background.blur}px`,
    "--background-dim": String(theme.background.dim),
    "--background-mask": dark ? "0 0 0" : "255 255 255",
    "--background-fit": theme.background.fit,
    "--background-position": theme.background.position,
    "--theme-background-image": theme.background.enabled
      ? (theme.background.updatedAt
          ? `url("grok-theme://background/current?t=${theme.background.updatedAt}")`
          : 'url("grok-theme://background/current")')
      : "none",
    "--theme-aurora-gradient": resolveAuroraGradient(theme.aurora, dark),
  };
}

export function getActiveTerminalTheme(settings?: ThemeSettings, systemDark?: boolean): TerminalTheme {
  const isSystemDark = inferSystemDark(systemDark);
  if (settings) {
    const resolved = resolvedTheme(settings, isSystemDark);
    const colors = resolveThemeColors(settings, isSystemDark);
    const ansi = resolveAnsiPalette(settings, isSystemDark);
    return {
      background: colors.background,
      foreground: colors.text,
      cursor: colors.accent,
      cursorAccent: colors.background,
      selectionBackground: `${colors.accent}${resolved === "dark" ? "3d" : "29"}`,
      black: ansi[0],
      red: ansi[1],
      green: ansi[2],
      yellow: ansi[3],
      blue: ansi[4],
      magenta: ansi[5],
      cyan: ansi[6],
      white: ansi[7],
      brightBlack: ansi[8],
      brightRed: ansi[9],
      brightGreen: ansi[10],
      brightYellow: ansi[11],
      brightBlue: ansi[12],
      brightMagenta: ansi[13],
      brightCyan: ansi[14],
      brightWhite: ansi[15],
    };
  }

  const fallbackColors = isSystemDark ? DARK_COLORS : LIGHT_COLORS;
  const fallbackAnsi = isSystemDark ? DEFAULT_DARK_ANSI_PALETTE : DEFAULT_LIGHT_ANSI_PALETTE;
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") {
    return {
      background: fallbackColors.background,
      foreground: fallbackColors.text,
      cursor: fallbackColors.accent,
      cursorAccent: fallbackColors.background,
      selectionBackground: `${fallbackColors.accent}38`,
      black: fallbackAnsi[0],
      red: fallbackAnsi[1],
      green: fallbackAnsi[2],
      yellow: fallbackAnsi[3],
      blue: fallbackAnsi[4],
      magenta: fallbackAnsi[5],
      cyan: fallbackAnsi[6],
      white: fallbackAnsi[7],
      brightBlack: fallbackAnsi[8],
      brightRed: fallbackAnsi[9],
      brightGreen: fallbackAnsi[10],
      brightYellow: fallbackAnsi[11],
      brightBlue: fallbackAnsi[12],
      brightMagenta: fallbackAnsi[13],
      brightCyan: fallbackAnsi[14],
      brightWhite: fallbackAnsi[15],
    };
  }

  const style = getComputedStyle(document.documentElement);
  const readVar = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;
  const background = readVar("--terminal-bg", readVar("--color-window", fallbackColors.background));
  const foreground = readVar("--terminal-fg", readVar("--color-fg", fallbackColors.text));
  const accent = readVar("--terminal-cursor", readVar("--color-accent", fallbackColors.accent));
  return {
    background,
    foreground,
    cursor: accent,
    cursorAccent: background,
    selectionBackground: readVar("--terminal-selection", `${accent}38`),
    black: readVar("--terminal-ansi-0", fallbackAnsi[0]),
    red: readVar("--terminal-ansi-1", fallbackAnsi[1]),
    green: readVar("--terminal-ansi-2", fallbackAnsi[2]),
    yellow: readVar("--terminal-ansi-3", fallbackAnsi[3]),
    blue: readVar("--terminal-ansi-4", fallbackAnsi[4]),
    magenta: readVar("--terminal-ansi-5", fallbackAnsi[5]),
    cyan: readVar("--terminal-ansi-6", fallbackAnsi[6]),
    white: readVar("--terminal-ansi-7", fallbackAnsi[7]),
    brightBlack: readVar("--terminal-ansi-8", fallbackAnsi[8]),
    brightRed: readVar("--terminal-ansi-9", fallbackAnsi[9]),
    brightGreen: readVar("--terminal-ansi-10", fallbackAnsi[10]),
    brightYellow: readVar("--terminal-ansi-11", fallbackAnsi[11]),
    brightBlue: readVar("--terminal-ansi-12", fallbackAnsi[12]),
    brightMagenta: readVar("--terminal-ansi-13", fallbackAnsi[13]),
    brightCyan: readVar("--terminal-ansi-14", fallbackAnsi[14]),
    brightWhite: readVar("--terminal-ansi-15", fallbackAnsi[15]),
  };
}

export function syncMonacoTheme(
  monacoInstance: MonacoEditorNamespaceLike,
  settings: ThemeSettings,
  systemDark?: boolean,
): "grok-custom" {
  const isSystemDark = inferSystemDark(systemDark);
  const resolved = resolvedTheme(settings, isSystemDark);
  const dark = resolved === "dark";
  const preset = resolveActiveThemePreset(settings, isSystemDark);

  const definition: MonacoThemeDefinition = preset
    ? preset.monacoTheme
    : (() => {
        const colors = resolveThemeColors(settings, isSystemDark);
        const ansi = resolveAnsiPalette(settings, isSystemDark);
        const strip = (hex: string): string => hex.replace(/^#/, "");
        return {
          base: dark ? "vs-dark" : "vs",
          inherit: true,
          rules: [
            { token: "comment", foreground: strip(colors.muted), fontStyle: "italic" },
            { token: "keyword", foreground: strip(ansi[5]) },
            { token: "string", foreground: strip(ansi[2]) },
            { token: "number", foreground: strip(ansi[3]) },
            { token: "type", foreground: strip(ansi[6]) },
            { token: "function", foreground: strip(ansi[4]) },
            { token: "variable", foreground: strip(colors.text) },
          ],
          colors: {
            "editor.background": colors.surface,
            "editor.foreground": colors.text,
            "editorLineNumber.foreground": colors.muted,
            "editorLineNumber.activeForeground": colors.text,
            "editorCursor.foreground": colors.accent,
            "editor.selectionBackground": `${colors.accent}${dark ? "36" : "24"}`,
            "editor.lineHighlightBackground": mix(colors.surface, colors.text, dark ? 0.045 : 0.035),
            "editorIndentGuide.background1": colors.border,
            "editorWidget.background": colors.background,
            "editorWidget.border": colors.border,
          },
        };
      })();

  monacoInstance.editor.defineTheme("grok-custom", definition);
  monacoInstance.editor.setTheme?.("grok-custom");
  return "grok-custom";
}

export async function extractPaletteFromImage(
  imageUrl: string,
  preferredBase?: ThemeBase,
): Promise<ThemeColors | null> {
  if (!imageUrl || typeof document === "undefined" || typeof Image === "undefined") {
    return null;
  }
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      const timer = globalThis.setTimeout(() => {
        element.onload = null;
        element.onerror = null;
        reject(new Error("Image load timeout"));
      }, 5000);
      element.crossOrigin = "anonymous";
      element.decoding = "async";
      element.onload = () => {
        globalThis.clearTimeout(timer);
        resolve(element);
      };
      element.onerror = () => {
        globalThis.clearTimeout(timer);
        reject(new Error("Image load error"));
      };
      element.src = imageUrl;
    });

    const sampleSize = 64;
    const canvas = document.createElement("canvas");
    canvas.width = sampleSize;
    canvas.height = sampleSize;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(img, 0, 0, sampleSize, sampleSize);
    const { data } = context.getImageData(0, 0, sampleSize, sampleSize);

    interface Bucket {
      count: number;
      rSum: number;
      gSum: number;
      bSum: number;
      vibrancySum: number;
    }

    const buckets = new Map<number, Bucket>();
    let totalLum = 0;
    let validPixels = 0;

    for (let offset = 0; offset < data.length; offset += 4) {
      const alpha = data[offset + 3] ?? 0;
      if (alpha < 128) continue;
      const r = data[offset] ?? 0;
      const g = data[offset + 1] ?? 0;
      const b = data[offset + 2] ?? 0;
      validPixels += 1;
      totalLum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const chroma = (maxC - minC) / 255;
      const existing = buckets.get(key);
      if (existing) {
        existing.count += 1;
        existing.rSum += r;
        existing.gSum += g;
        existing.bSum += b;
        existing.vibrancySum += chroma;
      } else {
        buckets.set(key, { count: 1, rSum: r, gSum: g, bSum: b, vibrancySum: chroma });
      }
    }

    if (!validPixels || !buckets.size) return null;

    const sorted = [...buckets.values()].sort((left, right) => right.count - left.count);
    const dominant = sorted[0]!;
    const domRgb: [number, number, number] = [
      Math.round(dominant.rSum / dominant.count),
      Math.round(dominant.gSum / dominant.count),
      Math.round(dominant.bSum / dominant.count),
    ];
    const [domH, domS] = rgbToHsl(domRgb[0], domRgb[1], domRgb[2]);
    const isDark = preferredBase ? preferredBase === "dark" : totalLum / validPixels < 0.56;

    let bestAccent = sorted[0]!;
    let bestScore = -1;
    for (const bucket of sorted.slice(0, 24)) {
      const avgChroma = bucket.vibrancySum / bucket.count;
      const weight = Math.log2(bucket.count + 1) * (0.35 + avgChroma * 2.4);
      if (weight > bestScore) {
        bestScore = weight;
        bestAccent = bucket;
      }
    }
    const rawAccentRgb: [number, number, number] = [
      Math.round(bestAccent.rSum / bestAccent.count),
      Math.round(bestAccent.gSum / bestAccent.count),
      Math.round(bestAccent.bSum / bestAccent.count),
    ];
    const [accH, accS] = rgbToHsl(rawAccentRgb[0], rawAccentRgb[1], rawAccentRgb[2]);

    const bgSat = Math.min(0.28, domS * 0.45);
    const background = isDark
      ? hslToHex(domH, bgSat, 0.08)
      : hslToHex(domH, Math.min(0.22, bgSat), 0.96);
    const surface = isDark
      ? hslToHex(domH, Math.min(0.26, bgSat * 1.05), 0.115)
      : hslToHex(domH, Math.min(0.16, bgSat * 0.6), 0.995);
    const border = isDark
      ? hslToHex(domH, Math.min(0.22, bgSat), 0.19)
      : hslToHex(domH, Math.min(0.18, bgSat), 0.86);

    const candidateText = isDark
      ? hslToHex(domH, Math.min(0.16, domS * 0.2), 0.94)
      : hslToHex(domH, Math.min(0.22, domS * 0.3), 0.12);
    const candidateMuted = isDark
      ? hslToHex(domH, Math.min(0.14, domS * 0.25), 0.68)
      : hslToHex(domH, Math.min(0.18, domS * 0.28), 0.36);
    const candidateAccent = hslToHex(
      accS > 0.08 ? accH : domH,
      Math.max(0.52, Math.min(0.86, accS || 0.62)),
      isDark ? 0.68 : 0.44,
    );

    const text = clampForegroundContrast(candidateText, background, 7.0, isDark);
    const muted = clampForegroundContrast(candidateMuted, background, 4.5, isDark);
    const accent = clampForegroundContrast(candidateAccent, background, 3.2, isDark);

    return { background, surface, text, muted, accent, border };
  } catch {
    return null;
  }
}

export function applyShellPreferencesToDocument(fontScale: number, density: string, root: HTMLElement = document.documentElement): void {
  const scale = Number.isFinite(fontScale) && fontScale > 0 ? Math.min(200, Math.max(50, fontScale)) : 100;
  root.style.fontSize = `${scale}%`;
  root.style.setProperty?.("--ui-font-size", `${Math.round(13 * (scale / 100) * 10) / 10}px`);
  root.dataset.density = density || "balanced";
}

export function applyThemeToDocument(theme: ThemeSettings, systemDark: boolean, root: HTMLElement = document.documentElement): void {
  const resolved = resolvedTheme(theme, systemDark);
  const preset = resolveActiveThemePreset(theme, systemDark);
  root.dataset.theme = theme.mode;
  root.dataset.themeResolved = resolved;
  if (preset) root.dataset.themePreset = preset.id;
  else delete root.dataset.themePreset;
  if (theme.aurora && theme.aurora !== "none") root.dataset.themeAurora = theme.aurora;
  else delete root.dataset.themeAurora;
  if (theme.background.enabled) root.dataset.hasWallpaper = "true";
  else delete root.dataset.hasWallpaper;
  if (theme.aurora && theme.aurora !== "none") root.dataset.hasAurora = "true";
  else delete root.dataset.hasAurora;
  root.style.colorScheme = resolved;
  for (const [name, value] of Object.entries(themeCssVariables(theme, systemDark))) {
    root.style.setProperty(name, value);
  }
  const doc = (root as Partial<HTMLElement>).ownerDocument;
  if (doc?.head) {
    const sanitized = theme.customCss ? sanitizeThemeCss(theme.customCss).css : "";
    let styleEl = doc.getElementById(CUSTOM_CSS_STYLE_ID) as HTMLStyleElement | null;
    if (sanitized) {
      if (!styleEl) {
        styleEl = doc.createElement("style");
        styleEl.id = CUSTOM_CSS_STYLE_ID;
        doc.head.appendChild(styleEl);
      }
      if (styleEl.textContent !== sanitized) styleEl.textContent = sanitized;
    } else if (styleEl) {
      styleEl.remove();
    }
  }
  root.dispatchEvent?.(new CustomEvent("grok-theme-change", { detail: { resolved, presetId: preset?.id } }));
}

export function buildEmergencyResetTheme(current?: ThemeSettings): ThemeSettings {
  const t3Dark = getThemePresetById("t3-dark");
  return {
    mode: "dark",
    customBase: "dark",
    presetId: "t3-dark",
    darkPresetId: "t3-dark",
    lightPresetId: current?.lightPresetId ?? "t3-light",
    colors: t3Dark ? { ...t3Dark.colors } : { ...DARK_COLORS },
    aurora: "none",
    customCss: "",
    background: {
      enabled: false,
      scope: current?.background.scope ?? "conversation",
      fit: current?.background.fit ?? "cover",
      position: current?.background.position ?? "center",
      opacity: 0.32,
      blur: 0,
      dim: 0.42,
    },
  };
}

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
    if (value.presetId !== undefined && typeof value.presetId !== "string") return undefined;
    if (value.darkPresetId !== undefined && typeof value.darkPresetId !== "string") return undefined;
    if (value.lightPresetId !== undefined && typeof value.lightPresetId !== "string") return undefined;
    if (value.autoExtractWallpaperPalette !== undefined && typeof value.autoExtractWallpaperPalette !== "boolean") return undefined;
    if (value.aurora !== undefined && !["none", "nebula", "cedar", "jade"].includes(value.aurora)) return undefined;
    if (value.customCss !== undefined && typeof value.customCss !== "string") return undefined;
    return value as ThemeSettings;
  } catch { return undefined; }
}

export function contrastRatio(foreground: string, background: string): number {
  const left = luminance(foreground);
  const right = luminance(background);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

function clampForegroundContrast(color: string, background: string, minRatio: number, darkBackground: boolean): string {
  if (contrastRatio(color, background) >= minRatio) return color;
  const target = darkBackground ? "#ffffff" : "#000000";
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mix(color, target, step / 20);
    if (contrastRatio(candidate, background) >= minRatio) return candidate;
  }
  return target;
}

function luminance(color: string): number {
  const [red, green, blue] = parseHex(color).map((value) => { const channel = value / 255; return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

function mix(left: string, right: string, weight: number): string {
  const a = parseHex(left); const b = parseHex(right);
  return `#${a.map((value, index) => Math.round(value + ((b[index] ?? value) - value) * weight).toString(16).padStart(2, "0")).join("")}`;
}

function parseHex(color: string): number[] {
  const normalized = /^#[0-9a-f]{6}$/i.test(color) ? color.slice(1) : "000000";
  return [0, 2, 4].map((index) => Number.parseInt(normalized.slice(index, index + 2), 16));
}

function rgbToHsl(r255: number, g255: number, b255: number): [number, number, number] {
  const r = r255 / 255;
  const g = g255 / 255;
  const b = b255 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToHex(hDeg: number, s: number, l: number): string {
  const h = ((hDeg % 360) + 360) % 360 / 360;
  const sat = Math.max(0, Math.min(1, s));
  const light = Math.max(0, Math.min(1, l));
  if (sat === 0) {
    const channel = Math.round(light * 255).toString(16).padStart(2, "0");
    return `#${channel}${channel}${channel}`;
  }
  const hue2rgb = (p: number, q: number, tInput: number): number => {
    let t = tInput;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
  const g = Math.round(hue2rgb(p, q, h) * 255);
  const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
