import { execFile, spawn } from "node:child_process";
import { access, appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import type { AppSettings, CliCapabilityEvidence, CliCompatibilitySnapshot, CliRuntimeHandshake, CliUpdatePreview, CliUpdateReceipt, CliUpdateRecord, CliVersionStatus } from "../../shared/types";
import { buildCliEnv, checkCliUpdate, CLI_CHANGELOG_URL, compareVersions, isLockedBinaryError, locateGrokCli, parseVersion, readCliVersion } from "./cli-locator";
import { GrokAcpAdapter } from "./grok-acp-adapter";
import { redactSecrets, type LogService } from "./log-service";
import type { LiveSessionSnapshot } from "./grok-process-manager";

export interface CliUpdateServiceRuntime {
  locateCli(settings: AppSettings): Promise<string | undefined>;
  readVersion(cliPath: string, env: NodeJS.ProcessEnv): Promise<string | undefined>;
  check(cliPath: string, env: NodeJS.ProcessEnv): Promise<CliVersionStatus>;
  runUpdate(cliPath: string, args: string[], env: NodeJS.ProcessEnv): Promise<void>;
  probe(cliPath: string, env: NodeJS.ProcessEnv): Promise<CliCompatibilitySnapshot>;
}

export class CliUpdateService {
  private readonly historyPath: string;
  private readonly compatibilityPath: string;
  private activeApply?: { key: string; operation: Promise<CliUpdateReceipt> };
  private latestCompatibility?: CliCompatibilitySnapshot;

  constructor(
    userDataPath: string,
    private readonly getSettings: () => Promise<AppSettings>,
    private readonly getApiKey: () => Promise<string | undefined>,
    private readonly suspendSessions: () => Promise<LiveSessionSnapshot[]>,
    private readonly restoreSessions: (snapshots: LiveSessionSnapshot[]) => Promise<void>,
    private readonly log: LogService,
    private readonly optionalCapabilities?: { pluginDir?: string; computerHostPath?: string },
    private readonly testRuntime?: CliUpdateServiceRuntime,
  ) {
    this.historyPath = join(userDataPath, "cli-update-history.jsonl");
    this.compatibilityPath = join(userDataPath, "cli-compatibility-snapshot.json");
  }

  async check(): Promise<CliVersionStatus> {
    const settings = await this.getSettings();
    const cliPath = await (this.testRuntime?.locateCli(settings) ?? locateGrokCli(settings.cliPath));
    if (!cliPath) return { found: false, error: "未找到 Grok CLI" };
    const env = buildCliEnv(settings, await this.getApiKey());
    const status = await (this.testRuntime?.check(cliPath, env) ?? checkCliUpdate(cliPath, env));
    await this.record({ at: new Date().toISOString(), from: status.currentVersion, to: status.latestVersion, status: "checked", message: status.error || (status.updateAvailable ? "发现可用更新" : "已是最新版本") });
    return status;
  }

  async preview(): Promise<CliUpdatePreview> {
    const status = await this.check();
    if (!status.currentVersion) throw new Error(status.error || "无法读取当前 Grok CLI 版本");
    if (!status.latestVersion) throw new Error(status.error || "stable 更新源没有返回目标版本");
    if (!status.updateAvailable) throw new Error(`Grok CLI ${status.currentVersion} 已是当前 stable 通道最新版本`);
    return {
      fromVersion: status.currentVersion,
      targetVersion: status.latestVersion,
      channel: status.channel,
      installer: status.installer,
      autoUpdate: status.autoUpdate,
      changelogUrl: status.changelogUrl ?? CLI_CHANGELOG_URL,
      publicLatestVersion: status.publicLatestVersion,
      publicVersionAhead: compareVersions(status.publicLatestVersion, status.latestVersion) > 0,
    };
  }

  async apply(input: { targetVersion: string; expectedCurrentVersion: string }): Promise<CliUpdateReceipt> {
    const targetVersion = normalizedVersion(input.targetVersion, "目标版本");
    const expectedCurrentVersion = normalizedVersion(input.expectedCurrentVersion, "当前版本");
    const key = `${expectedCurrentVersion}->${targetVersion}`;
    if (this.activeApply) {
      if (this.activeApply.key !== key) throw new Error(`另一个 CLI 更新正在执行（${this.activeApply.key}）`);
      return this.activeApply.operation;
    }
    const operation = this.applyOnce({ targetVersion, expectedCurrentVersion });
    this.activeApply = { key, operation };
    try {
      return await operation;
    } finally {
      if (this.activeApply?.operation === operation) this.activeApply = undefined;
    }
  }

  async compatibility(): Promise<CliCompatibilitySnapshot> {
    if (this.latestCompatibility) return structuredClone(this.latestCompatibility);
    const settings = await this.getSettings();
    const cliPath = await (this.testRuntime?.locateCli(settings) ?? locateGrokCli(settings.cliPath));
    if (!cliPath) throw new Error("未找到 Grok CLI");
    const env = buildCliEnv(settings, await this.getApiKey());
    const currentVersion = await (this.testRuntime?.readVersion(cliPath, env) ?? readCliVersion(cliPath, env));
    const persisted = await readFile(this.compatibilityPath, "utf8").then((value) => JSON.parse(value) as CliCompatibilitySnapshot).catch(() => undefined);
    if (persisted?.cliVersion && persisted.cliVersion === currentVersion) {
      this.latestCompatibility = persisted;
      return structuredClone(persisted);
    }
    this.latestCompatibility = await (this.testRuntime?.probe(cliPath, env) ?? this.probe(cliPath, env));
    return structuredClone(this.latestCompatibility);
  }

  private async applyOnce(input: { targetVersion: string; expectedCurrentVersion: string }): Promise<CliUpdateReceipt> {
    const settings = await this.getSettings();
    const cliPath = await (this.testRuntime?.locateCli(settings) ?? locateGrokCli(settings.cliPath));
    if (!cliPath) throw new Error("未找到 Grok CLI");
    const env = buildCliEnv(settings, await this.getApiKey());
    const previousRaw = await (this.testRuntime?.readVersion(cliPath, env) ?? readCliVersion(cliPath, env));
    const previous = parseVersion(previousRaw)?.join(".");
    if (!previous) throw new Error("无法读取当前 Grok CLI 版本，已取消更新");
    if (previous !== input.expectedCurrentVersion) throw new Error(`CLI 当前版本已从 ${input.expectedCurrentVersion} 变为 ${previous}，请重新检查更新`);
    const stable = await (this.testRuntime?.check(cliPath, env) ?? checkCliUpdate(cliPath, env));
    if (stable.error) throw new Error(`重新检查 stable 更新源失败：${stable.error}`);
    if (stable.currentVersion && stable.currentVersion !== previous) throw new Error(`stable 更新源报告的当前版本 ${stable.currentVersion} 与本机 ${previous} 不一致`);
    if (stable.latestVersion !== input.targetVersion) throw new Error(`stable 更新目标已从 ${input.targetVersion} 变为 ${stable.latestVersion || "未知"}，请重新确认`);
    if (!stable.updateAvailable) throw new Error(`stable 更新源不再提供 ${input.targetVersion}`);
    const suspended = await this.suspendSessions();
    let primaryFailure: unknown;
    try {
      await (this.testRuntime?.runUpdate(cliPath, ["update", "--version", input.targetVersion], env) ?? this.runUpdate(cliPath, ["update", "--version", input.targetVersion], env));
      const current = parseVersion(await (this.testRuntime?.readVersion(cliPath, env) ?? readCliVersion(cliPath, env)))?.join(".");
      if (current !== input.targetVersion) throw new Error(`更新命令结束后版本为 ${current || "未知"}，不是固定目标 ${input.targetVersion}`);
      const compatibility = await (this.testRuntime?.probe(cliPath, env) ?? this.probe(cliPath, env));
      this.latestCompatibility = compatibility;
      const verifiedAt = new Date().toISOString();
      const message = "固定目标更新完成；ACP initialize/session/new、空会话官方删除和基础扩展验证通过";
      await this.record({ at: verifiedAt, from: previous, to: current, status: "updated", message });
      return { fromVersion: previous, toVersion: current, status: "updated", verifiedAt, message, compatibility };
    } catch (error) {
      primaryFailure = error;
      const message = error instanceof Error ? error.message : String(error);
      await this.log.log(`CLI update verification failed: ${message}`);
      try {
        await (this.testRuntime?.runUpdate(cliPath, ["update", "--version", previous], env) ?? this.runUpdate(cliPath, ["update", "--version", previous], env));
        const current = parseVersion(await (this.testRuntime?.readVersion(cliPath, env) ?? readCliVersion(cliPath, env)))?.join(".");
        if (current !== previous) throw new Error(`回滚命令结束后版本为 ${current || "未知"}`);
        const compatibility = await (this.testRuntime?.probe(cliPath, env) ?? this.probe(cliPath, env));
        this.latestCompatibility = compatibility;
        const verifiedAt = new Date().toISOString();
        const rollbackMessage = `新版本验证失败，已回滚到 ${previous}：${message}`;
        await this.record({ at: verifiedAt, from: input.targetVersion, to: previous, status: "rolled-back", message: rollbackMessage });
        return { fromVersion: input.targetVersion, toVersion: previous, status: "rolled-back", verifiedAt, message: rollbackMessage, compatibility };
      } catch (rollbackError) {
        const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        await this.record({ at: new Date().toISOString(), from: previous, status: "failed", message: `更新失败且回滚未通过：${rollbackMessage}` });
        throw new Error(`CLI 更新失败且回滚未通过：${rollbackMessage}`);
      }
    } finally {
      if (suspended.length) {
        try {
          await this.restoreSessions(suspended);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await this.log.log(`CLI update session restore failed: ${message}`);
          throw new Error(`${primaryFailure ? "CLI 更新验证结束后" : "CLI 已更新，但"}部分会话恢复失败：${message}`);
        }
      }
    }
  }

  async history(): Promise<CliUpdateRecord[]> {
    const raw = await readFile(this.historyPath, "utf8").catch(() => "");
    return raw.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line) as CliUpdateRecord]; } catch { return []; }
    }).slice(-100).reverse();
  }

  private async runUpdate(cliPath: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await runProcessTree(cliPath, args, env, 180_000);
        await this.log.log(result.stdout || result.stderr || `grok ${args.join(" ")} complete`);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt === 0 && isLockedBinaryError(message)) {
          await new Promise((resolve) => setTimeout(resolve, 2_000));
          continue;
        }
        throw error;
      }
    }
  }

  private async probe(cliPath: string, env: NodeJS.ProcessEnv): Promise<CliCompatibilitySnapshot> {
    const cwd = await mkdtemp(join(tmpdir(), "grok-desktop-probe-"));
    const adapter = new GrokAcpAdapter({ cliPath, cwd, env, effort: "", mode: "agent", log: this.log });
    try {
      const { sessionId } = await adapter.start();
      const declaredExtensions = new Set(adapter.runtimeHandshake?.extensions ?? []);
      const successfulExtensions = new Set<string>();
      for (const method of ["x.ai/plugins/list", "x.ai/mcp/list", "x.ai/commands/list"]) {
        await adapter.extension(method, method === "x.ai/mcp/list" ? { cache: false } : {})
          .then(() => {
            successfulExtensions.add(method);
            return this.log.log(`Optional compatibility: ${method} available`);
          })
          .catch((error) => this.log.log(`Optional compatibility: ${method} unavailable (${error instanceof Error ? error.message : String(error)})`));
      }
      const reader = join(homedir(), ".grok", "bundled", "skills", "shared", "resume-session", "session_reader.py");
      await access(reader).then(() => this.log.log("Optional compatibility: Codex session reader found")).catch(() => this.log.log("Optional compatibility: Codex session reader unavailable"));
      await this.probeOptionalComputerCapability(cliPath, cwd, env);
      await adapter.dispose();
      await this.deleteProbeSession(cliPath, sessionId, env);
      const handshake = adapter.runtimeHandshake;
      const capabilities = compatibilityEvidence(handshake, declaredExtensions, successfulExtensions);
      const snapshot = { cliVersion: await readCliVersion(cliPath, env), checkedAt: new Date().toISOString(), handshake, capabilities } satisfies CliCompatibilitySnapshot;
      await this.saveCompatibility(snapshot);
      return snapshot;
    } finally {
      await adapter.dispose().catch(() => undefined);
      await rm(cwd, { recursive: true, force: true });
    }
  }

  private async deleteProbeSession(cliPath: string, sessionId: string, env: NodeJS.ProcessEnv): Promise<void> {
    if (!sessionId) throw new Error("兼容性探针没有返回可删除的会话 ID");
    await runProcessTree(cliPath, ["--no-auto-update", "sessions", "delete", sessionId], env, 60_000);
  }

  private async saveCompatibility(snapshot: CliCompatibilitySnapshot): Promise<void> {
    await mkdir(dirname(this.compatibilityPath), { recursive: true });
    const temporary = `${this.compatibilityPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, JSON.stringify(snapshot, null, 2), "utf8");
    await rename(temporary, this.compatibilityPath).catch(async () => {
      await rm(this.compatibilityPath, { force: true });
      await rename(temporary, this.compatibilityPath);
    });
  }

  private async probeOptionalComputerCapability(cliPath: string, cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
    const pluginDir = this.optionalCapabilities?.pluginDir;
    const computerHostPath = this.optionalCapabilities?.computerHostPath;
    if (computerHostPath) {
      await access(computerHostPath)
        .then(() => probeComputerHost(computerHostPath))
        .then((version) => this.log.log(`Optional compatibility: GrokComputerHost self-test passed (${version})`))
        .catch((error) => this.log.log(`Optional compatibility: GrokComputerHost unavailable (${error instanceof Error ? error.message : String(error)})`));
    }
    if (!pluginDir) return;
    const optionalAdapter = new GrokAcpAdapter({ cliPath, cwd, env, effort: "", mode: "agent", log: this.log, pluginDirs: [pluginDir] });
    try {
      await optionalAdapter.start();
      const commands = await optionalAdapter.waitForCommands(3_000);
      if (!commands.some((command) => command.name.replace(/^\//, "") === "computer")) throw new Error("未发布 /computer Skill");
      await this.log.log("Optional compatibility: process/session pluginDirs published /computer");
    } catch (error) {
      // Computer Use is optional. Losing it must disable/diagnose the extension,
      // never roll back a CLI whose core initialize + session/new still works.
      await this.log.log(`Optional compatibility: Computer Use plugin unavailable (${error instanceof Error ? error.message : String(error)})`);
    } finally {
      await optionalAdapter.dispose().catch(() => undefined);
    }
  }

  private async record(record: CliUpdateRecord): Promise<void> {
    await mkdir(dirname(this.historyPath), { recursive: true });
    await appendFile(this.historyPath, `${JSON.stringify({ ...record, message: redactSecrets(record.message) })}\n`, "utf8");
  }
}

function probeComputerHost(executable: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let buffer = ""; let settled = false;
    const finish = (error?: Error, version?: string): void => {
      if (settled) return; settled = true; clearTimeout(timer); if (!child.killed) child.kill();
      if (error) reject(error); else resolve(version || "unknown");
    };
    child.once("error", (error) => finish(error));
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString(); const newline = buffer.indexOf("\n"); if (newline < 0) return;
      try {
        const message = JSON.parse(buffer.slice(0, newline)) as { ok?: boolean; result?: { version?: string; x64?: boolean }; error?: string };
        if (!message.ok || !message.result?.x64) finish(new Error(message.error || "Computer Host x64 self-test failed"));
        else finish(undefined, message.result.version);
      } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    });
    child.stdin.write(`${JSON.stringify({ id: 1, action: "self_test", input: {} })}\n`);
    const timer = setTimeout(() => finish(new Error("Computer Host self-test timed out")), 10_000);
  });
}

function runProcessTree(executable: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const batch = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(executable);
    const command = batch ? (env.ComSpec || process.env.ComSpec || "cmd.exe") : executable;
    const commandArgs = batch ? ["/d", "/s", "/c", windowsBatchCommand(executable, args)] : args;
    const child = spawn(command, commandArgs, { env, windowsHide: true, shell: false, windowsVerbatimArguments: batch, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve({ stdout, stderr });
    };
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (error) => finish(error));
    child.once("exit", (code, signal) => {
      if (code === 0) finish();
      else finish(new Error(`${executable} ${args.join(" ")} failed (${String(code ?? signal)}): ${stderr || stdout}`));
    });
    const timer = setTimeout(() => {
      const error = new Error(`${executable} ${args.join(" ")} timed out after ${timeoutMs} ms`);
      if (process.platform === "win32" && child.pid) {
        execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], () => finish(error));
      } else {
        child.kill("SIGKILL");
        finish(error);
      }
    }, timeoutMs);
  });
}

function windowsBatchCommand(executable: string, args: string[]): string {
  const values = [executable, ...args];
  if (values.some((value) => /[\r\n"&|<>^%!]/.test(value))) {
    throw new Error("批处理 CLI 路径或参数包含不安全的 cmd.exe 元字符");
  }
  return `call ${values.map((value) => `"${value}"`).join(" ")}`;
}

function normalizedVersion(value: string, label: string): string {
  const parsed = parseVersion(value)?.join(".");
  if (!parsed || parsed !== value.trim()) throw new Error(`${label}格式无效`);
  return parsed;
}

function compatibilityEvidence(
  handshake?: CliRuntimeHandshake,
  declaredExtensions = new Set(handshake?.extensions ?? []),
  successfulExtensions = new Set<string>(),
): CliCapabilityEvidence[] {
  const at = handshake?.checkedAt ?? new Date().toISOString();
  if (!handshake) return [{ name: "acp.initialize", state: "unknown", source: "successful-probe", observedAt: at, reason: "initialize 未返回可规范化的握手" }];
  const evidence: CliCapabilityEvidence[] = [
    { name: "acp.initialize", state: "supported", source: "successful-probe", observedAt: at },
    { name: "session.new", state: "supported", source: "successful-probe", observedAt: at },
  ];
  const declared = (name: string, value: boolean | undefined): void => {
    evidence.push({ name, state: value === undefined ? "unknown" : value ? "supported" : "unsupported", source: "runtime-declaration", observedAt: at });
  };
  declared("session.list", handshake.sessionCapabilities?.list);
  declared("session.recap", handshake.features.recap);
  declared("session.rewind", handshake.features.rewind || handshake.features.cancelRewind);
  declared("mcp", Boolean(handshake.mcpCapabilities && Object.values(handshake.mcpCapabilities).some(Boolean)));
  declared("plugins.directories", handshake.features.pluginDirectories);
  declared("fs.notifications", handshake.features.fsNotifications);
  declared("voice", handshake.features.voiceMode);
  if (handshake.commands.length) evidence.push({ name: "commands", state: "supported", source: "runtime-declaration", observedAt: at });
  if (handshake.models.length) evidence.push({ name: "models", state: "supported", source: "runtime-declaration", observedAt: at });
  for (const extension of ["x.ai/btw", "x.ai/follow_ups", "x.ai/models/update", "x.ai/settings/update", "x.ai/session/usage", "x.ai/session/delete", "x.ai/git/status", "x.ai/mcp/status", "x.ai/plugins/list", "x.ai/mcp/list", "x.ai/commands/list"]) {
    const declared = declaredExtensions.has(extension);
    const probed = successfulExtensions.has(extension);
    evidence.push({
      name: extension,
      state: declared || probed ? "supported" : "unknown",
      source: declared ? "runtime-declaration" : probed ? "successful-probe" : "runtime-declaration",
      observedAt: at,
      ...(!declared && !probed ? { reason: "当前 initialize 未声明且未成功探测" } : {}),
    });
  }
  return evidence;
}
