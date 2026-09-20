import type { ChatEvent, CliRuntimeHandshake } from "../../shared/types";

const operations = {
  spawn: "spawn_subagent", result: "get_command_or_subagent_output", message: "send_subagent_message",
} as const;

/** Documentation names the candidates; only this connection supplies evidence. */
export class NativeAgentCapabilities {
  private readonly observed = new Map<string, Set<string>>();
  record(event: ChatEvent): void {
    if (!event.sessionId || event.type !== "tool-call") return;
    const names = [event.tool.title, (event.tool.rawInput && typeof event.tool.rawInput === "object" ? (event.tool.rawInput as Record<string, unknown>).name : undefined)].filter(value => typeof value === "string") as string[];
    const tools = this.observed.get(event.sessionId) ?? new Set<string>();
    for (const name of names) if (Object.values(operations).includes(name as never)) tools.add(name);
    this.observed.set(event.sessionId, tools);
  }
  release(sessionId: string): void { this.observed.delete(sessionId); }
  snapshot(sessionId: string, handshake?: CliRuntimeHandshake) {
    return {
      source: "native-cli", liveVerified: false,
      operations: Object.fromEntries(Object.entries(operations).map(([operation, tool]) => [operation, {
        tool, state: this.observed.get(sessionId)?.has(tool) ? "observed" : "unknown",
        reason: this.observed.get(sessionId)?.has(tool) ? "当前连接已观察到原生工具调用；未代表端到端验收" : "请以当前 CLI 工具列表为准，尚未观察到调用",
      }])),
      cancel: { method: "x.ai/subagent/cancel", state: handshake?.extensions.includes("x.ai/subagent/cancel") ? "advertised" : "unknown" },
      resume: { state: "unknown", reason: "不将消息工具视为任意子会话恢复能力" },
      computerInheritance: { allowed: false, enforcement: "parent hook proof required for each Desktop MCP call" },
    };
  }
}
