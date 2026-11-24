import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  CHECKPOINT_REF_PREFIX,
  GitCheckpointService,
  MAX_CHECKPOINTS_PER_SESSION,
} from "./git-checkpoint-service";

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    windowsHide: true,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test User",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test User",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  return stdout.trim();
}

async function sha256File(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

describe("GitCheckpointService hidden per-turn checkpoints", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    while (cleanupDirs.length) {
      const dir = cleanupDirs.pop()!;
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("captures hidden pre/post turn checkpoints without mutating .git/index, HEAD, git status, or git log", async () => {
    const repoDir = await mkdtemp(join(tmpdir(), "grok-ckpt-test-"));
    cleanupDirs.push(repoDir);

    await runGit(repoDir, ["init", "-b", "main"]);
    await writeFile(join(repoDir, "app.ts"), "export const v = 1;\n", "utf8");
    await runGit(repoDir, ["add", "app.ts"]);
    await runGit(repoDir, ["commit", "-m", "initial commit"]);

    // Put a staged file in .git/index to verify .git/index bytes are untouched!
    await writeFile(join(repoDir, "staged.ts"), "export const staged = true;\n", "utf8");
    await runGit(repoDir, ["add", "staged.ts"]);

    const indexBeforeHash = await sha256File(join(repoDir, ".git", "index"));
    const headBefore = await runGit(repoDir, ["rev-parse", "HEAD"]);
    const logBefore = await runGit(repoDir, ["log", "--oneline"]);
    const statusBefore = await runGit(repoDir, ["status", "--porcelain"]);

    const service = new GitCheckpointService();
    const preOid = await service.capturePreTurn(repoDir, "session/alpha:01", 0, "turn-0");
    expect(preOid).toMatch(/^[0-9a-f]{40}$/);

    // Verify zero mutation right after pre-turn capture:
    expect(await sha256File(join(repoDir, ".git", "index"))).toBe(indexBeforeHash);
    expect(await runGit(repoDir, ["status", "--porcelain"])).toBe(statusBefore);

    // Simulate agent turn modifying tracked file + creating untracked file:
    await writeFile(join(repoDir, "app.ts"), "export const v = 2;\nexport const added = true;\n", "utf8");
    await writeFile(join(repoDir, "untracked-note.ts"), "export const note = 'hello';\n", "utf8");

    const ckpt = await service.captureTurnCheckpoint(repoDir, "session/alpha:01", 0, "turn-0");
    expect(ckpt).toBeDefined();
    expect(ckpt!.refName.startsWith(`${CHECKPOINT_REF_PREFIX}/`)).toBe(true);
    expect(ckpt!.filesChanged).toBe(2);
    expect(ckpt!.additions).toBeGreaterThanOrEqual(2);

    // .git/index, HEAD, and branch git log MUST remain 100% untouched:
    expect(await sha256File(join(repoDir, ".git", "index"))).toBe(indexBeforeHash);
    expect(await runGit(repoDir, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(await runGit(repoDir, ["log", "--oneline"])).toBe(logBefore);
    expect(await runGit(repoDir, ["branch", "-a"])).not.toContain("grok-build");

    const diff = await service.turnDiff(repoDir, "session/alpha:01", 0);
    expect(diff.readOnly).toBe(true);
    expect(diff.files.map((f) => f.path).sort()).toEqual(["app.ts", "untracked-note.ts"]);
    expect(diff.patch).toContain("export const v = 2;");
    expect(diff.patch).toContain("untracked-note.ts");
  });

  it("prunes excess checkpoints above MAX_CHECKPOINTS_PER_SESSION (30) and deletes session refs cleanly", { timeout: 90_000 }, async () => {
    const repoDir = await mkdtemp(join(tmpdir(), "grok-ckpt-gc-"));
    cleanupDirs.push(repoDir);

    await runGit(repoDir, ["init", "-b", "main"]);
    await writeFile(join(repoDir, "counter.txt"), "0\n", "utf8");
    await runGit(repoDir, ["add", "counter.txt"]);
    await runGit(repoDir, ["commit", "-m", "seed"]);

    const service = new GitCheckpointService();
    for (let turn = 0; turn < MAX_CHECKPOINTS_PER_SESSION + 3; turn += 1) {
      await writeFile(join(repoDir, "counter.txt"), `${turn + 1}\n`, "utf8");
      await service.captureTurnCheckpoint(repoDir, "sess-gc", turn);
    }

    const listed = await service.listCheckpoints(repoDir, "sess-gc");
    expect(listed).toHaveLength(MAX_CHECKPOINTS_PER_SESSION);
    expect(listed[0]!.turnOrdinal).toBe(3);
    expect(listed.at(-1)!.turnOrdinal).toBe(MAX_CHECKPOINTS_PER_SESSION + 2);

    await service.deleteSessionCheckpoints(repoDir, "sess-gc");
    expect(await service.listCheckpoints(repoDir, "sess-gc")).toEqual([]);
  });
});
