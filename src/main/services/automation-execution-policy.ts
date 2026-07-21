import type { AutomationExecutionProfile, SessionMode } from "../../shared/types";

export type AutomationPermissionDecision = "allow" | "deny" | "confirm-all" | "confirm-risk";

export interface ResolvedAutomationExecutionPolicy {
  mode: SessionMode;
  permission: AutomationPermissionDecision;
}

/**
 * “自动批准”是完整执行模式，不再叠加一层定时任务权限策略。
 * 只有 Agent/Plan 模式才使用任务自己的确认或只读限制。
 */
export function resolveAutomationExecutionPolicy(profile: AutomationExecutionProfile): ResolvedAutomationExecutionPolicy {
  if (profile.mode === "auto") return { mode: "auto", permission: "allow" };
  if (profile.permissionPolicy === "read-only") return { mode: "plan", permission: "deny" };
  if (profile.permissionPolicy === "agent") return { mode: profile.mode, permission: "confirm-all" };
  return { mode: profile.mode, permission: "confirm-risk" };
}
