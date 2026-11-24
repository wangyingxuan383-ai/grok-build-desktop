import type { AppMenuCommand } from "./types";

export type CalmChimeMode = "off" | "background-only" | "always";

/** Optional desktop conveniences; none starts a model or changes CLI permissions. */
export interface DesktopProductivitySettings {
  closeAction: "ask" | "tray" | "quit";
  quickAskShortcut: string;
  /** Legacy screenshot entry, read only as a fallback for the unified question shortcut. */
  screenshotShortcut: string;
  preventSleepWhileWorking: boolean;
  /** Zero disables warnings. Only explicitly reported, current allowance data is used. */
  quotaWarningPercent: number;
  quietUntil?: string;
  calmChimeMode?: CalmChimeMode;
  shortcuts?: Partial<Record<AppMenuCommand, string>>;
}

export const DEFAULT_PRODUCTIVITY: DesktopProductivitySettings = {
  closeAction: "ask",
  quickAskShortcut: "",
  screenshotShortcut: "",
  preventSleepWhileWorking: false,
  quotaWarningPercent: 0,
  calmChimeMode: "background-only",
};

export function productivitySettings(value?: Partial<DesktopProductivitySettings>): DesktopProductivitySettings {
  return {
    ...DEFAULT_PRODUCTIVITY,
    ...value,
    calmChimeMode: value?.calmChimeMode ?? DEFAULT_PRODUCTIVITY.calmChimeMode,
    quickAskShortcut: value?.quickAskShortcut || value?.screenshotShortcut || "",
    screenshotShortcut: "",
  };
}

export function notificationsQuiet(value?: Pick<DesktopProductivitySettings, "quietUntil">, now = Date.now()): boolean {
  return !!value?.quietUntil && Date.parse(value.quietUntil) > now;
}
