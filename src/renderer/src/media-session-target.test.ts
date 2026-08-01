import { describe, expect, it } from "vitest";
import { resolveMediaSessionTarget } from "./media-session-target";

describe("resolveMediaSessionTarget", () => {
  it("keeps the active Grok task as the media destination regardless of turn state", () => {
    expect(resolveMediaSessionTarget("grok-session", false)).toBe("grok-session");
  });

  it("requires a new Grok task when a foreign conversation surface is active", () => {
    expect(resolveMediaSessionTarget("stale-grok-session", true)).toBe("");
  });
});
