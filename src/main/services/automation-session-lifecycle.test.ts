import { describe, expect, it } from "vitest";
import { resolveAutomationSessionAction } from "./automation-session-lifecycle";

describe("scheduled-task session lifecycle", () => {
  it("reuses the mapped session when context should be retained", () => {
    expect(resolveAutomationSessionAction("reuse", true, true)).toBe("reuse");
  });

  it("replaces the mapped session before every fresh-context run", () => {
    expect(resolveAutomationSessionAction("fresh", true, true)).toBe("replace");
  });

  it("creates a session when the mapping is absent or stale", () => {
    expect(resolveAutomationSessionAction("reuse", false, false)).toBe("create");
    expect(resolveAutomationSessionAction("fresh", true, false)).toBe("create");
  });
});
