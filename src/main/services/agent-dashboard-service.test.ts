import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionSummary } from "../../shared/types";
import { AgentDashboardService } from "./agent-dashboard-service";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true }))); });

describe("AgentDashboardService", () => {
  it("persists parent/child lifecycle and never reports cold history as running", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-dashboard-")); roots.push(root);
    const service = new AgentDashboardService(root);
    await service.record({ type: "status", sessionId: "s1", status: "working", text: "处理中" });
    await service.record({ type: "tool-call", sessionId: "s1", tool: { toolCallId: "t1", title: "读取文件", status: "completed" } });
    await service.record({ type: "subagent", sessionId: "s1", update: { sessionUpdate: "subagent_spawned", subagent_id: "child", agent_id: "reviewer", model_id: "grok", tool_call_count: 2 } });
    const session = historySession();
    const live = await service.snapshot({ query: { workspacePath: "C:\\repo" }, sessions: [session], liveSessions: [{ sessionId: "s1", cwd: "C:\\repo", modelId: "grok" }], tasks: [], assignments: [], liveCapability: "supported" });
    expect(live.mode).toBe("live");
    expect(live.roots[0]).toMatchObject({ status: "running", toolCount: 2, live: true });
    expect(live.roots[0]!.children[0]!).toMatchObject({ agentId: "reviewer", status: "running", live: true });

    const history = await service.snapshot({ query: { workspacePath: "C:\\repo" }, sessions: [session], liveSessions: [], tasks: [], assignments: [], liveCapability: "unknown" });
    expect(history.mode).toBe("history");
    expect(history.roots[0]!.status).toBe("unknown");
    expect(history.roots[0]!.children[0]!.status).toBe("unknown");
    expect(history.roots[0]!.live).toBe(false);
  });

  it("filters by child Agent and clears only UI lifecycle state", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-dashboard-")); roots.push(root);
    const service = new AgentDashboardService(root);
    await service.record({ type: "subagent", sessionId: "s1", update: { sessionUpdate: "subagent_finished", subagent_id: "child", agent_id: "researcher", duration_ms: 100, output: "done" } });
    const input = { query: { workspacePath: "C:\\repo", agentId: "researcher" }, sessions: [historySession()], liveSessions: [], tasks: [], assignments: [], liveCapability: "unknown" as const };
    expect((await service.snapshot(input)).roots).toHaveLength(1);
    await service.clear("session:s1");
    const after = await service.snapshot({ ...input, query: { workspacePath: "C:\\repo" } });
    expect(after.roots).toHaveLength(1);
    expect(after.roots[0]!.children).toHaveLength(0);
  });
});

function historySession(): SessionSummary {
  return { id: "s1", cwd: "C:\\repo", title: "会话", createdAt: "2026-07-22T00:00:00.000Z", updatedAt: "2026-07-22T00:01:00.000Z", messageCount: 2, status: "cold" };
}
