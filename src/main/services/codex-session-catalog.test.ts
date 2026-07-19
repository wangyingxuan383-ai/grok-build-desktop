import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexSessionCatalog, pathWithin } from "./codex-session-catalog";
import { LogService } from "./log-service";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("Codex session catalog", () => {
  it("falls back to JSONL, filters subagents and never modifies the source", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-codex-")); roots.push(root);
    const codexHome = join(root, ".codex");
    const grokHome = join(root, ".grok");
    const sessions = join(codexHome, "sessions", "2026", "07", "16");
    await mkdir(sessions, { recursive: true });
    const mainPath = join(sessions, "rollout-main.jsonl");
    const childPath = join(sessions, "rollout-child.jsonl");
    await writeFile(mainPath, `${JSON.stringify({ type: "session_meta", payload: { id: "main", cwd: "E:\\Work\\Repo", timestamp: "2026-07-16T00:00:00Z", thread_source: "user" } })}\n${JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ text: "hello" }] } })}\n`);
    await writeFile(childPath, `${JSON.stringify({ type: "session_meta", payload: { id: "child", cwd: "E:\\Work\\Repo", thread_source: "subagent" } })}\n`);
    await writeFile(join(codexHome, "session_index.jsonl"), `${JSON.stringify({ id: "main", thread_name: "Main task", updated_at: "2026-07-16T01:00:00Z" })}\n`);
    const catalog = new CodexSessionCatalog(root, new LogService(join(root, "app.log")), codexHome, grokHome);
    const listed = await catalog.list("e:\\work", false, true);
    expect(listed.map((row) => row.id)).toEqual(["main"]);
    const before = await catalog.contentHash("main");
    const opened = await catalog.open("main");
    expect(opened.turns).toContainEqual(expect.objectContaining({ role: "user", text: "hello" }));
    expect(await catalog.contentHash("main")).toBe(before);
  });

  it("matches a workspace and its descendants case-insensitively on Windows-style paths", () => {
    expect(pathWithin("E:\\Work\\Repo\\child", "e:\\work\\repo")).toBe(true);
    expect(pathWithin("E:\\Work\\Other", "e:\\work\\repo")).toBe(false);
  });
});
