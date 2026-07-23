import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AppSettings, CliCapabilityName, CliCapabilitySnapshot, CliCapabilitySupport } from "../../shared/types";
import { CLI_CAPABILITY_NAMES } from "../../shared/workbench-types";
import { buildCliEnv, locateGrokCli, readCliVersion } from "./cli-locator";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 4 * 1024 * 1024;

export interface CliCapabilityCommandResult {
  stdout: string;
  stderr: string;
}

export type CliCapabilityCommandRunner = (args: readonly string[]) => Promise<CliCapabilityCommandResult>;

export interface CliCapabilityProbeInput {
  cliVersion?: string;
  cacheKey: string;
  run: CliCapabilityCommandRunner;
  checkedAt?: string;
}

export class CliCapabilityService {
  private readonly cache = new Map<string, Promise<CliCapabilitySnapshot>>();
  private readonly runtimeEvidence = new Map<string, Partial<Record<CliCapabilityName, CliCapabilitySupport>>>();

  constructor(
    private readonly getSettings: () => Promise<AppSettings>,
    private readonly getApiKey: () => Promise<string | undefined>,
    private readonly dependencies: {
      locate?: typeof locateGrokCli;
      readVersion?: typeof readCliVersion;
      run?: (cliPath: string, args: readonly string[], env: NodeJS.ProcessEnv, cwd: string) => Promise<CliCapabilityCommandResult>;
    } = {},
  ) {}

  async get(force = false): Promise<CliCapabilitySnapshot> {
    const settings = await this.getSettings();
    const cliPath = await (this.dependencies.locate ?? locateGrokCli)(settings.cliPath);
    if (!cliPath) return unavailableCliSnapshot();
    const env = buildCliEnv(settings, await this.getApiKey());
    const version = await (this.dependencies.readVersion ?? readCliVersion)(cliPath, env);
    const cacheKey = version || "unknown-version";
    if (force) this.cache.delete(cacheKey);
    let pending = this.cache.get(cacheKey);
    if (!pending) {
      const cwd = settings.activeWorkspace || process.cwd();
      const runner = this.dependencies.run
        ? (args: readonly string[]) => this.dependencies.run!(cliPath, args, env, cwd)
        : (args: readonly string[]) => runCliCommand(cliPath, args, env, cwd);
      pending = probeCliCapabilities({ cliVersion: version, cacheKey, run: runner });
      this.cache.set(cacheKey, pending);
    }
    const snapshot = await pending;
    return mergeCliCapabilityEvidence(snapshot, this.runtimeEvidence.get(cacheKey));
  }

  async recordRuntimeSupport(names: readonly CliCapabilityName[], supported = true, reason?: string): Promise<void> {
    const snapshot = await this.get();
    if (!snapshot.cliFound) return;
    const current = this.runtimeEvidence.get(snapshot.cacheKey) ?? {};
    for (const name of names) current[name] = {
      state: supported ? "supported" : "unsupported",
      source: "acp-runtime",
      ...(reason ? { reason } : {}),
    };
    this.runtimeEvidence.set(snapshot.cacheKey, current);
  }

  clear(): void {
    this.cache.clear();
    this.runtimeEvidence.clear();
  }
}

export async function probeCliCapabilities(input: CliCapabilityProbeInput): Promise<CliCapabilitySnapshot> {
  const capabilities = createCapabilityRecord("unknown", "not-probed", "需要运行时能力探测");
  const [root, agent, worktree, memory, inspect] = await Promise.all([
    optionalCommand(input.run, ["--help"]),
    optionalCommand(input.run, ["agent", "--help"]),
    optionalCommand(input.run, ["worktree", "--help"]),
    optionalCommand(input.run, ["memory", "--help"]),
    optionalCommand(input.run, ["inspect", "--json"]),
  ]);

  if (root) {
    setHelpCapability(capabilities, "worktree.create", hasOption(root, "worktree"), "CLI 未公布 --worktree");
    setHelpCapability(capabilities, "memory.enable", hasOption(root, "experimental-memory") && hasOption(root, "no-memory"), "CLI 未公布 Memory 会话开关");
    setHelpCapability(capabilities, "dashboard", hasCommand(root, "dashboard"), "CLI 未公布 dashboard 命令");
    setHelpCapability(capabilities, "plugins", hasCommand(root, "plugin"), "CLI 未公布 plugin 命令");
    setHelpCapability(capabilities, "mcp", hasCommand(root, "mcp"), "CLI 未公布 mcp 命令");
  }

  if (agent) {
    const supportsAgentProfile = hasOption(agent, "agent-profile") || (root ? hasOption(root, "agent") : false);
    setHelpCapability(capabilities, "agents.definitions", supportsAgentProfile, "CLI 未公布 Agent 定义参数");
  }

  if (worktree) {
    setHelpCapability(capabilities, "worktree.list", hasCommand(worktree, "list"), "CLI 未公布 worktree list");
    setHelpCapability(capabilities, "worktree.remove", hasCommand(worktree, "rm"), "CLI 未公布 worktree rm");
    setHelpCapability(capabilities, "worktree.gc", hasCommand(worktree, "gc"), "CLI 未公布 worktree gc");
  }

  if (memory) setHelpCapability(capabilities, "memory.manage", hasCommand(memory, "clear"), "CLI 未公布 memory clear");

  const inspectValue = parseInspect(inspect);
  if (inspectValue) {
    setInspectCapability(capabilities, "agents.inspect", inspectValue, "agents");
    if ("agents" in inspectValue && capabilities["agents.definitions"].state === "unknown") {
      capabilities["agents.definitions"] = { state: "supported", source: "inspect" };
    }
    setInspectCapability(capabilities, "plugins", inspectValue, "plugins");
    setInspectCapability(capabilities, "mcp", inspectValue, "mcpServers");
  }

  return {
    cliFound: true,
    cliVersion: input.cliVersion,
    cacheKey: input.cacheKey,
    checkedAt: input.checkedAt ?? new Date().toISOString(),
    capabilities,
  };
}

export function mergeCliCapabilityEvidence(
  snapshot: CliCapabilitySnapshot,
  evidence?: Partial<Record<CliCapabilityName, CliCapabilitySupport>>,
): CliCapabilitySnapshot {
  if (!evidence || !Object.keys(evidence).length) return snapshot;
  return { ...snapshot, capabilities: { ...snapshot.capabilities, ...evidence } };
}

function unavailableCliSnapshot(): CliCapabilitySnapshot {
  return {
    cliFound: false,
    cacheKey: "missing-cli",
    checkedAt: new Date().toISOString(),
    capabilities: createCapabilityRecord("unsupported", "not-probed", "未找到 Grok CLI"),
  };
}

function createCapabilityRecord(
  state: CliCapabilitySupport["state"],
  source: CliCapabilitySupport["source"],
  reason: string,
): Record<CliCapabilityName, CliCapabilitySupport> {
  return Object.fromEntries(CLI_CAPABILITY_NAMES.map((name) => [name, { state, source, reason }])) as Record<CliCapabilityName, CliCapabilitySupport>;
}

function setHelpCapability(
  capabilities: Record<CliCapabilityName, CliCapabilitySupport>,
  name: CliCapabilityName,
  supported: boolean,
  reason: string,
): void {
  capabilities[name] = supported ? { state: "supported", source: "cli-help" } : { state: "unsupported", source: "cli-help", reason };
}

function setInspectCapability(
  capabilities: Record<CliCapabilityName, CliCapabilitySupport>,
  name: CliCapabilityName,
  inspect: Record<string, unknown>,
  property: string,
): void {
  if (property in inspect) capabilities[name] = { state: "supported", source: "inspect" };
}

function parseInspect(output?: string): Record<string, unknown> | undefined {
  if (!output) return undefined;
  try {
    const value = JSON.parse(output) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function hasOption(help: string, name: string): boolean {
  return new RegExp(`(?:^|\\s)--${escapeRegExp(name)}(?:[=\\s<\\[]|$)`, "m").test(help);
}

function hasCommand(help: string, name: string): boolean {
  return new RegExp(`^\\s{2,}${escapeRegExp(name)}(?:\\s|$)`, "m").test(help);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function optionalCommand(run: CliCapabilityCommandRunner, args: readonly string[]): Promise<string | undefined> {
  try {
    const result = await run(args);
    return `${result.stdout}\n${result.stderr}`.trim();
  } catch {
    return undefined;
  }
}

async function runCliCommand(cliPath: string, args: readonly string[], env: NodeJS.ProcessEnv, cwd: string): Promise<CliCapabilityCommandResult> {
  const { stdout, stderr } = await execFileAsync(cliPath, [...args], {
    cwd,
    env,
    timeout: 20_000,
    windowsHide: true,
    maxBuffer: MAX_OUTPUT,
  });
  return { stdout, stderr };
}
