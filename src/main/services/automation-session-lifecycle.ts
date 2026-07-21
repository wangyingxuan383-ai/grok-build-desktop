import type { AutomationContextPolicy } from "../../shared/types";

export type AutomationSessionAction = "reuse" | "replace" | "create";

export function resolveAutomationSessionAction(contextPolicy: AutomationContextPolicy, hasMappedSession: boolean, mappedSessionExists: boolean): AutomationSessionAction {
  if (!hasMappedSession || !mappedSessionExists) return "create";
  return contextPolicy === "fresh" ? "replace" : "reuse";
}
