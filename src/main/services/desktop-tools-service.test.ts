import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AutomationTask, SessionMode } from "../../shared/types";
import { DesktopToolsService, type DesktopToolBackend } from "./desktop-tools-service";
import { DesktopToolAuthority } from "./desktop-tool-authority";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture() {
  let mode: SessionMode = "agent";
  const tasks = [{ id: "here", workspace: "C:\\project", registrationStatus: "registered" }, { id: "elsewhere", workspace: "C:\\other" }] as AutomationTask[];
  const backend: DesktopToolBackend = {
    mode: () => mode, list: async () => tasks, create: vi.fn(async (context, input) => ({ ...tasks[0], ...input, workspace: context.cwd, id: "new" } as AutomationTask)),
    update: vi.fn(async (id, patch) => tasks.map(task => task.id === id ? { ...task, ...patch } : task)), remove: vi.fn(async () => []),
    runs: vi.fn(async () => [{ id: "run", taskId: "here", status: "running" as const, scheduledAt: "now" }]),
    cancel: vi.fn(async () => ({ id: "run", taskId: "here", status: "cancelled" as const, scheduledAt: "now" })), capabilities: async () => ({ liveVerified: false }),
  };
  const authority = new DesktopToolAuthority(); authority.bind("parent");
  const service = new DesktopToolsService(backend, "unused-plugin"); cleanup.push(() => service.dispose());
  const injection = await service.injection("C:\\project", (tool, input) => authority.consume(tool, input)); service.bind(injection.leaseId, "parent");
  const server = injection.mcpServers[0] as { url: string; headers: { name: string; value: string }[] };
  const client = new Client({ name: "offline-contract", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: Object.fromEntries(server.headers.map(header => [header.name, header.value])) } }));
  cleanup.push(() => client.close());
  const call = async (name: string, input: Record<string, unknown> = {}) => {
    const grant = authority.authorize({ sessionId: "parent", toolName: `grok_desktop__${name}`, toolInput: input }) as any;
    return client.callTool({ name, arguments: grant.hookSpecificOutput.updatedInput });
  };
  return { client, call, backend, tasks, service, injection, setMode: (next: SessionMode) => { mode = next; } };
}
describe("Desktop MCP wire contract", () => {
  it("discovers tools and filters tasks by workspace", async () => {
    const { client, call } = await fixture();
    expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(expect.arrayContaining(["automation_create", "automation_update", "automation_pause", "automation_delete", "automation_runs", "automation_cancel_run", "capabilities"]));
    const result = await call("automation_list");
    expect(result.isError).toBe(false); expect(JSON.stringify(result)).toContain("here"); expect(JSON.stringify(result)).not.toContain("elsewhere");
  });
  it("validates future intent and never reports failed registration as success", async () => {
    const { call, backend } = await fixture();
    const input = { name: "later", prompt: "check", schedule: { kind: "interval", minutes: 5 }, destination: "current-session" };
    expect((await call("automation_create", input)).isError).toBe(true); expect(backend.create).not.toHaveBeenCalled();
    vi.mocked(backend.create).mockResolvedValue({ id: "failed", registrationStatus: "error", registrationError: "scheduler unavailable" } as AutomationTask);
    const result = await call("automation_create", { ...input, futureIntent: true });
    expect(result.isError).toBe(true); expect(JSON.stringify(result)).toContain("scheduler unavailable");
    expect(backend.create).toHaveBeenCalledWith({ sessionId: "parent", cwd: "C:\\project" }, expect.objectContaining({ destination: "current-session" }));
  });
  it("rejects inherited bare calls, Plan mutations and foreign IDs", async () => {
    const { client, call, setMode, backend } = await fixture();
    expect((await client.callTool({ name: "automation_delete", arguments: { id: "here" } })).isError).toBe(true);
    expect((await call("automation_delete", { id: "elsewhere" })).isError).toBe(true);
    setMode("plan"); expect((await call("automation_delete", { id: "here" })).isError).toBe(true);
    expect(backend.remove).not.toHaveBeenCalled(); expect((await call("automation_list")).isError).toBe(false);
  });
  it("routes edits, pauses, history and cancellation to the existing services", async () => {
    const { call, backend } = await fixture();
    expect((await call("automation_update", { id: "here", name: "new name" })).isError).toBe(false);
    await call("automation_pause", { id: "here", paused: true }); expect(backend.update).toHaveBeenCalledWith("here", { enabled: false });
    await call("automation_runs", { id: "here" });
    expect((await call("automation_cancel_run", { id: "here", runId: "foreign-run" })).isError).toBe(true);
    await call("automation_cancel_run", { id: "here", runId: "run" }); expect(backend.cancel).toHaveBeenCalledExactlyOnceWith("run");
    expect((await call("automation_delete", { id: "here" })).isError).toBe(false); expect(backend.remove).toHaveBeenCalledExactlyOnceWith("here");
  });
  it("supports fresh standalone runs while preserving bound-session context", async () => {
    const { call, backend, tasks } = await fixture();
    const input = { name: "daily check", prompt: "check independently", schedule: { kind: "daily", time: "09:00" }, futureIntent: true, contextPolicy: "fresh" };
    expect((await call("automation_create", { ...input, destination: "standalone" })).isError).toBe(false);
    expect(backend.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ contextPolicy: "fresh" }));
    expect((await call("automation_create", { ...input, destination: "current-session" })).isError).toBe(true);
    expect((await call("automation_update", { id: "here", contextPolicy: "fresh" })).isError).toBe(false);
    tasks[0] = { ...tasks[0]!, destination: "current-session", targetSessionId: "parent", workspace: "C:\\moved" };
    expect((await call("automation_update", { id: "here", contextPolicy: "fresh" })).isError).toBe(true);
    expect(JSON.stringify(await call("automation_list"))).toContain("here");
    expect((await call("automation_pause", { id: "here", paused: true })).isError).toBe(false);
  });
});
