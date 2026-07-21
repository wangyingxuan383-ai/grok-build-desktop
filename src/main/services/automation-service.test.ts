import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AutomationTask, AutomationTaskInput } from "../../shared/types";
import { AutomationService, buildTaskXml, calculateNextRun, classifyScheduledRisk, type AutomationCipher, type TaskSchedulerAdapter } from "./automation-service";
import { LogService } from "./log-service";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
class FakeCipher implements AutomationCipher { encrypt(value: string) { return Buffer.from(value).toString("base64"); } decrypt(value: string) { return Buffer.from(value, "base64").toString(); } }
class FakeScheduler implements TaskSchedulerAdapter { registrations: AutomationTask[] = []; removed: string[] = []; supported() { return true; } async register(task: AutomationTask) { this.registrations.push(task); } async unregister(id: string) { this.removed.push(id); } }
function input(patch: Partial<AutomationTaskInput> = {}): AutomationTaskInput { return { name: "每日项目检查", workspace: "D:\\中文 工作区", prompt: "检查项目并汇报", schedule: { kind: "daily", time: "09:30" }, profile: { modelId: "grok-4.5", effort: "", mode: "auto", permissionPolicy: "auto", computerEnabled: false, accountId: "account-test" }, enabled: true, wakeToRun: false, notify: true, missedRunPolicy: "run-once", contextPolicy: "reuse", ...patch }; }
async function fixture(options: Partial<ConstructorParameters<typeof AutomationService>[2]> = {}) { const root = await mkdtemp(join(tmpdir(), "grok-automation-")); roots.push(root); const scheduler = new FakeScheduler(); const launched = vi.fn(async () => undefined); const service = new AutomationService(root, new LogService(join(root, "app.log")), { executable: "D:\\应用 目录\\Grok Build Desktop.exe", cipher: new FakeCipher(), scheduler, launchWorker: launched, ...options }); return { root, scheduler, launched, service }; }

describe("AutomationService", () => {
  it("stores one encrypted task file and registers a least-privilege task", async () => { const { root, scheduler, service } = await fixture(); const tasks = await service.create(input()); expect(tasks).toHaveLength(1); expect(scheduler.registrations).toHaveLength(1); const raw = await readFile(join(root, "automations", "tasks", `${tasks[0]!.id}.json`), "utf8"); expect(raw).not.toContain("检查项目并汇报"); expect(raw).toContain("encryptedPrompt"); });
  it("launches a namespaced worker for Run now", async () => { const { service, launched } = await fixture(); const [task] = await service.create(input()); const run = await service.runNow(task!.id); expect(run.status).toBe("queued"); expect(launched).toHaveBeenCalledWith(task!.id, run.id); });
  it("executes once, records the resumable session and releases the lock", async () => { const { service } = await fixture(); const [task] = await service.create(input()); const run = await service.execute(task!.id, "scheduled", async ({ prompt }) => { expect(prompt).toBe("检查项目并汇报"); return { sessionId: "session-test" }; }); expect(run.status).toBe("completed"); expect(run.sessionId).toBe("session-test"); });
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
  it("generates escaped XML for Chinese and spaced non-system paths", () => { const task = { ...input(), id: "task-id", promptPresent: true, registrationStatus: "registered", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" } satisfies AutomationTask; const xml = buildTaskXml(task, "D:\\应用 & 工具\\Grok Build Desktop.exe", ["--scheduler-worker", task.id, "scheduled"]); expect(xml).toContain("InteractiveToken"); expect(xml).toContain("LeastPrivilege"); expect(xml).toContain("<StartWhenAvailable>true</StartWhenAvailable>"); expect(xml).toContain("D:\\应用 &amp; 工具"); expect(xml).toContain("D:\\中文 工作区"); expect(buildTaskXml({ ...task, missedRunPolicy: "skip" }, "app.exe", [])).toContain("<StartWhenAvailable>false</StartWhenAvailable>"); });
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
    const runs = await Promise.all(tasks.map((task, index) => service.execute(task.id, `parallel-${index}`, async () => {
      active += 1; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 30));
      active -= 1;
      return {};
    })));
    expect(runs.every((run) => run.status === "completed")).toBe(true);
    expect(peak).toBe(2);
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
