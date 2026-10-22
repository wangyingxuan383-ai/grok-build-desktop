import { describe, expect, it, vi } from "vitest";
import type { AutomationGlobalPolicy, GrokDesktopApi } from "../../../shared/types";
import { initialTaskCenterTab, observeTaskCenterNavigation, loadTaskCenterSnapshot, observeTaskCenterInbox, sortTaskCenterInbox } from "./TaskCenterPanel";

const policy: AutomationGlobalPolicy = {
  defaultProfile: { modelId: "grok-4.5", effort: "", mode: "auto", permissionPolicy: "auto", computerEnabled: false },
  maxConcurrentRuns: 2,
  confirmationTimeoutMinutes: 30,
  inactivityTimeoutMinutes: 0,
  notifyOnSuccess: true,
  notifyOnFailure: true,
};

describe("task center data loading", () => {
  it("opens the inbox on first mount and consumes its one-shot destination", () => {
    const data = new Map([["grok.task-center-tab.v1", "inbox"], ["grok.task-notification-run.v1", "run-id"]]);
    const storage = { getItem: (key: string) => data.get(key) ?? null, removeItem: (key: string) => { data.delete(key); } };
    expect(initialTaskCenterTab(storage)).toBe("inbox");
    expect(initialTaskCenterTab(storage)).toBe("runs");
    data.clear(); expect(initialTaskCenterTab(storage)).toBe("persistent");
  });
  it("navigates an already open task center and removes its listener on close", () => {
    const events = new EventTarget(), select = vi.fn(), removeItem = vi.fn();
    const off = observeTaskCenterNavigation(events, { removeItem }, select);
    events.dispatchEvent(new Event("grok:open-inbox"));
    expect(select).toHaveBeenCalledExactlyOnceWith("inbox");
    expect(removeItem).toHaveBeenCalledWith("grok.task-center-tab.v1");
    off(); events.dispatchEvent(new Event("grok:open-inbox"));
    expect(select).toHaveBeenCalledTimes(1);
  });
  it("ignores an old inbox response after a newer event and stops delivery on cleanup", async () => {
    type Item = Parameters<typeof sortTaskCenterInbox>[0][number];
    let resolve!: (items: Item[]) => void;
    let listener!: (items?: Item[] | void) => void;
    const off = vi.fn(), publish = vi.fn(), error = vi.fn();
    const api = { listInbox: vi.fn(() => new Promise<Item[]>(done => { resolve = done; })), onInboxChanged: (callback: typeof listener) => { listener = callback; return off; } };
    const dispose = observeTaskCenterInbox(api, publish, error);
    const latest: Item = { id: "new", kind: "failure", title: "latest", read: false, createdAt: "2026-10-18" };
    listener([latest]); resolve([]);
    await Promise.resolve(); await Promise.resolve();
    expect(publish).toHaveBeenCalledExactlyOnceWith([latest]);
    dispose(); listener([]);
    expect(off).toHaveBeenCalledOnce(); expect(publish).toHaveBeenCalledTimes(1); expect(error).not.toHaveBeenCalled();
  });

  it("coalesces void invalidations arriving during a read and reads the latest snapshot", async () => {
    type Item = Parameters<typeof sortTaskCenterInbox>[0][number];
    let resolve!: (items: Item[]) => void;
    let listener!: (items?: Item[] | void) => void;
    const latest: Item = { id: "confirmation", kind: "confirmation", title: "respond", read: false, createdAt: "2026-10-18" };
    const read = vi.fn<() => Promise<Item[]>>().mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue([latest]);
    const publish = vi.fn(), error = vi.fn();
    const dispose = observeTaskCenterInbox({ listInbox: read, onInboxChanged: callback => { listener = callback; return () => undefined; } }, publish, error);
    listener(); listener(); resolve([]);
    await vi.waitFor(() => expect(publish).toHaveBeenCalledExactlyOnceWith([latest]));
    expect(read).toHaveBeenCalledTimes(2); dispose();
  });

  it("does not report an inbox read failure after unmount", async () => {
    let reject!: (error: Error) => void;
    const error = vi.fn(), publish = vi.fn();
    const dispose = observeTaskCenterInbox({ listInbox: () => new Promise((_resolve, fail) => { reject = fail; }) }, publish, error);
    dispose(); reject(Error("late failure"));
    await Promise.resolve(); await Promise.resolve();
    expect(error).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
  });
  it("publishes tasks before slow sources and preserves them when provider discovery fails",async()=>{const api={listAutomations:async()=>[{id:"kept"}],listAutomationRuns:async()=>[],getAutomationGlobalPolicy:async()=>policy,listBackgroundTasks:async()=>[],listInbox:async()=>[],listProviders:async()=>{throw Error("provider unavailable")}} as unknown as Parameters<typeof loadTaskCenterSnapshot>[0];const snapshots:unknown[]=[];const result=await loadTaskCenterSnapshot(api,value=>snapshots.push(value.tasks));expect(snapshots[0]).toEqual([{id:"kept"}]);expect(result.tasks).toEqual([{id:"kept"}]);expect(result.errors).toEqual(["providers：provider unavailable"])});
  it("reads system-backed sources sequentially before publishing one snapshot", async () => {
    const order: string[] = [];
    let active = 0;
    let maximumActive = 0;
    const read = async <T>(name: string, value: T): Promise<T> => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      order.push(name);
      active -= 1;
      return value;
    };
    const api = {
      listAutomations: () => read("tasks", []),
      listAutomationRuns: () => read("runs", []),
      getAutomationGlobalPolicy: () => read("policy", policy),
      listBackgroundTasks: () => read("background", []),
      listInbox: () => read("inbox", []),
      listProviders: () => read("providers", []),
    } as Pick<GrokDesktopApi, "listAutomations" | "listAutomationRuns" | "getAutomationGlobalPolicy" | "listBackgroundTasks" | "listInbox" | "listProviders">;

    const result = await loadTaskCenterSnapshot(api);

    expect(maximumActive).toBe(1);
    expect(order).toEqual(["tasks", "runs", "policy", "background", "inbox", "providers"]);
    expect(result.policy).toEqual(policy);
  });
});
