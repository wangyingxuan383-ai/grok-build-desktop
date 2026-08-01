import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeSessionCatalog, parseClaudeJsonl, pathWithin } from "./claude-session-catalog";
import { LogService } from "./log-service";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))));

describe("Claude session catalog", () => {
  it("indexes primary Claude JSONL, uses the latest title and never modifies the source", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-claude-")); roots.push(root);
    const claudeHome = join(root, ".claude");
    const project = join(root, "Workspace");
    const projects = join(claudeHome, "projects", "encoded-workspace");
    await mkdir(project, { recursive: true });
    await mkdir(projects, { recursive: true });
    const source = join(projects, "claude-main.jsonl");
    await writeFile(source, [
      { type: "user", sessionId: "claude-main", cwd: project, timestamp: "2026-07-27T01:00:00Z", isSidechain: false, message: { role: "user", content: "first request" } },
      { type: "assistant", sessionId: "claude-main", cwd: project, timestamp: "2026-07-27T01:01:00Z", isSidechain: false, message: { role: "assistant", model: "claude-test", content: [{ type: "thinking", thinking: "inspect" }, { type: "tool_use", name: "Read", input: { file_path: "a.ts" } }, { type: "text", text: "done" }] } },
      { type: "custom-title", sessionId: "claude-main", customTitle: "Latest Claude task" },
    ].map((value) => JSON.stringify(value)).join("\n") + "\n", "utf8");
    const before = await readFile(source);
    const catalog = new ClaudeSessionCatalog(join(root, "app-data"), new LogService(join(root, "app.log")), claudeHome, join(root, ".grok"));
    const listed = await catalog.list(project, true);
    expect(listed).toEqual([expect.objectContaining({ id: "claude-main", cwd: project, title: "Latest Claude task", model: "claude-test" })]);
    const opened = await catalog.open("claude-main");
    expect(opened.turns).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "user", text: "first request" }),
      expect.objectContaining({ role: "assistant", text: "done" }),
      expect.objectContaining({ role: "thought", text: "inspect" }),
      expect.objectContaining({ role: "tool", text: "Read" }),
    ]));
    expect(await readFile(source)).toEqual(before);
  });

  it("filters sidechains and subagent transcript directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-claude-sidechain-")); roots.push(root);
    const claudeHome = join(root, ".claude");
    const projectRoot = join(claudeHome, "projects", "project");
    await mkdir(join(projectRoot, "subagents"), { recursive: true });
    await writeFile(join(projectRoot, "sidechain.jsonl"), `${JSON.stringify({ type: "user", sessionId: "sidechain", cwd: "E:\\Work\\Repo", isSidechain: true, message: { content: "hidden" } })}\n`);
    await writeFile(join(projectRoot, "subagents", "child.jsonl"), `${JSON.stringify({ type: "user", sessionId: "child", cwd: "E:\\Work\\Repo", isSidechain: false, message: { content: "hidden" } })}\n`);
    const catalog = new ClaudeSessionCatalog(root, new LogService(join(root, "app.log")), claudeHome, join(root, ".grok"));
    expect(await catalog.list("", true)).toEqual([]);
  });

  it("keeps every Grok continuation mapping", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-claude-continuations-")); roots.push(root);
    const claudeHome = join(root, ".claude");
    const sourceRoot = join(claudeHome, "projects", "project");
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(join(sourceRoot, "claude-main.jsonl"), [
      JSON.stringify({ type: "user", sessionId: "claude-main", cwd: "E:\\Work\\Repo", isSidechain: false, message: { content: "request" } }),
      JSON.stringify({ type: "custom-title", sessionId: "claude-main", customTitle: "原 Claude 标题" }),
    ].join("\n"));
    const catalog = new ClaudeSessionCatalog(join(root, "app-data"), new LogService(join(root, "app.log")), claudeHome, join(root, ".grok"));
    await catalog.list("", true);
    await catalog.recordContinuation("claude-main", "grok-one");
    await catalog.recordContinuation("claude-main", "grok-two");
    expect(await catalog.listContinuations("e:\\work")).toEqual([
      { claudeId: "claude-main", sessionId: "grok-one", cwd: "E:\\Work\\Repo", title: "原 Claude 标题" },
      { claudeId: "claude-main", sessionId: "grok-two", cwd: "E:\\Work\\Repo", title: "原 Claude 标题" },
    ]);
  });

  it("matches workspace descendants and exposes the fallback parser", async () => {
    expect(pathWithin("E:\\Work\\Repo\\child", "e:\\work\\repo")).toBe(true);
    expect(pathWithin("E:\\Work\\Other", "e:\\work\\repo")).toBe(false);
    const root = await mkdtemp(join(tmpdir(), "grok-claude-parser-")); roots.push(root);
    const source = join(root, "source.jsonl");
    await writeFile(source, `${JSON.stringify({ type: "assistant", isSidechain: false, message: { content: [{ type: "text", text: "answer" }] } })}\n`);
    expect(await parseClaudeJsonl(source)).toContainEqual({ role: "assistant", text: "answer" });
  });
});
