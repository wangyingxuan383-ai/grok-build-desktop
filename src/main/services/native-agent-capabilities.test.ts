import { expect, it } from "vitest";
import { NativeAgentCapabilities } from "./native-agent-capabilities";

function call(title: string, toolName?: string, rawInput?: unknown, status: "pending" | "in_progress" | "completed" | "failed" = "completed") {
  return { type: "tool-call", sessionId: "parent", tool: { toolCallId: `call-${title}`, title, ...(toolName ? { toolName } : {}), rawInput, status } } as never;
}

it("merges partial native outcomes and excludes transcript replay from current evidence", () => {
  const capabilities = new NativeAgentCapabilities();
  capabilities.record(call("child", "spawn_subagent", { resume_from: "old-child" }, "in_progress"));
  capabilities.record(call("child", undefined, undefined, "failed"));
  expect(capabilities.snapshot("parent").operations.spawn).toMatchObject({ lastOutcome: "failed" });
  expect(capabilities.snapshot("parent").resume.state).toBe("failed");
  capabilities.record({ type: "session-reset", sessionId: "parent" });
  capabilities.record(call("history", "spawn_subagent"), { replaying: true });
  expect(capabilities.snapshot("parent").operations.spawn!.state).toBe("unknown");
  capabilities.record(call("live", "spawn_subagent", undefined, "in_progress"));
  capabilities.record(call("live", undefined, undefined, "completed"));
  expect(capabilities.snapshot("parent").operations.spawn).toMatchObject({ lastOutcome: "completed" });
});

it("requires structured native tool names and keeps each operation outcome scoped to its connection", () => {
  const capabilities = new NativeAgentCapabilities();
  capabilities.record(call("Review subagent implementation"));
  expect(capabilities.snapshot("parent").operations.spawn!.state).toBe("unknown");

  capabilities.record(call("Spawn reviewer", "spawn_subagent", { task: "review" }, "completed"));
  capabilities.record(call("Send follow up", "send_subagent_message", { target: "child" }, "failed"));
  expect(capabilities.snapshot("parent").operations.spawn).toMatchObject({ state: "observed", lastOutcome: "completed" });
  expect(capabilities.snapshot("parent").operations.message).toMatchObject({ state: "observed", lastOutcome: "failed" });
  expect(capabilities.snapshot("other").operations.spawn!.state).toBe("unknown");
  capabilities.release("parent");
  expect(capabilities.snapshot("parent").operations.spawn!.state).toBe("unknown");
});

it("separates observed native resume calls from the feature-gated message extension", () => {
  const capabilities = new NativeAgentCapabilities();
  capabilities.record(call("Continue child", "spawn_subagent", { resume_from: "finished-child" }));
  const snapshot = capabilities.snapshot("parent", { extensions: ["x.ai/subagent/message"] } as never);
  expect(snapshot.resume.state).toBe("observed");
  expect(snapshot.messageExtension).toMatchObject({ state: "advertised", mapped: false });
  expect(snapshot.cancel.state).toBe("unknown");
  expect(capabilities.snapshot("parent").messageExtension.state).toBe("unknown");
});
