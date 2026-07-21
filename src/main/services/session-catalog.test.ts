import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionCatalog } from "./session-catalog";

describe("SessionCatalog", () => {
  it("finds Grok workspace folders case-insensitively on Windows", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-catalog-test-"));
    const grokHome = join(root, ".grok");
    const encodedWorkspace = encodeURIComponent("d:\\Workspace\\Project");
    const sessionId = "019f0000-test";
    const sessionDir = join(grokHome, "sessions", encodedWorkspace, sessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, "summary.json"), JSON.stringify({
      session_summary: "Existing Grok session",
      created_at: "2026-01-01T00:00:00Z",
      num_chat_messages: 2,
    }));
    const catalog = new SessionCatalog(join(root, "app-data"), grokHome);
    const rows = await catalog.list("D:\\workspace\\project");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(sessionId);
    expect(rows[0]?.title).toBe("Existing Grok session");
  });

  it("persists pin state and exports user/assistant history as Markdown", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-catalog-export-"));
    const grokHome = join(root, ".grok");
    const cwd = "D:\\Workspace\\Project";
    const sessionId = "019f0000-export";
    const sessionDir = join(grokHome, "sessions", encodeURIComponent(cwd), sessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, "summary.json"), JSON.stringify({
      session_summary: "Export test",
      created_at: "2026-01-01T00:00:00Z",
      num_chat_messages: 2,
    }));
    await writeFile(join(sessionDir, "chat_history.jsonl"), [
      JSON.stringify({ type: "user", content: "你好" }),
      JSON.stringify({ type: "assistant", content: [{ text: "已完成" }] }),
      JSON.stringify({ type: "assistant", content: "隐藏说明", synthetic_reason: "system" }),
    ].join("\n"));

    const catalog = new SessionCatalog(join(root, "app-data"), grokHome);
    await catalog.pin(sessionId, true);
    expect((await catalog.list(cwd))[0]?.pinned).toBe(true);

    const markdown = await catalog.exportMarkdown(cwd, sessionId);
    expect(markdown).toContain("# Export test");
    expect(markdown).toContain("## 用户\n\n你好");
    expect(markdown).toContain("## Grok\n\n已完成");
    expect(markdown).not.toContain("隐藏说明");
  });

  it("archives and records fork relationships as UI metadata without changing source sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-catalog-relations-"));
    const grokHome = join(root, ".grok");
    const cwd = "D:\\Workspace";
    for (const id of ["parent-session", "child-session"]) {
      const folder = join(grokHome, "sessions", encodeURIComponent(cwd), id);
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "summary.json"), JSON.stringify({ session_summary: id, created_at: "2026-01-01T00:00:00Z" }));
    }
    const catalog = new SessionCatalog(join(root, "app-data"), grokHome);
    await catalog.recordFork("parent-session", "child-session");
    await catalog.archive("parent-session", true);
    const rows = await catalog.list(cwd);
    expect(rows.find((row) => row.id === "parent-session")?.archived).toBe(true);
    expect(rows.find((row) => row.id === "child-session")?.parentSessionId).toBe("parent-session");
    expect(await readFile(join(grokHome, "sessions", encodeURIComponent(cwd), "parent-session", "summary.json"), "utf8")).toContain("parent-session");
  });

  it("records source metadata, applies a suggested title once and removes the dedicated session", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-catalog-origin-"));
    const grokHome = join(root, ".grok");
    const cwd = "D:\\Workspace";
    const sessionId = "task-session";
    const folder = join(grokHome, "sessions", encodeURIComponent(cwd), sessionId);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "summary.json"), JSON.stringify({ session_summary: "CLI title", created_at: "2026-01-01T00:00:00Z" }));
    const catalog = new SessionCatalog(join(root, "app-data"), grokHome);
    await catalog.recordOrigins([{ sessionId, kind: "automation", id: "task-id", title: "每日检查", suggestedTitle: "每日检查" }]);
    expect(await catalog.has(cwd, sessionId)).toBe(true);
    expect((await catalog.list(cwd))[0]).toMatchObject({ title: "每日检查", originKind: "automation", originId: "task-id", originTitle: "每日检查" });
    await catalog.rename(sessionId, "用户自定义名称");
    await catalog.recordOrigins([{ sessionId, kind: "automation", id: "task-id", title: "任务新名称", suggestedTitle: "任务新名称" }]);
    expect((await catalog.list(cwd))[0]?.title).toBe("用户自定义名称");
    await catalog.delete(cwd, sessionId);
    expect(await catalog.has(cwd, sessionId)).toBe(false);
  });
});
