import { describe, it, expect } from "vitest";
import { PetPlayer, assetUrl, petControlsLayout, placeFrame, navigationTarget } from "./player";
import { PetGestures } from "./gestures";
import { desktopPetSettings, type PetSnapshot } from "../../shared/desktop-pet";

const clip = { file: "grok-pet://assets/b/idle.webp", width: 200, height: 200, referenceHeight: 100, frames: [{ x: 0, y: 0, width: 100, height: 200, anchorX: 50, anchorY: 180, duration: 100 }, { x: 100, y: 0, width: 100, height: 200, anchorX: 50, anchorY: 180, duration: 100 }], loop: true };
const snapshot: PetSnapshot = { revision: 1, transition: 1, visibility: "visible", clip: "idle", settings: desktopPetSettings(), skin: { id: "b", name: "B", author: "", license: "", clips: { idle: clip, enter: { ...clip, loop: false }, exit: { ...clip, loop: false } } }, quiet: false, reducedMotion: false, targets: [], phones: 0, unread: 0, running: 0, awaiting: 0, theme: "dark" };

describe("pet sandbox player", () => {
  it("keeps the toolbar and scrollable status card visible at the top edge and above 256px crowns", () => {
    for (const size of [128, 192, 256]) {
      const height = size + 230, visibleTop = 208, layout = petControlsLayout(height, visibleTop, Math.round(size * 1.08));
      expect(layout.toolbarTop).toBeGreaterThanOrEqual(visibleTop);
      expect(layout.cardTop).toBeGreaterThan(layout.toolbarTop + 36);
      expect(layout.cardTop + layout.cardHeight).toBeLessThanOrEqual(height - 8);
    }
    expect(petControlsLayout(422)).toEqual({ toolbarTop: 176, cardTop: 10, cardHeight: 156 });
    expect(petControlsLayout(486, 0, Math.round(256 * 1.08)).toolbarTop).toBeLessThan(160);
  });

  it("plays sleepy intro yawn frames once before looping from loopFrom", () => {
    const sleepyFrames = [
      { x: 0, y: 0, width: 50, height: 50, anchorX: 25, anchorY: 50, duration: 100 },
      { x: 50, y: 0, width: 50, height: 50, anchorX: 25, anchorY: 50, duration: 100 },
      { x: 0, y: 50, width: 50, height: 50, anchorX: 25, anchorY: 50, duration: 200 },
      { x: 50, y: 50, width: 50, height: 50, anchorX: 25, anchorY: 50, duration: 200 },
    ];
    const sleepySnap: PetSnapshot = {
      ...snapshot,
      clip: "sleepy",
      skin: { ...snapshot.skin, clips: { ...snapshot.skin.clips, sleepy: { file: "grok-pet://assets/b/sleepy.webp", width: 100, height: 100, referenceHeight: 50, frames: sleepyFrames, loop: true, loopFrom: 2 } } },
    };
    const p = new PetPlayer();
    p.set(sleepySnap, 0, false);
    expect(p.sample(10).index).toBe(0);
    expect(p.sample(120).index).toBe(1);
    expect(p.sample(220).index).toBe(2);
    expect(p.sample(450).index).toBe(3);
    // Wraps back to frame 2 (not 0!) after 200 + 400 = 600ms
    expect(p.sample(620).index).toBe(2);
  });

  it("animates pickup before holding and settles without replaying the falling frame", () => {
    const frames = Array.from({ length: 6 }, (_, index) => ({ x: index * 20, y: 0, width: 20, height: 20, anchorX: 10, anchorY: 20, duration: 100 }));
    const drag = { ...snapshot, clip: "pickup" as const, gesture: "dragging" as const, skin: { ...snapshot.skin, clips: { ...snapshot.skin.clips, pickup: { file: "grok-pet://assets/b/pickup.webp", width: 120, height: 20, referenceHeight: 20, frames, loop: false } } } };
    const p = new PetPlayer(); p.set(drag, 0, false);
    expect(p.sample(0).frame?.x).toBe(0); expect(p.sample(110).frame?.x).toBe(20); expect(p.sample(5000).frame?.x).toBe(20);
    p.set({ ...drag, revision: 2 }, 5100, false); expect(p.sample(5100).frame?.x).toBe(20);
    p.set({ ...drag, transition: 2, gesture: "settling" }, 5200, false);
    expect(p.sample(5200).frame?.x).toBe(60); expect(p.sample(5310).frame?.x).toBe(80); expect(p.sample(5490).frame?.x).toBe(100);
    expect(p.sample(5500).ended).toMatchObject({ transition: 2, clip: "pickup" });
    p.set({ ...drag, transition: 3, gesture: "landing" }, 5600, false); expect(p.sample(5600).frame?.x).toBe(40);
    p.set({ ...drag, transition: 4 }, 5700, true); expect(p.sample(5700).frame?.x).toBe(20);
    p.set({ ...drag, transition: 5, gesture: "falling" }, 5800, false);
    expect(p.sample(5800).frame?.x).toBe(40); expect(p.sample(6030).frame?.x).toBe(40);
  });

  it("accepts only local assets belonging to the selected skin", () => {
    for (const url of ["file:///C:/private.png", "https://example.com/a.png", "grok-pet://assets/a/idle.webp", "grok-pet://assets/b/../a/idle.webp", "grok-pet://assets/b/x.svg"])
      expect(assetUrl(url, "b")).toBeUndefined();
    expect(assetUrl(clip.file, "b")).toBe(clip.file);
  });

  it("does not restart a loop for an unrelated activity revision", () => {
    const p = new PetPlayer(); p.set(snapshot, 0, false); p.set({ ...snapshot, revision: 2, phones: 1 }, 120, false); expect(p.sample(130).index).toBe(1);
  });

  it("explicitly pauses elapsed animation time", () => {
    const p = new PetPlayer(); p.set(snapshot, 0, false); p.suspend(50); p.resume(1000); expect(p.sample(1030).index).toBe(0);
  });

  it("reports one transition receipt and keeps stale identities distinct", () => {
    const p = new PetPlayer(); p.set({ ...snapshot, clip: "exit", visibility: "exiting" }, 0, false);
    expect(p.sample(900).ended?.transition).toBe(1); expect(p.sample(950).ended).toBeUndefined();
    p.set({ ...snapshot, clip: "exit", visibility: "exiting", transition: 2 }, 1000, false); expect(p.sample(1100).ended).toBeUndefined();
  });

  it("fixes the foot anchor regardless of frame rectangle", () => {
    expect(placeFrame(clip.frames[0]!, 100, 192, 360, 422).y + 180 * 1.92).toBe(408);
  });

  it("does not choose an arbitrary identically prioritized conversation", () => {
    expect(navigationTarget([{ kind: "session", id: "a", title: "同名", status: "awaiting" }, { kind: "session", id: "b", title: "同名", status: "awaiting" }])).toBe("card");
  });

  it("cancels the single click on a second click and follows system double-click time", () => {
    const events: unknown[] = []; const g = new PetGestures(e => events.push(e)); g.doubleClickTime = 1000;
    g.down(1, { x: 0, y: 0 }, "head", false, 0); g.up(1, 10); g.down(2, { x: 0, y: 0 }, "head", false, 800); g.up(2, 820); g.tick(2000);
    expect(events).toEqual([{ type: "activate" }]);
  });

  it("detects hover head-rub stroke and 3x rapid body pokes without breaking unlocked drag", () => {
    const events: unknown[] = []; const g = new PetGestures(e => events.push(e));
    g.hoverMove({ x: 100, y: 50 }, "head", 0);
    g.hoverMove({ x: 120, y: 50 }, "head", 100);
    g.hoverMove({ x: 96, y: 50 }, "head", 200);
    g.hoverMove({ x: 122, y: 50 }, "head", 300);
    g.hoverMove({ x: 94, y: 50 }, "head", 400);
    expect(events).toContainEqual({ type: "interact", part: "head", gesture: "stroke" });

    events.length = 0;
    g.doubleClickTime = 200;
    for (const [id, at, x] of [[1, 0, 0], [2, 350, 20], [3, 700, 40]] as const) {
      g.down(id, { x, y: 100 }, "body", false, at);
      g.up(id, at + 15);
      g.tick(at + 220);
    }
    expect(events.at(-1)).toEqual({ type: "interact", part: "body", gesture: "poke" });
  });

  it("does not confuse a drag or lost capture with a tap", () => {
    const events: unknown[] = []; const g = new PetGestures(e => events.push(e));
    g.down(1, { x: 0, y: 0 }, "head", false, 0); g.move(1, { x: 6, y: 0 }); g.cancel(); g.tick(3000);
    expect(events).toContainEqual({ type: "drag", phase: "start" });
    expect(events).toContainEqual({ type: "drag", phase: "end" });
    expect(events.some((e: any) => e.type === "interact")).toBe(false);
  });
});
