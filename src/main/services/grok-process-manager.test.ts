import { describe, expect, it, vi } from "vitest";
import type { AppSettings, ReasoningEffort } from "../../shared/types";
import { enforceProtectedWorkspaceEnvironment, GrokProcessManager, isMutatingExtensionMethod, mergeProcessEnvironment } from "./grok-process-manager";
import { DEFAULT_THEME } from "./theme-service";

const settings = {
  theme: DEFAULT_THEME,
  cliPath: "grok",
  httpProxy: "",
  httpsProxy: "",
  defaultModel: "",
  defaultEffort: "",
  defaultMode: "agent",
  showThinking: false,
  expandToolDetails: false,
  fontScale: 100,
  uiDensity: "balanced",
  recentWorkspaces: [],
  activeWorkspace: "",
} satisfies AppSettings;

function fixture(effort: ReasoningEffort, setEffort = vi.fn().mockResolvedValue(undefined)) {
  const log = { log: vi.fn().mockResolvedValue(undefined) };
  const manager = new GrokProcessManager(async () => settings, async () => undefined, log as any, vi.fn());
  const adapter = {
    effort,
    working: false,
    needsUser: false,
    currentModelId: "grok-test",
    models: [{
      modelId: "grok-test",
      name: "Grok Test",
      supportsReasoningEffort: true,
      reasoningEfforts: [{ value: "low", label: "Low" }, { value: "high", label: "High" }],
    }],
    setEffort,
    dispose: vi.fn().mockResolvedValue(undefined),
  };
  (manager as any).sessions.set("session", adapter);
  return { manager, adapter, setEffort, log };
}

describe("Grok process reasoning effort switching", () => {
  it("probes the initialize model catalog without retaining a session", async () => {
    const log = { log: vi.fn().mockResolvedValue(undefined) };
    const manager = new GrokProcessManager(async () => settings, async () => undefined, log as any, vi.fn());
    const adapter = {
      probeModelCatalog: vi.fn().mockResolvedValue([{ modelId: "grok-4.6", name: "Grok 4.6" }]),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(manager as any, "spawn").mockResolvedValue(adapter);
    await expect(manager.probeModelCatalog("C:\\work")).resolves.toEqual([{ modelId: "grok-4.6", name: "Grok 4.6" }]);
    expect(adapter.probeModelCatalog).toHaveBeenCalledTimes(1);
    expect(adapter.dispose).toHaveBeenCalledTimes(1);
    expect((manager as any).sessions.size).toBe(0);
    await manager.dispose();
  });

  it("uses the live adapter path for a concrete effort", async () => {
    const { manager, setEffort } = fixture("high");
    const restart = vi.spyOn(manager, "restartWithEffort").mockResolvedValue(undefined);
    try {
      await manager.setEffort("session", "low");
      expect(setEffort).toHaveBeenCalledWith("low");
      expect(restart).not.toHaveBeenCalled();
    } finally {
      await manager.dispose();
    }
  });

  it("keeps the persisted session intact when the live extension is unavailable", async () => {
    const live = vi.fn().mockRejectedValue(new Error("Method not found"));
    const { manager, adapter } = fixture("high", live);
    const restart = vi.spyOn(manager, "restartWithEffort").mockResolvedValue(undefined);
    try {
      await expect(manager.setEffort("session", "low")).rejects.toThrow("应用没有重启该会话");
      expect(restart).not.toHaveBeenCalled();
      expect(adapter.dispose).not.toHaveBeenCalled();
    } finally {
      await manager.dispose();
    }
  });

  it("does not restart an existing session to restore the empty CLI-default effort", async () => {
    const { manager, setEffort } = fixture("high");
    const restart = vi.spyOn(manager, "restartWithEffort").mockResolvedValue(undefined);
    try {
      await expect(manager.setEffort("session", "")).rejects.toThrow("已存在会话不能切回 CLI 默认强度");
      expect(setEffort).not.toHaveBeenCalled();
      expect(restart).not.toHaveBeenCalled();
    } finally {
      await manager.dispose();
    }
  });

  it("rejects effort values that the active provider model did not declare", async () => {
    const { manager, adapter, setEffort } = fixture("high");
    adapter.currentModelId = "provider-model";
    adapter.models = [{ modelId: "provider-model", name: "Provider", supportsReasoningEffort: false, reasoningEfforts: [] }];
    try {
      await expect(manager.setEffort("session", "xhigh")).rejects.toThrow("可用档位：未声明");
      expect(setEffort).not.toHaveBeenCalled();
      expect(adapter.dispose).not.toHaveBeenCalled();
    } finally {
      await manager.dispose();
    }
  });
});

describe("extension mutation scheduling", () => {
  it("uses the official rename only for an attached session", async () => {
    const { manager, adapter } = fixture("high");
    Object.assign(adapter, { renameSession: vi.fn().mockResolvedValue("official") });
    try {
      await expect(manager.renameSessionIfLoaded("session", "Pinned")).resolves.toBe("official");
      expect((adapter as any).renameSession).toHaveBeenCalledWith("Pinned");
      await expect(manager.renameSessionIfLoaded("missing", "Local")).resolves.toBe("not-loaded");
    } finally { await manager.dispose(); }
  });

  it("queues only state-changing extension methods", () => {
    expect(isMutatingExtensionMethod("x.ai/plugins/action")).toBe(true);
    expect(isMutatingExtensionMethod("x.ai/plugins/reload")).toBe(true);
    expect(isMutatingExtensionMethod("x.ai/mcp/toggle")).toBe(true);
    expect(isMutatingExtensionMethod("x.ai/plugins/list")).toBe(false);
    expect(isMutatingExtensionMethod("x.ai/mcp/list")).toBe(false);
  });

  it("restarts and restores idle sessions when private hot reload is unavailable", async () => {
    const { manager, adapter } = fixture("low");
    Object.assign(adapter, { cwd: "C:\\workspace", mode: "agent", currentModelId: "grok-4.5" });
    const replacement = { start: vi.fn().mockResolvedValue({ sessionId: "session" }), dispose: vi.fn(), extensionLeaseId: undefined };
    vi.spyOn(manager as any, "spawn").mockResolvedValue(replacement);
    try {
      await expect(manager.reloadIdleExtensions(1_000)).resolves.toBe(1);
      expect(adapter.dispose).toHaveBeenCalled();
      expect(replacement.start).toHaveBeenCalledWith("session");
    } finally { await manager.dispose(); }
  });
});

describe("configured session restoration", () => {
  it("joins overlapping opens for the same cold session and spawns one ACP owner", async () => {
    const log = { log: vi.fn().mockResolvedValue(undefined) };
    const manager = new GrokProcessManager(async () => settings, async () => undefined, log as any, vi.fn());
    let finishStart!: (value: { sessionId: string }) => void;
    const start = vi.fn(() => new Promise<{ sessionId: string }>((resolve) => { finishStart = resolve; }));
    const adapter = {
      sessionId: "joined-session", cwd: "C:\\repo", currentModelId: "grok-test", effort: "high", mode: "agent",
      start, dispose: vi.fn().mockResolvedValue(undefined), extensionLeaseId: undefined,
    };
    const spawn = vi.spyOn(manager as any, "spawn").mockResolvedValue(adapter);
    try {
      const first = manager.open("C:\\repo", "joined-session");
      const second = manager.open("C:\\repo", "joined-session");
      await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
      expect(spawn).toHaveBeenCalledTimes(1);
      finishStart({ sessionId: "joined-session" });
      await expect(Promise.all([first, second])).resolves.toEqual([
        { sessionId: "joined-session" },
        { sessionId: "joined-session" },
      ]);
      expect(manager.get("joined-session")).toBe(adapter);
    } finally { await manager.dispose(); }
  });

  it("propagates an open owner's failure to every waiter and allows a clean retry", async () => {
    const log = { log: vi.fn().mockResolvedValue(undefined) };
    const manager = new GrokProcessManager(async () => settings, async () => undefined, log as any, vi.fn());
    let rejectStart!: (reason: Error) => void;
    const failed = {
      start: vi.fn(() => new Promise<{ sessionId: string }>((_resolve, reject) => { rejectStart = reject; })),
      dispose: vi.fn().mockResolvedValue(undefined), extensionLeaseId: undefined,
    };
    const recovered = {
      sessionId: "retry-session", cwd: "C:\\repo", currentModelId: "grok-test", effort: "high", mode: "agent",
      start: vi.fn().mockResolvedValue({ sessionId: "retry-session" }),
      dispose: vi.fn().mockResolvedValue(undefined), extensionLeaseId: undefined,
    };
    const spawn = vi.spyOn(manager as any, "spawn").mockResolvedValueOnce(failed).mockResolvedValueOnce(recovered);
    try {
      const first = manager.open("C:\\repo", "retry-session");
      const second = manager.open("C:\\repo", "retry-session");
      await vi.waitFor(() => expect(failed.start).toHaveBeenCalledTimes(1));
      rejectStart(new Error("attach failed"));
      const settled = await Promise.allSettled([first, second]);
      expect(settled).toEqual([
        expect.objectContaining({ status: "rejected", reason: expect.objectContaining({ message: "attach failed" }) }),
        expect.objectContaining({ status: "rejected", reason: expect.objectContaining({ message: "attach failed" }) }),
      ]);
      await expect(manager.open("C:\\repo", "retry-session")).resolves.toEqual({ sessionId: "retry-session" });
      expect(spawn).toHaveBeenCalledTimes(2);
    } finally { await manager.dispose(); }
  });

  it("probes an unloaded moved session against the new cwd without forking", async () => {
    const log = { log: vi.fn().mockResolvedValue(undefined) };
    const manager = new GrokProcessManager(async () => settings, async () => undefined, log as any, vi.fn());
    const open = vi.spyOn(manager, "open").mockResolvedValue({ sessionId: "moved-session" });
    try {
      await expect(manager.tryMoveSessionToWorkspace("moved-session", "C:\\Moved")).resolves.toBe(true);
      expect(open).toHaveBeenCalledWith("C:\\Moved", "moved-session");
    } finally { await manager.dispose(); }
  });

  it("does not replace a resident session while probing a moved cwd", async () => {
    const { manager } = fixture("high");
    const open = vi.spyOn(manager, "open");
    try {
      await expect(manager.tryMoveSessionToWorkspace("session", "C:\\Moved")).resolves.toBe(false);
      expect(open).not.toHaveBeenCalled();
    } finally { await manager.dispose(); }
  });

  it("restores an unloaded conversation from its session preferences instead of global defaults", async () => {
    const log = { log: vi.fn().mockResolvedValue(undefined) };
    const runtime = {
      get: vi.fn().mockResolvedValue({ sessionId: "saved-session", cwd: "D:\\Saved", modelId: "provider-model", effort: "xhigh", mode: "plan", updatedAt: new Date().toISOString() }),
      getQueue: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue(undefined),
      saveQueue: vi.fn().mockResolvedValue(undefined),
    };
    const manager = new GrokProcessManager(async () => ({ ...settings, defaultModel: "grok-4.5", defaultEffort: "low", defaultMode: "agent" }), async () => undefined, log as any, vi.fn(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, runtime as any);
    const adapter = {
      sessionId: "saved-session", cwd: "D:\\Saved", currentModelId: "provider-model", effort: "xhigh", mode: "plan",
      start: vi.fn().mockResolvedValue({ sessionId: "saved-session" }), dispose: vi.fn(), extensionLeaseId: undefined,
    };
    const spawn = vi.spyOn(manager as any, "spawn").mockResolvedValue(adapter);
    try {
      await manager.open("D:\\Saved", "saved-session");
      expect(spawn).toHaveBeenCalledWith("D:\\Saved", "xhigh", "plan", "provider-model", undefined, undefined, undefined, "saved-session");
      expect(spawn).not.toHaveBeenCalledWith(expect.anything(), "low", "agent", "grok-4.5", expect.anything(), expect.anything(), expect.anything(), expect.anything());
    } finally { await manager.dispose(); }
  });

  it("loads an existing scheduled-task session with its fixed execution profile", async () => {
    const log = { log: vi.fn().mockResolvedValue(undefined) };
    const manager = new GrokProcessManager(async () => settings, async () => undefined, log as any, vi.fn());
    const adapter = { start: vi.fn().mockResolvedValue({ sessionId: "task-session" }), dispose: vi.fn(), extensionLeaseId: undefined };
    const spawn = vi.spyOn(manager as any, "spawn").mockResolvedValue(adapter);
    try {
      await expect(manager.openConfigured("D:\\Workspace", "task-session", "high", "auto", "grok-4.5", undefined, { TEST_PROVIDER: "1" })).resolves.toEqual({ sessionId: "task-session" });
      expect(spawn).toHaveBeenCalledWith("D:\\Workspace", "high", "auto", "grok-4.5", undefined, { TEST_PROVIDER: "1" }, undefined, "task-session");
      expect(adapter.start).toHaveBeenCalledWith("task-session");
    } finally { await manager.dispose(); }
  });

  it("restores an assigned interactive conversation from its saved runtime instead of its old profile", async () => {
    const log = { log: vi.fn().mockResolvedValue(undefined) };
    const runtime = {
      get: vi.fn().mockResolvedValue({ sessionId: "assigned-session", cwd: "D:\\Workspace", modelId: "saved-provider-model", effort: "xhigh", mode: "plan", updatedAt: new Date().toISOString() }),
      getQueue: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue(undefined),
      saveQueue: vi.fn().mockResolvedValue(undefined),
    };
    const manager = new GrokProcessManager(async () => settings, async () => undefined, log as any, vi.fn(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, runtime as any);
    const adapter = { sessionId: "assigned-session", cwd: "D:\\Workspace", currentModelId: "saved-provider-model", effort: "xhigh", mode: "plan", start: vi.fn().mockResolvedValue({ sessionId: "assigned-session" }), dispose: vi.fn(), extensionLeaseId: undefined };
    const spawn = vi.spyOn(manager as any, "spawn").mockResolvedValue(adapter);
    try {
      await manager.openConfigured("D:\\Workspace", "assigned-session", "low", "agent", "old-profile-model", undefined, { PROFILE: "1" }, undefined, true);
      expect(spawn).toHaveBeenCalledWith("D:\\Workspace", "xhigh", "plan", "saved-provider-model", undefined, { PROFILE: "1" }, undefined, "assigned-session");
    } finally { await manager.dispose(); }
  });

  it("keeps multiple live adapters resident so separate conversations can run concurrently", async () => {
    const log = { log: vi.fn().mockResolvedValue(undefined) };
    const manager = new GrokProcessManager(async () => settings, async () => undefined, log as any, vi.fn());
    const adapters = ["session-a", "session-b"].map((sessionId, index) => ({
      sessionId,
      cwd: `C:\\workspace-${index}`,
      effort: "high",
      mode: "agent",
      currentModelId: "grok-test",
      processOptions: undefined,
      working: true,
      needsUser: false,
      extensionLeaseId: undefined,
      start: vi.fn().mockResolvedValue({ sessionId }),
      dispose: vi.fn().mockResolvedValue(undefined),
    }));
    vi.spyOn(manager as any, "spawn").mockResolvedValueOnce(adapters[0]).mockResolvedValueOnce(adapters[1]);
    try {
      await Promise.all([
        manager.createConfigured(adapters[0]!.cwd, "high", "agent", "grok-test"),
        manager.createConfigured(adapters[1]!.cwd, "high", "agent", "grok-test"),
      ]);
      expect(manager.snapshots().map((value) => value.sessionId).sort()).toEqual(["session-a", "session-b"]);
      expect(manager.liveStatuses()).toEqual(new Map([["session-a", "working"], ["session-b", "working"]]));
      expect(manager.get("session-a")).toBe(adapters[0]);
      expect(manager.get("session-b")).toBe(adapters[1]);
    } finally {
      await manager.dispose();
    }
  });
});

describe("transactional provider model switching", () => {
  it("commits the target local model and provider only after live switching succeeds", async () => {
    const runtime = {
      get: vi.fn().mockResolvedValue({ sessionId: "session", cwd: "C:\\repo", modelId: "provider-a-local", providerId: "provider-a", effort: "high", mode: "agent", updatedAt: "2026-08-05T00:00:00.000Z" }),
      save: vi.fn().mockResolvedValue(undefined),
    };
    const manager = new GrokProcessManager(async () => settings, async () => undefined, { log: vi.fn() } as any, vi.fn(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, runtime as any);
    const current = {
      sessionId: "session", cwd: "C:\\repo", effort: "high", mode: "agent", currentModelId: "provider-a-local",
      working: false, needsUser: false, processOptions: undefined,
      setModel: vi.fn().mockImplementation(async function (this: any, modelId: string, identity: { localModelId?: string }) { this.currentModelId = identity.localModelId ?? modelId; }),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    (manager as any).sessions.set("session", current);
    try {
      await manager.setModel("session", "provider-b-local", {
        target: { providerId: "provider-b", localModelId: "provider-b-local" },
        previous: { providerId: "provider-a", localModelId: "provider-a-local" },
      });
      expect(current.setModel).toHaveBeenCalledWith("provider-b-local", { localModelId: "provider-b-local", persistRuntime: false });
      expect(runtime.save).toHaveBeenLastCalledWith(expect.objectContaining({ modelId: "provider-b-local", providerId: "provider-b" }));
    } finally { await manager.dispose(); }
  });

  it("starts the target with its provider route and restores the complete previous identity on failure", async () => {
    const runtime = {
      get: vi.fn().mockResolvedValue({ sessionId: "session", cwd: "C:\\repo", modelId: "provider-a-local", providerId: "provider-a", effort: "high", mode: "agent", updatedAt: "2026-08-05T00:00:00.000Z" }),
      save: vi.fn().mockResolvedValue(undefined),
    };
    const manager = new GrokProcessManager(async () => settings, async () => undefined, { log: vi.fn() } as any, vi.fn(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, runtime as any);
    const current = {
      sessionId: "session", cwd: "C:\\repo", effort: "high", mode: "agent", currentModelId: "provider-a-local",
      working: false, needsUser: false, processOptions: undefined,
      setModel: vi.fn().mockRejectedValue(new Error("hot switch unsupported")),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const target = { start: vi.fn().mockRejectedValue(new Error("target unavailable")), dispose: vi.fn().mockResolvedValue(undefined), extensionLeaseId: undefined };
    const rollback = { sessionId: "session", cwd: "C:\\repo", effort: "high", mode: "agent", currentModelId: "provider-a-local", start: vi.fn().mockResolvedValue({ sessionId: "session" }), dispose: vi.fn().mockResolvedValue(undefined), extensionLeaseId: undefined };
    (manager as any).sessions.set("session", current);
    const spawn = vi.spyOn(manager as any, "spawn").mockResolvedValueOnce(target).mockResolvedValueOnce(rollback);
    try {
      await expect(manager.setModel("session", "provider-b-local", {
        target: { providerId: "provider-b", localModelId: "provider-b-local" },
        previous: { providerId: "provider-a", localModelId: "provider-a-local" },
      })).rejects.toThrow("已尝试恢复原模型");
      expect(spawn).toHaveBeenNthCalledWith(1, "C:\\repo", "high", "agent", "provider-b-local", undefined, undefined, undefined, "session", { providerId: "provider-b", localModelId: "provider-b-local" });
      expect(spawn).toHaveBeenNthCalledWith(2, "C:\\repo", "high", "agent", "provider-a-local", undefined, undefined, undefined, "session", { providerId: "provider-a", localModelId: "provider-a-local" });
      expect(runtime.save).toHaveBeenLastCalledWith(expect.objectContaining({ modelId: "provider-a-local", providerId: "provider-a" }));
      expect(manager.get("session")).toBe(rollback);
    } finally { await manager.dispose(); }
  });
});

describe("session cancellation recovery", () => {
  it("replaces only the stuck session when the CLI does not acknowledge cancel", async () => {
    const log = { log: vi.fn().mockResolvedValue(undefined) };
    const onEvent = vi.fn();
    const manager = new GrokProcessManager(async () => settings, async () => undefined, log as any, onEvent);
    const permissionDecider = vi.fn().mockResolvedValue(false);
    const processOptions = { environmentOverride: { PROFILE_FLAG: "kept" }, permissionDecider, alwaysApprove: false };
    const stuck = {
      sessionId: "stuck-session",
      cwd: "C:\\workspace",
      effort: "high",
      mode: "plan",
      currentModelId: "grok-test",
      processOptions,
      working: true,
      needsUser: false,
      cancel: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const replacement = {
      start: vi.fn().mockResolvedValue({ sessionId: "stuck-session" }),
      dispose: vi.fn().mockResolvedValue(undefined),
      extensionLeaseId: undefined,
      working: false,
      needsUser: false,
    };
    (manager as any).sessions.set("stuck-session", stuck);
    vi.spyOn(manager as any, "spawn").mockResolvedValue(replacement);
    try {
      await manager.cancelSession("stuck-session", 0);
      expect(stuck.cancel).toHaveBeenCalledTimes(1);
      expect(stuck.dispose).toHaveBeenCalledWith(2_000);
      expect((manager as any).spawn).toHaveBeenCalledWith(
        "C:\\workspace", "high", "plan", "grok-test", undefined, undefined, processOptions, "stuck-session",
      );
      expect(replacement.start).toHaveBeenCalledWith("stuck-session");
      expect(manager.get("stuck-session")).toBe(replacement);
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "status", status: "idle", text: "已停止并恢复会话" }));
    } finally {
      await manager.dispose();
    }
  });

  it("does not restart after an acknowledged cancel", async () => {
    const log = { log: vi.fn().mockResolvedValue(undefined) };
    const manager = new GrokProcessManager(async () => settings, async () => undefined, log as any, vi.fn());
    const adapter = {
      working: true,
      needsUser: false,
      cancel: vi.fn(function (this: { working: boolean }) { this.working = false; }),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    (manager as any).sessions.set("session", adapter);
    const spawn = vi.spyOn(manager as any, "spawn");
    try {
      await manager.cancelSession("session", 100);
      expect(adapter.cancel).toHaveBeenCalledTimes(1);
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      await manager.dispose();
    }
  });
});

describe("workspace process environment", () => {
  it("injects per-workspace memory by default while preserving explicit execution-profile overrides", () => {
    expect(mergeProcessEnvironment({ PATH: "base", GROK_MEMORY: undefined }, { GROK_MEMORY: "1" }, { MCP_TOKEN: "secret" })).toEqual({ PATH: "base", GROK_MEMORY: "1", MCP_TOKEN: "secret" });
    expect(mergeProcessEnvironment({ GROK_MEMORY: "0" }, { GROK_MEMORY: "1" }, undefined, { GROK_MEMORY: "0" })).toEqual({ GROK_MEMORY: "0" });
    expect(enforceProtectedWorkspaceEnvironment({ GROK_MEMORY_LOG: "C:\\leak.log" }, { GROK_MEMORY_LOG: "0" })).toEqual({ GROK_MEMORY_LOG: "0" });
  });

  it("performs a controlled idle-session restart so updated workspace settings take effect", async () => {
    const { manager, adapter } = fixture("high");
    Object.assign(adapter, { cwd: "C:\\workspace", mode: "agent", currentModelId: "grok-4.5" });
    const replacement = { start: vi.fn().mockResolvedValue({ sessionId: "session" }), dispose: vi.fn(), extensionLeaseId: undefined };
    vi.spyOn(manager as any, "spawn").mockResolvedValue(replacement);
    try {
      await manager.restartSession("session", "Memory setting changed");
      expect(adapter.dispose).toHaveBeenCalled();
      expect(replacement.start).toHaveBeenCalledWith("session");
      expect(manager.get("session")).toBe(replacement);
    } finally { await manager.dispose(); }
  });

  it("restarts only idle sessions after Agent/Persona definition changes", async () => {
    const log = { log: vi.fn().mockResolvedValue(undefined) };
    const manager = new GrokProcessManager(async () => settings, async () => undefined, log as any, vi.fn());
    (manager as any).sessions.set("idle", { working: false, needsUser: false });
    (manager as any).sessions.set("working", { working: true, needsUser: false });
    (manager as any).sessions.set("waiting", { working: false, needsUser: true });
    const restart = vi.spyOn(manager, "restartSession").mockResolvedValue(undefined);
    try {
      await expect(manager.restartIdleSessions()).resolves.toBe(1);
      expect(restart).toHaveBeenCalledTimes(1);
      expect(restart).toHaveBeenCalledWith("idle", expect.stringContaining("Agent/Persona"));
    } finally {
      restart.mockRestore();
      (manager as any).sessions.clear();
      await manager.dispose();
    }
  });
});

describe("adapter close signalling", () => {
  it("emits closed exactly once even when the process never spawned", async () => {
    const { GrokAcpAdapter } = await import("./grok-acp-adapter");
    const adapter = Object.create(GrokAcpAdapter.prototype) as any;
    const emitted: string[] = [];
    adapter.emit = (event: string) => { emitted.push(event); return true; };
    adapter.closedEmitted = false;
    adapter.disposed = false;
    adapter.process = undefined;
    adapter.finishEffortChange = () => undefined;
    adapter.lines = undefined;
    adapter.terminal = { disposeAll: async () => undefined };

    // `closed` is the only hook that releases the Computer Use lease. A spawn
    // failure emits error+close but never exit, so without this the lease
    // (MCP server, transport, loopback token) would leak for the app lifetime.
    await adapter.dispose(10);
    await adapter.dispose(10);

    expect(emitted.filter((value) => value === "closed")).toHaveLength(1);
  });
});

describe("session finalization", () => {
  it("runs the finalization hook for a real close but not for a controlled suspend", async () => {
    const log = { log: vi.fn().mockResolvedValue(undefined) };
    const finalize = vi.fn().mockResolvedValue(undefined);
    const manager = new GrokProcessManager(async () => settings, async () => undefined, log as any, vi.fn(), undefined, undefined, undefined, async () => ({}), async () => ({}), async () => ({}), finalize);
    const first = { working: false, needsUser: false, taskList: vi.fn().mockResolvedValue({ tasks: [] }), subagentListRunning: vi.fn().mockResolvedValue({ subagents: [] }), dispose: vi.fn().mockResolvedValue(undefined) };
    (manager as any).sessions.set("close-me", first);
    await manager.close("close-me");
    expect(finalize).toHaveBeenCalledWith("close-me", first, "close");
    const second = { sessionId: "suspend-me", cwd: "C:\\repo", effort: "", mode: "agent", currentModelId: "grok", processOptions: undefined, working: false, needsUser: false, dispose: vi.fn().mockResolvedValue(undefined) };
    (manager as any).sessions.set("suspend-me", second);
    await manager.suspendAll();
    expect(finalize).toHaveBeenCalledTimes(1);
    await manager.dispose();
  });

  it("stops every running child agent before releasing a deleted conversation", async () => {
    const log = { log: vi.fn().mockResolvedValue(undefined) };
    const manager = new GrokProcessManager(async () => settings, async () => undefined, log as any, vi.fn());
    const adapter = {
      working: false,
      needsUser: false,
      taskList: vi.fn().mockResolvedValue({ tasks: [
        { taskId: "task-live", completed: false },
        { task_id: "task-done", completed: true },
      ] }),
      taskKill: vi.fn().mockResolvedValue(undefined),
      subagentListRunning: vi.fn().mockResolvedValue({ subagents: [{ subagentId: "child-a" }, { subagent_id: "child-b" }] }),
      subagentCancel: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    (manager as any).sessions.set("parent", adapter);
    await manager.close("parent");
    expect(adapter.taskKill).toHaveBeenCalledWith("task-live", "teardown");
    expect(adapter.subagentCancel.mock.calls).toEqual([["child-a"], ["child-b"]]);
    expect(adapter.dispose).toHaveBeenCalledTimes(1);
    await manager.dispose();
  });

  it("tears down owned background work before shutdown disposes the ACP process", async () => {
    const log = { log: vi.fn().mockResolvedValue(undefined) };
    const manager = new GrokProcessManager(async () => settings, async () => undefined, log as any, vi.fn());
    const adapter = {
      working: false,
      needsUser: false,
      taskList: vi.fn().mockResolvedValue({ tasks: [{ id: "background-task", status: "running" }] }),
      taskKill: vi.fn().mockResolvedValue(undefined),
      subagentListRunning: vi.fn().mockResolvedValue({ subagents: [{ id: "background-agent" }] }),
      subagentCancel: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    (manager as any).sessions.set("shutdown-parent", adapter);
    await manager.stopAll(false);
    expect(adapter.taskKill).toHaveBeenCalledWith("background-task", "teardown");
    expect(adapter.subagentCancel).toHaveBeenCalledWith("background-agent");
    expect(adapter.dispose).toHaveBeenCalledTimes(1);
    await manager.dispose();
  });

  it("does not reap or cap-evict an idle session when its background teardown fails", async () => {
    const log = { log: vi.fn().mockResolvedValue(undefined) };
    const finalize = vi.fn().mockResolvedValue(undefined);
    const manager = new GrokProcessManager(async () => settings, async () => undefined, log as any, vi.fn(), undefined, undefined, undefined, async () => ({}), async () => ({}), async () => ({}), finalize);
    const makeAdapter = (lastTouched: number) => ({
      working: false,
      needsUser: false,
      lastTouched,
      taskList: vi.fn().mockResolvedValue({ tasks: [{ id: "live-task", status: "running" }] }),
      taskKill: vi.fn().mockRejectedValue(new Error("task refused teardown")),
      subagentListRunning: vi.fn().mockResolvedValue({ subagents: [] }),
      subagentCancel: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    });
    const reapVictim = makeAdapter(Date.now() - 2 * 60 * 60_000);
    (manager as any).sessions.set("reap-victim", reapVictim);
    await (manager as any).reap();
    expect((manager as any).sessions.has("reap-victim")).toBe(true);
    expect(reapVictim.dispose).not.toHaveBeenCalled();

    (manager as any).focusedId = "focused";
    (manager as any).sessions.set("focused", makeAdapter(Date.now()));
    for (let index = 0; index < 7; index++) (manager as any).sessions.set(`busy-${index}`, { working: true, needsUser: false, lastTouched: Date.now() });
    await (manager as any).enforceCap();
    expect((manager as any).sessions.has("reap-victim")).toBe(true);
    expect(reapVictim.dispose).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalledWith("reap-victim", reapVictim, expect.anything());
    (manager as any).sessions.clear();
    await manager.dispose();
  });
});
