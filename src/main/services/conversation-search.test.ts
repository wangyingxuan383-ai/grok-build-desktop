import { describe, expect, it } from "vitest";
import type { ConversationProjection } from "../../shared/types";
import { conversationProjectionMatches, searchableEventText } from "./conversation-search";

describe("conversation projection search", () => {
  const projection: ConversationProjection = {
    version: 2,
    sessionId: "s1",
    updatedAt: "2026-08-10T00:00:00.000Z",
    events: [
      { type: "user-message", sessionId: "s1", text: "检查登录流程", attachments: [{ id: "a", name: "流程图.png", kind: "image", mimeType: "image/png", size: 1, previewSource: "grok-media://access/00000000-0000-0000-0000-000000000000", loadState: "ready" }] },
      { type: "message-chunk", sessionId: "s1", text: "已修复 OAuth 单实例窗口。" },
      { type: "tool-call", sessionId: "s1", tool: { toolCallId: "t", title: "修改 auth-service.ts", status: "completed", locations: [{ path: "src/auth-service.ts" }] } },
    ],
  };

  it("matches user text, assistant text, attachment names and file paths", () => {
    expect(conversationProjectionMatches(projection, "OAuth")).toBe(true);
    expect(conversationProjectionMatches(projection, "流程图")).toBe(true);
    expect(conversationProjectionMatches(projection, "auth-service")).toBe(true);
    expect(conversationProjectionMatches(projection, "不存在")).toBe(false);
  });

  it("does not index media handles or raw media payloads", () => {
    expect(searchableEventText({ type: "media", sessionId: "s1", media: "image", source: "secret-path.png" })).toBe("");
  });
});
