import { describe, expect, it } from "vitest";
import type { ChatEvent } from "../../shared/types";
import { buildChatTurns, emptyView, reduceEvent, type UiMessage } from "./store";

function baseState() {
  return {
    loading: false,
    error: "",
    accounts: [],
    sessions: [],
    views: { session: emptyView() },
    activeSessionId: "session",
    login: { running: false },
    updateHistory: [],
    appVersion: "",
    changelog: "",
    attachments: [],
  } as any;
}

function apply(state: any, event: ChatEvent): any {
  return { ...state, ...reduceEvent(state, event) };
}

describe("session event reducer", () => {
  it("settles a subagent when its parent turn completes", () => {
    let state = baseState();
    state = apply(state, { type: "subagent", sessionId: "session", update: { sessionUpdate: "subagent_spawned", subagent_id: "child-1" } });
    expect(state.views.session.messages[0].tool).toMatchObject({ kind: "subagent", status: "in_progress" });

    state = apply(state, { type: "turn-completed", sessionId: "session" });
    expect(state.views.session.messages[0].tool).toMatchObject({ kind: "subagent", status: "completed" });
  });

  it("does not create an unmatchable pending card for an id-less spawn", () => {
    const state = apply(baseState(), { type: "subagent", sessionId: "session", update: { sessionUpdate: "subagent_spawned" } });
    expect(state.views.session.messages).toEqual([]);
  });
});

describe("Codex-style turn grouping", () => {
  it("keeps the last assistant message outside execution details", () => {
    const messages: UiMessage[] = [
      { id: "u", kind: "user", text: "fix it" },
      { id: "a1", kind: "assistant", text: "I will inspect it." },
      { id: "t1", kind: "tool", tool: { toolCallId: "t1", title: "Read file", kind: "read", status: "completed" } },
      { id: "a2", kind: "assistant", text: "Done." },
      { id: "end", kind: "turn-end" },
    ];
    const [turn] = buildChatTurns(messages, "idle");
    expect(turn?.final?.text).toBe("Done.");
    expect(turn?.groups.flatMap((group) => group.items).map((item) => item.id)).toContain("a1");
    expect(turn?.summary).toMatchObject({ files: 1, tools: 1, failed: 0 });
    expect(turn?.completed).toBe(true);
  });

  it("does not force failed tools into an open top-level process", () => {
    const [turn] = buildChatTurns([
      { id: "u", kind: "user", text: "run" },
      { id: "t", kind: "tool", tool: { toolCallId: "t", title: "Command", kind: "execute", status: "failed" } },
      { id: "end", kind: "turn-end" },
    ], "error");
    expect(turn?.running).toBe(false);
    expect(turn?.summary.failed).toBe(1);
    expect(turn?.groups[0]?.failed).toBe(1);
  });

  it("keeps unresolved user actions outside the execution process", () => {
    const [turn] = buildChatTurns([
      { id: "u", kind: "user", text: "edit" },
      { id: "p", kind: "permission", request: { requestId: 1, sessionId: "s", toolCall: {}, options: [] } },
    ], "needs-user");
    expect(turn?.pending.map((item) => item.id)).toEqual(["p"]);
    expect(turn?.groups).toHaveLength(0);
  });
});
