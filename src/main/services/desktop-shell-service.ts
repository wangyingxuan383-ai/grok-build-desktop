import { Menu, Tray, dialog, globalShortcut, powerSaveBlocker, type BrowserWindow, type MenuItemConstructorOptions } from "electron";
import type { AppSettings } from "../../shared/types";
import type { DesktopActivitySnapshot } from "../../shared/desktop-activity";
import { productivitySettings } from "../../shared/productivity";
import type { AppController } from "../app-controller";
import { trayIcon, taskbarCountIcon } from "../tray-icon";
import { DesktopQuickEntryWindow } from "./desktop-quick-entry-window";
import { DesktopShellShortcuts } from "./desktop-shell-shortcuts";
import { DesktopTaskbarService, EMPTY_DESKTOP_ACTIVITY, desktopShellState } from "./desktop-shell-state";
import { DesktopPetController } from "./desktop-pet-controller";
import { dirname, join } from "node:path";

export class DesktopShellService {
  private tray?: Tray;
  private settings?: AppSettings;
  private activity: DesktopActivitySnapshot = EMPTY_DESKTOP_ACTIVITY;
  private readonly unsubscribers: Array<() => void> = [];
  private readonly quickEntry: DesktopQuickEntryWindow;
  private readonly pet:DesktopPetController;
  private readonly shortcuts: DesktopShellShortcuts;
  private readonly taskbar: DesktopTaskbarService;
  private disposed = false;
  private quietTimer?: NodeJS.Timeout;
  private settingsVersion = 0;
  private activityVersion = 0;
  private shortcutWarnings: string[] = [];

  constructor(private readonly controller: AppController, private readonly options: {
    getWindow(): BrowserWindow | undefined; showWindow(): void; quit(): void;
    rendererEntry: string; preloadEntry: string; developmentUrl?: string;
    onSettings(settings: AppSettings): void;
    petBuiltins:string;petUserRoot:string;
  }) {
    this.quickEntry = new DesktopQuickEntryWindow(controller, { rendererEntry: options.rendererEntry, preloadEntry: options.preloadEntry,
      developmentUrl: options.developmentUrl, showSession: target => this.navigate(target),screenshotVisibility:visible=>this.pet?.setSuppressed("screenshot",visible) });
    this.pet=new DesktopPetController(controller,{rendererEntry:join(dirname(options.rendererEntry),"../pet/index.html"),preloadEntry:join(dirname(options.preloadEntry),"pet.cjs"),developmentUrl:options.developmentUrl,builtins:options.petBuiltins,userRoot:options.petUserRoot,showMain:options.showWindow,command:command=>this.command(command),quickEntry:intent=>this.quickEntry.open(intent),changed:()=>this.refresh()});
    controller.setDesktopPetDelegate({list:()=>this.pet.assets.list(),command:(command,clip)=>this.pet.command(command,clip),import:async()=>{
      const result=await dialog.showOpenDialog({title:"导入桌宠形象",properties:["openFile"],filters:[{name:"透明图片或形象包",extensions:["png","webp","zip"]}]});
      return result.canceled||!result.filePaths[0]?null:this.pet.assets.import(result.filePaths[0]);
    }});
    this.shortcuts = new DesktopShellShortcuts(globalShortcut, intent => this.quickEntry.open(intent));
    const window = () => { const value = options.getWindow(); return value && !value.isDestroyed() ? value : undefined; };
    this.taskbar = new DesktopTaskbarService({
      progress: value => window()?.setProgressBar(value, value > 1 ? { mode: "indeterminate" } : { mode: "none" }),
      badge: count => window()?.setOverlayIcon(count ? taskbarCountIcon(count) : null, count ? `${count} 项等待处理` : ""),
      flash: enabled => window()?.flashFrame(enabled), focused: () => window()?.isFocused() ?? false,
      startPowerBlocker: () => powerSaveBlocker.start("prevent-app-suspension"), stopPowerBlocker: id => powerSaveBlocker.stop(id),
    });
    try {
      this.tray = new Tray(trayIcon());
      this.tray.on("double-click", options.showWindow);
      this.refresh();
    } catch { this.tray = undefined; }
    this.unsubscribers.push(controller.observeSettings(settings => { this.settingsVersion++; this.applySettings(settings); }));
    this.unsubscribers.push(controller.observeDesktopActivity(activity => { this.activityVersion++; this.applyActivity(activity); }));
  }

  async start(): Promise<void> {
    const settingsVersion = this.settingsVersion, activityVersion = this.activityVersion;
    const results = await Promise.allSettled([this.controller.getSettings(), this.controller.getDesktopActivity()]);
    if (this.disposed) return;
    const [settings, activity] = results;
    if (settings.status === "fulfilled" && this.settingsVersion === settingsVersion) this.applySettings(settings.value);
    if (activity.status === "fulfilled" && this.activityVersion === activityVersion) this.applyActivity(activity.value);
  }

  canHideToTray(): boolean { return !!this.tray && !this.tray.isDestroyed() && !this.disposed; }
  focus(): void { this.taskbar.focus(); }
  rendererReady(): void { this.broadcastActivity(); this.pet.rendererReady(); }
  petResponse(url:string):Promise<Response>{return this.pet.assets.response(url);}
  computerActive(active:boolean):void{this.pet.setSuppressed("computer",active);}
  prepareQuit(animate=true):Promise<void>{return this.pet.prepareQuit(animate);}

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.shortcuts.dispose(); this.quickEntry.dispose(); this.taskbar.dispose();this.pet.dispose();this.controller.setDesktopPetDelegate(undefined);
    if (this.tray && !this.tray.isDestroyed()) this.tray.destroy();
    this.tray = undefined;
  }

  private applySettings(settings: AppSettings): void {
    if (this.disposed) return;
    this.settings = settings;
    this.pet.applySettings(settings);
    this.shortcutWarnings = this.shortcuts.apply(settings.productivity);
    this.quickEntry.setWarnings(this.shortcutWarnings);
    this.options.onSettings(settings);
    if (this.quietTimer) clearTimeout(this.quietTimer);
    const remaining = Date.parse(settings.productivity?.quietUntil ?? "") - Date.now();
    // Only a quiet-period expiry needs a one-shot clock; phone state is live stream state.
    if (remaining > 0) this.quietTimer = setTimeout(() => {if(this.settings)this.pet.applySettings(this.settings);this.refresh();}, Math.min(remaining + 10, 2_147_483_647)).unref();
    this.refresh();
  }
  private applyActivity(activity: DesktopActivitySnapshot): void { if (!this.disposed) { this.activity = activity; this.pet.applyActivity(activity); this.broadcastActivity(); this.refresh(); } }
  private broadcastActivity(): void {
    if (this.disposed) return;
    const window = this.options.getWindow();
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send("grok:desktop-activity", this.activity);
  }

  private refresh(): void {
    if (this.disposed) return;
    const state = desktopShellState(this.activity, this.settings?.productivity);
    this.taskbar.update(this.activity, this.settings?.productivity);
    if (!this.tray || this.tray.isDestroyed()) return;
    this.tray.setImage(trayIcon(state.status));
    this.tray.setToolTip(`Grok Build Desktop · ${state.running} 项运行 · ${state.waiting} 项待处理 · ${state.phones} 台手机在线`);
    const sessions = [...this.activity.sessions].sort((a, b) => priority(a.status) - priority(b.status));
    const menu: MenuItemConstructorOptions[] = [
      { label: "打开 Grok Build Desktop", click: this.options.showWindow },
      { label: "提问…", click: () => this.quickEntry.open("ask") },
      { label: "桌面伴侣", submenu:this.pet.menu() },
      ...this.shortcutWarnings.map(label => ({ label, enabled: false })),
      { type: "separator" },
      { label: `收件箱${state.unread ? `（${state.unread} 条未读）` : ""}`, click: () => this.command("open-inbox") },
      { label: `运行 ${state.running} · 待处理 ${state.waiting} · 失败 ${state.errors}`, enabled: false },
      ...sessions.slice(0, 12).map(row => ({ label: `${row.status === "awaiting" ? "等你" : row.status === "running" ? "运行" : "失败"} · ${menuLabel(row.title)}${row.projectName ? ` · ${menuLabel(row.projectName)}` : ""}`,
        click: () => { void this.openSession(row.sessionId).catch(error => this.reportError(error)); } })),
      ...(sessions.length > 12 ? [{ label: "查看全部任务…", click: () => this.command("open-task-center") }] : []),
      { label: state.phones ? `手机连接：${state.phones} 台在线` : "手机连接：无在线设备", enabled: false },
      { type: "separator" },
      { label: state.quiet ? "恢复通知" : "勿扰一小时", type: "checkbox", checked: state.quiet, click: () => { void this.toggleQuiet().catch(error => this.reportError(error)); } },
      { label: "设置…", click: () => this.command("open-settings") },
      { type: "separator" },
      { label: "退出应用", click: this.options.quit },
    ];
    this.tray.setContextMenu(Menu.buildFromTemplate(menu));
  }

  private command(command: "open-inbox" | "open-task-center" | "open-settings" | "open-pet-settings"): void {
    this.options.showWindow();
    const window = this.options.getWindow();
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send("grok:menu-command", command);
  }
  private navigate(target: { cwd: string; sessionId: string }): void {
    this.options.showWindow();
    const window = this.options.getWindow();
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send("grok:navigate-session", target);
  }
  private async openSession(sessionId: string): Promise<void> {
    const settings = await this.controller.getSettings();
    const workspaces = await this.controller.discoverWorkspaces();
    const roots = [...new Set([settings.activeWorkspace, ...settings.recentWorkspaces, ...workspaces.map(row => row.cwd)].filter(Boolean))];
    for (const cwd of roots) {
      if (this.disposed) return;
      const rows = await this.controller.listSessions(cwd);
      const row = rows.find(row => row.id === sessionId && !row.archived);
      if (row) { this.navigate({ cwd: row.cwd, sessionId }); return; }
    }
    this.command("open-inbox");
  }
  private async toggleQuiet(): Promise<void> {
    const settings = await this.controller.getSettings();
    const current = productivitySettings(settings.productivity);
    await this.controller.updateSettings({ productivity: { ...current, quietUntil: desktopShellState(this.activity, current).quiet ? undefined : new Date(Date.now() + 3_600_000).toISOString() } });
  }
  private reportError(error: unknown): void {
    if (!this.disposed) void dialog.showMessageBox({ type: "error", title: "Grok Build Desktop", message: String(error instanceof Error ? error.message : error), buttons: ["知道了"] });
  }
}
function priority(status: string): number { return status === "awaiting" ? 0 : status === "error" ? 1 : 2; }
function menuLabel(value: string): string { return value.replace(/[\r\n\t]/g, " ").replace(/&/g, "&&").slice(0, 80); }
