import { safeStorage } from "electron";
import { execFile } from "node:child_process";
import { mkdir, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AutomationGlobalPolicy, AutomationPendingConfirmation, AutomationRunRecord, AutomationTask, AutomationTaskInput, ComputerRiskCategory } from "../../shared/types";
import { JsonStore } from "./json-store";
import type { LogService } from "./log-service";

interface StoredAutomationTask extends AutomationTask { encryptedPrompt: string; }
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
}

const DEFAULT_POLICY: AutomationGlobalPolicy = {
  defaultProfile: { modelId: "grok-4.5", effort: "", mode: "auto", permissionPolicy: "auto", computerEnabled: false },
  maxConcurrentRuns: 2,
  confirmationTimeoutMinutes: 30,
  notifyOnSuccess: true,
  notifyOnFailure: true,
};

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
    return values.filter((value): value is StoredAutomationTask => Boolean(value)).map((value) => stripPrompt(value, this.now())).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }

  async create(input: AutomationTaskInput): Promise<AutomationTask[]> {
    validateTaskInput(input, true);
    const id = crypto.randomUUID(); const now = this.now().toISOString();
    const task: StoredAutomationTask = { ...input, missedRunPolicy: input.missedRunPolicy ?? "run-once", id, promptPresent: true, encryptedPrompt: this.cipher.encrypt(input.prompt!.trim()), registrationStatus: this.scheduler.supported() ? "registered" : "unsupported", createdAt: now, updatedAt: now };
    delete (task as Partial<AutomationTaskInput>).prompt;
    await this.writeTask(task);
    await this.register(task);
    this.options.onChanged?.({ taskId: id, task: stripPrompt(task) });
    return this.list();
  }

  async update(id: string, patch: Partial<AutomationTaskInput>): Promise<AutomationTask[]> {
    const current = await this.readTask(id);
    const candidate = { ...current, ...patch, id, profile: { ...current.profile, ...patch.profile }, schedule: patch.schedule ?? current.schedule, updatedAt: this.now().toISOString() } as StoredAutomationTask;
    if (patch.prompt !== undefined) { if (!patch.prompt.trim()) throw new Error("任务提示词不能为空"); candidate.encryptedPrompt = this.cipher.encrypt(patch.prompt.trim()); candidate.promptPresent = true; }
    delete (candidate as Partial<AutomationTaskInput>).prompt;
    validateTaskInput({ ...candidate, prompt: this.cipher.decrypt(candidate.encryptedPrompt) }, true);
    await this.writeTask(candidate); await this.register(candidate);
    this.options.onChanged?.({ taskId: id, task: stripPrompt(candidate) });
    return this.list();
  }

  async delete(id: string): Promise<AutomationTask[]> {
    await this.scheduler.unregister(id).catch((error) => this.log.log(error));
    await rm(this.taskPath(id), { force: true });
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
    await mkdir(this.runsRoot, { recursive: true });
    const values = await Promise.all((await readdir(this.runsRoot).catch(() => [])).filter((name) => name.endsWith(".json")).map((name) => readJson<AutomationRunRecord>(join(this.runsRoot, name)).catch(() => undefined)));
    return values.filter((value): value is AutomationRunRecord => Boolean(value && (!taskId || value.taskId === taskId))).sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt)).slice(0, 500);
  }

  getPolicy(): Promise<AutomationGlobalPolicy> { return this.policyStore.get(); }
  async updatePolicy(patch: Partial<AutomationGlobalPolicy>): Promise<AutomationGlobalPolicy> {
    const current = await this.policyStore.get(); const next = { ...current, ...patch, defaultProfile: { ...current.defaultProfile, ...patch.defaultProfile } };
    next.maxConcurrentRuns = Math.max(1, Math.min(8, Math.floor(next.maxConcurrentRuns)));
    next.confirmationTimeoutMinutes = Math.max(1, Math.min(120, Math.floor(next.confirmationTimeoutMinutes)));
    return this.policyStore.set(next);
  }

  async applyPolicyToAll(): Promise<AutomationTask[]> {
    const policy = await this.getPolicy();
    for (const task of await this.readStoredTasks()) { task.profile = { ...policy.defaultProfile }; task.updatedAt = this.now().toISOString(); await this.writeTask(task); await this.register(task); }
    return this.list();
  }

  async repairRegistrations(): Promise<AutomationTask[]> { for (const task of await this.readStoredTasks()) await this.register(task); return this.list(); }

  async unregisterAll(): Promise<void> {
    for (const task of await this.readStoredTasks()) await this.scheduler.unregister(task.id).catch((error) => this.log.log(`删除计划任务失败：${sanitizeError(error)}`));
  }

  async execute(taskId: string, runId: string | undefined, executor: (value: { task: AutomationTask; prompt: string; runId: string; confirm(toolCall: unknown, force?: boolean): Promise<boolean> }) => Promise<{ sessionId?: string }>): Promise<AutomationRunRecord> {
    const task = await this.readTask(taskId); const id = runId && runId !== "scheduled" ? runId : crypto.randomUUID();
    let run: AutomationRunRecord = await readJson<AutomationRunRecord>(this.runPath(id)).catch(() => ({ id, taskId, status: "queued", scheduledAt: this.now().toISOString() }));
    if (!task.enabled) { run = { ...run, status: "skipped", finishedAt: this.now().toISOString(), error: "任务已暂停" }; await this.writeRun(run); return run; }
    const lock = await this.acquire(taskId, id);
    if (!lock) { run = { ...run, status: "skipped", finishedAt: this.now().toISOString(), error: "同一任务已有运行实例，本次触发已合并" }; await this.writeRun(run); return run; }
    let slot: { handle: Awaited<ReturnType<typeof open>>; path: string } | undefined;
    let prompt: string | undefined;
    try {
      slot = await this.acquireGlobalSlot(id);
      run = { ...run, status: "running", startedAt: this.now().toISOString() }; await this.writeRun(run); this.options.onChanged?.({ taskId, run });
      prompt = this.cipher.decrypt(task.encryptedPrompt);
      const result = await executor({ task: stripPrompt(task), prompt, runId: id, confirm: (toolCall, force) => this.confirmHighImpact(taskId, id, toolCall, force) });
      run = { ...run, status: "completed", sessionId: result.sessionId, finishedAt: this.now().toISOString() };
    } catch (error) {
      run = { ...run, status: "failed", error: sanitizeError(error, prompt ? [prompt] : []), finishedAt: this.now().toISOString() };
    } finally {
      if (slot) { await slot.handle.close(); await rm(slot.path, { force: true }); }
      await lock.close(); await rm(this.lockPath(taskId), { force: true });
    }
    await this.writeRun(run); this.options.onChanged?.({ taskId, run });
    return run;
  }

  async pending(): Promise<AutomationPendingConfirmation[]> {
    await mkdir(this.pendingRoot, { recursive: true });
    const values = await Promise.all((await readdir(this.pendingRoot).catch(() => [])).filter((name) => name.endsWith(".json")).map((name) => readJson<PendingFile>(join(this.pendingRoot, name)).catch(() => undefined)));
    return values.filter((value): value is PendingFile => Boolean(value && value.decision === undefined && new Date(value.public.expiresAt).getTime() > this.now().getTime())).map((value) => ({ ...value.public, summary: this.cipher.decrypt(value.encryptedSummary) }));
  }

  async respondPending(id: string, approved: boolean): Promise<void> {
    const path = join(this.pendingRoot, `${safeId(id)}.json`); const value = await readJson<PendingFile>(path); value.decision = approved; await atomicJson(path, value);
  }

  private async confirmHighImpact(taskId: string, runId: string, toolCall: unknown, force = false): Promise<boolean> {
    const risk = classifyScheduledRisk(toolCall); if (!risk && !force) return true;
    const policy = await this.getPolicy(); const id = crypto.randomUUID(); const expiresAt = new Date(this.now().getTime() + policy.confirmationTimeoutMinutes * 60_000).toISOString();
    const pending: PendingFile = { public: { id, taskId, runId, category: risk?.category ?? "tool-permission", summary: force && !risk ? "任务需要工具权限确认" : "高影响操作等待确认", expiresAt }, encryptedSummary: this.cipher.encrypt(risk?.summary ?? JSON.stringify(toolCall ?? {}).slice(0, 500)) };
    await mkdir(this.pendingRoot, { recursive: true }); await atomicJson(join(this.pendingRoot, `${id}.json`), pending);
    const waitingRun = await readJson<AutomationRunRecord>(this.runPath(runId)).catch(() => undefined);
    if (waitingRun) { waitingRun.status = "awaiting-confirmation"; await this.writeRun(waitingRun); this.options.onChanged?.({ taskId, run: waitingRun, pending: { ...pending.public } }); }
    else this.options.onChanged?.({ taskId, pending: { ...pending.public } });
    let decision: boolean | undefined;
    while (this.now().getTime() < new Date(expiresAt).getTime()) { const current = await readJson<PendingFile>(join(this.pendingRoot, `${id}.json`)); if (current.decision !== undefined) { decision = current.decision; break; } await delay(this.options.pendingPollMs ?? 1_000); }
    if (waitingRun && decision !== undefined) { waitingRun.status = "running"; await this.writeRun(waitingRun); this.options.onChanged?.({ taskId, run: waitingRun }); }
    await rm(join(this.pendingRoot, `${id}.json`), { force: true }); return decision === true;
  }

  private async register(task: StoredAutomationTask): Promise<void> {
    if (!this.scheduler.supported()) { task.registrationStatus = "unsupported"; await this.writeTask(task); return; }
    try {
      if (task.enabled) await this.scheduler.register(stripPrompt(task), this.options.executable, this.options.workerBaseArgs ?? []); else await this.scheduler.unregister(task.id);
      task.registrationStatus = "registered"; task.registrationError = undefined;
    } catch (error) { task.registrationStatus = "error"; task.registrationError = sanitizeError(error); }
    await this.writeTask(task);
  }

  private async acquireGlobalSlot(runId: string): Promise<{ handle: Awaited<ReturnType<typeof open>>; path: string }> {
    const policy = await this.getPolicy(); await mkdir(this.slotsRoot, { recursive: true });
    const started = Date.now();
    while (true) {
      await this.cleanupStaleSlots();
      for (let index = 0; index < policy.maxConcurrentRuns; index++) {
        const path = join(this.slotsRoot, `${index}.slot`);
        try {
          const handle = await open(path, "wx");
          await handle.writeFile(runId);
          return { handle, path };
        } catch (error: any) {
          if (error?.code !== "EEXIST") throw error;
        }
      }
      if (Date.now() - started > (this.options.globalSlotTimeoutMs ?? 10 * 60_000)) throw new Error("等待全局自动化并发槽位超时");
      await delay(this.options.globalSlotPollMs ?? 1_000);
    }
  }

  private async acquire(taskId: string, runId: string) {
    await mkdir(this.locksRoot, { recursive: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      try { const handle = await open(this.lockPath(taskId), "wx"); await handle.writeFile(runId); return handle; }
      catch (error: any) {
        if (error?.code !== "EEXIST") throw error;
        if (attempt === 0 && await this.isStaleLock(this.lockPath(taskId))) { await rm(this.lockPath(taskId), { force: true }); continue; }
        return undefined;
      }
    }
    return undefined;
  }
  private async cleanupStaleSlots(): Promise<void> {
    for (const name of (await readdir(this.slotsRoot).catch(() => [])).filter((value) => value.endsWith(".slot"))) {
      const path = join(this.slotsRoot, name); if (await this.isStaleLock(path)) await rm(path, { force: true });
    }
  }
  private async isStaleLock(path: string): Promise<boolean> {
    const runId = (await readFile(path, "utf8").catch(() => "")).trim();
    const run = runId ? await readJson<AutomationRunRecord>(this.runPath(runId)).catch(() => undefined) : undefined;
    if (run && ["completed", "failed", "cancelled", "skipped"].includes(run.status)) return true;
    const modified = await stat(path).catch(() => undefined);
    return !modified || this.now().getTime() - modified.mtimeMs > 24 * 60 * 60_000;
  }
  private async readStoredTasks(): Promise<StoredAutomationTask[]> { const publicTasks = await this.list(); return Promise.all(publicTasks.map((task) => this.readTask(task.id))); }
  private readTask(id: string): Promise<StoredAutomationTask> { return this.readTaskFile(this.taskPath(id)); }
  private async readTaskFile(path: string): Promise<StoredAutomationTask> { const value = await readJson<StoredAutomationTask>(path); if (!value.id || !value.encryptedPrompt) throw new Error("自动化任务文件损坏"); value.missedRunPolicy ??= "run-once"; return value; }
  private async writeTask(task: StoredAutomationTask): Promise<void> { await mkdir(this.tasksRoot, { recursive: true }); await atomicJson(this.taskPath(task.id), task); }
  private async writeRun(run: AutomationRunRecord): Promise<void> { await mkdir(this.runsRoot, { recursive: true }); await atomicJson(this.runPath(run.id), run); }
  private taskPath(id: string): string { return join(this.tasksRoot, `${safeId(id)}.json`); }
  private runPath(id: string): string { return join(this.runsRoot, `${safeId(id)}.json`); }
  private lockPath(id: string): string { return join(this.locksRoot, `${safeId(id)}.lock`); }
}

export class SafeStorageCipher implements AutomationCipher {
  encrypt(value: string): string { if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows DPAPI 当前不可用"); return safeStorage.encryptString(value).toString("base64"); }
  decrypt(value: string): string { if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows DPAPI 当前不可用"); return safeStorage.decryptString(Buffer.from(value, "base64")); }
}

export class WindowsTaskScheduler implements TaskSchedulerAdapter {
  supported(): boolean { return process.platform === "win32"; }
  async register(task: AutomationTask, executable: string, baseArgs: string[]): Promise<void> {
    const xml = buildTaskXml(task, executable, [...baseArgs, "--scheduler-worker", task.id, "scheduled"]);
    const temp = join(process.env.TEMP || process.cwd(), `grok-desktop-task-${task.id}.xml`); await writeFile(temp, `\ufeff${xml}`, "utf16le");
    try { await runSchtasks(["/Create", "/TN", taskName(task.id), "/XML", temp, "/F"]); } finally { await rm(temp, { force: true }); }
  }
  async unregister(taskId: string): Promise<void> { await runSchtasks(["/Delete", "/TN", taskName(taskId), "/F"]).catch((error) => { if (!/cannot find|找不到/i.test(String(error))) throw error; }); }
}

export function buildTaskXml(task: AutomationTask, executable: string, args: string[]): string {
  const trigger = scheduleXml(task.schedule);
  return `<?xml version="1.0" encoding="UTF-16"?>\n<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><RegistrationInfo><Description>${xml(task.name)}</Description></RegistrationInfo><Triggers>${trigger}</Triggers><Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>${task.missedRunPolicy === "skip" ? "false" : "true"}</StartWhenAvailable><WakeToRun>${task.wakeToRun}</WakeToRun><ExecutionTimeLimit>PT24H</ExecutionTimeLimit></Settings><Actions Context="Author"><Exec><Command>${xml(executable)}</Command><Arguments>${xml(args.map(quoteArg).join(" "))}</Arguments><WorkingDirectory>${xml(task.workspace)}</WorkingDirectory></Exec></Actions></Task>`;
}

function scheduleXml(schedule: AutomationTask["schedule"]): string {
  if (schedule.kind === "once") return `<TimeTrigger><StartBoundary>${xml(localIso(new Date(schedule.at)))}</StartBoundary><Enabled>true</Enabled></TimeTrigger>`;
  const start = nextBoundary(schedule.kind === "daily" || schedule.kind === "weekly" ? schedule.time : "00:00");
  if (schedule.kind === "daily") return `<CalendarTrigger><StartBoundary>${start}</StartBoundary><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay><Enabled>true</Enabled></CalendarTrigger>`;
  if (schedule.kind === "weekly") { const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]; return `<CalendarTrigger><StartBoundary>${start}</StartBoundary><ScheduleByWeek><WeeksInterval>1</WeeksInterval><DaysOfWeek>${schedule.days.map((day) => `<${names[day]}/>`).join("")}</DaysOfWeek></ScheduleByWeek><Enabled>true</Enabled></CalendarTrigger>`; }
  return `<TimeTrigger><StartBoundary>${localIso(new Date())}</StartBoundary><Repetition><Interval>PT${Math.max(1, Math.floor(schedule.minutes))}M</Interval><Duration>P3650D</Duration><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><Enabled>true</Enabled></TimeTrigger>`;
}

function nextBoundary(time: string): string { const match = /^(\d{2}):(\d{2})$/.exec(time); const date = new Date(); date.setHours(Number(match?.[1] ?? 0), Number(match?.[2] ?? 0), 0, 0); if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1); return localIso(date); }
function localIso(date: Date): string { const p = (value: number) => String(value).padStart(2, "0"); return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:00`; }
function taskName(id: string): string { return `Grok Build Desktop - ${safeId(id)}`; }
function runSchtasks(args: string[]): Promise<void> { return new Promise((resolve, reject) => execFile("schtasks.exe", args, { windowsHide: true, timeout: 30_000 }, (error, stdout, stderr) => error ? reject(new Error(String(stderr || stdout || error.message).trim())) : resolve())); }
function quoteArg(value: string): string { return `"${value.replace(/"/g, '\\"')}"`; }
function xml(value: unknown): string { return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!); }
function safeId(value: string): string { if (!/^[A-Za-z0-9-]+$/.test(value)) throw new Error("无效任务标识"); return value; }
function stripPrompt(value: StoredAutomationTask, now = new Date()): AutomationTask { const { encryptedPrompt: _encryptedPrompt, ...task } = value; return { ...task, nextRunAt: task.enabled ? calculateNextRun(task.schedule, now)?.toISOString() : undefined }; }
function validateTaskInput(value: AutomationTaskInput, requirePrompt: boolean): void { if (!value.name.trim()) throw new Error("任务名称不能为空"); if (!value.workspace.trim()) throw new Error("任务工作区不能为空"); if (requirePrompt && !value.prompt?.trim()) throw new Error("任务提示词不能为空"); if (!value.profile.modelId.trim()) throw new Error("任务模型不能为空"); if (!(["run-once", "skip"] as const).includes(value.missedRunPolicy)) throw new Error("错过运行策略无效"); if (value.skillCommand && !/^\/[A-Za-z0-9._-]+$/.test(value.skillCommand.trim())) throw new Error("Skill 命令必须以 / 开头且不包含参数"); if (value.schedule.kind === "interval" && (!Number.isInteger(value.schedule.minutes) || value.schedule.minutes < 1)) throw new Error("固定间隔不得小于一分钟"); if (value.schedule.kind === "daily" || value.schedule.kind === "weekly") { if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.schedule.time)) throw new Error("任务执行时间格式无效"); } if (value.schedule.kind === "weekly" && (!value.schedule.days.length || value.schedule.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6))) throw new Error("每周任务至少选择一个有效星期"); if (value.schedule.kind === "once" && !Number.isFinite(new Date(value.schedule.at).getTime())) throw new Error("单次任务时间无效"); }
function sanitizeError(value: unknown, sensitive: string[] = []): string { let text = value instanceof Error ? value.message : String(value); for (const item of sensitive.filter(Boolean)) text = text.split(item).join("[REDACTED]"); return text.replace(/(?:sk|xai|ghp|github_pat)_[A-Za-z0-9_-]{8,}/gi, "[REDACTED]").slice(0, 1000); }
async function readJson<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, "utf8")) as T; }
async function atomicJson(path: string, value: unknown): Promise<void> { await mkdir(dirname(path), { recursive: true }); const temp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`; try { await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8"); await renameSafe(temp, path); } catch (error) { await rm(temp, { force: true }); throw error; } }
async function renameSafe(from: string, to: string): Promise<void> { const { rename } = await import("node:fs/promises"); try { await rename(from, to); } catch (error: any) { if (!["EEXIST", "EPERM"].includes(error?.code)) throw error; await rm(to, { force: true }); await rename(from, to); } }
function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

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
