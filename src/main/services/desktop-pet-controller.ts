import { BrowserWindow, Menu, globalShortcut, ipcMain, nativeTheme, powerMonitor, screen, session, systemPreferences, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from "electron";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import type { AppController } from "../app-controller";
import type { AppSettings, NotificationInboxItem } from "../../shared/types";
import type { DesktopActivitySnapshot } from "../../shared/desktop-activity";
import { desktopPetSettings, PET_CLIPS, type DesktopPetSettings, type PetAction, type PetClipId, type PetSkin, type PetSnapshot } from "../../shared/desktop-pet";
import { notificationsQuiet } from "../../shared/productivity";
import { normalizeAccelerator, validateShortcutBindings } from "../../shared/shortcuts";
import { DesktopPetEnvironment, type DesktopPetEnvironmentValue } from "./desktop-pet-environment";
import { DesktopPetAssets } from "./desktop-pet-assets";
import { PetIntent, inboxTarget, petActivity, petPosition, petTargets, petWindowBounds } from "./desktop-pet-model";
import { trustedQuickEntryFrame } from "./desktop-quick-entry-window";
const EMPTY: DesktopActivitySnapshot = { sessions: [], runningCount: 0, awaitingCount: 0, errorCount: 0, inboxUnreadCount: 0, livePhoneCount: 0 };
export interface PetControllerOptions {
    rendererEntry: string;
    preloadEntry: string;
    developmentUrl?: string;
    builtins: string;
    userRoot: string;
    showMain(): void;
    command(command: "open-inbox" | "open-settings" | "open-pet-settings"): void;
    quickEntry(intent: "ask" | "screenshot"): void;
    changed(): void;
}
/** Owns one optional window. This service never starts, resumes or controls a CLI. */
export class DesktopPetController {
    readonly assets: DesktopPetAssets;
    readonly intent = new PetIntent();
    private window?: BrowserWindow;
    private settings: DesktopPetSettings = desktopPetSettings();
    private appSettings?: AppSettings;
    private activity: DesktopActivitySnapshot = EMPTY;
    private inbox: NotificationInboxItem[] = [];
    private skin?: PetSkin;
    private clip: PetClipId = "idle";
    private visibility: PetSnapshot["visibility"] = "hidden";
    private transition = 0;
    private revision = 0;
    private navigationVersion = 0;
    private disposed = false;
    private ready = false;
    private loadedWindow = false;
    private initializing?: Promise<void>;
    private retireDone?: () => void;
    private actionTimer?: NodeJS.Timeout;
    private settling = false;
    private drag?: {
        cursor: Electron.Point;
        bounds: Electron.Rectangle;
    };
    private dragTimer?: NodeJS.Timeout;
    private landingTimer?: NodeJS.Timeout;
    private motionVersion = 0;
    private lastWake = 0;
    private asleep = false;
    private crashCount = 0;
    private warning?: string;
    private shortcut = "";
    private startup = true;
    private protocolReady?: Promise<void>;
    private seen = new Set<string>();
    private startedAt = Date.now();
    private inboxVersion = 0;
    private inboxFlight?: Promise<void>;
    private readonly cleanups: Array<() => void> = [];
    private readonly environment: DesktopPetEnvironment;
    private readonly url: string;
    constructor(private readonly controller: AppController, private readonly options: PetControllerOptions) {
        this.assets = new DesktopPetAssets(options.builtins, options.userRoot, join(dirname(options.preloadEntry), "../main/pet-import-worker.js"));
        this.url = options.developmentUrl ? new URL("pet/index.html", options.developmentUrl).href : pathToFileURL(options.rendererEntry).href;
        this.environment = new DesktopPetEnvironment(controller.desktopContextHelperPath, value => this.context(value));
        this.intent.setBlocker("context", true);
        this.handle("pet:snapshot", () => this.snapshot());
        this.handle("pet:action", (...args) => { if (args.length !== 1)
            throw Error("桌宠参数无效"); return this.action(args[0]); });
        this.cleanups.push(controller.observeDesktopInbox(items => this.receiveInbox(items)));
        const block = (name: string, active: boolean) => this.block(name, active);
        const lock = () => { block("lock", true); this.environment.stop(); };
        const unlock = () => { this.intent.setBlocker("context", true); block("lock", false); this.updateEnvironment(); };
        powerMonitor.on("lock-screen", lock);
        powerMonitor.on("suspend", lock);
        powerMonitor.on("unlock-screen", unlock);
        powerMonitor.on("resume", unlock);
        this.cleanups.push(() => { powerMonitor.removeListener("lock-screen", lock); powerMonitor.removeListener("suspend", lock); powerMonitor.removeListener("unlock-screen", unlock); powerMonitor.removeListener("resume", unlock); });
        const display = () => { this.reposition(); this.intent.setBlocker("context", true); this.updateEnvironment(true); };
        screen.on("display-added", display);
        screen.on("display-removed", display);
        screen.on("display-metrics-changed", display);
        this.cleanups.push(() => { screen.removeListener("display-added", display); screen.removeListener("display-removed", display); screen.removeListener("display-metrics-changed", display); });
        const theme = () => this.publish();
        nativeTheme.on("updated", theme);
        this.cleanups.push(() => nativeTheme.removeListener("updated", theme));
    }
    rendererReady(): void { if (this.ready || this.disposed)
        return; this.ready = true; void this.refreshInbox(); this.updateEnvironment(); }
    applySettings(settings: AppSettings): void {
        if (this.disposed)
            return;
        const old = this.settings;
        this.appSettings = settings;
        this.settings = desktopPetSettings(settings.desktopPet);
        if (old.enabled !== this.settings.enabled || old.skinId !== this.settings.skinId || old.compatibility !== this.settings.compatibility || old.size !== this.settings.size || old.customScale !== this.settings.customScale || old.locked !== this.settings.locked) {
            this.stopDrag();
            this.restore();
        }
        this.intent.enabled = this.settings.enabled;
        if (this.settings.enabled && !old.enabled) {
            this.intent.manuallyHidden = false;
            this.intent.setBlocker("context", true);
            this.startup = true;
        }
        const changed = old.enabled !== this.settings.enabled || old.skinId !== this.settings.skinId || old.compatibility !== this.settings.compatibility;
        this.bindShortcut();
        if (changed) {
            this.intent.change();
            if (old.skinId !== this.settings.skinId || old.compatibility !== this.settings.compatibility) {
                this.destroy();
            }
        }
        if (!this.settings.enabled) {
            void this.retire(true);
            this.environment.stop();
        }
        else {
            this.updateEnvironment();
            if (changed)
                void this.reconcile(old.enabled === false);
            else if (old.size !== this.settings.size || old.customScale !== this.settings.customScale)
                this.reposition();
        }
        if ((this.settling && this.reduced) || (this.quiet || !this.settings.idleActions || this.settings.mode === "status" || this.settings.reduceMotion) && ["success", "sleepy", "wave", "enter"].includes(this.clip))
            this.restore();
        this.publish();
        this.options.changed();
    }
    applyActivity(activity: DesktopActivitySnapshot): void { this.activity = activity; if (["waiting", "error"].includes(this.baseClip()))
        this.restore();
    else if (["idle", "working", "waiting", "error"].includes(this.clip))
        this.restore(); void this.refreshInbox(); this.publish(); }
    get enabled(): boolean { return this.settings.enabled; }
    get hidden(): boolean { return this.intent.manuallyHidden; }
    get statusWarning(): string | undefined { return this.warning; }
    private get quiet(): boolean { return notificationsQuiet(this.appSettings?.productivity); }
    private get palette(): PetSnapshot["colors"] { const c = this.appSettings?.theme.mode === "custom" ? this.appSettings.theme.colors : undefined; return c ? { surface: c.surface, text: c.text, muted: c.muted, accent: c.accent, border: c.border } : undefined; }
    private get reduced(): boolean { return this.settings.reduceMotion || this.settings.mode === "status" || systemPreferences.getAnimationSettings().prefersReducedMotion || this.quiet; }
    async command(command: "show" | "hide" | "reset" | "preview", clip?: PetClipId): Promise<void> {
        if (this.disposed)
            return;
        if (command === "hide") {
            this.intent.manuallyHidden = true;
            this.intent.change();
            this.environment.stop();
            await this.retire(true);
        }
        else if (command === "show") {
            if (!this.settings.enabled) {
                await this.update({ enabled: true });
                return;
            }
            this.intent.manuallyHidden = false;
            this.intent.change();
            this.warning = undefined;
            this.intent.setBlocker("context", true);
            this.updateEnvironment(true);
            this.startup = true;
        }
        else if (command === "reset") {
            this.stopDrag();
            this.restore();
            const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
            await this.update({ position: { displayId: display.id, x: 1, y: 1 } });
            this.reposition();
            if (this.window && !this.window.isDestroyed())
                this.window.setIgnoreMouseEvents(true, { forward: true });
        }
        else if (clip && PET_CLIPS.includes(clip)) {
            // Preview requests use the settings card only, never replace live priority state.
            return;
        }
        this.options.changed();
    }
    setSuppressed(reason: string, active: boolean): void {
        const probePauses=["computer","screenshot"].includes(reason);
        if(probePauses&&!active)this.intent.setBlocker("context",true);
        this.block(reason,active);
        if(probePauses)this.updateEnvironment();
    }
    async prepareQuit(animate = true): Promise<void> { this.intent.manuallyHidden = true; this.intent.change(); this.environment.stop(); await this.retire(animate); }
    dispose(): void {
        if (this.disposed)
            return;
        this.disposed = true;
        this.intent.change();
        this.environment.dispose();
        this.destroy();
        this.clearAction();
        for (const cleanup of this.cleanups.splice(0))
            cleanup();
        for (const channel of ["pet:snapshot", "pet:action"])
            ipcMain.removeHandler(channel);
        if (this.shortcut)
            globalShortcut.unregister(this.shortcut);
    }
    menu(): MenuItemConstructorOptions[] {
        return [
            { label: this.enabled ? (this.hidden ? "显示桌宠" : "暂时隐藏桌宠") : "开启桌宠", click: () => void this.command(this.enabled && !this.hidden ? "hide" : "show").catch(() => undefined) },
            ...this.warning ? [{ label: this.warning, enabled: false }] : [],
            { label: "切换形象", submenu: [{ label: "A · 原创插画", type: "radio", checked: this.settings.skinId === "a", click: () => void this.update({ skinId: "a" }) }, { label: "B · 圆润 Q 版", type: "radio", checked: this.settings.skinId === "b", click: () => void this.update({ skinId: "b" }) }] },
            { label: "仅状态", type: "checkbox", checked: this.settings.mode === "status", click: () => void this.update({ mode: this.settings.mode === "status" ? "companion" : "status" }) },
            { label: "锁定位置", type: "checkbox", checked: this.settings.locked, click: () => void this.update({ locked: !this.settings.locked }) },
            { label: "落到底部", enabled: this.canDropToBottom(), click: () => this.dropToBottom() },
            { label: "重置位置与交互", click: () => void this.command("reset") },
            { label: "桌宠设置…", click: () => this.options.command("open-pet-settings") },
            { label: "关闭桌宠", enabled: this.enabled, click: () => void this.update({ enabled: false }) },
        ];
    }
    private update(patch: Partial<DesktopPetSettings>): Promise<AppSettings> { return this.controller.updateDesktopPetSettings(patch); }
    private bindShortcut(): void {
        let next = "";
        try {
            next = normalizeAccelerator(this.settings.shortcut);
            if (next)
                validateShortcutBindings(this.appSettings?.productivity ?? {}, [{ label: "桌宠", value: next }]);
        }
        catch {
            next = "";
            this.warning = "桌宠快捷键与已有按键冲突";
        }
        if (next === this.shortcut)
            return;
        if (this.shortcut)
            globalShortcut.unregister(this.shortcut);
        this.shortcut = "";
        if (next) {
            try {
                if (globalShortcut.register(next, () => { if (!this.enabled)
                    this.options.command("open-pet-settings");
                else
                    void this.command(this.hidden ? "show" : "hide"); }))
                    this.shortcut = next;
                else
                    this.warning = "桌宠快捷键已被占用，仍可从托盘操作";
            }
            catch {
                this.warning = "桌宠快捷键无法注册";
            }
        }
    }
    private updateEnvironment(restart = false): void {
        if (this.disposed || !this.ready || !this.enabled || this.intent.manuallyHidden || this.intent.blockers.has("lock") || this.intent.blockers.has("computer") || this.intent.blockers.has("screenshot")) {
            this.environment.stop();
            return;
        }
        if (restart)
            this.environment.stop();
        this.environment.start();
    }
    private context(value: DesktopPetEnvironmentValue): void {
        if (this.disposed)
            return;
        const previousWarning = this.warning;
        const display = this.display();
        const rect = value.foregroundRect ? screen.screenToDipRect(null, { ...value.foregroundRect }) : undefined;
        const covering = !!rect && rect.x < display.bounds.x + display.bounds.width && rect.x + rect.width > display.bounds.x && rect.y < display.bounds.y + display.bounds.height && rect.y + rect.height > display.bounds.y;
        const blocked = value.locked || value.presentation || value.fullScreen && covering;
        if (blocked)
            this.startup = false;
        this.block("context", blocked);
        if (value.locked) {
            this.warning = "桌面环境暂不可用，可从托盘重试显示";
            this.environment.stop();
        }
        else if (this.warning?.startsWith("桌面环境"))
            this.warning = undefined;
        if (this.warning !== previousWarning)
            this.options.changed();
        if (!this.intent.visible)
            return;
        const idle = powerMonitor.getSystemIdleTime();
        if (this.window && this.visibility === "visible" && this.settings.idleActions && !this.reduced && this.baseClip() === "idle" && idle >= 300 && !this.asleep) {
            this.asleep = true;
            this.play("sleepy");
        }
        else if (this.asleep && (idle < 3 || this.baseClip() !== "idle")) {
            this.asleep = false;
            if (this.baseClip() === "idle" && Date.now() - this.lastWake > 600000 && !this.reduced) {
                this.lastWake = Date.now();
                this.play("wave", 1500);
            }
            else
                this.restore();
        }
        if (this.drag && !value.leftButtonDown)
            this.endDrag();
        const w = this.window;
        if (w && !w.isDestroyed() && !this.drag) {
            const p = screen.getCursorScreenPoint(), b = w.getBounds();
            if (p.x < b.x || p.x > b.x + b.width || p.y < b.y || p.y > b.y + b.height)
                w.setIgnoreMouseEvents(true, { forward: true });
        }
    }
    private block(reason: string, active: boolean): void {
        if (!this.intent.setBlocker(reason, active))
            return;
        if (active) {
            this.startup = false;
            this.destroy();
            this.restore();
        }
        else
            void this.reconcile(false);
        this.options.changed();
    }
    private async reconcile(entrance: boolean): Promise<void> {
        if (!this.ready || !this.intent.visible || this.disposed)
            return;
        if (this.window && !this.window.isDestroyed()) {
            if (this.visibility === "exiting") {
                this.destroy();
            }
            else {
                return;
            }
        }
        const version = this.intent.version;
        if (this.initializing)
            return;
        this.initializing = (async () => {
            let skin: PetSkin;
            try {
                skin = await this.assets.load(this.settings.skinId);
            }
            catch {
                skin = this.skin ?? await this.assets.load("b");
                this.warning = this.skin ? "所选形象不可用，继续使用原形象" : "所选形象不可用，暂用内置形象";
            }
            const partition = session.fromPartition("grok-pet");
            await (this.protocolReady ??= (async () => { if (!await partition.protocol.isProtocolHandled("grok-pet"))
                partition.protocol.handle("grok-pet", req => this.assets.response(req.url)); })());
            if (!this.intent.current(version) || !this.intent.visible || this.disposed)
                return;
            this.skin = skin;
            this.createWindow(entrance || this.startup);
            this.startup = false;
        })().catch(() => { this.warning = "桌宠素材加载失败，请检查设置"; this.options.changed(); }).finally(() => { this.initializing = undefined; if (this.intent.visible && !this.window && !this.disposed && this.intent.version !== version)
            void this.reconcile(false); });
        await this.initializing;
    }
    private createWindow(entrance: boolean): void {
        this.visibility = entrance && !["waiting", "error"].includes(this.baseClip()) ? "entering" : "visible";
        this.clip = this.visibility === "entering" ? "enter" : this.baseClip();
        this.transition++;
        const partition = session.fromPartition("grok-pet");
        partition.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
        partition.setPermissionCheckHandler(() => false);
        const window = new BrowserWindow({ ...this.bounds(), transparent: !this.settings.compatibility, backgroundColor: this.settings.compatibility ? "#181b22" : "#00000000", frame: false, show: false, focusable: false, skipTaskbar: true, resizable: false, maximizable: false, minimizable: false, fullscreenable: false, hasShadow: false, type: "toolbar", webPreferences: { preload: this.options.preloadEntry, nodeIntegration: false, contextIsolation: true, sandbox: true, partition: "grok-pet", spellcheck: false, webviewTag: false } });
        this.window = window;
        this.loadedWindow = false;
        window.setMenu(null);
        window.setAlwaysOnTop(true, "floating");
        window.setIgnoreMouseEvents(true, { forward: true });
        window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        window.webContents.on("will-navigate", (e, url) => { if (url !== this.url)
            e.preventDefault(); });
        window.webContents.on("will-redirect", (e, url) => { if (url !== this.url)
            e.preventDefault(); });
        window.webContents.on("will-attach-webview", e => e.preventDefault());
        window.webContents.once("did-finish-load", () => { if (this.window === window && this.intent.visible) {
            this.loadedWindow = true;
            this.publish();
        } });
        window.webContents.on("render-process-gone", () => { if (this.window !== window)
            return; this.destroy(); if (++this.crashCount <= 1 && this.intent.visible)
            void this.reconcile(false);
        else {
            this.intent.manuallyHidden = true;
            this.warning = "桌宠已暂停，可从托盘重试显示";
            this.environment.stop();
            this.options.changed();
        } });
        window.on("closed", () => { if (this.window === window) {
            this.window = undefined;
            this.visibility = "hidden";
        } });
        void window.loadURL(this.url).catch(() => { if (this.window === window) {
            this.destroy();
            this.warning = "桌宠界面未能加载";
            this.options.changed();
        } });
    }
    private display(): Electron.Display { return this.settings.position ? (screen.getAllDisplays().find(d => d.id === this.settings.position!.displayId) ?? screen.getPrimaryDisplay()) : this.window && !this.window.isDestroyed() ? screen.getDisplayMatching(this.window.getBounds()) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()); }
    private bounds(): Electron.Rectangle { const display = this.settings.position ? this.display() : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()); return petWindowBounds(display.workArea, Math.round(this.settings.size * (["a", "b"].includes(this.settings.skinId) ? 1 : this.settings.customScale)), this.settings.position); }
    private reposition(): void { this.stopDrag(); if (this.window && !this.window.isDestroyed()) {
        this.window.setBounds(this.bounds());
        this.publish();
    } }
    private async retire(animate: boolean): Promise<void> {
        const window = this.window;
        if (!window || window.isDestroyed()) {
            this.destroy();
            return;
        }
        const version = this.intent.version;
        this.clearAction();
        this.stopDrag();
        this.retireDone?.();
        if (animate && window.isVisible()) {
            this.visibility = "exiting";
            this.clip = "exit";
            this.transition++;
            window.setIgnoreMouseEvents(true, { forward: true });
            this.publish();
            await new Promise<void>(done => { const timer = setTimeout(done, 1000); this.retireDone = () => { clearTimeout(timer); done(); }; });
        }
        if (this.intent.current(version) || !this.intent.enabled || this.disposed)
            this.destroy();
    }
    private destroy(): void { this.retireDone?.(); this.retireDone = undefined; this.clearAction(); this.stopDrag(); this.asleep = false; const w = this.window; this.window = undefined; this.visibility = "hidden"; this.loadedWindow = false; if (w && !w.isDestroyed())
        w.destroy(); }
    private baseClip(): PetClipId { return petActivity(petTargets(this.activity, this.inbox)); }
    private clearAction(): void { if (this.actionTimer)
        clearTimeout(this.actionTimer); this.actionTimer = undefined; this.settling = false; }
    private restore(): void { if (this.visibility === "exiting" || this.drag || this.landingTimer)
        return; const base = this.baseClip(); if (this.visibility === "visible" && this.clip === base) {
        this.publish();
        return;
    } this.clearAction(); this.clip = base; if (this.visibility === "entering")
        this.visibility = "visible"; this.transition++; this.publish(); }
    private play(clip: PetClipId, timeout?: number): void { if (!this.intent.visible || !this.window || this.visibility === "exiting" || this.drag || this.landingTimer)
        return; this.clearAction(); this.visibility = "visible"; this.clip = clip; this.transition++; this.publish(); if (timeout)
        this.setActionTimeout(timeout); }
    private setActionTimeout(ms: number): void { this.clearAction(); const transition = this.transition; this.actionTimer = setTimeout(() => { if (this.transition === transition)
        this.restore(); }, ms); }
    private snapshot(): PetSnapshot {
        if (!this.skin)
            throw Error("桌宠未准备好");
        return { revision: ++this.revision, transition: this.transition, visibility: this.visibility, clip: this.clip, settings: this.settings, skin: this.skin, reducedMotion: this.reduced, quiet: this.quiet, targets: petTargets(this.activity, this.inbox), unread: this.activity.inboxUnreadCount, phones: this.activity.livePhoneCount, running: petTargets(this.activity,this.inbox).filter(row=>row.status==="running").length, awaiting: petTargets(this.activity,this.inbox).filter(row=>row.status==="awaiting").length, colors: this.palette, theme: this.appSettings?.theme.mode === "light" || this.appSettings?.theme.mode === "custom" && this.appSettings.theme.customBase === "light" || this.appSettings?.theme.mode === "system" && !nativeTheme.shouldUseDarkColors ? "light" : "dark", warning: this.warning, doubleClickTime: this.environment.doubleClickTime ?? 500, gesture: this.drag ? "dragging" : this.landingTimer ? "landing" : this.settling ? "settling" : undefined };
    }
    private publish(): void { if (this.loadedWindow && this.window && !this.window.isDestroyed() && !this.window.webContents.isDestroyed() && this.skin)
        this.window.webContents.send("pet:changed", this.snapshot()); }
    private receiveInbox(items: NotificationInboxItem[]): void {
        for (const row of items) {
            if (this.seen.has(row.id))
                continue;
            this.seen.add(row.id);
            if (row.kind === "completion" && !row.read && Date.parse(row.createdAt) >= this.startedAt && inboxTarget(row) && !this.controller.isDesktopTargetVisible(inboxTarget(row)!.id) && !this.reduced && this.baseClip() !== "waiting" && this.baseClip() !== "error")
                this.play("success", 2100);
        }
        if (this.seen.size > 1500)
            this.seen = new Set(items.map(row => row.id));
        void this.refreshInbox();
    }
    private refreshInbox(): Promise<void> {
        ++this.inboxVersion;
        if (this.inboxFlight)
            return this.inboxFlight;
        this.inboxFlight = (async () => { let version: number; do {
            version = this.inboxVersion;
            const items = await this.controller.listInbox();
            if (this.disposed)
                return;
            this.inbox = items;
            if (["waiting", "error", "idle", "working"].includes(this.clip) || ["waiting", "error"].includes(this.baseClip()))
                this.restore();
            this.publish();
        } while (version !== this.inboxVersion); })().catch(() => undefined).finally(() => { this.inboxFlight = undefined; });
        return this.inboxFlight;
    }
    private handle(channel: string, callback: (...args: unknown[]) => unknown): void {
        ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => { const w = this.window; if (!w || w.isDestroyed() || !trustedQuickEntryFrame({ senderId: event.sender.id, expectedId: w.webContents.id, processId: event.senderFrame?.processId, mainProcessId: w.webContents.mainFrame.processId, routingId: event.senderFrame?.routingId, mainRoutingId: w.webContents.mainFrame.routingId, url: event.senderFrame?.url ?? "" }, this.url))
            throw Error("拒绝不受信任的桌宠请求"); return callback(...args); });
    }
    private async action(raw: unknown): Promise<void> {
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
            throw Error("桌宠操作无效");
        const a = raw as PetAction;
        if (a.type === "animation-end") {
            if (a.transition !== this.transition || a.clip !== this.clip || this.drag || this.landingTimer)
                return;
            if (this.visibility === "exiting")
                this.retireDone?.();
            else if (this.clip !== "error")
                this.restore();
            return;
        }
        if (this.visibility === "exiting" || !this.intent.visible)
            return;
        switch (a.type) {
            case "ready":
                this.transition++;
                this.publish();
                this.window?.showInactive();
                this.window?.setIgnoreMouseEvents(true, { forward: true });
                if (this.visibility === "entering")
                    this.setActionTimeout(1100);
                if (!this.settings.position && this.window) {
                    const d = this.display();
                    void this.update({ position: petPosition(this.window.getBounds(), d.workArea, d.id) }).catch(() => undefined);
                }
                break;
            case "hit":
                if (typeof a.interactive !== "boolean")
                    throw Error("命中参数无效");
                if (!this.drag)
                    this.window?.setIgnoreMouseEvents(!a.interactive, { forward: true });
                break;
            case "toolbar":
                if (typeof a.open !== "boolean")
                    throw Error("浮条参数无效");
                break;
            case "drag":
                if (!["start", "move", "end"].includes(a.phase))
                    throw Error("拖动参数无效");
                if (a.phase === "start")
                    this.startDrag();
                else if (a.phase === "move")
                    this.moveDrag();
                else
                    this.endDrag();
                break;
            case "interact":
                if (a.part !== "head" && a.part !== "body")
                    throw Error("互动参数无效");
                if (!["waiting", "error"].includes(this.baseClip()) && !this.reduced)
                    this.play(a.part === "head" ? "pat" : "wave", 1800);
                break;
            case "quick-ask":
                this.options.quickEntry("ask");
                break;
            case "screenshot":
                this.options.quickEntry("ask");
                break;
            case "tasks":
                this.options.command("open-inbox");
                break;
            case "menu":
                Menu.buildFromTemplate(this.menu()).popup();
                break;
            case "navigate": {
                const targets = petTargets(this.activity, this.inbox);
                if (a.target && !targets.some(t => t.kind === a.target!.kind && t.id === a.target!.id))
                    throw Error("会话状态已变化，请刷新");
                const target = a.target ?? targets[0];
                if (!target) {
                    this.options.showMain();
                    break;
                }
                const version = this.intent.version, nav = ++this.navigationVersion;
                try {
                    await this.controller.navigateDesktopPetTarget(target, () => this.intent.current(version) && this.navigationVersion === nav && !this.disposed);
                }
                catch {
                    if (!this.intent.current(version))
                        break;
                    this.warning = "会话已失效，请在收件箱查看";
                    this.options.command("open-inbox");
                    this.publish();
                }
                break;
            }
            default: throw Error("不支持的桌宠操作");
        }
    }
    private startDrag(): void {
        if (this.settings.locked || !this.window || this.window.isDestroyed() || this.drag)
            return;
        this.stopDrag();
        this.drag = { cursor: screen.getCursorScreenPoint(), bounds: this.window.getBounds() };
        this.clearAction();
        this.visibility = "visible";
        this.clip = "pickup";
        this.transition++;
        this.publish();
        this.dragTimer = setInterval(() => this.moveDrag(), 33);
        this.options.changed();
    }
    private moveDrag(): void { if (!this.drag || !this.window || this.window.isDestroyed())
        return; const cursor = screen.getCursorScreenPoint(), d = screen.getDisplayNearestPoint(cursor), b = this.drag.bounds; const x = Math.round(Math.max(d.workArea.x, Math.min(d.workArea.x + d.workArea.width - b.width, b.x + cursor.x - this.drag.cursor.x))), y = Math.round(Math.max(d.workArea.y, Math.min(d.workArea.y + d.workArea.height - b.height, b.y + cursor.y - this.drag.cursor.y))); this.window.setPosition(x, y); }
    private endDrag(): void {
        if (!this.drag || !this.window)
            return;
        this.moveDrag();
        this.stopDrag();
        const frames = this.skin?.clips.pickup?.frames;
        if (this.reduced || !frames?.length || ["waiting", "error"].includes(this.baseClip())) {
            this.restore();
        } else {
            // Finish the pose at the released location; this never moves the window.
            this.visibility = "visible";
            this.clip = "pickup";
            this.transition++;
            const duration = frames.slice(Math.min(3, frames.length - 1)).reduce((sum, frame) => sum + frame.duration, 0);
            this.setActionTimeout(duration + 100);
            this.settling = true;
            this.publish();
        }
        this.options.changed();
    }
    private canDropToBottom(): boolean {
        const w = this.window;
        if (!this.intent.visible || this.settings.locked || !w || w.isDestroyed() || !w.isVisible() || this.visibility === "exiting" || this.drag || this.landingTimer)
            return false;
        const b = w.getBounds(), area = screen.getDisplayMatching(b).workArea;
        return b.y < area.y + area.height - b.height - 1;
    }
    private dropToBottom(): void {
        if (!this.canDropToBottom())
            return;
        this.stopDrag();
        this.clearAction();
        const w = this.window!, start = w.getBounds(), d = screen.getDisplayMatching(start), end = { ...start, y: d.workArea.y + d.workArea.height - start.height };
        const version = this.motionVersion;
        const current = () => version === this.motionVersion && w === this.window && !w.isDestroyed();
        const finish = () => {
            if (!current()) return;
            w.setPosition(end.x, end.y);
            const moving = !!this.landingTimer;
            this.stopDrag();
            if (!moving) this.rememberPosition();
            this.restore();
            this.options.changed();
        };
        if (this.reduced) {
            finish();
            return;
        }
        const at = Date.now();
        this.visibility = "visible";
        this.clip = "pickup";
        this.transition++;
        const timer = setInterval(() => {
            if (!current()) { clearInterval(timer); return; }
            const t = Math.min(1, (Date.now() - at) / 600);
            w.setPosition(end.x, Math.round(start.y + (end.y - start.y) * t * t));
            if (t >= 1) finish();
        }, 33);
        this.landingTimer = timer;
        this.publish();
        this.options.changed();
    }
    private rememberPosition(): void {
        const w = this.window;
        if (!w || w.isDestroyed()) return;
        const b = w.getBounds(), d = screen.getDisplayMatching(b), position = petPosition(b, d.workArea, d.id);
        // Use the current position for an immediate resize/rebuild, before the atomic store write completes.
        this.settings = { ...this.settings, position };
        void this.update({ position }).catch(() => undefined);
    }
    private stopDrag(): void { const moving = !!this.drag || !!this.landingTimer; this.motionVersion++; this.drag = undefined; if (this.dragTimer)
        clearInterval(this.dragTimer); if (this.landingTimer)
        clearInterval(this.landingTimer); this.dragTimer = undefined; this.landingTimer = undefined; if (moving) this.rememberPosition(); }
}
