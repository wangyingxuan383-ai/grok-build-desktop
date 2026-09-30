import type { ChatEvent, ToolCallState } from "../../shared/types";

export function historyEvent(update: any, sessionId: string, tools: Map<string, ToolCallState>): ChatEvent | undefined {
  if (!update || typeof update !== "object") return undefined;
  const text = typeof update.content?.text === "string" ? update.content.text : typeof update.content === "string" ? update.content : "";
  if (update.sessionUpdate === "user_message_chunk" && text) return { type: "user-message", sessionId, text };
  if (update.sessionUpdate === "agent_message_chunk" && text) return { type: "message-chunk", sessionId, text };
  if (update.sessionUpdate === "agent_thought_chunk" && text) return { type: "thought-chunk", sessionId, text };
  if (update.sessionUpdate === "turn_completed") return { type: "turn-completed", sessionId };
  if (["tool_call", "tool_call_update"].includes(update.sessionUpdate) && typeof update.toolCallId === "string") {
    const tool: ToolCallState = { ...(tools.get(update.toolCallId) ?? { toolCallId: update.toolCallId, title: "历史工具", status: "pending" as const }) };
    if (["pending", "in_progress", "completed", "failed"].includes(update.status)) tool.status = update.status;
    if (typeof update.title === "string") tool.title = update.title;
    if (update.rawInput !== undefined) tool.rawInput = update.rawInput;
    if (update.rawOutput !== undefined) tool.output = typeof update.rawOutput === "string" ? update.rawOutput : JSON.stringify(update.rawOutput);
    if (Array.isArray(update.content)) tool.content = update.content;
    tools.set(tool.toolCallId, tool);
    return { type: "tool-call", sessionId, tool };
  }
  return undefined;
}
