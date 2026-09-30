import type { UiMessage } from "./store";

export function readonlyMessage(message: UiMessage, location = "所属会话"): UiMessage {
  if (message.kind === "plan") return {id:message.id,kind:"assistant",text:`计划（只读）\n\n${message.text}`};
  if (message.kind === "permission" || message.kind === "question" || message.kind === "mcp-elicitation") {
    return {id:message.id,kind:"assistant",text:`确认记录（只读）：${message.resolved ? message.resolution || "已处理" : `状态未确认，请返回${location}处理`}`};
  }
  return message;
}
