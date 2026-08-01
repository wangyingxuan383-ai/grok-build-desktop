import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppSettings, ClaudeSessionSummary, CodexSessionSummary } from "../../shared/types";
import { WorkspaceCatalog } from "./workspace-catalog";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("workspace catalog", () => {
  it("merges recent, Grok, Codex and Claude sources and supports pinning", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-workspaces-")); roots.push(root);
    const project = join(root, "Project");
    const grokHome = join(root, ".grok");
    await mkdir(project, { recursive: true });
    await mkdir(join(grokHome, "sessions", encodeURIComponent(project), "session-1"), { recursive: true });
    const codexRows: CodexSessionSummary[] = [{ id: "c", path: "x", cwd: project, title: "c", createdAt: "", updatedAt: "2026-07-16T00:00:00Z", archived: false, hidden: false }];
    const claudeRows: ClaudeSessionSummary[] = [{ id: "a", path: "y", cwd: project, title: "a", createdAt: "", updatedAt: "2026-07-17T00:00:00Z", hidden: false }];
    const codex = { listAll: async () => codexRows } as never;
    const claude = { listAll: async () => claudeRows } as never;
    const catalog = new WorkspaceCatalog(root, codex, claude, grokHome);
    const settings = { recentWorkspaces: [project], activeWorkspace: project } as AppSettings;
    const [row] = await catalog.discover(settings, true);
    expect(row).toMatchObject({ cwd: project, exists: true, grokSessions: 1, codexSessions: 1, claudeSessions: 1 });
    expect(row?.sources).toEqual(expect.arrayContaining(["recent", "grok", "codex", "claude"]));
    const [pinned] = await catalog.pin(project, true, settings);
    expect(pinned?.pinned).toBe(true);
    expect(pinned?.sources).toContain("pinned");
  });
});
