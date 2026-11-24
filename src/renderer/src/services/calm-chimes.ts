import { notificationsQuiet, type CalmChimeMode, type DesktopProductivitySettings } from "../../../shared/productivity";
import { isSessionTelemetrySnoozed } from "../hooks/use-live-telemetry";

export type { CalmChimeMode };
export type CalmChimeKind = "complete" | "needs-user" | "error";

export const CALM_CHIME_COALESCE_MS = 4_000;

export interface CalmChimeGateInput {
  mode?: CalmChimeMode;
  soundEnabled?: boolean;
  productivity?: Partial<DesktopProductivitySettings>;
  sessionId?: string;
  windowFocused: boolean;
  documentVisible: boolean;
  isActivePaneVisible: boolean;
  atBottom: boolean;
  lastPlayedAt: number;
  now?: number;
}

export function shouldPlayCalmChime(input: CalmChimeGateInput): boolean {
  const now = input.now ?? Date.now();
  const mode: CalmChimeMode = input.mode ?? input.productivity?.calmChimeMode ?? "background-only";
  if (mode === "off") return false;
  if (input.soundEnabled === false) return false;
  if (notificationsQuiet(input.productivity, now)) return false;
  if (input.sessionId && isSessionTelemetrySnoozed(input.sessionId, now)) return false;
  if (input.lastPlayedAt > 0 && now - input.lastPlayedAt < CALM_CHIME_COALESCE_MS) return false;

  if (mode === "background-only") {
    const watchingAtBottom =
      input.windowFocused && input.documentVisible && input.isActivePaneVisible && input.atBottom;
    if (watchingAtBottom) return false;
  }

  return true;
}

let sharedAudioContext: AudioContext | null = null;
let lastChimePlayedAt = 0;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    try {
      sharedAudioContext = new Ctor();
    } catch {
      return null;
    }
  }
  return sharedAudioContext;
}

function scheduleTone(
  ctx: AudioContext,
  frequency: number,
  startOffsetSec: number,
  durationSec: number,
  peakGain: number,
  type: OscillatorType = "sine",
): void {
  const t0 = ctx.currentTime + startOffsetSec;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, t0);

  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(peakGain, t0 + 0.014);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationSec);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + durationSec + 0.02);
}

export function synthesizeCalmChime(kind: CalmChimeKind): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  const play = (): void => {
    try {
      if (kind === "complete") {
        scheduleTone(ctx, 523.25, 0, 0.22, 0.045, "sine");
        scheduleTone(ctx, 783.99, 0.09, 0.34, 0.05, "triangle");
      } else if (kind === "needs-user") {
        scheduleTone(ctx, 659.25, 0, 0.18, 0.05, "triangle");
        scheduleTone(ctx, 880.0, 0.11, 0.30, 0.055, "sine");
      } else {
        scheduleTone(ctx, 293.66, 0, 0.20, 0.045, "triangle");
        scheduleTone(ctx, 220.0, 0.10, 0.32, 0.04, "sine");
      }
    } catch {
      // Audio device unavailable; remain silent.
    }
  };

  if (ctx.state === "suspended") {
    void ctx.resume().then(play).catch(() => undefined);
  } else {
    play();
  }
}

export function maybePlayCalmChime(
  kind: CalmChimeKind,
  context: Omit<CalmChimeGateInput, "lastPlayedAt" | "now">,
): boolean {
  const now = Date.now();
  if (!shouldPlayCalmChime({ ...context, lastPlayedAt: lastChimePlayedAt, now })) {
    return false;
  }
  lastChimePlayedAt = now;
  synthesizeCalmChime(kind);
  return true;
}

export function resetCalmChimeCoalescerForTest(): void {
  lastChimePlayedAt = 0;
}
