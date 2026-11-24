import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import type { IPty } from "node-pty";
import type { WorkspaceTerminal, WorkspaceTerminalEvent } from "../../shared/workspace-tools";
import { preferredPowerShell } from "./powershell-path";
import { workspaceTerminalEnvironment } from "./workspace-terminal-environment";

function workspaceKey(workspace: string): string {
  const normalized = resolve(workspace).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

export interface WorkspaceTerminalCreateOptions {
  title?: string;
  command?: string;
  env?: Record<string, string>;
  onData?: (chunk: string) => void;
  onExit?: (exitCode: number) => void;
}

export class WorkspaceTerminalService {
  private pending = 0;
  private disposed = false;
  private readonly entries = new Map<string, { state: WorkspaceTerminal; process: IPty; finalizeExit: (exitCode: number) => void }>();

  constructor(private readonly emit: (event: WorkspaceTerminalEvent) => void) {}

  list(workspace: string): WorkspaceTerminal[] {
    if (!workspace.trim()) return [];
    const targetKey = workspaceKey(workspace);
    return [...this.entries.values()]
      .filter((entry) => workspaceKey(entry.state.workspace) === targetKey)
      .map((entry) => ({ ...entry.state }));
  }

  async create(workspace: string, options?: WorkspaceTerminalCreateOptions): Promise<WorkspaceTerminal> {
    if (this.disposed) throw Error("终端服务已关闭");
    if (this.entries.size + this.pending >= 16) this.evictOldestExited();
    if (this.entries.size + this.pending >= 16) throw Error("最多保留 16 个终端，请先关闭不用的终端");
    this.pending++;
    try {
      const pty = await import("node-pty");
      if (this.disposed) throw Error("终端服务已关闭");
      const id = randomUUID();
      let executable: string;
      let commandArgs: string[] | string;
      if (process.platform === "win32") {
        const psExe = preferredPowerShell(process.env);
        const isPwsh7 = /pwsh(?:\.exe)?$/i.test(psExe);
        if (!options?.command) {
          executable = psExe;
          commandArgs = ["-NoLogo", "-NoProfile"];
        } else if (!isPwsh7 && /&&|\|\|/.test(options.command)) {
          executable = process.env.ComSpec || join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe");
          commandArgs = `/d /s /c "${options.command}"`;
        } else {
          executable = psExe;
          commandArgs = ["-NoLogo", "-NoProfile", "-EncodedCommand", Buffer.from(options.command, "utf16le").toString("base64")];
        }
      } else {
        executable = process.env.SHELL || "/bin/sh";
        commandArgs = options?.command ? ["-lc", options.command] : [];
      }
      const terminal = pty.spawn(executable, commandArgs as string[], {
        cwd: workspace,
        name: "xterm-256color",
        cols: 100,
        rows: 30,
        env: { ...workspaceTerminalEnvironment(process.env), ...(options?.env ?? {}) },
      });
      const state: WorkspaceTerminal = {
        id,
        workspace,
        title: options?.title?.trim().slice(0, 80) || (process.platform === "win32" ? "PowerShell" : "Shell"),
        status: "running",
        output: "",
        sequence: 0,
      };
      const publish = (data: string, exitCode?: number): void => {
        if (this.disposed || !this.entries.has(id)) return;
        state.output = (state.output + data).slice(-1024 * 1024);
        state.sequence++;
        this.emit({ id, data, sequence: state.sequence, exitCode });
      };
      let exited = false;
      const finalizeExit = (exitCode: number): void => {
        if (exited) return;
        exited = true;
        state.status = "exited";
        state.exitCode = exitCode;
        publish(`\r\n[进程已退出：${exitCode}]\r\n`, exitCode);
        options?.onExit?.(exitCode);
      };
      this.entries.set(id, { state, process: terminal, finalizeExit });
      terminal.onData((data) => {
        publish(data);
        options?.onData?.(data);
      });
      terminal.onExit((event) => {
        if (!this.entries.has(id)) return;
        finalizeExit(event.exitCode);
      });
      return { ...state };
    } finally {
      this.pending--;
    }
  }

  write(id: string, data: string): void {
    const entry = this.require(id);
    if (entry.state.status !== "running") throw Error("终端进程已退出");
    if (data.length > 65536) throw Error("单次终端输入过长");
    entry.process.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || cols > 500 || rows < 2 || rows > 300) {
      throw Error("终端尺寸无效");
    }
    const entry = this.require(id);
    if (entry.state.status === "running") entry.process.resize(cols, rows);
  }

  close(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const wasRunning = entry.state.status === "running";
    const pid = entry.process.pid;
    if (wasRunning) {
      entry.finalizeExit(-1);
    }
    this.entries.delete(id);
    if (wasRunning) {
      if (process.platform === "win32" && typeof pid === "number" && pid > 0) {
        execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => undefined);
      }
      try { entry.process.kill(); } catch { /* process may already have exited */ }
    }
  }

  private evictOldestExited(): boolean {
    for (const [id, entry] of this.entries) {
      if (entry.state.status === "exited") {
        this.entries.delete(id);
        return true;
      }
    }
    return false;
  }

  removeExited(workspace?: string): number {
    const targetKey = workspace?.trim() ? workspaceKey(workspace) : undefined;
    let removed = 0;
    for (const [id, entry] of this.entries) {
      if (entry.state.status === "exited" && (!targetKey || workspaceKey(entry.state.workspace) === targetKey)) {
        this.entries.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  dispose(): void {
    this.disposed = true;
    for (const id of [...this.entries.keys()]) {
      try { this.close(id); } catch { /* ignore shutdown errors */ }
    }
  }

  private require(id: string) {
    const entry = this.entries.get(id);
    if (!entry) throw Error("终端已关闭");
    return entry;
  }
}
