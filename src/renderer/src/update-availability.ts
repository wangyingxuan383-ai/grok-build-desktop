import type { AppReleaseStatus, CliVersionStatus } from "../../shared/types";

export function updateAvailability(cli?: CliVersionStatus, app?: AppReleaseStatus, enabled = true): string[] {
  if (!enabled) return [];
  return [
    app?.updateAvailable && !app.error && app.latestVersion ? `桌面 ${app.latestVersion}` : "",
    cli?.found && cli.updateAvailable && !cli.error && cli.latestVersion ? `Grok CLI ${cli.latestVersion}` : "",
  ].filter(Boolean);
}
