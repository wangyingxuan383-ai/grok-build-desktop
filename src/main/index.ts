import { app, BrowserWindow, dialog, globalShortcut, shell } from "electron";
import type { Event as ElectronEvent } from "electron";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AppController } from "./app-controller";
import { ComputerUseOverlay } from "./computer-use-overlay";
import { registerIpc } from "./ipc";
import { createRendererTrustPolicy, isAllowedExternalUrl, isTrustedRendererUrl, trustedDevelopmentUrl } from "./security-policy";

let mainWindow: BrowserWindow | undefined;
let controller: AppController | undefined;
let computerOverlay: ComputerUseOverlay | undefined;
let quitting = false;
const currentDir = dirname(fileURLToPath(import.meta.url));

app.setName("Grok Build Desktop");

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId("io.github.grokbuilddesktop.community");
    controller = new AppController(app.getPath("userData"));
    computerOverlay = new ComputerUseOverlay((source) => controller?.emergencyStopComputer(source));
    controller.setComputerStateObserver((state) => computerOverlay?.update(state));
    globalShortcut.register("CommandOrControl+Alt+Esc", () => controller?.emergencyStopComputer("Ctrl+Alt+Esc"));
    const rendererEntry = join(currentDir, "../renderer/index.html");
    const developmentUrl = trustedDevelopmentUrl(process.env.ELECTRON_RENDERER_URL, app.isPackaged);
    const rendererTrust = createRendererTrustPolicy(rendererEntry, developmentUrl);
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 920,
      minWidth: 820,
      minHeight: 620,
      show: false,
      backgroundColor: "#0f1115",
      title: "Grok Build Desktop",
      webPreferences: {
        preload: join(currentDir, "../preload/index.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    controller.setWindow(mainWindow);
    registerIpc(controller, mainWindow, rendererTrust);
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedExternalUrl(url)) void shell.openExternal(url).catch(() => undefined);
      return { action: "deny" };
    });
    const guardNavigation = (event: ElectronEvent, url: string): void => {
      if (!isTrustedRendererUrl(url, rendererTrust)) event.preventDefault();
    };
    mainWindow.webContents.on("will-navigate", guardNavigation);
    mainWindow.webContents.on("will-redirect", guardNavigation);
    mainWindow.on("close", (event) => {
      if (quitting || !controller?.hasWorking()) return;
      const answer = dialog.showMessageBoxSync(mainWindow!, {
        type: "warning",
        title: "仍有任务运行",
        message: "关闭应用会停止所有正在运行或等待确认的 Grok 会话。",
        buttons: ["继续使用", "停止任务并退出"],
        defaultId: 0,
        cancelId: 0,
      });
      if (answer === 0) {
        event.preventDefault();
        mainWindow?.focus();
        mainWindow?.webContents.focus();
      }
    });
    mainWindow.once("ready-to-show", () => mainWindow?.show());
    if (developmentUrl) await mainWindow.loadURL(developmentUrl);
    else await mainWindow.loadFile(rendererEntry);
  });

  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    computerOverlay?.dispose();
    computerOverlay = undefined;
    globalShortcut.unregisterAll();
    void controller?.dispose().finally(() => app.quit());
  });
}
