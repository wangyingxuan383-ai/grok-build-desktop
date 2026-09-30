import type { ChatEvent, CliRuntimeHandshake } from "../../shared/types";

const operations = {
  spawn: "spawn_subagent", result: "get_command_or_subagent_output", message: "send_subagent_message",
} as const;
type Operation = keyof typeof operations;
type ObservedOperation = { toolCallId: string; outcome: "pending" | "in_progress" | "completed" | "failed" };
type CliIdentity = { executableName: string; pathFingerprint: string; version?: string; sha256?: string };

/** Tool names are candidates; only structured calls on this ACP connection supply evidence. */
export class NativeAgentCapabilities {
  private readonly observed = new Map<string, Map<Operation, ObservedOperation>>();
  private readonly resumed = new Map<string, string>();
  private readonly calls = new Map<string, Map<string, { name: string; resume: boolean }>>();

  record(event: ChatEvent, context: { replaying?: boolean } = {}): void {
    if (event.type === "session-reset") { this.release(event.sessionId); return; }
    if (context.replaying) return;
    if (!event.sessionId || event.type !== "tool-call") return;
    const rawInput = event.tool.rawInput && typeof event.tool.rawInput === "object"
      ? event.tool.rawInput as Record<string, unknown>
      : undefined;
    // `title` is intentionally excluded: it is presentation text and has caused
    // historical tasks titled "Review subagent..." to look like CLI evidence.
    const calls = this.calls.get(event.sessionId) ?? new Map<string, { name: string; resume: boolean }>();
    const previous = calls.get(event.tool.toolCallId);
    const names = [event.tool.toolName, rawInput?.name, previous?.name].filter((value): value is string => typeof value === "string");
    const tools = this.observed.get(event.sessionId) ?? new Map<Operation, ObservedOperation>();
    const args = rawInput?.arguments && typeof rawInput.arguments === "object"
      ? rawInput.arguments as Record<string, unknown>
      : rawInput;
    for (const name of names) {
      const operation = (Object.entries(operations).find(([, tool]) => tool === name)?.[0]) as Operation | undefined;
      if (!operation) continue;
      const resume = previous?.resume || (typeof args?.resume_from === "string" && Boolean(args.resume_from));
      calls.set(event.tool.toolCallId, { name, resume });
      tools.set(operation, { toolCallId: event.tool.toolCallId, outcome: event.tool.status });
      if (operation === "spawn" && resume) {
        this.resumed.set(event.sessionId, event.tool.status === "failed" ? "failed" : "observed");
      }
    }
    this.observed.set(event.sessionId, tools);
    if (event.tool.status === "completed" || event.tool.status === "failed") calls.delete(event.tool.toolCallId);
    this.calls.set(event.sessionId, calls);
  }

  release(sessionId: string): void {
    this.observed.delete(sessionId);
    this.resumed.delete(sessionId);
    this.calls.delete(sessionId);
  }

  snapshot(sessionId: string, handshake?: CliRuntimeHandshake, cli?: CliIdentity) {
    const observed = this.observed.get(sessionId);
    const cancelAdvertised = handshake?.extensions.includes("x.ai/subagent/cancel") === true;
    const messageAdvertised = handshake?.extensions.includes("x.ai/subagent/message") === true;
    return {
      source: "native-cli", liveVerified: false,
      cli: {
        ...(cli ?? {}),
        initializeResponse: handshake ? "received" : "unknown",
        reportedAgentVersion: handshake?.agentVersion,
        checkedAt: handshake?.checkedAt,
      },
      operations: Object.fromEntries(Object.entries(operations).map(([key, tool]) => {
        const last = observed?.get(key as Operation);
        return [key, {
          tool,
          state: last ? "observed" : "unknown",
          ...(last ? { lastOutcome: last.outcome, toolCallId: last.toolCallId } : {}),
          reason: last
            ? "当前 ACP 连接观察到结构化原生工具调用；结果状态单独列出，不代表端到端任务成功"
            : "当前连接尚未观察到结构化工具调用；以该 CLI 会话实际提供的工具为准",
        }];
      })),
      cancel: {
        method: "x.ai/subagent/cancel",
        state: cancelAdvertised ? "advertised" : "unknown",
        reason: cancelAdvertised ? "当前 CLI 初始化响应声明此扩展；实际取消结果仍按操作回执判断" : "当前 CLI 初始化响应未声明该扩展",
      },
      resume: {
        tool: "spawn_subagent", argument: "resume_from",
        state: this.resumed.get(sessionId) ?? "unknown",
        reason: "只认可结构化 spawn_subagent 调用中的 resume_from；继续已完成的同类型子智能体，不等同恢复任意会话。",
      },
      messageExtension: {
        method: "x.ai/subagent/message", state: messageAdvertised ? "advertised" : "unknown", mapped: false,
        deliverySemantics: { queue: "unknown", immediate: "unknown", wake: "unknown" },
        reason: messageAdvertised
          ? "当前握手声明此扩展，但 Desktop 尚未调用它；原生 send_subagent_message 工具仍由 CLI/模型负责"
          : "源码中的候选接口未在当前 CLI 握手中声明；不猜测请求参数或排队/唤醒语义",
      },
      computerInheritance: {
        allowed: false, enforcement: "parent hook proof required for each Desktop MCP call", liveVerified: false,
        reason: "策略禁止继承；CLI 父子身份合同尚需实测，不将一次父调用通过视为隔离验收",
      },
    };
  }
}
