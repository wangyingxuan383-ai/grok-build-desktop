import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import type { AppSettings, CliVersionStatus } from "../../shared/types";

const execFileAsync = promisify(execFile);
const effortFlags = new Map<string, "--effort" | "--reasoning-effort">();

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

export function buildCliEnv(settings: AppSettings, apiKey?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
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
      error?: string | null;
    };
    return { found: true, path: cliPath, ...result };
  } catch (error) {
    return { found: true, path: cliPath, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function detectEffortFlag(cliPath: string, env = process.env): Promise<"--effort" | "--reasoning-effort"> {
  const key = cliPath.toLowerCase();
  const cached = effortFlags.get(key);
  if (cached) return cached;
  try {
    const { stdout, stderr } = await execFileAsync(cliPath, ["agent", "--help"], { env, timeout: 15_000, windowsHide: true });
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

export function isLockedBinaryError(message: string): boolean {
  return /locked executable|os error 5|access is denied/i.test(message);
}
