import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import type { AppSettings } from "../../shared/types";
import { MemoryService, memoryInternals } from "./memory-service";

const execFileAsync = promisify(execFile);

describe("MemoryService", () => {
  it("matches the native Grok repository identity and shares it across clones, subdirectories and worktrees", async () => {
    const fixture = await createFixture("identity");
    const second = join(fixture.root, "second-clone");
    await git(fixture.root, ["init", second]);
    await git(second, ["remote", "add", "origin", "https://github.com/example/demo.git"]);
    const nested = join(fixture.repo, "packages", "desktop");
    await mkdir(nested, { recursive: true });
    const worktree = join(fixture.root, "worktree");
    await git(fixture.repo, ["worktree", "add", "-b", "memory-test", worktree, "HEAD"]);

    const layouts = await Promise.all([fixture.repo, nested, second, worktree].map((path) => fixture.service.resolveLayout(path)));
    expect(new Set(layouts.map((value) => value.workspaceIdentity))).toEqual(new Set(["example/demo"]));
    expect(new Set(layouts.map((value) => value.workspaceKey))).toEqual(new Set(["demo-859248a6"]));
    expect(memoryInternals.normalizeRemoteIdentity(`${"git"}@github.com:example/demo.git`)).toBe("example/demo");
    expect(memoryInternals.normalizeRemoteIdentity(`ssh://${"git"}@github.com/example/demo`)).toBe("example/demo");
    expect(memoryInternals.slugify("Fix the bug in auth/login.rs", 30)).toBe("fix-the-bug-in-auth-login-rs");
  }, 20_000);

  it("is disabled per workspace by default and only injects GROK_MEMORY for new processes", async () => {
    const fixture = await createFixture("settings");
    expect(await fixture.service.getSettingsForWorkspace(fixture.repo)).toMatchObject({ enabled: false, saveOnSessionEnd: true, autoDream: true, indexStatus: "disabled" });
    expect(await fixture.service.sessionEnvironment(fixture.repo)).toEqual({ GROK_MEMORY: "0", GROK_MEMORY_LOG: "0" });
    const enabled = await fixture.service.updateSettings(fixture.repo, { enabled: true, autoDream: false });
    expect(enabled).toMatchObject({ enabled: true, autoDream: false, indexStatus: "unknown" });
    expect(await fixture.service.sessionEnvironment(fixture.repo)).toEqual({ GROK_MEMORY: "1", GROK_MEMORY_LOG: "0" });
    await expect(readFile(join(fixture.grokHome, "config.toml"), "utf8")).rejects.toThrow();
  });

  it("browses, searches and edits global/workspace/session memory with external-conflict checks", async () => {
    const fixture = await createFixture("browse");
    let global = (await fixture.service.list(fixture.repo)).find((value) => value.id === "global")!;
    expect(global.content).toBe("");
    const globalSave = await fixture.service.save({ workspacePath: fixture.repo, scope: "global", content: "# Global Rules\n\nUse concise output.\n", expectedHash: global.hash!, expectedModifiedAt: global.modifiedAt! });
    expect(globalSave.saved).toBe(true);
    let workspace = (await fixture.service.list(fixture.repo)).find((value) => value.id === "workspace")!;
    const workspaceSave = await fixture.service.save({ workspacePath: fixture.repo, scope: "workspace", content: "# Demo Knowledge\n\nKeep the renderer sandboxed.\n", expectedHash: workspace.hash!, expectedModifiedAt: workspace.modifiedAt! });
    expect(workspaceSave.saved).toBe(true);

    const layout = await fixture.service.resolveLayout(fixture.repo);
    await mkdir(layout.sessionsDirectory, { recursive: true });
    await writeFile(join(layout.sessionsDirectory, "2026-07-22-editor-abcdef12.md"), "# Editor session\n\nMonaco integration.\n", "utf8");
    const all = await fixture.service.list(fixture.repo);
    expect(all.map((value) => [value.scope, value.title])).toEqual(expect.arrayContaining([["global", "Global Rules"], ["workspace", "Demo Knowledge"], ["session", "Editor session"]]));
    expect((await fixture.service.list(fixture.repo, "monaco"))).toHaveLength(1);

    workspace = all.find((value) => value.id === "workspace")!;
    await writeFile(layout.workspaceFile, "# External change\n", "utf8");
    const conflict = await fixture.service.save({ workspacePath: fixture.repo, scope: "workspace", content: "# Unsafe overwrite\n", expectedHash: workspace.hash!, expectedModifiedAt: workspace.modifiedAt! });
    expect(conflict).toMatchObject({ saved: false, conflict: { kind: "modified", diskContent: "# External change\n" } });
  });

  it("requires a fresh remember preview and explicit confirmation", async () => {
    const fixture = await createFixture("remember");
    const preview = await fixture.service.previewRemember(fixture.repo, "workspace", "Prefer fixed git argument arrays.");
    await expect(fixture.service.remember(preview, "stale", true)).rejects.toThrow("需要确认");
    await expect(fixture.service.remember(preview, preview.confirmationToken, false)).rejects.toThrow("需要确认");
    await fixture.service.save({ workspacePath: fixture.repo, scope: "workspace", content: "# Changed\n", expectedHash: "", expectedModifiedAt: "" });
    await expect(fixture.service.remember(preview, preview.confirmationToken, true)).rejects.toThrow("已变化");
    const fresh = await fixture.service.previewRemember(fixture.repo, "workspace", "Prefer fixed git argument arrays.");
    const entry = await fixture.service.remember(fresh, fresh.confirmationToken, true);
    expect(entry.content).toContain("## Notes\n\n- Prefer fixed git argument arrays.");
  }, 20_000);

  it("previews and atomically deletes one exact structured entry with conflict detection", async () => {
    const fixture = await createFixture("structured-delete");
    await fixture.service.save({ workspacePath: fixture.repo, scope: "workspace", content: "# Knowledge\n\n## Notes\n\n- Keep A.\n  Continued A.\n- Keep B.\n", expectedHash: "", expectedModifiedAt: "" });
    const items = await fixture.service.listStructured(fixture.repo, "workspace");
    expect(items.map((value) => value.text)).toEqual(["Keep A.\nContinued A.", "Keep B."]);
    const preview = await fixture.service.previewDelete(fixture.repo, items[0]!.id);
    await expect(fixture.service.deleteStructured(preview, preview.confirmationToken, false)).rejects.toThrow("需要确认");
    const layout = await fixture.service.resolveLayout(fixture.repo);
    await writeFile(layout.workspaceFile, "# External\n\n- Changed.\n", "utf8");
    await expect(fixture.service.deleteStructured(preview, preview.confirmationToken, true)).rejects.toThrow("已变化");
    const changed = (await fixture.service.listStructured(fixture.repo, "workspace"))[0]!;
    const current = await fixture.service.previewDelete(fixture.repo, changed.id);
    const entry = await fixture.service.deleteStructured(current, current.confirmationToken, true);
    expect(entry.content).toBe("# External\n\n");
  }, 20_000);

  it("deletes only confirmed session summaries and rejects a sessions-directory symlink escape", async () => {
    const fixture = await createFixture("delete");
    const layout = await fixture.service.resolveLayout(fixture.repo);
    await mkdir(layout.sessionsDirectory, { recursive: true });
    const sessionFile = join(layout.sessionsDirectory, "2026-07-22-safe-12345678.md");
    await writeFile(sessionFile, "# Safe session\n", "utf8");
    await expect(fixture.service.deleteSession(fixture.repo, "session:2026-07-22-safe-12345678.md", false)).rejects.toThrow("明确确认");
    await fixture.service.deleteSession(fixture.repo, "session:2026-07-22-safe-12345678.md", true);
    expect((await fixture.service.list(fixture.repo)).some((value) => value.id.includes("12345678"))).toBe(false);

    const outside = join(fixture.root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "outside-87654321.md"), "must not be read", "utf8");
    await rm(layout.sessionsDirectory, { recursive: true });
    await symlink(outside, layout.sessionsDirectory, process.platform === "win32" ? "junction" : "dir");
    await expect(fixture.service.list(fixture.repo)).rejects.toThrow("超出 GROK_HOME/memory");
  });

  it("uses fixed grok memory clear arguments and records Flush/Dream state without storing content", async () => {
    const calls: Array<{ cliPath: string; args: string[]; cwd: string; grokHome?: string }> = [];
    const fixture = await createFixture("commands", async (cliPath, args, cwd, env) => { calls.push({ cliPath, args, cwd, grokHome: env.GROK_HOME }); });
    await fixture.service.clear(fixture.repo, "workspace", true);
    expect(calls).toEqual([{ cliPath: process.execPath, args: ["memory", "clear", "--workspace", "--yes"], cwd: fixture.repo, grokHome: fixture.grokHome }]);
    await expect(fixture.service.clear(fixture.repo, "all", false)).rejects.toThrow("明确确认");
    expect(await fixture.service.markCommand(fixture.repo, "dream", "running")).toMatchObject({ dreamStatus: "running" });
    const dreamed = await fixture.service.markCommand(fixture.repo, "dream", "completed");
    expect(dreamed).toMatchObject({ dreamStatus: "completed", lastDreamAt: expect.any(String) });
    expect(await fixture.service.markCommand(fixture.repo, "flush", "completed")).toMatchObject({ lastFlushAt: expect.any(String) });
    const metadata = await readFile(join(fixture.userData, "memory-settings.json"), "utf8");
    expect(metadata).not.toContain("fixed git argument arrays");
  });
});

async function createFixture(name: string, runCli?: NonNullable<ConstructorParameters<typeof MemoryService>[2]>["runCli"]): Promise<{ root: string; repo: string; userData: string; grokHome: string; service: MemoryService }> {
  const root = await mkdtemp(join(tmpdir(), `grok memory ${name} `));
  const repo = join(root, "repo");
  const userData = join(root, "user-data");
  const grokHome = join(root, "grok-home");
  await Promise.all([mkdir(repo, { recursive: true }), mkdir(userData, { recursive: true }), mkdir(grokHome, { recursive: true })]);
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.name", "Grok Memory Test"]);
  await git(repo, ["config", "user.email", "grok-memory@example.invalid"]);
  await git(repo, ["remote", "add", "origin", `${"git"}@github.com:example/demo.git`]);
  await writeFile(join(repo, "README.md"), "fixture\n", "utf8");
  await git(repo, ["add", "README.md"]);
  await git(repo, ["commit", "-m", "fixture"]);
  const getSettings = async () => ({ cliPath: process.execPath } as AppSettings);
  return { root, repo, userData, grokHome, service: new MemoryService(userData, getSettings, { grokHome, runCli }) };
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd, windowsHide: true, encoding: "utf8", maxBuffer: 5 * 1024 * 1024 });
  return result.stdout;
}
