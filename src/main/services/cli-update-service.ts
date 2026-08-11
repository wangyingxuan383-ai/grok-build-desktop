import { execFile, spawn } from "node:child_process";
import { access, appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import type { AppSettings, CliCapabilityEvidence, CliCompatibilityGate, CliCompatibilitySnapshot, CliMajorCompatibilityProfile, CliRuntimeHandshake, CliUpdatePreview, CliUpdateReceipt, CliUpdateRecord, CliV1RuntimeSnapshot, CliVersionStatus } from "../../shared/types";
import { buildCliEnv, checkCliUpdate, CLI_CHANGELOG_URL, compareVersions, isLockedBinaryError, isMajorUpgrade, locateGrokCli, parseVersion, readCliVersion } from "./cli-locator";
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

export const CLI_V1_COMPATIBILITY_PROFILE: CliMajorCompatibilityProfile = {
  major: 1,
  targetVersion: "1.0.0",
  label: "Grok Build CLI 1.x",
  requiredChecks: [
    "v1-wire-fixture",
    "desktop-attach-policy",
    "session-close-outcome",
    "mcp-slash-events",
    "git-explicit-options",
    "context-usage-session-info",
    "managed-no-auto-update",
  ],
  changelogUrl: CLI_CHANGELOG_URL,
};

export function offlineCompatibilityGate(targetVersion: string): CliCompatibilityGate | undefined {
  const major = parseVersion(targetVersion)?.[0];
  if (major === undefined || major < 1) return undefined;
  const at = new Date().toISOString();
  if (major !== 1) return {
    targetVersion,
    major,
    status: "failed",
    checkedAt: at,
    liveVerified: false,
    checks: [{ id: "unknown-major", label: `CLI ${major}.x 兼容契约`, status: "failed", source: "fixture", message: "Desktop 尚未记录该主版本的 Wire Fixture" }],
  };
  return {
    targetVersion,
    major,
    status: "passed",
    checkedAt: at,
    liveVerified: false,
    checks: CLI_V1_COMPATIBILITY_PROFILE.requiredChecks.map((id) => ({
      id,
      label: ({
        "v1-wire-fixture": "1.0.0 initialize/事件 Wire Fixture",
        "desktop-attach-policy": "交互式 Session 附加策略",
        "session-close-outcome": "session/close 结构化结果解析",
        "mcp-slash-events": "MCP 1.0 斜杠事件规范化",
        "git-explicit-options": "Git status 显式选项",
        "context-usage-session-info": "Context / Usage / Session Info 数据视图",
        "managed-no-auto-update": "受管 CLI 禁止绕过 Desktop 更新器",
      } as Record<string, string>)[id] ?? id,
      status: "passed",
      source: "fixture",
    })),
  };
}

export function runtimeV1Compatibility(
  cliVersion: string | undefined,
  handshake: CliRuntimeHandshake | undefined,
  closeOutcomeSupported: boolean,
  successfulCapabilities = new Set<string>(),
): { snapshot?: CliV1RuntimeSnapshot; gate?: CliCompatibilityGate } {
  const major = parseVersion(cliVersion)?.[0];
  if (major !== 1) return {};
  const at = new Date().toISOString();
  const extensionSet = new Set(handshake?.extensions ?? []);
  const commands = new Set((handshake?.commands ?? []).map((value) => value.replace(/^\//, "").toLowerCase()));
  const declaredMcp = Boolean(handshake?.mcpCapabilities && Object.values(handshake.mcpCapabilities).some(Boolean));
  // The first stable 1.0.0 Windows binary advertises `/context` and
  // `/session-info`, but its ACP router still returns method-not-found for the
  // newer x.ai/session/info and x.ai/session/usage extensions present in the
  // public source snapshot.  These views are optional product capabilities,
  // not a reason to roll back an otherwise healthy major upgrade.  Record the
  // exact observed subset and keep the missing views pending/fail-closed in the
  // UI instead of pretending the extension exists.
  const dataViews = new Set<CliV1RuntimeSnapshot["dataViews"][number]>();
  if (commands.has("context") || successfulCapabilities.has("x.ai/session/info") || extensionSet.has("x.ai/session/info")) dataViews.add("context");
  if (commands.has("session-info") || successfulCapabilities.has("x.ai/session/info") || extensionSet.has("x.ai/session/info")) dataViews.add("session-info");
  if (commands.has("usage") || successfulCapabilities.has("x.ai/session/usage") || extensionSet.has("x.ai/session/usage")) dataViews.add("usage");
  const completeDataViews = dataViews.size === 3;
  const officialGitStatusObserved = successfulCapabilities.has("x.ai/git/status") || extensionSet.has("x.ai/git/status");
  const checks: CliCompatibilityGate["checks"] = [
    { id: "agent-version", label: "initialize 报告 1.x Agent", status: parseVersion(handshake?.agentVersion)?.[0] === 1 ? "passed" : "failed", source: "runtime" },
    { id: "session-close", label: "session/close 声明并返回可识别结果", status: handshake?.sessionCapabilities?.close === true && closeOutcomeSupported ? "passed" : "failed", source: "runtime" },
    { id: "mcp-runtime", label: "MCP 运行时状态（无服务器时可待观察）", status: declaredMcp ? "passed" : "pending", source: "runtime", ...(!declaredMcp ? { message: "当前探针未配置 MCP；1.0 事件解析已由 Wire Fixture 门禁覆盖" } : {}) },
    {
      id: "data-views",
      label: "Context / Usage / Session Info",
      status: completeDataViews ? "passed" : "pending",
      source: "runtime",
      ...(!completeDataViews ? { message: `当前 1.0.0 实际提供：${[...dataViews].join("、") || "未观察到"}；缺失视图保持禁用，不阻止核心 ACP 更新` } : {}),
    },
    { id: "managed-no-auto-update", label: "受管 CLI 禁止自动更新", status: "passed", source: "runtime" },
    {
      id: "git-explicit-options",
      label: "Git status 使用显式选项",
      status: officialGitStatusObserved ? "passed" : "pending",
      source: "runtime",
      ...(!officialGitStatusObserved ? { message: "当前 CLI 未提供 x.ai/git/status；Desktop 保持受限系统 Git 回退，调用官方接口时仍显式传递全部选项" } : {}),
    },
  ];
  const status = checks.some((item) => item.status === "failed") ? "failed" : "passed";
  return {
    snapshot: {
      version: cliVersion!,
      observedAt: at,
      attachPolicy: { nonInteractive: false, deliveryTools: [] },
      closeOutcomeSupported,
      mcpMethods: ["x.ai/mcp/init_progress", "x.ai/mcp/tools_changed", "x.ai/mcp/server_status", "x.ai/mcp/servers_updated", "x.ai/mcp_initialized"],
      gitStatusUsesExplicitOptions: true,
      dataViews: [...dataViews],
    },
    gate: { targetVersion: cliVersion!, major: 1, status, checkedAt: at, checks, liveVerified: status === "passed" },
  };
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
    const compatibilityGate = offlineCompatibilityGate(status.latestVersion);
    return {
      fromVersion: status.currentVersion,
      targetVersion: status.latestVersion,
      channel: status.channel,
      installer: status.installer,
      autoUpdate: status.autoUpdate,
      changelogUrl: status.changelogUrl ?? CLI_CHANGELOG_URL,
      publicLatestVersion: status.publicLatestVersion,
      publicVersionAhead: compareVersions(status.publicLatestVersion, status.latestVersion) > 0,
      majorUpgrade: status.majorUpgrade ?? isMajorUpgrade(status.currentVersion, status.latestVersion),
      ...(compatibilityGate ? { compatibilityGate } : {}),
    };
  }

  async apply(input: { targetVersion: string; expectedCurrentVersion: string; allowMajorUpgrade?: boolean }): Promise<CliUpdateReceipt> {
    const targetVersion = normalizedVersion(input.targetVersion, "目标版本");
    const expectedCurrentVersion = normalizedVersion(input.expectedCurrentVersion, "当前版本");
    const key = `${expectedCurrentVersion}->${targetVersion}`;
    if (this.activeApply) {
      if (this.activeApply.key !== key) throw new Error(`另一个 CLI 更新正在执行（${this.activeApply.key}）`);
      return this.activeApply.operation;
    }
    if (isMajorUpgrade(expectedCurrentVersion, targetVersion) && input.allowMajorUpgrade !== true) {
      throw new Error(`Grok CLI ${targetVersion} 是跨主版本更新；请重新预览并明确确认后再安装`);
    }
    const offlineGate = offlineCompatibilityGate(targetVersion);
    if (offlineGate?.status === "failed") throw new Error(`Grok CLI ${targetVersion} 兼容门禁未通过：${offlineGate.checks.find((item) => item.status === "failed")?.message ?? "未知主版本"}`);
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
      // Re-derive the gate when Desktop's compatibility rules evolve.  The
      // persisted handshake/evidence remains the observation source, while a
      // stale gate must not keep optional capabilities enabled after an app
      // update (for example the first stable 1.0.0 binary lacks
      // x.ai/git/status and x.ai/session/usage despite newer source snapshots).
      this.latestCompatibility = enrichCompatibilitySnapshot(persisted, currentVersion);
      await this.saveCompatibility(this.latestCompatibility);
      return structuredClone(this.latestCompatibility);
    }
    this.latestCompatibility = enrichCompatibilitySnapshot(
      await (this.testRuntime?.probe(cliPath, env) ?? this.probe(cliPath, env)),
      currentVersion,
    );
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
      const compatibility = enrichCompatibilitySnapshot(
        await (this.testRuntime?.probe(cliPath, env) ?? this.probe(cliPath, env)),
        current,
      );
      if (parseVersion(current)?.[0] === 1 && compatibility.gate?.status !== "passed") {
        const failed = compatibility.gate?.checks.filter((item) => item.status === "failed").map((item) => item.label).join("、") || "运行时兼容门禁";
        throw new Error(`Grok CLI ${current} 实机 ACP 兼容门禁未通过：${failed}`);
      }
      this.latestCompatibility = compatibility;
      const verifiedAt = new Date().toISOString();
      const message = "固定目标更新完成；ACP initialize/session/new、结构化 close、空会话官方删除与核心兼容门禁通过；可选能力按运行时证据启用";
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
        const compatibility = enrichCompatibilitySnapshot(
          await (this.testRuntime?.probe(cliPath, env) ?? this.probe(cliPath, env)),
          current,
        );
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
        const result = await runProcessTree(cliPath, args, env, 360_000);
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
      const sessionInfo = await adapter.sessionInfo();
      await this.log.log(`Core compatibility: x.ai/session/info supported=${String(sessionInfo.supported)}`);
      if (sessionInfo.supported) successfulExtensions.add("x.ai/session/info");
      const sessionUsage = await adapter.sessionUsage();
      await this.log.log(`Core compatibility: x.ai/session/usage supported=${String(sessionUsage.supported)}`);
      if (sessionUsage.supported) successfulExtensions.add("x.ai/session/usage");
      const renameSource = await adapter.renameSession("Desktop compatibility probe");
      await this.log.log(`Optional compatibility: x.ai/session/rename source=${renameSource}`);
      if (renameSource === "official") successfulExtensions.add("x.ai/session/rename");
      const gitStatus = await adapter.officialGitStatus();
      if (gitStatus) successfulExtensions.add("x.ai/git/status");
      const reader = join(homedir(), ".grok", "bundled", "skills", "shared", "resume-session", "session_reader.py");
      await access(reader).then(() => this.log.log("Optional compatibility: Codex session reader found")).catch(() => this.log.log("Optional compatibility: Codex session reader unavailable"));
      await this.probeOptionalComputerCapability(cliPath, cwd, env);
      await adapter.dispose();
      await this.deleteProbeSession(cliPath, sessionId, env);
      const handshake = adapter.runtimeHandshake;
      const capabilities = compatibilityEvidence(handshake, declaredExtensions, successfulExtensions);
      const cliVersion = await readCliVersion(cliPath, env);
      const snapshot = enrichCompatibilitySnapshot(
        { cliVersion, checkedAt: new Date().toISOString(), handshake, capabilities },
        cliVersion,
        adapter.lastCloseReceipt?.completed === true,
      );
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

export function compatibilityEvidence(
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
  declared("session.resume", handshake.sessionCapabilities?.resume);
  declared("session.close", handshake.sessionCapabilities?.close);
  declared("session.recap", handshake.features.recap);
  declared("session.rewind", handshake.features.rewind);
  declared("session.cancel-rewind", handshake.features.cancelRewind);
  declared("mcp", Boolean(handshake.mcpCapabilities && Object.values(handshake.mcpCapabilities).some(Boolean)));
  declared("plugins.directories", handshake.features.pluginDirectories);
  declared("fs.notifications", handshake.features.fsNotifications);
  declared("voice", handshake.features.voiceMode);
  if (handshake.commands.length) evidence.push({ name: "commands", state: "supported", source: "runtime-declaration", observedAt: at });
  if (handshake.models.length) evidence.push({ name: "models", state: "supported", source: "runtime-declaration", observedAt: at });
  for (const extension of ["x.ai/btw", "x.ai/follow_ups", "x.ai/models/update", "x.ai/settings/update", "x.ai/session/info", "x.ai/session/usage", "x.ai/session/delete", "x.ai/session/rename", "x.ai/git/status", "x.ai/mcp/status", "x.ai/mcp/init_progress", "x.ai/mcp/tools_changed", "x.ai/mcp/server_status", "x.ai/mcp/servers_updated", "x.ai/mcp_initialized", "x.ai/plugins/list", "x.ai/mcp/list", "x.ai/commands/list"]) {
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

export function enrichCompatibilitySnapshot(
  snapshot: CliCompatibilitySnapshot,
  cliVersion = snapshot.cliVersion,
  closeOutcomeSupported = snapshot.v1?.closeOutcomeSupported ?? snapshot.gate?.checks.some((item) => item.id === "session-close" && item.status === "passed") ?? false,
): CliCompatibilitySnapshot {
  const major = parseVersion(cliVersion)?.[0];
  if (major !== 1) return snapshot;
  const successfulCapabilities = new Set(snapshot.capabilities.filter((item) => item.state === "supported").map((item) => item.name));
  const runtime = runtimeV1Compatibility(cliVersion, snapshot.handshake, closeOutcomeSupported, successfulCapabilities);
  return {
    ...snapshot,
    cliVersion,
    majorProfile: CLI_V1_COMPATIBILITY_PROFILE,
    ...(runtime.snapshot ? { v1: runtime.snapshot } : {}),
    ...(runtime.gate ? { gate: runtime.gate } : {}),
  };
}
