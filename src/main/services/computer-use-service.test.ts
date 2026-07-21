import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildComputerStateResult, computerPointerForAction, ComputerUseService, describeComputerAction, inferComputerRisk, isBlockedComputerTarget, isComputerManualInterventionError, mapScreenshotCoordinates, normalizeComputerState, shouldConfirmComputerRisk, shouldRequestComputerAppPermission } from "./computer-use-service";

describe("Computer Use safety policy", () => {
  it("is accepted and available-by-default while preserving the user's enable toggle", async () => {
    const root = await mkdtemp(join(tmpdir(), "computer-settings-"));
    const service = new ComputerUseService(root, "missing-helper", "missing-plugin", { log: async () => undefined } as never, () => "agent", () => undefined);
    try {
      expect(await service.getSettings()).toMatchObject({ enabled: true, confirmNewApps: false, experimentalUnlocked: true, acceptanceVersion: "0.3.1" });
      expect(await service.updateSettings({ enabled: false, confirmNewApps: true, experimentalUnlocked: false })).toMatchObject({ enabled: false, confirmNewApps: true, experimentalUnlocked: true, acceptanceVersion: "0.3.1" });
    } finally {
      await service.dispose(); await rm(root, { recursive: true, force: true });
    }
  });
  it.each([
    ["powershell", ""], ["pwsh", ""], ["cmd", ""], ["Codex", "任务"], ["notepad", "Windows Security"], ["grok-build-desktop", "Grok Build Desktop"],
  ])("blocks protected target %s", (processName, title) => expect(isBlockedComputerTarget(processName, title)).toBe(true));

  it("does not block ordinary foreground applications", () => {
    expect(isBlockedComputerTarget("notepad", "notes.txt - Notepad")).toBe(false);
    expect(isBlockedComputerTarget("calculatorapp", "Calculator")).toBe(false);
  });

  it("starts an ordinary app directly by default and retains optional per-app confirmation", async () => {
    const root = await mkdtemp(join(tmpdir(), "computer-default-permission-"));
    const emitted: string[] = [];
    const service = new ComputerUseService(root, "fixture", "fixture", { log: async () => undefined } as never, () => "agent", (_value, kind) => emitted.push(kind));
    const rawWindow = { id: "ABC", appId: "fixture", processId: 42, processName: "fixture", executablePath: "C:\\fixture.exe", title: "Fixture", x: 10, y: 20, width: 800, height: 600, dpi: 96, foreground: true, controllable: true };
    const fakeHost = () => ({ call: async (action: string) => action === "list_windows" ? [rawWindow] : action === "get_window_state" ? { stateId: "state", capturedAt: "now", window: rawWindow, elements: [], screenshotWidth: 800, screenshotHeight: 600 } : rawWindow, dispose: async () => undefined });
    (service as any).host = fakeHost();
    try {
      const app = (await service.listApps())[0]!;
      expect(await service.start({ sessionId: "direct", appId: app.id, windowId: "ABC" })).toMatchObject({ status: "running" });
      expect(emitted).not.toContain("permission");
      await service.stop("direct");
      await service.updateSettings({ confirmNewApps: true });
      (service as any).host = fakeHost();
      expect(await service.start({ sessionId: "confirmed", appId: app.id, windowId: "ABC" })).toMatchObject({ status: "awaiting-app-permission" });
      expect(emitted).toContain("permission");
    } finally { await service.dispose(); await rm(root, { recursive: true, force: true }); }
  });

  it("describes actions without exposing typed text and maps a visible pointer", () => {
    expect(describeComputerAction("click", "Increment")).toBe("正在点击 “Increment”…");
    expect(describeComputerAction("type_text", "Search", "secret-value")).toBe("正在向 “Search” 输入文本…");
    const state = { window: { bounds: { x: -100, y: 50, width: 1000, height: 500 } }, screenshotSize: { width: 500, height: 250 } } as never;
    const task = { lastState: state } as never;
    expect(computerPointerForAction(task, { sessionId: "s", action: "click", x: 250, y: 125 })).toEqual({ x: 400, y: 300 });
  });

  it.each(["目标窗口运行于更高权限级别", "当前不是 Default desktop", "Windows Security", "UAC"])("requires manual intervention for %s", (value) => expect(isComputerManualInterventionError(value)).toBe(true));

  it.each([
    ["Delete this file", "click", "delete"],
    ["Send message", "click", "external-communication"],
    ["Pay and subscribe", "click", "financial"],
    ["Install browser extension", "click", "install"],
    ["Change API key permissions", "set_value", "account-access"],
    ["Disable firewall security", "click", "security-settings"],
    ["Upload sensitive private key", "click", "sensitive-transfer"],
  ] as const)("classifies high-impact context %s", (context, action, risk) => expect(inferComputerRisk(context, action)).toBe(risk));

  it("does not over-classify read-only observations", () => expect(inferComputerRisk("Delete button", "get_window_state")).toBeUndefined());

  it("does not layer application or risk confirmations on auto mode", () => {
    expect(shouldRequestComputerAppPermission("auto", true, false)).toBe(false);
    expect(shouldConfirmComputerRisk("auto", "delete")).toBe(false);
    expect(shouldRequestComputerAppPermission("agent", true, false)).toBe(true);
    expect(shouldConfirmComputerRisk("agent", "delete")).toBe(true);
  });

  it("maps scaled screenshot coordinates back to physical window coordinates", () => {
    const state = { window: { bounds: { x: 100, y: 50, width: 1920, height: 1080 } }, screenshotSize: { width: 1600, height: 900 } } as never;
    expect(mapScreenshotCoordinates({ sessionId: "s", action: "drag", x: 800, y: 450, endX: 1600, endY: 900 }, state)).toEqual(expect.objectContaining({ x: 960, y: 540, endX: 1919, endY: 1079 }));
  });

  it.each([
    [96, 960, 960, 480],
    [120, 1_200, 960, 600],
    [144, 1_440, 960, 720],
  ])("maps the center correctly at %i DPI", (dpi, physicalWidth, screenshotWidth, expectedX) => {
    const state = {
      window: { bounds: { x: 0, y: 0, width: physicalWidth, height: 900 }, dpi },
      screenshotSize: { width: screenshotWidth, height: 600 },
    } as never;
    expect(mapScreenshotCoordinates({ sessionId: "s", action: "click", x: screenshotWidth / 2, y: 300 }, state)).toEqual(
      expect.objectContaining({ x: expectedX, y: 450 }),
    );
  });

  it("normalizes absolute UIA bounds on a left-hand monitor into screenshot-local coordinates", () => {
    const state = normalizeComputerState({
      stateId: "secondary-monitor",
      capturedAt: "now",
      window: { id: "w", processName: "fixture", processId: 1, title: "Fixture", x: -1_920, y: 120, width: 1_200, height: 800, dpi: 144, controllable: true },
      screenshotWidth: 960,
      screenshotHeight: 640,
      elements: [{ elementId: "button", name: "OK", controlType: "Button", x: -1_320, y: 520, width: 150, height: 60, patterns: ["Invoke"] }],
    }, "s");
    expect(state.window.bounds.x).toBe(-1_920);
    expect(state.elements[0]?.bounds).toEqual({ x: 480, y: 320, width: 120, height: 48 });
    expect(mapScreenshotCoordinates({ sessionId: "s", action: "click", x: 480, y: 320 }, state)).toEqual(expect.objectContaining({ x: 600, y: 400 }));
  });

  it("returns PNG as MCP image content without duplicating it in text", () => {
    const result = buildComputerStateResult({ stateId: "state", sessionId: "s", window: {} as never, capturedAt: "now", screenshot: "cG5n", screenshotMimeType: "image/png", elements: [], treeTruncated: false } as never, { sessionId: "s", status: "running", stepCount: 1, updatedAt: "now" });
    expect(result.content).toEqual([expect.objectContaining({ type: "text" }), { type: "image", data: "cG5n", mimeType: "image/png" }]);
    expect(String(result.content[0]?.text)).not.toContain("cG5n");
  });

  it("returns an optional original-resolution detail crop as a second image", () => {
    const result = buildComputerStateResult({ stateId: "state", sessionId: "s", window: {} as never, capturedAt: "now", screenshot: "ZnVsbA==", detailScreenshot: "ZGV0YWls", detailRegion: { x: 10, y: 20, width: 100, height: 80 }, elements: [], treeTruncated: false } as never, { sessionId: "s", status: "running", stepCount: 1, updatedAt: "now" });
    expect(result.content).toHaveLength(3);
    expect(result.content[2]).toEqual(expect.objectContaining({ type: "image", data: "ZGV0YWls", _meta: expect.objectContaining({ role: "detail" }) }));
    expect(String(result.content[0]?.text)).not.toContain("ZGV0YWls");
  });
});
