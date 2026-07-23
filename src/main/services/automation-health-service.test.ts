import { describe, expect, it, vi } from "vitest";
import type { AutomationTask } from "../../shared/types";
import { checkAutomationHealth } from "./automation-health-service";

describe("checkAutomationHealth", () => {
  it("repairs only registrations and stale session mappings without touching configuration", async () => {
    const task = fixtureTask({ registrationStatus: "error", registrationError: "old executable path", sessionId: "missing", profile: { accountId: "gone", modelId: "old-model", effort: "", mode: "auto", permissionPolicy: "auto", computerEnabled: false } });
    const clearSessionMapping = vi.fn().mockResolvedValue(undefined);
    const repairRegistrations = vi.fn().mockResolvedValue([{ ...task, registrationStatus: "registered" }]);
    const report = await checkAutomationHealth({ tasks: [task], accounts: [], providers: [], workspaceExists: async () => true, sessionExists: async () => false, executableExists: async () => true, executionProfileExists: async () => true, clearSessionMapping, repairRegistrations }, true);
    expect(clearSessionMapping).toHaveBeenCalledWith(task.id);
    expect(repairRegistrations).toHaveBeenCalledTimes(1);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "account", repairable: false, repaired: false }),
      expect.objectContaining({ kind: "session-mapping", repaired: true }),
      expect.objectContaining({ kind: "executable-path", repaired: true }),
    ]));
    expect(report.needsConfiguration).toBe(1);
  });

  it("does not invoke repair callbacks during a read-only check", async () => {
    const task = fixtureTask({ registrationStatus: "needs-repair", sessionId: "stale" });
    const clearSessionMapping = vi.fn(); const repairRegistrations = vi.fn();
    const report = await checkAutomationHealth({ tasks: [task], accounts: [], providers: [], workspaceExists: async () => false, sessionExists: async () => false, executableExists: async () => true, executionProfileExists: async () => true, clearSessionMapping, repairRegistrations }, false);
    expect(clearSessionMapping).not.toHaveBeenCalled(); expect(repairRegistrations).not.toHaveBeenCalled();
    expect(report.healthy).toBe(false);
  });
});

function fixtureTask(patch: Partial<AutomationTask>): AutomationTask {
  return { id: "task", name: "Task", workspace: "C:\\repo", schedule: { kind: "daily", time: "09:00" }, profile: { modelId: "grok", effort: "", mode: "auto", permissionPolicy: "auto", computerEnabled: false }, enabled: true, wakeToRun: false, notify: false, missedRunPolicy: "run-once", contextPolicy: "reuse", promptPresent: true, registrationStatus: "registered", createdAt: "2026-07-22T00:00:00Z", updatedAt: "2026-07-22T00:00:00Z", ...patch };
}
