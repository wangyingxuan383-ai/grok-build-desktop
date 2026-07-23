import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { GitService } from "./git-service";
import { WorktreeService } from "./worktree-service";

const execFileAsync = promisify(execFile);

describe("WorktreeService", () => {
  it("creates, recovers, previews, safely applies and optionally preserves a Git fallback worktree", async () => {
    const fixture = await createFixture("apply");
    const created = await fixture.service.create({ workspacePath: fixture.repo, name: "功能开发", baseRef: "main", sourceSessionId: "session-1", agentId: "builder" });
    expect(created).toMatchObject({ name: "功能开发", branch: expect.stringMatching(/^grok\//), state: "ready", official: false, sourceSessionId: "session-1", agentId: "builder" });
    expect(await stat(created.path).then((value) => value.isDirectory())).toBe(true);

    const recovered = await new WorktreeService(fixture.userData, fixture.git).list(fixture.repo);
    expect(recovered).toContainEqual(expect.objectContaining({ id: created.id, path: created.path, baseRef: "main" }));
    await writeFile(join(created.path, "feature.txt"), "worktree change\n", "utf8");
    await git(created.path, ["add", "feature.txt"]);
    await git(created.path, ["commit", "-m", "worktree feature"]);

    const preview = await fixture.service.previewApply(fixture.repo, created.id);
    expect(preview).toMatchObject({ targetClean: true, canApply: true, additions: 1, deletions: 0, commits: [expect.objectContaining({ subject: "worktree feature" })] });
    expect(preview.files).toContainEqual(expect.objectContaining({ path: "feature.txt", kind: "added", additions: 1 }));
    await expect(fixture.service.apply(fixture.repo, created.id, "stale-token", true)).rejects.toThrow("预览已变化");
    const applied = await fixture.service.apply(fixture.repo, created.id, preview.confirmationToken!, true, false);
    expect(applied).toEqual({ worktreeId: created.id, applied: true, conflicted: false, cleaned: false, message: "应用成功，Worktree 已保留" });
    expect((await readFile(join(fixture.repo, "feature.txt"), "utf8")).replace(/\r\n/g, "\n")).toBe("worktree change\n");
    expect(await stat(created.path).then((value) => value.isDirectory())).toBe(true);

    await fixture.service.remove(fixture.repo, created.id, true);
    expect(await stat(created.path).then(() => true).catch(() => false)).toBe(false);
  }, 30_000);

  it("stops on merge conflicts and preserves both target state and the worktree", async () => {
    const fixture = await createFixture("conflict");
    const created = await fixture.service.create({ workspacePath: fixture.repo, name: "conflict", baseRef: "main" });
    await writeFile(join(created.path, "shared.txt"), "worktree version\n", "utf8");
    await git(created.path, ["add", "shared.txt"]);
    await git(created.path, ["commit", "-m", "worktree version"]);
    await writeFile(join(fixture.repo, "shared.txt"), "main version\n", "utf8");
    await git(fixture.repo, ["add", "shared.txt"]);
    await git(fixture.repo, ["commit", "-m", "main version"]);

    const preview = await fixture.service.previewApply(fixture.repo, created.id);
    expect(preview.canApply).toBe(true);
    const result = await fixture.service.apply(fixture.repo, created.id, preview.confirmationToken!, true);
    expect(result).toMatchObject({ applied: false, conflicted: true, cleaned: false });
    expect((await fixture.git.status(fixture.repo)).conflicts).toEqual(["shared.txt"]);
    expect(await stat(created.path).then((value) => value.isDirectory())).toBe(true);
    await expect(fixture.service.remove(fixture.repo, created.id, true)).rejects.toThrow("未应用提交");
  }, 30_000);

  it("refuses apply when either target or worktree has uncommitted changes", async () => {
    const fixture = await createFixture("dirty");
    const created = await fixture.service.create({ workspacePath: fixture.repo, name: "dirty" });
    await writeFile(join(created.path, "dirty.txt"), "not committed", "utf8");
    expect(await fixture.service.previewApply(fixture.repo, created.id)).toMatchObject({ canApply: false, reason: "Worktree 仍有未提交修改" });
    await rm(join(created.path, "dirty.txt"));
    await writeFile(join(created.path, "clean-feature.txt"), "feature\n", "utf8");
    await git(created.path, ["add", "clean-feature.txt"]);
    await git(created.path, ["commit", "-m", "clean feature"]);
    await writeFile(join(fixture.repo, "target-dirty.txt"), "dirty target", "utf8");
    expect(await fixture.service.previewApply(fixture.repo, created.id)).toMatchObject({ canApply: false, targetClean: false, reason: "目标工作区存在未提交修改" });
  }, 20_000);

  it("prefers official ACP inventory and previews stale GC before pruning", async () => {
    const fixture = await createFixture("official-gc");
    const officialPath = join(fixture.root, "official-worktree");
    await git(fixture.repo, ["worktree", "add", "-b", "official-branch", officialPath, "main"]);
    const methods: string[] = [];
    const officialService = new WorktreeService(fixture.userData, fixture.git, { requestExtension: async (method) => {
      methods.push(method);
      if (method === "x.ai/git/worktree/list") return { worktrees: [{ id: "official-id", name: "Official", path: officialPath, branch: "official-branch", baseRef: "main" }] };
      return undefined;
    } });
    expect(await officialService.list(fixture.repo)).toContainEqual(expect.objectContaining({ id: "official-id", official: true, path: officialPath }));
    expect(methods[0]).toBe("x.ai/git/worktree/list");

    await rm(officialPath, { recursive: true, force: true });
    const preview = await officialService.previewGc(fixture.repo);
    expect(preview.candidates.length).toBeGreaterThan(0);
    await expect(officialService.gc(fixture.repo, "wrong", true)).rejects.toThrow("预览已变化");
    const after = await officialService.gc(fixture.repo, preview.confirmationToken, true);
    expect(after.candidates).toEqual([]);
  }, 20_000);
});

async function createFixture(name: string): Promise<{ root: string; repo: string; userData: string; git: GitService; service: WorktreeService }> {
  const root = await mkdtemp(join(tmpdir(), `grok worktree ${name} `));
  const repo = join(root, "repo");
  const userData = join(root, "user-data");
  await mkdir(userData, { recursive: true });
  await git(root, ["init", "-b", "main", repo]);
  await git(repo, ["config", "user.name", "Grok Worktree Test"]);
  await git(repo, ["config", "user.email", "grok-worktree@example.invalid"]);
  await writeFile(join(repo, "shared.txt"), "base\n", "utf8");
  await git(repo, ["add", "shared.txt"]);
  await git(repo, ["commit", "-m", "base"]);
  const gitService = new GitService(userData);
  return { root, repo, userData, git: gitService, service: new WorktreeService(userData, gitService) };
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd, windowsHide: true, encoding: "utf8", maxBuffer: 5 * 1024 * 1024 });
  return result.stdout;
}
