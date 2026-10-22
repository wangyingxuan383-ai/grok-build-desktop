import { describe, it, expect } from "vitest";
import { DEFAULT_DESKTOP_PET, desktopPetSettings, validateDesktopPetSettings } from "../../shared/desktop-pet";
import { PetIntent, petTargets, petActivity, petWindowBounds, petPosition } from "./desktop-pet-model";
const activity = { sessions: [], runningCount: 0, awaitingCount: 0, errorCount: 0, inboxUnreadCount: 0, livePhoneCount: 0 };
describe("desktop companion policy", () => {
  it("uses owned media/native work but stays idle for configuration transitions",()=>{
    const quiet={...activity,sessions:[{sessionId:"config",title:"配置",projectName:"",status:"running" as const,activeTurn:false}]};
    expect(petActivity(petTargets(quiet,[]))).toBe("idle");
    expect(petActivity(petTargets({...quiet,tasks:[{kind:"image",id:"image-a",title:"图像创作",status:"running"}]},[]))).toBe("working");
  });
  it("enables new installs without overriding a saved disable", () => { expect(desktopPetSettings().enabled).toBe(true); expect(desktopPetSettings({ enabled: false }).enabled).toBe(false); });
  it("rejects file paths, invalid geometry and unknown fields", () => { for (const patch of [{ skinId: "../a" }, { size: 100 }, { position: { displayId: 1, x: Infinity, y: 0 } }, { approve: true }]) expect(() => validateDesktopPetSettings({ ...DEFAULT_DESKTOP_PET, ...patch })).toThrow(); });
  it("never lets unlock override an explicit hide or disabled setting", () => {
    const state = new PetIntent(); state.manuallyHidden = true; state.setBlocker("lock", true); state.setBlocker("lock", false); expect(state.visible).toBe(false);
    state.manuallyHidden = false; state.enabled = false; state.setBlocker("full", true); state.setBlocker("full", false); expect(state.visible).toBe(false);
  });
  it("invalidates a closing callback on newer intent", () => { const state = new PetIntent(), close = state.change(); state.change(); expect(state.current(close)).toBe(false); });
  it("composes independent auto-hide causes", () => { const state = new PetIntent(); state.setBlocker("screen", true); state.setBlocker("computer", true); state.setBlocker("screen", false); expect(state.visible).toBe(false); state.setBlocker("computer", false); expect(state.visible).toBe(true); });
  it("prioritizes awaiting work and keeps completed targets separate", () => {
    const targets = petTargets({ ...activity, sessions: [{ sessionId: "one", title: "同名", projectName: "", status: "running" }, { sessionId: "two", title: "同名", projectName: "", status: "awaiting" }] }, [{ id: "done", kind: "completion", sessionId: "three", title: "同名", read: false, createdAt: "2026-10-21T00:00:00Z" }]);
    expect(targets.map(row => row.id)).toEqual(["two", "three", "one"]); expect(petActivity(targets)).toBe("waiting");
  });
  it("does not keep stale confirmations or acknowledged failures active", () => {
    expect(petTargets(activity, [{ id: "q", kind: "confirmation", sessionId: "old", title: "等待", read: false, createdAt: "" }])).toEqual([]);
    expect(petTargets({ ...activity, sessions: [{ sessionId: "old", title: "失败", projectName: "", status: "error" }] }, [{ id: "e", kind: "failure", sessionId: "old", title: "失败", read: true, createdAt: "" }])).toEqual([]);
  });
  it("constrains the character instead of reserving an invisible header at the top", () => {
    const area = { x: -1920, y: -1080, width: 1920, height: 1040 };
    for (const size of [128, 192, 256]) {
      const bounds = petWindowBounds(area, size, { x: 4, y: -3 });
      expect(bounds.x + bounds.width).toBe((360 - size) / 2 - 8);
      expect(bounds.y + bounds.height - 14 - size).toBe(area.y + 8);
      const position = petPosition(bounds, area, 2, size);
      expect(position).toEqual({ displayId: 2, x: 2, y: -1 });
      expect(petWindowBounds(area, size, position)).toEqual(bounds);
      expect(() => validateDesktopPetSettings({ ...DEFAULT_DESKTOP_PET, position })).not.toThrow();
    }
  });
  it("preserves the meaning of existing saved positions", () => {
    const area = { x: 0, y: 0, width: 1600, height: 1000 };
    for (const y of [0, .25, .5, 1]) {
      expect(petWindowBounds(area, 192, { x: .5, y }).y).toBe(Math.round(y * 578));
    }
  });
  it("restores left-edge positions without losing the character on a small display", () => {
    const area = { x: 20, y: 30, width: 800, height: 600 };
    const bounds = petWindowBounds(area, 192, { x: -1, y: -.5 });
    expect(bounds.x).toBe(-56);
    expect(petPosition(bounds, area, 3, 192)).toEqual({ displayId: 3, x: -1, y: -.5 });
    expect(petWindowBounds(area, 192, petPosition(bounds, area, 3, 192))).toEqual(bounds);
  });
});
