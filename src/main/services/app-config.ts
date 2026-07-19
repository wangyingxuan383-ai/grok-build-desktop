import { app } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BuildInfo } from "../../shared/types";

export interface PublicAppConfig {
  channel: string;
  repository: string;
  allowPrerelease: boolean;
  debug: boolean;
  mockCliPath: string;
}

const DEFAULTS: PublicAppConfig = {
  channel: "stable",
  repository: "",
  allowPrerelease: false,
  debug: false,
  mockCliPath: "",
};

export function loadAppConfig(root = app.getAppPath()): PublicAppConfig {
  const defaults = readConfig(join(root, "app.defaults.json"), DEFAULTS);
  const profile = buildProfile();
  const local = profile === "local" && !app.isPackaged ? readConfig(join(root, "app.local.json"), {}) : {};
  const merged = { ...defaults, ...local } as PublicAppConfig;
  if (embeddedRepository()) merged.repository = embeddedRepository();
  validateConfig(merged);
  return merged;
}

export function createBuildInfo(config: PublicAppConfig, version = app.getVersion(), packaged = app.isPackaged): BuildInfo {
  return {
    productName: "Grok Build Desktop",
    version,
    channel: config.channel,
    commit: buildCommit(),
    builtAt: buildTime(),
    repository: config.repository,
    profile: buildProfile(),
    packaged,
    signed: false,
    unofficial: true,
  };
}

export function validateConfig(value: PublicAppConfig): void {
  if (!/^[a-z0-9._-]{1,32}$/i.test(value.channel)) throw new Error("应用渠道名称无效");
  if (value.repository && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository)) throw new Error("GitHub 仓库必须使用 owner/repo 格式");
  if (value.mockCliPath && buildProfile() !== "local") throw new Error("公开构建禁止配置 mockCliPath");
}

function readConfig(path: string, fallback: Partial<PublicAppConfig>): Partial<PublicAppConfig> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    for (const key of Object.keys(parsed)) {
      if (!Object.hasOwn(DEFAULTS, key)) throw new Error(`本地应用配置包含未知字段：${key}`);
      if (/token|secret|password|api.?key/i.test(key)) throw new Error(`本地应用配置禁止凭据字段：${key}`);
    }
    return parsed as Partial<PublicAppConfig>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

function buildProfile(): "public" | "local" {
  return typeof __GROK_BUILD_PROFILE__ === "undefined" ? (process.env.APP_BUILD_PROFILE === "local" ? "local" : "public") : __GROK_BUILD_PROFILE__;
}
function embeddedRepository(): string { return typeof __GROK_BUILD_REPOSITORY__ === "undefined" ? (process.env.GROK_DESKTOP_REPOSITORY || "") : __GROK_BUILD_REPOSITORY__; }
function buildCommit(): string { return typeof __GROK_BUILD_COMMIT__ === "undefined" ? "working-tree" : __GROK_BUILD_COMMIT__; }
function buildTime(): string { return typeof __GROK_BUILD_TIME__ === "undefined" ? "unknown" : __GROK_BUILD_TIME__; }
