import { afterEach, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: {}, clipboard: {}, desktopCapturer: {}, dialog: {}, Menu: {}, nativeImage: {}, nativeTheme: {}, Notification: class {}, session: {}, shell: {}, safeStorage: {} }));
import { AppController, DEFAULT_SETTINGS } from "../app-controller";
import { desktopPetSettings } from "../../shared/desktop-pet";

function controller(): any {
  return Object.assign(Object.create(AppController.prototype), {
    disposing: false, activityRevision: 0, activityListeners: new Set(), settingsListeners: new Set(),
    noticeContexts: new Map(), desktopSessionStates: new Map(), pendingSessionNotices: new Map(),
    runningSessions:new Set(["s"]),
    processes: { snapshots: vi.fn(() => [{ sessionId: "s", cwd: "C:/private/project", processOptions: { apiKey: "private-key" } }]), get: vi.fn(() => ({ working: true, needsUser: false })) },
    catalog: { list: vi.fn(async () => [{ id: "s", title: "修复登录" }]) },
    inbox: { list: vi.fn(async () => [{ id: "result", kind: "completion", title: "result", read: false, createdAt: "2026-10-18" }]), markAllRead: vi.fn(async () => []) },
    automations: { pending: vi.fn(async () => []), list: vi.fn(async () => []), listRuns: vi.fn(async () => []) },
    settingsStore: { get: vi.fn(async () => structuredClone(DEFAULT_SETTINGS)), patch: vi.fn(async (patch: unknown) => ({ ...structuredClone(DEFAULT_SETTINGS), ...patch as object })) },
    remoteLiveDevices: vi.fn(() => 2),
  });
}
afterEach(() => vi.useRealTimers());

it("preserves the latest native position during a settings save and the latest skin during a drag save",async()=>{
  const owner=controller(),position={displayId:2,x:.75,y:.8};
  const saved=structuredClone(DEFAULT_SETTINGS);saved.desktopPet=desktopPetSettings({skinId:"b",position});
  owner.settingsStore.mutate=vi.fn(async(change:(value:typeof saved)=>void)=>{change(saved);return structuredClone(saved);});
  // get() deliberately returns the earlier snapshot without a position.
  const result=await owner.updateSettings({desktopPet:desktopPetSettings({skinId:"a"})});
  expect(result.desktopPet).toMatchObject({skinId:"a",position});
  const moved={displayId:2,x:.2,y:.6};
  const afterDrag=await owner.updateDesktopPetSettings({position:moved});
  expect(afterDrag.desktopPet).toMatchObject({skinId:"a",position:moved});
});

it("projects owned media and live native work without adopting restored runs",async()=>{
  const owner=controller();owner.mediaJobs=new Map([["m",{sessionId:"image-one",status:"running",kind:"image"}]]);
  owner.imageWorkspace={list:vi.fn(async()=>({conversations:[{id:"image-one",title:"插画"}]}))};
  owner.nativeRuns={list:vi.fn(async()=>[{sessionId:"native-one",title:"工作流",status:"running",stale:false},{sessionId:"old",title:"旧记录",status:"running",stale:true}])};
  const snapshot=await owner.getDesktopActivity();expect(snapshot.tasks).toEqual([{kind:"image",id:"image-one",title:"插画",status:"running"},{kind:"session",id:"native-one",title:"工作流",status:"running"}]);
  expect(owner.nativeRuns.list).toHaveBeenCalledOnce();
});
it("media progress fragments do not create another activity refresh",()=>{
  const owner=controller(),job={jobId:"m",sessionId:"s",status:"running",progress:0};owner.mediaJobs=new Map([["m",job]]);
  owner.publishMediaJob(job);const revision=owner.activityRevision;job.progress=.5;owner.publishMediaJob(job);expect(owner.activityRevision).toBe(revision);
});

it("coalesces activity reads and exports only safe owned labels and counts", async () => {
  const owner = controller();
  const first = owner.getDesktopActivity(), second = owner.getDesktopActivity();
  expect(first).toBe(second);
  const snapshot = await first;
  expect(snapshot).toEqual({ sessions: [{ sessionId: "s", title: "修复登录", projectName: "project", status: "running",activeTurn:true }], runningCount: 1, awaitingCount: 0, errorCount: 0, inboxUnreadCount: 1, livePhoneCount: 2 });
  expect(JSON.stringify(snapshot)).not.toContain("private");
  expect(owner.catalog.list).toHaveBeenCalledOnce();
  expect(owner.inbox.list).toHaveBeenCalledOnce();
});

it("coalesces event snapshots, contains observer failures and honors unsubscribe/disposal", async () => {
  vi.useFakeTimers();
  const owner = controller(), listener = vi.fn();
  const off = owner.observeDesktopActivity(listener);
  owner.observeDesktopActivity(async () => { throw Error("bad observer"); });
  await vi.advanceTimersByTimeAsync(0);
  expect(listener).toHaveBeenCalledTimes(1);
  owner.processes.get.mockReturnValue({ working: false, needsUser: true });
  owner.activityChanged(); owner.activityChanged(); owner.activityChanged();
  await vi.advanceTimersByTimeAsync(25);
  expect(listener).toHaveBeenCalledTimes(2);
  expect(listener.mock.calls[1]![0].awaitingCount).toBe(1);
  off(); owner.activityChanged(); await vi.advanceTimersByTimeAsync(25);
  expect(listener).toHaveBeenCalledTimes(2);
  const late = vi.fn(); owner.observeDesktopActivity(late); owner.disposing = true;
  await vi.advanceTimersByTimeAsync(0); expect(late).not.toHaveBeenCalled();
});

it("all-read preserves synthesized pending confirmations as unread actionable entries", async () => {
  const owner = controller();
  owner.inbox.list.mockResolvedValue([{ id: "result", kind: "completion", title: "result", read: true, createdAt: "2026-10-18" }]);
  owner.automations.pending.mockResolvedValue([{ id: "p", taskId: "task", runId: "run", summary: "批准修改", expiresAt: "2026-10-18T23:59:00Z" }]);
  owner.automations.list.mockResolvedValue([{ id: "task", name: "定期检查", sessionId: "s" }]);
  const items = await owner.markAllInboxRead();
  expect(owner.inbox.markAllRead).toHaveBeenCalledOnce();
  expect(items[0]).toMatchObject({ id: "pending:p", read: false, kind: "confirmation", sessionId: "s", automationRunId: "run" });
  expect(items[1].read).toBe(true);
});

it("notifies settings observers only after a successful validated save", async () => {
  const owner = controller(), listener = vi.fn();
  const off = owner.observeSettings(listener);
  owner.observeSettings(async () => { throw Error("observer failed"); });
  await owner.updateSettings({ fontScale: 115 });
  expect(listener).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ fontScale: 115 }));
  owner.settingsStore.patch.mockRejectedValueOnce(Error("save failed"));
  await expect(owner.updateSettings({ fontScale: 120 })).rejects.toThrow("save failed");
  expect(listener).toHaveBeenCalledTimes(1);
  off(); await owner.updateSettings({ fontScale: 100 });
  expect(listener).toHaveBeenCalledTimes(1);
});
