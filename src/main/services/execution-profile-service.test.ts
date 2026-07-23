import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionExecutionProfile } from "../../shared/types";
import { ExecutionProfileService } from "./execution-profile-service";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("ExecutionProfileService", () => {
  it("ships five read-only presets and applies project-over-global name precedence", async () => {
    const fixture = await createFixture();
    expect((await fixture.service.list(fixture.workspace)).filter((value) => value.scope === "builtin")).toHaveLength(5);
    await fixture.service.save({ workspacePath: fixture.workspace, scope: "global", profile: editable("shared", "团队配置", { modelId: "global-model" }) });
    await fixture.service.save({ workspacePath: fixture.workspace, scope: "project", profile: editable("project-shared", "团队配置", { modelId: "project-model" }) });
    const profiles = await fixture.service.list(fixture.workspace);
    expect(profiles.find((value) => value.id === "shared")).toMatchObject({ effective: false, shadowedBy: "project" });
    expect(await fixture.service.resolve(fixture.workspace, "shared")).toMatchObject({ id: "project-shared", modelId: "project-model" });
  });

  it("keeps project profiles in AppData and compiles native process/env/session mappings", async () => {
    const fixture = await createFixture();
    await fixture.service.save({ workspacePath: fixture.workspace, scope: "project", profile: editable("secure", "安全开发", {
      mode: "auto", effort: "high", modelId: "grok-test", sandbox: "strict", memory: true, subagents: false,
      webSearch: "disabled", denyTools: ["bash"], additionalRules: "只修改请求范围。", allowedPersonaIds: ["reviewer"], subagentIsolation: "worktree",
    }) });
    const compiled = await fixture.service.compile(fixture.workspace, "secure", []);
    expect(compiled).toMatchObject({ mode: "auto", effort: "high", modelId: "grok-test", environment: { GROK_MEMORY: "1", GROK_SUBAGENTS: "0", GROK_SANDBOX: "strict", GROK_WEB_FETCH: "0" } });
    expect(compiled.sessionMeta.rules).toContain("reviewer");
    const runtime = await readFile(compiled.agentProfilePath, "utf8");
    expect(runtime).toContain('model: "grok-test"');
    expect(runtime).toContain('  - "web_search"');
    expect(runtime).toContain('  - "Agent"');
    expect(await readFile(join(fixture.root, "execution-profiles.json"), "utf8")).toContain("安全开发");
  });

  it("refuses to silently launch maxTurns while reporting degraded persona/isolation mappings", async () => {
    const fixture = await createFixture();
    const profile = editable("limited", "有限轮次", { maxTurns: 5 });
    const validation = fixture.service.validate({ ...profile, id: profile.id!, scope: "global", readOnly: false });
    expect(validation).toMatchObject({ valid: true, fieldSupport: { maxTurns: { state: "unsupported" }, allowedPersonaIds: { state: "degraded" }, subagentIsolation: { state: "degraded" } } });
    await fixture.service.save({ workspacePath: fixture.workspace, scope: "global", profile });
    await expect(fixture.service.compile(fixture.workspace, "limited", [])).rejects.toThrow(/不会静默忽略/);
  });

  it("persists and repairs immutable per-session assignments", async () => {
    const fixture = await createFixture();
    const profile = await fixture.service.resolve(fixture.workspace, "builtin-worktree");
    await fixture.service.assign({ sessionId: "session-a", sourceWorkspacePath: fixture.workspace, cwd: join(fixture.workspace, "wt"), profileId: profile.id, profileName: profile.name, profile, worktreeId: "wt-a", createdAt: "2026-07-22T00:00:00.000Z" });
    expect(await fixture.service.assignment("session-a")).toMatchObject({ profileId: "builtin-worktree", worktreeId: "wt-a" });
    expect(await fixture.service.repairAssignments(async () => false)).toEqual(["session-a"]);
    expect(await fixture.service.assignment("session-a")).toBeUndefined();
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "grok-profiles-")); roots.push(root);
  const workspace = join(root, "workspace");
  const { mkdir } = await import("node:fs/promises"); await mkdir(workspace);
  return { root, workspace, service: new ExecutionProfileService(root, { resolveWorkspaceIdentity: async () => "owner/repository" }) };
}

function editable(id: string, name: string, patch: Partial<SessionExecutionProfile> = {}): ExecutionProfileSaveInputProfile {
  return { id, name, effort: "", mode: "agent", allowTools: [], denyTools: [], webSearch: "default", subagents: true, memory: false, worktree: false, allowedPersonaIds: [], subagentIsolation: "workspace", ...patch };
}

type ExecutionProfileSaveInputProfile = Omit<SessionExecutionProfile, "id" | "scope" | "workspaceIdentity" | "readOnly" | "createdAt" | "updatedAt" | "effective" | "shadowedBy"> & { id?: string };
