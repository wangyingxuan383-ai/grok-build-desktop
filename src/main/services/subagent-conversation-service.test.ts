import { mkdtemp, mkdir, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubagentConversationService } from "./subagent-conversation-service";
import { ConversationProjectionService } from "./conversation-projection-service";

const roots: string[] = [];
const node = { id: "session:parent:subagent:native", parentId: "session:parent", sessionId: "parent", childSessionId: "child", title: "检查", status: "completed" as const, summary: "摘要" };
async function temporary() { const root = await mkdtemp(join(tmpdir(), "grok-child-view-")); roots.push(root); return root; }
async function updates(root: string, workspace: string, id: string, rows: unknown[]) {
  const directory = join(root, workspace, id); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "updates.jsonl"), rows.map(row => JSON.stringify(row)).join("\n"));
}
const update = (sessionId: string, value: object) => ({ params: { sessionId, update: value } });
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe("read-only native child conversation", () => {
  it("refreshes native child progress even when a Desktop projection already exists", async () => {
    const root=await temporary();
    const projection=async()=>({version:2 as const,sessionId:"child",updatedAt:"",events:[{type:"message-chunk",sessionId:"child",text:"stale cached answer"}]});
    const service=new SubagentConversationService(async()=>({...node,status:"running"}),projection,root);
    await updates(root,"workspace","child",[update("child",{sessionUpdate:"agent_message_chunk",content:{text:"live first"}})]);
    expect(JSON.stringify(await service.read(node.id))).toContain("live first");
    await updates(root,"workspace","child",[update("child",{sessionUpdate:"agent_message_chunk",content:{text:"live next"}})]);
    const refreshed=await service.read(node.id);
    expect(refreshed.source).toBe("cli-updates");
    expect(JSON.stringify(refreshed)).toContain("live next");
    expect(JSON.stringify(refreshed)).not.toContain("stale cached answer");
  });
  it("uses only the child projection and does not request the parent history", async () => {
    const projection = vi.fn(async (sessionId: string) => ({version: 2 as const, sessionId, updatedAt: "", events: [{type: "message-chunk", sessionId, text: "child answer"}]}));
    const result = await new SubagentConversationService(async () => node, projection).read(node.id);
    expect(projection).toHaveBeenCalledExactlyOnceWith("child");
    expect(result).toMatchObject({parentSessionId: "parent", childSessionId: "child", source: "desktop-projection"});
  });
  it.each([undefined, "parent", "../parent"])("never falls back to parent when child identity is %s", async childSessionId => {
    const projection = vi.fn();
    const result = await new SubagentConversationService(async () => ({...node, childSessionId}), projection).read(node.id);
    expect(result.source).toBe("summary-only"); expect(projection).not.toHaveBeenCalled();
  });
  it("reads native envelopes, merges partial tool updates and ignores another session", async () => {
    const root = await temporary();
    await updates(root, "workspace", "child", [
      update("parent", {sessionUpdate: "agent_message_chunk", content: {text: "wrong parent"}}),
      update("child", {sessionUpdate: "user_message_chunk", content: {text: "inspect"}}),
      update("child", {sessionUpdate: "tool_call", toolCallId: "tool-1", title: "read_file", rawInput: {path: "a.ts"}, status: "in_progress"}),
      update("child", {sessionUpdate: "tool_call_update", toolCallId: "tool-1", status: "completed", rawOutput: "done"}),
      update("child", {sessionUpdate: "agent_message_chunk", content: {text: "child result"}}),
      update("child", {sessionUpdate: "turn_completed"}),
    ]);
    const result = await new SubagentConversationService(async () => node, async () => undefined, root).read(node.id);
    expect(result.source).toBe("cli-updates");
    expect(JSON.stringify(result)).not.toContain("wrong parent");
    expect(result.projection?.events[2]).toMatchObject({type:"tool-call", tool: {title: "read_file", rawInput: {path: "a.ts"}, status: "completed", output: "done"}});
    expect(result.projection?.events.at(-1)).toMatchObject({type: "turn-completed", sessionId: "child"});
  });
  it("rejects an unrelated projection and ambiguous migrated native copies", async () => {
    const root = await temporary();
    for (const workspace of ["old", "new"]) await updates(root, workspace, "child", [update("child", {sessionUpdate: "agent_message_chunk", content: {text: "duplicate"}})]);
    const result = await new SubagentConversationService(async () => node, async () => ({version: 2, sessionId:"parent", updatedAt:"", events:[{text:"parent"}]}), root).read(node.id);
    expect(result.source).toBe("summary-only"); expect(result.projection).toBeUndefined();
  });
  it("returns summary for missing history and rejects deleted dashboard nodes", async () => {
    const root = await temporary();
    expect((await new SubagentConversationService(async () => node, async () => undefined, root).read(node.id)).source).toBe("summary-only");
    await expect(new SubagentConversationService(async () => undefined, async () => undefined, root).read(node.id)).rejects.toThrow("已不存在");
  });
  it("inspection leaves pending execution and persisted files untouched", async () => {
    const root = await temporary();
    const interruptQueue = vi.fn();
    const service = new ConversationProjectionService(root, {interruptQueue, isSessionActive: () => false});
    await service.record({type:"user-message", sessionId:"child", text:"inspect"});
    await service.record({type:"tool-call", sessionId:"child", tool:{toolCallId:"t",title:"read",status:"in_progress"}});
    const before = await readdir(join(root, "conversation-projections"));
    const result = await service.inspect("child");
    expect(interruptQueue).not.toHaveBeenCalled();
    expect(result?.events.at(-1)).toMatchObject({tool:{status:"in_progress"}});
    expect(await readdir(join(root, "conversation-projections"))).toEqual(before);
    await service.dispose();
  });
});

describe("sub-agent record files", () => {
  async function subagentFiles(root: string, parent: string, child: string, meta: object, output?: object) {
    const directory = join(root, "workspace", parent, "subagents", child); await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "meta.json"), JSON.stringify(meta));
    if (output) await writeFile(join(directory, "output.json"), JSON.stringify(output));
  }
  it("shows the delegated prompt and the final answer as a two-message exchange", async () => {
    const root = await temporary();
    await subagentFiles(root, "parent", "child", { description: "Review scheduling", prompt: "Read the scheduler.", status: "completed", subagent_type: "explore", effective_model_id: "grok-4.5", duration_ms: 1200, tool_calls: 7, turns: 2 }, { schema_version: 1, output: "All good." });
    const result = await new SubagentConversationService(async () => node, async () => undefined, root).read(node.id);
    expect(result).toMatchObject({ source: "cli-subagent-files", title: "Review scheduling", status: "completed", details: { type: "explore", model: "grok-4.5", toolCalls: 7, turns: 2, durationMs: 1200 } });
    expect(result.projection?.events).toMatchObject([{ type: "user-message", text: "Read the scheduler." }, { type: "message-chunk", text: "All good." }, { type: "turn-completed" }]);
  });
  it("opens a card whose dashboard record is missing by parsing the node id, and reports a running child without output", async () => {
    const root = await temporary();
    await subagentFiles(root, "parent", "kid", { description: "Still working", prompt: "Explore.", status: "running" });
    const result = await new SubagentConversationService(async () => undefined, async () => undefined, root).read("session:parent:subagent:kid");
    expect(result).toMatchObject({ source: "cli-subagent-files", parentSessionId: "parent", childSessionId: "kid", status: "running" });
    expect(result.projection?.events).toHaveLength(1);
    expect(result.notice).toContain("仍在运行");
  });
  it("does not read outside the sessions root for an unsafe identity", async () => {
    const root = await temporary();
    await expect(new SubagentConversationService(async () => undefined, async () => undefined, root).read("session:parent:subagent:../escape")).rejects.toThrow("已不存在");
  });
});
