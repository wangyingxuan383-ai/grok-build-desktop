import { execFile, spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

interface TerminalEntry {
  process: ChildProcess;
  output: string;
  byteLength: number;
  byteLimit: number;
  truncated: boolean;
  exitCode: number | null;
  waiters: Array<(value: { exitCode: number }) => void>;
  decoder: StringDecoder;
}

export interface TerminalCreateParams {
  command: string;
  cwd?: string;
  env?: Array<{ name: string; value: string }>;
  outputByteLimit?: number;
}

export class TerminalService {
  private readonly terminals = new Map<string, TerminalEntry>();
  private nextId = 1;

  constructor(private readonly baseEnv: NodeJS.ProcessEnv) {}

  create(params: TerminalCreateParams): { terminalId: string } {
    const env = { ...this.baseEnv };
    for (const value of params.env ?? []) env[value.name] = value.value;
    const child = spawn(params.command, { cwd: params.cwd || process.cwd(), env, shell: true, windowsHide: true });
    const entry: TerminalEntry = {
      process: child,
      output: "",
      byteLength: 0,
      byteLimit: params.outputByteLimit ?? 40_000,
      truncated: false,
      exitCode: null,
      waiters: [],
      decoder: new StringDecoder("utf8"),
    };
    const onChunk = (chunk: Buffer): void => {
      const remaining = entry.byteLimit - entry.byteLength;
      if (remaining <= 0) {
        entry.truncated = true;
        return;
      }
      const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      entry.output += entry.decoder.write(slice);
      entry.byteLength += slice.length;
      if (slice.length < chunk.length) entry.truncated = true;
    };
    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.on("error", (error) => {
      entry.output += `\n[spawn error] ${error.message}`;
      this.finish(entry, -1);
    });
    child.on("exit", (code, signal) => {
      const signalCode = signal ? 1 : 0;
      this.finish(entry, code ?? signalCode);
    });
    const terminalId = `t-${this.nextId++}`;
    this.terminals.set(terminalId, entry);
    return { terminalId };
  }

  output(terminalId: string): { output: string; exitStatus: { exitCode: number } | null; truncated: boolean } {
    const entry = this.required(terminalId);
    return { output: entry.output, exitStatus: entry.exitCode === null ? null : { exitCode: entry.exitCode }, truncated: entry.truncated };
  }

  waitForExit(terminalId: string): Promise<{ exitCode: number }> {
    const entry = this.required(terminalId);
    if (entry.exitCode !== null) return Promise.resolve({ exitCode: entry.exitCode });
    return new Promise((resolve) => entry.waiters.push(resolve));
  }

  kill(terminalId: string): void {
    const entry = this.terminals.get(terminalId);
    const pid = entry?.process.pid;
    if (!entry || !pid) return;
    if (process.platform === "win32") execFile("taskkill", ["/PID", String(pid), "/T", "/F"], () => undefined);
    else entry.process.kill("SIGTERM");
  }

  release(terminalId: string): void {
    this.kill(terminalId);
    this.terminals.delete(terminalId);
  }

  async disposeAll(timeoutMs = 5_000): Promise<void> {
    const entries = Array.from(this.terminals.values());
    this.terminals.clear();
    await Promise.allSettled(entries.map((entry) => this.stopAndWait(entry, timeoutMs)));
  }

  private finish(entry: TerminalEntry, exitCode: number): void {
    if (entry.exitCode !== null) return;
    if (!entry.truncated) entry.output += entry.decoder.end();
    entry.exitCode = exitCode;
    for (const waiter of entry.waiters) waiter({ exitCode });
    entry.waiters = [];
  }

  private required(id: string): TerminalEntry {
    const entry = this.terminals.get(id);
    if (!entry) throw new Error(`未知终端：${id}`);
    return entry;
  }

  private async stopAndWait(entry: TerminalEntry, timeoutMs: number): Promise<void> {
    const child = entry.process;
    const pid = child.pid;
    if (!pid || entry.exitCode !== null || child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      child.once("exit", finish);
      if (process.platform === "win32") execFile("taskkill", ["/PID", String(pid), "/T", "/F"], () => undefined);
      else child.kill("SIGTERM");
    });
  }
}
