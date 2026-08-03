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
  it("loads an existing scheduled-task session with its fixed execution profile", async () => {
    const log = { log: vi.fn().mockResolvedValue(undefined) };
    const manager = new GrokProcessManager(async () => settings, async () => undefined, log as any, vi.fn());
    const adapter = { start: vi.fn().mockResolvedValue({ sessionId: "task-session" }), dispose: vi.fn(), extensionLeaseId: undefined };
    const spawn = vi.spyOn(manager as any, "spawn").mockResolvedValue(adapter);
    try {
      await expect(manager.openConfigured("D:\\Workspace", "task-session", "high", "auto", "grok-4.5", undefined, { TEST_PROVIDER: "1" })).resolves.toEqual({ sessionId: "task-session" });
      expect(spawn).toHaveBeenCalledWith("D:\\Workspace", "high", "auto", "grok-4.5", undefined, { TEST_PROVIDER: "1" }, undefined);
      expect(adapter.start).toHaveBeenCalledWith("task-session");
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

describe("session cancellation recovery", () => {
  it("replaces only the stuck session when the CLI does not acknowledge cancel", async () => {
    const log = { log: vi.fn().mockResolvedValue(undefined) };
    const onEvent = vi.fn();
    const manager = new GrokProcessManager(async () => settings, async () => undefined, log as any, onEvent);
    const stuck = {
      sessionId: "stuck-session",
      cwd: "C:\\workspace",
      effort: "high",
      mode: "plan",
      currentModelId: "grok-test",
      processOptions: undefined,
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
    const first = { working: false, needsUser: false, dispose: vi.fn().mockResolvedValue(undefined) };
    (manager as any).sessions.set("close-me", first);
    await manager.close("close-me");
    expect(finalize).toHaveBeenCalledWith("close-me", first, "close");
    const second = { sessionId: "suspend-me", cwd: "C:\\repo", effort: "", mode: "agent", currentModelId: "grok", processOptions: undefined, working: false, needsUser: false, dispose: vi.fn().mockResolvedValue(undefined) };
    (manager as any).sessions.set("suspend-me", second);
    await manager.suspendAll();
    expect(finalize).toHaveBeenCalledTimes(1);
    await manager.dispose();
  });
});
