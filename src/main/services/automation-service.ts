import { safeStorage } from "electron";
import { spawn } from "node:child_process";
import { mkdir, open, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AutomationGlobalPolicy, AutomationPendingConfirmation, AutomationRegistrationDiagnostic, AutomationRunRecord, AutomationTask, AutomationTaskInput, ComputerRiskCategory } from "../../shared/types";
import iconv from "iconv-lite";
import { calendarWakeups, latestCalendarOccurrence, nextScheduledRun } from "./automation-schedule";
import { JsonStore, withCrossProcessFileLock } from "./json-store";
import type { LogService } from "./log-service";

interface StoredAutomationTask extends AutomationTask { encryptedPrompt: string; sessionMigrationComplete?: boolean; deletedAt?: string; }
interface PendingFile { public: AutomationPendingConfirmation; encryptedSummary: string; decision?: boolean; }

export interface AutomationCipher { encrypt(value: string): string; decrypt(value: string): string; }
export interface TaskSchedulerAdapter {
  supported(): boolean;
  register(task: AutomationTask, executable: string, baseArgs: string[]): Promise<void>;
  unregister(taskId: string): Promise<void>;
}

export interface AutomationServiceOptions {
  executable: string;
  workerBaseArgs?: string[];
  cipher?: AutomationCipher;
  scheduler?: TaskSchedulerAdapter;
  launchWorker?: (taskId: string, runId: string) => Promise<void>;
  now?: () => Date;
  onChanged?: (event: { taskId: string; run?: AutomationRunRecord; task?: AutomationTask; pending?: AutomationPendingConfirmation }) => void;
  pendingPollMs?: number;
  globalSlotPollMs?: number;
  globalSlotTimeoutMs?: number;
  leaseHeartbeatMs?: number;
  leaseStaleMs?: number;
  cancellationPollMs?: number;
}

const DEFAULT_POLICY: AutomationGlobalPolicy = {
  // Empty means "inherit the current Desktop default when the run starts".
  defaultProfile: { modelId: "", effort: "", mode: "auto", permissionPolicy: "auto", computerEnabled: false },
  maxConcurrentRuns: 2,
  confirmationTimeoutMinutes: 30,
  inactivityTimeoutMinutes: 0,
  notifyOnSuccess: true,
  notifyOnFailure: true,
};

interface AutomationLeaseRecord {
  version: 1;
  leaseId: string;
  runId: string;
  pid: number;
  processStartedAt: string;
  heartbeatAt: string;
}

interface AutomationLease {
  path: string;
  record: AutomationLeaseRecord;
  handle: Awaited<ReturnType<typeof open>>;
  heartbeat?: NodeJS.Timeout;
  release(): Promise<void>;
}

const PROCESS_STARTED_AT = new Date().toISOString();

export class AutomationService {
  private readonly root: string;
  private readonly tasksRoot: string;
  private readonly runsRoot: string;
  private readonly locksRoot: string;
  private readonly slotsRoot: string;
  private readonly pendingRoot: string;
  private readonly policyStore: JsonStore<AutomationGlobalPolicy>;
  private readonly cipher: AutomationCipher;
  private readonly scheduler: TaskSchedulerAdapter;
  private readonly now: () => Date;
  private readonly activeRunControllers = new Map<string, AbortController>();

  constructor(userDataPath: string, private readonly log: LogService, private readonly options: AutomationServiceOptions) {
    this.root = join(userDataPath, "automations");
    this.tasksRoot = join(this.root, "tasks");
    this.runsRoot = join(this.root, "runs");
    this.locksRoot = join(this.root, "locks");
    this.slotsRoot = join(this.root, "slots");
    this.pendingRoot = join(this.root, "pending");
    this.policyStore = new JsonStore(join(this.root, "policy.json"), DEFAULT_POLICY);
    this.cipher = options.cipher ?? new SafeStorageCipher();
    this.scheduler = options.scheduler ?? new WindowsTaskScheduler();
    this.now = options.now ?? (() => new Date());
  }

  async list(): Promise<AutomationTask[]> {
    await mkdir(this.tasksRoot, { recursive: true });
    const values = await Promise.all((await readdir(this.tasksRoot).catch(() => [])).filter((name) => name.endsWith(".json")).map((name) => this.readTaskFile(join(this.tasksRoot, name)).catch(() => undefined)));
    const tasks = values.filter((value): value is StoredAutomationTask => Boolean(value));
    return tasks.map((value) => stripPrompt(value, this.now())).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }

  async create(input: AutomationTaskInput): Promise<AutomationTask[]> { await this.createOne(input); return this.list(); }

  async createOne(input: AutomationTaskInput): Promise<AutomationTask> {
    const normalized = { ...input, contextPolicy: input.contextPolicy ?? "reuse", timeZone: input.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, scheduleAnchor: input.scheduleAnchor ?? this.now().toISOString() };
    validateTaskInput(normalized, true);
    if (normalized.schedule.kind === "once") normalized.schedule = { kind: "once", at: new Date(normalized.schedule.at).toISOString() };
    const id = crypto.randomUUID(); const now = this.now().toISOString();
    const task: StoredAutomationTask = { ...normalized, missedRunPolicy: normalized.missedRunPolicy ?? "run-once", id, revision: 1, sessionId: normalized.destination === "current-session" ? normalized.targetSessionId : undefined, promptPresent: true, encryptedPrompt: this.cipher.encrypt(normalized.prompt!.trim()), sessionMigrationComplete: true, registrationStatus: this.scheduler.supported() ? "needs-repair" : "unsupported", createdAt: now, updatedAt: now };
    delete (task as Partial<AutomationTaskInput>).prompt;
    await this.definitionTransaction(id, async () => { await this.writeTask(task); await this.register(task); });
    this.options.onChanged?.({ taskId: id, task: stripPrompt(task) });
    return stripPrompt(task, this.now());
  }

  async update(id: string, patch: Partial<AutomationTaskInput>): Promise<AutomationTask[]> {
    await this.definitionTransaction(id, async () => {
    const current = await this.readTask(id);
    if (current.destination === "current-session") {
      if ((patch.targetSessionId !== undefined && patch.targetSessionId !== current.targetSessionId) || (patch.destination !== undefined && patch.destination !== current.destination) || (patch.executionProfileId !== undefined && patch.executionProfileId !== current.executionProfileId) || (patch.contextPolicy !== undefined && patch.contextPolicy !== "reuse") || (patch.profile && Object.entries(patch.profile).some(([key, value]) => value !== current.profile[key as keyof typeof current.profile]))) throw new Error("当前会话任务保留绑定时的执行配置；更改配置请重新创建任务");
    }
    if ((patch.schedule && scheduleKey(patch.schedule) !== scheduleKey(current.schedule)) || (patch.timeZone !== undefined && patch.timeZone !== current.timeZone)) patch = { ...patch, scheduleAnchor: this.now().toISOString() };
    const candidate = { ...current, ...patch, id, revision: (current.revision ?? 1) + 1, profile: { ...current.profile, ...patch.profile }, schedule: patch.schedule ?? current.schedule, updatedAt: this.now().toISOString() } as StoredAutomationTask;
    if (patch.prompt !== undefined) { if (!patch.prompt.trim()) throw new Error("任务提示词不能为空"); candidate.encryptedPrompt = this.cipher.encrypt(patch.prompt.trim()); candidate.promptPresent = true; }
    delete (candidate as Partial<AutomationTaskInput>).prompt;
    validateTaskInput({ ...candidate, prompt: this.cipher.decrypt(candidate.encryptedPrompt) }, true);
    if (candidate.schedule.kind === "once") candidate.schedule = { kind: "once", at: new Date(candidate.schedule.at).toISOString() };
    await this.writeTask(candidate); await this.register(candidate);
    this.options.onChanged?.({ taskId: id, task: stripPrompt(candidate) });
    });
    return this.list();
  }

  async delete(id: string): Promise<AutomationTask[]> {
    await this.definitionTransaction(id, async () => {
      const task = await this.readTask(id);
      task.deletedAt = this.now().toISOString(); task.enabled = false; task.revision = (task.revision ?? 1) + 1;
      await this.writeTask(task);
      await this.scheduler.unregister(id).catch((error) => this.log.log(error));
    });
    for (const run of await this.listRuns(id)) if (["queued", "running", "awaiting-confirmation"].includes(run.status)) await this.cancelRun(run.id);
    this.options.onChanged?.({ taskId: id });
    return this.list();
  }

  async pause(id: string, paused: boolean): Promise<AutomationTask[]> { return this.update(id, { enabled: !paused }); }

  async runNow(id: string): Promise<AutomationRunRecord> {
    await this.readTask(id);
    const run: AutomationRunRecord = { id: crypto.randomUUID(), taskId: id, status: "queued", scheduledAt: this.now().toISOString() };
    await this.writeRun(run); this.options.onChanged?.({ taskId: id, run });
    if (this.options.launchWorker) await this.options.launchWorker(id, run.id);
    else await this.execute(id, run.id, async () => { throw new Error("未配置自动化 Worker"); });
    return run;
  }

  async listRuns(taskId?: string): Promise<AutomationRunRecord[]> {
    await this.recoverAbandonedRuns();
    return (await this.readRuns()).filter((value) => !taskId || value.taskId === taskId).slice(0, 500);
  }

  async cancelRun(runId: string): Promise<AutomationRunRecord> {
    const path = this.runPath(runId);
    const run = await readJson<AutomationRunRecord>(path);
    if (["completed", "failed", "cancelled", "skipped"].includes(run.status)) return run;
    const cancelled: AutomationRunRecord = {
      ...run,
      status: "cancelled",
      finishedAt: this.now().toISOString(),
      error: "用户已停止任务",
    };
    await this.writeRun(cancelled);
    await this.rejectPendingForRun(runId);
    this.activeRunControllers.get(runId)?.abort(new Error("用户已停止任务"));
    this.options.onChanged?.({ taskId: run.taskId, run: cancelled });
    return cancelled;
  }

  async setExecutionSession(id: string, sessionId?: string, expectedRevision?: number): Promise<void> {
    await this.definitionTransaction(id, async () => {
      const task = await this.readTask(id).catch(() => undefined);
      if (!task || (expectedRevision !== undefined && task.revision !== expectedRevision)) return;
      await atomicJson(join(this.root, "runtime", `${safeId(id)}.json`), { sessionId, sessionRevision: task.revision, sessionMigrationComplete: true });
    });
  }

  private definitionTransaction<T>(id: string, action: () => Promise<T>): Promise<T> {
    return withCrossProcessFileLock(join(this.root, "definition-locks", `${safeId(id)}.lock`), action);
  }

  async clearSession(id: string, cleanup: (task: AutomationTask) => Promise<void>): Promise<AutomationTask[]> {
    const lock = await this.acquire(id, `context-clear-${crypto.randomUUID()}`);
    if (!lock) throw new Error("任务正在运行，请在本次运行结束后清理上下文");
    try {
      const task = await this.readTask(id);
      await cleanup(stripPrompt(task, this.now()));
      await this.setExecutionSession(id, undefined, task.revision);
      this.options.onChanged?.({ taskId: id, task: stripPrompt(task, this.now()) });
    } finally {
      await lock.release().catch(async (error) => {
        await this.log.log(`自动化任务绑定锁清理失败：${sanitizeError(error)}`).catch(() => undefined);
      });
    }
    return this.list();
  }

  getPolicy(): Promise<AutomationGlobalPolicy> { return this.policyStore.get(); }
  async updatePolicy(patch: Partial<AutomationGlobalPolicy>): Promise<AutomationGlobalPolicy> {
    return this.policyStore.mutate((current) => {
      const next = { ...current, ...patch, defaultProfile: { ...current.defaultProfile, ...patch.defaultProfile } };
      next.maxConcurrentRuns = Math.max(1, Math.min(8, Math.floor(next.maxConcurrentRuns)));
      next.confirmationTimeoutMinutes = Math.max(1, Math.min(120, Math.floor(next.confirmationTimeoutMinutes)));
      next.inactivityTimeoutMinutes = Math.max(0, Math.min(10_080, Math.floor(next.inactivityTimeoutMinutes ?? 0)));
      return next;
    });
  }

  async applyPolicyToAll(): Promise<AutomationTask[]> {
    const policy = await this.getPolicy();
    for (const task of await this.readStoredTasks()) if (task.destination !== "current-session") await this.update(task.id, { profile: { ...policy.defaultProfile }, frozenExecutionProfile: undefined, executionProfileId: undefined });
    return this.list();
  }

  async repairRegistrations(): Promise<AutomationTask[]> { for (const task of await this.readStoredTasks()) await this.definitionTransaction(task.id, async () => { const current = await this.readTask(task.id).catch(() => undefined); if (current) await this.register(current); }); return this.list(); }

  async unregisterAll(): Promise<void> {
    for (const task of await this.readStoredTasks()) await this.scheduler.unregister(task.id).catch((error) => this.log.log(`删除计划任务失败：${sanitizeError(error)}`));
  }

  async execute(taskId: string, runId: string | undefined, executor: (value: { task: AutomationTask; prompt: string; runId: string; signal: AbortSignal; confirm(toolCall: unknown, force?: boolean): Promise<boolean> }) => Promise<{ sessionId?: string }>, ready?: (task: AutomationTask) => boolean): Promise<AutomationRunRecord> {
    let task = await this.readTask(taskId); const id = runId && runId !== "scheduled" ? runId : crypto.randomUUID();
    let run: AutomationRunRecord = await readJson<AutomationRunRecord>(this.runPath(id)).catch(() => ({ id, taskId, status: "queued", scheduledAt: this.now().toISOString() }));
    if (run.taskId !== taskId) throw new Error("运行不属于指定任务");
    if (["completed", "failed", "cancelled", "skipped"].includes(run.status)) return run;
    if (!task.enabled) { run = { ...run, status: "skipped", finishedAt: this.now().toISOString(), error: "任务已暂停" }; await this.writeRun(run); return run; }
    if (runId === "scheduled" && !await this.admitCalendarOccurrence(taskId)) {
      return { ...run, status: "skipped", finishedAt: this.now().toISOString(), error: "本次唤醒不对应新的日历执行时间" };
    }
    const lock = await this.acquire(taskId, id);
    if (!lock) {
      const active = await readJson<AutomationRunRecord>(this.runPath(id)).catch(() => undefined);
      if (active && ["running", "awaiting-confirmation"].includes(active.status)) return active;
      run = { ...run, status: "skipped", finishedAt: this.now().toISOString(), error: "同一任务已有运行实例，本次触发已合并" }; await this.writeRun(run); return run; }
    if (["running", "awaiting-confirmation"].includes(run.status)) {
      try { run = { ...run, status: "failed", error: "上次运行已中断，不会自动重放同一个运行 ID", finishedAt: this.now().toISOString() }; await this.writeRun(run); return run; }
      finally { await lock.release(); }
    }
    let slot: AutomationLease | undefined;
    let prompt: string | undefined;
    const controller = new AbortController();
    this.activeRunControllers.set(id, controller);
    const cancellationPoll = setInterval(() => {
      void readJson<AutomationRunRecord>(this.runPath(id)).then((current) => {
        if (current.status === "cancelled" && !controller.signal.aborted) controller.abort(new Error(current.error || "任务已取消"));
      }).catch(() => undefined);
    }, Math.max(50, this.options.cancellationPollMs ?? 1_000));
    cancellationPoll.unref?.();
    try {
      await this.writeRun(run);
      slot = await this.acquireGlobalSlot(id, controller.signal, ready ? async () => {
        task = await this.readTask(taskId);
        return !task.enabled || ready(task);
      } : undefined);
      const beforeStart = await readJson<AutomationRunRecord>(this.runPath(id)).catch(() => run);
      if (beforeStart.status === "cancelled" || controller.signal.aborted) return beforeStart;
      task = await this.readTask(taskId);
      if (!task.enabled) { run = { ...run, status: "skipped", finishedAt: this.now().toISOString(), error: "任务已暂停" }; await this.writeRun(run); return run; }
      run = { ...run, definitionRevision: task.revision, status: "running", startedAt: this.now().toISOString() }; await this.writeRun(run); this.options.onChanged?.({ taskId, run });
      prompt = this.cipher.decrypt(task.encryptedPrompt);
      const result = await executor({ task: stripPrompt(task), prompt, runId: id, signal: controller.signal, confirm: (toolCall, force) => this.confirmHighImpact(taskId, id, toolCall, force, controller.signal) });
      if (controller.signal.aborted) throw controller.signal.reason ?? new Error("任务已取消");
      if (result.sessionId) await this.setExecutionSession(taskId, result.sessionId, task.revision);
      const current = await readJson<AutomationRunRecord>(this.runPath(id)).catch(() => run);
      run = current.status === "cancelled"
        ? current
        : { ...run, status: "completed", sessionId: result.sessionId, finishedAt: this.now().toISOString() };
    } catch (error) {
      const current = await readJson<AutomationRunRecord>(this.runPath(id)).catch(() => undefined);
      run = controller.signal.aborted || current?.status === "cancelled"
        ? { ...(current ?? run), status: "cancelled", error: current?.error || "用户已停止任务", finishedAt: current?.finishedAt ?? this.now().toISOString() }
        : { ...run, status: "failed", error: sanitizeError(error, prompt ? [prompt] : []), finishedAt: this.now().toISOString() };
    } finally {
      await this.writeRun(run).catch(error => this.log.log(`运行状态持久化失败：${sanitizeError(error)}`));
      clearInterval(cancellationPoll);
      this.activeRunControllers.delete(id);
      if (slot) await slot.release().catch(async (error) => {
        await this.log.log(`自动化并发槽位清理失败：${sanitizeError(error)}`).catch(() => undefined);
      });
      await lock.release().catch(async (error) => {
        await this.log.log(`自动化任务锁清理失败：${sanitizeError(error)}`).catch(() => undefined);
      });
    }
    await this.writeRun(run); this.options.onChanged?.({ taskId, run });
    return run;
  }

  private async admitCalendarOccurrence(taskId: string): Promise<boolean> {
    return this.definitionTransaction(taskId, async () => {
      const task = await this.readTask(taskId);
      if (!task.enabled) return false;
      if (task.schedule.kind !== "daily" && task.schedule.kind !== "weekly") return true;
      const now = this.now();
      const due = latestCalendarOccurrence(task.schedule, now, task.timeZone!);
      const anchor = task.scheduleAnchor ?? task.createdAt;
      if (!due || +due < Date.parse(anchor)) return false;
      const path = join(this.root, "calendar-cursors", `${safeId(taskId)}.json`);
      const key = `${scheduleKey(task.schedule)}|${task.timeZone}|${anchor}`;
      const saved = await readJson<{ key: string; at: string }>(path).catch(() => undefined);
      if (saved?.key === key && Date.parse(saved.at) >= +due) return false;
      // Consume even a coalesced/late occurrence. The recurring OS trigger,
      // independent of this worker, continues to supply future occurrences.
      await atomicJson(path, { key, at: due.toISOString() });
      return task.missedRunPolicy !== "skip" || +now - +due < 5 * 60_000;
    });
  }

  private async recoverAbandonedRuns(): Promise<void> {
    for (const run of await this.readRuns()) {
      if (!["running", "awaiting-confirmation"].includes(run.status)) continue;
      const modified = await stat(this.runPath(run.id)).catch(() => undefined);
      if (!modified || Date.now() - modified.mtimeMs < 5000) continue;
      await withCrossProcessFileLock(join(this.root, "lease-allocation.lock"), async () => {
        const lease = await readJson<AutomationLeaseRecord>(this.lockPath(run.taskId)).catch(() => undefined);
        if (lease?.runId === run.id && isProcessAlive(lease.pid)) return;
        run.status = "failed"; run.error = "执行进程已退出，本次运行不会自动重放；可检查结果后重新运行"; run.finishedAt = this.now().toISOString();
        await this.writeRun(run); await this.rejectPendingForRun(run.id);
      });
    }
  }

  async pending(): Promise<AutomationPendingConfirmation[]> {
    await this.recoverAbandonedRuns();
    await mkdir(this.pendingRoot, { recursive: true });
    const values = await Promise.all((await readdir(this.pendingRoot).catch(() => [])).filter((name) => name.endsWith(".json")).map((name) => readJson<PendingFile>(join(this.pendingRoot, name)).catch(() => undefined)));
    return values.filter((value): value is PendingFile => Boolean(value && value.decision === undefined && new Date(value.public.expiresAt).getTime() > this.now().getTime())).map((value) => ({ ...value.public, summary: this.cipher.decrypt(value.encryptedSummary) }));
  }

  async respondPending(id: string, approved: boolean): Promise<void> {
    const path = join(this.pendingRoot, `${safeId(id)}.json`);
    await withCrossProcessFileLock(`${path}.lock`, async () => {
      const value = await readJson<PendingFile>(path);
      const run = await readJson<AutomationRunRecord>(this.runPath(value.public.runId)).catch(() => undefined);
      if (value.decision !== undefined || Date.parse(value.public.expiresAt) <= this.now().getTime() || run?.status !== "awaiting-confirmation") throw new Error("确认已失效或任务已停止");
      value.decision = approved; await atomicJson(path, value);
    });
  }

  private async confirmHighImpact(taskId: string, runId: string, toolCall: unknown, force = false, signal?: AbortSignal): Promise<boolean> {
    const risk = classifyScheduledRisk(toolCall); if (!risk && !force) return true;
    const policy = await this.getPolicy(); const id = crypto.randomUUID(); const expiresAt = new Date(this.now().getTime() + policy.confirmationTimeoutMinutes * 60_000).toISOString();
    const pending: PendingFile = { public: { id, taskId, runId, category: risk?.category ?? "tool-permission", summary: force && !risk ? "任务需要工具权限确认" : "高影响操作等待确认", expiresAt }, encryptedSummary: this.cipher.encrypt(risk?.summary ?? JSON.stringify(toolCall ?? {}).slice(0, 500)) };
    await mkdir(this.pendingRoot, { recursive: true }); await atomicJson(join(this.pendingRoot, `${id}.json`), pending);
    const waitingRun = await readJson<AutomationRunRecord>(this.runPath(runId)).catch(() => undefined);
    if (waitingRun && !["completed", "failed", "cancelled", "skipped"].includes(waitingRun.status)) { waitingRun.status = "awaiting-confirmation"; await this.writeRun(waitingRun); this.options.onChanged?.({ taskId, run: waitingRun, pending: { ...pending.public } }); }
    else this.options.onChanged?.({ taskId, pending: { ...pending.public } });
    let decision: boolean | undefined;
    while (!signal?.aborted && this.now().getTime() < new Date(expiresAt).getTime()) { const current = await readJson<PendingFile>(join(this.pendingRoot, `${id}.json`)); if (current.decision !== undefined) { decision = current.decision; break; } await delay(this.options.pendingPollMs ?? 1_000); }
    const latestRun = waitingRun ? await readJson<AutomationRunRecord>(this.runPath(runId)) : undefined;
    if (latestRun?.status === "awaiting-confirmation" && !signal?.aborted) { latestRun.status = "running"; await this.writeRun(latestRun); this.options.onChanged?.({ taskId, run: latestRun }); }
    await rm(join(this.pendingRoot, `${id}.json`), { force: true }); return decision === true && !signal?.aborted && latestRun?.status === "running";
  }

  private async register(task: StoredAutomationTask): Promise<void> {
    if (!this.scheduler.supported()) { task.registrationStatus = "unsupported"; await this.writeTask(task); return; }
    try {
      if (task.enabled) await this.scheduler.register(stripPrompt(task), this.options.executable, this.options.workerBaseArgs ?? []); else await this.scheduler.unregister(task.id);
      task.registrationStatus = "registered"; task.registrationError = undefined; task.registrationDiagnostic = undefined;
    } catch (error) {
      task.registrationStatus = "error";
      task.registrationDiagnostic = registrationDiagnostic(error, task.enabled ? "register" : "unregister");
      task.registrationError = task.registrationDiagnostic.message;
    }
    await this.writeTask(task);
  }

  private async acquireGlobalSlot(runId: string, signal?: AbortSignal, ready?: () => boolean | Promise<boolean>): Promise<AutomationLease> {
    const policy = await this.getPolicy(); await mkdir(this.slotsRoot, { recursive: true });
    let started = Date.now();
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new Error("任务已取消");
      if (ready && !await ready()) { started = Date.now(); await delay(this.options.globalSlotPollMs ?? 1_000); continue; }
      const available = await withCrossProcessFileLock(join(this.root, "lease-allocation.lock"), async () => {
        await this.cleanupStaleSlots();
        for (let index = 0; index < policy.maxConcurrentRuns; index++) {
          try { return await this.createLease(join(this.slotsRoot, `${index}.slot`), runId); }
          catch (error: any) { if (error?.code !== "EEXIST") throw error; }
        }
        return undefined;
      });
      if (available) {
        try { if (!ready || await ready()) return available; }
        catch (error) { await available.release(); throw error; }
        await available.release();
        continue;
      }
      if (Date.now() - started > (this.options.globalSlotTimeoutMs ?? 10 * 60_000)) throw new Error("等待全局自动化并发槽位超时");
      await delay(this.options.globalSlotPollMs ?? 1_000);
    }
  }

  private async acquire(taskId: string, runId: string) {
    await mkdir(this.locksRoot, { recursive: true });
    return withCrossProcessFileLock(join(this.root, "lease-allocation.lock"), async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return await this.createLease(this.lockPath(taskId), runId); }
      catch (error: any) {
        if (error?.code !== "EEXIST") throw error;
        if (attempt === 0 && await this.isStaleLock(this.lockPath(taskId))) { await rm(this.lockPath(taskId), { force: true }); continue; }
        return undefined;
      }
    }
    return undefined;
    });
  }
  private async cleanupStaleSlots(): Promise<void> {
    for (const name of (await readdir(this.slotsRoot).catch(() => [])).filter((value) => value.endsWith(".slot"))) {
      const path = join(this.slotsRoot, name); if (await this.isStaleLock(path)) await rm(path, { force: true });
    }
  }
  private async rejectPendingForRun(runId: string): Promise<void> {
    await mkdir(this.pendingRoot, { recursive: true });
    for (const name of (await readdir(this.pendingRoot).catch(() => [])).filter((value) => value.endsWith(".json"))) {
      const path = join(this.pendingRoot, name);
      const pending = await readJson<PendingFile>(path).catch(() => undefined);
      if (!pending || pending.public.runId !== runId || pending.decision !== undefined) continue;
      pending.decision = false;
      await atomicJson(path, pending);
    }
  }
  private async isStaleLock(path: string): Promise<boolean> {
    const raw = (await readFile(path, "utf8").catch(() => "")).trim();
    let lease: AutomationLeaseRecord | undefined;
    try {
      const parsed = JSON.parse(raw) as AutomationLeaseRecord;
      if (parsed.version === 1 && parsed.leaseId && parsed.runId) lease = parsed;
    } catch { /* v0.6 lock files contained only the run id */ }
    const runId = lease?.runId ?? raw;
    const run = runId ? await readJson<AutomationRunRecord>(this.runPath(runId)).catch(() => undefined) : undefined;
    // A live owner may still be unwinding a cancelled turn. Never reassign its resource.
    if (lease?.pid) return !isProcessAlive(lease.pid);
    if (run && ["completed", "failed", "cancelled", "skipped"].includes(run.status)) return true;
    const modified = await stat(path).catch(() => undefined);
    if (!modified) return true;
    if (this.now().getTime() - modified.mtimeMs > Math.max(50, this.options.leaseStaleMs ?? 5 * 60_000)) return true;
    return Boolean(lease?.pid && !isProcessAlive(lease.pid));
  }

  private async createLease(path: string, runId: string): Promise<AutomationLease> {
    const handle = await open(path, "wx");
    const record: AutomationLeaseRecord = {
      version: 1,
      leaseId: crypto.randomUUID(),
      runId,
      pid: process.pid,
      processStartedAt: PROCESS_STARTED_AT,
      heartbeatAt: this.now().toISOString(),
    };
    try {
      await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(path, { force: true }).catch(() => undefined);
      throw error;
    }
    const lease: AutomationLease = {
      path,
      record,
      handle,
      release: async () => {
        if (lease.heartbeat) clearInterval(lease.heartbeat);
        await handle.close().catch(() => undefined);
        await withCrossProcessFileLock(join(this.root, "lease-allocation.lock"), async () => {
          const current = await readFile(path, "utf8").catch(() => "");
          if (current.includes(record.leaseId)) await rm(path, { force: true });
        });
      },
    };
    const heartbeatMs = Math.max(10, this.options.leaseHeartbeatMs ?? 30_000);
    lease.heartbeat = setInterval(() => {
      record.heartbeatAt = this.now().toISOString();
      const now = this.now();
      void utimes(path, now, now).catch((error) => this.log.log(`自动化租约心跳失败：${sanitizeError(error)}`));
    }, heartbeatMs);
    lease.heartbeat.unref?.();
    return lease;
  }
  private async readStoredTasks(): Promise<StoredAutomationTask[]> { const publicTasks = await this.list(); return Promise.all(publicTasks.map((task) => this.readTask(task.id))); }
  private readTask(id: string): Promise<StoredAutomationTask> { return this.readTaskFile(this.taskPath(id)); }
  private async readTaskFile(path: string): Promise<StoredAutomationTask> {
    const value = await readJson<StoredAutomationTask>(path);
    if (value.deletedAt) throw new Error("任务已删除");
    if (!value.id || !value.encryptedPrompt) throw new Error("自动化任务文件损坏");
    value.revision ??= 1; value.missedRunPolicy ??= "run-once"; value.contextPolicy ??= "reuse";
    value.timeZone ??= Intl.DateTimeFormat().resolvedOptions().timeZone; value.scheduleAnchor ??= value.createdAt;
    const runtime = await readJson<{ sessionId?: string; sessionRevision?: number; sessionMigrationComplete: boolean }>(join(this.root, "runtime", `${safeId(value.id)}.json`)).catch(() => undefined);
    if (runtime) { value.sessionId = runtime.sessionId; value.sessionRevision = runtime.sessionRevision; value.sessionMigrationComplete = true; }
    else if (!value.sessionId && !value.sessionMigrationComplete) value.sessionId = (await this.readRuns()).find(run => run.taskId === value.id && run.sessionId)?.sessionId;
    return value;
  }

  private async readRuns(): Promise<AutomationRunRecord[]> {
    await mkdir(this.runsRoot, { recursive: true });
    const values = await Promise.all((await readdir(this.runsRoot).catch(() => [])).filter((name) => name.endsWith(".json")).map((name) => readJson<AutomationRunRecord>(join(this.runsRoot, name)).catch(() => undefined)));
    return values.filter((value): value is AutomationRunRecord => Boolean(value)).sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
  }
  private async writeTask(task: StoredAutomationTask): Promise<void> {
    const { sessionId, sessionRevision, ...definition } = task;
    const runtimePath = join(this.root, "runtime", `${safeId(task.id)}.json`);
    if (sessionId && !await stat(runtimePath).catch(() => undefined)) await atomicJson(runtimePath, { sessionId, sessionRevision: sessionRevision ?? task.revision, sessionMigrationComplete: true });
    await atomicJson(this.taskPath(task.id), definition);
  }
  private async writeRun(run: AutomationRunRecord): Promise<void> {
    await withCrossProcessFileLock(join(this.root, "run-transactions", `${safeId(run.id)}.lock`), async () => {
      const current = await readJson<AutomationRunRecord>(this.runPath(run.id)).catch(() => undefined);
      if (current && ["completed", "failed", "cancelled", "skipped"].includes(current.status)) { Object.assign(run, current); return; }
      await atomicJson(this.runPath(run.id), run);
    });
  }
  private taskPath(id: string): string { return join(this.tasksRoot, `${safeId(id)}.json`); }
  private runPath(id: string): string { return join(this.runsRoot, `${safeId(id)}.json`); }
  private lockPath(id: string): string { return join(this.locksRoot, `${safeId(id)}.lock`); }
}

export class SafeStorageCipher implements AutomationCipher {
  encrypt(value: string): string { if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows DPAPI 当前不可用"); return safeStorage.encryptString(value).toString("base64"); }
  decrypt(value: string): string {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows DPAPI 当前不可用");
    try { return safeStorage.decryptString(Buffer.from(value, "base64")); }
    catch { throw new Error("任务指令解密失败，请编辑任务并重新输入任务指令后保存"); }
  }
}

export class WindowsTaskScheduler implements TaskSchedulerAdapter {
  constructor(
    private readonly command: typeof runSchtasks = runSchtasks,
    private readonly removeTemporaryFile: (path: string) => Promise<void> = async (path) => { await rm(path, { force: true }); },
  ) {}
  supported(): boolean { return process.platform === "win32"; }
  async register(task: AutomationTask, executable: string, baseArgs: string[]): Promise<void> {
    const xml = buildTaskXml(task, executable, [...baseArgs, "--scheduler-worker", task.id, "scheduled"]);
    const temp = join(process.env.TEMP || process.cwd(), `grok-desktop-task-${task.id}.xml`); await writeFile(temp, `\ufeff${xml}`, "utf16le");
    let primaryFailure: unknown;
    try { await this.command(["/Create", "/TN", taskName(task.id), "/XML", temp, "/F"], "register"); }
    catch (error) { primaryFailure = error; throw error; }
    finally {
      try { await this.removeTemporaryFile(temp); }
      catch (cleanupError) { if (!primaryFailure) throw cleanupError; }
    }
  }
  async unregister(taskId: string): Promise<void> { await this.command(["/Delete", "/TN", taskName(taskId), "/F"], "unregister").catch((error) => { if (!isMissingScheduledTaskError(error)) throw error; }); }
}

export function buildTaskXml(task: AutomationTask, executable: string, args: string[]): string {
  const trigger = task.schedule.kind === "daily" || task.schedule.kind === "weekly"
    ? calendarWakeups(task.schedule, new Date(), task.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone).map(wake => {
      const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const date = (task.scheduleAnchor ?? task.createdAt).slice(0, 10);
      return `<CalendarTrigger><StartBoundary>${date}T${wake.time}:00Z</StartBoundary><Enabled>true</Enabled><ScheduleByWeek><WeeksInterval>1</WeeksInterval><DaysOfWeek>${wake.days.map(day => `<${names[day]}/>`).join("")}</DaysOfWeek></ScheduleByWeek></CalendarTrigger>`;
    }).join("") : scheduleXml(task.schedule, task.scheduleAnchor);
  return `<?xml version="1.0" encoding="UTF-16"?>\n<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><RegistrationInfo><Description>${xml(task.name)}</Description></RegistrationInfo><Triggers>${trigger}</Triggers><Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>${task.missedRunPolicy === "skip" ? "false" : "true"}</StartWhenAvailable><WakeToRun>${task.wakeToRun}</WakeToRun><ExecutionTimeLimit>PT0S</ExecutionTimeLimit></Settings><Actions Context="Author"><Exec><Command>${xml(executable)}</Command><Arguments>${xml(args.map(quoteArg).join(" "))}</Arguments><WorkingDirectory>${xml(task.workspace)}</WorkingDirectory></Exec></Actions></Task>`;
}

function scheduleXml(schedule: AutomationTask["schedule"], anchor?: string): string {
  if (schedule.kind === "once") return `<TimeTrigger><StartBoundary>${xml(new Date(schedule.at).toISOString())}</StartBoundary><Enabled>true</Enabled></TimeTrigger>`;
  const start = nextBoundary(schedule.kind === "daily" || schedule.kind === "weekly" ? schedule.time : "00:00");
  if (schedule.kind === "daily") return `<CalendarTrigger><StartBoundary>${start}</StartBoundary><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay><Enabled>true</Enabled></CalendarTrigger>`;
  if (schedule.kind === "weekly") { const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]; return `<CalendarTrigger><StartBoundary>${start}</StartBoundary><ScheduleByWeek><WeeksInterval>1</WeeksInterval><DaysOfWeek>${schedule.days.map((day) => `<${names[day]}/>`).join("")}</DaysOfWeek></ScheduleByWeek><Enabled>true</Enabled></CalendarTrigger>`; }
  return `<TimeTrigger><StartBoundary>${(anchor ?? new Date().toISOString())}</StartBoundary><Repetition><Interval>PT${Math.max(1, Math.floor(schedule.minutes))}M</Interval><Duration>P3650D</Duration><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><Enabled>true</Enabled></TimeTrigger>`;
}

function scheduleKey(schedule: AutomationTask["schedule"]): string {
  if (schedule.kind === "weekly") return `weekly|${schedule.time}|${[...new Set(schedule.days)].sort().join(",")}`;
  if (schedule.kind === "daily") return `daily|${schedule.time}`;
  if (schedule.kind === "interval") return `interval|${schedule.minutes}`;
  return `once|${new Date(schedule.at).toISOString()}`;
}

function nextBoundary(time: string): string { const match = /^(\d{2}):(\d{2})$/.exec(time); const date = new Date(); date.setHours(Number(match?.[1] ?? 0), Number(match?.[2] ?? 0), 0, 0); if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1); return localIso(date); }
function localIso(date: Date): string { const p = (value: number) => String(value).padStart(2, "0"); return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:00`; }
function taskName(id: string): string { return `Grok Build Desktop - ${safeId(id)}`; }
class SchedulerCommandError extends Error {
  constructor(message: string, readonly operation: "register" | "unregister", readonly exitCode?: number) { super(message); }
}

function runSchtasks(args: string[], operation: "register" | "unregister"): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("schtasks.exe", args, { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = []; const stderr: Buffer[] = []; let size = 0; let timedOut = false;
    const collect = (target: Buffer[]) => (chunk: Buffer) => { if (size < 1024 * 1024) { target.push(Buffer.from(chunk)); size += chunk.length; } };
    child.stdout.on("data", collect(stdout)); child.stderr.on("data", collect(stderr));
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 30_000);
    child.once("error", (error) => { clearTimeout(timer); reject(new SchedulerCommandError(error.message, operation)); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) { resolve(); return; }
      const output = Buffer.concat(stderr.length ? stderr : stdout);
      const message = timedOut ? "Windows 任务计划程序响应超时" : decodeWindowsCommandOutput(output).trim() || `Windows 任务计划程序失败（${code ?? -1}）`;
      reject(new SchedulerCommandError(message, operation, code ?? undefined));
    });
  });
}

/** Decode Windows command output without assuming Node's UTF-8 default. */
export function decodeWindowsCommandOutput(value: Buffer): string {
  if (!value.length) return "";
  if (value.length >= 2 && value[0] === 0xff && value[1] === 0xfe) return iconv.decode(value.subarray(2), "utf16-le");
  if (value.length >= 2 && value[0] === 0xfe && value[1] === 0xff) return iconv.decode(value.subarray(2), "utf16-be");
  const evenNulls = countNulls(value, 0); const oddNulls = countNulls(value, 1);
  if (oddNulls > Math.max(1, value.length / 8) && oddNulls > evenNulls * 2) return iconv.decode(value, "utf16-le");
  if (evenNulls > Math.max(1, value.length / 8) && evenNulls > oddNulls * 2) return iconv.decode(value, "utf16-be");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(value); }
  catch { return iconv.decode(value, "gb18030"); }
}

function countNulls(value: Buffer, parity: 0 | 1): number { let count = 0; for (let index = parity; index < value.length; index += 2) if (value[index] === 0) count++; return count; }

export function normalizeRegistrationError(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.includes("\ufffd") ? "历史任务注册错误文本编码损坏，请重新健康检查" : value;
}

function registrationDiagnostic(error: unknown, operation: "register" | "unregister"): AutomationRegistrationDiagnostic {
  const message = normalizeRegistrationError(sanitizeError(error)) ?? "Windows 任务计划程序操作失败";
  return { operation: error instanceof SchedulerCommandError ? error.operation : operation, exitCode: error instanceof SchedulerCommandError ? error.exitCode : undefined, code: message.includes("历史任务注册错误文本编码损坏") ? "historical-encoding-damaged" : "scheduler-command-failed", message, repairable: true };
}
function isMissingScheduledTaskError(error: unknown): boolean {
  // schtasks.exe unfortunately returns the same process exit code for several
  // failures. Cover the localized messages observed in supported Windows
  // environments while preserving access-denied and policy errors.
  return /cannot find|not found|找不到|未找到|指定されたファイルが見つかりません|das system kann die angegebene datei nicht finden|le fichier spécifié est introuvable|el sistema no puede encontrar el archivo especificado/i.test(String(error));
}
function quoteArg(value: string): string { return `"${value.replace(/"/g, '\\"')}"`; }
function xml(value: unknown): string { return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!); }
function safeId(value: string): string { if (!/^[A-Za-z0-9-]+$/.test(value)) throw new Error("无效任务标识"); return value; }
function stripPrompt(value: StoredAutomationTask, now = new Date()): AutomationTask {
  const { encryptedPrompt: _encryptedPrompt, sessionMigrationComplete: _migration, ...task } = value;
  const registrationError = normalizeRegistrationError(task.registrationError);
  const registrationDiagnostic = registrationError && registrationError !== task.registrationError
    ? { operation: "register" as const, code: "historical-encoding-damaged" as const, message: registrationError, repairable: true }
    : task.registrationDiagnostic;
  return { ...task, registrationError, registrationDiagnostic, nextRunAt: task.enabled ? nextScheduledRun(task.schedule, now, task.scheduleAnchor ?? task.createdAt, task.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)?.toISOString() : undefined };
}
function validateTaskInput(value: AutomationTaskInput, requirePrompt: boolean): void { if (value.timeZone) new Intl.DateTimeFormat("en", { timeZone: value.timeZone }); if (value.scheduleAnchor && !Number.isFinite(Date.parse(value.scheduleAnchor))) throw new Error("调度起点无效"); if (value.destination === "current-session" && !value.targetSessionId) throw new Error("当前会话任务缺少目标会话"); if (!value.name.trim()) throw new Error("任务名称不能为空"); if (!value.workspace.trim()) throw new Error("任务工作区不能为空"); if (requirePrompt && !value.prompt?.trim()) throw new Error("任务提示词不能为空"); if (!(value.contextPolicy === "reuse" || value.contextPolicy === "fresh")) throw new Error("任务上下文策略无效"); if (!(["run-once", "skip"] as const).includes(value.missedRunPolicy)) throw new Error("错过运行策略无效"); if (value.skillCommand && !/^\/[A-Za-z0-9._-]+$/.test(value.skillCommand.trim())) throw new Error("Skill 命令必须以 / 开头且不包含参数"); if (value.schedule.kind === "interval" && (!Number.isInteger(value.schedule.minutes) || value.schedule.minutes < 1)) throw new Error("固定间隔不得小于一分钟"); if (value.schedule.kind === "daily" || value.schedule.kind === "weekly") { if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.schedule.time)) throw new Error("任务执行时间格式无效"); } if (value.schedule.kind === "weekly" && (!value.schedule.days.length || value.schedule.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6))) throw new Error("每周任务至少选择一个有效星期"); if (value.schedule.kind === "once" && !Number.isFinite(new Date(value.schedule.at).getTime())) throw new Error("单次任务时间无效"); }
function sanitizeError(value: unknown, sensitive: string[] = []): string { let text = value instanceof Error ? value.message : String(value); for (const item of sensitive.filter(Boolean)) text = text.split(item).join("[REDACTED]"); return text.replace(/(?:sk|xai|ghp|github_pat)_[A-Za-z0-9_-]{8,}/gi, "[REDACTED]").slice(0, 1000); }
async function readJson<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, "utf8")) as T; }
async function atomicJson(path: string, value: unknown): Promise<void> { await mkdir(dirname(path), { recursive: true }); const temp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`; try { await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8"); await renameSafe(temp, path); } catch (error) { await rm(temp, { force: true }).catch(() => undefined); throw error; } }
async function renameSafe(from: string, to: string): Promise<void> { const { rename } = await import("node:fs/promises"); try { await rename(from, to); } catch (error: any) { if (!["EEXIST", "EPERM"].includes(error?.code)) throw error; await rm(to, { force: true }); await rename(from, to); } }
function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

export function calculateNextRun(schedule: AutomationTask["schedule"], now = new Date()): Date | undefined {
  if (schedule.kind === "once") { const value = new Date(schedule.at); return Number.isFinite(value.getTime()) && value.getTime() >= now.getTime() ? value : undefined; }
  if (schedule.kind === "interval") return new Date(now.getTime() + Math.max(1, Math.floor(schedule.minutes)) * 60_000);
  const [hours, minutes] = schedule.time.split(":").map(Number);
  if (schedule.kind === "daily") {
    const value = new Date(now); value.setHours(hours!, minutes!, 0, 0); if (value.getTime() <= now.getTime()) value.setDate(value.getDate() + 1); return value;
  }
  const days = [...new Set(schedule.days)].sort((a, b) => a - b);
  for (let offset = 0; offset <= 7; offset++) {
    const value = new Date(now); value.setDate(now.getDate() + offset); value.setHours(hours!, minutes!, 0, 0);
    if (days.includes(value.getDay()) && value.getTime() > now.getTime()) return value;
  }
  return undefined;
}

export function classifyScheduledRisk(toolCall: unknown): { category: ComputerRiskCategory; summary: string } | undefined {
  const text = JSON.stringify(toolCall ?? {}).toLowerCase();
  const patterns: Array<[ComputerRiskCategory, RegExp]> = [
    ["financial", /(?:\b(?:pay|purchase|checkout|subscribe|billing|transfer)\b|付款|购买|订阅|转账)/],
    ["external-communication", /(?:\b(?:send|submit|publish|post|email|message)\b|发送|提交|发布)/],
    ["account-access", /(?:\b(?:api.?key|permission|share|credential)\b|账号|权限|密钥|共享)/],
    ["security-settings", /(?:\b(?:vpn|firewall|password|security|privacy)\b|防火墙|密码|安全|隐私)/],
    ["install", /(?:\b(?:install|download|execute|msi|setup)\b|安装|下载|执行)/],
    ["delete", /(?:\b(?:delete|remove|unlink|rmdir|drop)\b|删除|移除)/],
    ["sensitive-transfer", /(?:\b(?:secret|token|private.?key|sensitive)\b|敏感|令牌|私钥)/],
  ];
  const match = patterns.find(([, pattern]) => pattern.test(text)); return match ? { category: match[0], summary: text.slice(0, 500) } : undefined;
}
