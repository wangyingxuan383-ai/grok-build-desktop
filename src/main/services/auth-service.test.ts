import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountProfile, AppSettings, LoginState } from "../../shared/types";
import type { AccountVault } from "./account-vault";
import { AuthService, recoverAuthTransactionArtifacts, terminateProcessTree, type AuthServiceOptions } from "./auth-service";
import type { LogService } from "./log-service";
import { DEFAULT_THEME } from "./theme-service";

vi.mock("electron", () => ({ shell: { openExternal: vi.fn(async () => undefined) } }));

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const services: AuthService[] = [];

const settings: AppSettings = {
  theme: DEFAULT_THEME,
  cliPath: "",
  httpProxy: "",
  httpsProxy: "",
  defaultModel: "",
  defaultEffort: "high",
  defaultMode: "agent",
  showThinking: true,
  expandToolDetails: false,
  fontScale: 1,
  uiDensity: "balanced",
  recentWorkspaces: [],
  activeWorkspace: "",
};

interface FakePayload {
  kind: "oauth" | "api-key";
  authJson?: string;
  apiKey?: string;
}

interface FakeEntry {
  profile: AccountProfile;
  payload: FakePayload;
}

class FakeVault {
  readonly entries = new Map<string, FakeEntry>();
  readonly updateOAuthCalls: Array<{ id: string; raw: string }> = [];
  readonly removed: string[] = [];
  activeId = "";
  apiSequence = 0;

  constructor(raw?: string) {
    if (raw) {
      const entry = oauthEntry(raw);
      this.entries.set(entry.profile.id, entry);
      this.activeId = entry.profile.id;
    }
  }

  async list(): Promise<AccountProfile[]> {
    return [...this.entries.values()].map(({ profile }) => ({ ...profile, active: profile.id === this.activeId }));
  }

  async active(): Promise<FakeEntry | undefined> {
    return this.clone(this.entries.get(this.activeId), true);
  }

  async get(id: string): Promise<FakeEntry | undefined> {
    return this.clone(this.entries.get(id), id === this.activeId);
  }

  async importAuthJson(raw: string, makeActive = true): Promise<AccountProfile> {
    const entry = oauthEntry(raw);
    const existing = this.entries.get(entry.profile.id);
    if (existing) entry.profile.createdAt = existing.profile.createdAt;
    this.entries.set(entry.profile.id, entry);
    if (makeActive) this.activeId = entry.profile.id;
    return { ...entry.profile, active: makeActive };
  }

  async addApiKey(label: string, apiKey: string): Promise<AccountProfile> {
    const now = new Date().toISOString();
    const profile: AccountProfile = {
      id: `api-${++this.apiSequence}`,
      label,
      kind: "api-key",
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    this.entries.set(profile.id, { profile, payload: { kind: "api-key", apiKey } });
    this.activeId = profile.id;
    return { ...profile };
  }

  async updateOAuth(id: string, raw: string): Promise<void> {
    this.updateOAuthCalls.push({ id, raw });
    const entry = this.entries.get(id);
    if (entry?.profile.kind === "oauth") entry.payload = { kind: "oauth", authJson: raw };
  }

  async setActive(id: string): Promise<void> {
    if (!this.entries.has(id)) throw new Error("账号不存在");
    this.activeId = id;
  }

  async clearActive(): Promise<void> {
    this.activeId = "";
  }

  async remove(id: string): Promise<void> {
    this.removed.push(id);
    this.entries.delete(id);
    if (this.activeId === id) this.activeId = "";
  }

  private clone(entry: FakeEntry | undefined, active = false): FakeEntry | undefined {
    return entry ? {
      profile: { ...entry.profile, active },
      payload: { ...entry.payload },
    } : undefined;
  }
}

afterEach(async () => {
  while (services.length) await services.pop()!.dispose().catch(() => undefined);
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("AuthService lifecycle", () => {
  it("clears running and restores the previous file and account after a non-zero login exit", async () => {
    const oldRaw = authJson("old", "old-token");
    const newRaw = authJson("new", "new-token");
    const harness = await createHarness(oldRaw, {
      spawnLogin: spawnLoginScript(`
        require("node:fs").writeFileSync(process.env.AUTH_PATH, process.env.NEW_RAW);
        process.exit(7);
      `, newRaw),
    });

    const result = await harness.service.loginDevice();

    expect(result.running).toBe(false);
    expect(result.error).toContain("代码 7");
    expect(await readFile(harness.authPath, "utf8")).toBe(oldRaw);
    expect(harness.vault.activeId).toBe("oauth-old");
    expect(harness.vault.entries.has("oauth-new")).toBe(false);
    expect(harness.stopSessions).toHaveBeenCalledTimes(1);
  });

  it("rolls back an imported OAuth account when post-login verification fails", async () => {
    const oldRaw = authJson("old", "old-token");
    const newRaw = authJson("new", "new-token");
    const harness = await createHarness(oldRaw, {
      spawnLogin: spawnLoginScript(`
        require("node:fs").writeFileSync(process.env.AUTH_PATH, process.env.NEW_RAW);
      `, newRaw),
      verifyActive: async () => { throw new Error("probe failed"); },
    });

    const result = await harness.service.loginDevice();

    expect(result.running).toBe(false);
    expect(result.error).toContain("probe failed");
    expect(await readFile(harness.authPath, "utf8")).toBe(oldRaw);
    expect(harness.vault.activeId).toBe("oauth-old");
    expect(harness.vault.removed).toContain("oauth-new");
    expect(harness.vault.entries.get("oauth-old")?.payload.authJson).toBe(oldRaw);
  });

  it("times out a device login, terminates it, and always clears running", async () => {
    const oldRaw = authJson("old", "old-token");
    let terminations = 0;
    const harness = await createHarness(oldRaw, {
      loginTimeoutMs: 40,
      spawnLogin: spawnLoginScript("setInterval(() => undefined, 1_000);"),
      terminateProcessTree: async (child) => {
        terminations += 1;
        child.kill();
      },
    });

    const result = await harness.service.loginDevice();

    expect(result.running).toBe(false);
    expect(result.error).toContain("超过 5 分钟");
    expect(terminations).toBe(1);
    expect(await readFile(harness.authPath, "utf8")).toBe(oldRaw);
  }, 10_000);

  it("cancels an in-flight device login during application disposal", async () => {
    const oldRaw = authJson("old", "old-token");
    let notifySpawned!: () => void;
    const spawned = new Promise<void>((resolve) => { notifySpawned = resolve; });
    let terminations = 0;
    const harness = await createHarness(oldRaw, {
      loginTimeoutMs: 30_000,
      spawnLogin: (cli, args, options) => {
        const child = spawnLoginScript("setInterval(() => undefined, 1_000);")(cli, args, options);
        notifySpawned();
        return child;
      },
      terminateProcessTree: async (child) => {
        terminations += 1;
        child.kill();
      },
    });

    const login = harness.service.loginDevice();
    await spawned;
    await harness.service.dispose();
    const result = await login;

    expect(terminations).toBe(1);
    expect(result.running).toBe(false);
    expect(result.error).toBe("设备码登录已取消");
    expect(harness.service.getLoginState().running).toBe(false);
    expect(await readFile(harness.authPath, "utf8")).toBe(oldRaw);
  }, 10_000);

  it("clears running even when spawning the CLI throws synchronously", async () => {
    const harness = await createHarness(authJson("old", "old-token"), {
      spawnLogin: () => { throw new Error("spawn failed"); },
    });

    const result = await harness.service.loginDevice();

    expect(result.running).toBe(false);
    expect(result.error).toContain("spawn failed");
  });
});

describe("AuthService account transactions", () => {
  it("syncs the refreshed OAuth auth.json before adding an API key", async () => {
    const staleRaw = authJson("old", "stale-token");
    const refreshedRaw = authJson("old", "refreshed-token");
    const harness = await createHarness(staleRaw, { verifyActive: async () => undefined });
    await writeFile(harness.authPath, refreshedRaw);

    await harness.service.addApiKey("primary", "xai-test-key");

    expect(harness.vault.updateOAuthCalls[0]).toEqual({ id: "oauth-old", raw: refreshedRaw });
    expect(harness.vault.entries.get("oauth-old")?.payload.authJson).toBe(refreshedRaw);
    expect(harness.vault.activeId).toBe("api-1");
    await expect(access(harness.authPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("serializes concurrent account mutations", async () => {
    let concurrent = 0;
    let maximumConcurrent = 0;
    const harness = await createHarness(authJson("old", "old-token"), {
      verifyActive: async () => {
        concurrent += 1;
        maximumConcurrent = Math.max(maximumConcurrent, concurrent);
        await delay(30);
        concurrent -= 1;
      },
    });

    await Promise.all([
      harness.service.addApiKey("first", "key-1"),
      harness.service.addApiKey("second", "key-2"),
    ]);

    expect(maximumConcurrent).toBe(1);
    expect(harness.stopSessions).toHaveBeenCalledTimes(2);
    expect(harness.vault.activeId).toBe("api-2");
  });
});

describe("OAuth file transaction recovery", () => {
  it("restores the newest backup when auth.json is absent and deletes plaintext residue", async () => {
    const root = await makeRoot();
    const authPath = join(root, ".grok", "auth.json");
    await mkdir(dirname(authPath), { recursive: true });
    const older = `${authPath}.123.bak`;
    const newer = `${authPath}.grok-desktop-new.bak`;
    const temp = `${authPath}.grok-desktop-new.tmp`;
    await writeFile(older, "older");
    await delay(10);
    await writeFile(newer, "newer");
    await writeFile(temp, "plaintext temporary credential");

    await recoverAuthTransactionArtifacts(authPath);

    expect(await readFile(authPath, "utf8")).toBe("newer");
    expect((await readdir(dirname(authPath))).filter((name) => /\.(?:tmp|bak)$/i.test(name))).toEqual([]);
  });

  it("does not overwrite an existing auth.json and performs recovery before startup import", async () => {
    const currentRaw = authJson("current", "current-token");
    const harness = await createHarness(undefined);
    await mkdir(dirname(harness.authPath), { recursive: true });
    await writeFile(harness.authPath, currentRaw);
    await writeFile(`${harness.authPath}.987.tmp`, "temporary secret");
    await writeFile(`${harness.authPath}.987.bak`, authJson("old", "old-token"));

    await harness.service.importCurrentIfNeeded();

    expect(await readFile(harness.authPath, "utf8")).toBe(currentRaw);
    expect(harness.vault.activeId).toBe("oauth-current");
    expect((await readdir(dirname(harness.authPath))).filter((name) => /\.(?:tmp|bak)$/i.test(name))).toEqual([]);
  });
});

describe.skipIf(process.platform !== "win32")("Windows process-tree termination", () => {
  it("kills a device-login process and its descendant", async () => {
    const root = await makeRoot();
    const pidFile = join(root, "descendant.pid");
    const child = spawn(process.execPath, ["-e", `
      const { spawn } = require("node:child_process");
      const fs = require("node:fs");
      const descendant = spawn(process.execPath, ["-e", "setInterval(() => undefined, 1000)"], {
        detached: false,
        windowsHide: true,
        stdio: "ignore"
      });
      fs.writeFileSync(process.env.PID_FILE, String(descendant.pid));
      setInterval(() => undefined, 1000);
    `], {
      env: { ...process.env, PID_FILE: pidFile },
      windowsHide: true,
      stdio: "pipe",
    });
    let descendantPid = 0;
    try {
      await waitUntil(async () => {
        descendantPid = Number(await readFile(pidFile, "utf8").catch(() => "0"));
        return descendantPid > 0;
      });

      await terminateProcessTree(child, 5_000);
      await waitUntil(() => !processExists(descendantPid));

      expect(processExists(child.pid!)).toBe(false);
      expect(processExists(descendantPid)).toBe(false);
    } finally {
      if (child.pid && processExists(child.pid)) await execFileAsync("taskkill", ["/PID", String(child.pid), "/T", "/F"]).catch(() => undefined);
      if (descendantPid && processExists(descendantPid)) await execFileAsync("taskkill", ["/PID", String(descendantPid), "/T", "/F"]).catch(() => undefined);
    }
  }, 30_000);
});

async function createHarness(oldRaw: string | undefined, options: AuthServiceOptions = {}): Promise<{
  root: string;
  authPath: string;
  vault: FakeVault;
  service: AuthService;
  states: LoginState[];
  stopSessions: ReturnType<typeof vi.fn>;
}> {
  const root = await makeRoot();
  const authPath = join(root, ".grok", "auth.json");
  if (oldRaw !== undefined) {
    await mkdir(dirname(authPath), { recursive: true });
    await writeFile(authPath, oldRaw);
  }
  const vault = new FakeVault(oldRaw);
  const states: LoginState[] = [];
  const stopSessions = vi.fn(async () => undefined);
  const logMessages: string[] = [];
  const fakeLog = {
    filePath: join(root, "app.log"),
    log: async (message: string) => { logMessages.push(message); },
    read: async () => logMessages.join("\n"),
  } as unknown as LogService;
  const suppliedSpawnLogin = options.spawnLogin;
  const service = new AuthService(
    vault as unknown as AccountVault,
    async () => settings,
    stopSessions,
    fakeLog,
    (state) => states.push(state),
    {
      authPath,
      resolveCli: async () => process.execPath,
      openExternal: async () => undefined,
      verifyActive: async () => undefined,
      ...options,
      spawnLogin: suppliedSpawnLogin
        ? (cliPath, args, spawnOptions) => suppliedSpawnLogin(cliPath, args, {
          ...spawnOptions,
          env: { ...spawnOptions.env, AUTH_PATH: authPath },
        })
        : undefined,
    },
  );
  services.push(service);
  return { root, authPath, vault, service, states, stopSessions };
}

function spawnLoginScript(source: string, newRaw?: string): NonNullable<AuthServiceOptions["spawnLogin"]> {
  return (_cliPath, _args, options) => spawn(process.execPath, ["-e", source], {
    ...options,
    env: {
      ...options.env,
      AUTH_PATH: options.env.AUTH_PATH,
      NEW_RAW: newRaw,
    },
  });
}

function oauthEntry(raw: string): FakeEntry {
  const id = String((JSON.parse(raw) as { __id: string }).__id);
  const now = new Date().toISOString();
  return {
    profile: {
      id: `oauth-${id}`,
      label: `${id}@example.test`,
      email: `${id}@example.test`,
      kind: "oauth",
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    payload: { kind: "oauth", authJson: raw },
  };
}

function authJson(id: string, token: string): string {
  return JSON.stringify({ __id: id, token });
}

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "grok-auth-service-test-"));
  roots.push(root);
  return root;
}

async function waitUntil(predicate: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for condition");
    await delay(20);
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
