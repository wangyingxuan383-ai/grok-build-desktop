import { describe, expect, it } from "vitest";
import type { UiMessage } from "./store";
import { buildChatTurns } from "./store";
import { buildTurnNavigationMarkers, shouldFollowConversation } from "./components/ConversationViewport";
import { toThumbnailUrl } from "./components/MessageCard";

function largeConversation(turnCount: number): UiMessage[] {
  return Array.from({ length: turnCount }, (_, index): UiMessage[] => [
    { id: `user-${index}`, clientMessageId: `client-${index}`, kind: "user", text: `请求 ${index}` },
    { id: `thought-${index}`, kind: "thought", text: `思考 ${index}` },
    { id: `tool-${index}`, kind: "tool", tool: { toolCallId: `tool-call-${index}`, title: "Read file", kind: "read_file", status: "completed", readOnly: true } },
    { id: `answer-${index}`, kind: "assistant", text: `回答 ${index}` },
    ...(index % 10 === 0 ? [{ id: `media-${index}`, kind: "media" as const, media: "image" as const, source: `grok-media://access/00000000-0000-0000-0000-${String(index).padStart(12, "0")}` }] : []),
    { id: `end-${index}`, kind: "turn-end" },
  ]).flat();
}

describe("current conversation regression fixture", () => {
  it("keeps 300 completed turns grouped without orphan/empty process rows", () => {
    const turns = buildChatTurns(largeConversation(300));
    expect(turns).toHaveLength(300);
    expect(turns.every((turn) => turn.completed && !turn.running && turn.final?.text.startsWith("回答"))).toBe(true);
    expect(turns.every((turn) => turn.groups.every((group) => group.items.length > 0))).toBe(true);
    expect(turns[0]?.trailing).toEqual([expect.objectContaining({ kind: "media" })]);
    expect(buildTurnNavigationMarkers(turns)).toHaveLength(300);
  });

  it("does not follow remounts or late image loads while the reader is away from bottom", () => {
    expect(shouldFollowConversation(false, false)).toBe(false);
    expect(shouldFollowConversation(true, false)).toBe(true);
    expect(shouldFollowConversation(false, true)).toBe(true);
    const original = "grok-media://access/12345678-1234-1234-1234-123456789abc";
    expect(toThumbnailUrl(original)).toBe(`${original}?variant=thumbnail`);
    expect(toThumbnailUrl(original)).toBe(toThumbnailUrl(original));
  });
});
