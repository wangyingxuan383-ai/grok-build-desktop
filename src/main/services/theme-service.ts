import { copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import type { ThemeSettings } from "../../shared/types";

const IMAGE_EXTENSIONS = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);
const MAX_BACKGROUND_BYTES = 20 * 1024 * 1024;

export const DEFAULT_THEME: ThemeSettings = {
  mode: "dark",
  customBase: "dark",
  colors: {
    background: "#121212",
    surface: "#191919",
    text: "#ececec",
    muted: "#a1a1a1",
    accent: "#6ea8fe",
    border: "#2a2a2a",
  },
  background: {
    enabled: false,
    scope: "conversation",
    fit: "cover",
    position: "center",
    opacity: 0.32,
    blur: 0,
    dim: 0.42,
  },
};

export const TITLE_BAR_HEIGHT = 38;

const PRESET_BACKGROUNDS: Record<string, { bg: string; fg: string; light: boolean }> = {
  "t3-dark": { bg: "#09090b", fg: "#f4f4f5", light: false },
  "t3-light": { bg: "#f8f8f7", fg: "#18181b", light: true },
  "tokyo-night": { bg: "#16161e", fg: "#c0caf5", light: false },
  "catppuccin-mocha": { bg: "#181825", fg: "#cdd6f4", light: false },
  "catppuccin-latte": { bg: "#e6e9ef", fg: "#4c4f69", light: true },
  "github-dark": { bg: "#0d1117", fg: "#e6edf3", light: false },
  "github-light": { bg: "#f6f8fa", fg: "#1f2328", light: true },
  "rose-pine": { bg: "#191724", fg: "#e0def4", light: false },
  "nord": { bg: "#242933", fg: "#eceff4", light: false },
  "mirasim-dusk": { bg: "#11131a", fg: "#edf0f7", light: false },
  "t3-obsidian": { bg: "#09090b", fg: "#f4f4f5", light: false },
  "t3-paper": { bg: "#f8f8f7", fg: "#18181b", light: true },
  "midnight-violet": { bg: "#110f1a", fg: "#ebe7f8", light: false },
  "nordic-pine": { bg: "#0e1514", fg: "#e4efec", light: false },
  "ember-carbon": { bg: "#141110", fg: "#efe8e4", light: false },
  "oled-pure": { bg: "#050506", fg: "#f0f2f5", light: false },
  "dawn-linen": { bg: "#fbf8f3", fg: "#241f1a", light: true },
  "arctic-slate": { bg: "#f4f7fa", fg: "#16202a", light: true },
  "sakura-mist": { bg: "#fcf6f8", fg: "#2b1d24", light: true },
  "solar-sand": { bg: "#fdf6e3", fg: "#2c2619", light: true },
};

export function resolveWindowBackgroundColor(theme: ThemeSettings, shouldUseDarkColors: boolean): string {
  if (theme.mode === "custom") return theme.colors.background;
  const isLight = theme.mode === "light" || (theme.mode === "system" && !shouldUseDarkColors);
  const presetKey = isLight ? (theme.lightPresetId ?? theme.presetId) : (theme.darkPresetId ?? theme.presetId);
  const preset = presetKey ? PRESET_BACKGROUNDS[presetKey] : undefined;
  if (preset && preset.light === isLight) return preset.bg;
  return isLight ? "#f6f7f9" : "#0f1115";
}

export function buildTitleBarOverlay(theme: ThemeSettings, shouldUseDarkColors: boolean): { color: string; symbolColor: string; height: number } {
  if (theme.mode === "custom") {
    return {
      color: "#00000000",
      symbolColor: theme.colors.text || (theme.customBase === "light" ? "#1f2328" : "#e7e9ec"),
      height: TITLE_BAR_HEIGHT,
    };
  }
  const isLight = theme.mode === "light" || (theme.mode === "system" && !shouldUseDarkColors);
  const presetKey = isLight ? (theme.lightPresetId ?? theme.presetId) : (theme.darkPresetId ?? theme.presetId);
  const preset = presetKey ? PRESET_BACKGROUNDS[presetKey] : undefined;
  return {
    color: "#00000000",
    symbolColor: preset && preset.light === isLight ? preset.fg : (isLight ? "#1f2328" : "#e7e9ec"),
    height: TITLE_BAR_HEIGHT,
  };
}

export function isAllowedThemeBackgroundUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const allowedSearch = !url.search || /^\?t=\d{1,20}$/.test(url.search);
    return url.protocol === "grok-theme:" && url.hostname === "background" && url.pathname === "/current" && allowedSearch && !url.hash && !url.username && !url.password;
  } catch { return false; }
}

export function mergeThemeSettings(current: ThemeSettings, patch: Partial<ThemeSettings>): ThemeSettings {
  return normalizeThemeSettings({
    ...current,
    ...patch,
    colors: { ...current.colors, ...(patch.colors ?? {}) },
    background: { ...current.background, ...(patch.background ?? {}) },
  });
}

export function normalizeThemeSettings(value: ThemeSettings): ThemeSettings {
  const mode = ["dark", "light", "system", "custom"].includes(value.mode) ? value.mode : "dark";
  const customBase = value.customBase === "light" ? "light" : "dark";
  const colors = Object.fromEntries(Object.entries({ ...DEFAULT_THEME.colors, ...value.colors }).map(([key, color]) => [key, normalizeColor(color, DEFAULT_THEME.colors[key as keyof typeof DEFAULT_THEME.colors])])) as unknown as ThemeSettings["colors"];
  const presetId = normalizePresetId(value.presetId);
  const darkPresetId = normalizePresetId(value.darkPresetId);
  const lightPresetId = normalizePresetId(value.lightPresetId);
  const autoExtractWallpaperPalette = typeof value.autoExtractWallpaperPalette === "boolean"
    ? value.autoExtractWallpaperPalette
    : undefined;
  const aurora = value.aurora && ["none", "nebula", "cedar", "jade"].includes(value.aurora) ? value.aurora : undefined;
  let customCss: string | undefined;
  if (typeof value.customCss === "string" && !value.customCss.includes("\0")) {
    const buf = Buffer.from(value.customCss, "utf8");
    if (buf.byteLength <= 64 * 1024) {
      customCss = value.customCss;
    } else {
      let end = 64 * 1024;
      while (end > 0 && (buf[end]! & 0xc0) === 0x80) end -= 1;
      customCss = buf.subarray(0, end).toString("utf8");
    }
  }
  const seedCanvas = typeof value.seedCanvas === "string" && /^#[0-9a-f]{6}$/i.test(value.seedCanvas.trim()) ? value.seedCanvas.trim().toLowerCase() : undefined;
  const seedAccent = typeof value.seedAccent === "string" && /^#[0-9a-f]{6}$/i.test(value.seedAccent.trim()) ? value.seedAccent.trim().toLowerCase() : undefined;
  const bgUpdatedAt = typeof value.background?.updatedAt === "number" && Number.isFinite(value.background.updatedAt) && value.background.updatedAt >= 0
    ? Math.trunc(value.background.updatedAt)
    : undefined;
  return {
    mode,
    customBase,
    colors,
    ...(presetId ? { presetId } : {}),
    ...(darkPresetId ? { darkPresetId } : {}),
    ...(lightPresetId ? { lightPresetId } : {}),
    ...(autoExtractWallpaperPalette !== undefined ? { autoExtractWallpaperPalette } : {}),
    ...(aurora ? { aurora } : {}),
    ...(customCss !== undefined ? { customCss } : {}),
    ...(seedCanvas ? { seedCanvas } : {}),
    ...(seedAccent ? { seedAccent } : {}),
    background: {
      enabled: Boolean(value.background?.enabled),
      scope: value.background?.scope === "window" ? "window" : "conversation",
      fit: value.background?.fit === "contain" ? "contain" : "cover",
      position: ["center", "top", "bottom", "left", "right"].includes(value.background?.position) ? value.background.position : "center",
      opacity: clamp(value.background?.opacity, 0, 1, DEFAULT_THEME.background.opacity),
      blur: clamp(value.background?.blur, 0, 24, DEFAULT_THEME.background.blur),
      dim: clamp(value.background?.dim, 0, 0.9, DEFAULT_THEME.background.dim),
      ...(bgUpdatedAt !== undefined ? { updatedAt: bgUpdatedAt } : {}),
    },
  };
}

export class ThemeService {
  private readonly directory: string;

  constructor(userDataPath: string, private readonly validateImage: (path: string) => boolean) {
    this.directory = join(userDataPath, "themes");
  }

  async installBackground(source: string): Promise<{ path: string; mimeType: string }> {
    const extension = extname(source).toLowerCase();
    const mimeType = IMAGE_EXTENSIONS.get(extension);
    if (!mimeType) throw new Error("背景图片仅支持 PNG、JPEG、WebP 或 GIF");
    const info = await stat(source);
    if (!info.isFile()) throw new Error("背景图片路径不是文件");
    if (info.size > MAX_BACKGROUND_BYTES) throw new Error("背景图片超过 20 MiB 限制");
    if (!this.validateImage(source)) throw new Error("无法解析所选背景图片");
    await mkdir(this.directory, { recursive: true });
    const target = join(this.directory, `background${extension}`);
    const temp = join(this.directory, `background-${crypto.randomUUID()}${extension}.tmp`);
    const backup = join(this.directory, `background-previous-${crypto.randomUUID()}${extension}.bak`);
    let targetBackedUp = false;
    try {
      // Keep the previous background intact until the new file has been copied
      // successfully, then atomically swap the application-owned resource.
      await copyFile(source, temp);
      if (await stat(target).then((value) => value.isFile()).catch(() => false)) {
        await rename(target, backup);
        targetBackedUp = true;
      }
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      if (targetBackedUp) await rename(backup, target).catch(() => undefined);
      throw error;
    }
    const files = await readdir(this.directory, { withFileTypes: true }).catch(() => []);
    await Promise.all(files.filter((entry) => entry.isFile() && entry.name !== target.split(/[\\/]/).at(-1) && /^background(?:-[^.]+)?\.(?:png|jpe?g|webp|gif)(?:\.tmp)?$/i.test(entry.name)).map((entry) => rm(join(this.directory, entry.name), { force: true }).catch(() => undefined)));
    await rm(backup, { force: true }).catch(() => undefined);
    return { path: target, mimeType };
  }

  async removeBackground(): Promise<void> {
    const files = await readdir(this.directory, { withFileTypes: true }).catch(() => []);
    await Promise.all(files.filter((entry) => entry.isFile() && /^background(?:-[^.]+)?\.(?:png|jpe?g|webp|gif)(?:\.tmp)?$/i.test(entry.name)).map((entry) => rm(join(this.directory, entry.name), { force: true })));
  }

  async currentBackground(): Promise<{ path: string; mimeType: string } | undefined> {
    const files = await readdir(this.directory, { withFileTypes: true }).catch(() => []);
    const file = files.find((entry) => entry.isFile() && /^background\.(?:png|jpe?g|webp|gif)$/i.test(entry.name));
    if (!file) return undefined;
    const extension = extname(file.name).toLowerCase();
    const mimeType = IMAGE_EXTENSIONS.get(extension);
    return mimeType ? { path: join(this.directory, file.name), mimeType } : undefined;
  }
}

function normalizeColor(value: unknown, fallback: string): string {
  const color = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
}

function normalizePresetId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const compact = value.trim().toLowerCase().replace(/\s+/g, "");
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(compact) ? compact : undefined;
}

function clamp(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}
