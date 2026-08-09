import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExternalOpenTool, ExternalOpenToolId } from "../../shared/types";

interface ResolvedExternalTool extends ExternalOpenTool {
  executable: string;
  companion?: string;
}

export interface ExternalOpenToolRuntime {
  exists(path: string): Promise<boolean>;
  launch(executable: string, args: string[], cwd: string): Promise<void>;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}

const defaultRuntime: ExternalOpenToolRuntime = {
  exists: async (path) => access(path).then(() => true).catch(() => false),
  launch: launchDetached,
  env: process.env,
  platform: process.platform,
};

/**
 * Discovers only applications for which the Desktop has a deterministic,
 * fixed-argument open contract. An installed application is not exposed just
 * because its executable exists: this avoids creating another no-op "open"
 * button for tools whose command-line contract is unknown.
 */
export class ExternalOpenToolService {
  private cache?: { at: number; tools: ResolvedExternalTool[] };

  constructor(private readonly runtime: ExternalOpenToolRuntime = defaultRuntime) {}

  async list(force = false): Promise<ExternalOpenTool[]> {
    const tools = await this.resolve(force);
    return tools.map(({ executable: _executable, companion: _companion, ...tool }) => tool);
  }

  async open(id: ExternalOpenToolId, target: string, kind: "file" | "directory", line = 1, column = 1): Promise<void> {
    const tool = (await this.resolve()).find((candidate) => candidate.id === id);
    if (!tool) throw new Error("所选打开工具当前不可用，请刷新后重试");
    if (!tool.targetKinds.includes(kind)) throw new Error(`${tool.label} 不支持打开${kind === "file" ? "文件" : "目录"}`);
    const cwd = kind === "directory" ? target : dirname(target);
    const position = `${target}:${Math.max(1, Math.floor(line))}:${Math.max(1, Math.floor(column))}`;
    if (id === "explorer") {
      await this.runtime.launch(tool.executable, kind === "directory" ? [target] : ["/select,", target], cwd);
    } else if (id === "vscode" || id === "cursor") {
      await this.runtime.launch(tool.executable, kind === "file" ? ["--goto", position] : [target], cwd);
    } else if (id === "notepad") {
      await this.runtime.launch(tool.executable, [target], cwd);
    } else if (id === "terminal") {
      await this.runtime.launch(tool.executable, ["-d", cwd], cwd);
    } else {
      if (!tool.companion) throw new Error("Codex CLI 缺少可见终端宿主");
      await this.runtime.launch(tool.companion, ["-d", cwd, tool.executable, "-C", cwd], cwd);
    }
  }

  private async resolve(force = false): Promise<ResolvedExternalTool[]> {
    if (!force && this.cache && Date.now() - this.cache.at < 30_000) return this.cache.tools;
    if (this.runtime.platform !== "win32") return [];
    const env = this.runtime.env;
    const local = env.LOCALAPPDATA || "";
    const programFiles = env.ProgramFiles || "";
    const programFilesX86 = env["ProgramFiles(x86)"] || "";
    const windows = env.WINDIR || "C:\\Windows";
    const candidates: Array<{ tool: Omit<ResolvedExternalTool, "executable">; paths: string[] }> = [
      { tool: { id: "explorer", label: "文件资源管理器", detail: "打开目录或定位文件", targetKinds: ["file", "directory"], supportsPosition: false }, paths: [join(windows, "explorer.exe")] },
      { tool: { id: "vscode", label: "Visual Studio Code", detail: "打开项目并定位行列", targetKinds: ["file", "directory"], supportsPosition: true }, paths: [join(local, "Programs", "Microsoft VS Code", "Code.exe"), join(programFiles, "Microsoft VS Code", "Code.exe"), join(programFilesX86, "Microsoft VS Code", "Code.exe")] },
      { tool: { id: "cursor", label: "Cursor", detail: "打开项目并定位行列", targetKinds: ["file", "directory"], supportsPosition: true }, paths: [join(local, "Programs", "cursor", "Cursor.exe"), join(local, "Programs", "Cursor", "Cursor.exe"), join(programFiles, "Cursor", "Cursor.exe")] },
      { tool: { id: "notepad", label: "记事本", detail: "使用 Windows 记事本打开文件", targetKinds: ["file"], supportsPosition: false }, paths: [join(windows, "System32", "notepad.exe"), join(windows, "notepad.exe")] },
      { tool: { id: "terminal", label: "Windows Terminal", detail: "在目标目录打开终端", targetKinds: ["directory"], supportsPosition: false }, paths: [join(local, "Microsoft", "WindowsApps", "wt.exe"), join(programFiles, "WindowsApps", "wt.exe")] },
    ];
    const tools: ResolvedExternalTool[] = [];
    for (const candidate of candidates) {
      const executable = await firstExisting(candidate.paths, this.runtime.exists);
      if (executable) tools.push({ ...candidate.tool, executable });
    }
    const terminal = tools.find((tool) => tool.id === "terminal");
    const codex = await firstExisting([
      join(local, "Microsoft", "WindowsApps", "codex.exe"),
      join(local, "Programs", "Codex", "codex.exe"),
    ], this.runtime.exists);
    if (terminal && codex) tools.push({ id: "codex-cli", label: "Codex CLI", detail: "在 Windows Terminal 中打开当前项目", targetKinds: ["directory"], supportsPosition: false, executable: codex, companion: terminal.executable });
    this.cache = { at: Date.now(), tools };
    return tools;
  }
}

async function firstExisting(paths: string[], exists: (path: string) => Promise<boolean>): Promise<string | undefined> {
  for (const path of paths.filter(Boolean)) if (await exists(path)) return path;
  return undefined;
}

function launchDetached(executable: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child: ChildProcess = spawn(executable, args, { cwd, detached: true, stdio: "ignore", windowsHide: false });
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (error) reject(error); else { child.unref(); resolve(); }
    };
    child.once("error", finish);
    child.once("spawn", () => finish());
  });
}
