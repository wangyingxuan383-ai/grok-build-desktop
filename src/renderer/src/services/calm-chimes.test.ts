import { afterEach, describe, expect, it } from "vitest";
import { useAppStore } from "../store";
import { clearSessionTelemetrySnooze, snoozeSessionTelemetry } from "../hooks/use-live-telemetry";
import {
  CALM_CHIME_COALESCE_MS,
  resetCalmChimeCoalescerForTest,
  shouldPlayCalmChime,
} from "./calm-chimes";

describe("calm-chimes gate & coalescing", () => {
  afterEach(() => {
    resetCalmChimeCoalescerForTest();
    clearSessionTelemetrySnooze("sess-1");
    useAppStore.setState({ sessions: [], views: {} });
  });

  it("suppresses chimes when mode is off, soundEnabled is false, or watching active pane at bottom in background-only mode", () => {
    const base = {
      mode: "background-only" as const,
      soundEnabled: true,
      windowFocused: true,
      documentVisible: true,
      isActivePaneVisible: true,
      atBottom: true,
      lastPlayedAt: 0,
      now: 100_000,
    };

    expect(shouldPlayCalmChime(base)).toBe(false);
    expect(shouldPlayCalmChime({ ...base, atBottom: false })).toBe(true);
    expect(shouldPlayCalmChime({ ...base, windowFocused: false })).toBe(true);
    expect(shouldPlayCalmChime({ ...base, mode: "always" })).toBe(true);
    expect(shouldPlayCalmChime({ ...base, mode: "off", windowFocused: false })).toBe(false);
    expect(shouldPlayCalmChime({ ...base, soundEnabled: false, windowFocused: false })).toBe(false);
  });

  it("enforces 4s coalescing window across rapid background completions", () => {
    const base = {
      mode: "always" as const,
      soundEnabled: true,
      windowFocused: false,
      documentVisible: false,
      isActivePaneVisible: false,
      atBottom: false,
      lastPlayedAt: 50_000,
    };

    expect(shouldPlayCalmChime({ ...base, now: 50_000 + CALM_CHIME_COALESCE_MS - 1 })).toBe(false);
    expect(shouldPlayCalmChime({ ...base, now: 50_000 + CALM_CHIME_COALESCE_MS })).toBe(true);
  });

  it("respects quietUntil DND window and session-scoped telemetry snooze", () => {
    const now = 1_000_000;
    expect(
      shouldPlayCalmChime({
        mode: "always",
        soundEnabled: true,
        productivity: {
          quietUntil: new Date(now + 60_000).toISOString(),
        },
        windowFocused: false,
        documentVisible: false,
        isActivePaneVisible: false,
        atBottom: false,
        lastPlayedAt: 0,
        now,
      }),
    ).toBe(false);

    snoozeSessionTelemetry("sess-1", 60_000);
    expect(
      shouldPlayCalmChime({
        mode: "always",
        soundEnabled: true,
        sessionId: "sess-1",
        windowFocused: false,
        documentVisible: false,
        isActivePaneVisible: false,
        atBottom: false,
        lastPlayedAt: 0,
        now: Date.now() + 5_000,
      }),
    ).toBe(false);
  });
});
