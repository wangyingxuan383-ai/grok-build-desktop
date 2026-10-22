import { describe, expect, it } from "vitest";
import { matchesShortcut, normalizeAccelerator, validateShortcutBindings } from "./shortcuts";

describe("desktop shortcuts", () => {
  it("normalizes aliases and rejects bare typing or duplicate modifiers", () => {
    expect(normalizeAccelerator("ctrl+shift+space")).toBe("Control+Shift+Space");
    expect(normalizeAccelerator("")).toBe("");
    for (const value of ["k", "Ctrl+Ctrl+K", "Control+Escape", "Control+;quit"]) expect(() => normalizeAccelerator(value)).toThrow();
  });
  it("checks effective defaults, global collisions and reserved controls", () => {
    expect(() => validateShortcutBindings({})).not.toThrow();
    for (const patch of [{ quickAskShortcut: "Control+K" }, { quickAskShortcut: "Ctrl+C" }, { quickAskShortcut: "Alt+F4" }, { shortcuts: { "open-settings": "Control+N" } }]) expect(() => validateShortcutBindings(patch)).toThrow();
    expect(() => validateShortcutBindings({ shortcuts: { "command-search": "" }, quickAskShortcut: "Control+K" })).not.toThrow();
  });
  it("requires exact modifiers and never consumes IME input", () => {
    const event = { key: "F", ctrlKey: true, altKey: false, metaKey: false, shiftKey: true, isComposing: false };
    expect(matchesShortcut(event, "Control+Shift+F")).toBe(true);
    expect(matchesShortcut(event, "Control+F")).toBe(false);
    expect(matchesShortcut({ ...event, isComposing: true }, "Control+Shift+F")).toBe(false);
  });
});
