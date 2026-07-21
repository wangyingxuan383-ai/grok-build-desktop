import { describe, expect, it } from "vitest";
import type { SessionSummary } from "../../shared/types";
import { groupSessionsByOrigin, sessionSourceLabel } from "./session-groups";

function session(id: string, originKind?: SessionSummary["originKind"]): SessionSummary {
  return { id, cwd: "D:\\Workspace", title: id, createdAt: "", updatedAt: "", messageCount: 0, status: "cold", originKind };
}

describe("session origin groups", () => {
  it("keeps ordinary and fork sessions together while isolating generated sources", () => {
    const groups = groupSessionsByOrigin([
      session("normal"), session("fork", "fork"), session("task", "automation"), session("codex", "codex-continuation"), session("other", "other"),
    ]);
    expect(groups.find((value) => value.kind === "normal")?.sessions.map((value) => value.id)).toEqual(["normal", "fork"]);
    expect(groups.find((value) => value.kind === "automation")?.sessions.map((value) => value.id)).toEqual(["task"]);
    expect(groups.find((value) => value.kind === "codex-continuation")?.sessions.map((value) => value.id)).toEqual(["codex"]);
    expect(sessionSourceLabel(session("task", "automation"))).toBe("任务");
    expect(sessionSourceLabel(session("codex", "codex-continuation"))).toBe("Codex 接力");
  });
});
