import { describe, expect, it } from "vitest";
import { buildTurnNavigationMarkers } from "./ConversationViewport";
import type { UiChatTurn } from "../store";

const base = (id: string): UiChatTurn => ({ id, completed: true, running: false, groups: [], activityGroups: [], pending: [], trailing: [], summary: { files: 0, additions: 0, deletions: 0, commands: 0, tools: 0, subagents: 0, failed: 0 } });

describe("conversation turn navigation", () => {
  it("优先标记错误、等待操作、计划和最终回答", () => {
    const turns: UiChatTurn[] = [
      { ...base("answer"), user: { id: "u1", kind: "user", text: "完成任务" }, final: { id: "a1", kind: "assistant", text: "完成" } },
      { ...base("plan"), pending: [{ id: "p1", kind: "plan", text: "步骤", interactive: true }] },
      { ...base("permission"), pending: [{ id: "q1", kind: "question", requestId: 1, questions: [] }] },
      { ...base("error"), trailing: [{ id: "e1", kind: "error", text: "boom" }] },
    ];
    expect(buildTurnNavigationMarkers(turns).map((marker) => marker.kind)).toEqual(["answer", "plan", "permission", "error"]);
  });
});
