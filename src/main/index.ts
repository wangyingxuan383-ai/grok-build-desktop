import { app, BrowserWindow, dialog, globalShortcut, nativeTheme, protocol, shell } from "electron";
import type { Event as ElectronEvent } from "electron";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AppController } from "./app-controller";
import { ComputerUseOverlay } from "./computer-use-overlay";
import { registerIpc } from "./ipc";
import { installApplicationMenu } from "./app-menu";
import { configureAutomationWorkerStorage } from "./automation-worker-storage";
import { isAllowedThemeBackgroundUrl } from "./services/theme-service";
import { createRendererTrustPolicy, isAllowedExternalUrl, isTrustedRendererUrl, trustedDevelopmentUrl } from "./security-policy";

let mainWindow: BrowserWindow | undefined;
let controller: AppController | undefined;
let computerOverlay: ComputerUseOverlay | undefined;
let quitting = false;
const currentDir = dirname(fileURLToPath(import.meta.url));

protocol.registerSchemesAsPrivileged([{ scheme: "grok-theme", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

app.setName("Grok Build Desktop");

const workerIndex = process.argv.indexOf("--scheduler-worker");
const schedulerProbeIndex = process.argv.indexOf("--scheduler-probe");
const schedulerUninstall = process.argv.includes("--scheduler-uninstall");
if (schedulerProbeIndex >= 0) {
  // Harmless, deterministic Task Scheduler acceptance hook. It is deliberately
  // restricted to a uniquely-prefixed marker inside Electron's temp directory,
  // so this command cannot be used as an arbitrary file-write primitive.
  const requestedMarker = process.argv[schedulerProbeIndex + 1] || "";
  app.whenReady().then(async () => {
    const tempRoot = resolve(app.getPath("temp"));
    const marker = resolve(requestedMarker);
    if (dirname(marker).toLowerCase() !== tempRoot.toLowerCase() || !basename(marker).startsWith("grok-build-desktop-scheduler-probe-")) {
      throw new Error("计划任务探针路径无效");
    }
    const { writeFile } = await import("node:fs/promises");
    await writeFile(marker, JSON.stringify({ ok: true, pid: process.pid, at: new Date().toISOString() }), { encoding: "utf8", flag: "wx" });
  }).catch((error) => process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)).finally(() => app.quit());
} else if (schedulerUninstall) {
  process.env.GROK_DESKTOP_SCHEDULER_UNINSTALL = "1";
  const canonicalUserData = join(app.getPath("appData"), "Grok Build Desktop");
  app.whenReady().then(async () => {
    controller = new AppController(canonicalUserData);
    await controller.unregisterAllAutomations();
  }).catch((error) => process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)).finally(async () => {
    await controller?.dispose().catch(() => undefined);
    app.quit();
  });
} else if (workerIndex >= 0) {
  process.env.GROK_DESKTOP_AUTOMATION_WORKER = "1";
  const taskId = process.argv[workerIndex + 1] || "";
  const runId = process.argv[workerIndex + 2] || "scheduled";
  const { canonicalUserData, workerSessionData } = configureAutomationWorkerStorage(app);
  app.whenReady().then(async () => {
    controller = new AppController(canonicalUserData);
    await controller.runAutomationWorker(taskId, runId);
  }).catch((error) => process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)).finally(async () => {
    await controller?.dispose().catch(() => undefined);
    const { rm } = await import("node:fs/promises");
    await rm(workerSessionData, { recursive: true, force: true }).catch(() => undefined);
    app.quit();
  });
} else if (!app.requestSingleInstanceLock()) app.quit();
else {
  const openTaskCenterOnReady = process.argv.includes("--open-task-center");
  app.on("second-instance", (_event, commandLine) => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    if (commandLine.includes("--open-task-center")) mainWindow.webContents.send("grok:menu-command", "open-task-center");
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId("io.github.grokbuilddesktop.community");
    controller = new AppController(app.getPath("userData"));
    const startupTheme = await controller.prepareAppearance();
    protocol.handle("grok-theme", async (request) => {
      if (!isAllowedThemeBackgroundUrl(request.url)) return new Response("Not found", { status: 404 });
      const background = await controller?.currentThemeBackground();
      if (!background) return new Response("Not found", { status: 404 });
      const { readFile } = await import("node:fs/promises");
      return new Response(await readFile(background.path), { headers: { "Content-Type": background.mimeType, "Cache-Control": "no-store" } });
    });
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
      backgroundColor: startupTheme.mode === "custom" ? startupTheme.colors.background : startupTheme.mode === "light" || (startupTheme.mode === "system" && !nativeTheme.shouldUseDarkColors) ? "#f6f7f9" : "#0f1115",
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
    installApplicationMenu(mainWindow, !app.isPackaged);
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedExternalUrl(url)) void shell.openExternal(url).catch(() => undefined);
      return { action: "deny" };
    });
    let showingStartupError = false;
    const loadRenderer = async (): Promise<void> => {
      showingStartupError = false;
      if (developmentUrl) await mainWindow!.loadURL(developmentUrl);
      else await mainWindow!.loadFile(rendererEntry);
    };
    const showStartupError = async (description: string): Promise<void> => {
      showingStartupError = true;
      const safeDescription = escapeHtml(description);
      const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Grok Build Desktop 启动失败</title><style>html,body{height:100%;margin:0;background:#0f1115;color:#e7e9ec;font-family:"Segoe UI","Microsoft YaHei UI",sans-serif}body{display:grid;place-items:center}.card{width:min(680px,calc(100% - 48px));padding:28px;border:1px solid #3a424b;border-radius:16px;background:#171a1f;box-shadow:0 24px 80px #0009}h1{font-size:22px}p{color:#aeb6bf;line-height:1.6}code{display:block;padding:12px;border-radius:8px;background:#090b0e;overflow-wrap:anywhere}.actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:20px}a{padding:9px 13px;border:1px solid #3a424b;border-radius:8px;color:#e7e9ec;text-decoration:none;background:#22272e}a.primary{background:#247cae;border-color:#318fbd}</style><body><section class="card"><h1>界面未能正常启动</h1><p>应用没有继续停留在黑屏。你可以重新加载、恢复默认窗口状态或导出脱敏诊断。</p><code>${safeDescription}</code><div class="actions"><a class="primary" href="grok-action://reload">重新加载界面</a><a href="grok-action://reset-window">恢复默认窗口状态</a><a href="grok-action://open-logs">打开日志目录</a><a href="grok-action://export-support">导出诊断</a></div></section></body></html>`;
      await mainWindow?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
      mainWindow?.show();
    };
    const guardNavigation = (event: ElectronEvent, url: string): void => {
      if (url.startsWith("grok-action://")) {
        event.preventDefault();
        const action = new URL(url).hostname;
        if (action === "reload") void loadRenderer().catch((error) => showStartupError(String(error)));
        else if (action === "reset-window") { mainWindow?.setSize(1280, 800); mainWindow?.center(); void loadRenderer().catch((error) => showStartupError(String(error))); }
        else if (action === "open-logs") void shell.openPath(join(app.getPath("userData"), "logs"));
        else if (action === "export-support") void controller?.exportSupportBundle();
        return;
      }
      if (showingStartupError && url.startsWith("data:text/html")) return;
      if (!isTrustedRendererUrl(url, rendererTrust)) event.preventDefault();
    };
    mainWindow.webContents.on("will-navigate", guardNavigation);
    mainWindow.webContents.on("will-redirect", guardNavigation);
    mainWindow.webContents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3 && !showingStartupError) void showStartupError(`${description}（错误码 ${code}）`);
    });
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
    await loadRenderer().catch((error) => showStartupError(error instanceof Error ? error.message : String(error)));
    if (openTaskCenterOnReady && !showingStartupError) {
      setTimeout(() => mainWindow?.webContents.send("grok:menu-command", "open-task-center"), 500);
    }
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
}
