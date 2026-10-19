import { BrowserWindow, clipboard, dialog, ipcMain, screen, shell, type IpcMainInvokeEvent } from "electron";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { AppController } from "../app-controller";
import { DesktopQuickEntryDraft, type QuickEntryRecovery } from "./desktop-quick-entry-draft";
import { inspectAttachmentPrivacy } from "./attachment-privacy-service";
import type { QuickEntryIntent, QuickEntrySubmission } from "../../renderer/quick-entry/contracts";

export interface QuickEntryFrameIdentity {
  senderId: number; expectedId: number; processId?: number; mainProcessId: number; routingId?: number; mainRoutingId: number; url: string;
}
/** Deliberately narrower than main renderer trust: one window, top frame and exact entry URL. */
export function trustedQuickEntryFrame(frame: QuickEntryFrameIdentity, entryUrl: string): boolean {
  return frame.senderId === frame.expectedId && frame.processId === frame.mainProcessId
    && frame.routingId === frame.mainRoutingId && frame.url === entryUrl;
}

export class DesktopQuickEntryWindow {
  private window?: BrowserWindow;
  private draft?: DesktopQuickEntryDraft;
  private disposed = false;
  private warnings: string[] = [];
  private readonly recoveries: QuickEntryRecovery[] = [];
  private readonly channels: string[] = [];
  private readonly url: string;
  constructor(private readonly controller: AppController, private readonly options: {
    rendererEntry: string; preloadEntry: string; developmentUrl?: string;
    showSession(target: { cwd: string; sessionId: string }): void;
  }) {
    this.url = options.developmentUrl ? new URL("quick-entry/index.html", options.developmentUrl).href : pathToFileURL(options.rendererEntry).href;
    this.handle("context", ([cwd]) => {
      if (cwd !== undefined && (typeof cwd !== "string" || cwd.length > 4096)) throw new Error("项目无效");
      return this.active().context(cwd as string | undefined, this.warnings);
    }, 0, 1);
    this.handle("files", async ([id]) => {
      const draft = this.active(id);
      const window = this.window!;
      const result = await dialog.showOpenDialog(window, { title: "添加文件或图片", properties: ["openFile", "multiSelections"] });
      draft.assertActive(id);
      if (result.canceled) return draft.add(id, []);
      if (result.filePaths.length > 20) throw new Error("每次最多添加 20 个附件");
      return draft.add(id, await this.controller.attachmentsFromDroppedPaths(result.filePaths));
    }, 1);
    this.handle("clipboard", ([id]) => {
      const draft = this.active(id);
      const image = clipboard.readImage();
      if (!image.isEmpty()) {
        const size = image.getSize();
        if (size.width > 16384 || size.height > 16384) throw new Error("剪贴板图片过大");
        const data = image.toPNG();
        if (data.length > 20 * 1024 * 1024) throw new Error("剪贴板图片超过 20 MiB");
        return { text: "", attachments: draft.add(id, [{ id: randomUUID(), name: "剪贴板截图.png", kind: "image", mimeType: "image/png", data: data.toString("base64"), size: data.length }]) };
      }
      const text = clipboard.readText();
      if (text.length > 100_000) throw new Error("剪贴板文字过长，请改用文件附件");
      return { text, attachments: draft.add(id, []) };
    }, 1);
    this.handle("snip", async ([id]) => {
      this.active(id);
      if (process.platform !== "win32") throw new Error("请使用系统截图工具，截图后点“引用剪贴板”");
      // Fixed OS URI; opening the floater or pressing its global shortcut never captures.
      await shell.openExternal("ms-screenclip:");
    }, 1);
    this.handle("remove", ([id, attachmentId]) => this.active(id).remove(id, attachmentId), 2);
    this.handle("send", ([input]) => this.active().send(input as QuickEntrySubmission), 1);
    this.handle("cancel", () => this.close(), 0);
  }

  setWarnings(warnings: string[]): void { this.warnings = [...warnings]; }

  open(intent: QuickEntryIntent = "ask"): void {
    if (this.disposed) return;
    if (this.window && !this.window.isDestroyed()) { this.window.show(); this.window.focus(); return; }
    const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const width = Math.min(560, workArea.width), height = Math.min(500, workArea.height);
    const window = new BrowserWindow({ width, height, x: Math.round(workArea.x + (workArea.width - width) / 2), y: Math.round(workArea.y + (workArea.height - height) / 3),
      minWidth: Math.min(420, width), minHeight: Math.min(360, height), show: false, resizable: true, maximizable: false, fullscreenable: false,
      title: "快速提问 · Grok Build Desktop", backgroundColor: "#121212", autoHideMenuBar: true,
      webPreferences: { preload: this.options.preloadEntry, nodeIntegration: false, contextIsolation: true, sandbox: true,
        partition: "grok-quick-entry", spellcheck: false, webviewTag: false, safeDialogs: true } });
    this.window = window;
    window.setMenu(null);
    this.draft = new DesktopQuickEntryDraft(this.controller, intent, target => { this.close(); this.options.showSession(target); },
      (error, recovery) => {
        if (this.disposed) return;
        this.recoveries.push(recovery);
        this.reportError(new Error(`${error instanceof Error ? error.message : String(error)}\n\n内容已保留，可从托盘重新打开快速提问。请先检查主窗口的发送状态，再决定是否重试。`));
      }, async (cwd, attachments) => {
        const findings = inspectAttachmentPrivacy(cwd, attachments);
        if (!findings.length) return true;
        if (window.isDestroyed()) return false;
        const result = await dialog.showMessageBox(window, { type: "warning", title: "确认发送附件", message: "这些附件可能包含敏感内容，确认发送到所选会话？",
          detail: findings.map(row => row.message).join("\n"), buttons: ["返回检查", "发送附件"], defaultId: 0, cancelId: 0 });
        return !window.isDestroyed() && result.response === 1;
      });
    const recovery = this.recoveries.shift();
    if (recovery) this.draft.restore(recovery);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => { if (url !== this.url) event.preventDefault(); });
    window.webContents.on("will-redirect", (event, url) => { if (url !== this.url) event.preventDefault(); });
    window.webContents.on("will-attach-webview", event => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.session.setPermissionCheckHandler(() => false);
    window.webContents.on("before-input-event", (event, input) => { if (input.type === "keyDown" && input.key === "Escape") { event.preventDefault(); this.close(); } });
    window.webContents.on("render-process-gone", () => this.close());
    window.once("ready-to-show", () => { if (!window.isDestroyed() && !this.disposed) { window.show(); window.focus(); } });
    window.on("closed", () => { if (this.window === window) { this.draft?.discard(); this.draft = undefined; this.window = undefined; } });
    void window.loadURL(this.url).catch(error => {
      if (this.window !== window) return;
      this.close(); this.reportError(error);
    });
  }

  close(): void {
    const window = this.window;
    this.draft?.discard(); this.draft = undefined; this.window = undefined;
    if (window && !window.isDestroyed()) window.destroy();
  }
  dispose(): void { this.disposed = true; this.close(); this.recoveries.length = 0; for (const channel of this.channels) ipcMain.removeHandler(channel); }

  private active(id?: unknown): DesktopQuickEntryDraft {
    if (this.disposed || !this.draft || !this.window || this.window.isDestroyed()) throw new Error("快速提问窗口已关闭");
    this.draft.assertActive(arguments.length ? id : this.draft.id);
    return this.draft;
  }
  private handle(name: string, action: (args: unknown[]) => unknown, min: number, max = min): void {
    const channel = `quick-entry:${name}`;
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const window = this.window;
      if (!window || window.isDestroyed() || !trustedQuickEntryFrame({ senderId: event.sender.id, expectedId: window.webContents.id,
        processId: event.senderFrame?.processId, routingId: event.senderFrame?.routingId,
        mainProcessId: window.webContents.mainFrame.processId, mainRoutingId: window.webContents.mainFrame.routingId,
        url: event.senderFrame?.url ?? "" }, this.url)) throw new Error("拒绝不受信任的快速提问请求");
      if (args.length < min || args.length > max) throw new Error("快速提问参数无效");
      return action(args);
    });
    this.channels.push(channel);
  }
  private reportError(error: unknown): void {
    if (this.disposed) return;
    void dialog.showMessageBox({ type: "error", title: "快速提问", message: error instanceof Error ? error.message : String(error), buttons: ["知道了"] });
  }
}
