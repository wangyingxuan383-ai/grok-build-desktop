import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppSettings } from "../../shared/types";
import { AgentDefinitionService, agentDefinitionInternals, type AgentDefinitionServiceOptions } from "./agent-definition-service";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("AgentDefinitionService", () => {
  it("discovers builtin/plugin/user/project agents, parses native fields and applies source priority", async () => {
    const fixture = await createFixture("sources");
    await writeFile(join(fixture.grokHome, "bundled", "agents", "explore.md"), agentRaw("explore", "Builtin", "builtin body", "prompt_mode: full\npermission_mode: plan\nagents_md: true\n"));
    await writeFile(join(fixture.plugin, "agents", "explore.md"), agentRaw("explore", "Plugin", "plugin body"));
    await writeFile(join(fixture.grokHome, "agents", "explore.md"), agentRaw("explore", "User", "user body", "model: inherit\neffort: high\ntools: [\"read_file\", \"grep\"]\ndisallowed_tools: [\"write_file\"]\nskills: [\"review\"]\n"));
    await writeFile(join(fixture.repo, ".grok", "agents", "explore.md"), agentRaw("explore", "Project", "project body", "prompt_mode: extend\n"));

    const values = (await fixture.service.listAgents(fixture.repo)).filter((value) => value.name === "explore");
    expect(values.map((value) => [value.source, value.readOnly, value.effective])).toEqual([
      ["project", false, true], ["user", false, false], ["plugin", true, false], ["builtin", true, false],
    ]);
    expect(values.find((value) => value.source === "user")).toMatchObject({ modelId: "inherit", effort: "high", tools: ["read_file", "grep"], disallowedTools: ["write_file"], skills: ["review"], shadowedBy: "project" });
    expect(values.find((value) => value.source === "builtin")).toMatchObject({ promptMode: "full", permissionMode: "plan", agentsMd: true, shadowedBy: "project" });
    expect(values.find((value) => value.source === "plugin")?.pluginName).toBe("fixture-plugin");
  });

  it("round-trips agent Markdown exactly, keeps unknown fields/comments, backs up and detects external conflicts", async () => {
    let hotReloads = 0;
    const calls: Array<{ args: string[]; cwd: string; grokHome?: string }> = [];
    const fixture = await createFixture("agent-save", { calls, reload: { hotReload: async () => { hotReloads += 1; return true; } } });
    const initial = agentRaw("reviewer", "Review code", "Initial instructions", "# keep this comment\nfuture_field: future-value\n");
    const created = await fixture.service.saveAgent({ workspacePath: fixture.repo, targetSource: "user", name: "reviewer", rawMarkdown: initial });
    expect(created).toMatchObject({ saved: true, validation: { valid: true, inspectPassed: true }, reload: { strategy: "hot-reload" } });
    const current = created.definition!;
    const edited = initial.replace("Initial instructions", "Updated instructions").replace("future-value", "still-preserved");
    const saved = await fixture.service.saveAgent({ workspacePath: fixture.repo, targetSource: "user", name: "reviewer", originalPath: current.path, expectedHash: current.hash, rawMarkdown: edited });
    expect(saved.saved).toBe(true);
    expect(await readFile(current.path!, "utf8")).toBe(edited);
    expect(await readFile(saved.backupPath!, "utf8")).toBe(initial);
    expect(hotReloads).toBe(2);
    expect(calls.at(-1)).toMatchObject({ args: ["inspect", "--json"], cwd: fixture.repo, grokHome: fixture.grokHome });

    await writeFile(current.path!, edited.replace("Updated", "External"), "utf8");
    const conflict = await fixture.service.saveAgent({ workspacePath: fixture.repo, targetSource: "user", name: "reviewer", originalPath: current.path, expectedHash: saved.definition!.hash, rawMarkdown: edited.replace("Updated", "Local") });
    expect(conflict).toMatchObject({ saved: false, conflict: { expectedHash: saved.definition!.hash, diskContent: expect.stringContaining("External instructions") }, reload: { strategy: "not-needed" } });
  });

  it("copies read-only definitions and supports toggle, rename and confirmed delete with idle-session fallback", async () => {
    let restarted = 0;
    const fixture = await createFixture("agent-crud", { reload: { hotReload: async () => false, restartIdleSessions: async () => { restarted += 1; return 2; } } });
    const builtinPath = join(fixture.grokHome, "bundled", "agents", "plan.md");
    await writeFile(builtinPath, agentRaw("plan", "Plan", "Read only"));
    await expect(fixture.service.setAgentEnabled(fixture.repo, builtinPath, false)).rejects.toThrow("只读");

    const copied = await fixture.service.copyAgent(fixture.repo, builtinPath, "project", "project-plan");
    expect(copied).toMatchObject({ saved: true, definition: { name: "project-plan", source: "project" }, reload: { strategy: "idle-restart", restartedSessions: 2 } });
    expect((await readFile(copied.definition!.path!, "utf8"))).toContain("name: project-plan");
    const disabled = await fixture.service.setAgentEnabled(fixture.repo, copied.definition!.path!, false);
    expect(disabled.definition).toMatchObject({ enabled: false });
    expect(disabled.definition!.path).toMatch(/\.md\.disabled$/);
    const renamed = await fixture.service.renameAgent(fixture.repo, disabled.definition!.path!, "project-architect");
    expect(renamed.definition).toMatchObject({ name: "project-architect", enabled: false });
    expect(await readFile(renamed.definition!.path!, "utf8")).toContain("name: project-architect");
    await expect(fixture.service.deleteAgent(fixture.repo, renamed.definition!.path!, false)).rejects.toThrow("明确确认");
    const deleted = await fixture.service.deleteAgent(fixture.repo, renamed.definition!.path!, true);
    expect(await readFile(deleted.backupPath!, "utf8")).toContain("project-architect");
    expect((await fixture.service.listAgents(fixture.repo)).some((value) => value.name === "project-architect")).toBe(false);
    expect(restarted).toBe(4);
  });

  it("parses Persona contracts and preserves TOML comments/unknown fields without touching config.toml", async () => {
    const fixture = await createFixture("personas");
    const raw = `# Keep this comment\ndescription = "Strict reviewer"\ninstructions = "Review carefully"\nmodel = "grok-build"\nreasoning_effort = "high"\ndefault_capability_mode = "read-only"\ndefault_fork_context = true\ndefault_isolation = "worktree"\nfuture_key = "preserve-me"\n\n[[inputs]]\nname = "source_file"\nio_type = "file"\nrequired = true\ndescription = "Input source"\n\n[[outputs]]\nname = "review_file"\nrequired = false\n`;
    const created = await fixture.service.savePersona({ workspacePath: fixture.repo, targetSource: "project", name: "strict-reviewer", rawToml: raw });
    expect(created.definition).toMatchObject({ name: "strict-reviewer", modelId: "grok-build", effort: "high", defaultCapabilityMode: "read-only", defaultForkContext: true, defaultIsolation: "worktree", inputContract: [{ name: "source_file", ioType: "file", required: true, description: "Input source" }], outputContract: [{ name: "review_file", ioType: "file", required: false }] });
    expect(await readFile(created.definition!.path!, "utf8")).toBe(raw);
    await expect(readFile(join(fixture.grokHome, "config.toml"), "utf8")).rejects.toThrow();

    const copied = await fixture.service.copyPersona(fixture.repo, created.definition!.path!, "user", "user-reviewer");
    expect(copied.definition).toMatchObject({ source: "user", name: "user-reviewer" });
    expect(await readFile(copied.definition!.path!, "utf8")).toContain('future_key = "preserve-me"');
    expect(agentDefinitionInternals.parsePersona("description = \"missing instructions\"").validation).toMatchObject({ valid: false });
  });

  it("rolls back inspect failures and rejects a project Agent directory junction escape", async () => {
    const fixture = await createFixture("rollback");
    const initial = agentRaw("safe", "Safe", "Original");
    const created = await fixture.service.saveAgent({ workspacePath: fixture.repo, targetSource: "user", name: "safe", rawMarkdown: initial });
    const failed = await fixture.service.saveAgent({ workspacePath: fixture.repo, targetSource: "user", name: "safe", originalPath: created.definition!.path, expectedHash: created.definition!.hash, rawMarkdown: initial.replace("Original", "force_inspect_failure") });
    expect(failed).toMatchObject({ saved: false, validation: { valid: false, inspectPassed: false } });
    expect(await readFile(created.definition!.path!, "utf8")).toBe(initial);
    const newFailed = await fixture.service.saveAgent({ workspacePath: fixture.repo, targetSource: "project", name: "new-failure", rawMarkdown: agentRaw("new-failure", "Failure", "force_inspect_failure") });
    expect(newFailed.saved).toBe(false);
    await expect(readFile(join(fixture.repo, ".grok", "agents", "new-failure.md"), "utf8")).rejects.toThrow();

    const outside = join(fixture.root, "outside-agents");
    await mkdir(outside);
    await rm(join(fixture.repo, ".grok", "agents"), { recursive: true, force: true });
    await symlink(outside, join(fixture.repo, ".grok", "agents"), process.platform === "win32" ? "junction" : "dir");
    await expect(fixture.service.saveAgent({ workspacePath: fixture.repo, targetSource: "project", name: "escaped", rawMarkdown: agentRaw("escaped", "Escape", "body") })).rejects.toThrow("符号链接");
  });

  it("validates native Agent frontmatter and updates known fields without reserializing unknown content", () => {
    const raw = agentRaw("coder", "Coder", "Body", "# comment\nunknown_key: keep-me\n");
    const changed = agentDefinitionInternals.setAgentFrontmatterField(raw, "description", "Updated description");
    expect(changed).toContain("description: \"Updated description\"");
    expect(changed).toContain("# comment\nunknown_key: keep-me");
    expect(agentDefinitionInternals.parseAgent(changed, "coder").validation.valid).toBe(true);
    expect(agentDefinitionInternals.parseAgent("---\nname: missing-description\n---\nBody", "missing-description").validation).toMatchObject({ valid: false });
    const crlf = "---\r\nname: windows\r\ndescription: Windows\r\ntools:\r\n  - read_file\r\n  - grep\r\nfuture_map:\r\n  nested: keep\r\n---\r\n\r\nBody\r\n";
    expect(agentDefinitionInternals.parseAgent(crlf, "windows")).toMatchObject({ tools: ["read_file", "grep"], validation: { valid: true } });
    expect(agentDefinitionInternals.setAgentFrontmatterField(crlf, "name", "windows-renamed")).toContain("name: windows-renamed\r\ndescription: Windows");
  });
});

async function createFixture(name: string, extra: { calls?: Array<{ args: string[]; cwd: string; grokHome?: string }>; reload?: AgentDefinitionServiceOptions["reload"] } = {}): Promise<{ root: string; repo: string; grokHome: string; plugin: string; service: AgentDefinitionService }> {
  const root = await mkdtemp(join(tmpdir(), `grok definitions ${name} `));
  roots.push(root);
  const repo = join(root, "repo");
  const grokHome = join(root, "grok-home");
  const plugin = join(root, "fixture-plugin");
  await Promise.all([
    mkdir(join(repo, ".grok", "agents"), { recursive: true }),
    mkdir(join(repo, ".grok", "personas"), { recursive: true }),
    mkdir(join(grokHome, "agents"), { recursive: true }),
    mkdir(join(grokHome, "personas"), { recursive: true }),
    mkdir(join(grokHome, "bundled", "agents"), { recursive: true }),
    mkdir(join(grokHome, "bundled", "personas"), { recursive: true }),
    mkdir(join(plugin, "agents"), { recursive: true }),
  ]);
  const getSettings = async () => ({ cliPath: process.execPath } as AppSettings);
  const runInspect: NonNullable<AgentDefinitionServiceOptions["runInspect"]> = async (_cliPath, args, cwd, env) => {
    extra.calls?.push({ args, cwd, grokHome: env.GROK_HOME });
    const active = [join(repo, ".grok", "agents"), join(grokHome, "agents")];
    const agents: Array<{ name: string; source: { type: string } }> = [{ name: "general-purpose", source: { type: "builtin" } }];
    for (const directory of active) {
      const files = await import("node:fs/promises").then(({ readdir }) => readdir(directory, { withFileTypes: true }));
      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith(".md")) continue;
        const content = await readFile(join(directory, file.name), "utf8");
        if (content.includes("force_inspect_failure")) throw new Error("fixture inspect failure");
        const match = /^name:\s*([^\r\n]+)/m.exec(content);
        if (match) agents.push({ name: match[1]!.trim().replace(/^['\"]|['\"]$/g, ""), source: { type: directory.includes(".grok") ? "project" : "user" } });
      }
    }
    return { grokVersion: "0.2.106", agents, plugins: [{ name: "fixture-plugin", path: plugin, enabled: true, provides: { agents: 1 } }] };
  };
  return { root, repo, grokHome, plugin, service: new AgentDefinitionService(getSettings, { grokHome, resolveProjectRoot: async () => repo, runInspect, reload: extra.reload }) };
}

function agentRaw(name: string, description: string, body: string, extra = ""): string {
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n${extra}---\n\n${body}\n`;
}
