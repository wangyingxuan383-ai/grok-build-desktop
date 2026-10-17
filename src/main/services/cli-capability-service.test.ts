import { describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../../shared/types";
import { CliCapabilityService, probeCliCapabilities, type CliCapabilityCommandRunner } from "./cli-capability-service";

const ROOT_HELP = `Usage: grok [OPTIONS] [COMMAND]\n  --agent <NAME>\n  --experimental-memory\n  --no-memory\n  -w, --worktree [<WORKTREE>]\nCommands:\n  dashboard  Open dashboard\n  inspect    Show config\n  memory     Manage memory\n  mcp        Manage MCP\n  plugin     Manage plugins\n  worktree   Manage worktrees`;
const AGENT_HELP = `Options:\n  --agent-profile <PATH>\n  --plugin-dir <DIR>`;
const WORKTREE_HELP = `Commands:\n  list  List tracked worktrees\n  show  Show details\n  rm    Remove worktrees\n  gc    Garbage collect`;
const MEMORY_HELP = `Commands:\n  clear  Clear memory files`;

function fixtureRunner(): CliCapabilityCommandRunner {
  return async (args) => {
    const key = args.join(" ");
    const stdout = key === "--help" ? ROOT_HELP
      : key === "agent --help" ? AGENT_HELP
        : key === "worktree --help" ? WORKTREE_HELP
          : key === "memory --help" ? MEMORY_HELP
            : key === "inspect --json" ? JSON.stringify({ agents: [], plugins: [], mcpServers: [] })
              : "";
    return { stdout, stderr: "" };
  };
}

describe("CLI capability snapshot", () => {
  it("detects non-billable CLI surfaces while leaving private ACP methods unknown", async () => {
    const snapshot = await probeCliCapabilities({ cliVersion: "0.2.106", cacheKey: "0.2.106", run: fixtureRunner(), checkedAt: "2026-07-22T00:00:00.000Z" });
    expect(snapshot.capabilities["worktree.create"].state).toBe("supported");
    expect(snapshot.capabilities["worktree.list"].state).toBe("supported");
    expect(snapshot.capabilities["worktree.remove"].state).toBe("supported");
    expect(snapshot.capabilities["worktree.gc"].state).toBe("supported");
    expect(snapshot.capabilities["memory.enable"].state).toBe("supported");
    expect(snapshot.capabilities["memory.manage"].state).toBe("supported");
    expect(snapshot.capabilities["agents.inspect"].source).toBe("inspect");
    expect(snapshot.capabilities.dashboard.state).toBe("supported");
    expect(snapshot.capabilities["git.status"].state).toBe("unknown");
    expect(snapshot.capabilities["worktree.apply"].state).toBe("unknown");
    expect(snapshot.capabilities["personas.definitions"].state).toBe("unknown");
  });

  it("does not infer unsupported private methods from a failed optional inspect", async () => {
    const runner: CliCapabilityCommandRunner = async (args) => {
      if (args[0] === "inspect") throw new Error("untrusted project");
      return fixtureRunner()(args);
    };
    const snapshot = await probeCliCapabilities({ cacheKey: "test", run: runner });
    expect(snapshot.capabilities["agents.inspect"].state).toBe("unknown");
    expect(snapshot.capabilities.plugins.state).toBe("supported");
  });

  it("caches static probes by executable identity and overlays owner-bound ACP evidence", async () => {
    const run = vi.fn(async (_path: string, args: readonly string[]) => fixtureRunner()(args[0] === "--no-auto-update" ? args.slice(1) : args));
    const settings = { cliPath: "C:\\mock\\grok.exe", activeWorkspace: "C:\\workspace" } as AppSettings;
    const service = new CliCapabilityService(async () => settings, async () => undefined, {
      locate: async () => settings.cliPath,
      readVersion: async () => "0.2.106",
      identity: async () => ({ key: "binary-a", pathFingerprint: "path", sha256: "hash" }),
      run,
    });

    await service.get();
    await service.get();
    expect(run).toHaveBeenCalledTimes(5);
    expect(run.mock.calls.every(([, args]) => args[0] === "--no-auto-update")).toBe(true);
    await service.recordRuntimeSupport(["acp.initialize", "acp.sessionNew"], true, undefined, { key: "binary-a" });
    const snapshot = await service.get();
    expect(snapshot.capabilities["acp.initialize"]).toMatchObject({ state: "supported", source: "acp-runtime" });
    expect(run).toHaveBeenCalledTimes(5);

    await service.get(true);
    expect(run).toHaveBeenCalledTimes(10);
    expect((await service.get()).capabilities["acp.initialize"].state).toBe("unknown");
  });

  it("does not treat the missing legacy Memory flags as removal of Memory", async () => {
    const snapshot = await probeCliCapabilities({ cacheKey: "1.0.60", run: async args => {
      const result = await fixtureRunner()(args);
      return { ...result, stdout: args.join(" ") === "--help" ? result.stdout.replace(/  --(?:experimental-memory|no-memory)\n/g, "") : result.stdout };
    } });
    expect(snapshot.capabilities["memory.enable"].state).toBe("unknown");
    expect(snapshot.capabilities["memory.manage"].state).toBe("supported");
  });

  it("invalidates static and runtime evidence on replacement and rejects late old-owner evidence", async () => {
    let key = "path-a:version:hash-a";
    const run = vi.fn(async (_: string, args: readonly string[]) => fixtureRunner()(args.slice(1)));
    const service = new CliCapabilityService(async () => ({ cliPath: "mock" } as AppSettings), async () => undefined, {
      locate: async () => "mock", readVersion: async () => "1.0.60", run,
      identity: async () => ({ key, pathFingerprint: "path", sha256: "hash" }),
    });
    await service.recordRuntimeSupport(["fork"], true, undefined, { key });
    expect((await service.get()).capabilities.fork.state).toBe("supported");
    const old = key;
    key = "path-b:version:hash-b";
    expect((await service.get()).capabilities.fork.state).toBe("unknown");
    await service.recordRuntimeSupport(["fork"], true, undefined, { key: old });
    expect((await service.get()).capabilities.fork.state).toBe("unknown");
    expect(run).toHaveBeenCalledTimes(10);
  });

  it("returns a complete unavailable snapshot when the CLI is missing", async () => {
    const service = new CliCapabilityService(async () => ({ cliPath: "" } as AppSettings), async () => undefined, { locate: async () => undefined });
    const snapshot = await service.get();
    expect(snapshot.cliFound).toBe(false);
    expect(Object.values(snapshot.capabilities).every((value) => value.state === "unsupported")).toBe(true);
  });
});
