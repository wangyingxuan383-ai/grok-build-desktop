import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectNativeSession } from "./native-session-history";

const roots: string[] = [];
async function fixture(content: string) {
  const root = await mkdtemp(join(tmpdir(), "grok-readonly-history-")); roots.push(root);
  const directory = join(root, encodeURIComponent("C:/project"), "old");
  await mkdir(directory, { recursive: true });
  const file = join(directory, "updates.jsonl"); await writeFile(file, content);
  return { root, directory, file };
}
const line = (sessionUpdate: string, text: string, sessionId = "old") => JSON.stringify({ params: { sessionId, update: { sessionUpdate, content: { text } } } });
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
describe("native history inspection", () => {
  it("reads the owning project, merges user chunks and keeps tool updates without writing", async () => {
    const content = [line("user_message_chunk", "hello"), line("user_message_chunk", " world"), line("agent_message_chunk", "answer"), JSON.stringify({ sessionId: "old", sessionUpdate: "tool_call", toolCallId: "t", title: "Read", status: "in_progress" }), JSON.stringify({ sessionId: "old", sessionUpdate: "tool_call_update", toolCallId: "t", status: "completed", rawOutput: "done" })].join("\n");
    const { root, directory, file } = await fixture(content);
    const result = await inspectNativeSession(root, "c:\\project\\", "old");
    expect(result?.events[1]).toMatchObject({ type: "user-message", text: "hello world" });
    expect(result?.events.at(-1)).toMatchObject({ type: "tool-call", tool: { title: "Read", status: "completed", output: "done" } });
    expect(await readFile(file, "utf8")).toBe(content); expect(await readdir(directory)).toEqual(["updates.jsonl"]);
    expect(await inspectNativeSession(root, "C:/other", "old")).toBeUndefined();
  });
  it("skips foreign identity and malformed records, and labels incomplete evidence", async () => {
    const { root } = await fixture([line("agent_message_chunk", "foreign", "other"), "null", "{broken", line("agent_message_chunk", "visible")].join("\n"));
    const result = await inspectNativeSession(root, "C:/project", "old");
    expect(JSON.stringify(result)).not.toContain("foreign");
    expect(result?.events[0]?.message).toContain("已跳过");
    expect(result?.events.at(-1)).toMatchObject({ text: "visible" });
  });
  it("bounds a giant line and event count without reporting a complete transcript", async () => {
    const { root, file } = await fixture(line("agent_message_chunk", "x".repeat(9 * 1024 * 1024)));
    const giant = await inspectNativeSession(root, "C:/project", "old");
    expect(giant?.events).toHaveLength(1); expect(giant?.events[0]).toMatchObject({ status: "unavailable" });
    expect(giant?.events[0]?.message).toContain("上限");
    await writeFile(file, Array.from({ length: 2001 }, () => line("agent_message_chunk", "a")).join("\n"));
    const many = await inspectNativeSession(root, "C:/project", "old");
    expect(many?.events).toHaveLength(2001); expect(many?.events[0]?.message).toContain("上限");
  });
  it("rejects traversal and a junction pointing at a different session", async () => {
    const { root, directory } = await fixture(line("agent_message_chunk", "a"));
    await expect(inspectNativeSession(root, "C:/project", "../old")).rejects.toThrow("身份");
    await symlink(directory, join(root, encodeURIComponent("C:/project"), "alias"), "junction");
    await expect(inspectNativeSession(root, "C:/project", "alias")).rejects.toThrow("边界");
  });
});
