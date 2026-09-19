import type { AutomationTaskInput, SessionExecutionProfile } from "../../shared/types";
import type { CompiledExecutionProfile } from "./execution-profile-service";
import { resolveAutomationExecutionPolicy } from "./automation-execution-policy";

/** The stored, displayed task fields and the frozen CLI profile share one resolution. */
export function resolveAutomationProfile(input: AutomationTaskInput, compiled: Pick<CompiledExecutionProfile, "profile" | "mode" | "modelId" | "effort">): AutomationTaskInput {
  const selected = Boolean(input.executionProfileId && !input.frozenExecutionProfile);
  const profile = {
    ...input.profile,
    modelId: selected ? compiled.modelId || input.profile.modelId : input.profile.modelId,
    effort: selected ? compiled.effort || input.profile.effort : input.profile.effort,
    mode: selected ? compiled.mode : input.profile.mode,
  };
  profile.mode = resolveAutomationExecutionPolicy(profile).mode;
  return { ...input, profile, frozenExecutionProfile: automationRuntimeProfile(profile, compiled.profile) };
}

export function automationRuntimeProfile(profile: AutomationTaskInput["profile"], base: SessionExecutionProfile): SessionExecutionProfile {
  return { ...base, mode: resolveAutomationExecutionPolicy(profile).mode, modelId: profile.modelId, effort: profile.effort };
}
