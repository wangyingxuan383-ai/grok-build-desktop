import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { JsonStore } from "./json-store";
import { deleteCliSession } from "./cli-session-service";
import type { CliUpdatePolicy, CliUpdateInput, CliUpdateState, CliUpdateAction } from "../../shared/types";
import { execFile, spawn } from "node:child_process";
import { access, appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import type { AppSettings, CliCapabilityEvidence, CliCompatibilityGate, CliCompatibilitySnapshot, CliMajorCompatibilityProfile, CliRuntimeHandshake, CliUpdatePreview, CliUpdateReceipt, CliUpdateRecord, CliV1RuntimeSnapshot, CliVersionStatus } from "../../shared/types";
import { buildCliEnv, checkCliUpdate, cliProxyRoute, CLI_CHANGELOG_URL, compareVersions, isLockedBinaryError, isMajorUpgrade, locateGrokCli, parseVersion, readCliVersion } from "./cli-locator";
import { GrokAcpAdapter } from "./grok-acp-adapter";
import { redactSecrets, type LogService } from "./log-service";
import type { LiveSessionSnapshot } from "./grok-process-manager";

export interface CliUpdateServiceRuntime {
  locateCli(settings: AppSettings): Promise<string | undefined>;
  readVersion(cliPath: string, env: NodeJS.ProcessEnv): Promise<string | undefined>;
  check(cliPath: string, env: NodeJS.ProcessEnv): Promise<CliVersionStatus>;
  runUpdate(cliPath: string, args: string[], env: NodeJS.ProcessEnv): Promise<void>;
  identity?(cliPath: string): Promise<string>;
  probe(cliPath: string, env: NodeJS.ProcessEnv): Promise<CliCompatibilitySnapshot>;
}

export const CLI_V1_COMPATIBILITY_PROFILE: CliMajorCompatibilityProfile = {
  major: 1,
  targetVersion: "1.0.13",
  minSupportedVersion: "1.0.0",
  maxVerifiedVersion: "1.0.13",
  stableTargetVersion: "1.0.13",
  fixtureVersions: ["1.0.0", "1.0.1", "1.0.2", "1.0.3", "1.0.4", "1.0.5", "1.0.6", "1.0.7", "1.0.8", "1.0.9", "1.0.10", "1.0.11", "1.0.12", "1.0.13"],
  liveVerifiedVersion: "1.0.3",
  label: "Grok Build CLI 1.x",
  requiredChecks: [
    "v1-wire-fixture",
    "desktop-attach-policy",
    "session-close-outcome",
    "mcp-slash-events",
    "mcp-elicitation",
    "image-aware-read",
    "desktop-client-identity",
    "git-explicit-options",
    "context-usage-session-info",
    "managed-no-auto-update",
  ],
  changelogUrl: CLI_CHANGELOG_URL,
};

const CLI_UPDATE_TIMEOUT_MS = 30 * 60_000;

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
  const parsed = parseVersion(targetVersion);
  if (compareVersions(targetVersion, CLI_V1_COMPATIBILITY_PROFILE.minSupportedVersion) < 0
    || parsed?.[1] !== 0) {
    return {
      targetVersion,
      major,
      status: "failed",
      checkedAt: at,
      liveVerified: false,
      checks: [{
        id: "unverified-release-line",
        label: `CLI ${targetVersion} 兼容契约`,
        status: "failed",
        source: "fixture",
        message: `Desktop 当前只允许 ${CLI_V1_COMPATIBILITY_PROFILE.minSupportedVersion}–${CLI_V1_COMPATIBILITY_PROFILE.maxVerifiedVersion} 及经实机门禁验证的后续 1.0.x 补丁；1.1+ 保持失败关闭`,
      }],
    };
  }
  if (compareVersions(targetVersion, CLI_V1_COMPATIBILITY_PROFILE.maxVerifiedVersion) > 0) {
    return {
      targetVersion,
      major,
      status: "pending",
      checkedAt: at,
      liveVerified: false,
      checks: [{
        id: "future-patch-live-gate",
        label: `CLI ${targetVersion} 同发行线实机门禁`,
        status: "pending",
        source: "runtime",
        message: `这是尚未随 Desktop 发布审计的 1.0.x 补丁。仅在用户明确点击后固定目标安装，并须通过 initialize/session/new/close/delete 运行时门禁；失败自动回滚。`,
      }],
    };
  }
  return {
    targetVersion,
    major,
    status: "passed",
    checkedAt: at,
    liveVerified: false,
    checks: CLI_V1_COMPATIBILITY_PROFILE.requiredChecks.map((id) => ({
      id,
      label: ({
        "v1-wire-fixture": "1.0.0–1.0.13 initialize/事件 Wire Fixture",
        "desktop-attach-policy": "交互式 Session 附加策略",
        "session-close-outcome": "session/close 结构化结果解析",
        "mcp-slash-events": "MCP 1.0 斜杠事件规范化",
        "mcp-elicitation": "MCP form/URL elicitation 反向请求",
        "image-aware-read": "图片读取由 1.0.4+ CLI 原生处理",
        "desktop-client-identity": "ACP initialize 稳定客户端身份",
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
  const offlineGate = offlineCompatibilityGate(cliVersion ?? "");
  if (offlineGate?.status === "failed") return { gate: offlineGate };
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
      ...(!completeDataViews ? { message: `当前 ${cliVersion} 实际提供：${[...dataViews].join("、") || "未观察到"}；缺失视图保持禁用，不阻止核心 ACP 更新` } : {}),
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
      mcpMethods: [
        "x.ai/mcp/init_progress",
        "x.ai/mcp/tools_changed",
        "x.ai/mcp/server_status",
        "x.ai/mcp/servers_updated",
        "x.ai/mcp_initialized",
        ...(compareVersions(cliVersion, "1.0.8") >= 0 ? ["x.ai/mcp/elicit", "x.ai/mcp/elicit_complete"] : []),
      ],
      gitStatusUsesExplicitOptions: true,
      dataViews: [...dataViews],
    },
    gate: { targetVersion: cliVersion!, major: 1, status, checkedAt: at, checks, liveVerified: status === "passed" },
  };
}

export class CliUpdateService {
  private readonly recovery: JsonStore<{ recovery?: { previousVersion: string; targetVersion: string; snapshots: LiveSessionSnapshot[]; retained: boolean }; approvedIdentity?: string }>;
  private suspendedInMemory?: LiveSessionSnapshot[];
  private phase: CliUpdateState["phase"] = "idle";
  private readonly confirmations = new Map<string, { key: string; expires: number }>();
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
    this.recovery = new JsonStore(join(userDataPath, "cli-update-recovery.json"), {});
    this.historyPath = join(userDataPath, "cli-update-history.jsonl");
    this.compatibilityPath = join(userDataPath, "cli-compatibility-snapshot.json");
  }

  async check(): Promise<CliVersionStatus> {
    const settings = await this.getSettings();
    const cliPath = await (this.testRuntime?.locateCli(settings) ?? locateGrokCli(settings.cliPath));
    if (!cliPath) return { found: false, error: "未找到 Grok CLI" };
    const env = buildCliEnv(settings, await this.getApiKey());
    const status = await (this.testRuntime?.check(cliPath, env) ?? checkCliUpdate(cliPath, env));
    await this.record({ at: new Date().toISOString(), from: status.currentVersion, to: status.latestVersion, status: "checked", message: status.error || (status.updateAvailable ? "发现可用更新" : "已是最新版本") }).catch(() => undefined);
    return { ...status, proxyRoute: cliProxyRoute(settings, env) };
  }

  async state(): Promise<CliUpdateState> {
    const value = (await this.recovery.get()).recovery;
    return { phase: this.phase, ...(value ? { recovery: { previousVersion: value.previousVersion, targetVersion: value.targetVersion, retained: value.retained } } : {}) };
  }

  async preview(policy: CliUpdatePolicy = "standard", action: CliUpdateAction = "update"): Promise<CliUpdatePreview> {
    let status: CliVersionStatus;
    if (action === "update") status = await this.check();
    else {
      const recovery = (await this.recovery.get()).recovery;
      if (!recovery) throw new Error("没有待恢复的 CLI 更新事务");
      // Recovery is pinned to its transaction, not today's stable channel or
      // that channel's network availability. The installer can still fail to download.
      const settings = await this.getSettings();
      const cliPath = await (this.testRuntime?.locateCli(settings) ?? locateGrokCli(settings.cliPath));
      if (!cliPath) throw new Error("未找到 Grok CLI");
      const env = buildCliEnv(settings, await this.getApiKey());
      const current = await (this.testRuntime?.readVersion(cliPath, env) ?? readCliVersion(cliPath, env));
      status = { found: true, currentVersion: parseVersion(current)?.join("."), latestVersion: action === "rollback" ? recovery.previousVersion : recovery.targetVersion, updateAvailable: true, proxyRoute: cliProxyRoute(settings, env) };
    }
    if (!status.currentVersion) throw new Error(status.error || "无法读取当前 Grok CLI 版本");
    if (!status.latestVersion) throw new Error(status.error || "stable 更新源没有返回目标版本");
    if (!status.updateAvailable) throw new Error(`Grok CLI ${status.currentVersion} 已是当前 stable 通道最新版本`);
    const compatibilityGate = offlineCompatibilityGate(status.latestVersion);
    const confirmationToken = randomUUID();
    for (const [id, item] of this.confirmations) if (item.expires < Date.now()) this.confirmations.delete(id);
    if (this.confirmations.size >= 64) this.confirmations.delete(this.confirmations.keys().next().value!);
    this.confirmations.set(confirmationToken, { key: `${status.currentVersion}->${status.latestVersion}:${policy}:${action}`, expires: Date.now() + 10 * 60_000 });
    return {
      policy, confirmationToken,
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
      proxyRoute: status.proxyRoute,
    };
  }

  async apply(input: CliUpdateInput): Promise<CliUpdateReceipt> {
    const targetVersion = normalizedVersion(input.targetVersion, "目标版本");
    const expectedCurrentVersion = normalizedVersion(input.expectedCurrentVersion, "当前版本");
    const policy = input.policy ?? "standard";
    const action = input.action ?? "update";
    const key = `${expectedCurrentVersion}->${targetVersion}:${policy}:${action}`;
    if (this.activeApply) {
      if (this.activeApply.key !== key) throw new Error(`另一个 CLI 更新正在执行（${this.activeApply.key}）`);
      return this.activeApply.operation;
    }
    if (isMajorUpgrade(expectedCurrentVersion, targetVersion) && input.allowMajorUpgrade !== true) {
      throw new Error(`Grok CLI ${targetVersion} 是跨主版本更新；请重新预览并明确确认后再安装`);
    }
    const offlineGate = offlineCompatibilityGate(targetVersion);
    if (action === "update" && policy === "standard" && offlineGate?.status === "failed") throw new Error(`Grok CLI ${targetVersion} 兼容门禁未通过：${offlineGate.checks.find((item) => item.status === "failed")?.message ?? "未知主版本"}`);
    const confirmation = this.confirmations.get(input.confirmationToken ?? "");
    if (!confirmation || confirmation.key !== key || confirmation.expires < Date.now()) throw new Error("CLI 更新确认已失效，请重新预览并确认");
    this.confirmations.delete(input.confirmationToken!);
    const operation = this.applyOnce({ targetVersion, expectedCurrentVersion, policy, action });
    this.activeApply = { key, operation };
    try {
      return await operation;
    } finally {
      if (this.activeApply?.operation === operation) { this.activeApply = undefined; this.phase = "idle"; }
    }
  }

  isActive(): boolean {
    return Boolean(this.activeApply);
  }

  async waitForActive(): Promise<CliUpdateReceipt | undefined> {
    return this.activeApply?.operation;
  }

  /**
   * Decide whether the ordinary session launcher may attach to this CLI.
   *
   * Source-reviewed releases are accepted by the shipped offline contract.
   * A newer patch on the same 1.0 line is accepted only after this exact
   * Desktop installation has completed the fixed-target updater's live ACP
   * probe and persisted a passing receipt. This keeps the updater flexible
   * without silently trusting a CLI that was replaced outside the app.
   */
  async isRuntimeVersionAllowed(version: string): Promise<boolean> {
    if (!parseVersion(version)) return false;
    const saved = await this.recovery.get();
    if (saved.recovery?.retained) return false;
    const gate = offlineCompatibilityGate(version);
    if (!gate || gate.status === "passed") return true;
    if (!saved.approvedIdentity) return false;
    const settings = await this.getSettings();
    const path = await (this.testRuntime?.locateCli(settings) ?? locateGrokCli(settings.cliPath));
    return Boolean(path && saved.approvedIdentity === await this.binaryIdentity(path, version));
  }

  private async binaryIdentity(path: string, version: string): Promise<string> {
    if (this.testRuntime?.identity) return `${version}:${await this.testRuntime.identity(path)}`;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return `${resolve(path).toLowerCase()}:${version}:${hash.digest("hex")}`;
  }

  private async diagnostic(message: string): Promise<void> {
    try { await this.log.log(message); } catch { /* diagnostics must never control settlement */ }
  }

  async compatibility(): Promise<CliCompatibilitySnapshot> {
    if ((await this.recovery.get()).recovery?.retained) throw new Error("CLI 尚未通过验证，请在更新中心重新验证或回滚；不会自动启动诊断 ACP 会话");
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

  private async applyOnce(input: CliUpdateInput): Promise<CliUpdateReceipt> {
    const policy = input.policy ?? "standard";
    const action = input.action ?? "update";
    this.phase = "preparing";
    const settings = await this.getSettings();
    const cliPath = await (this.testRuntime?.locateCli(settings) ?? locateGrokCli(settings.cliPath));
    if (!cliPath) throw new Error("未找到 Grok CLI");
    const env = buildCliEnv(settings, await this.getApiKey());
    const readVersion = async () => parseVersion(await (this.testRuntime?.readVersion(cliPath, env) ?? readCliVersion(cliPath, env)))?.join(".");
    const previous = await readVersion();
    if (!previous || previous !== input.expectedCurrentVersion) throw new Error("CLI 当前版本已改变或无法识别，请重新检查更新");
    const saved = (await this.recovery.get()).recovery;
    if (action === "update") {
      if (saved) throw new Error("请先完成上次更新的重新验证或回滚");
      const stable = await (this.testRuntime?.check(cliPath, env) ?? checkCliUpdate(cliPath, env));
      if (stable.error) throw new Error(`重新检查 stable 更新源失败：${stable.error}`);
      if (stable.latestVersion !== input.targetVersion) throw new Error(`stable 更新目标已从 ${input.targetVersion} 变为 ${stable.latestVersion || "未知"}，请重新确认`);
      if (!stable.updateAvailable) throw new Error("stable 不再提供该目标");
    } else if (!saved || input.targetVersion !== (action === "rollback" ? saved.previousVersion : saved.targetVersion)) throw new Error("CLI 恢复目标已失效");
    const snapshots = this.suspendedInMemory ?? saved?.snapshots ?? await this.suspendSessions();
    this.suspendedInMemory = snapshots;
    const durableSnapshots = snapshots.map(({ sessionId, cwd, effort, mode, modelId }) => ({ sessionId, cwd, effort, mode, modelId }));
    const rollbackVersion = saved?.previousVersion ?? previous;
    let receipt: CliUpdateReceipt | undefined;
    let failure: Error | undefined;
    let retain = false;
    let targetInstalled = false;
    const probe = async (version: string) => {
      const identityBefore = await this.binaryIdentity(cliPath, version);
      const snapshot = await (this.testRuntime?.probe(cliPath, env) ?? this.probe(cliPath, env));
      // Core evidence must come from successful requests, independently of the version allowlist.
      if (!["acp.initialize", "session.new", "core.resume", "core.close", "core.delete"].every((name) => snapshot.capabilities.some((item) => item.name === name && item.state === "supported" && item.source === "successful-probe"))) throw new Error("ACP 核心探针未全部通过");
      if (snapshot.gate?.status === "failed" && policy === "standard" && action === "update") throw new Error("实机 ACP 兼容门禁未通过");
      this.latestCompatibility = snapshot;
      await this.recovery.mutate((data) => { data.approvedIdentity = undefined; });
      const identity = await this.binaryIdentity(cliPath, version);
      if (identity !== identityBefore || await readVersion() !== version) throw new Error("验证期间 CLI 二进制发生变化，请重新验证");
      await this.recovery.mutate((data) => { data.approvedIdentity = identity; if (data.recovery) data.recovery.retained = false; });
      return snapshot;
    };
    try {
      await this.recovery.mutate((data) => { data.recovery = { previousVersion: rollbackVersion, targetVersion: input.targetVersion, snapshots: durableSnapshots, retained: true }; });
      if (action !== "verify") {
        this.phase = action === "rollback" ? "rolling-back" : "downloading";
        await (this.testRuntime?.runUpdate(cliPath, ["update", "--version", input.targetVersion], env) ?? this.runUpdate(cliPath, ["update", "--version", input.targetVersion], env));
      }
      if (await readVersion() !== input.targetVersion) throw new Error("CLI 实际版本不是固定目标");
      targetInstalled = true;
      this.phase = "verifying";
      const compatibility = await probe(input.targetVersion);
      receipt = { fromVersion: previous, toVersion: input.targetVersion, status: action === "rollback" ? "rolled-back" : "updated", policy, verifiedAt: new Date().toISOString(), message: "固定目标及 ACP 核心验证完成", compatibility };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedStage = this.phase;
      await this.diagnostic(`CLI update failed: ${message}`);
      let current: string | undefined;
      try { current = await readVersion(); } catch (error) { await this.diagnostic(`CLI version recheck failed: ${String(error)}`); }
      if (action !== "rollback" && policy === "retain-unverified" && targetInstalled && current === input.targetVersion) {
        retain = true;
        receipt = { fromVersion: previous, toVersion: input.targetVersion, status: "retained-unverified", policy, failureStage: failedStage, verifiedAt: new Date().toISOString(), message: `新版已保留，但 ACP 验证失败，实时会话暂停：${message}`, sessionRestore: { status: "deferred" } };
      } else if (current === rollbackVersion && action === "update") {
        receipt = { fromVersion: previous, toVersion: current, status: "failed", policy, failureStage: failedStage, verifiedAt: new Date().toISOString(), message: `CLI 更新未改变当前版本 ${current}，无需回滚：${message}` };
        await this.recovery.mutate((data) => { if (data.recovery) data.recovery.retained = false; }).catch(() => undefined);
      } else {
        try {
          this.phase = "rolling-back";
          await (this.testRuntime?.runUpdate(cliPath, ["update", "--version", rollbackVersion], env) ?? this.runUpdate(cliPath, ["update", "--version", rollbackVersion], env));
          if (await readVersion() !== rollbackVersion) throw new Error("回滚版本核验失败");
          const compatibility = await probe(rollbackVersion);
          receipt = { fromVersion: input.targetVersion, toVersion: rollbackVersion, status: "rolled-back", policy, failureStage: failedStage, verifiedAt: new Date().toISOString(), message: `新版本失败，已回滚到 ${rollbackVersion}：${message}`, compatibility };
        } catch (rollbackError) { failure = new Error(`CLI 目标更新失败：${message}；回滚也未通过：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`); }
      }
    } finally {
      if (!retain) {
        this.phase = "restoring";
        try {
          if (snapshots.length) await this.restoreSessions(snapshots);
          if (receipt) receipt.sessionRestore = { status: snapshots.length ? "restored" : "not-needed" };
          if (!failure) { await this.recovery.mutate((data) => { delete data.recovery; }); this.suspendedInMemory = undefined; }
        } catch (error) {
          const warning = `部分会话恢复失败：${error instanceof Error ? error.message : String(error)}`;
          if (receipt) { receipt.sessionRestore = { status: "partial", message: warning }; receipt.warnings = [warning]; receipt.message += `；${warning}`; }
          if (failure) failure = new Error(`${failure.message}；此外，${warning}`);
          await this.diagnostic(warning);
        }
      }
    }
    const message = failure?.message ?? receipt?.message ?? "CLI 更新无终态";
    await this.record({ at: new Date().toISOString(), policy, from: previous, to: receipt?.toVersion, status: receipt?.status ?? "failed", message }).catch(() => undefined);
    if (failure) throw failure;
    if (!receipt) throw new Error(message);
    return receipt;
  }

  async history(): Promise<CliUpdateRecord[]> {
    const raw = await readFile(this.historyPath, "utf8").catch(() => "");
    return raw.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try { const record = JSON.parse(line) as CliUpdateRecord; return [{ ...record, policy: record.policy === "try-new" || record.policy === "retain-unverified" ? record.policy : "standard" as const }]; } catch { return []; }
    }).slice(-100).reverse();
  }

  private async runUpdate(cliPath: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await runProcessTree(cliPath, args, env, CLI_UPDATE_TIMEOUT_MS);
        await this.diagnostic(result.stdout || result.stderr || `grok ${args.join(" ")} complete`);
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
    const cliVersion = await readCliVersion(cliPath, env);
    const cwd = await mkdtemp(join(tmpdir(), "grok-desktop-probe-"));
    const adapter = new GrokAcpAdapter({ cliPath, cliVersion, cwd, env, effort: "", mode: "agent", log: this.log });
    let deleted = false;
    try {
      const { sessionId } = await adapter.start();
      if (adapter.runtimeHandshake?.protocolVersion !== PROTOCOL_VERSION) throw new Error("ACP 协议协商版本不受支持");
      const declaredExtensions = new Set(adapter.runtimeHandshake?.extensions ?? []);
      const successfulExtensions = new Set<string>();
      for (const method of ["x.ai/plugins/list", "x.ai/mcp/list", "x.ai/commands/list", "x.ai/billing", "x.ai/auto-topup-rule"]) {
        await adapter.extension(method, method === "x.ai/mcp/list" ? { cache: false } : {})
          .then(() => {
            successfulExtensions.add(method);
            return this.diagnostic(`Optional compatibility: ${method} available`);
          })
          .catch((error) => this.diagnostic(`Optional compatibility: ${method} unavailable (${error instanceof Error ? error.message : String(error)})`));
      }
      const sessionInfo = await adapter.sessionInfo();
      await this.diagnostic(`Core compatibility: x.ai/session/info supported=${String(sessionInfo.supported)}`);
      if (sessionInfo.supported) successfulExtensions.add("x.ai/session/info");
      const sessionUsage = await adapter.sessionUsage();
      await this.diagnostic(`Core compatibility: x.ai/session/usage supported=${String(sessionUsage.supported)}`);
      if (sessionUsage.supported) successfulExtensions.add("x.ai/session/usage");
      const renameSource = await adapter.renameSession("Desktop compatibility probe");
      await this.diagnostic(`Optional compatibility: x.ai/session/rename source=${renameSource}`);
      if (renameSource === "official") successfulExtensions.add("x.ai/session/rename");
      const gitStatus = await adapter.officialGitStatus();
      if (gitStatus) successfulExtensions.add("x.ai/git/status");
      const reader = join(homedir(), ".grok", "bundled", "skills", "shared", "resume-session", "session_reader.py");
      await access(reader).then(() => this.diagnostic("Optional compatibility: Codex session reader found")).catch(() => this.diagnostic("Optional compatibility: Codex session reader unavailable"));
      await this.probeOptionalComputerCapability(cliPath, cwd, env);
      await adapter.dispose();
      const resumed = new GrokAcpAdapter({ cliPath, cliVersion, cwd, env, effort: "", mode: "agent", log: this.log });
      try {
        const result = await resumed.start(sessionId);
        if (result.sessionId !== sessionId) throw new Error("ACP 恢复返回了不同会话");
      } finally {
        try { await resumed.dispose(); }
        finally { if (resumed.sessionId && resumed.sessionId !== sessionId) await this.deleteProbeSession(cliPath, resumed.sessionId, env).catch((error) => this.diagnostic(`Unexpected resumed session cleanup failed: ${String(error)}`)); }
      }
      if (adapter.lastCloseReceipt?.completed !== true || resumed.lastCloseReceipt?.completed !== true) throw new Error("ACP 关闭未确认完成");
      await this.deleteProbeSession(cliPath, sessionId, env);
      deleted = true;
      const handshake = adapter.runtimeHandshake;
      const capabilities = compatibilityEvidence(handshake, declaredExtensions, successfulExtensions);
      for (const name of ["core.resume", "core.close", "core.delete"]) capabilities.push({ name, state: "supported", source: "successful-probe", observedAt: new Date().toISOString() });
      const snapshot = enrichCompatibilitySnapshot(
        { cliVersion, checkedAt: new Date().toISOString(), handshake, capabilities },
        cliVersion,
        adapter.lastCloseReceipt?.completed === true,
      );
      await this.saveCompatibility(snapshot);
      return snapshot;
    } finally {
      await adapter.dispose().catch(() => undefined);
      if (!deleted && adapter.sessionId) await this.deleteProbeSession(cliPath, adapter.sessionId, env).catch((error) => this.diagnostic(`Probe cleanup failed: ${String(error)}`));
      await rm(cwd, { recursive: true, force: true }).catch(async (error) => {
        await this.diagnostic(`CLI compatibility probe cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }

  private async deleteProbeSession(cliPath: string, sessionId: string, env: NodeJS.ProcessEnv): Promise<void> {
    if (!sessionId) throw new Error("兼容性探针没有返回可删除的会话 ID");
    await deleteCliSession(cliPath, sessionId, env, 60_000, runProcessTree);
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
        .then((version) => this.diagnostic(`Optional compatibility: GrokComputerHost self-test passed (${version})`))
        .catch((error) => this.diagnostic(`Optional compatibility: GrokComputerHost unavailable (${error instanceof Error ? error.message : String(error)})`));
    }
    if (!pluginDir) return;
    const optionalAdapter = new GrokAcpAdapter({ cliPath, cwd, env, effort: "", mode: "agent", log: this.log, pluginDirs: [pluginDir] });
    try {
      await optionalAdapter.start();
      const commands = await optionalAdapter.waitForCommands(3_000);
      if (!commands.some((command) => command.name.replace(/^\//, "") === "computer")) throw new Error("未发布 /computer Skill");
      await this.diagnostic("Optional compatibility: process/session pluginDirs published /computer");
    } catch (error) {
      // Computer Use is optional. Losing it must disable/diagnose the extension,
      // never roll back a CLI whose core initialize + session/new still works.
      await this.diagnostic(`Optional compatibility: Computer Use plugin unavailable (${error instanceof Error ? error.message : String(error)})`);
    } finally {
      await optionalAdapter.dispose().catch(() => undefined);
      if (optionalAdapter.sessionId) await this.deleteProbeSession(cliPath, optionalAdapter.sessionId, env).catch((error) => this.diagnostic(`Optional probe cleanup failed: ${String(error)}`));
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
    const appendBounded = (current: string, chunk: unknown): string => `${current}${String(chunk)}`.slice(-4 * 1024 * 1024);
    child.stdout.on("data", (chunk) => { stdout = appendBounded(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = appendBounded(stderr, chunk); });
    child.once("error", (error) => finish(error));
    child.once("exit", (code, signal) => {
      if (code === 0) finish();
      else finish(new Error(`${executable} ${args.join(" ")} failed (${String(code ?? signal)}): ${stderr || stdout}`));
    });
    const timer = setTimeout(() => {
      const error = new Error(`Grok CLI 更新进程在 ${Math.round(timeoutMs / 60_000)} 分钟内未结束，已停止；当前版本会在决定是否回滚前重新核验`);
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
  for (const extension of ["x.ai/billing", "x.ai/auto-topup-rule", "x.ai/btw", "x.ai/follow_ups", "x.ai/models/update", "x.ai/settings/update", "x.ai/session/info", "x.ai/session/usage", "x.ai/session/delete", "x.ai/session/rename", "x.ai/git/status", "x.ai/mcp/status", "x.ai/mcp/init_progress", "x.ai/mcp/tools_changed", "x.ai/mcp/server_status", "x.ai/mcp/servers_updated", "x.ai/mcp_initialized", "x.ai/plugins/list", "x.ai/mcp/list", "x.ai/commands/list"]) {
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
