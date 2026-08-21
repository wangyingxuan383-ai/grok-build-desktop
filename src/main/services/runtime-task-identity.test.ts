import { describe, expect, it } from "vitest";
import { stableRuntimeTaskIdentifier } from "./runtime-task-identity";

describe("stableRuntimeTaskIdentifier", () => {
  it("preserves official task and subagent ids", () => {
    expect(stableRuntimeTaskIdentifier({ task_id: "task-1" })).toBe("task-1");
    expect(stableRuntimeTaskIdentifier({ subagentId: "agent-1" })).toBe("agent-1");
  });

  it("keeps legacy id-less rows stable across refreshes", () => {
    const row = { kind: "command", title: "检查构建", command: "npm test" };
    expect(stableRuntimeTaskIdentifier(row, 2)).toBe(stableRuntimeTaskIdentifier({ ...row }, 2));
    expect(stableRuntimeTaskIdentifier(row, 2)).not.toBe(stableRuntimeTaskIdentifier(row, 3));
  });
});
