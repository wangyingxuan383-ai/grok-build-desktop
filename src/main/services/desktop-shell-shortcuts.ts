import type { DesktopProductivitySettings } from "../../shared/productivity";
import { productivitySettings } from "../../shared/productivity";
import { normalizeAccelerator, validateShortcutBindings } from "../../shared/shortcuts";

interface ShortcutHost {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

export class DesktopShellShortcuts {
  private registered = new Map<string, "ask" | "screenshot">();
  private signature?: string;
  private warnings: string[] = [];
  constructor(private readonly host: ShortcutHost, private readonly open: (intent: "ask" | "screenshot") => void) {}
  apply(settings: Partial<DesktopProductivitySettings> = {}): string[] {
    settings = productivitySettings(settings);
    const signature = JSON.stringify([settings.quickAskShortcut, settings.shortcuts]);
    if (signature === this.signature) return [...this.warnings];
    this.dispose(); this.signature = signature; this.warnings = [];
    try { validateShortcutBindings(settings); }
    catch (error) { this.warnings.push(String(error instanceof Error ? error.message : error)); return [...this.warnings]; }
    for (const [intent, raw] of [["ask", settings.quickAskShortcut]] as const) {
      const accelerator = normalizeAccelerator(raw ?? "");
      if (!accelerator) continue;
      let ok = false;
      try { ok = this.host.register(accelerator, () => this.open(intent)); } catch { /* OS rejected the binding */ }
      if (ok) this.registered.set(accelerator, intent);
      else this.warnings.push(`提问快捷键 ${accelerator} 已被占用或无法注册，仍可从托盘打开。`);
    }
    return [...this.warnings];
  }
  dispose(): void {
    for (const accelerator of this.registered.keys()) this.host.unregister(accelerator);
    this.registered.clear(); this.signature = undefined;
  }
}
