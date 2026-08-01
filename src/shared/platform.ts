/** Cross-platform helpers for the macOS / Windows / Linux desktop port. */

export type DesktopPlatform = "win32" | "darwin" | "linux" | "other";

export function desktopPlatform(platform = process.platform): DesktopPlatform {
  if (platform === "win32" || platform === "darwin" || platform === "linux") return platform;
  return "other";
}

export function isWindows(platform = process.platform): boolean {
  return platform === "win32";
}

export function isMacOS(platform = process.platform): boolean {
  return platform === "darwin";
}

export function isLinux(platform = process.platform): boolean {
  return platform === "linux";
}

/** Official public releases target Windows x64; other platforms are community ports. */
export function isOfficialReleasePlatform(platform = process.platform, arch = process.arch): boolean {
  return platform === "win32" && arch === "x64";
}

export function grokCliBinaryName(platform = process.platform): string {
  return platform === "win32" ? "grok.exe" : "grok";
}

export function computerHostRelativePath(platform = process.platform, arch = process.arch): string {
  if (platform === "win32") return "native/win-x64/GrokComputerHost.exe";
  if (platform === "darwin") return arch === "arm64" ? "native/darwin-arm64/GrokComputerHost" : "native/darwin-x64/GrokComputerHost";
  if (platform === "linux") return "native/linux-x64/GrokComputerHost";
  return "native/unsupported/GrokComputerHost";
}

export function platformLabel(platform = process.platform): string {
  switch (platform) {
    case "win32":
      return "Windows";
    case "darwin":
      return "macOS";
    case "linux":
      return "Linux";
    default:
      return platform;
  }
}

export function credentialBackendLabel(platform = process.platform): string {
  switch (platform) {
    case "win32":
      return "Windows DPAPI（Electron safeStorage）";
    case "darwin":
      return "macOS Keychain（Electron safeStorage）";
    case "linux":
      return "系统密钥环（Electron safeStorage）";
    default:
      return "Electron safeStorage";
  }
}

export function homeEnvPlaceholder(platform = process.platform): string {
  return platform === "win32" ? "%USERPROFILE%" : "$HOME";
}
