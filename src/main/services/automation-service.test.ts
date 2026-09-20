import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AutomationTask, AutomationTaskInput } from "../../shared/types";
import iconv from "iconv-lite";
import { AutomationService, buildTaskXml, calculateNextRun, classifyScheduledRisk, decodeWindowsCommandOutput, normalizeRegistrationError, WindowsTaskScheduler, type AutomationCipher, type TaskSchedulerAdapter } from "./automation-service";
import { LogService } from "./log-service";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
class FakeCipher implements AutomationCipher { encrypt(value: string) { return Buffer.from(value).toString("base64"); } decrypt(value: string) { return Buffer.from(value, "base64").toString(); } }
class FakeScheduler implements TaskSchedulerAdapter { registrations: AutomationTask[] = []; removed: string[] = []; supported() { return true; } async register(task: AutomationTask) { this.registrations.push(task); } async unregister(id: string) { this.removed.push(id); } }
function input(patch: Partial<AutomationTaskInput> = {}): AutomationTaskInput { return { name: "每日项目检查", workspace: "D:\\中文 工作区", prompt: "检查项目并汇报", schedule: { kind: "daily", time: "09:30" }, profile: { modelId: "grok-4.5", effort: "", mode: "auto", permissionPolicy: "auto", computerEnabled: false, accountId: "account-test" }, enabled: true, wakeToRun: false, notify: true, missedRunPolicy: "run-once", contextPolicy: "reuse", ...patch }; }
async function fixture(options: Partial<ConstructorParameters<typeof AutomationService>[2]> = {}) { const root = await mkdtemp(join(tmpdir(), "grok-automation-")); roots.push(root); const scheduler = new FakeScheduler(); const launched = vi.fn(async () => undefined); const service = new AutomationService(root, new LogService(join(root, "app.log")), { executable: "D:\\应用 目录\\Grok Build Desktop.exe", cipher: new FakeCipher(), scheduler, launchWorker: launched, ...options }); return { root, scheduler, launched, service }; }

describe("AutomationService", () => {
  it("decodes UTF-8, UTF-16 and CP936/GB18030 scheduler output", () => {
    const message = "错误: 系统找不到指定的文件。";
    expect(decodeWindowsCommandOutput(Buffer.from(message, "utf8"))).toBe(message);
    expect(decodeWindowsCommandOutput(Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode(message, "utf16-le")]))).toBe(message);
    expect(decodeWindowsCommandOutput(iconv.encode(message, "gb18030"))).toBe(message);
  });
  it("replaces irreversibly damaged historical scheduler output with a repair instruction", () => {
    expect(normalizeRegistrationError("����: ϵͳ�Ҳ���ָ�����ļ���")).toBe("历史任务注册错误文本编码损坏，请重新健康检查");
  });
  it("preserves the scheduler registration error when temporary XML cleanup also fails", async () => {
    const registration = new Error("Access is denied");
    const scheduler = new WindowsTaskScheduler(
      vi.fn(async () => { throw registration; }),
      vi.fn(async () => { throw new Error("temporary XML is locked"); }),
    );
    const task = { ...input(), id: "task-id", promptPresent: true, registrationStatus: "registered", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" } satisfies AutomationTask;
    await expect(scheduler.register(task, "D:\\Grok Build Desktop.exe", [])).rejects.toBe(registration);
  });
  it("treats a localized missing scheduled task as an idempotent unregister", async () => {
    const scheduler = new WindowsTaskScheduler(vi.fn(async () => { throw new Error("ERROR: The system cannot find the file specified."); }));
    await expect(scheduler.unregister("task-id")).resolves.toBeUndefined();
  });
  it("does not mistake scheduler access denial for a missing task", async () => {
    const denied = new Error("ERROR: Access is denied.");
    const scheduler = new WindowsTaskScheduler(vi.fn(async () => { throw denied; }));
    await expect(scheduler.unregister("task-id")).rejects.toBe(denied);
  });
  it("stores one encrypted task file and registers a least-privilege task", async () => { const { root, scheduler, service } = await fixture(); const tasks = await service.create(input()); expect(tasks).toHaveLength(1); expect(scheduler.registrations).toHaveLength(1); const raw = await readFile(join(root, "automations", "tasks", `${tasks[0]!.id}.json`), "utf8"); expect(raw).not.toContain("检查项目并汇报"); expect(raw).toContain("encryptedPrompt"); });
  it("launches a namespaced worker for Run now", async () => { const { service, launched } = await fixture(); const [task] = await service.create(input()); const run = await service.runNow(task!.id); expect(run.status).toBe("queued"); expect(launched).toHaveBeenCalledWith(task!.id, run.id); });
  it("executes once, records the resumable session and releases the lock", async () => { let now = new Date("2026-01-01T01:00:00Z"); const { service } = await fixture({ now: () => now }); const [task] = await service.create(input({ timeZone: "Asia/Shanghai" })); now = new Date("2026-01-01T01:30:00Z"); const run = await service.execute(task!.id, "scheduled", async ({ prompt }) => { expect(prompt).toBe("检查项目并汇报"); return { sessionId: "session-test" }; }); expect(run.status).toBe("completed"); expect(run.sessionId).toBe("session-test"); });
  it("migrates the latest run session, reuses the mapping and can clear it safely", async () => {
    const { service } = await fixture();
    const [created] = await service.create(input());
    await service.execute(created!.id, "first-run", async () => ({ sessionId: "stable-session" }));
    expect((await service.list())[0]?.sessionId).toBe("stable-session");
    let observed = "";
    await service.execute(created!.id, "second-run", async ({ task }) => { observed = task.sessionId || ""; return { sessionId: task.sessionId }; });
    expect(observed).toBe("stable-session");
    const cleanup = vi.fn(async () => undefined);
    expect((await service.clearSession(created!.id, cleanup))[0]?.sessionId).toBeUndefined();
    expect(cleanup).toHaveBeenCalledWith(expect.objectContaining({ id: created!.id, sessionId: "stable-session" }));
  });
  it("generates escaped XML for Chinese and spaced non-system paths without a wall-clock ceiling", () => { const task = { ...input(), id: "task-id", promptPresent: true, registrationStatus: "registered", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" } satisfies AutomationTask; const xml = buildTaskXml(task, "D:\\应用 & 工具\\Grok Build Desktop.exe", ["--scheduler-worker", task.id, "scheduled"]); expect(xml).toContain("InteractiveToken"); expect(xml).toContain("LeastPrivilege"); expect(xml).not.toContain("<UserId>"); expect(xml).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>"); expect(xml).toContain("<StartWhenAvailable>true</StartWhenAvailable>"); expect(xml).toContain("D:\\应用 &amp; 工具"); expect(xml).toContain("D:\\中文 工作区"); expect(buildTaskXml({ ...task, missedRunPolicy: "skip" }, "app.exe", [])).toContain("<StartWhenAvailable>false</StartWhenAvailable>"); });
  it("computes stable next-run previews for daily, weekly and interval schedules", () => { const now = new Date(2026, 6, 20, 10, 0, 0); expect(calculateNextRun({ kind: "daily", time: "09:30" }, now)?.getDate()).toBe(21); expect(calculateNextRun({ kind: "weekly", time: "11:00", days: [1, 3] }, now)?.getDay()).toBe(1); expect(calculateNextRun({ kind: "interval", minutes: 15 }, now)?.getTime()).toBe(now.getTime() + 900_000); });
  it("classifies high-impact scheduled tool calls while leaving ordinary reads automatic", () => { expect(classifyScheduledRisk({ command: "Remove-Item important.txt" })?.category).toBe("delete"); expect(classifyScheduledRisk({ command: "Get-Content README.md" })).toBeUndefined(); });
  it("validates interval, weekly day and clock boundaries", async () => { const { service } = await fixture(); await expect(service.create(input({ schedule: { kind: "interval", minutes: 0 } }))).rejects.toThrow("不得小于一分钟"); await expect(service.create(input({ schedule: { kind: "weekly", time: "09:00", days: [7] } }))).rejects.toThrow("有效星期"); await expect(service.create(input({ schedule: { kind: "daily", time: "25:00" } }))).rejects.toThrow("时间格式"); });
  it("coalesces concurrent instances of the same task", async () => { const { service } = await fixture(); const [task] = await service.create(input()); let release!: () => void; const barrier = new Promise<void>((resolve) => { release = resolve; }); const first = service.execute(task!.id, "run-one", async () => { await barrier; return {}; }); await vi.waitFor(async () => expect((await service.listRuns()).some((run) => run.id === "run-one" && run.status === "running")).toBe(true)); const second = await service.execute(task!.id, "run-two", async () => ({})); expect(second.status).toBe("skipped"); expect(second.error).toContain("已合并"); release(); expect((await first).status).toBe("completed"); });
  it("uses atomic global slots without counting queued task locks or exceeding the limit", async () => {
    const { service } = await fixture({ globalSlotPollMs: 5, globalSlotTimeoutMs: 2_000 });
    await service.updatePolicy({ maxConcurrentRuns: 2 });
    const tasks: AutomationTask[] = [];
    for (let index = 0; index < 5; index++) tasks.push((await service.create(input({ name: `并发任务 ${index}` })))[index]!);
    let active = 0; let peak = 0;
    let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
    const running = Promise.all(tasks.map((task, index) => service.execute(task.id, `parallel-${index}`, async () => {
      active += 1; peak = Math.max(peak, active);
      await barrier;
      active -= 1;
      return {};
    })));
    try { await vi.waitFor(() => expect(active).toBe(2), { timeout: 3000 }); } finally { release(); }
    const runs = await running;
    expect(runs.every((run) => run.status === "completed")).toBe(true);
    expect(peak).toBe(2);
  });
  it("serializes concurrent policy patches instead of losing one field", async () => {
    const { service } = await fixture();
    await Promise.all([
      service.updatePolicy({ maxConcurrentRuns: 4 }),
      service.updatePolicy({ confirmationTimeoutMinutes: 17 }),
    ]);
    expect(await service.getPolicy()).toEqual(expect.objectContaining({ maxConcurrentRuns: 4, confirmationTimeoutMinutes: 17 }));
  });
  it("inherits the Desktop model instead of persisting Grok 4.5 as the automation default", async () => {
    const { service } = await fixture();
    expect((await service.getPolicy()).defaultProfile.modelId).toBe("");
    const [task] = await service.create(input({ profile: { ...input().profile, modelId: "" } }));
    expect(task?.profile.modelId).toBe("");
  });
  it("reclaims a crashed legacy task lock after the short inactivity lease instead of waiting 24 hours", async () => {
    const { root, service } = await fixture({ leaseStaleMs: 50 });
    const [task] = await service.create(input());
    const lockRoot = join(root, "automations", "locks");
    const lockPath = join(lockRoot, `${task!.id}.lock`);
    await mkdir(lockRoot, { recursive: true });
    await writeFile(lockPath, "crashed-run", "utf8");
    const old = new Date(Date.now() - 1_000);
    await utimes(lockPath, old, old);
    const run = await service.execute(task!.id, "recovered-run", async () => ({}));
    expect(run.status).toBe("completed");
  });
  it("keeps a long active lease alive with heartbeats", async () => {
    const { service } = await fixture({ leaseHeartbeatMs: 10, leaseStaleMs: 60 });
    const [task] = await service.create(input());
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const first = service.execute(task!.id, "heartbeat-run", async () => { await barrier; return {}; });
    await new Promise((resolve) => setTimeout(resolve, 140));
    const second = await service.execute(task!.id, "overlap-run", async () => ({}));
    expect(second.status).toBe("skipped");
    release();
    expect((await first).status).toBe("completed");
  });
  it("cancels a running worker through the persisted run authority", async () => {
    const { service } = await fixture({ cancellationPollMs: 5 });
    const [task] = await service.create(input());
    const execution = service.execute(task!.id, "cancelled-run", async ({ signal }) => {
      await new Promise<void>((_resolve, reject) => {
        const rejectCancelled = () => reject(signal.reason ?? new Error("cancelled"));
        if (signal.aborted) rejectCancelled();
        else signal.addEventListener("abort", rejectCancelled, { once: true });
      });
      return {};
    });
    await vi.waitFor(async () => expect((await service.listRuns()).find((run) => run.id === "cancelled-run")?.status).toBe("running"));
    expect((await service.cancelRun("cancelled-run")).status).toBe("cancelled");
    const terminal = await execution;
    expect(terminal.status).toBe("cancelled");
    expect(terminal.error).toBe("用户已停止任务");
  });
  it("persists zero as disabled inactivity timeout without a total runtime ceiling", async () => {
    const { service } = await fixture();
    expect((await service.getPolicy()).inactivityTimeoutMinutes).toBe(0);
    expect((await service.updatePolicy({ inactivityTimeoutMinutes: 240 })).inactivityTimeoutMinutes).toBe(240);
    expect((await service.updatePolicy({ inactivityTimeoutMinutes: -5 })).inactivityTimeoutMinutes).toBe(0);
  });
  it("pauses for an encrypted high-impact confirmation and resumes only after approval", async () => { let service!: AutomationService; let rawPending = ""; const { root, service: created } = await fixture({ pendingPollMs: 5, onChanged: (event) => { if (!event.pending) return; void (async () => { rawPending = await readFile(join(root, "automations", "pending", `${event.pending!.id}.json`), "utf8"); await service.respondPending(event.pending!.id, true); })(); } }); service = created; const [task] = await service.create(input()); const run = await service.execute(task!.id, "confirm-run", async ({ confirm }) => { expect(await confirm({ command: "删除旧备份" })).toBe(true); return { sessionId: "confirmed-session" }; }); expect(run.status).toBe("completed"); expect(rawPending).not.toContain("删除旧备份"); expect(rawPending).toContain("encryptedSummary"); });
  it("redacts the encrypted prompt if a worker error echoes it", async () => { const { service } = await fixture(); const [task] = await service.create(input()); const run = await service.execute(task!.id, "failed-run", async ({ prompt }) => { throw new Error(`provider failed while running: ${prompt}`); }); expect(run.status).toBe("failed"); expect(run.error).not.toContain("检查项目并汇报"); expect(run.error).toContain("[REDACTED]"); });
  it("records a terminal failure when the encrypted prompt can no longer be decrypted", async () => {
    let failDecrypt = false;
    const cipher: AutomationCipher = {
      encrypt: (value) => Buffer.from(value).toString("base64"),
      decrypt: (value) => { if (failDecrypt) throw new Error("DPAPI decrypt failed"); return Buffer.from(value, "base64").toString(); },
    };
    const { service } = await fixture({ cipher });
    const [task] = await service.create(input());
    failDecrypt = true;
    const run = await service.execute(task!.id, "decrypt-failed-run", async () => ({}));
    expect(run.status).toBe("failed");
    expect(run.error).toContain("DPAPI decrypt failed");
    expect((await service.listRuns()).find((value) => value.id === run.id)?.status).toBe("failed");
  });
});


describe("automation definition/runtime transactions", () => {
  it.each(["edit", "pause", "delete"])("does not overwrite a concurrent %s on completion", async action => {
    const { root, service, scheduler } = await fixture();
    const other = new AutomationService(root, new LogService(join(root, "other.log")), { executable: "app.exe", cipher: new FakeCipher(), scheduler });
    const task = await service.createOne(input());
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const running = service.execute(task.id, "concurrent-run", async () => { await barrier; return { sessionId: "old-worker-session" }; });
    await vi.waitFor(async () => expect((await service.listRuns())[0]?.status).toBe("running"));
    if (action === "edit") await other.update(task.id, { name: "user-edit" });
    else if (action === "pause") await other.pause(task.id, true);
    else await other.delete(task.id);
    release(); await running;
    const tasks = await other.list();
    if (action === "delete") {
      expect(tasks).toHaveLength(0);
      expect(JSON.parse(await readFile(join(root, "automations", "tasks", `${task.id}.json`), "utf8")).deletedAt).toBeTruthy();
    } else {
      expect(tasks[0]).toMatchObject({ revision: 2, ...(action === "edit" ? { name: "user-edit" } : { enabled: false }) });
      expect(tasks[0]?.sessionId).toBeUndefined();
    }
  });
  it("preserves a legacy session mapping on definition edit", async () => {
    const { root, service } = await fixture(); const task = await service.createOne(input());
    const path = join(root, "automations", "tasks", `${task.id}.json`);
    const saved = JSON.parse(await readFile(path, "utf8")); saved.sessionId = "legacy";
    await writeFile(path, JSON.stringify(saved));
    await service.update(task.id, { name: "changed" });
    expect((await service.list())[0]?.sessionId).toBe("legacy");
  });
  it("does not reacquire a cancelled worker's resources before it exits", async () => {
    const { service } = await fixture(); const task = await service.createOne(input());
    let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
    const first = service.execute(task.id, "original", async () => { await barrier; return {}; });
    await vi.waitFor(async () => expect((await service.listRuns())[0]?.status).toBe("running"));
    await service.cancelRun("original");
    const duplicate = vi.fn(async () => ({}));
    expect((await service.execute(task.id, "second", duplicate)).status).toBe("skipped");
    expect(duplicate).not.toHaveBeenCalled(); release(); expect((await first).status).toBe("cancelled");
  });
  it("repeated dispatch of the same run preserves its terminal result", async () => {
    const { service } = await fixture(); const task = await service.createOne(input());
    await service.execute(task.id, "same", async () => ({ sessionId: "result" }));
    const execute = vi.fn(async () => ({}));
    expect(await service.execute(task.id, "same", execute)).toMatchObject({ status: "completed", sessionId: "result" });
    expect(execute).not.toHaveBeenCalled();
  });
  it("current-session tasks cannot silently change their execution target or mode", async () => {
    const { service } = await fixture(); const task = await service.createOne(input({ destination: "current-session", targetSessionId: "parent" }));
    await expect(service.update(task.id, { targetSessionId: "other" })).rejects.toThrow("保留绑定时");
    await expect(service.update(task.id, { profile: { ...task.profile, mode: "agent" } })).rejects.toThrow("保留绑定时");
    expect((await service.update(task.id, { name: "renamed" }))[0]?.name).toBe("renamed");
    expect((await service.update(task.id, { workspace: "D:\\new-project" }))[0]).toMatchObject({ workspace: "D:\\new-project", targetSessionId: "parent", sessionId: "parent" });
  });
  it("keeps the interval anchor on full-form edits, but resets it for a different rule", async () => {
    let now = new Date("2026-01-01T00:00:00Z"); const { service } = await fixture({ now: () => now });
    const task = await service.createOne(input({ schedule: { kind: "interval", minutes: 60 } }));
    now = new Date("2026-01-01T00:20:00Z");
    const [renamed] = await service.update(task.id, { name: "new name", schedule: { kind: "interval", minutes: 60 } });
    expect(renamed).toMatchObject({ scheduleAnchor: task.scheduleAnchor, nextRunAt: "2026-01-01T01:00:00.000Z" });
    const [changed] = await service.update(task.id, { schedule: { kind: "interval", minutes: 30 } });
    expect(changed?.nextRunAt).toBe("2026-01-01T00:50:00.000Z");
  });
  it("keeps future calendar triggers after a missed or overlapping run without worker re-registration", async () => {
    let now = new Date("2026-01-01T00:00:00Z"); const { service, scheduler } = await fixture({ now: () => now });
    const task = await service.createOne(input({ timeZone: "Asia/Shanghai", missedRunPolicy: "skip" }));
    const native = buildTaskXml(task, "app.exe", []);
    expect(native).toContain("<CalendarTrigger>"); expect(native).toContain("<ScheduleByWeek>"); expect(native).not.toContain("<TimeTrigger>"); expect(native).not.toContain("<EndBoundary>");
    const body = vi.fn(async () => ({}));
    now = new Date("2026-01-02T03:00:00Z"); expect((await service.execute(task.id, "scheduled", body)).status).toBe("skipped"); expect(body).not.toHaveBeenCalled();
    now = new Date("2026-01-03T01:30:00Z");
    let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
    const first = service.execute(task.id, "scheduled", async () => { await barrier; return {}; });
    await vi.waitFor(async () => expect((await service.listRuns()).some(run => run.status === "running")).toBe(true));
    now = new Date("2026-01-04T01:30:00Z"); expect((await service.execute(task.id, "scheduled", body)).status).toBe("skipped");
    release(); await first;
    now = new Date("2026-01-05T01:30:00Z"); expect((await service.execute(task.id, "scheduled", body)).status).toBe("completed");
    expect((await service.execute(task.id, "scheduled", body)).status).toBe("skipped"); expect(body).toHaveBeenCalledTimes(1);
    expect(scheduler.registrations).toHaveLength(1);
  });
  it("does not consume execution slots while a bound session is busy, and cancels its wait", async () => {
    const { service } = await fixture({ globalSlotPollMs: 10 }); await service.updatePolicy({ maxConcurrentRuns: 1 });
    const bound = await service.createOne(input({ destination: "current-session", targetSessionId: "busy" }));
    const other = await service.createOne(input()); const body = vi.fn(async () => ({}));
    const waiting = service.execute(bound.id, "waiting", body, () => false);
    await vi.waitFor(async () => expect((await service.listRuns()).some(run => run.id === "waiting" && run.status === "queued")).toBe(true));
    expect((await service.execute(other.id, "independent", async () => ({}))).status).toBe("completed");
    await service.cancelRun("waiting"); expect((await waiting).status).toBe("cancelled"); expect(body).not.toHaveBeenCalled();
  });
});


it("marks a crashed worker failed, releases its lease and does not replay the same run", async () => {
  const { root, service } = await fixture(); const task = await service.createOne(input());
  const run = await service.runNow(task.id);
  const runPath = join(root, "automations", "runs", `${run.id}.json`);
  await writeFile(runPath, JSON.stringify({ ...run, status: "running", startedAt: new Date().toISOString() }));
  const earlier = new Date(Date.now() - 10_000); await utimes(runPath, earlier, earlier);
  const locks = join(root, "automations", "locks"); await mkdir(locks, { recursive: true });
  await writeFile(join(locks, `${task.id}.lock`), JSON.stringify({ version: 1, leaseId: "dead", runId: run.id, pid: 2147483647 }));
  expect((await service.listRuns(task.id))[0]).toMatchObject({ status: "failed" });
  const replay = vi.fn(async () => ({})); await service.execute(task.id, run.id, replay); expect(replay).not.toHaveBeenCalled();
  expect((await service.execute(task.id, "new-run", async () => ({}))).status).toBe("completed");
});

it("persists Computer-style confirmations and consumes a response from a second process instance", async () => {
  const { root, service, scheduler } = await fixture({ pendingPollMs: 5 }); const task = await service.createOne(input());
  const gui = new AutomationService(root, new LogService(join(root, "gui.log")), { executable: "app.exe", scheduler, cipher: new FakeCipher() });
  const running = service.execute(task.id, "confirmation", async ({ confirm }) => { expect(await confirm({ category: "app-access", app: "Fixture" }, true)).toBe(true); return {}; });
  await vi.waitFor(async () => expect(await gui.pending()).toHaveLength(1));
  const [pending] = await gui.pending(); await gui.respondPending(pending!.id, true);
  expect((await running).status).toBe("completed"); expect(await gui.pending()).toHaveLength(0);
});

it("expires a persistent confirmation without waiting forever", async () => {
  let now = Date.now(); const { service } = await fixture({ pendingPollMs: 5, now: () => new Date(now) });
  await service.updatePolicy({ confirmationTimeoutMinutes: 1 }); const task = await service.createOne(input());
  const running = service.execute(task.id, "confirmation-timeout", async ({ confirm }) => { expect(await confirm({ app: "Fixture" }, true)).toBe(false); return {}; });
  await vi.waitFor(async () => expect(await service.pending()).toHaveLength(1)); now += 61_000;
  await running; expect(await service.pending()).toHaveLength(0);
});


it("does not replay a crashed run even before the stale-run grace period elapses", async () => {
  const { root, service } = await fixture(); const task = await service.createOne(input()); const run = await service.runNow(task.id);
  await writeFile(join(root, "automations", "runs", `${run.id}.json`), JSON.stringify({ ...run, status: "running" }));
  const execute = vi.fn(async () => ({}));
  expect((await service.execute(task.id, run.id, execute)).status).toBe("failed"); expect(execute).not.toHaveBeenCalled();
});


it("rejects a late confirmation after a different process cancels the run", async () => {
  const { root, service, scheduler } = await fixture({ pendingPollMs: 30, cancellationPollMs: 5000 }); const task = await service.createOne(input());
  const gui = new AutomationService(root, new LogService(join(root, "gui.log")), { executable: "app.exe", scheduler, cipher: new FakeCipher() });
  const running = service.execute(task.id, "late-confirm", async ({ confirm }) => { expect(await confirm({ app: "Fixture" }, true)).toBe(false); return {}; });
  await vi.waitFor(async () => expect(await gui.pending()).toHaveLength(1)); const [pending] = await gui.pending();
  await gui.cancelRun("late-confirm"); await expect(gui.respondPending(pending!.id, true)).rejects.toThrow();
  expect((await running).status).toBe("cancelled");
});
