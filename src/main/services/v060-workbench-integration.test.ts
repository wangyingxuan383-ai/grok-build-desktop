import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { AppSettings, SessionExecutionAssignment } from "../../shared/types";
import { AgentDashboardService } from "./agent-dashboard-service";
import { EditorService } from "./editor-service";
import { ExecutionProfileService } from "./execution-profile-service";
import { GitService } from "./git-service";
import { buildGrokAgentArgs } from "./grok-acp-adapter";
import { MemoryService } from "./memory-service";
import { WorktreeService } from "./worktree-service";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true }))); });

describe("v0.6.0 workbench integration", () => {
  it("runs Worktree profile → Editor/Git → Dashboard → Memory → Apply/conflict/cleanup without duplicate approval UI", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-v060-integration-")); roots.push(root);
    const repo = join(root, "repo"); const userData = join(root, "user-data"); const grokHome = join(root, "grok-home");
    await Promise.all([mkdir(userData, { recursive: true }), mkdir(grokHome, { recursive: true })]);
    await git(root, ["init", "-b", "main", repo]);
    await git(repo, ["config", "user.name", "Integration Test"]); await git(repo, ["config", "user.email", "integration@example.invalid"]);
    await git(repo, ["remote", "add", "origin", `${"git"}@github.com:example/integration.git`]);
    await writeFile(join(repo, "shared.txt"), "base\n", "utf8"); await git(repo, ["add", "."]); await git(repo, ["commit", "-m", "base"]);

    const gitService = new GitService(userData); const worktrees = new WorktreeService(userData, gitService);
    const profiles = new ExecutionProfileService(userData, { resolveWorkspaceIdentity: async () => "example/integration" });
    await profiles.save({ workspacePath: repo, scope: "project", profile: { id: "isolated-auto", name: "隔离自动开发", effort: "high", mode: "auto", allowTools: [], denyTools: [], sandbox: "workspace", webSearch: "default", subagents: true, memory: true, worktree: true, worktreeRef: "main", allowedPersonaIds: [], subagentIsolation: "worktree" } });
    const compiled = await profiles.compile(repo, "isolated-auto", []);
    expect(buildGrokAgentArgs(compiled.effort, [], "--reasoning-effort", { modelId: compiled.modelId, agentProfilePath: compiled.agentProfilePath, alwaysApprove: compiled.mode === "auto" }).filter((value) => value === "--always-approve")).toHaveLength(1);

    const worktree = await worktrees.create({ workspacePath: repo, name: "integrated", baseRef: compiled.profile.worktreeRef, agentId: compiled.profile.agentId });
    const assignment: SessionExecutionAssignment = { sessionId: "session-integration", sourceWorkspacePath: repo, cwd: worktree.path, profileId: compiled.profile.id, profileName: compiled.profile.name, profile: compiled.profile, worktreeId: worktree.id, createdAt: new Date().toISOString() };
    await profiles.assign(assignment);
    const dashboard = new AgentDashboardService(userData);
    await dashboard.record({ type: "status", sessionId: assignment.sessionId, status: "working", text: "正在修改" });
    await dashboard.record({ type: "subagent", sessionId: assignment.sessionId, update: { sessionUpdate: "subagent_spawned", subagent_id: "review", agent_id: "reviewer", worktree_id: worktree.id } });
    const dashboardView = await dashboard.snapshot({ query: { workspacePath: repo }, sessions: [{ id: assignment.sessionId, cwd: worktree.path, title: "集成会话", createdAt: assignment.createdAt, updatedAt: assignment.createdAt, messageCount: 1, status: "working" }], liveSessions: [{ sessionId: assignment.sessionId, cwd: worktree.path, effort: "high" }], tasks: [], assignments: [assignment], liveCapability: "supported" });
    expect(dashboardView.roots[0]).toMatchObject({ isolation: "worktree", worktreeId: worktree.id, status: "running" });

    const editor = new EditorService(); const opened = await editor.open(worktree.path, "shared.txt");
    if (opened.kind !== "document" || !opened.document) throw new Error("integration fixture did not open in the editor");
    const document = opened.document;
    await editor.save({ workspacePath: worktree.path, path: document.path, content: "integrated change\n", encoding: document.encoding, lineEnding: document.lineEnding, expectedHash: document.hash, expectedModifiedAt: document.modifiedAt });
    expect((await gitService.status(worktree.path)).changes).toContainEqual(expect.objectContaining({ path: "shared.txt", kind: "modified", workingTree: true }));

    const memory = new MemoryService(userData, async () => ({ cliPath: process.execPath } as AppSettings), { grokHome });
    await memory.updateSettings(worktree.path, { enabled: true });
    await memory.save({ workspacePath: worktree.path, scope: "workspace", content: "# Integration\n\n- Shared across worktrees.\n", expectedHash: "", expectedModifiedAt: "" });
    expect((await memory.list(repo)).find((value) => value.id === "workspace")?.content).toContain("Shared across worktrees");

    await git(worktree.path, ["add", "shared.txt"]); await git(worktree.path, ["commit", "-m", "integrated change"]);
    const preview = await worktrees.previewApply(repo, worktree.id); expect(preview.canApply).toBe(true);
    expect(await worktrees.apply(repo, worktree.id, preview.confirmationToken!, true, true)).toMatchObject({ applied: true, conflicted: false, cleaned: true });
    expect(await readFile(join(repo, "shared.txt"), "utf8")).toContain("integrated change");

    const conflictTree = await worktrees.create({ workspacePath: repo, name: "integrated-conflict", baseRef: "main" });
    await writeFile(join(conflictTree.path, "shared.txt"), "worktree side\n", "utf8"); await git(conflictTree.path, ["add", "shared.txt"]); await git(conflictTree.path, ["commit", "-m", "worktree side"]);
    await writeFile(join(repo, "shared.txt"), "main side\n", "utf8"); await git(repo, ["add", "shared.txt"]); await git(repo, ["commit", "-m", "main side"]);
    const conflictPreview = await worktrees.previewApply(repo, conflictTree.id);
    expect(await worktrees.apply(repo, conflictTree.id, conflictPreview.confirmationToken!, true)).toMatchObject({ applied: false, conflicted: true, cleaned: false });
    const conflictHead = (await git(conflictTree.path, ["rev-parse", "HEAD"])).trim();
    await git(repo, ["merge", "--abort"]); await git(repo, ["merge", "--no-ff", "-s", "ours", conflictHead, "-m", "resolve integration conflict"]);
    await worktrees.remove(repo, conflictTree.id, true);
    expect((await worktrees.list(repo)).some((value) => value.id === conflictTree.id)).toBe(false);
  }, 45_000);
});

async function git(cwd: string, args: string[]): Promise<string> { const result = await execFileAsync("git", args, { cwd, windowsHide: true, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }); return result.stdout; }
