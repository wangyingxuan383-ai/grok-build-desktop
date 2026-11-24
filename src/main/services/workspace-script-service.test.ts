import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceTerminal } from "../../shared/workspace-tools";
import type { GitService } from "./git-service";
import { WorkspaceScriptService } from "./workspace-script-service";
import type { WorkspaceTerminalService } from "./workspace-terminal-service";

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

describe("WorkspaceScriptService", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    while (cleanupDirs.length) {
      const dir = cleanupDirs.pop()!;
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("manages user scripts, gates repo-discovered scripts on trust + SHA-256, and hard-blocks runOnSettle on main root checkout", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "grok-ws-scripts-"));
    cleanupDirs.push(baseDir);

    const userDataDir = join(baseDir, "userdata");
    const repoDir = join(baseDir, "repo");
    const worktreeDir = join(baseDir, "repo-wt");
    await mkdir(userDataDir, { recursive: true });
    await mkdir(join(repoDir, ".grok"), { recursive: true });

    await runGit(repoDir, ["init", "-b", "main"]);
    await writeFile(
      join(repoDir, ".grok", "project.json"),
      JSON.stringify({
        scripts: [
          { name: "Repo Lint", command: "npm run lint", icon: "lint", runOnSettle: true },
        ],
      }),
      "utf8",
    );
    await writeFile(
      join(repoDir, "t3.json"),
      JSON.stringify({
        setupScript: "npm ci",
      }),
      "utf8",
    );
    await runGit(repoDir, ["add", "-A"]);
    await runGit(repoDir, ["commit", "-m", "init"]);
    await runGit(repoDir, ["worktree", "add", "-b", "feat/wt", worktreeDir, "HEAD"]);

    let repoTrusted = false;
    const spawnedCommands: Array<{ cwd: string; command?: string; id: string }> = [];
    const closedTerminals: string[] = [];

    const mockGit = {
      capability: async () => ({ available: true, repositoryRoot: repoDir }),
      getRepositoryTrust: async () => ({ trusted: repoTrusted, required: true, repositoryRoot: repoDir }),
    } as unknown as GitService;

    const mockTerminals = {
      removeExited: () => undefined,
      create: async (cwd: string, options?: { title?: string; command?: string; onData?: (d: string) => void; onExit?: (code: number) => void }): Promise<WorkspaceTerminal> => {
        const id = `term-${spawnedCommands.length + 1}`;
        spawnedCommands.push({ cwd, command: options?.command, id });
        if (options?.command?.includes("dev")) {
          options.onData?.("Local: http://localhost:5173/\n");
        } else {
          queueMicrotask(() => options?.onExit?.(0));
        }
        return { id, workspace: cwd, title: options?.title || "Script", status: "running", output: "", sequence: 1 };
      },
      close: (id: string) => {
        closedTerminals.push(id);
      },
    } as unknown as WorkspaceTerminalService;

    const openedPreviews: string[] = [];
    const service = new WorkspaceScriptService(userDataDir, mockGit, mockTerminals, {
      onOpenPreview: (url) => {
        openedPreviews.push(url);
      },
    });

    const userDev = await service.saveUserScript({
      workspacePath: repoDir,
      name: "Dev Server",
      command: "npm run dev",
      icon: "play",
      async: true,
      autoOpenPreview: true,
      stopOnSettle: true,
    });
    const userSettle = await service.saveUserScript({
      workspacePath: repoDir,
      name: "Verify Build",
      command: "npm test",
      icon: "test",
      runOnSettle: true,
    });
    expect(userDev.trusted).toBe(true);
    expect(userSettle.runOnSettle).toBe(true);

    const listed1 = await service.list(repoDir);
    const repoLint = listed1.scripts.find((s) => s.source === "grok-project");
    const t3Setup = listed1.scripts.find((s) => s.source === "t3");
    expect(repoLint?.trusted).toBe(false);
    expect(t3Setup?.runOnWorktreeCreate).toBe(true);

    await expect(service.run({ workspacePath: repoDir, scriptId: repoLint!.id })).rejects.toThrow(/信任/);
    await expect(service.approveRepoScript(repoDir, repoLint!.id, repoLint!.commandHash, true)).rejects.toThrow(/仓库范围信任/);

    repoTrusted = true;
    await expect(service.approveRepoScript(repoDir, repoLint!.id, "0000badhash", true)).rejects.toThrow(/SHA-256/);
    const approved = await service.approveRepoScript(repoDir, repoLint!.id, repoLint!.commandHash, true);
    expect(approved.trusted).toBe(true);

    const devRun = await service.run({ workspacePath: repoDir, scriptId: userDev.id, sessionId: "sess-root" });
    expect(openedPreviews).toEqual(["http://localhost:5173/"]);

    // HARD SAFETY CHECK: onSessionSettled on main root checkout MUST NEVER run `runOnSettle` scripts,
    // even if a caller erroneously passes a non-empty worktreeId pointing at repoDir, or no worktreeId!
    const rootSettle1 = await service.onSessionSettled({
      projectWorkspacePath: repoDir,
      executionCwd: repoDir,
      sessionId: "sess-root",
    });
    expect(rootSettle1).toEqual([]);
    expect(closedTerminals).toContain(devRun.terminalId);

    const rootSettleSpoofed = await service.onSessionSettled({
      projectWorkspacePath: repoDir,
      executionCwd: repoDir,
      worktreeId: "wt-spoof",
      sessionId: "sess-root",
    });
    expect(rootSettleSpoofed).toEqual([]);

    // Linked Git worktree execution IS allowed when worktreeId + real linked worktree match:
    const countBeforeWt = spawnedCommands.length;
    const wtSettle = await service.onSessionSettled({
      projectWorkspacePath: repoDir,
      executionCwd: worktreeDir,
      worktreeId: "wt-real-1",
      sessionId: "sess-wt",
    });
    expect(wtSettle.length).toBe(2); // userSettle + approved repoLint
    expect(spawnedCommands.length - countBeforeWt).toBe(2);

    // Mutating .grok/project.json invalidates SHA-256 trust automatically:
    await writeFile(
      join(repoDir, ".grok", "project.json"),
      JSON.stringify({
        scripts: [{ name: "Repo Lint", command: "npm run lint && whoami", icon: "lint" }],
      }),
      "utf8",
    );
    const listedAfterTamper = await service.list(repoDir);
    expect(listedAfterTamper.scripts.find((s) => s.source === "grok-project")?.trusted).toBe(false);

    await service.deleteUserScript(repoDir, userDev.id);
    service.dispose();
  });
});
