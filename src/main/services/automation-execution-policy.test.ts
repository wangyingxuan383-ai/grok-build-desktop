import { describe, expect, it } from "vitest";
import type { AutomationExecutionProfile } from "../../shared/types";
import { resolveAutomationExecutionPolicy } from "./automation-execution-policy";

const profile = (patch: Partial<AutomationExecutionProfile>): AutomationExecutionProfile => ({
  modelId: "grok-4.5",
  effort: "",
  mode: "agent",
  permissionPolicy: "auto",
  computerEnabled: false,
  ...patch,
});

describe("scheduled automation execution policy", () => {
  it("makes auto mode fully automatic even when an obsolete secondary policy remains in stored data", () => {
    expect(resolveAutomationExecutionPolicy(profile({ mode: "auto", permissionPolicy: "agent" }))).toEqual({ mode: "auto", permission: "allow" });
    expect(resolveAutomationExecutionPolicy(profile({ mode: "auto", permissionPolicy: "read-only" }))).toEqual({ mode: "auto", permission: "allow" });
  });

  it("preserves explicit restrictions outside auto mode", () => {
    expect(resolveAutomationExecutionPolicy(profile({ permissionPolicy: "read-only" }))).toEqual({ mode: "plan", permission: "deny" });
    expect(resolveAutomationExecutionPolicy(profile({ permissionPolicy: "agent" }))).toEqual({ mode: "agent", permission: "confirm-all" });
    expect(resolveAutomationExecutionPolicy(profile({ permissionPolicy: "auto" }))).toEqual({ mode: "agent", permission: "confirm-risk" });
  });
});
