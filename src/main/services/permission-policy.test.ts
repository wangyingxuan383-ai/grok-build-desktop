import { describe, expect, it } from "vitest";
import { resolveModeAfterResume, selectAllowPermissionOption, shouldAutoApproveToolPermissions } from "./permission-policy";

describe("permission policy", () => {
  it("auto-approves Auto and Plan, and asks only in Agent", () => {
    expect(shouldAutoApproveToolPermissions("auto")).toBe(true);
    expect(shouldAutoApproveToolPermissions("plan")).toBe(true);
    expect(shouldAutoApproveToolPermissions("agent", true)).toBe(true);
    expect(shouldAutoApproveToolPermissions("agent")).toBe(false);
  });

  it("selects allow options even when the CLI uses a short allow kind", () => {
    expect(selectAllowPermissionOption([
      { optionId: "deny", kind: "reject_once" },
      { optionId: "yes", kind: "allow" },
    ])?.optionId).toBe("yes");
    expect(selectAllowPermissionOption([
      { optionId: "always", kind: "allow_always" },
      { optionId: "once", kind: "allow_once" },
    ])?.optionId).toBe("always");
  });

  it("keeps Desktop Auto across resume when the CLI only reports default", () => {
    expect(resolveModeAfterResume("auto", "default")).toBe("auto");
    expect(resolveModeAfterResume("auto", undefined)).toBe("auto");
    expect(resolveModeAfterResume("plan", "default")).toBe("plan");
    expect(resolveModeAfterResume("agent", "plan")).toBe("plan");
    expect(resolveModeAfterResume(undefined, "default")).toBe("agent");
  });
});
