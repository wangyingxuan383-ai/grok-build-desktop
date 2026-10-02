import { describe, expect, it } from "vitest";
import type { AutomationGlobalPolicy, GrokDesktopApi } from "../../../shared/types";
import { loadTaskCenterSnapshot } from "./TaskCenterPanel";

const policy: AutomationGlobalPolicy = {
  defaultProfile: { modelId: "grok-4.5", effort: "", mode: "auto", permissionPolicy: "auto", computerEnabled: false },
  maxConcurrentRuns: 2,
  confirmationTimeoutMinutes: 30,
  inactivityTimeoutMinutes: 0,
  notifyOnSuccess: true,
  notifyOnFailure: true,
};

describe("task center data loading", () => {
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
