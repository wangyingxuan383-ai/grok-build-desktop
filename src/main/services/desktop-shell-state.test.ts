import { describe, expect, it, vi } from "vitest";
import { DesktopTaskbarService, EMPTY_DESKTOP_ACTIVITY, desktopShellState, type DesktopTaskbarHost } from "./desktop-shell-state";

describe("desktop activity presentation", () => {
  it("prioritizes waiting, then failures, then real work, then live phones", () => {
    const snapshot = { ...EMPTY_DESKTOP_ACTIVITY, runningCount: 2, errorCount: 1, awaitingCount: 1, livePhoneCount: 3 };
    expect(desktopShellState(snapshot).status).toBe("waiting"); snapshot.awaitingCount = 0;
    expect(desktopShellState(snapshot).status).toBe("error"); snapshot.errorCount = 0;
    expect(desktopShellState(snapshot).status).toBe("working"); snapshot.runningCount = 0;
    expect(desktopShellState(snapshot).status).toBe("connected");
  });
  it("uses indeterminate progress only while running and releases an opt-in blocker on waiting/dispose", () => {
    const host: DesktopTaskbarHost = { progress: vi.fn(), badge: vi.fn(), flash: vi.fn(), focused: () => false, startPowerBlocker: vi.fn(() => 0), stopPowerBlocker: vi.fn() };
    const service = new DesktopTaskbarService(host);
    const running = { ...EMPTY_DESKTOP_ACTIVITY, runningCount: 1 };
    service.update(running); expect(host.startPowerBlocker).not.toHaveBeenCalled(); expect(host.progress).toHaveBeenLastCalledWith(2);
    service.update(running, { preventSleepWhileWorking: true }); service.update(running, { preventSleepWhileWorking: true });
    expect(host.startPowerBlocker).toHaveBeenCalledOnce();
    service.update({ ...EMPTY_DESKTOP_ACTIVITY, awaitingCount: 2 }, { preventSleepWhileWorking: true });
    expect(host.progress).toHaveBeenLastCalledWith(-1); expect(host.stopPowerBlocker).toHaveBeenCalledWith(0);
    expect(host.badge).toHaveBeenLastCalledWith(2); expect(host.flash).toHaveBeenCalledWith(true);
    service.update(running, { preventSleepWhileWorking: true }); service.dispose(); service.dispose(); service.update(running, { preventSleepWhileWorking: true });
    expect(host.stopPowerBlocker).toHaveBeenCalledTimes(2); expect(host.startPowerBlocker).toHaveBeenCalledTimes(2);
    expect(host.badge).toHaveBeenLastCalledWith(0);
  });
  it("clears sleep prevention immediately when the setting is disabled", () => {
    const host: DesktopTaskbarHost = { progress: vi.fn(), badge: vi.fn(), flash: vi.fn(), focused: () => true, startPowerBlocker: vi.fn(() => 42), stopPowerBlocker: vi.fn() };
    const service = new DesktopTaskbarService(host);
    service.update({ ...EMPTY_DESKTOP_ACTIVITY, runningCount: 1 }, { preventSleepWhileWorking: true });
    service.update({ ...EMPTY_DESKTOP_ACTIVITY, runningCount: 1 }); expect(host.stopPowerBlocker).toHaveBeenCalledWith(42);
    service.update({ ...EMPTY_DESKTOP_ACTIVITY, awaitingCount: 1 }); expect(host.flash).not.toHaveBeenCalledWith(true);
  });
  it("keeps quiet waiting badges without flashing", () => {
    const host: DesktopTaskbarHost = { progress: vi.fn(), badge: vi.fn(), flash: vi.fn(), focused: () => false, startPowerBlocker: vi.fn(() => 1), stopPowerBlocker: vi.fn() };
    new DesktopTaskbarService(host).update({ ...EMPTY_DESKTOP_ACTIVITY, awaitingCount: 4 }, { quietUntil: new Date(Date.now() + 60000).toISOString() });
    expect(host.badge).toHaveBeenCalledWith(4); expect(host.flash).not.toHaveBeenCalledWith(true);
  });
});
