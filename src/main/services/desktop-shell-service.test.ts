import { beforeEach, expect, it, vi } from "vitest";
import type { AppController } from "../app-controller";
import type { AppSettings } from "../../shared/types";
import type { DesktopActivitySnapshot } from "../../shared/desktop-activity";
import { EMPTY_DESKTOP_ACTIVITY } from "./desktop-shell-state";
import { productivitySettings } from "../../shared/productivity";

const mocks = vi.hoisted(() => ({ trays: [] as Array<any>, menus: [] as Array<any>, open: vi.fn(), quickDispose: vi.fn(), start: vi.fn(() => 1), stop: vi.fn() }));
vi.mock("electron", () => ({ Menu: { buildFromTemplate: (menu: unknown) => { mocks.menus.push(menu); return menu; } },
  Tray: class { dead = false; on = vi.fn(); setImage = vi.fn(); setToolTip = vi.fn(); setContextMenu = vi.fn(); constructor() { mocks.trays.push(this); } isDestroyed() { return this.dead; } destroy() { this.dead = true; } },
  dialog: { showMessageBox: vi.fn() }, globalShortcut: { register: vi.fn(() => true), unregister: vi.fn() }, powerSaveBlocker: { start: mocks.start, stop: mocks.stop } }));
vi.mock("../tray-icon", () => ({ trayIcon: (status: string) => status, taskbarCountIcon: (count: number) => count }));
vi.mock("./desktop-quick-entry-window", () => ({ DesktopQuickEntryWindow: class { open = mocks.open; dispose = mocks.quickDispose; setWarnings = vi.fn(); } }));
vi.mock("./desktop-pet-controller",()=>({DesktopPetController:class { assets={list:vi.fn(async()=>[])};applySettings=vi.fn();applyActivity=vi.fn();rendererReady=vi.fn();dispose=vi.fn();menu=()=>[]; }}));
import { DesktopShellService } from "./desktop-shell-service";

beforeEach(() => { vi.clearAllMocks(); mocks.trays.length = 0; mocks.menus.length = 0; });

it("updates from activity/settings observers and releases all subscriptions and power state on dispose", async () => {
  let activityListener!: (value: DesktopActivitySnapshot) => void, settingsListener!: (value: AppSettings) => void;
  const unsubscribeActivity = vi.fn(), unsubscribeSettings = vi.fn();
  const settings = { productivity: {} } as AppSettings;
  const controller = { setDesktopPetDelegate:vi.fn(), getSettings: vi.fn(async () => settings), getDesktopActivity: vi.fn(async () => EMPTY_DESKTOP_ACTIVITY),
    observeSettings: (listener: typeof settingsListener) => { settingsListener = listener; return unsubscribeSettings; },
    observeDesktopActivity: (listener: typeof activityListener) => { activityListener = listener; return unsubscribeActivity; } };
  const window = { isDestroyed: () => false, isFocused: () => false, setProgressBar: vi.fn(), setOverlayIcon: vi.fn(), flashFrame: vi.fn(), webContents: { isDestroyed: () => false, send: vi.fn() } };
  const onSettings = vi.fn(), quit = vi.fn();
  const service = new DesktopShellService(controller as unknown as AppController, { getWindow: () => window as never, showWindow: vi.fn(), quit,
    rendererEntry: "D:/app/quick-entry/index.html", preloadEntry: "D:/app/preload/quick-entry.cjs", petBuiltins:"D:/resources/pets",petUserRoot:"D:/userdata/pets", onSettings });
  await service.start();
  settingsListener({ ...settings, productivity: productivitySettings({ preventSleepWhileWorking: true }) });
  activityListener({ ...EMPTY_DESKTOP_ACTIVITY, runningCount: 1, awaitingCount: 2, livePhoneCount: 3 });
  expect(mocks.trays[0].setImage).toHaveBeenLastCalledWith("waiting");
  expect(window.webContents.send).toHaveBeenLastCalledWith("grok:desktop-activity", expect.objectContaining({ awaitingCount: 2, livePhoneCount: 3 }));
  window.webContents.send.mockClear(); service.rendererReady(); expect(window.webContents.send).toHaveBeenCalledOnce();
  expect(window.setProgressBar).toHaveBeenLastCalledWith(2, { mode: "indeterminate" }); expect(mocks.start).toHaveBeenCalledWith("prevent-app-suspension");
  const menu = mocks.menus.at(-1); menu.find((row: any) => row.label === "提问…").click(); expect(mocks.open).toHaveBeenCalledWith("ask");
  expect(menu.filter((row: any) => row.label?.includes("提问"))).toHaveLength(1);
  menu.find((row: any) => row.label === "退出应用").click(); expect(quit).toHaveBeenCalledOnce();
  expect(controller.getDesktopActivity).toHaveBeenCalledOnce();
  service.dispose(); service.dispose(); expect(unsubscribeActivity).toHaveBeenCalledOnce(); expect(unsubscribeSettings).toHaveBeenCalledOnce();
  expect(mocks.stop).toHaveBeenCalledWith(1); expect(mocks.quickDispose).toHaveBeenCalledOnce(); expect(service.canHideToTray()).toBe(false);
  activityListener({ ...EMPTY_DESKTOP_ACTIVITY, runningCount: 9 }); expect(mocks.start).toHaveBeenCalledOnce();
  const sent = window.webContents.send.mock.calls.length; service.rendererReady(); expect(window.webContents.send.mock.calls.length).toBe(sent);
});

it("does not replace a newer observer snapshot with a delayed initial read", async () => {
  let finish!: (value: DesktopActivitySnapshot) => void, listener!: (value: DesktopActivitySnapshot) => void;
  const controller = { setDesktopPetDelegate:vi.fn(), getSettings: async () => ({ productivity: {} }), getDesktopActivity: () => new Promise<DesktopActivitySnapshot>(resolve => { finish = resolve; }),
    observeSettings: () => () => undefined, observeDesktopActivity: (callback: typeof listener) => { listener = callback; return () => undefined; } };
  const service = new DesktopShellService(controller as unknown as AppController, { getWindow: () => undefined, showWindow: vi.fn(), quit: vi.fn(),
    rendererEntry: "D:/app/quick-entry/index.html", preloadEntry: "D:/app/preload/quick-entry.cjs", petBuiltins:"D:/resources/pets",petUserRoot:"D:/userdata/pets", onSettings: vi.fn() });
  const starting = service.start(); listener({ ...EMPTY_DESKTOP_ACTIVITY, awaitingCount: 1 }); finish(EMPTY_DESKTOP_ACTIVITY); await starting;
  expect(mocks.trays[0].setImage).toHaveBeenLastCalledWith("waiting"); service.dispose();
});
