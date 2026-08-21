import { isAbsolute, join, resolve } from "node:path";

export const INSTALLED_APP_NAME = "Grok Build Desktop";
export const INSTALLED_APP_USER_MODEL_ID = "io.github.grokbuilddesktop.community";
export const SOURCE_PREVIEW_APP_NAME = "Grok Build Desktop Source";
export const SOURCE_PREVIEW_APP_USER_MODEL_ID = "io.github.grokbuilddesktop.community.source";

/** Unpackaged runs must not share the installed app mutex or AppData. */
export function sourcePreviewIdentity(input: { isPackaged: boolean; appData: string; explicitUserData?: string }): { name: string; userData: string; appUserModelId: string } | undefined {
  if (input.isPackaged) return undefined;
  return {
    name: SOURCE_PREVIEW_APP_NAME,
    // Electron smoke/acceptance runs provide an isolated --user-data-dir.
    // Respect it verbatim instead of redirecting the fixture into the shared
    // source-preview profile; ordinary `electron .` still remains isolated
    // from the installed app under the dedicated Source directory.
    userData: input.explicitUserData
      ? isAbsolute(input.explicitUserData) ? input.explicitUserData : resolve(input.explicitUserData)
      : join(input.appData, SOURCE_PREVIEW_APP_NAME),
    appUserModelId: SOURCE_PREVIEW_APP_USER_MODEL_ID,
  };
}

export function explicitUserDataDirectory(argv: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (value.startsWith("--user-data-dir=")) return value.slice("--user-data-dir=".length).trim() || undefined;
    if (value === "--user-data-dir") return argv[index + 1]?.trim() || undefined;
  }
  return undefined;
}
