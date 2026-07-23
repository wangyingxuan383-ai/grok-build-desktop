import { safeStorage } from "electron";
import { spawn, execFile } from "node:child_process";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, release as osRelease, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { methods as acpMethods, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { strToU8, zipSync } from "fflate";
import type { AppSettings, AutomationTask, BuildInfo, ComputerCapability, CustomProviderProfile, SupportBundlePreview, SystemCompatibilityReport, SystemDiagnosticItem } from "../../shared/types";
import { buildCliEnv, detectEffortFlag, locateGrokCli, readCliVersion } from "./cli-locator";
import { redactSecrets, type LogService } from "./log-service";

const execFileAsync = promisify(execFile);

export class DiagnosticsService {
  constructor(
    private readonly userDataPath: string,
    private readonly build: BuildInfo,
    private readonly getSettings: () => Promise<AppSettings>,
    private readonly getApiKey: () => Promise<string | undefined>,
    private readonly getComputerCapability: () => Promise<ComputerCapability>,
    private readonly log: LogService,
    private readonly mockCliPath = "",
    private readonly optional: { providers?: () => Promise<CustomProviderProfile[]>; automations?: () => Promise<AutomationTask[]> } = {},
  ) {}

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
      const models = await execFileAsync(cliPath, ["models"], { env, timeout: 20_000, windowsHide: true }).then(() => true).catch(() => false);
      items.push({ id: "models", label: "模型与登录", status: models ? "ok" : "warning", summary: models ? "CLI 可以读取模型列表" : "模型列表不可用；可能尚未登录或网络受限" });
      const acp = await probeAcpInitialize(cliPath, env);
      items.push({ id: "acp", label: "ACP 核心", status: acp.ok ? "ok" : "error", summary: acp.ok ? "initialize 握手通过" : "ACP initialize 握手失败", details: acp.message ? [redactDiagnosticText(acp.message)] : undefined });
      const extensions = await execFileAsync(cliPath, ["plugin", "--help"], { env, timeout: 15_000, windowsHide: true }).then(() => true).catch(() => false);
      items.push({ id: "extensions", label: "扩展与媒体", status: extensions ? "ok" : "warning", summary: extensions ? "插件命令可用；媒体能力将在会话中动态探测" : "插件命令不可用，扩展功能将降级" });
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

  preview(): SupportBundlePreview {
    return {
      files: [
        { name: "diagnostics.json", description: "系统、应用、CLI 和可选能力的脱敏状态" },
        { name: "app.log", description: "经过 Token、路径、邮箱和代理脱敏的应用日志" },
        { name: "README.txt", description: "支持包范围和隐私说明" },
      ],
      fields: ["应用版本/构建提交", "Windows 版本和架构", "CLI 版本和能力", "代理是否配置", "Computer Use 自检", "提供商数量/协议/凭据状态", "定时任务数量/注册状态"],
      excluded: ["OAuth/API Key/Token", "提供商端点和环境变量值", "任务提示词/任务工作区和会话", "会话附件正文、Base64、缓存文件和完整路径", "Memory 内容、文件路径和索引", "文件内容、截图和主题背景图片", "主题背景原始路径或本地副本", "完整工作区/用户目录", "代理地址和认证"],
      redacted: true,
    };
  }

  async createBundle(path: string): Promise<void> {
    const report = await this.run();
    const settings = await this.getSettings();
    const log = redactDiagnosticText(redactSecrets(await this.log.read()));
    const diagnostics = { build: this.build, report, proxy: { httpConfigured: Boolean(settings.httpProxy), httpsConfigured: Boolean(settings.httpsProxy) } };
    const files = {
      "diagnostics.json": strToU8(`${JSON.stringify(diagnostics, null, 2)}\n`),
      "app.log": strToU8(log),
      "README.txt": strToU8("Grok Build Desktop 脱敏支持包\n不会包含账号、Token、提示词、会话、Memory 内容或路径、截图、文件内容、主题背景图片或其路径、完整用户路径或代理地址。\n"),
    };
    await writeFile(path, zipSync(files, { level: 6 }));
  }
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
    const child = spawn(cliPath, ["agent", "stdio"], { cwd: tmpdir(), env, windowsHide: true });
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
  return redactSecrets(input)
    .replace(/[A-Za-z]:\\Users\\[^\\\s"']+/gi, "%USERPROFILE%")
    .replace(/[A-Za-z]:\\(?:[^\\\r\n"']+\\)*[^\\\r\n"']*/g, "[REDACTED_PATH]")
    .replace(/\\\\[^\\\s"']+\\[^\r\n"']+/g, "[REDACTED_NETWORK_PATH]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/https?:\/\/[^\s"']+/gi, (value) => {
      try { const url = new URL(value); return `${url.protocol}//${url.hostname}${url.port ? ":<port>" : ""}`; } catch { return "[REDACTED_URL]"; }
    });
}
