import { describe, expect, it } from "vitest";
import type { AutomationTaskInput, SessionExecutionProfile, SessionMode } from "../../shared/types";
import type { CompiledExecutionProfile } from "./execution-profile-service";
import { automationRuntimeProfile, resolveAutomationProfile } from "./automation-effective-profile";
import { resolveAutomationExecutionPolicy } from "./automation-execution-policy";

const base = { id: "preset", name: "preset", mode: "auto", modelId: "preset-model", effort: "high", allowTools: ["read_file"], denyTools: [], subagents: true, memory: false, worktree: false, allowedPersonaIds: [], subagentIsolation: "workspace", webSearch: "default", scope: "global", readOnly: false } satisfies SessionExecutionProfile;
const compiled = { profile: base, mode: base.mode, modelId: base.modelId, effort: base.effort } satisfies Pick<CompiledExecutionProfile, "profile" | "mode" | "modelId" | "effort">;
const input = { profile: { modelId: "task-model", effort: "low", mode: "agent", permissionPolicy: "agent", computerEnabled: false } } as AutomationTaskInput;
describe("effective scheduled execution configuration", () => {
  it("keeps legacy task choices when no preset is selected", () => {
    const value = resolveAutomationProfile(input, compiled);
    expect(value.profile).toMatchObject({ mode: "agent", modelId: "task-model", effort: "low", computerEnabled: false });
    expect(value.frozenExecutionProfile).toMatchObject({ mode: "agent", modelId: "task-model", effort: "low", allowTools: ["read_file"] });
  });
  it("resolves a newly selected preset once and preserves task edits after binding", () => {
    const value = resolveAutomationProfile({ ...input, executionProfileId: "preset" }, compiled);
    expect(value.profile).toMatchObject({ mode: "auto", modelId: "preset-model", effort: "high" });
    const updated = resolveAutomationProfile({ ...value, profile: { ...value.profile, mode: "agent", modelId: "changed" } }, compiled);
    expect(updated.frozenExecutionProfile).toMatchObject({ mode: "agent", modelId: "changed" });
  });
  it.each(["auto", "agent", "plan"] as SessionMode[])("keeps permission and CLI mode aligned for %s", mode => {
    for (const permissionPolicy of ["auto", "agent", "read-only"] as const) {
      const profile = { ...input.profile, mode, permissionPolicy };
      const effective = resolveAutomationProfile({ ...input, profile }, compiled);
      expect(effective.frozenExecutionProfile?.mode).toBe(resolveAutomationExecutionPolicy(effective.profile).mode);
      expect(automationRuntimeProfile(effective.profile, { ...base, mode: "auto", modelId: "stale" })).toMatchObject({ mode: effective.profile.mode, modelId: effective.profile.modelId });
      expect(effective.profile.mode === "auto").toBe(resolveAutomationExecutionPolicy(effective.profile).permission === "allow");
    }
  });
});
