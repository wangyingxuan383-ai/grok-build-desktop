import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
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
    const canonicalProject = await realpath(project);
    await mkdir(join(grokHome, "sessions", encodeURIComponent(project), "session-1"), { recursive: true });
    const codexRows: CodexSessionSummary[] = [{ id: "c", path: "x", cwd: project, title: "c", createdAt: "", updatedAt: "2026-07-16T00:00:00Z", archived: false, hidden: false }];
    const claudeRows: ClaudeSessionSummary[] = [{ id: "a", path: "y", cwd: project, title: "a", createdAt: "", updatedAt: "2026-07-17T00:00:00Z", hidden: false }];
    const codex = { listAll: async () => codexRows } as never;
    const claude = { listAll: async () => claudeRows } as never;
    const catalog = new WorkspaceCatalog(root, codex, claude, grokHome);
    const settings = { recentWorkspaces: [project], activeWorkspace: project } as AppSettings;
    const [row] = await catalog.discover(settings, true);
    expect(row).toMatchObject({ cwd: canonicalProject, exists: true, grokSessions: 1, codexSessions: 1, claudeSessions: 1 });
    expect(row?.sources).toEqual(expect.arrayContaining(["recent", "grok", "codex", "claude"]));
    const [pinned] = await catalog.pin(project, true, settings);
    expect(pinned?.pinned).toBe(true);
    expect(pinned?.sources).toContain("pinned");
  });

  it("deduplicates case, trailing separators and resolvable junction aliases", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-workspaces-identity-")); roots.push(root);
    const project = join(root, "Project");
    const alias = join(root, "Project-Link");
    await mkdir(project, { recursive: true });
    const canonicalProject = await realpath(project);
    await symlink(project, alias, "junction");
    const catalog = new WorkspaceCatalog(join(root, "data"), { listAll: async () => [] } as never, { listAll: async () => [] } as never, join(root, ".grok"));
    const settings = { recentWorkspaces: [project, `${project}\\`, project.toLocaleUpperCase(), alias], activeWorkspace: project } as AppSettings;
    const rows = await catalog.discover(settings, true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ exists: true, hidden: false, draftCount: 0, activeSessions: 0 });
    expect(rows[0]?.projectId).toMatch(/^project-/);
    expect(rows[0]?.canonicalPath.toLocaleLowerCase()).toBe(canonicalProject.toLocaleLowerCase());
  });

  it("hides and restores projects without deleting their catalog evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-workspaces-hidden-")); roots.push(root);
    const project = join(root, "Project");
    await mkdir(project, { recursive: true });
    const settings = { recentWorkspaces: [project], activeWorkspace: project } as AppSettings;
    const catalog = new WorkspaceCatalog(join(root, "data"), { listAll: async () => [] } as never, { listAll: async () => [] } as never, join(root, ".grok"));
    expect(await catalog.setHidden(project, true, settings)).toEqual([]);
    const hidden = await catalog.discover(settings, true, true);
    expect(hidden).toHaveLength(1);
    expect(hidden[0]?.hidden).toBe(true);
    expect(await catalog.setHidden(project, false, settings)).toHaveLength(1);
  });
});
