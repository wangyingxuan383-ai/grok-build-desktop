import { safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { access, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, release as osRelease, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { methods as acpMethods, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { strToU8, zipSync } from "fflate";
import type { AppSettings, AutomationTask, BuildInfo, ComputerCapability, CustomProviderProfile, FailureDiagnosisReport, GrokDoctorFixCandidate, GrokDoctorFixPreview, GrokDoctorFixReceipt, GrokQuotaSnapshot, SupportBundlePreview, SystemCompatibilityReport, SystemDiagnosticItem, TurnFailure } from "../../shared/types";
import { turnFailureActions, turnFailureLabel } from "../../shared/turn-failure";
import { buildCliEnv, detectEffortFlag, locateGrokCli, readCliVersion } from "./cli-locator";
import { redactLogText, redactSecrets, type LogService } from "./log-service";

const execFileAsync = promisify(execFile);
type DoctorCommandOptions = { env: NodeJS.ProcessEnv; timeout: number; windowsHide: boolean; maxBuffer: number };
export type DoctorCommandRunner = (cliPath: string, args: string[], options: DoctorCommandOptions) => Promise<{ stdout: string; stderr: string }>;

export class DiagnosticsService {
  private readonly doctorFixPreviews = new Map<string, { expiresAt: number; cliPath: string; ids: Set<string> }>();
  constructor(
    private readonly userDataPath: string,
    private readonly build: BuildInfo,
    private readonly getSettings: () => Promise<AppSettings>,
    private readonly getApiKey: () => Promise<string | undefined>,
    private readonly getComputerCapability: () => Promise<ComputerCapability>,
    private readonly log: LogService,
    private readonly mockCliPath = "",
    private readonly optional: {
      providers?: () => Promise<CustomProviderProfile[]>;
      automations?: () => Promise<AutomationTask[]>;
      quota?: () => Promise<GrokQuotaSnapshot>;
      /** Test seam for the fixed-argument Grok Doctor contract. */
      doctorCommandRunner?: DoctorCommandRunner;
      /** Test seam for the fixed-argument, explicit session trace export. */
      traceCommandRunner?: DoctorCommandRunner;
    } = {},
  ) {}

  /**
   * Diagnoses one specific failure. Deliberately does NOT run the four-subprocess
   * install sweep: for a rejected tool schema or an exhausted quota that sweep
   * costs the better part of a minute and then reports all-green, because none
   * of its probes touch the provider, model or request that actually failed.
   */
  async diagnoseFailure(failure: TurnFailure): Promise<FailureDiagnosisReport> {
    const items: SystemDiagnosticItem[] = [];
    const actions = [...(failure.nextActions ?? turnFailureActions(failure.classification))];
    const provider = failure.providerId ? (await this.optional.providers?.() ?? []).find((value) => value.id === failure.providerId) : undefined;

    items.push({
      id: "failure", label: "本次失败", status: "error",
      summary: turnFailureLabel(failure.classification),
      details: [
        failure.httpStatus === undefined ? "" : `HTTP ${failure.httpStatus}`,
        failure.modelId ? `模型 ${failure.modelId}` : "",
        failure.providerId ? `提供商 ${failure.providerId}` : "",
        failure.traceId ? `Trace ${failure.traceId}` : "",
        failure.gatewayPhase ? `阶段 ${failure.gatewayPhase}` : "",
        failure.gatewayReason ? `断开来源 ${failure.gatewayReason}` : "",
        failure.gatewayProxyMode ? `网络路由 ${failure.gatewayProxyMode}` : "",
        failure.gatewayRequestId ? `网关请求 ${failure.gatewayRequestId}` : "",
        failure.gatewayElapsedMs === undefined ? "" : `网关耗时 ${failure.gatewayElapsedMs} ms`,
      ].filter(Boolean),
    });

    if (failure.classification === "schema-rejected") {
      const profile = provider?.schemaProfile ?? "standard";
      const passthrough = profile === "standard";
      items.push({
        id: "schema-profile", label: "工具 Schema 兼容档",
        status: passthrough ? "error" : "ok",
        summary: passthrough ? "当前为「标准兼容」直通档，请求体原样转发给上游" : `当前为「${profile}」档，转发前会清理不被接受的枚举与类型`,
        details: [provider ? `提供商 ${provider.name}` : "未能定位该模型所属的受管提供商", `本次网关清理 ${failure.sanitizedCount ?? 0} 处`],
      });
    }

    if (failure.classification === "quota-exhausted") {
      const quota = await this.optional.quota?.().catch(() => undefined);
      const windows = [quota?.rolling24h, quota?.currentAllowance, quota?.payAsYouGo].filter(Boolean);
      items.push({
        id: "quota", label: "额度",
        status: "warning",
        summary: windows.length ? "以下为账号最近一次读取到的真实额度" : "未能读取到账号额度，仅依据上游返回的限流信息判断",
        details: windows.map((value) => `${value!.label}：${value!.used ?? "?"}/${value!.limit ?? "?"}${value!.resetAt ? ` · 重置 ${value!.resetAt}` : ""}${value!.expired ? " · 已过期" : ""}`),
      });
    }

    if (failure.classification === "auth-expired") {
      items.push({
        id: "credential", label: "凭据来源",
        status: provider ? (provider.hasCredential ? "warning" : "error") : "warning",
        summary: provider
          ? (provider.hasCredential ? `提供商「${provider.name}」的密钥存在，但上游拒绝了它` : `提供商「${provider.name}」的密钥环境变量为空`)
          : "本次失败使用的是账号登录凭据，而非自定义提供商密钥",
        details: provider?.credentialEnv ? [`环境变量 ${provider.credentialEnv}`] : [],
      });
    }

    if (failure.classification === "network" || failure.classification === "provider-error") {
      const settings = await this.getSettings();
      items.push({
        id: "route", label: "网络与路由",
        status: "warning",
        summary: provider ? `上游地址 ${provider.baseUrl}` : "未能定位该模型所属的受管提供商",
        details: [
          failure.gatewayProxyMode === "direct"
            ? "本次提供商请求已跳过应用代理"
            : settings.httpsProxy
              ? `本次提供商请求继承 HTTPS 代理 ${settings.httpsProxy}`
              : "本次提供商请求继承系统网络设置",
          failure.gatewayPhase === "pre-send" ? "失败发生在应用发出请求之前（本机或 DNS 层）" : "失败发生在上游返回之后",
          failure.retryAfter ? `上游要求 ${failure.retryAfter} 后重试` : "",
        ].filter(Boolean),
      });
    }

    // A crashed CLI is the one class where the install-level probes are the
    // relevant evidence, so this is where they are worth their cost.
    if (failure.classification === "cli-crashed" || failure.classification === "unknown") {
      const settings = await this.getSettings();
      const cliPath = this.mockCliPath || await locateGrokCli(settings.cliPath);
      const version = cliPath ? await readCliVersion(cliPath, buildCliEnv(settings, await this.getApiKey())) : undefined;
      items.push({
        id: "cli", label: "Grok CLI",
        status: version ? "ok" : "error",
        summary: version ? `已找到 Grok CLI ${version}` : cliPath ? "CLI 存在但无法读取版本" : "未找到 Grok CLI",
        details: cliPath ? [redactDiagnosticPath(cliPath)] : [],
      });
      if (failure.processExitCode !== undefined) items.push({ id: "exit", label: "退出码", status: "error", summary: `Grok 进程以代码 ${failure.processExitCode} 退出`, details: ["可在设置 → 更新与诊断中导出脱敏日志查看退出前的输出"] });
    }

    return {
      failure,
      generatedAt: new Date().toISOString(),
      headline: turnFailureLabel(failure.classification),
      items,
      actions,
    };
  }

  async run(): Promise<SystemCompatibilityReport> {
    const items: SystemDiagnosticItem[] = [];
    const windows = windowsStatus();
    items.push(windows);
    items.push({ id: "dpapi", label: "凭据加密", status: safeStorage.isEncryptionAvailable() ? "ok" : "error", summary: safeStorage.isEncryptionAvailable() ? "Windows DPAPI 可用" : "当前系统无法安全加密账号凭据" });
    items.push(await writableStatus(this.userDataPath));

    const settings = await this.getSettings();
    const cliPath = this.mockCliPath || await locateGrokCli(settings.cliPath);
    let cliVersion: string | undefined;
    let effortFlag: "--effort" | "--reasoning-effort" | undefined;
    if (!cliPath) items.push({ id: "cli", label: "Grok CLI", status: "error", summary: "未找到 Grok CLI" });
    else {
      const env = buildCliEnv(settings, await this.getApiKey());
      cliVersion = await readCliVersion(cliPath, env);
      effortFlag = await detectEffortFlag(cliPath, env);
      items.push({ id: "cli", label: "Grok CLI", status: cliVersion ? "ok" : "error", summary: cliVersion ? `已找到 Grok CLI ${cliVersion}` : "CLI 存在但无法读取版本", details: [redactDiagnosticPath(cliPath), `推理参数：${effortFlag}`] });
      const models = await execFileAsync(cliPath, ["--no-auto-update", "models"], { env, timeout: 20_000, windowsHide: true }).then(() => true).catch(() => false);
      items.push({ id: "models", label: "模型与登录", status: models ? "ok" : "warning", summary: models ? "CLI 可以读取模型列表" : "模型列表不可用；可能尚未登录或网络受限" });
      const acp = await probeAcpInitialize(cliPath, env);
      items.push({ id: "acp", label: "ACP 核心", status: acp.ok ? "ok" : "error", summary: acp.ok ? "initialize 握手通过" : "ACP initialize 握手失败", details: acp.message ? [redactDiagnosticText(acp.message)] : undefined });
      const extensions = await execFileAsync(cliPath, ["--no-auto-update", "plugin", "--help"], { env, timeout: 15_000, windowsHide: true }).then(() => true).catch(() => false);
      items.push({ id: "extensions", label: "扩展与媒体", status: extensions ? "ok" : "warning", summary: extensions ? "插件命令可用；媒体能力将在会话中动态探测" : "插件命令不可用，扩展功能将降级" });
      items.push(await runGrokDoctor(cliPath, env, this.optional.doctorCommandRunner));
      items.push(await runGrokDiskUsage(cliPath, env));
    }

    const reader = join(homedir(), ".grok", "bundled", "skills", "shared", "resume-session", "session_reader.py");
    items.push({ id: "codex-reader", label: "Codex 只读桥接", status: await access(reader).then(() => "ok" as const).catch(() => "warning" as const), summary: await access(reader).then(() => "Grok 自带读取器可用").catch(() => "将使用内置 JSONL 兼容解析器") });
    const computer = await this.getComputerCapability().catch((error) => ({ available: false, diagnostics: [String(error)] } as ComputerCapability));
    items.push({ id: "computer", label: "Computer Use", status: computer.available ? "ok" : "warning", summary: computer.available ? `Windows Harness 可用${computer.helperVersion ? `（${computer.helperVersion}）` : ""}` : "Computer Use 不可用", details: computer.diagnostics.map(redactDiagnosticText) });
    items.push({ id: "quota", label: "额度", status: "info", summary: "OAuth 账号额度在账号面板按需查询；诊断不会访问真实账单接口" });
    if (this.optional.providers) {
      const providers = await this.optional.providers().catch(() => []);
      const protocols = Array.from(new Set(providers.map((value) => value.protocol))).sort();
      const missing = providers.filter((value) => value.owned && !value.hasCredential).length;
      items.push({ id: "providers", label: "自定义提供商", status: missing ? "warning" : "ok", summary: `${providers.length} 个配置；协议：${protocols.join("、") || "无"}`, details: missing ? [`${missing} 个配置缺少凭据`] : undefined });
    }
    if (this.optional.automations) {
      const tasks = await this.optional.automations().catch(() => []);
      const problems = tasks.filter((value) => value.registrationStatus !== "registered").length;
      items.push({ id: "automations", label: "持久自动化", status: problems ? "warning" : "ok", summary: `${tasks.length} 个任务；${problems} 个需要处理` });
    }

    const overall = items.some((item) => item.status === "error" && ["windows", "dpapi", "cli", "acp"].includes(item.id)) ? "blocked" : items.some((item) => item.status === "warning" || item.status === "error") ? "limited" : "ready";
    return { checkedAt: new Date().toISOString(), overall, items, cliPath: cliPath ? redactDiagnosticPath(cliPath) : undefined, cliVersion, effortFlag };
  }

  async previewDoctorFixes(): Promise<GrokDoctorFixPreview> {
    const settings = await this.getSettings();
    const cliPath = this.mockCliPath || await locateGrokCli(settings.cliPath);
    if (!cliPath) return { generatedAt: new Date().toISOString(), fixes: [], message: "未找到 Grok CLI" };
    const env = buildCliEnv(settings, await this.getApiKey());
    const report = await readGrokDoctorReport(cliPath, env, this.optional.doctorCommandRunner);
    const fixes = parseGrokDoctorFixes(report);
    if (!fixes.length) return { generatedAt: new Date().toISOString(), fixes, message: "当前诊断没有可用的官方自动修复" };
    const confirmationToken = randomUUID();
    this.doctorFixPreviews.clear();
    this.doctorFixPreviews.set(confirmationToken, { expiresAt: Date.now() + 5 * 60_000, cliPath, ids: new Set(fixes.map((value) => value.id)) });
    return { generatedAt: new Date().toISOString(), fixes, confirmationToken, message: `检测到 ${fixes.length} 项官方自动修复；执行前仍需逐项确认` };
  }

  async applyDoctorFix(id: string, confirmationToken: string, confirmed: boolean): Promise<GrokDoctorFixReceipt> {
    const normalizedId = id.trim();
    if (!confirmed) throw new Error("未确认 Grok Doctor 修复");
    const preview = this.doctorFixPreviews.get(confirmationToken);
    this.doctorFixPreviews.delete(confirmationToken);
    if (!preview || preview.expiresAt < Date.now() || !preview.ids.has(normalizedId)) throw new Error("Grok Doctor 修复预览已失效，请重新检查");
    const settings = await this.getSettings();
    const cliPath = this.mockCliPath || await locateGrokCli(settings.cliPath);
    if (!cliPath || cliPath !== preview.cliPath) throw new Error("Grok CLI 路径已变化，请重新检查");
    const env = buildCliEnv(settings, await this.getApiKey());
    const current = parseGrokDoctorFixes(await readGrokDoctorReport(cliPath, env, this.optional.doctorCommandRunner));
    if (!current.some((value) => value.id === normalizedId)) throw new Error("该自动修复已不再适用，请重新检查");
    const { stdout, stderr } = await runDoctorCommand(this.optional.doctorCommandRunner, cliPath, ["--no-auto-update", "doctor", "fix", normalizedId, "--yes"], {
      env,
      timeout: 60_000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    const detail = redactDiagnosticText(`${stdout}\n${stderr}`.trim()).slice(0, 2_000);
    return { id: normalizedId, applied: true, completedAt: new Date().toISOString(), message: detail || "Grok Doctor 修复已执行" };
  }

  preview(): SupportBundlePreview {
    return {
      files: [
        { name: "diagnostics.json", description: "系统、应用、CLI 和可选能力的脱敏状态" },
        { name: "app.log", description: "经过 Token、路径、邮箱和代理脱敏的应用日志" },
        { name: "README.txt", description: "支持包范围和隐私说明" },
      ],
      fields: ["应用版本/构建提交", "Windows 版本和架构", "CLI 版本和能力", "代理是否配置", "Computer Use 自检", "提供商数量/协议/凭据状态", "定时任务数量/注册状态"],
      excluded: ["OAuth/API Key/Token", "提供商端点和环境变量值", "任务提示词/任务工作区和会话", "会话附件正文、Base64、缓存文件和完整路径", "会话重新绑定事务日志及其旧/新路径", "Memory 内容、文件路径和索引", "文件内容、截图和主题背景图片", "主题背景原始路径或本地副本", "完整工作区/用户目录", "代理地址和认证"],
      redacted: true,
    };
  }

  async createBundle(path: string): Promise<void> {
    const report = await this.run();
    const settings = await this.getSettings();
    const archive = buildSupportBundleArchive({
      build: this.build,
      report,
      httpProxyConfigured: Boolean(settings.httpProxy),
      httpsProxyConfigured: Boolean(settings.httpsProxy),
      log: await this.log.read(),
    });
    await writeFile(path, archive);
  }

  /**
   * Session traces can contain conversation and tool content. They are therefore
   * exported only as an explicit standalone action and are never added to the
   * redacted support bundle or ordinary application logs.
   */
  async exportSessionTrace(sessionId: string, outputPath: string): Promise<void> {
    const normalizedSessionId = sessionId.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/.test(normalizedSessionId)) throw new Error("会话 ID 格式无效");
    const settings = await this.getSettings();
    const cliPath = this.mockCliPath || await locateGrokCli(settings.cliPath);
    if (!cliPath) throw new Error("未找到 Grok CLI");
    const env = buildCliEnv(settings, await this.getApiKey());
    await runDoctorCommand(this.optional.traceCommandRunner, cliPath, ["--no-auto-update", "trace", "--local", "--json", "-o", outputPath, normalizedSessionId], {
      env,
      timeout: 5 * 60_000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    const info = await stat(outputPath).catch(() => undefined);
    if (!info?.isFile() || info.size === 0) throw new Error("Grok CLI 未生成有效的 Trace 文件");
  }
}

async function runGrokDiskUsage(cliPath: string, env: NodeJS.ProcessEnv): Promise<SystemDiagnosticItem> {
  try {
    const { stdout } = await execFileAsync(cliPath, ["--no-auto-update", "du", "--json"], { env, timeout: 60_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    return parseGrokDiskUsage(JSON.parse(String(stdout)));
  } catch (error) {
    return { id: "grok-du", label: "Grok 本地空间", status: "warning", summary: "当前 CLI 未提供 grok du --json 或统计失败", details: [redactDiagnosticText(error instanceof Error ? error.message : String(error))] };
  }
}

export function parseGrokDiskUsage(value: unknown): SystemDiagnosticItem {
  const report = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const total = nonNegativeNumber(report.total_bytes);
  const largest = (Array.isArray(report.top_level_dirs) ? report.top_level_dirs : [])
    .flatMap((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
      const item = raw as Record<string, unknown>;
      const bytes = nonNegativeNumber(item.bytes);
      return bytes === undefined ? [] : [{ name: typeof item.name === "string" ? item.name.slice(0, 120) : "unknown", bytes }];
    })
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 5)
    .map((item) => `${item.name}：${formatBytes(item.bytes)}`);
  const unreadable = (nonNegativeNumber(report.skipped_entries) ?? 0) + (nonNegativeNumber(report.unreadable_dirs) ?? 0);
  return {
    id: "grok-du", label: "Grok 本地空间", status: unreadable ? "warning" : "ok",
    summary: total === undefined ? "CLI 未返回可用的空间统计" : `GROK_HOME 共 ${formatBytes(total)} · ${Array.isArray(report.worktrees) ? report.worktrees.length : 0} 个受管 Worktree`,
    details: [...largest, ...(unreadable ? [`${unreadable} 个条目无法读取`] : [])],
  };
}

function nonNegativeNumber(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined; }
function formatBytes(value: number): string { const units = ["B", "KiB", "MiB", "GiB", "TiB"]; let amount = value; let unit = 0; while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit++; } return `${amount.toFixed(unit ? 1 : 0)} ${units[unit]}`; }

async function runGrokDoctor(cliPath: string, env: NodeJS.ProcessEnv, runner?: DoctorCommandRunner): Promise<SystemDiagnosticItem> {
  try {
    const report = await readGrokDoctorReport(cliPath, env, runner) as {
      schemaVersion?: string;
      findings?: Array<{ id?: string; disposition?: string; message?: string; note?: string }>;
      counts?: { issues?: number; recommendations?: number; probeNotes?: number };
    };
    const issues = Number(report.counts?.issues ?? 0);
    const recommendations = Number(report.counts?.recommendations ?? 0);
    const details = (Array.isArray(report.findings) ? report.findings : []).slice(0, 8).map((finding) =>
      redactDiagnosticText(`${finding.id || "finding"} · ${finding.disposition || "unknown"} · ${finding.message || finding.note || "无说明"}`),
    );
    return {
      id: "grok-doctor",
      label: "Grok Doctor",
      status: issues > 0 ? "warning" : "ok",
      summary: `schema ${report.schemaVersion || "未知"} · ${issues} 个问题 · ${recommendations} 条建议`,
      ...(details.length ? { details } : {}),
    };
  } catch (error) {
    return {
      id: "grok-doctor",
      label: "Grok Doctor",
      status: "warning",
      summary: "当前 CLI 未提供 doctor --json 或诊断执行失败",
      details: [redactDiagnosticText(error instanceof Error ? error.message : String(error))],
    };
  }
}

async function readGrokDoctorReport(cliPath: string, env: NodeJS.ProcessEnv, runner?: DoctorCommandRunner): Promise<Record<string, unknown>> {
  const { stdout } = await runDoctorCommand(runner, cliPath, ["--no-auto-update", "doctor", "--json"], {
    env,
    timeout: 30_000,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  const value = JSON.parse(stdout) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Grok Doctor 返回格式无效");
  return value as Record<string, unknown>;
}

async function runDoctorCommand(runner: DoctorCommandRunner | undefined, cliPath: string, args: string[], options: DoctorCommandOptions): Promise<{ stdout: string; stderr: string }> {
  if (runner) return runner(cliPath, args, options);
  const { stdout, stderr } = await execFileAsync(cliPath, args, options);
  return { stdout: String(stdout), stderr: String(stderr) };
}

export function parseGrokDoctorFixes(report: Record<string, unknown>): GrokDoctorFixCandidate[] {
  const findings = Array.isArray(report.findings) ? report.findings : [];
  const output: GrokDoctorFixCandidate[] = [];
  for (const raw of findings) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const finding = raw as Record<string, unknown>;
    const id = typeof finding.id === "string" ? finding.id.trim() : "";
    if (!id || id.length > 128 || !/^[A-Za-z0-9._-]+$/.test(id)) continue;
    const automatic = finding.automaticRemediation;
    if (automatic === null || automatic === undefined || automatic === false) continue;
    const message = redactDiagnosticText(typeof finding.message === "string" ? finding.message : `自动修复 ${id}`).slice(0, 1_000);
    const note = typeof finding.note === "string" ? redactDiagnosticText(finding.note).slice(0, 1_000) : undefined;
    output.push({ id, message, ...(note ? { note } : {}) });
  }
  return output.slice(0, 32);
}

export function buildSupportBundleArchive(input: {
  build: BuildInfo;
  report: SystemCompatibilityReport;
  httpProxyConfigured: boolean;
  httpsProxyConfigured: boolean;
  log: string;
}): Uint8Array {
  const diagnostics = {
    build: input.build,
    report: input.report,
    proxy: { httpConfigured: input.httpProxyConfigured, httpsConfigured: input.httpsProxyConfigured },
  };
  // Redact the serialized report as a second boundary. Diagnostic item labels
  // and provider/model display names are user-controlled and must not be able
  // to smuggle paths or credentials into a support archive.
  const diagnosticJson = redactDiagnosticText(redactSecrets(JSON.stringify(diagnostics, null, 2)));
  const files = {
    "diagnostics.json": strToU8(`${diagnosticJson}\n`),
    "app.log": strToU8(redactDiagnosticText(redactSecrets(input.log))),
    "README.txt": strToU8("Grok Build Desktop 脱敏支持包\n不会包含账号、Token、提示词、会话、Memory 内容或路径、截图、文件内容、主题背景图片或其路径、完整用户路径或代理地址。\n"),
  };
  return zipSync(files, { level: 6 });
}

function windowsStatus(): SystemDiagnosticItem {
  const build = Number(osRelease().split(".").at(-1));
  if (process.platform !== "win32") return { id: "windows", label: "Windows", status: "error", summary: "公开版仅支持 Windows" };
  if (process.arch !== "x64") return { id: "windows", label: "Windows", status: "error", summary: `当前架构 ${process.arch} 不受支持；需要 x64` };
  const supported = build >= 19045;
  return { id: "windows", label: "Windows", status: supported ? "ok" : "warning", summary: supported ? `Windows x64（系统构建 ${build}）` : `系统构建 ${build} 低于正式测试基线 19045` };
}

async function writableStatus(userDataPath: string): Promise<SystemDiagnosticItem> {
  const path = join(userDataPath, `.write-test-${process.pid}`);
  try {
    await writeFile(path, "ok", "utf8");
    await rm(path, { force: true });
    return { id: "storage", label: "本地存储", status: "ok", summary: "应用数据目录可写" };
  } catch {
    return { id: "storage", label: "本地存储", status: "error", summary: "应用数据目录不可写" };
  }
}

async function probeAcpInitialize(cliPath: string, env: NodeJS.ProcessEnv): Promise<{ ok: boolean; message?: string }> {
  return new Promise((resolve) => {
    const child = spawn(cliPath, ["--no-auto-update", "agent", "stdio"], { cwd: tmpdir(), env, windowsHide: true });
    let buffer = "";
    let finished = false;
    const finish = (value: { ok: boolean; message?: string }): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.kill();
      resolve(value);
    };
    const timer = setTimeout(() => finish({ ok: false, message: "ACP initialize 超时" }), 20_000);
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          const value = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
          if (value.id === 1) finish(value.error ? { ok: false, message: value.error.message } : { ok: Boolean(value.result) });
        } catch { /* non-JSON startup output is ignored */ }
      }
    });
    child.on("error", (error) => finish({ ok: false, message: error.message }));
    child.on("exit", (code) => { if (!finished) finish({ ok: false, message: `Grok ACP 进程提前退出（${String(code)}）` }); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: acpMethods.agent.initialize, params: { protocolVersion: PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true } } })}\n`);
  });
}

export function redactDiagnosticPath(path: string): string {
  const home = homedir();
  if (path.toLowerCase().startsWith(home.toLowerCase())) return `%USERPROFILE%${path.slice(home.length)}`;
  if (/^[A-Za-z]:\\/.test(path)) return `<LOCAL_PATH>\\${path.split(/[\\/]/).at(-1) || "…"}`;
  if (/^\\\\/.test(path)) return `<NETWORK_PATH>\\${path.split(/[\\/]/).at(-1) || "…"}`;
  return path;
}

export function redactDiagnosticText(input: string): string {
  return redactLogText(input);
}
