import { createHash } from "node:crypto";
import type { ChatEvent } from "../../shared/types";
import { nativeRunDismissible, nativeRunIdValid, nativeRunKey, type NativeRunAction, type NativeRunControlInput, type NativeRunControlReceipt, type NativeRunDismissInput, type NativeRunSnapshot, type NativeRunWire } from "../../shared/native-runs";

// Private process ownership survives the controller's asynchronous event queue.
// It never becomes part of IPC, history or persisted task summaries.
const eventOwners = new WeakMap<ChatEvent, object>();
export function bindNativeRunEventOwner(event: ChatEvent, owner: object): void { eventOwners.set(event, owner); }

/** First CLI release whose native Goal/Workflow commands passed the isolated end-to-end check. */
export const NATIVE_RUN_CONTROL_MIN_VERSION = "1.0.60";
/** Releases found to break the control contract. Keep empty unless a regression is confirmed. */
const NATIVE_RUN_CONTROL_BLOCKED_VERSIONS: readonly string[] = [];
/**
 * Controls follow the protocol contract rather than one binary hash: a supported version still
 * needs declared commands, exact native IDs and a native receipt before any action is reported.
 */
export function nativeRunControlSupported(version?: string): boolean {
  const parsed = /(\d+)\.(\d+)\.(\d+)/.exec(version ?? "");
  if (!parsed || NATIVE_RUN_CONTROL_BLOCKED_VERSIONS.includes(parsed.slice(1).join("."))) return false;
  const [major = 0, minor = 0, patch = 0] = parsed.slice(1).map(Number), [x = 0, y = 0, z = 0] = NATIVE_RUN_CONTROL_MIN_VERSION.split(".").map(Number);
  return major !== x ? major > x : minor !== y ? minor > y : patch >= z;
}
const TERMINAL_NOTICE = new Set<NativeRunSnapshot["status"]>(["completed", "failed", "budget-limited"]);
export interface NativeRunConnection {
  owner: object; controllable: boolean; commands: string[]; working: boolean; needsUser: boolean; queued: boolean;
  activeTurnId?: string; controlBusy: boolean;
  reserve(): () => void;
  prompt(text: string, performsWork: boolean): Promise<void>;
  cancel(): void;
}
type Entry = { value: NativeRunSnapshot; owner?: object; goalTurn?: string };
export class NativeRunService {
  private entries = new Map<string, Entry>();
  private candidates = new Map<string, { owner: object; turn: string }>();
  private listeners = new Set<() => void>();
  private operations = new Map<string, { fingerprint: string; promise: Promise<NativeRunControlReceipt> }>();
  private locks = new Set<string>();
  private uncertain = new Map<string, NativeRunAction>();
  private loaded?: Promise<void>;
  constructor(private options: {
    connection(id: string): NativeRunConnection | undefined;
    saved(): Promise<NativeRunSnapshot[]>;
    save(sessionId: string, rows: NativeRunSnapshot[]): Promise<void>;
    onControlStart?(input: NativeRunControlInput): void;
    /** A live workflow reached a final state for the first time in this connection. */
    onWorkflowFinished?(row: NativeRunSnapshot): void;
    timeoutMs?: number;
  }) {}

  private load(): Promise<void> {
    return this.loaded ??= this.options.saved().then(rows => {
      for (const row of rows) if (nativeRunIdValid(row.id) && !this.entries.has(nativeRunKey(row))) this.entries.set(nativeRunKey(row), { value: { ...row, stale: true, actions: [] } });
    }).catch(() => undefined);
  }
  record(event: ChatEvent, replaying = false): void {
    if (!event.sessionId) return;
    const sessionId = event.sessionId, connection = this.options.connection(sessionId);
    const sourceOwner = eventOwners.get(event);
    if (sourceOwner && sourceOwner !== connection?.owner && !replaying) return;
    if (event.type === "user-message" && !replaying && connection?.activeTurnId && /^\/goal\s+(?!status(?:\s|$)|pause(?:\s|$)|clear(?:\s|$))\S/i.test(event.text)) {
      this.candidates.set(sessionId, { owner: connection.owner, turn: connection.activeTurnId });
    }
    if (event.type === "runtime-update" && (event.update.kind === "goal" || event.update.kind === "workflow")) {
      const row = event.update.data?.nativeRun as NativeRunWire | undefined;
      if (row && nativeRunIdValid(row.id) && row.kind === event.update.kind) {
        const key = nativeRunKey({ ...row, sessionId }), previous = this.entries.get(key);
        if (previous && previous.owner === connection?.owner && row.nativeRevision !== undefined && previous.value.nativeRevision !== undefined && row.nativeRevision < previous.value.nativeRevision) return;
        const candidate = this.candidates.get(sessionId);
        const goalTurn = row.kind === "goal" && candidate && candidate.owner === connection?.owner && candidate.turn === connection?.activeTurnId ? candidate.turn : previous?.owner === connection?.owner ? previous?.goalTurn : undefined;
        const value: NativeRunSnapshot = { ...row, sessionId, revision: "", observedAt: event.update.at, stale: replaying || !connection, actions: [] };
        if (row.kind === "goal" && row.nativeStatus === "cleared" && previous) { value.title = previous.value.title; value.budget = previous.value.budget; }
        if (this.entries.size < 1024 || previous) this.entries.set(key, { value, owner: replaying ? undefined : connection?.owner, goalTurn });
        const live = !replaying && Boolean(connection);
        // Newer live state supersedes an unconfirmed outcome, whether or not it matches the request.
        if (live) this.uncertain.delete(key);
        // Workflows finish in the background without a prompt turn, so this is their only completion signal.
        if (live && value.kind === "workflow" && TERMINAL_NOTICE.has(value.status) && previous && !TERMINAL_NOTICE.has(previous.value.status) && previous.value.status !== "stopped") this.options.onWorkflowFinished?.(value);
        this.trim(sessionId);
        // Reuse the existing runtime projection; never create another task database.
        void this.options.save(sessionId, this.savedFor(sessionId)).catch(() => undefined);
      }
    }
    for (const listener of this.listeners) listener();
  }
  private savedFor(id: string): NativeRunSnapshot[] {
    return [...this.entries.values()].filter(e => e.value.sessionId === id).map(e => ({ ...e.value, actions: [], stale: true }));
  }
  private trim(id: string): void {
    const terminal = [...this.entries.entries()].filter(([,e]) => e.value.sessionId === id && ["completed","stopped","failed","budget-limited"].includes(e.value.status));
    for (const [key] of terminal.slice(0, Math.max(0, terminal.length - 32))) this.entries.delete(key);
  }
  async list(sessionId?: string): Promise<NativeRunSnapshot[]> {
    await this.load();
    return [...this.entries.values()].filter(e => !sessionId || e.value.sessionId === sessionId).map(e => this.snapshot(e)).sort((a,b) => b.observedAt.localeCompare(a.observedAt));
  }
  async forget(sessionId: string): Promise<void> {
    await this.load();
    this.candidates.delete(sessionId);
    for (const [key, entry] of this.entries) if (entry.value.sessionId === sessionId) {
      this.entries.delete(key); this.uncertain.delete(key);
    }
  }
  /** Removes a finished or restored summary only; live running/paused work cannot be hidden. */
  async dismiss(input: NativeRunDismissInput): Promise<void> {
    if (!nativeRunIdValid(input.sessionId) || !nativeRunIdValid(input.runId) || !["goal","workflow"].includes(input.kind)) throw Error("任务身份无效");
    await this.load();
    const key = nativeRunKey({ sessionId: input.sessionId, kind: input.kind, id: input.runId }), entry = this.entries.get(key);
    if (!entry) return;
    if (!nativeRunDismissible(this.snapshot(entry))) throw Error("执行中或已暂停的任务不能移除记录");
    this.entries.delete(key); this.uncertain.delete(key);
    await this.options.save(input.sessionId, this.savedFor(input.sessionId)).catch(() => undefined);
    for (const listener of this.listeners) listener();
  }
  private snapshot(entry: Entry): NativeRunSnapshot {
    const row = entry.value, c = this.options.connection(row.sessionId), actions: NativeRunAction[] = [];
    const stale = row.stale || !c || c.owner !== entry.owner;
    const finished = ["completed", "stopped", "failed", "budget-limited"].includes(row.status);
    let reason = finished ? undefined : stale ? "上次记录的状态；CLI 报告新状态后会自动更新" : !c?.controllable ? "此 CLI 版本不支持在应用内控制（需要 1.0.60 或更高）" : c.controlBusy || this.locks.has(row.sessionId) ? "正在提交操作…" : c.needsUser ? "请先处理会话中的待回应事项" : c.queued ? "请先处理会话中的排队消息" : undefined;
    if (this.uncertain.has(nativeRunKey(row))) reason = "上次操作未收到 CLI 确认；收到新状态后可再次操作";
    if (!reason && c && !finished) {
      if (!c.commands.includes(row.kind)) reason = "当前 CLI 没有提供对应命令";
      else if (row.kind === "goal" && row.status === "running") {
        if (c.working && entry.goalTurn && c.activeTurnId === entry.goalTurn) actions.push("pause", "stop");
        else reason = "暂时无法确认这个目标对应的执行回合";
      } else if (c.working) reason = "当前回合结束后可操作";
      else if (row.status === "paused") actions.push("resume", "stop");
      else if (row.kind === "workflow" && row.status === "running") actions.push("pause", "stop");
    }
    const revision = createHash("sha256").update(JSON.stringify([row.sessionId,row.kind,row.id,row.nativeRevision,row.nativeStatus,row.status,row.phase,stale,actions,reason,entry.goalTurn])).digest("hex");
    return { ...row, stale, revision, actions, unavailableReason: reason };
  }
  control(input: NativeRunControlInput): Promise<NativeRunControlReceipt> {
    for (const id of [input.sessionId,input.runId,input.operationId]) if (!nativeRunIdValid(id)) return Promise.reject(Error("任务身份无效"));
    if (!["goal","workflow"].includes(input.kind) || !["pause","resume","stop"].includes(input.action) || !/^[a-f0-9]{64}$/.test(input.revision)) return Promise.reject(Error("操作参数无效"));
    const fingerprint = JSON.stringify(input), old = this.operations.get(input.operationId);
    if (old) return old.fingerprint === fingerprint ? old.promise : Promise.reject(Error("操作标识已用于其他请求"));
    const promise = Promise.resolve().then(() => this.perform(input));
    this.operations.set(input.operationId, { fingerprint, promise });
    if (this.operations.size > 512) this.operations.delete(this.operations.keys().next().value!);
    return promise;
  }
  private async perform(input: NativeRunControlInput): Promise<NativeRunControlReceipt> {
    await this.load();
    const key = nativeRunKey({sessionId:input.sessionId,kind:input.kind,id:input.runId}), entry = this.entries.get(key);
    if (!entry) throw Error("这项任务已不存在，请刷新");
    const before = this.snapshot(entry), c = this.options.connection(input.sessionId);
    if (before.revision !== input.revision) throw Error("任务状态已变化，请刷新后再操作");
    if (!c || !before.actions.includes(input.action)) throw Error(before.unavailableReason || "当前状态不允许此操作");
    if (this.locks.has(input.sessionId)) throw Error("这个会话已有操作正在进行");
    this.locks.add(input.sessionId);
    let release: () => void;
    try { release = c.reserve(); } catch (error) { this.locks.delete(input.sessionId); throw error; }
    this.options.onControlStart?.(input);
    const deadline = Date.now() + (this.options.timeoutMs ?? 15000);
    const sameOwner = () => this.options.connection(input.sessionId)?.owner === c.owner;
    const receipt = (state: NativeRunControlReceipt["state"], message: string): NativeRunControlReceipt => ({operationId:input.operationId,state,message});
    try {
      const wait = (predicate: () => boolean) => this.waitFor(() => {
        if (!sameOwner()) throw Error("连接已变化，操作结果待确认");
        return predicate();
      }, deadline);
      const current = () => this.entries.get(key)?.value;
      if (input.kind === "goal" && input.action !== "resume" && c.working) {
        const paused = wait(() => current()?.status === "paused" && !this.options.connection(input.sessionId)?.working);
        c.cancel(); await paused;
      }
      if (input.kind === "goal" && input.action === "pause" && current()?.status === "paused") return receipt("completed","目标已暂停");
      if (!sameOwner()) throw Error("连接已变化，未发送后续命令");
      const now = this.options.connection(input.sessionId)!;
      if (now.working || now.needsUser || now.queued) throw Error("会话执行状态已变化，未发送后续命令");
      if (input.kind === "goal") {
        const latest = [...this.entries.values()].filter(e => e.value.sessionId === input.sessionId && e.value.kind === "goal" && e.owner === c.owner && e.value.status !== "stopped").at(-1);
        if (latest?.value.id !== input.runId) throw Error("当前目标已经改变，未执行命令");
      }
      const confirmed = wait(() => Boolean(current() && this.confirmed(current()!, input.action)));
      const command = input.kind === "goal" ? `/goal ${input.action === "stop" ? "clear" : input.action}` : `/workflow ${input.action} ${input.runId}`;
      const request = c.prompt(command, input.kind === "goal" && input.action === "resume");
      const failed = request.then(() => new Promise<never>(() => {}));
      await Promise.race([confirmed, failed]);
      if (!(input.kind === "goal" && input.action === "resume")) await wait(() => !this.options.connection(input.sessionId)?.working);
      return receipt("completed",input.action === "pause" ? "已暂停" : input.action === "resume" ? "已恢复" : "已结束");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/待确认/.test(message)) { this.uncertain.set(key,input.action); return receipt("unknown",message); }
      return receipt("failed",message);
    } finally { this.locks.delete(input.sessionId); release(); }
  }
  private confirmed(row: NativeRunSnapshot, action: NativeRunAction): boolean {
    return action === "pause" ? row.status === "paused" : action === "resume" ? row.status === "running" : row.status === "stopped";
  }
  private waitFor(predicate: () => boolean, deadline: number): Promise<void> {
    return new Promise((resolve,reject) => {
      const done = (error?: unknown) => { clearTimeout(timer); this.listeners.delete(check); error ? reject(error) : resolve(); };
      const check = () => { try { if (predicate()) done(); } catch (error) { done(error); } };
      const timer = setTimeout(() => done(Error("未收到 CLI 确认，结果待确认")), Math.max(1,deadline-Date.now()));
      this.listeners.add(check); check();
    });
  }
}
