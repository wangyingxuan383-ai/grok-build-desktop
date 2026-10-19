import { describe, expect, it, vi } from "vitest";
import { DesktopShellShortcuts } from "./desktop-shell-shortcuts";

describe("opt-in desktop global shortcuts", () => {
  it("registers nothing by default and disposes only shortcuts it owns", () => {
    const host = { register: vi.fn(() => true), unregister: vi.fn() }, open = vi.fn();
    const service = new DesktopShellShortcuts(host, open);
    service.apply(); expect(host.register).not.toHaveBeenCalled();
    service.apply({ quickAskShortcut: "Ctrl+Shift+Space", screenshotShortcut: "Ctrl+Alt+S" });
    expect(host.register).toHaveBeenCalledTimes(2);
    (host.register.mock.calls[0] as unknown as [string, () => void])[1](); expect(open).toHaveBeenCalledWith("ask");
    service.apply({ quickAskShortcut: "Ctrl+Shift+Space", screenshotShortcut: "Ctrl+Alt+S" }); expect(host.register).toHaveBeenCalledTimes(2);
    service.apply(); expect(host.unregister).toHaveBeenCalledTimes(2); expect(host.unregister).not.toHaveBeenCalledWith("CommandOrControl+Alt+Esc");
  });
  it("reports OS conflicts without unregistering a shortcut owned by another feature", () => {
    const host = { register: vi.fn(() => false), unregister: vi.fn() };
    const service = new DesktopShellShortcuts(host, vi.fn());
    expect(service.apply({ quickAskShortcut: "Ctrl+Shift+Space" })[0]).toContain("仍可从托盘打开");
    service.dispose(); expect(host.unregister).not.toHaveBeenCalled();
  });
  it("rejects conflicts with application menu accelerators before registering globally", () => {
    const host = { register: vi.fn(() => true), unregister: vi.fn() };
    const warnings = new DesktopShellShortcuts(host, vi.fn()).apply({ quickAskShortcut: "Control+N" });
    expect(warnings[0]).toContain("冲突"); expect(host.register).not.toHaveBeenCalled();
  });
});
