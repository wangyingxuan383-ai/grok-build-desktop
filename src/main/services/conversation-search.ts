import type { ChatEvent, ConversationProjection } from "../../shared/types";

/**
 * Builds a bounded, text-only index for Desktop projection search.  Media
 * payloads, attachment bytes and arbitrary tool objects are deliberately not
 * serialized into the index.
 */
export function conversationProjectionMatches(projection: ConversationProjection | undefined, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle || !projection) return false;
  return projection.events.some((event) => isChatEventRecord(event)
    && searchableEventText(event).toLocaleLowerCase().includes(needle));
}

export function searchableEventText(event: ChatEvent): string {
  switch (event.type) {
    case "user-message":
      return [event.text, ...(event.attachments ?? []).map((item) => item.name)].join("\n");
    case "interjection":
      return [event.text, ...(event.attachments ?? []).map((item) => item.name)].join("\n");
    case "message-chunk":
    case "thought-chunk":
    case "plan":
    case "session-recap":
      return event.text;
    case "error":
      return [event.message, event.failure?.message, event.failure?.providerId, event.failure?.traceId].filter(Boolean).join("\n");
    case "tool-call":
      return [event.tool.title, event.tool.error, ...(event.tool.locations ?? []).map((item) => item.path ?? "")].filter(Boolean).join("\n");
    case "command-output":
      return `${event.command}\n${event.output}`;
    case "history-recovery":
    case "session-hydration":
      return event.message ?? "";
    case "turn-retry":
      return event.reason ?? "";
    case "compact-status":
      return `压缩 ${event.trigger ?? ""} ${event.status} ${event.message ?? ""}`;
    case "follow-ups":
      return event.suggestions.map((item) => item.text).join("\n");
    case "runtime-update":
      return `${event.update.name}\n${event.update.summary ?? ""}`;
    case "prompt-queue":
      return event.entries.map((item) => item.text).join("\n");
    default:
      return "";
  }
}

function isChatEventRecord(event: Record<string, unknown>): event is ChatEvent {
  return typeof event.type === "string" && typeof event.sessionId === "string";
}
