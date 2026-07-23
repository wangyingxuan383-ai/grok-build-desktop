import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createServer, type Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { GitService, gitInternals } from "./git-service";

const execFileAsync = promisify(execFile);

describe("GitService", () => {
  it("reports non-Git workspaces as an ordinary capability state", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok non-git "));
    const service = new GitService(join(root, "user-data"));
    await expect(service.capability(root)).resolves.toMatchObject({ available: false, reason: "not-repository", message: "此工作区不是 Git 仓库" });
  });
  it("reads porcelain status and sanitized remotes, then diffs, stages and commits", async () => {
    const { root, repo, service } = await createRepository("status");
    await git(repo, ["remote", "add", "origin", "https://user:secret@example.com/org/repo.git?token=hidden"]);
    await writeFile(join(repo, "tracked.txt"), "second\n", "utf8");
    await writeFile(join(repo, "untracked file.txt"), "new\n", "utf8");

    const status = await service.status(repo);
    expect(status).toMatchObject({ repositoryRoot: await realpath(repo), clean: false, branch: { name: "main" } });
    expect(status.remote?.displayUrl).toBe("https://example.com/org/repo.git");
    expect(status.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "tracked.txt", kind: "modified", staged: false, workingTree: true }),
      expect.objectContaining({ path: "untracked file.txt", kind: "untracked", staged: false, workingTree: true }),
    ]));

    const workingDiff = await service.diff(repo, false, "tracked.txt");
    expect(workingDiff.patch).toContain("+second");
    const untrackedDiff = await service.diff(repo, false, "untracked file.txt");
    expect(untrackedDiff.patch).toContain("+new");

    const staged = await service.stage(repo, ["tracked.txt", "untracked file.txt"]);
    expect(staged.changes.every((change) => change.staged)).toBe(true);
    expect((await service.diff(repo, true, "tracked.txt")).patch).toContain("+second");
    const unstaged = await service.unstage(repo, ["untracked file.txt"]);
    expect(unstaged.changes.find((change) => change.path === "untracked file.txt")).toMatchObject({ kind: "untracked", staged: false });
    await service.stage(repo, ["untracked file.txt"]);

    const commit = await service.commit(repo, "update tracked and add untracked");
    expect(commit.subject).toBe("update tracked and add untracked");
    expect((await service.status(repo)).clean).toBe(true);
    const history = await service.history(repo, 5);
    expect(history.map((value) => value.subject)).toEqual(["update tracked and add untracked", "initial"]);
    const details = await service.commitDetails(repo, commit.hash);
    expect(details.files.map((value) => value.path)).toEqual(expect.arrayContaining(["tracked.txt", "untracked file.txt"]));
    expect(details.body).toBe("");
    await rename(join(repo, "tracked.txt"), join(repo, "renamed.txt"));
    await service.stage(repo);
    const renamed = await service.commit(repo, "rename tracked file");
    expect((await service.commitDetails(repo, renamed.hash)).files).toContainEqual(expect.objectContaining({ path: "renamed.txt", oldPath: "tracked.txt", kind: "renamed" }));
    expect(root).toBeTruthy();
  }, 30_000);

  it("requires one-time trust before mutating a repository above the workspace", async () => {
    const { root, repo, service } = await createRepository("trust");
    const workspace = join(repo, "packages", "app");
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "index.ts"), "export {};\n", "utf8");

    const preflight = await service.getRepositoryTrust(workspace);
    expect(preflight).toMatchObject({ workspacePath: await realpath(workspace), repositoryRoot: await realpath(repo), required: true, trusted: false });
    await expect(service.stage(workspace, ["packages/app/index.ts"])).rejects.toThrow("确认仓库范围");
    await service.setRepositoryTrust(workspace, repo, true);
    expect(await service.getRepositoryTrust(workspace)).toMatchObject({ required: true, trusted: true });
    expect((await service.stage(workspace, ["packages/app/index.ts"])).changes).toContainEqual(expect.objectContaining({ path: "packages/app/index.ts", staged: true }));
    await service.setRepositoryTrust(workspace, repo, false);
    await expect(service.unstage(workspace)).rejects.toThrow("确认仓库范围");
    expect(root).toBeTruthy();
  }, 30_000);

  it("creates and switches branches, detects conflicts, and discards only an exact confirmed list", async () => {
    const { repo, service } = await createRepository("branches");
    await service.createBranch(repo, "feature");
    await writeFile(join(repo, "tracked.txt"), "feature\n", "utf8");
    await service.stage(repo, ["tracked.txt"]);
    await service.commit(repo, "feature change");
    await service.switchBranch(repo, "main");
    await writeFile(join(repo, "tracked.txt"), "main\n", "utf8");
    await service.stage(repo, ["tracked.txt"]);
    await service.commit(repo, "main change");
    await expect(git(repo, ["merge", "feature"])).rejects.toThrow();
    const conflicted = await service.status(repo);
    expect(conflicted.conflicts).toEqual(["tracked.txt"]);
    expect(conflicted.changes[0]).toMatchObject({ kind: "conflicted", conflict: "both-modified" });
    await writeFile(join(repo, "tracked.txt"), "resolved\n", "utf8");
    expect((await service.stage(repo, ["tracked.txt"])).conflicts).toEqual([]);
    await git(repo, ["merge", "--abort"]);

    await writeFile(join(repo, "tracked.txt"), "discard me\n", "utf8");
    await writeFile(join(repo, "untracked.txt"), "discard me too\n", "utf8");
    await expect(service.discard(repo, { trackedPaths: ["tracked.txt"], untrackedPaths: ["untracked.txt"], confirmedPaths: ["tracked.txt"] })).rejects.toThrow("完整确认");
    await service.discard(repo, { trackedPaths: ["tracked.txt"], untrackedPaths: ["untracked.txt"], confirmedPaths: ["untracked.txt", "tracked.txt"] });
    expect((await readFile(join(repo, "tracked.txt"), "utf8")).replace(/\r\n/g, "\n")).toBe("main\n");
    await expect(readFile(join(repo, "untracked.txt"), "utf8")).rejects.toThrow();
  }, 30_000);

  it("pushes and pulls through a local bare remote without contacting a real host", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok git remote "));
    const remote = join(root, "remote.git");
    const seed = join(root, "seed");
    const clone = join(root, "clone");
    await git(root, ["init", "--bare", remote]);
    await git(root, ["init", "-b", "main", seed]);
    await configureIdentity(seed);
    await writeFile(join(seed, "shared.txt"), "seed\n", "utf8");
    await git(seed, ["add", "shared.txt"]);
    await git(seed, ["commit", "-m", "seed"]);
    await git(seed, ["remote", "add", "origin", remote]);
    await git(seed, ["push", "-u", "origin", "main"]);
    await git(remote, ["symbolic-ref", "HEAD", "refs/heads/main"]);
    await git(root, ["clone", remote, clone]);
    await configureIdentity(clone);

    const seedService = new GitService(join(root, "seed-data"));
    await writeFile(join(seed, "seed-only.txt"), "from seed\n", "utf8");
    await seedService.stage(seed, ["seed-only.txt"]);
    await seedService.commit(seed, "seed push");
    expect(await seedService.push(seed, "push-seed-0001")).toMatchObject({ completed: true, cancelled: false });

    const cloneService = new GitService(join(root, "clone-data"));
    expect(await cloneService.pull(clone, "pull-clone-0001")).toMatchObject({ completed: true, cancelled: false });
    expect((await readFile(join(clone, "seed-only.txt"), "utf8")).replace(/\r\n/g, "\n")).toBe("from seed\n");
    await writeFile(join(clone, "clone-only.txt"), "from clone\n", "utf8");
    await cloneService.stage(clone, ["clone-only.txt"]);
    await cloneService.commit(clone, "clone push");
    expect(await cloneService.push(clone, "push-clone-0001")).toMatchObject({ completed: true, cancelled: false });
  }, 30_000);

  it("cancels an in-flight network operation", async () => {
    const { repo, service } = await createRepository("cancel");
    const sockets = new Set<Socket>();
    let connected!: () => void;
    const connection = new Promise<void>((resolve) => { connected = resolve; });
    const server = createServer((socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); connected(); });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Local test server did not bind a TCP port");
    await git(repo, ["remote", "add", "origin", `http://127.0.0.1:${address.port}/remote.git`]);
    await git(repo, ["config", "http.proxy", ""]);
    try {
      const operation = service.pull(repo, "cancel-pull-0001");
      await Promise.race([connection, new Promise((_, reject) => setTimeout(() => reject(new Error("Git did not connect to the local test server")), 5_000))]);
      expect(service.cancelOperation("cancel-pull-0001")).toBe(true);
      expect(await operation).toMatchObject({ completed: false, cancelled: true, summary: "操作已取消" });
      expect(service.cancelOperation("cancel-pull-0001")).toBe(false);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 15_000);

  it("rejects repository traversal and strips URL credentials", () => {
    expect(() => gitInternals.normalizeRepoPath("C:\\repo", "..\\outside.txt")).toThrow("超出仓库范围");
    expect(gitInternals.sanitizeRemoteUrl("ssh://name:secret@example.com/org/repo.git?token=secret")).toBe("ssh://example.com/org/repo.git");
    expect(gitInternals.sanitizeRemoteUrl("name:secret@example.com:org/repo.git")).toBe("example.com:org/repo.git");
  });

  it("keeps an 850-file review index lightweight and hunk-free", () => {
    const files = Array.from({ length: 850 }, (_, index) => ({ id: `file-${index}`, path: `src/file-${index}.ts`, kind: "modified" as const, staged: false, workingTree: true, binary: false, additions: 1, deletions: 1, hunks: [{ id: `hunk-${index}`, header: "@@ -1 +1 @@", oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, additions: 1, deletions: 1, lines: [], mutable: true }] }));
    const index = gitInternals.toReviewIndex({ id: "snapshot", repositoryRoot: "C:\\repo", scope: { kind: "unstaged" }, readOnly: false, files, additions: 850, deletions: 850, createdAt: new Date(0).toISOString() });
    expect(index.files).toHaveLength(850);
    expect(index.files[849]).toMatchObject({ path: "src/file-849.ts", hunkCount: 1 });
    expect(index.files.every((file) => !("hunks" in file))).toBe(true);
  });

  it("builds review scopes and applies a single verified hunk", async () => {
    const { repo, service } = await createRepository("review");
    await writeFile(join(repo, "tracked.txt"), "first\nsecond\nthird\n", "utf8");
    const unstaged = await service.review(repo, { kind: "unstaged" });
    expect(unstaged).toMatchObject({ readOnly: false, additions: 2, deletions: 0 });
    const file = unstaged.files.find((value) => value.path === "tracked.txt")!;
    expect(file.hunks).toHaveLength(1);
    const index = await service.reviewIndex(repo, { kind: "unstaged" });
    expect(index.id).toBe(unstaged.id);
    expect(index.files[0]).toMatchObject({ path: "tracked.txt", hunkCount: 1 });
    expect(index.files[0]).not.toHaveProperty("hunks");
    const detail = await service.reviewFileDetail(repo, { kind: "unstaged" }, index.id, index.files[0]!.id);
    expect(detail.file.hunks).toHaveLength(1);
    const hunk = file.hunks[0];
    expect(hunk).toBeDefined();
    const staged = await service.applyReviewHunk(repo, {
      snapshotId: unstaged.id,
      scope: { kind: "unstaged" },
      fileId: file.id,
      hunkId: hunk!.id,
      action: "stage",
    });
    expect(staged.files).toHaveLength(0);
    expect((await service.review(repo, { kind: "staged" })).files).toContainEqual(expect.objectContaining({ path: "tracked.txt" }));
    await expect(service.reviewFileDetail(repo, { kind: "unstaged" }, index.id, index.files[0]!.id)).rejects.toThrow("变更已更新");
    await expect(service.applyReviewHunk(repo, {
      snapshotId: unstaged.id,
      scope: { kind: "unstaged" },
      fileId: file.id,
      hunkId: hunk!.id,
      action: "stage",
    })).rejects.toThrow("变更已更新");
    const history = await service.history(repo, 1);
    expect((await service.review(repo, { kind: "commit", revision: history[0]!.hash })).readOnly).toBe(true);
  }, 30_000);
});

async function createRepository(name: string): Promise<{ root: string; repo: string; service: GitService }> {
  const root = await mkdtemp(join(tmpdir(), `grok git ${name} `));
  const repo = join(root, "repo");
  await git(root, ["init", "-b", "main", repo]);
  await configureIdentity(repo);
  await writeFile(join(repo, "tracked.txt"), "first\n", "utf8");
  await git(repo, ["add", "tracked.txt"]);
  await git(repo, ["commit", "-m", "initial"]);
  return { root, repo, service: new GitService(join(root, "user-data")) };
}

async function configureIdentity(repo: string): Promise<void> {
  await git(repo, ["config", "user.name", "Grok Desktop Test"]);
  await git(repo, ["config", "user.email", "grok-desktop@example.invalid"]);
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd, windowsHide: true, encoding: "utf8", maxBuffer: 5 * 1024 * 1024 });
  return result.stdout;
}
