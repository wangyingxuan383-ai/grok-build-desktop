import type { SessionMode } from "../../shared/types";

export interface PermissionOptionLike {
  optionId?: string;
  kind?: string;
}

/** Agent asks. Auto and Plan auto-approve every tool, including writes. */
export function shouldAutoApproveToolPermissions(mode: SessionMode, planActive = false): boolean {
  return mode === "auto" || mode === "plan" || planActive;
}

export function selectAllowPermissionOption<T extends PermissionOptionLike>(options: T[]): T | undefined {
  return options.find((option) => option.kind === "allow_always")
    ?? options.find((option) => option.kind === "allow_once")
    ?? options.find((option) => /allow/i.test(String(option.kind || option.optionId || "")));
}

export function resolveModeAfterResume(persistedMode: SessionMode | undefined, reportedModeId: string | undefined): SessionMode {
  if (persistedMode === "auto") return "auto";
  if (reportedModeId === "plan" || persistedMode === "plan") return "plan";
  return persistedMode === "agent" ? "agent" : reportedModeId === "plan" ? "plan" : "agent";
}
