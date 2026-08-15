import { describe, expect, it } from "vitest";
import { normalizeWindowState } from "./window-state-service";

describe("window state", () => {
  const displays = [{ x: 0, y: 0, width: 1920, height: 1040 }];
  it("restores valid geometry and maximized state", () => {
    expect(normalizeWindowState({ x: 120, y: 80, width: 1280, height: 800, maximized: true }, displays))
      .toEqual({ x: 120, y: 80, width: 1280, height: 800, maximized: true });
  });
  it("recenters windows left on a disconnected display", () => {
    const state = normalizeWindowState({ x: 9000, y: 100, width: 1400, height: 900, maximized: true }, displays);
    expect(state).toMatchObject({ x: 260, y: 70, width: 1400, height: 900, maximized: false });
  });
  it("bounds corrupt or tiny dimensions", () => {
    expect(normalizeWindowState({ x: 0, y: 0, width: 20, height: Number.NaN }, displays)).toMatchObject({ width: 820, height: 920 });
  });
});
