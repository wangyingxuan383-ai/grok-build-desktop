import { describe, expect, it } from "vitest";
import type { AutomationGlobalPolicy, GrokDesktopApi } from "../../../shared/types";
import { loadTaskCenterSnapshot } from "./TaskCenterPanel";

const policy: AutomationGlobalPolicy = {
  defaultProfile: { modelId: "grok-4.5", effort: "", mode: "auto", permissionPolicy: "auto", computerEnabled: false },
  maxConcurrentRuns: 2,
  confirmationTimeoutMinutes: 30,
  notifyOnSuccess: true,
  notifyOnFailure: true,
};

describe("task center data loading", () => {
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
