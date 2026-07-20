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
    background: "#0d0f12",
    surface: "#171a1f",
    text: "#e7e9ec",
    muted: "#9299a3",
    accent: "#45a9df",
    border: "#292e35",
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

export function isAllowedThemeBackgroundUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "grok-theme:" && url.hostname === "background" && url.pathname === "/current" && !url.search && !url.hash && !url.username && !url.password;
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
  return {
    mode,
    customBase,
    colors,
    background: {
      enabled: Boolean(value.background?.enabled),
      scope: value.background?.scope === "window" ? "window" : "conversation",
      fit: value.background?.fit === "contain" ? "contain" : "cover",
      position: ["center", "top", "bottom", "left", "right"].includes(value.background?.position) ? value.background.position : "center",
      opacity: clamp(value.background?.opacity, 0, 1, DEFAULT_THEME.background.opacity),
      blur: clamp(value.background?.blur, 0, 24, DEFAULT_THEME.background.blur),
      dim: clamp(value.background?.dim, 0, 0.9, DEFAULT_THEME.background.dim),
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

function clamp(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}
