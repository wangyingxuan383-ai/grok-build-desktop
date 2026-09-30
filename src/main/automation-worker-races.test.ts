import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: {}, clipboard: {}, desktopCapturer: {}, dialog: {}, Menu: {}, nativeImage: {}, nativeTheme: {}, Notification: class {}, session: {}, shell: {}, safeStorage: {} }));
import { AppController } from "./app-controller";

describe("automation Worker admission races", () => {
  it("passes the captured revision when fresh-session cleanup races a user edit", async () => {
    const task = { id: "task", revision: 1, sessionId: "old", contextPolicy: "fresh", workspace: "C:\\fixture", profile: { mode: "auto", permissionPolicy: "auto" } };
    let revision = 1; let mapping: string | undefined = "old";
    const cleanup = vi.fn(async () => undefined);
    const setExecutionSession = vi.fn(async (_id: string, id: string | undefined, expected?: number) => { if (revision === expected) mapping = id; });
    const controller = {
      automationSessionReservations: new Set(),
      automations: { list: async () => [task], execute: async (_id: string, _run: string, executor: Function) => executor({ task, signal: new AbortController().signal }), setExecutionSession },
      prepareAutomationAccount: async () => ({ cleanup }), profiles: { assignment: async () => undefined }, sessionRuntime: { get: async () => undefined },
      catalog: { has: async () => true }, processes: { close: async () => { revision = 2; mapping = "edited-session"; } },
      definitions: { listAgents: async () => { throw new Error("stop before CLI launch"); } },
    };
    await expect(AppController.prototype.runAutomationWorker.call(controller as never, "task", "run")).rejects.toThrow("stop before CLI");
    expect(setExecutionSession).toHaveBeenCalledWith("task", undefined, 1);
    expect(mapping).toBe("edited-session"); expect(cleanup).toHaveBeenCalledOnce();
  });

  it("yields admission if a user turn begins during account lookup", async () => {
    const task = { id: "task", destination: "current-session", targetSessionId: "parent", workspace: "C:\\fixture", profile: { mode: "auto", permissionPolicy: "auto", computerEnabled: false, effort: "" } };
    const adapter = { working: false, needsUser: false, cwd: task.workspace, mode: "auto", effort: "", prompt: vi.fn(async () => {}), usePermissionDecider: () => () => {}, cancel() {} };
    const waitUntilReady = vi.fn(async () => { adapter.working = false; });
    const controller = {
      automationSessionReservations: new Set(), sessionRelay: { forward: async () => undefined },
      automations: { list: async () => [task], getPolicy: async () => ({ inactivityTimeoutMinutes: 0 }), execute: async (_id: string, _run: string, executor: Function) => executor({ task, prompt: "continue", signal: new AbortController().signal, waitUntilReady }) },
      processes: { snapshot: () => ({}), get: () => adapter }, vault: { active: async () => { adapter.working = true; return undefined; } }, computer: { configureSession: () => () => {} },
    };
    await AppController.prototype.runAutomationWorker.call(controller as never, "task", "run");
    expect(waitUntilReady).toHaveBeenCalledOnce(); expect(adapter.prompt).toHaveBeenCalledOnce();
  });
});
