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

  it("treats the server queue broadcast as the complete authoritative queue", () => {
    let state = apply(baseState(), { type: "prompt-queue", sessionId: "session", entries: [{ id: "one", sessionId: "session", text: "first", position: 0, createdAt: "2026-01-01T00:00:00Z", state: "queued" }] });
    expect(state.views.session.queue.map((entry: { id: string }) => entry.id)).toEqual(["one"]);
    state = apply(state, { type: "prompt-queue", sessionId: "session", entries: [{ id: "two", sessionId: "session", text: "replacement", position: 0, createdAt: "2026-01-01T00:00:01Z", state: "interjected" }] });
    expect(state.views.session.queue).toEqual([expect.objectContaining({ id: "two", state: "interjected" })]);
  });

  it("keeps sent image previews on the client message and merges the duplicate ACP echo", () => {
    const attachment = { id: "image-1", name: "paste.png", kind: "image" as const, mimeType: "image/png", size: 70, source: "C:\\cache\\paste.png", availability: "ready" as const };
    let state = apply(baseState(), { type: "user-message", sessionId: "session", id: "client-1", clientMessageId: "client-1", text: "look", attachments: [attachment], delivery: "sending" });
    state = apply(state, { type: "user-message", sessionId: "session", text: "look", delivery: "sent" });
    state = apply(state, { type: "user-message-status", sessionId: "session", clientMessageId: "client-1", delivery: "sent" });
    expect(state.views.session.messages).toEqual([expect.objectContaining({ id: "client-1", clientMessageId: "client-1", text: "look", delivery: "sent", attachments: [attachment] })]);
  });

  it("restores attachments onto replayed text and preserves a failed message", () => {
    let state = apply(baseState(), { type: "user-message", sessionId: "session", text: "retry me", delivery: "sent" });
    state = apply(state, { type: "user-attachments-restore", sessionId: "session", entries: [{ clientMessageId: "client-2", text: "retry me", delivery: "failed", attachments: [{ id: "image-2", name: "missing.webp", kind: "image", mimeType: "image/webp", source: "C:\\gone.webp", availability: "missing" }] }] });
    expect(state.views.session.messages).toHaveLength(1);
    expect(state.views.session.messages[0]).toMatchObject({ clientMessageId: "client-2", delivery: "failed", attachments: [expect.objectContaining({ availability: "missing" })] });
  });

  it("merges an ACP image block into the current pure-image user turn without adding a blank duplicate", () => {
    const first = { id: "client-pure", name: "paste.png", kind: "image" as const, mimeType: "image/png", source: "C:\\cache\\paste.png", availability: "ready" as const };
    const echo = { id: "echo", name: "会话图片", kind: "image" as const, mimeType: "image/png", source: "AAAA", isData: true, availability: "ready" as const };
    let state = apply(baseState(), { type: "user-message", sessionId: "session", clientMessageId: "client-pure", text: "", attachments: [first], delivery: "sending" });
    state = apply(state, { type: "user-message", sessionId: "session", text: "", attachments: [echo], delivery: "sent" });
    expect(state.views.session.messages).toHaveLength(1);
    expect(state.views.session.messages[0].attachments).toEqual([first]);
  });

  it("merges duplicate turn completion metadata without inventing legacy durations", () => {
    let state = apply(baseState(), { type: "turn-started", sessionId: "session", presentation: { turnId: "turn-1", clientMessageId: "message-1", ordinal: 0, startedAt: "2026-07-22T00:00:00.000Z" } });
    state = apply(state, { type: "turn-completed", sessionId: "session", presentation: { turnId: "turn-1", clientMessageId: "message-1", ordinal: 0, startedAt: "2026-07-22T00:00:00.000Z", completedAt: "2026-07-22T00:00:01.250Z", durationMs: 1250, outcome: "completed" } });
    state = apply(state, { type: "turn-completed", sessionId: "session", presentation: { turnId: "turn-1", clientMessageId: "message-1", ordinal: 0, startedAt: "2026-07-22T00:00:00.000Z", completedAt: "2026-07-22T00:00:01.250Z", durationMs: 1250, outcome: "completed" } });
    expect(state.views.session.turnPresentations).toEqual([expect.objectContaining({ turnId: "turn-1", durationMs: 1250 })]);
  });

  it("keeps retry lifecycle updates visible and replaces the active retry state", () => {
    let state = apply(baseState(), { type: "turn-started", sessionId: "session", presentation: { turnId: "turn-retry", ordinal: 0, startedAt: "2026-07-27T00:00:00.000Z" } });
    state = apply(state, { type: "turn-retry", sessionId: "session", attempt: 1, maxAttempts: 3, delayMs: 500, reason: "HTTP 429" });
    state = apply(state, { type: "turn-retry", sessionId: "session", attempt: 2, maxAttempts: 3, delayMs: 1000, reason: "HTTP 429" });
    expect(state.views.session.messages).toEqual([expect.objectContaining({ kind: "retry", attempt: 2, maxAttempts: 3, delayMs: 1000 })]);
  });

  it("restores the durable visible projection after an incomplete ACP replay", () => {
    let state = apply(baseState(), { type: "user-message", sessionId: "session", clientMessageId: "client", text: "hello", delivery: "sent" });
    state = apply(state, {
      type: "conversation-projection-restore",
      sessionId: "session",
      projection: {
        version: 1,
        sessionId: "session",
        updatedAt: "2026-07-31T00:00:00.000Z",
        events: [
          { type: "user-message", sessionId: "session", clientMessageId: "client", text: "hello", delivery: "sent" },
          { type: "message-chunk", sessionId: "session", text: "visible partial answer" },
          { type: "error", sessionId: "session", message: "cancelled" },
        ],
      },
    });
    expect(state.views.session.messages).toEqual([
      expect.objectContaining({ kind: "user", text: "hello" }),
      expect.objectContaining({ kind: "assistant", text: "visible partial answer" }),
      expect.objectContaining({ kind: "error", text: "cancelled" }),
      expect.objectContaining({ kind: "turn-end" }),
    ]);
  });

  it("restores the durable projection immediately after a transport reset", () => {
    let state = apply(baseState(), { type: "user-message", sessionId: "session", text: "before reset", delivery: "sent" });
    state = apply(state, { type: "message-chunk", sessionId: "session", text: "partial answer" });
    const projection = {
      version: 1 as const,
      sessionId: "session",
      updatedAt: "2026-07-31T00:00:00.000Z",
      events: [
        { type: "user-message", sessionId: "session", text: "before reset", delivery: "sent" as const },
        { type: "message-chunk", sessionId: "session", text: "partial answer" },
      ],
    };
    state = apply(state, { type: "session-reset", sessionId: "session" });
    expect(state.views.session.messages).toEqual([]);
    state = apply(state, { type: "conversation-projection-restore", sessionId: "session", projection });
    expect(state.views.session.messages).toEqual([
      expect.objectContaining({ kind: "user", text: "before reset" }),
      expect.objectContaining({ kind: "assistant", text: "partial answer" }),
    ]);
  });

  it("shows an explicit recovery state instead of promoting it to a global error", () => {
    const state = apply(baseState(), {
      type: "history-recovery",
      sessionId: "session",
      status: "unavailable",
      message: "历史内容无法可靠关联",
    });
    expect(state.error).toBe("");
    expect(state.views.session.messages).toEqual([
      expect.objectContaining({ kind: "recovery", status: "unavailable", text: "历史内容无法可靠关联" }),
    ]);
  });

  it("keeps plan documents separate from actionable plan decisions and resolves by request id", () => {
    let state = apply(baseState(), { type: "plan", sessionId: "session", text: "draft plan" });
    state = apply(state, { type: "plan", sessionId: "session", requestId: 41, text: "approve this plan" });
    expect(state.views.session.messages).toEqual([
      expect.objectContaining({ kind: "plan", interactive: false, text: "draft plan" }),
      expect.objectContaining({ kind: "plan", requestId: 41, interactive: true, text: "approve this plan" }),
    ]);
    state = apply(state, { type: "interaction-resolved", sessionId: "session", interaction: "plan", requestId: 41, outcome: "approved" });
    const [turn] = buildChatTurns(state.views.session.messages, "working");
    expect(turn?.pending).toEqual([]);
    expect(turn?.groups.flatMap((group: any) => group.items)).toEqual([expect.objectContaining({ text: "draft plan" })]);
  });

  it("expires process-local permission requests restored from disk", () => {
    const state = apply(baseState(), {
      type: "conversation-projection-restore", sessionId: "session",
      projection: { version: 1, sessionId: "session", updatedAt: "2026-08-01T00:00:00Z", events: [
        { type: "permission", sessionId: "session", request: { requestId: 9, sessionId: "session", toolCall: {}, options: [] } },
      ] },
    });
    expect(state.views.session.messages[0]).toMatchObject({ kind: "permission", resolved: true });
    expect(buildChatTurns(state.views.session.messages, "idle")[0]?.pending).toEqual([]);
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
    expect(turn?.summary).toMatchObject({ files: 0, tools: 1, failed: 0 });
    expect(turn?.completed).toBe(true);
  });

  it("aggregates ACP file diff line counts into the turn summary", () => {
    const [turn] = buildChatTurns([
      { id: "u", kind: "user", text: "edit" },
      { id: "t", kind: "tool", tool: { toolCallId: "t", title: "Write file", kind: "edit", status: "completed", additions: 3, deletions: 2 } },
    ]);
    expect(turn?.summary).toMatchObject({ files: 1, additions: 3, deletions: 2 });
  });

  it("does not replace a streamed tool title with the generic final-update label", () => {
    let state = apply(baseState(), { type: "tool-call", sessionId: "session", tool: { toolCallId: "t", title: "编辑 src/app.ts", kind: "edit", status: "in_progress", additions: 3, deletions: 2 } });
    state = apply(state, { type: "tool-call", sessionId: "session", tool: { toolCallId: "t", title: "工具调用", kind: "edit", status: "completed" } });
    expect(state.views.session.messages[0]).toMatchObject({
      kind: "tool",
      tool: { title: "编辑 src/app.ts", additions: 3, deletions: 2, status: "completed" },
    });
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

  it("coalesces consecutive legacy process-only turns into one historical record", () => {
    const turns = buildChatTurns([
      { id: "tool-1", kind: "tool", tool: { toolCallId: "tool-1", title: "Read one", kind: "read", status: "completed" } },
      { id: "end-1", kind: "turn-end" },
      { id: "tool-2", kind: "tool", tool: { toolCallId: "tool-2", title: "Read two", kind: "read", status: "failed" } },
      { id: "end-2", kind: "turn-end" },
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ legacySegments: 2, summary: { files: 0, failed: 1 } });
  });

  it("binds persisted timing to the matching client user message", () => {
    const [turn] = buildChatTurns([{ id: "message-1", clientMessageId: "message-1", kind: "user", text: "hello" }], "working", [{ turnId: "turn-1", clientMessageId: "message-1", ordinal: 4, startedAt: "2026-07-22T00:00:00.000Z" }]);
    expect(turn?.presentation?.turnId).toBe("turn-1");
  });
});
