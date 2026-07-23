import { describe, expect, it } from "vitest";
import { emptyProfile } from "./ExecutionProfileWorkbench";

describe("ExecutionProfileWorkbench", () => {
  it("creates AppData-scoped editable defaults without enabling Memory or Worktree implicitly", () => {
    expect(emptyProfile("project")).toMatchObject({ scope: "project", readOnly: false, memory: false, worktree: false, subagents: true, mode: "agent" });
  });
});
