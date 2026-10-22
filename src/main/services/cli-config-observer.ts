import { createHash } from "node:crypto";
import { realpathSync, watch, type FSWatcher, type Stats } from "node:fs";
import { open, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { parse, type TomlTable } from "smol-toml";
import type { CliConfigState } from "../../shared/cli-config-state";

const MAX_CONFIG_BYTES = 1024 * 1024;
const DEBOUNCE_MS = 100;
const MAX_DEBOUNCE_MS = 750;

/** Main-process-only snapshot. Never forward this object over IPC. */
export interface CliConfigSnapshot {
  table: TomlTable;
  updatedAt: string;
}

/** One parent-directory watcher survives atomic replacement of config.toml. */
export class CliConfigObserver {
  private watcher?: FSWatcher;
  private timer?: ReturnType<typeof setTimeout>;
  private firstEventAt?: number;
  private readonly listeners = new Set<(state: CliConfigState) => void>();
  private snapshot?: CliConfigSnapshot;
  private fingerprint?: string;
  private reading?: Promise<CliConfigSnapshot | undefined>;
  private rereadPending = false;
  private disposed = false;
  private watchFailed = false;
  private state: CliConfigState = { revision: 0, changedAt: new Date(0).toISOString(), externalRouting: false };

  constructor(private readonly configPath: string) {}

  getState(): CliConfigState { return { ...this.state }; }

  /** Read-only, coalesced refresh. Failures keep the last successfully parsed catalog. */
  async read(): Promise<CliConfigSnapshot | undefined> {
    if (this.disposed) return this.snapshot && structuredClone(this.snapshot);
    if (!this.reading) {
      this.reading = this.readStable().finally(() => { this.reading = undefined; });
    }
    const snapshot = await this.reading;
    return snapshot && structuredClone(snapshot);
  }

  /** Emits an initial state, then revisions. The last unsubscribe closes the watcher. */
  async start(onChange: (state: CliConfigState) => void): Promise<() => void> {
    if (this.disposed) return () => undefined;
    let revision = -1;
    const deliver = (state: CliConfigState) => {
      if (state.revision === revision || !this.listeners.has(deliver)) return;
      revision = state.revision;
      // Subscriber failures must not escape into fs.watch or leak raw errors.
      try { void Promise.resolve(onChange({ ...state })).catch(() => undefined); } catch { /* observation remains available */ }
    };
    this.listeners.add(deliver);
    if (!this.watcher) this.watchParent();
    await this.read();
    deliver(this.getState());
    return () => {
      this.listeners.delete(deliver);
      if (!this.listeners.size) this.stopWatching();
    };
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.stopWatching();
  }

  private watchParent(): void {
    this.watchFailed = false;
    try {
      // Windows DOS short-name aliases can crash libuv's directory watcher.
      const parent = realpathSync.native(dirname(this.configPath));
      this.watcher = watch(parent, { persistent: false }, (_event, filename) => {
        const name = filename?.toString();
        const target = basename(this.configPath);
        if (name && (process.platform === "win32" ? name.toLowerCase() !== target.toLowerCase() : name !== target)) return;
        this.scheduleRead();
      });
      this.watcher.on("error", () => {
        this.stopWatching();
        this.watchFailed = true;
        this.publish({ ...this.state, notice: "watch-unavailable" });
      });
    } catch {
      // Missing/inaccessible parents are not created, scanned or recursively watched.
      this.watchFailed = true;
    }
  }

  private stopWatching(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.firstEventAt = undefined;
    this.watcher?.close();
    this.watcher = undefined;
  }

  private scheduleRead(): void {
    if (this.disposed || !this.listeners.size) return;
    const now = Date.now();
    this.firstEventAt ??= now;
    if (this.timer) clearTimeout(this.timer);
    const delay = Math.max(0, Math.min(DEBOUNCE_MS, MAX_DEBOUNCE_MS - (now - this.firstEventAt)));
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.firstEventAt = undefined;
      // If an event arrived during a read, perform one fresh read after it settles.
      if (this.rereadPending) return;
      this.rereadPending = true;
      void Promise.resolve(this.reading).then(async () => {
        this.rereadPending = false;
        if (!this.disposed && this.listeners.size) await this.read();
      });
    }, delay);
    this.timer.unref();
  }

  private async readStable(): Promise<CliConfigSnapshot | undefined> {
    let notice: CliConfigState["notice"] = "config-unavailable";
    try {
      const file = await open(this.configPath, "r");
      let raw: string;
      let before: Stats;
      try {
        before = await file.stat();
        if (!before.isFile()) throw new Error();
        notice = "config-too-large";
        if (before.size > MAX_CONFIG_BYTES) throw new Error();
        // A writer growing the file cannot cause an unbounded read/allocation.
        const bytes = Buffer.alloc(before.size + 1);
        let length = 0;
        while (length < bytes.length) {
          const result = await file.read(bytes, length, bytes.length - length, length);
          if (!result.bytesRead) break;
          length += result.bytesRead;
        }
        notice = "config-unavailable";
        const after = await file.stat();
        const current = await stat(this.configPath);
        if (length !== before.size || !sameFile(before, after) || !sameFile(after, current)) throw new Error();
        raw = bytes.subarray(0, length).toString("utf8");
      } finally {
        await file.close();
      }
      notice = "config-invalid";
      const table = parse(raw);
      if (table.model !== undefined && !isTable(table.model)) throw new Error();
      if (table.models !== undefined && !isTable(table.models)) throw new Error();
      if (Object.values(record(table.model)).some((model) => !isTable(model))) throw new Error();
      if (this.disposed) return this.snapshot;
      this.snapshot = { table, updatedAt: before.mtime.toISOString() };
      const fingerprint = createHash("sha256").update(raw).digest("hex");
      const configured = record(table.models).default;
      const defaultModelId = typeof configured === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(configured) ? configured : undefined;
      // Only the selected model's literal URL is evidence. No environment lookup,
      // manager-directory inference, DNS lookup, probe or ownership assertion.
      const endpoint = typeof configured === "string" ? record(record(table.model)[configured]).base_url : undefined;
      this.publish({
        revision: this.state.revision,
        changedAt: this.state.changedAt,
        ...(defaultModelId ? { defaultModelId } : {}),
        externalRouting: isExplicitLoopback(endpoint),
        ...(this.watchFailed ? { notice: "watch-unavailable" as const } : {}),
      }, fingerprint !== this.fingerprint);
      this.fingerprint = fingerprint;
    } catch {
      if (!this.disposed) this.publish({ ...this.state, notice });
    }
    return this.snapshot;
  }

  private publish(next: CliConfigState, contentChanged = false): void {
    if (this.disposed) return;
    if (!contentChanged && next.notice === this.state.notice && next.defaultModelId === this.state.defaultModelId && next.externalRouting === this.state.externalRouting) return;
    this.state = { ...next, revision: this.state.revision + 1, changedAt: new Date().toISOString() };
    for (const listener of this.listeners) listener(this.getState());
  }
}

function sameFile(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

function isTable(value: unknown): value is TomlTable {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

function record(value: unknown): TomlTable { return isTable(value) ? value : {}; }

function isExplicitLoopback(value: unknown): boolean {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value) || value.includes("${")) return false;
  try {
    const url = new URL(value);
    // Use a strict literal allowlist; private LAN/DNS names are not evidence of a local router.
    return url.hostname === "localhost" || url.hostname === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(url.hostname);
  } catch { return false; }
}
