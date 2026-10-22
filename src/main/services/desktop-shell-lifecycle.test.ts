import { describe, expect, it, vi } from "vitest";
import { DesktopShellLifecycle, type DesktopShellLifecycleHost } from "./desktop-shell-lifecycle";

function fixture(overrides: Partial<DesktopShellLifecycleHost> = {}) {
  const host: DesktopShellLifecycleHost = {
    getCloseAction: vi.fn(async () => "ask" as const), chooseCloseAction: vi.fn(async () => ({ action: "tray" as const, remember: false })),
    rememberCloseAction: vi.fn(async () => undefined), canHideToTray: () => true, hide: vi.fn(), show: vi.fn(),
    updateInProgress: vi.fn(() => false), warnUpdate: vi.fn(async () => undefined), hasWork: () => false, livePhones: () => 0,
    confirmQuit: vi.fn(async () => true), shutdown: vi.fn(async () => undefined), reportError: vi.fn(), ...overrides,
  };
  return { host, lifecycle: new DesktopShellLifecycle(host) };
}

describe("desktop shell lifecycle", () => {
  it("asks on first close and remembers tray without interrupting work or updates", async () => {
    const { lifecycle, host } = fixture({ chooseCloseAction: vi.fn(async () => ({ action: "tray" as const, remember: true })), hasWork: () => true, updateInProgress: () => true });
    await lifecycle.close();
    expect(host.rememberCloseAction).toHaveBeenCalledWith("tray"); expect(host.hide).toHaveBeenCalledOnce();
    expect(host.confirmQuit).not.toHaveBeenCalled(); expect(host.shutdown).not.toHaveBeenCalled();
  });
  it("does not turn a canceled quit into a saved preference", async () => {
    const { lifecycle, host } = fixture({ chooseCloseAction: async () => ({ action: "quit", remember: true }), hasWork: () => true, confirmQuit: async () => false });
    await lifecycle.close();
    expect(host.rememberCloseAction).not.toHaveBeenCalled(); expect(host.shutdown).not.toHaveBeenCalled(); expect(host.show).toHaveBeenCalledOnce();
  });
  it("checks the update transaction before any destructive warning", async () => {
    const { lifecycle, host } = fixture({ updateInProgress: () => true, hasWork: () => true });
    await lifecycle.quit(); expect(host.warnUpdate).toHaveBeenCalledOnce(); expect(host.confirmQuit).not.toHaveBeenCalled(); expect(host.shutdown).not.toHaveBeenCalled();
  });
  it("coalesces close, menu quit and repeated tray exits into a single warning", async () => {
    let finish!: (value: boolean) => void;
    const { lifecycle, host } = fixture({ getCloseAction: async () => "quit", hasWork: () => true,
      confirmQuit: vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; })) });
    const close = lifecycle.close(); await Promise.resolve();
    const quit = lifecycle.quit(); expect(quit).toBe(close);
    finish(true); await Promise.all([close, quit]); await lifecycle.quit();
    expect(host.confirmQuit).toHaveBeenCalledOnce(); expect(host.shutdown).toHaveBeenCalledOnce();
  });
  it("includes active phone connections in the same exit confirmation", async () => {
    const { lifecycle, host } = fixture({ livePhones: () => 2 });
    await lifecycle.quit(); expect(host.confirmQuit).toHaveBeenCalledOnce(); expect(host.shutdown).toHaveBeenCalledOnce();
  });
  it("rechecks updates after the user accepts a work warning", async () => {
    let updating = false;
    const { lifecycle, host } = fixture({ hasWork: () => true, updateInProgress: () => updating, confirmQuit: async () => { updating = true; return true; } });
    await lifecycle.quit(); expect(host.warnUpdate).toHaveBeenCalledOnce(); expect(host.shutdown).not.toHaveBeenCalled();
  });
  it("never hides when tray creation failed", async () => {
    const { lifecycle, host } = fixture({ getCloseAction: async () => "tray", canHideToTray: () => false });
    await lifecycle.close(); expect(host.hide).not.toHaveBeenCalled(); expect(host.shutdown).toHaveBeenCalledOnce();
  });
  it("keeps the app available when a remembered setting cannot be written", async () => {
    const { lifecycle, host } = fixture({ chooseCloseAction: async () => ({ action: "tray", remember: true }), rememberCloseAction: async () => { throw Error("disk"); } });
    await lifecycle.close(); expect(host.reportError).toHaveBeenCalledOnce(); expect(host.show).toHaveBeenCalledOnce(); expect(host.hide).not.toHaveBeenCalled();
  });
});
