import { execFile } from "node:child_process";
import { access, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, join } from "node:path";
import { promisify } from "node:util";
import type { AppSettings, CliVersionStatus } from "../../shared/types";

const execFileAsync = promisify(execFile);
const effortFlags = new Map<string, "--effort" | "--reasoning-effort">();
export const CLI_CHANGELOG_URL = "https://x.ai/build/changelog";
// Highest public release observed in the official changelog when this build
// was cut. It is display-only: it does not prove wire compatibility, and the
// CLI stable feed remains the sole authority for an installable target.
export const KNOWN_PUBLIC_CLI_VERSION = "1.0.5";

export interface GrokConfigSourceDiagnostic {
  kind: "default" | "path" | "inline" | "multiple";
  variables: Array<"GROK_CONFIG" | "GROK_CONFIG_PATH">;
  summary: string;
  /** Safe details only: no inline TOML and no absolute path. */
  details: string[];
}

export function describeGrokConfigSource(env: NodeJS.ProcessEnv = process.env): GrokConfigSourceDiagnostic {
  const inline = env.GROK_CONFIG;
  const configuredPath = env.GROK_CONFIG_PATH?.trim();
  if (inline !== undefined && configuredPath) return {
    kind: "multiple",
    variables: ["GROK_CONFIG", "GROK_CONFIG_PATH"],
    summary: "检测到两个 Grok CLI 配置覆盖来源",
    details: [`GROK_CONFIG：已设置（${Buffer.byteLength(inline, "utf8")} 字节，内容不显示）`, `GROK_CONFIG_PATH：${basename(configuredPath)}（绝对路径不显示）`, "Desktop 不会在运行中修改这些全局覆盖；实际优先级由当前 CLI 决定。"],
  };
  if (inline !== undefined) return {
    kind: "inline",
    variables: ["GROK_CONFIG"],
    summary: "Grok CLI 使用内联配置覆盖",
    details: [`GROK_CONFIG 已设置（${Buffer.byteLength(inline, "utf8")} 字节，内容不显示）`, "Desktop 不会读取到 Renderer、日志或支持包。"],
  };
  if (configuredPath) return {
    kind: "path",
    variables: ["GROK_CONFIG_PATH"],
    summary: "Grok CLI 使用指定配置文件",
    details: [`文件名：${basename(configuredPath)}（绝对路径不显示）`, "Desktop 不会在运行中修改该全局覆盖。"],
  };
  return { kind: "default", variables: [], summary: "Grok CLI 使用默认配置来源", details: ["未设置 GROK_CONFIG 或 GROK_CONFIG_PATH。"] };
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}

export async function locateGrokCli(configured = ""): Promise<string | undefined> {
  const candidates = [configured, join(homedir(), ".grok", "bin", process.platform === "win32" ? "grok.exe" : "grok")].filter(Boolean);
  const pathNames = process.env.PATH?.split(delimiter) ?? [];
  for (const dir of pathNames) candidates.push(join(dir, process.platform === "win32" ? "grok.exe" : "grok"));
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  return undefined;
}

/**
 * Validate a renderer-supplied CLI override before it is persisted. Merely
 * checking that a path exists turns the next CLI launch into an arbitrary
 * executable primitive. A valid override must be a regular Grok-named binary
 * and identify itself as Grok through the bounded `--version` probe.
 */
export async function validateGrokCliExecutable(
  configured: string,
  probe: (path: string) => Promise<string> = probeGrokCliIdentity,
): Promise<string> {
  const value = configured.trim();
  if (!value) return "";
  const canonical = await realpath(value).catch(() => undefined);
  if (!canonical) throw new Error("指定的 Grok CLI 不存在或无法读取");
  const info = await stat(canonical).catch(() => undefined);
  if (!info?.isFile()) throw new Error("指定的 Grok CLI 不是文件");
  const name = basename(canonical).toLowerCase();
  if (name !== "grok" && name !== "grok.exe") throw new Error("Grok CLI 文件名必须是 grok 或 grok.exe");
  const identity = await probe(canonical).catch(() => "");
  if (!/^grok(?:\s+build)?\s+v?\d+\.\d+\.\d+(?:\s|$)/i.test(identity.trim())) {
    throw new Error("指定的程序没有通过 Grok CLI 身份验证");
  }
  return canonical;
}

async function probeGrokCliIdentity(path: string): Promise<string> {
  const { stdout, stderr } = await execFileAsync(path, ["--version"], {
    timeout: 10_000,
    windowsHide: true,
    maxBuffer: 64 * 1024,
  });
  return `${stdout}\n${stderr}`.trim();
}

export function buildCliEnv(settings: AppSettings, apiKey?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Windows normally exposes USERPROFILE but not HOME. Grok CLI uses HOME for
  // automatic worktree cleanup, so synthesize only the missing conventional
  // variable without changing GROK_HOME or overriding an explicit user value.
  if (!env.HOME?.trim()) env.HOME = env.USERPROFILE?.trim() || homedir();
  if (settings.httpProxy) env.HTTP_PROXY = settings.httpProxy;
  if (settings.httpsProxy) env.HTTPS_PROXY = settings.httpsProxy;
  if (apiKey) env.XAI_API_KEY = apiKey;
  return env;
}

export async function readCliVersion(cliPath: string, env = process.env): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(cliPath, ["version", "--json"], { env, timeout: 15_000, windowsHide: true });
    const value = JSON.parse(stdout) as { currentVersion?: string };
    return value.currentVersion;
  } catch {
    try {
      const { stdout } = await execFileAsync(cliPath, ["--version"], { env, timeout: 15_000, windowsHide: true });
      return /\d+\.\d+\.\d+/.exec(stdout)?.[0];
    } catch {
      return undefined;
    }
  }
}

export async function checkCliUpdate(cliPath: string, env = process.env): Promise<CliVersionStatus> {
  try {
    const { stdout } = await execFileAsync(cliPath, ["update", "--check", "--json"], { env, timeout: 30_000, windowsHide: true });
    const result = JSON.parse(stdout) as {
      currentVersion?: string;
      latestVersion?: string;
      updateAvailable?: boolean;
      channel?: string;
      installer?: string;
      autoUpdate?: boolean;
      error?: string | null;
    };
    const publicAhead = compareVersions(KNOWN_PUBLIC_CLI_VERSION, result.latestVersion) > 0;
    return {
      found: true,
      path: cliPath,
      ...result,
      checkedAt: new Date().toISOString(),
      changelogUrl: CLI_CHANGELOG_URL,
      publicLatestVersion: KNOWN_PUBLIC_CLI_VERSION,
      majorUpgrade: isMajorUpgrade(result.currentVersion, result.latestVersion),
      distributionState: result.error ? "error" : publicAhead ? "public-ahead" : result.updateAvailable ? "stable-update" : "current",
    };
  } catch (error) {
    return { found: true, path: cliPath, checkedAt: new Date().toISOString(), changelogUrl: CLI_CHANGELOG_URL, publicLatestVersion: KNOWN_PUBLIC_CLI_VERSION, distributionState: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

export async function detectEffortFlag(cliPath: string, env = process.env): Promise<"--effort" | "--reasoning-effort"> {
  const key = cliPath.toLowerCase();
  const cached = effortFlags.get(key);
  if (cached) return cached;
  try {
    const { stdout, stderr } = await execFileAsync(cliPath, ["--no-auto-update", "agent", "--help"], { env, timeout: 15_000, windowsHide: true });
    const help = `${stdout}\n${stderr}`;
    const flag = /(?:^|\s)--effort(?:[=\s,]|$)/m.test(help) ? "--effort" : "--reasoning-effort";
    effortFlags.set(key, flag);
    return flag;
  } catch {
    return "--reasoning-effort";
  }
}

export function parseVersion(value?: string): [number, number, number] | undefined {
  const match = /(?:^|\D)(\d+)\.(\d+)\.(\d+)/.exec(value ?? "");
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

export function compareVersions(left?: string, right?: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a[index]! !== b[index]!) return a[index]! > b[index]! ? 1 : -1;
  }
  return 0;
}

export function isMajorUpgrade(current?: string, target?: string): boolean {
  const from = parseVersion(current);
  const to = parseVersion(target);
  return Boolean(from && to && to[0] > from[0]);
}

export function isLockedBinaryError(message: string): boolean {
  return /locked executable|os error 5|access is denied/i.test(message);
}
