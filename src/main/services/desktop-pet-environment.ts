import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface DesktopPetEnvironmentValue {
  readonly locked: boolean;
  readonly presentation: boolean;
  readonly fullScreen: boolean;
  /** Physical screen pixels, possibly with negative monitor coordinates. */
  readonly foregroundRect: Readonly<{ x: number; y: number; width: number; height: number }> | null;
  readonly doubleClickTime: number;
  readonly leftButtonDown: boolean;
}

interface EnvironmentDependencies {
  spawn: (path: string, args: string[], options: { shell: false; windowsHide: true; stdio: "pipe" }) => ChildProcessWithoutNullStreams;
  now: () => number;
}
interface Worker {
  child: ChildProcessWithoutNullStreams;
  buffer: string;
  pendingId?: number;
}

const POLL_MS = 1_000;
const TIMEOUT_MS = 2_500;
const MAX_LINE = 4_096;
const MAX_ID = 2_147_483_647;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const keysAre = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);

/** Validate and copy only the restricted native result; never retain arbitrary helper data. */
export function validateDesktopPetEnvironment(value: unknown): DesktopPetEnvironmentValue | undefined {
  if (!record(value) || !keysAre(value, ["locked", "presentation", "fullScreen", "foregroundRect", "doubleClickTime", "leftButtonDown"])) return;
  if (typeof value.locked !== "boolean" || typeof value.presentation !== "boolean" || typeof value.fullScreen !== "boolean" || typeof value.leftButtonDown !== "boolean") return;
  if (!integer(value.doubleClickTime) || value.doubleClickTime < 1 || value.doubleClickTime > 5_000) return;
  let foregroundRect: DesktopPetEnvironmentValue["foregroundRect"] = null;
  if (value.foregroundRect !== null) {
    const rect = value.foregroundRect;
    if (!record(rect) || !keysAre(rect, ["x", "y", "width", "height"]) || !integer(rect.x) || !integer(rect.y) || !integer(rect.width) || !integer(rect.height)) return;
    if (Math.abs(rect.x) > MAX_ID || Math.abs(rect.y) > MAX_ID || rect.width < 1 || rect.width > MAX_ID || rect.height < 1 || rect.height > MAX_ID) return;
    foregroundRect = Object.freeze({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  }
  if ((value.fullScreen && foregroundRect === null) || (value.locked && (foregroundRect !== null || value.fullScreen || value.leftButtonDown))) return;
  return Object.freeze({ locked: value.locked, presentation: value.presentation, fullScreen: value.fullScreen, foregroundRect, doubleClickTime: value.doubleClickTime, leftButtonDown: value.leftButtonDown });
}

/**
 * Dedicated, read-only GrokComputerHost.exe --desktop-context child; no ComputerUseService,
 * desktop lease, logs or shared child handles. JSONL in: {id,method:"context",ownProcessIds:[pid]}.
 * IDs are positive int32s; ownProcessIds optionally contains <=32 positive int32s.
 * JSONL out: {id,ok:true,result:DesktopPetEnvironmentValue}, or
 * {id,ok:false,error:{code:"invalid_request"|"unsupported_method"|"context_unavailable",message}}.
 * The native mode rejects all other fields/methods. Each line is bounded to 4096 chars.
 * One request in flight, >=1s between sends (including stop/start), 2.5s timeout.
 * Failure publishes a locked snapshot and latches until an explicit stop/start; no auto respawn.
 */
export class DesktopPetEnvironment {
  private readonly dependencies: EnvironmentDependencies;
  private worker?: Worker;
  private active = false;
  private disposed = false;
  private value?: DesktopPetEnvironmentValue;
  private sequence = 0;
  private lastSentAt?: number;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private requestTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly helperPath: string,
    private readonly onChange: (value: DesktopPetEnvironmentValue) => void,
    dependencies: Partial<EnvironmentDependencies> = {},
  ) {
    this.dependencies = { spawn: (path, args, options) => spawn(path, args, options), now: () => performance.now(), ...dependencies };
  }

  get snapshot(): DesktopPetEnvironmentValue | undefined { return this.value; }
  get doubleClickTime(): number | undefined { return this.value?.doubleClickTime; }

  start(): void {
    if (this.disposed || this.active) return;
    this.active = true;
    try {
      const child = this.dependencies.spawn(this.helperPath, ["--desktop-context"], { shell: false, windowsHide: true, stdio: "pipe" });
      const worker: Worker = { child, buffer: "" };
      this.worker = worker;
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => this.receive(worker, chunk));
      // Drain stderr without retaining or logging private native/runtime diagnostics.
      child.stderr.resume();
      const failed = () => { if (this.worker === worker) this.fail(); };
      child.on("error", failed);
      child.on("exit", failed);
      child.on("close", failed);
      child.stdin.on("error", failed);
      child.stdout.on("error", failed);
      child.stdout.on("end", failed);
      child.stderr.on("error", failed);
      this.schedule(worker);
    } catch { this.fail(); }
  }

  stop(): void {
    this.active = false;
    this.retire();
    this.value = undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
  }

  private current(worker: Worker): boolean { return this.active && !this.disposed && this.worker === worker; }

  private schedule(worker: Worker): void {
    if (!this.current(worker)) return;
    const delay = this.lastSentAt === undefined ? 0 : Math.max(0, POLL_MS - (this.dependencies.now() - this.lastSentAt));
    if (delay === 0) this.request(worker);
    else this.pollTimer = setTimeout(() => { this.pollTimer = undefined; this.request(worker); }, delay);
  }

  private request(worker: Worker): void {
    if (!this.current(worker) || worker.pendingId !== undefined) return;
    const id = this.sequence = this.sequence >= MAX_ID ? 1 : this.sequence + 1;
    worker.pendingId = id;
    this.lastSentAt = this.dependencies.now();
    this.requestTimer = setTimeout(() => { if (this.current(worker) && worker.pendingId === id) this.fail(); }, TIMEOUT_MS);
    try {
      worker.child.stdin.write(`${JSON.stringify({ id, method: "context", ownProcessIds: [] })}\n`, error => {
        if (error && this.current(worker)) this.fail();
      });
    } catch { if (this.current(worker)) this.fail(); }
  }

  private receive(worker: Worker, chunk: string): void {
    if (!this.current(worker)) return;
    if (worker.buffer.length + chunk.length > MAX_LINE) { this.fail(); return; }
    worker.buffer += chunk;
    let newline: number;
    while (this.current(worker) && (newline = worker.buffer.indexOf("\n")) >= 0) {
      const line = worker.buffer.slice(0, newline).trim();
      worker.buffer = worker.buffer.slice(newline + 1);
      if (!line) continue;
      let response: unknown;
      try { response = JSON.parse(line); } catch { this.fail(); return; }
      if (!record(response) || !integer(response.id)) { this.fail(); return; }
      if (response.id !== worker.pendingId) continue; // Duplicate, unsolicited or late reply.
      const result = response.ok === true && keysAre(response, ["id", "ok", "result"]) ? validateDesktopPetEnvironment(response.result) : undefined;
      if (!result) { this.fail(); return; }
      clearTimeout(this.requestTimer); this.requestTimer = undefined;
      worker.pendingId = undefined;
      this.publish(result);
      // onChange is allowed to stop/dispose/restart us synchronously.
      this.schedule(worker);
    }
  }

  private publish(value: DesktopPetEnvironmentValue): void {
    const changed = JSON.stringify(this.value) !== JSON.stringify(value);
    this.value = value;
    try { this.onChange(value); } catch { /* The same 1Hz tick also drives system-idle detection. */ }
  }

  private fail(): void {
    this.retire();
    if (!this.active || this.disposed) return;
    this.publish(Object.freeze({ locked: true, presentation: false, fullScreen: false, foregroundRect: null, doubleClickTime: this.value?.doubleClickTime ?? 500, leftButtonDown: false }));
  }

  private retire(): void {
    clearTimeout(this.pollTimer); this.pollTimer = undefined;
    clearTimeout(this.requestTimer); this.requestTimer = undefined;
    const worker = this.worker;
    this.worker = undefined; // Invalidate before end/kill can synchronously emit any event.
    if (!worker) return;
    worker.buffer = ""; worker.pendingId = undefined;
    try { worker.child.stdin.end(); } catch { /* Already closed. */ }
    try { worker.child.kill(); } catch { /* Only the child created by this service. */ }
  }
}
