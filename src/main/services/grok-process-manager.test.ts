import { describe, expect, it, vi } from "vitest";
import type { AppSettings, ReasoningEffort } from "../../shared/types";
import { GrokProcessManager, isMutatingExtensionMethod } from "./grok-process-manager";
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

  it("falls back to a controlled restart when the live extension is unavailable", async () => {
    const live = vi.fn().mockRejectedValue(new Error("Method not found"));
    const { manager } = fixture("high", live);
    const restart = vi.spyOn(manager, "restartWithEffort").mockResolvedValue(undefined);
    try {
      await manager.setEffort("session", "low");
      expect(restart).toHaveBeenCalledWith("session", "low");
    } finally {
      await manager.dispose();
    }
  });

  it("uses restart for the empty CLI-default effort", async () => {
    const { manager, setEffort } = fixture("high");
    const restart = vi.spyOn(manager, "restartWithEffort").mockResolvedValue(undefined);
    try {
      await manager.setEffort("session", "");
      expect(setEffort).not.toHaveBeenCalled();
      expect(restart).toHaveBeenCalledWith("session", "");
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
      expect(spawn).toHaveBeenCalledWith("D:\\Workspace", "high", "auto", "grok-4.5", undefined, { TEST_PROVIDER: "1" });
      expect(adapter.start).toHaveBeenCalledWith("task-session");
    } finally { await manager.dispose(); }
  });
});
