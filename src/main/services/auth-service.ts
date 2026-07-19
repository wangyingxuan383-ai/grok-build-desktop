import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { shell } from "electron";
import type { AccountProfile, AppSettings, LoginState } from "../../shared/types";
import { buildCliEnv, locateGrokCli } from "./cli-locator";
import type { AccountVault } from "./account-vault";
import type { LogService } from "./log-service";
import { GrokAcpAdapter } from "./grok-acp-adapter";

const execFileAsync = promisify(execFile);
const DEVICE_LOGIN_TIMEOUT_MS = 5 * 60_000;
const LOGIN_OUTPUT_LIMIT = 128 * 1024;
const TRANSACTION_MARKER = "grok-desktop";

interface ActiveVaultAccount {
  profile: AccountProfile;
  payload: { kind: "oauth" | "api-key"; authJson?: string; apiKey?: string };
}

interface AuthSnapshot {
  active?: ActiveVaultAccount;
  raw: string;
}

interface SpawnLoginOptions {
  env: NodeJS.ProcessEnv;
  windowsHide: boolean;
  stdio: "pipe";
}

export interface AuthServiceOptions {
  authPath?: string;
  loginTimeoutMs?: number;
  resolveCli?: (configured: string) => Promise<string | undefined>;
  spawnLogin?: (cliPath: string, args: string[], options: SpawnLoginOptions) => ChildProcessWithoutNullStreams;
  terminateProcessTree?: (child: ChildProcessWithoutNullStreams) => Promise<void>;
  openExternal?: (url: string) => Promise<void>;
  verifyActive?: () => Promise<void>;
}

class DeviceLoginTimeoutError extends Error {
  constructor() {
    super("设备码登录等待超过 5 分钟");
    this.name = "DeviceLoginTimeoutError";
  }
}

export class AuthService {
  readonly authPath: string;
  private loginState: LoginState = { running: false };
  private readonly loginTimeoutMs: number;
  private readonly resolveCli: (configured: string) => Promise<string | undefined>;
  private readonly spawnLogin: (cliPath: string, args: string[], options: SpawnLoginOptions) => ChildProcessWithoutNullStreams;
  private readonly killProcessTree: (child: ChildProcessWithoutNullStreams) => Promise<void>;
  private readonly openExternal: (url: string) => Promise<void>;
  private readonly verifyOverride?: () => Promise<void>;
  private operationTail: Promise<void> = Promise.resolve();
  private recoveryPromise?: Promise<void>;
  private loginPromise?: Promise<LoginState>;
  private activeLogin?: ChildProcessWithoutNullStreams;
  private activeLoginTermination?: Promise<void>;
  private disposed = false;

  constructor(
    private readonly vault: AccountVault,
    private readonly getSettings: () => Promise<AppSettings>,
    private readonly stopSessions: () => Promise<void>,
    private readonly log: LogService,
    private readonly emitLogin: (state: LoginState) => void,
    options: AuthServiceOptions = {},
  ) {
    this.authPath = options.authPath ?? join(homedir(), ".grok", "auth.json");
    this.loginTimeoutMs = options.loginTimeoutMs ?? DEVICE_LOGIN_TIMEOUT_MS;
    this.resolveCli = options.resolveCli ?? locateGrokCli;
    this.spawnLogin = options.spawnLogin ?? ((cliPath, args, spawnOptions) => spawn(cliPath, args, spawnOptions));
    this.killProcessTree = options.terminateProcessTree ?? ((child) => terminateProcessTree(child));
    this.openExternal = options.openExternal ?? ((url) => shell.openExternal(url));
    this.verifyOverride = options.verifyActive;
  }

  getLoginState(): LoginState {
    return { ...this.loginState };
  }

  importCurrentIfNeeded(): Promise<void> {
    return this.runExclusive(async () => {
      await this.ensureAuthArtifactsRecovered();
      const raw = await readFile(this.authPath, "utf8").catch(() => "");
      if (!raw.trim()) return;
      const accounts = await this.vault.list();
      if (!accounts.some((value) => value.active)) await this.vault.importAuthJson(raw, true);
    });
  }

  loginDevice(): Promise<LoginState> {
    if (this.loginPromise) return this.loginPromise;
    const operation = this.runExclusive(() => this.loginDeviceUnlocked());
    this.loginPromise = operation;
    void operation.then(
      () => { if (this.loginPromise === operation) this.loginPromise = undefined; },
      () => { if (this.loginPromise === operation) this.loginPromise = undefined; },
    );
    return operation;
  }

  addApiKey(label: string, apiKey: string): Promise<AccountProfile[]> {
    return this.runExclusive(() => this.addApiKeyUnlocked(label, apiKey));
  }

  switchAccount(accountId: string): Promise<AccountProfile[]> {
    return this.runExclusive(() => this.switchAccountUnlocked(accountId));
  }

  logout(): Promise<void> {
    return this.runExclusive(() => this.logoutUnlocked());
  }

  removeAccount(id: string): Promise<AccountProfile[]> {
    return this.runExclusive(async () => {
      const active = await this.vault.active();
      if (active?.profile.id === id) await this.logoutUnlocked();
      else await this.vault.remove(id);
      return this.vault.list();
    });
  }

  async activeApiKey(): Promise<string | undefined> {
    return (await this.vault.active())?.payload.apiKey;
  }

  async verifyActive(): Promise<void> {
    if (this.verifyOverride) return this.verifyOverride();
    const settings = await this.getSettings();
    const cliPath = await this.resolveCli(settings.cliPath);
    if (!cliPath) throw new Error("未找到 Grok CLI");
    const active = await this.vault.active();
    const { stdout } = await execFileAsync(cliPath, ["models"], {
      env: buildCliEnv(settings, active?.payload.apiKey),
      timeout: 30_000,
      windowsHide: true,
    });
    if (!/available models|default model|logged in/i.test(stdout)) throw new Error("Grok 登录验证未返回模型列表");
    if (active?.profile.kind === "oauth" && !(await access(this.authPath).then(() => true).catch(() => false))) throw new Error("OAuth 凭据文件不存在");
    const cwd = await mkdtemp(join(tmpdir(), "grok-auth-probe-"));
    const adapter = new GrokAcpAdapter({ cliPath, cwd, env: buildCliEnv(settings, active?.payload.apiKey), effort: "", mode: "agent", log: this.log });
    try {
      await adapter.start();
    } finally {
      await adapter.dispose();
      await rm(join(homedir(), ".grok", "sessions", encodeURIComponent(cwd)), { recursive: true, force: true });
      await rm(cwd, { recursive: true, force: true });
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const child = this.activeLogin;
    if (child) await this.terminateLogin(child).catch((error) => this.log.log(`Failed to cancel device login: ${errorMessage(error)}`));
    await this.loginPromise?.catch(() => undefined);
    await this.operationTail;
  }

  private async loginDeviceUnlocked(): Promise<LoginState> {
    this.updateLogin({ running: true, message: "正在启动设备码登录…" });
    let snapshot: AuthSnapshot | undefined;
    let importedId: string | undefined;
    let child: ChildProcessWithoutNullStreams | undefined;
    let combined = "";
    try {
      await this.ensureAuthArtifactsRecovered();
      const settings = await this.getSettings();
      const cliPath = await this.resolveCli(settings.cliPath);
      if (!cliPath) throw new Error("未找到 Grok CLI");
      await this.stopSessions();
      snapshot = await this.captureAuthSnapshot(true);
      child = this.spawnLogin(cliPath, ["login", "--device-auth"], {
        env: buildCliEnv(settings),
        windowsHide: true,
        stdio: "pipe",
      });
      this.activeLogin = child;
      this.activeLoginTermination = undefined;
      let opened = false;
      const consume = (data: Buffer): void => {
        combined = `${combined}${data.toString()}`.slice(-LOGIN_OUTPUT_LIMIT);
        const url = /https:\/\/[^\s\x1b]+/i.exec(combined)?.[0]?.replace(/[),.;]+$/, "");
        const code = /(?:user[_ -]?code|confirmation code|验证码)\s*[:=]?\s*([A-Z0-9-]{4,})/i.exec(combined)?.[1]
          ?? (url ? /[?&]user_code=([^&\s]+)/i.exec(url)?.[1] : undefined);
        this.updateLogin({ running: true, url, code: code ? decodeURIComponent(code) : undefined, message: "请在浏览器中完成登录" });
        if (url && !opened) {
          opened = true;
          void this.openExternal(url).catch(() => undefined);
        }
      };
      child.stdout.on("data", consume);
      child.stderr.on("data", consume);
      const code = await waitForProcessExit(child, this.loginTimeoutMs);
      if (code !== 0) throw new Error(`登录失败（代码 ${String(code)}）`);
      const raw = await readFile(this.authPath, "utf8");
      if (!raw.trim()) throw new Error("登录完成但 OAuth 凭据文件为空");
      const imported = await this.vault.importAuthJson(raw, true);
      importedId = imported.id;
      await this.verifyActive();
      this.updateLogin({ ...this.loginState, running: false, message: "登录成功", error: undefined });
      return this.getLoginState();
    } catch (error) {
      if (child) await this.terminateLogin(child).catch((killError) => this.log.log(`Failed to terminate device login: ${errorMessage(killError)}`));
      let rollbackError: unknown;
      if (snapshot) {
        try { await this.restoreAuthSnapshot(snapshot, importedId); }
        catch (reason) { rollbackError = reason; }
      }
      const baseMessage = this.disposed ? "设备码登录已取消" : error instanceof DeviceLoginTimeoutError ? error.message : errorMessage(error);
      const message = rollbackError ? `${baseMessage}；恢复原账号失败：${errorMessage(rollbackError)}` : baseMessage;
      await this.log.log(`Device login failed: ${message}${combined ? `: ${combined}` : ""}`);
      this.updateLogin({ ...this.loginState, running: false, error: message, message });
      return this.getLoginState();
    } finally {
      if (child) await this.terminateLogin(child).catch(() => undefined);
      if (this.activeLogin === child) {
        this.activeLogin = undefined;
        this.activeLoginTermination = undefined;
      }
      if (this.loginState.running) this.updateLogin({ ...this.loginState, running: false });
    }
  }

  private async addApiKeyUnlocked(label: string, apiKey: string): Promise<AccountProfile[]> {
    if (!apiKey.trim()) throw new Error("API Key 不能为空");
    await this.ensureAuthArtifactsRecovered();
    await this.stopSessions();
    const snapshot = await this.captureAuthSnapshot(true);
    let profile: AccountProfile | undefined;
    try {
      profile = await this.vault.addApiKey(label, apiKey.trim());
      await rm(this.authPath, { force: true });
      await this.verifyActive();
      return this.vault.list();
    } catch (error) {
      await this.restoreAuthSnapshot(snapshot, profile?.id);
      throw error;
    }
  }

  private async switchAccountUnlocked(accountId: string): Promise<AccountProfile[]> {
    await this.ensureAuthArtifactsRecovered();
    await this.stopSessions();
    const snapshot = await this.captureAuthSnapshot(true);
    if (snapshot.active?.profile.id === accountId) return this.vault.list();
    const target = await this.vault.get(accountId);
    if (!target) throw new Error("账号不存在");
    try {
      if (target.payload.kind === "oauth" && target.payload.authJson) await this.atomicWriteAuth(target.payload.authJson);
      else await rm(this.authPath, { force: true });
      await this.vault.setActive(accountId);
      await this.verifyActive();
      return this.vault.list();
    } catch (error) {
      await this.restoreAuthSnapshot(snapshot);
      throw new Error(`切换账号失败，已恢复原账号：${errorMessage(error)}`);
    }
  }

  private async logoutUnlocked(): Promise<void> {
    await this.ensureAuthArtifactsRecovered();
    await this.stopSessions();
    const settings = await this.getSettings();
    const cliPath = await this.resolveCli(settings.cliPath);
    const active = await this.vault.active();
    if (cliPath) await execFileAsync(cliPath, ["logout"], { env: buildCliEnv(settings, active?.payload.apiKey), timeout: 30_000, windowsHide: true }).catch(() => undefined);
    if (active) await this.vault.remove(active.profile.id);
    await rm(this.authPath, { force: true });
    this.updateLogin({ running: false, message: "已退出登录" });
  }

  private async captureAuthSnapshot(syncCurrentOAuth: boolean): Promise<AuthSnapshot> {
    let active = await this.vault.active() as ActiveVaultAccount | undefined;
    const raw = await readFile(this.authPath, "utf8").catch(() => "");
    if (syncCurrentOAuth && active?.profile.kind === "oauth" && raw.trim()) {
      await this.vault.updateOAuth(active.profile.id, raw);
      active = { profile: { ...active.profile }, payload: { kind: "oauth", authJson: raw } };
    }
    return { active, raw };
  }

  private async restoreAuthSnapshot(snapshot: AuthSnapshot, importedId?: string): Promise<void> {
    if (importedId && importedId !== snapshot.active?.profile.id) await this.vault.remove(importedId);
    if (snapshot.active?.profile.kind === "oauth" && snapshot.active.payload.authJson) {
      await this.vault.updateOAuth(snapshot.active.profile.id, snapshot.active.payload.authJson);
    }
    if (snapshot.active) await this.vault.setActive(snapshot.active.profile.id);
    else await this.vault.clearActive();
    if (snapshot.raw) await this.atomicWriteAuth(snapshot.raw);
    else await rm(this.authPath, { force: true });
  }

  private async atomicWriteAuth(raw: string): Promise<void> {
    await this.ensureAuthArtifactsRecovered();
    await mkdir(dirname(this.authPath), { recursive: true });
    const transactionId = `${Date.now()}-${process.pid}-${randomUUID()}`;
    const temp = `${this.authPath}.${TRANSACTION_MARKER}-${transactionId}.tmp`;
    const backup = `${this.authPath}.${TRANSACTION_MARKER}-${transactionId}.bak`;
    await writeFile(temp, raw, { encoding: "utf8", mode: 0o600 });
    let backedUp = false;
    try {
      await rename(this.authPath, backup);
      backedUp = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        await rm(temp, { force: true });
        throw error;
      }
    }
    try {
      await rename(temp, this.authPath);
      await rm(backup, { force: true });
    } catch (error) {
      await rm(this.authPath, { force: true });
      if (backedUp) await rename(backup, this.authPath);
      await rm(temp, { force: true });
      throw error;
    }
  }

  private ensureAuthArtifactsRecovered(): Promise<void> {
    this.recoveryPromise ??= recoverAuthTransactionArtifacts(this.authPath);
    return this.recoveryPromise;
  }

  private terminateLogin(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (this.activeLogin === child && this.activeLoginTermination) return this.activeLoginTermination;
    const termination = this.killProcessTree(child);
    if (this.activeLogin === child) this.activeLoginTermination = termination;
    return termination;
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(async () => {
      if (this.disposed) throw new Error("认证服务正在关闭");
      return operation();
    });
    this.operationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private updateLogin(next: LoginState): void {
    this.loginState = next;
    if (!this.disposed) this.emitLogin(this.getLoginState());
  }
}

export async function recoverAuthTransactionArtifacts(authPath: string): Promise<void> {
  const directory = dirname(authPath);
  const authName = basename(authPath);
  const escapedName = authName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const artifactPattern = new RegExp(`^${escapedName}\\.(?:${TRANSACTION_MARKER}-[^/\\\\]+|\\d+)\\.(tmp|bak)$`, "i");
  const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const artifacts = await Promise.all(names.flatMap((name) => {
    const match = artifactPattern.exec(name);
    if (!match) return [];
    const path = join(directory, name);
    return [stat(path).then((info) => ({ path, kind: match[1]!.toLowerCase() as "tmp" | "bak", mtime: info.mtimeMs }))];
  }));
  if (!artifacts.length) return;
  const authExists = await access(authPath).then(() => true).catch(() => false);
  if (!authExists) {
    const backup = artifacts.filter((value) => value.kind === "bak").sort((a, b) => b.mtime - a.mtime)[0];
    if (backup) await rename(backup.path, authPath);
  }
  await Promise.all(artifacts.map((value) => rm(value.path, { force: true })));
}

export async function terminateProcessTree(child: ChildProcessWithoutNullStreams, waitMs = 5_000): Promise<void> {
  if (hasExited(child)) return;
  const pid = child.pid;
  if (!pid) {
    child.kill();
    if (!(await waitForExitWithin(child, waitMs))) throw new Error("登录进程没有 PID 且无法终止");
    return;
  }
  if (process.platform === "win32") {
    let taskkillError: unknown;
    try {
      await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], { timeout: 15_000, windowsHide: true });
    } catch (error) {
      taskkillError = error;
    }
    if (!(await waitForExitWithin(child, waitMs))) throw new Error(`无法终止登录进程树：${errorMessage(taskkillError)}`);
    return;
  }
  child.kill("SIGTERM");
  if (await waitForExitWithin(child, waitMs)) return;
  child.kill("SIGKILL");
  if (!(await waitForExitWithin(child, waitMs))) throw new Error("无法终止登录进程");
}

function waitForProcessExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<number | null> {
  if (hasExited(child)) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(() => reject(new DeviceLoginTimeoutError())), timeoutMs);
    const onExit = (code: number | null): void => finish(() => resolve(code));
    const onError = (error: Error): void => finish(() => reject(error));
    const finish = (settle: () => void): void => {
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
      settle();
    };
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

function waitForExitWithin(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(false), timeoutMs);
    const onExit = (): void => finish(true);
    const finish = (exited: boolean): void => {
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      child.removeListener("close", onExit);
      resolve(exited || hasExited(child));
    };
    child.once("exit", onExit);
    child.once("close", onExit);
  });
}

function hasExited(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
