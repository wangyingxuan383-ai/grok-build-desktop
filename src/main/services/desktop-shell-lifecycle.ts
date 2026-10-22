import type { DesktopProductivitySettings } from "../../shared/productivity";

export interface DesktopShellLifecycleHost {
  getCloseAction(): Promise<DesktopProductivitySettings["closeAction"]>;
  chooseCloseAction(): Promise<{ action: "tray" | "quit" | "cancel"; remember: boolean }>;
  rememberCloseAction(action: "tray" | "quit"): Promise<void>;
  canHideToTray(): boolean;
  hide(): void;
  show(): void;
  updateInProgress(): boolean;
  warnUpdate(): Promise<void>;
  hasWork(): boolean;
  livePhones(): number;
  confirmQuit(): Promise<boolean>;
  shutdown(): Promise<void>;
  reportError(error: unknown): void;
}

/** All exit paths share one transaction and at most one work/phone warning. */
export class DesktopShellLifecycle {
  private flight?: Promise<void>;
  private disposed = false;
  constructor(private readonly host: DesktopShellLifecycleHost) {}

  close(): Promise<void> { return this.run(async () => {
    let action = await this.host.getCloseAction();
    let remember = false;
    if (action === "ask") {
      const choice = await this.host.chooseCloseAction();
      if (choice.action === "cancel") return;
      action = choice.action;
      remember = choice.remember;
    }
    if (action === "tray" && this.host.canHideToTray()) {
      if (remember) await this.host.rememberCloseAction("tray");
      this.host.hide();
      return;
    }
    // A missing tray must never strand a hidden application.
    await this.quitOwned(remember && action === "quit");
  }); }

  quit(): Promise<void> { return this.run(() => this.quitOwned(false)); }

  private async quitOwned(remember: boolean): Promise<void> {
    if (this.host.updateInProgress()) { await this.host.warnUpdate(); this.host.show(); return; }
    if ((this.host.hasWork() || this.host.livePhones() > 0) && !await this.host.confirmQuit()) { this.host.show(); return; }
    // Recheck after dialogs: a CLI transaction may have started while one was open.
    if (this.host.updateInProgress()) { await this.host.warnUpdate(); this.host.show(); return; }
    if (remember) await this.host.rememberCloseAction("quit");
    await this.host.shutdown();
    this.disposed = true;
  }

  private run(action: () => Promise<void>): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.flight) return this.flight;
    this.flight = action().catch(error => { this.host.reportError(error); this.host.show(); }).finally(() => { this.flight = undefined; });
    return this.flight;
  }
}
