import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { desktopPetSettings, type DesktopPetSettings } from "../../shared/desktop-pet";
import { EMPTY_DESKTOP_ACTIVITY } from "./desktop-shell-state";
import type { AppSettings } from "../../shared/types";
import { PetIntent, petPosition, petWindowBounds } from "./desktop-pet-model";

const desktop = vi.hoisted(() => ({
    cursor: { x: 300, y: 300 },
    area: { x: 0, y: 0, width: 1600, height: 1000 },
    reduced: false,
}));
vi.mock("electron", () => ({
    screen: {
        getCursorScreenPoint: () => desktop.cursor,
        getDisplayNearestPoint: () => ({ id: 2, workArea: desktop.area }),
        getDisplayMatching: () => ({ id: 2, workArea: desktop.area }),
    },
    systemPreferences: { getAnimationSettings: () => ({ prefersReducedMotion: desktop.reduced }) },
}));
import { DesktopPetController } from "./desktop-pet-controller";

function fixture(patch: Partial<DesktopPetSettings> = {}) {
    let bounds = { x: desktop.area.x + 200, y: desktop.area.y + 180, width: 360, height: 422 };
    const window = {
        getBounds: () => ({ ...bounds }), isDestroyed: () => false, isVisible: () => true,
        setPosition: vi.fn((x: number, y: number) => { bounds = { ...bounds, x, y }; }),
        setBounds: vi.fn((value: typeof bounds) => { bounds = { ...value }; }),
    };
    // Exercise the actual controller motion/menu methods without starting Electron or an environment helper.
    const pet = Object.assign(Object.create(DesktopPetController.prototype), {
        window, settings: desktopPetSettings(patch), appSettings: { productivity: {} }, intent: new PetIntent(),
        activity: EMPTY_DESKTOP_ACTIVITY, inbox: [], clip: "working", visibility: "visible", transition: 0, motionVersion: 0,
        skin: { clips: { pickup: { frames: Array.from({ length: 6 }, () => ({ duration: 100 })) } } },
        options: { changed: vi.fn() }, publish: vi.fn(), bindShortcut: vi.fn(), updateEnvironment: vi.fn(),
        environment: { stop: vi.fn() },
    }) as {
        menu: DesktopPetController["menu"]; applySettings: DesktopPetController["applySettings"]; applyActivity: DesktopPetController["applyActivity"]; intent: PetIntent;
        settings: DesktopPetSettings; clip: string; transition: number; visibility: string; settling: boolean;
        startDrag(): void; moveDrag(): void; endDrag(): void; stopDrag(): void; dropToBottom(): void;
        restore(): void; landingTimer?: ReturnType<typeof setInterval>;
        update: ReturnType<typeof vi.fn>;
    };
    pet.update = vi.fn(async () => ({}));
    const drop = () => pet.menu().find(row => row.label === "落到底部")!;
    return { pet, window, drop };
}

beforeEach(() => {
    vi.useFakeTimers();
    desktop.cursor = { x: 300, y: 300 };
    desktop.area = { x: 0, y: 0, width: 1600, height: 1000 };
    desktop.reduced = false;
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("companion free placement and explicit falling", () => {
    it("physically falls a short distance, then settles without continuing to the bottom", () => {
        const { pet, window } = fixture();
        pet.startDrag(); pet.endDrag();
        const released = window.getBounds();
        expect(pet.clip).toBe("pickup"); expect(pet.landingTimer).toBeDefined();
        vi.advanceTimersByTime(100);
        expect(window.getBounds().y).toBeGreaterThan(released.y);
        expect(window.getBounds().y).toBeLessThan(released.y + 31);
        vi.advanceTimersByTime(170);
        const resting = { ...released, y: released.y + 31 };
        expect(pet.settling).toBe(true); expect(window.getBounds()).toEqual(resting);
        vi.advanceTimersByTime(450);
        expect(pet.settling).toBe(false); expect(pet.clip).toBe("idle");
        expect(window.getBounds()).toEqual(resting);
    });
    it("lets an urgent task preempt settling without moving the window", () => {
        const { pet, window } = fixture();
        Object.assign(pet, { refreshInbox: vi.fn(async () => undefined) });
        pet.startDrag(); pet.endDrag(); vi.advanceTimersByTime(270); const released = window.getBounds();
        pet.applyActivity({ ...EMPTY_DESKTOP_ACTIVITY, sessions: [{ sessionId: "waiting", title: "待确认", projectName: "", status: "awaiting" }], awaitingCount: 1 });
        expect(pet.clip).toBe("waiting"); expect(pet.settling).toBe(false);
        vi.advanceTimersByTime(1000);
        expect(pet.clip).toBe("waiting"); expect(window.getBounds()).toEqual(released);
    });
    it("skips settling for reduced motion and prevents an old pose timeout from ending a new drag", () => {
        const reduced = fixture({ reduceMotion: true }); reduced.pet.startDrag(); reduced.pet.endDrag();
        expect(reduced.pet.clip).toBe("idle"); expect(vi.getTimerCount()).toBe(0);
        const { pet } = fixture(); pet.startDrag(); pet.endDrag(); vi.advanceTimersByTime(270); pet.startDrag();
        vi.advanceTimersByTime(600);
        expect(pet.clip).toBe("pickup"); expect(pet.settling).toBe(false);
        pet.endDrag(); vi.advanceTimersByTime(1000);
        expect(pet.clip).toBe("idle"); expect(vi.getTimerCount()).toBe(0);
    });
    it.each([{ cursor: { x: 500, y: 420 }, y: 331 }, { cursor: { x: -900, y: -700 }, y: -177 }, { cursor: { x: 3000, y: 3000 }, y: 578 }])("stops near the clamped release point %j and saves its resting position", ({ cursor, y }) => {
        const { pet, window } = fixture();
        pet.startDrag(); desktop.cursor = cursor; pet.moveDrag();
        const released = window.getBounds();
        pet.endDrag(); vi.advanceTimersByTime(1500);
        const resting = { ...released, y };
        expect(window.getBounds()).toEqual(resting);
        expect(pet.clip).toBe("idle");
        expect(vi.getTimerCount()).toBe(0);
        expect(pet.update).toHaveBeenLastCalledWith({ position: petPosition(resting, desktop.area, 2) });
        expect(petWindowBounds(desktop.area, 192, pet.settings.position)).toEqual(resting);
    });
    it("persists a nearby resting position on a negative monitor and keeps full falling explicit", () => {
        desktop.area = { x: -1600, y: -1000, width: 1600, height: 1000 };
        const { pet, window, drop } = fixture();
        pet.startDrag(); pet.endDrag(); vi.advanceTimersByTime(750);
        const released = window.getBounds();
        expect(drop().enabled).toBe(true);
        (drop().click as () => void)();
        expect(drop().enabled).toBe(false);
        pet.restore(); expect(pet.clip).toBe("pickup");
        vi.advanceTimersByTime(660);
        expect(window.getBounds()).toEqual({ ...released, y: -422 });
        expect(pet.settings.position).toEqual({ displayId: 2, x: petPosition(released, desktop.area, 2).x, y: 1 });
        expect(drop().enabled).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });
    it.each([{ reduceMotion: true }, { mode: "status" as const }])("positions immediately without timers for %j", patch => {
        const { pet, window } = fixture(patch), x = window.getBounds().x;
        pet.dropToBottom();
        expect(window.getBounds()).toMatchObject({ x, y: 578 });
        expect(vi.getTimerCount()).toBe(0);
        expect(pet.update).toHaveBeenCalledOnce();
    });
    it("honors quiet hours and the system reduced-motion preference", () => {
        desktop.reduced = true;
        const first = fixture(); first.pet.dropToBottom(); expect(vi.getTimerCount()).toBe(0);
        desktop.reduced = false;
        const second = fixture();
        Object.assign(second.pet, { appSettings: { productivity: { quietUntil: new Date(Date.now() + 60000).toISOString() } } });
        second.pet.dropToBottom(); expect(vi.getTimerCount()).toBe(0);
        expect(second.window.getBounds().y).toBe(578);
    });
    it("rejects a queued old fall callback after a new drag, even on the same window", () => {
        const interval = vi.spyOn(globalThis, "setInterval");
        const { pet, window } = fixture();
        pet.dropToBottom();
        const stale = interval.mock.calls[0]![0] as () => void;
        vi.advanceTimersByTime(220);
        pet.startDrag(); desktop.cursor = { x: 420, y: 320 }; pet.endDrag();
        vi.advanceTimersByTime(1000);
        const released = window.getBounds(), writes = pet.update.mock.calls.length;
        stale();
        expect(window.getBounds()).toEqual(released);
        expect(pet.update).toHaveBeenCalledTimes(writes);
        expect(vi.getTimerCount()).toBe(0);
    });
    it("invalidates a queued short-fall callback when grabbed again", () => {
        const interval = vi.spyOn(globalThis, "setInterval"), { pet, window } = fixture();
        pet.startDrag(); pet.endDrag();
        const stale = interval.mock.calls[1]![0] as () => void;
        vi.advanceTimersByTime(100); pet.startDrag();
        const grabbed = window.getBounds(), writes = pet.update.mock.calls.length;
        vi.advanceTimersByTime(1000); stale();
        expect(window.getBounds()).toEqual(grabbed); expect(pet.update).toHaveBeenCalledTimes(writes);
        pet.endDrag(); vi.advanceTimersByTime(1000);
        expect(vi.getTimerCount()).toBe(0);
    });
    it("disables falling while locked, hidden, or dragging", () => {
        const { pet, drop, window } = fixture({ locked: true });
        expect(drop().enabled).toBe(false); pet.dropToBottom();
        expect(window.setPosition).not.toHaveBeenCalled();
        pet.settings.locked = false; pet.intent.manuallyHidden = true;
        expect(drop().enabled).toBe(false);
        pet.intent.manuallyHidden = false; pet.startDrag();
        expect(drop().enabled).toBe(false); pet.endDrag();
    });
    it.each([{ locked: true }, { size: 128 as const }, { enabled: false }])("cancels an old fall when settings change %j", patch => {
        const { pet, window } = fixture();
        Object.assign(pet, { retire: vi.fn(async () => undefined), reposition: vi.fn() });
        const interval = vi.spyOn(globalThis, "setInterval");
        pet.dropToBottom(); const stale = interval.mock.calls[0]![0] as () => void;
        vi.advanceTimersByTime(220); const current = window.getBounds();
        pet.applySettings({ desktopPet: { ...pet.settings, ...patch }, theme: { mode: "dark" } } as AppSettings);
        vi.advanceTimersByTime(1000); stale();
        expect(window.getBounds()).toEqual(current);
        expect(pet.settings.position).toEqual(petPosition(current, desktop.area, 2));
        expect(vi.getTimerCount()).toBe(0);
    });
});
