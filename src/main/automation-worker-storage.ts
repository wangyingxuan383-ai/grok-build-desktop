import type { App } from "electron";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

type PathApp = Pick<App, "getPath" | "setPath">;
type StorageFileOps = Pick<typeof import("node:fs"), "copyFileSync" | "mkdirSync">;

export interface AutomationWorkerStorage {
  canonicalUserData: string;
  workerSessionData: string;
}

/**
 * safeStorage resolves Chromium's encrypted key through sessionData. Copy the
 * canonical Local State before Electron becomes ready, then keep the worker's
 * remaining browser/session files isolated so it can run beside the GUI.
 */
export function configureAutomationWorkerStorage(electronApp: PathApp, pid = process.pid, fileOps: StorageFileOps = { copyFileSync, mkdirSync }): AutomationWorkerStorage {
  const canonicalUserData = join(electronApp.getPath("appData"), "Grok Build Desktop");
  const workerSessionData = join(electronApp.getPath("temp"), `grok-build-desktop-worker-${pid}`);
  fileOps.mkdirSync(workerSessionData, { recursive: true });
  fileOps.copyFileSync(join(canonicalUserData, "Local State"), join(workerSessionData, "Local State"));
  electronApp.setPath("userData", canonicalUserData);
  electronApp.setPath("sessionData", workerSessionData);
  return { canonicalUserData, workerSessionData };
}
