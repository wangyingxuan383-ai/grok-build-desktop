import { describe, expect, it } from "vitest";
import type { ComputerApp, ComputerWindow } from "./types";
import { resolveComputerMention } from "./computer-mentions";

const app: ComputerApp = { id: "notepad", name: "Notepad", processName: "notepad", windowCount: 1, controllable: true };
const window: ComputerWindow = { id: "A1", appId: "notepad", processId: 1, processName: "notepad", title: "notes.txt - Notepad", bounds: { x: 0, y: 0, width: 800, height: 600 }, dpi: 96, minimized: false, foreground: false, controllable: true };

describe("Computer mentions", () => {
  it("converts a generic @Computer invocation without guessing a window", () => {
    expect(resolveComputerMention("@Computer: inspect the app")?.command).toBe("/computer inspect the app");
  });

  it("matches an exact app alias and pins its only controllable window", () => {
    const value = resolveComputerMention("@Notepad write a draft", [{ app, windows: [window] }]);
    expect(value).toEqual(expect.objectContaining({ app, window }));
    expect(value?.command).toContain("窗口 ID：A1");
    expect(value?.command).toContain("write a draft");
  });

  it("does not convert ordinary mentions or protected applications", () => {
    expect(resolveComputerMention("hello @Notepad", [{ app, windows: [window] }])).toBeUndefined();
    expect(resolveComputerMention("@Codex do something", [{ app: { ...app, id: "codex", name: "Codex", controllable: false }, windows: [] }])).toBeUndefined();
  });
});
