import { execFile, spawn } from "node:child_process";
import { access, appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import type { AppSettings, CliUpdateRecord, CliVersionStatus } from "../../shared/types";
import { buildCliEnv, checkCliUpdate, isLockedBinaryError, locateGrokCli, parseVersion, readCliVersion } from "./cli-locator";
import { GrokAcpAdapter } from "./grok-acp-adapter";
import { redactSecrets, type LogService } from "./log-service";
import type { LiveSessionSnapshot } from "./grok-process-manager";

export class CliUpdateService {
  private readonly historyPath: string;
  private activeApply?: Promise<CliVersionStatus>;

  constructor(
    userDataPath: string,
    private readonly getSettings: () => Promise<AppSettings>,
    private readonly getApiKey: () => Promise<string | undefined>,
    private readonly suspendSessions: () => Promise<LiveSessionSnapshot[]>,
    private readonly restoreSessions: (snapshots: LiveSessionSnapshot[]) => Promise<void>,
    private readonly log: LogService,
    private readonly optionalCapabilities?: { pluginDir?: string; computerHostPath?: string },
  ) {
    this.historyPath = join(userDataPath, "cli-update-history.jsonl");
  }

  async check(): Promise<CliVersionStatus> {
    const settings = await this.getSettings();
    const cliPath = await locateGrokCli(settings.cliPath);
    if (!cliPath) return { found: false, error: "未找到 Grok CLI" };
    const status = await checkCliUpdate(cliPath, buildCliEnv(settings, await this.getApiKey()));
    await this.record({ at: new Date().toISOString(), from: status.currentVersion, to: status.latestVersion, status: "checked", message: status.error || (status.updateAvailable ? "发现可用更新" : "已是最新版本") });
    return status;
  }

  async apply(): Promise<CliVersionStatus> {
    if (this.activeApply) return this.activeApply;
    const operation = this.applyOnce();
    this.activeApply = operation;
    try {
      return await operation;
    } finally {
      if (this.activeApply === operation) this.activeApply = undefined;
    }
  }

  private async applyOnce(): Promise<CliVersionStatus> {
    const settings = await this.getSettings();
    const cliPath = await locateGrokCli(settings.cliPath);
    if (!cliPath) throw new Error("未找到 Grok CLI");
    const env = buildCliEnv(settings, await this.getApiKey());
    const previousRaw = await readCliVersion(cliPath, env);
    const previous = parseVersion(previousRaw)?.join(".");
    if (!previous) throw new Error("无法读取当前 Grok CLI 版本，已取消更新");
    const suspended = await this.suspendSessions();
    let primaryFailure: unknown;
    try {
      await this.runUpdate(cliPath, ["update"], env);
      await this.probe(cliPath, env);
      const current = await readCliVersion(cliPath, env);
      await this.record({ at: new Date().toISOString(), from: previous, to: current, status: "updated", message: "更新后 ACP initialize/session/new 验证通过" });
      return this.check();
    } catch (error) {
      primaryFailure = error;
      const message = error instanceof Error ? error.message : String(error);
      await this.log.log(`CLI update verification failed: ${message}`);
      try {
        await this.runUpdate(cliPath, ["update", "--version", previous], env);
        await this.probe(cliPath, env);
        await this.record({ at: new Date().toISOString(), from: undefined, to: previous, status: "rolled-back", message: `新版本验证失败，已回滚：${message}` });
      } catch (rollbackError) {
        const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        await this.record({ at: new Date().toISOString(), from: previous, status: "failed", message: `更新失败且回滚未通过：${rollbackMessage}` });
        throw new Error(`CLI 更新失败且回滚未通过：${rollbackMessage}`);
      }
      throw new Error(`新 CLI 不兼容，已自动回滚到 ${previous}：${message}`);
    } finally {
      if (suspended.length) {
        try {
          await this.restoreSessions(suspended);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await this.log.log(`CLI update session restore failed: ${message}`);
          if (!primaryFailure) throw new Error(`CLI 已更新，但部分会话恢复失败：${message}`);
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

  private async probe(cliPath: string, env: NodeJS.ProcessEnv): Promise<void> {
    const cwd = await mkdtemp(join(tmpdir(), "grok-desktop-probe-"));
    const adapter = new GrokAcpAdapter({ cliPath, cwd, env, effort: "", mode: "agent", log: this.log });
    try {
      await adapter.start();
      for (const method of ["x.ai/plugins/list", "x.ai/mcp/list", "x.ai/commands/list"]) {
        await adapter.extension(method, method === "x.ai/mcp/list" ? { cache: false } : {}).then(() => this.log.log(`Optional compatibility: ${method} available`)).catch((error) => this.log.log(`Optional compatibility: ${method} unavailable (${error instanceof Error ? error.message : String(error)})`));
      }
      const reader = join(homedir(), ".grok", "bundled", "skills", "shared", "resume-session", "session_reader.py");
      await access(reader).then(() => this.log.log("Optional compatibility: Codex session reader found")).catch(() => this.log.log("Optional compatibility: Codex session reader unavailable"));
      await this.probeOptionalComputerCapability(cliPath, cwd, env);
    } finally {
      await adapter.dispose();
      await rm(cwd, { recursive: true, force: true });
      await rm(join(homedir(), ".grok", "sessions", encodeURIComponent(cwd)), { recursive: true, force: true });
    }
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
    const shell = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(executable);
    const child = spawn(executable, args, { env, windowsHide: true, shell, stdio: ["ignore", "pipe", "pipe"] });
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
