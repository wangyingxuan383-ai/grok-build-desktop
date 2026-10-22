import type { DesktopActivitySnapshot } from "../../shared/desktop-activity";
import { notificationsQuiet, type DesktopProductivitySettings } from "../../shared/productivity";

export const EMPTY_DESKTOP_ACTIVITY: DesktopActivitySnapshot = { sessions: [], runningCount: 0, awaitingCount: 0, errorCount: 0, inboxUnreadCount: 0, livePhoneCount: 0 };

export function desktopShellState(activity: DesktopActivitySnapshot, settings?: Partial<DesktopProductivitySettings>) {
  const count = (value: number) => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const running = count(activity.runningCount), waiting = count(activity.awaitingCount), errors = count(activity.errorCount);
  return {
    running, waiting, errors, unread: count(activity.inboxUnreadCount), phones: count(activity.livePhoneCount),
    status: waiting ? "waiting" as const : errors ? "error" as const : running ? "working" as const : activity.livePhoneCount > 0 ? "connected" as const : "idle" as const,
    preventSleep: settings?.preventSleepWhileWorking === true && running > 0,
    quiet: notificationsQuiet(settings),
  };
}

export interface DesktopTaskbarHost {
  progress(value: number): void;
  badge(count: number): void;
  flash(enabled: boolean): void;
  focused(): boolean;
  startPowerBlocker(): number;
  stopPowerBlocker(id: number): void;
}

/** No timers: waiting does not imply work, and a power blocker is always opt-in. */
export class DesktopTaskbarService {
  private blocker?: number;
  private running?: boolean;
  private waiting = 0;
  private disposed = false;
  constructor(private readonly host: DesktopTaskbarHost) {}
  update(activity: DesktopActivitySnapshot, settings?: Partial<DesktopProductivitySettings>): void {
    if (this.disposed) return;
    const state = desktopShellState(activity, settings);
    if ((state.running > 0) !== this.running) { this.running = state.running > 0; this.host.progress(this.running ? 2 : -1); }
    if (state.waiting !== this.waiting) {
      this.host.badge(state.waiting);
      if (state.waiting > this.waiting && !state.quiet && !this.host.focused()) this.host.flash(true);
      if (!state.waiting) this.host.flash(false);
      this.waiting = state.waiting;
    }
    if (state.quiet || this.host.focused()) this.host.flash(false);
    if (state.preventSleep && this.blocker === undefined) this.blocker = this.host.startPowerBlocker();
    if (!state.preventSleep) this.releasePower();
  }
  focus(): void { if (!this.disposed) this.host.flash(false); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releasePower(); this.host.progress(-1); this.host.badge(0); this.host.flash(false);
  }
  private releasePower(): void {
    if (this.blocker === undefined) return;
    const id = this.blocker; this.blocker = undefined; this.host.stopPowerBlocker(id);
  }
}
