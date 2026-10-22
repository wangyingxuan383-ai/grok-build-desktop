import { beforeEach, describe, expect, it, vi } from "vitest";
import { pathToFileURL } from "node:url";
import type { AppController } from "../app-controller";

const mocks = vi.hoisted(() => ({ handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  readImage: vi.fn(), readText: vi.fn(), snip: vi.fn(), picker: vi.fn(), loadURL: vi.fn(), messageBox: vi.fn(), windows: [] as Array<any> }));
vi.mock("electron", () => ({
  BrowserWindow: class {
    dead = false;
    webContents = { id: 32, mainFrame: { processId: 11, routingId: 22 }, on: vi.fn(), setWindowOpenHandler: vi.fn(),
      session: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() } };
    on = vi.fn(); once = vi.fn(); show = vi.fn(); focus = vi.fn(); setMenu = vi.fn(); loadURL = mocks.loadURL;
    isDestroyed() { return this.dead; } destroy() { this.dead = true; }
    constructor(readonly options: unknown) { mocks.windows.push(this); }
  },
  clipboard: { readImage: mocks.readImage, readText: mocks.readText }, dialog: { showOpenDialog: mocks.picker, showMessageBox: mocks.messageBox },
  shell: { openExternal: mocks.snip }, screen: { getCursorScreenPoint: () => ({ x: 100, y: 100 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1200, height: 800 } }) },
  ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => mocks.handlers.set(channel, handler), removeHandler: (channel: string) => mocks.handlers.delete(channel) },
}));
import { DesktopQuickEntryWindow, trustedQuickEntryFrame } from "./desktop-quick-entry-window";

const entry = "D:/app/quick-entry/index.html", url = pathToFileURL(entry).href;
const frame = () => ({ sender: { id: 32 }, senderFrame: { processId: 11, routingId: 22, url } });
function fixture() {
  const controller = { getSettings: vi.fn(async () => ({ activeWorkspace: "D:/project", recentWorkspaces: [], theme: {} })),
    discoverWorkspaces: vi.fn(async () => []), listSessions: vi.fn(async () => []), attachmentsFromDroppedPaths: vi.fn(async () => []) };
  const window = new DesktopQuickEntryWindow(controller as unknown as AppController, { rendererEntry: entry, preloadEntry: "D:/app/preload/quick-entry.cjs", showSession: vi.fn() });
  const invoke = (name: string, ...args: unknown[]) => mocks.handlers.get(`quick-entry:${name}`)!(frame(), ...args);
  return { window, controller, invoke };
}

beforeEach(() => { vi.clearAllMocks(); mocks.handlers.clear(); mocks.windows.length = 0;
  mocks.readImage.mockReturnValue({ isEmpty: () => true }); mocks.readText.mockReturnValue("Clipboard private text");
  mocks.picker.mockResolvedValue({ canceled: true, filePaths: [] }); mocks.snip.mockResolvedValue(undefined);
  mocks.loadURL.mockReset().mockResolvedValue(undefined); mocks.messageBox.mockResolvedValue({ response: 0 });
});

describe("quick-entry sandbox and explicit capture", () => {
  it("trusts only the owning top frame at the exact entry URL", () => {
    const identity = { senderId: 32, expectedId: 32, processId: 11, mainProcessId: 11, routingId: 22, mainRoutingId: 22, url };
    expect(trustedQuickEntryFrame(identity, url)).toBe(true);
    for (const patch of [{ senderId: 99 }, { routingId: 88 }, { processId: 9 }, { url: `${url}?foreign=1` }, { url: "https://example.com" }]) expect(trustedQuickEntryFrame({ ...identity, ...patch }, url)).toBe(false);
  });
  it("opens a screenshot draft without touching the clipboard, starting capture or granting the main API", async () => {
    const { window, invoke } = fixture(); window.open("screenshot");
    const context = await invoke("context") as { intent: string };
    expect(context.intent).toBe("screenshot"); expect(mocks.snip).not.toHaveBeenCalled(); expect(mocks.readImage).not.toHaveBeenCalled(); expect(mocks.readText).not.toHaveBeenCalled();
    expect([...mocks.handlers.keys()].every(channel => channel.startsWith("quick-entry:"))).toBe(true);
    expect(mocks.windows[0].options.webPreferences).toMatchObject({ sandbox: true, nodeIntegration: false, contextIsolation: true, partition: "grok-quick-entry" });
    window.dispose(); expect(mocks.handlers.size).toBe(0);
  });
  it("imports clipboard text only from an explicit action and never submits it", async () => {
    const { window, invoke, controller } = fixture(); window.open();
    const { draftId } = await invoke("context") as { draftId: string };
    const result = await invoke("clipboard", draftId); expect(result).toMatchObject({ text: "Clipboard private text", attachments: [] });
    expect(mocks.readText).toHaveBeenCalledOnce(); expect(controller.listSessions).toHaveBeenCalledOnce();
    if (process.platform === "win32") { await invoke("snip", draftId); expect(mocks.snip).toHaveBeenCalledWith("ms-screenclip:"); }
    window.dispose();
  });
  it("keeps the draft when Escape cancels IME composition and closes on a later ordinary Escape", async () => {
    const { window, invoke } = fixture(); window.open();
    const { draftId } = await invoke("context") as { draftId: string };
    mocks.readImage.mockReturnValue({ isEmpty: () => false, getSize: () => ({ width: 10, height: 10 }), toPNG: () => Buffer.from("capture") });
    await invoke("clipboard", draftId);
    const input = mocks.windows[0].webContents.on.mock.calls.find(([name]: [string]) => name === "before-input-event")[1];
    const preventDefault = vi.fn();
    input({ preventDefault }, { type: "keyDown", key: "Escape", isComposing: true });
    input({ preventDefault }, { type: "keyUp", key: "Escape", isComposing: false });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(mocks.windows[0].isDestroyed()).toBe(false);
    expect(await invoke("context")).toMatchObject({ draftId, attachments: [{ name: "剪贴板截图.png" }] });
    input({ preventDefault }, { type: "keyDown", key: "Escape", isComposing: false });
    expect(preventDefault).toHaveBeenCalledOnce(); expect(mocks.windows[0].isDestroyed()).toBe(true);
    window.dispose();
  });
  it("discards a captured image when closed and rejects stale requests on a new draft", async () => {
    const { window, invoke } = fixture(); window.open();
    const { draftId } = await invoke("context") as { draftId: string };
    mocks.readImage.mockReturnValue({ isEmpty: () => false, getSize: () => ({ width: 100, height: 100 }), toPNG: () => Buffer.from("image") });
    expect(await invoke("clipboard", draftId)).toMatchObject({ text: "", attachments: [{ name: "剪贴板截图.png" }] });
    window.close(); window.open(); expect((await invoke("context") as { attachments: unknown[] }).attachments).toEqual([]);
    expect(() => invoke("clipboard", draftId)).toThrow("已关闭"); expect(() => invoke("clipboard", undefined)).toThrow("已关闭"); window.dispose();
  });
  it("rejects other windows and child frames before any privileged work", () => {
    const { window } = fixture(); window.open();
    const handler = mocks.handlers.get("quick-entry:clipboard")!;
    expect(() => handler({ ...frame(), sender: { id: 9 } }, "forged")).toThrow("不受信任");
    expect(() => handler({ ...frame(), senderFrame: { ...frame().senderFrame, routingId: 33 } }, "forged")).toThrow("不受信任");
    expect(mocks.readImage).not.toHaveBeenCalled(); window.dispose();
  });
  it("does not register canceled file selections with the controller", async () => {
    const { window, invoke, controller } = fixture(); window.open(); const { draftId } = await invoke("context") as { draftId: string };
    await invoke("files", draftId); expect(controller.attachmentsFromDroppedPaths).not.toHaveBeenCalled(); window.dispose();
  });
  it("leaves a reopened draft intact when the previous window load fails late", async () => {
    const { window, invoke } = fixture();
    let fail!: (reason: unknown) => void;
    mocks.loadURL.mockImplementationOnce(() => new Promise<void>((_, reject) => { fail = reject; }));
    window.open(); window.close(); window.open();
    const current = await invoke("context") as { draftId: string };
    fail(Error("old window load failed")); await Promise.resolve();
    expect(await invoke("context")).toMatchObject({ draftId: current.draftId });
    expect(mocks.windows[1].isDestroyed()).toBe(false); expect(mocks.messageBox).not.toHaveBeenCalled(); window.dispose();
  });
  it("rejects duplicate IPC sends and ignores a canceled creation after a new floater opens", async () => {
    const { window, invoke, controller } = fixture();
    let finish!: (value: { sessionId: string; cwd: string }) => void;
    const createSession = vi.fn(() => new Promise<{ sessionId: string; cwd: string }>(resolve => { finish = resolve; }));
    const openSession = vi.fn(), sendPrompt = vi.fn();
    Object.assign(controller, { createSession, openSession, sendPrompt, getDesktopActivity: vi.fn(async () => ({ sessions: [] })) });
    window.open(); const { draftId } = await invoke("context") as { draftId: string };
    const input = { draftId, cwd: "D:/project", sessionId: "", text: "Create once", attachmentIds: [] };
    const sending = invoke("send", input);
    await vi.waitFor(() => expect(createSession).toHaveBeenCalledOnce());
    await expect(invoke("send", input)).rejects.toThrow("重复发送");
    await invoke("cancel"); window.open(); const current = await invoke("context") as { draftId: string };
    finish({ sessionId: "created", cwd: "D:/worktrees/task" });
    await expect(sending).rejects.toThrow("已关闭");
    expect(await invoke("context")).toMatchObject({ draftId: current.draftId });
    expect(openSession).not.toHaveBeenCalled(); expect(sendPrompt).not.toHaveBeenCalled(); window.dispose();
  });
  it("keeps the floater and captured attachment when session creation fails", async () => {
    const { window, invoke, controller } = fixture();
    const createSession = vi.fn(async () => { throw Error("creation failed"); });
    Object.assign(controller, { createSession });
    window.open(); const { draftId } = await invoke("context") as { draftId: string };
    mocks.readImage.mockReturnValue({ isEmpty: () => false, getSize: () => ({ width: 100, height: 100 }), toPNG: () => Buffer.from("private capture") });
    const clipboard = await invoke("clipboard", draftId) as { attachments: Array<{ id: string }> };
    await expect(invoke("send", { draftId, cwd: "D:/project", sessionId: "", text: "Keep this", attachmentIds: clipboard.attachments.map(row => row.id) })).rejects.toThrow("creation failed");
    expect(await invoke("context")).toMatchObject({ draftId, attachments: clipboard.attachments });
    expect(mocks.windows[0].isDestroyed()).toBe(false); expect(mocks.messageBox).not.toHaveBeenCalled(); window.dispose();
  });
  it("retains a failed dispatch for the next floater without importing or resending automatically", async () => {
    const { window, invoke, controller } = fixture();
    const sendPrompt = vi.fn(async () => { throw Error("attachment preparation failed"); });
    Object.assign(controller, { listSessions: async () => [{ id: "session-1", cwd: "D:/project", title: "Task", status: "idle" }],
      getDesktopActivity: async () => ({ sessions: [] }), openSession: async () => ({ sessionId: "session-1", hydration: "ready" }), sendPrompt });
    window.open(); const { draftId } = await invoke("context") as { draftId: string };
    mocks.readImage.mockReturnValue({ isEmpty: () => false, getSize: () => ({ width: 100, height: 100 }), toPNG: () => Buffer.from("private capture") });
    const clipboard = await invoke("clipboard", draftId) as { attachments: Array<{ id: string }> };
    await invoke("send", { draftId, cwd: "D:/project", sessionId: "session-1", text: "Keep my text", attachmentIds: clipboard.attachments.map(row => row.id) });
    await Promise.resolve(); window.open();
    const restored = await invoke("context") as { recovery: { text: string }; attachments: unknown[] };
    expect(restored.recovery.text).toBe("Keep my text"); expect(restored.attachments).toHaveLength(1);
    expect(sendPrompt).toHaveBeenCalledOnce(); expect(mocks.readImage).toHaveBeenCalledOnce(); window.dispose();
  });
});
