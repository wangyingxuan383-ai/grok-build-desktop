export interface ConnectionState {
  phase:
    | "connecting"
    | "online"
    | "reconnecting"
    | "offline"
    | "blocked"
    | "paused";
  mode: "live" | "polling";
  failures: number;
  detail?: string;
}
export interface Signal {
  type: string;
  cursor: number;
  epoch: string;
  sessionId?: string;
}
interface ConnectionDependencies {
  read(): Promise<{ cursor: number; epoch: string }>;
  stream(
    cursor: number,
    epoch: string,
    onSignal: (signal: Signal) => void,
    onError: (error: unknown) => void,
  ): () => void;
  refresh(sessionIds?: readonly string[]): Promise<void>;
  state(value: ConnectionState): void;
  setTimeout?(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout?(timer: ReturnType<typeof setTimeout>): void;
  now?(): number;
}
/** One owner for the foreground connection; heartbeats never trigger history reads. */
export class ConnectionManager {
  private generation = 0;
  private active = false;
  private stopStream?: () => void;
  private retry?: ReturnType<typeof setTimeout>;
  private throttle?: ReturnType<typeof setTimeout>;
  private failures = 0;
  private streamFailures = 0;
  private reading = false;
  private refreshBusy = false;
  private dirty = false;
  private targets = new Set<string>();
  private allDirty = false;
  private cursor = 0;
  private epoch = "";
  private lastStreamAttempt = 0;
  private readonly later: NonNullable<ConnectionDependencies["setTimeout"]>;
  private readonly clear: NonNullable<ConnectionDependencies["clearTimeout"]>;
  private deps: ConnectionDependencies;
  constructor(deps: ConnectionDependencies) {
    this.deps = deps;
    this.later = deps.setTimeout ?? ((run, ms) => setTimeout(run, ms));
    this.clear = deps.clearTimeout ?? ((timer) => clearTimeout(timer));
  }
  start() {
    this.stop();
    this.active = true;
    this.failures = 0;
    this.streamFailures = 0;
    this.epoch = "";
    void this.connect(this.generation);
  }
  stop() {
    this.active = false;
    this.generation++;
    this.stopStream?.();
    this.stopStream = undefined;
    if (this.retry !== undefined) this.clear(this.retry);
    if (this.throttle !== undefined) this.clear(this.throttle);
    this.retry = undefined;
    this.throttle = undefined;
    this.dirty = false;
    this.targets.clear();
    this.allDirty = false;
    this.reading = false;
    this.refreshBusy = false;
  }
  dispose() {
    this.stop();
  }
  refresh(sessionId?: string) {
    if (!this.active) return;
    if (sessionId) this.targets.add(sessionId);
    else this.allDirty = true;
    this.dirty = true;
    if (this.throttle === undefined && !this.refreshBusy)
      this.throttle = this.later(() => {
        this.throttle = undefined;
        void this.flush(this.generation);
      }, 600);
  }
  private markStreamHealthy() {
    const wasPolling = this.streamFailures >= 2;
    this.streamFailures = 0;
    this.failures = 0;
    if (this.retry !== undefined) {
      this.clear(this.retry);
      this.retry = undefined;
    }
    return wasPolling;
  }
  private report(phase: ConnectionState["phase"], detail?: string) {
    this.deps.state({
      phase,
      mode: this.streamFailures >= 2 ? "polling" : "live",
      failures: this.failures,
      detail,
    });
  }
  private schedule(ms: number, token: number) {
    if (this.retry !== undefined) this.clear(this.retry);
    this.retry = this.later(() => {
      this.retry = undefined;
      if (this.active && token === this.generation) void this.connect(token);
    }, ms);
  }
  private async connect(token: number) {
    if (!this.active || token !== this.generation || this.reading) return;
    this.reading = true;
    if (this.failures === 0 && this.epoch === "") this.report("connecting");
    try {
      const value = await this.deps.read();
      if (!this.active || token !== this.generation) return;
      this.cursor = value.cursor;
      this.epoch = value.epoch;
      this.failures = 0;
      this.report("online");
      const now = (this.deps.now ?? Date.now)();
      if (this.streamFailures < 2 || now - this.lastStreamAttempt > 60000) {
        this.stopStream?.();
        this.lastStreamAttempt = now;
        this.stopStream = this.deps.stream(
          this.cursor,
          this.epoch,
          (signal) => {
            if (!this.active || token !== this.generation) return;
            this.cursor = signal.cursor;
            this.epoch = signal.epoch;
            const recoveredFromPolling = this.markStreamHealthy();
            if (signal.type === "heartbeat" || signal.type === "connected") {
              this.report("online");
              return;
            }
            if (recoveredFromPolling) this.report("online");
            this.refresh(signal.sessionId);
          },
          (error) => {
            if (!this.active || token !== this.generation) return;
            this.stopStream?.();
            this.stopStream = undefined;
            this.streamFailures++;
            if (this.fatal(error)) {
              this.stop();
              this.report("blocked", this.message(error));
              return;
            }
            this.report("reconnecting");
            this.schedule(this.streamFailures >= 2 ? 6000 : 1500, token);
          },
        );
      }
      if (this.streamFailures >= 2) this.schedule(10000, token);
    } catch (error) {
      if (!this.active || token !== this.generation) return;
      this.failures++;
      if (this.fatal(error)) {
        this.stop();
        this.report("blocked", this.message(error));
        return;
      }
      this.report(
        this.failures >= 3 ? "offline" : "reconnecting",
        this.failures >= 3 ? this.message(error) : undefined,
      );
      this.schedule(
        Math.min(30000, 1500 * 2 ** Math.min(this.failures, 4)),
        token,
      );
    } finally {
      if (token === this.generation) this.reading = false;
    }
  }
  private async flush(token: number) {
    if (!this.active || token !== this.generation || this.refreshBusy) return;
    this.refreshBusy = true;
    this.dirty = false;
    const targets = this.allDirty ? undefined : [...this.targets];
    this.targets.clear();
    this.allDirty = false;
    try {
      await this.deps.refresh(targets);
    } catch (error) {
      if (this.active && token === this.generation) {
        if (this.fatal(error)) {
          this.stop();
          this.report("blocked", this.message(error));
        } else {
          this.stopStream?.();
          this.stopStream = undefined;
          this.schedule(1500, token);
        }
      }
    } finally {
      if (token === this.generation) {
        this.refreshBusy = false;
        if (this.dirty && this.throttle === undefined)
          this.throttle = this.later(() => {
            this.throttle = undefined;
            void this.flush(token);
          }, 600);
      }
    }
  }
  private fatal(error: unknown) {
    const e = error as { status?: number; code?: string };
    return (
      e.status === 401 ||
      e.code === "ERR_REMOTE_IDENTITY" ||
      e.code === "ERR_REMOTE_CERT_TIME" ||
      e.code === "ERR_REMOTE_PROTOCOL"
    );
  }
  private message(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
