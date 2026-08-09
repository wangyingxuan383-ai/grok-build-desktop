import { describe, expect, it } from "vitest";
import { relativeDisplayPath, reviewSurfaceForCapability } from "./RightUtilityPane";

describe("recent file display paths", () => {
  it("shows project files relative to the real execution root", () => {
    expect(relativeDisplayPath("E:\\repo\\src\\main.ts", "E:\\repo")).toBe("src\\main.ts");
    expect(relativeDisplayPath("src/main.ts", "E:\\repo")).toBe("src\\main.ts");
  });

  it("keeps trusted external paths explicit", () => {
    expect(relativeDisplayPath("C:\\shared\\result.png", "E:\\repo")).toBe("C:\\shared\\result.png");
  });
});

describe("right dock review capability", () => {
  it("never exposes Git and non-Git review surfaces at the same time", () => {
    expect(reviewSurfaceForCapability(true)).toBe("review");
    expect(reviewSurfaceForCapability(false)).toBe("agent-changes");
    expect(reviewSurfaceForCapability(undefined)).toBeUndefined();
  });
});
