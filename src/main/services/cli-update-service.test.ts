import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, CliCompatibilitySnapshot, CliVersionStatus } from "../../shared/types";
import { CLI_V1_COMPATIBILITY_PROFILE, CliUpdateService, compatibilityEvidence, offlineCompatibilityGate, runtimeV1Compatibility, type CliUpdateServiceRuntime } from "./cli-update-service";
import { normalizeRuntimeHandshake } from "./grok-acp-adapter";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function createService(root: string): CliUpdateService {
  return new CliUpdateService(
    root,
    vi.fn(),
    vi.fn(),
    vi.fn(),
    vi.fn(),
    { log: vi.fn() } as any,
  );
}

function createUpdateHarness(root: string, options: { failTarget?: boolean; failRollback?: boolean; failProbeAtTarget?: boolean; stableTarget?: string } = {}) {
  let version = "0.2.117";
  const updates: string[][] = [];
  const restored = vi.fn(async () => undefined);
  const suspended = [{ sessionId: "session-a" }] as any[];
  const compatibility = (): CliCompatibilitySnapshot => ({
    cliVersion: version,
    checkedAt: new Date().toISOString(),
    capabilities: [{ name: "acp.initialize", state: "supported", source: "successful-probe", observedAt: new Date().toISOString() }],
  });
  const runtime: CliUpdateServiceRuntime = {
    locateCli: vi.fn(async () => "C:\\fake\\grok.exe"),
    readVersion: vi.fn(async () => `grok ${version} (fixture)`),
    check: vi.fn(async (): Promise<CliVersionStatus> => ({
      found: true,
      currentVersion: version,
      latestVersion: options.stableTarget ?? "0.2.118",
      updateAvailable: version !== (options.stableTarget ?? "0.2.118"),
      channel: "stable",
      installer: "internal",
      autoUpdate: true,
    })),
    runUpdate: vi.fn(async (_cliPath, args) => {
      updates.push([...args]);
      const target = args[2];
      if (target === "0.2.118" && options.failTarget) throw new Error("target failed");
      if (target === "0.2.117" && options.failRollback) throw new Error("rollback failed");
      version = target!;
    }),
    probe: vi.fn(async () => {
      if (version === "0.2.118" && options.failProbeAtTarget) throw new Error("probe failed");
      return compatibility();
    }),
  };
  const service = new CliUpdateService(
    root,
    vi.fn(async () => ({ cliPath: "C:\\fake\\grok.exe" }) as AppSettings),
    vi.fn(),
    vi.fn(async () => suspended),
    restored,
    { log: vi.fn() } as any,
    undefined,
    runtime,
  );
  return { service, runtime, updates, restored };
}

describe("CliUpdateService", () => {
  it("records standard session resume/close from the runtime declaration", async () => {
    const handshake = normalizeRuntimeHandshake(JSON.parse(await readFile(join(process.cwd(), "src", "main", "services", "fixtures", "cli-wire", "initialize-0.2.120.json"), "utf8")));
    const names = compatibilityEvidence(handshake).filter((item) => item.state === "supported").map((item) => item.name);
    expect(names).toEqual(expect.arrayContaining(["session.list", "session.resume", "session.close"]));
  });

  it("does not mistake cancel-rewind for rewind and tracks official rename separately", () => {
    const handshake = normalizeRuntimeHandshake({
      protocolVersion: 1,
      agentCapabilities: { sessionCapabilities: {} },
      _meta: { agentVersion: "1.0.0", cancelRewind: true, "x.ai/session/rename": true },
    });
    const evidence = compatibilityEvidence(handshake);
    expect(evidence.find((item) => item.name === "session.rewind")?.state).toBe("unsupported");
    expect(evidence.find((item) => item.name === "session.cancel-rewind")?.state).toBe("supported");
    expect(evidence.find((item) => item.name === "x.ai/session/rename")?.state).toBe("supported");
  });

  it("loads the sanitized 1.0 handshake and passes the live runtime contract when close is observed", async () => {
    const handshake = normalizeRuntimeHandshake(JSON.parse(await readFile(join(process.cwd(), "src", "main", "services", "fixtures", "cli-wire", "initialize-1.0.0.json"), "utf8")));
    const result = runtimeV1Compatibility("1.0.0", handshake, true, new Set(["x.ai/session/info", "x.ai/session/usage", "x.ai/git/status"]));
    expect(handshake.agentVersion).toBe("1.0.0");
    expect(handshake.sessionCapabilities).toMatchObject({ close: true, list: true, resume: true });
    expect(handshake.mcpCapabilities).toMatchObject({ http: true, sse: true });
    expect(result.gate).toMatchObject({ status: "passed", liveVerified: true, major: 1 });
    expect(result.snapshot).toMatchObject({ closeOutcomeSupported: true, gitStatusUsesExplicitOptions: true });
  });

  it("keeps sanitized fixtures for every verified 1.0 patch and records the live 1.0.3 baseline", async () => {
    expect(CLI_V1_COMPATIBILITY_PROFILE).toMatchObject({
      minSupportedVersion: "1.0.0", maxVerifiedVersion: "1.0.3", stableTargetVersion: "1.0.3", liveVerifiedVersion: "1.0.3",
      fixtureVersions: ["1.0.0", "1.0.1", "1.0.2", "1.0.3"],
    });
    for (const version of CLI_V1_COMPATIBILITY_PROFILE.fixtureVersions) {
      const fixture = JSON.parse(await readFile(join(process.cwd(), "src", "main", "services", "fixtures", "cli-wire", `initialize-${version}.json`), "utf8"));
      const events = JSON.parse(await readFile(join(process.cwd(), "src", "main", "services", "fixtures", "cli-wire", `events-${version}.json`), "utf8"));
      expect(normalizeRuntimeHandshake(fixture).agentVersion).toBe(version);
      expect(Array.isArray(events)).toBe(true);
    }
  });

  it("fails closed for an unknown future 1.x patch instead of enabling it from the major number", () => {
    expect(offlineCompatibilityGate("1.0.4")).toMatchObject({
      status: "failed", major: 1, checks: [expect.objectContaining({ id: "unverified-minor" })],
    });
  });

  it("accepts the stable 1.0.0 core contract when only context and session-info commands are present", async () => {
    const handshake = normalizeRuntimeHandshake({
      protocolVersion: 1,
      agentCapabilities: {
        sessionCapabilities: { list: {}, resume: {}, close: {} },
        mcpCapabilities: { http: true, sse: true },
      },
      _meta: {
        agentVersion: "1.0.0",
        availableCommands: [{ name: "context" }, { name: "session-info" }],
      },
    });
    const result = runtimeV1Compatibility("1.0.0", handshake, true, new Set());
    expect(result.gate).toMatchObject({ status: "passed", liveVerified: true, major: 1 });
    expect(result.gate?.checks.find((item) => item.id === "data-views")).toMatchObject({ status: "pending" });
    expect(result.gate?.checks.find((item) => item.id === "git-explicit-options")).toMatchObject({ status: "pending" });
    expect(result.snapshot?.dataViews).toEqual(["context", "session-info"]);
  });

  it("re-derives a persisted 1.0 gate when Desktop compatibility rules change", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-update-service-"));
    roots.push(root);
    const persisted: CliCompatibilitySnapshot = {
      cliVersion: "1.0.0 (fixture)",
      checkedAt: new Date().toISOString(),
      handshake: normalizeRuntimeHandshake({
        protocolVersion: 1,
        agentCapabilities: { sessionCapabilities: { list: {}, resume: {}, close: {} }, mcpCapabilities: { http: true } },
        _meta: { agentVersion: "1.0.0", availableCommands: [{ name: "context" }, { name: "session-info" }] },
      }),
      capabilities: [],
      v1: {
        version: "1.0.0 (fixture)", observedAt: new Date().toISOString(), attachPolicy: { nonInteractive: false, deliveryTools: [] },
        closeOutcomeSupported: true, mcpMethods: [], gitStatusUsesExplicitOptions: true, dataViews: ["context", "session-info", "usage"],
      },
      gate: { targetVersion: "1.0.0", major: 1, status: "passed", checkedAt: new Date().toISOString(), liveVerified: true, checks: [] },
    };
    await writeFile(join(root, "cli-compatibility-snapshot.json"), JSON.stringify(persisted), "utf8");
    const runtime: CliUpdateServiceRuntime = {
      locateCli: vi.fn(async () => "C:\\fake\\grok.exe"),
      readVersion: vi.fn(async () => "1.0.0 (fixture)"),
      check: vi.fn(), runUpdate: vi.fn(), probe: vi.fn(),
    };
    const service = new CliUpdateService(root, vi.fn(async () => ({ cliPath: "C:\\fake\\grok.exe" }) as AppSettings), vi.fn(), vi.fn(), vi.fn(), { log: vi.fn() } as any, undefined, runtime);
    const refreshed = await service.compatibility();
    expect(runtime.probe).not.toHaveBeenCalled();
    expect(refreshed.v1?.dataViews).toEqual(["context", "session-info"]);
    expect(refreshed.gate?.checks.find((item) => item.id === "git-explicit-options")).toMatchObject({ status: "pending" });
  });

  it("parses but fails closed for an unknown future CLI major", async () => {
    const handshake = normalizeRuntimeHandshake(JSON.parse(await readFile(join(process.cwd(), "src", "main", "services", "fixtures", "cli-wire", "initialize-future-major.json"), "utf8")));
    expect(handshake).toMatchObject({ protocolVersion: 2, agentVersion: "2.0.0" });
    expect(offlineCompatibilityGate("2.0.0")).toMatchObject({
      status: "failed",
      major: 2,
      liveVerified: false,
      checks: [expect.objectContaining({ id: "unknown-major", status: "failed" })],
    });
  });

  it("coalesces concurrent apply requests into one update operation", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-update-service-"));
    roots.push(root);
    const service = createService(root);
    let finish!: (value: { fromVersion: string; toVersion: string; status: "updated"; verifiedAt: string; message: string }) => void;
    const operation = new Promise<{ fromVersion: string; toVersion: string; status: "updated"; verifiedAt: string; message: string }>((resolve) => { finish = resolve; });
    const applyOnce = vi.fn(() => operation);
    (service as any).applyOnce = applyOnce;

    const input = { targetVersion: "0.2.118", expectedCurrentVersion: "0.2.117" };
    const first = service.apply(input);
    const second = service.apply(input);
    expect(applyOnce).toHaveBeenCalledTimes(1);
    finish({ fromVersion: "0.2.117", toVersion: "0.2.118", status: "updated", verifiedAt: new Date().toISOString(), message: "ok" });
    await expect(first).resolves.toMatchObject({ toVersion: "0.2.118" });
    await expect(second).resolves.toMatchObject({ toVersion: "0.2.118" });
  });

  it("requires an explicit acknowledgement before crossing a CLI major version", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-update-service-"));
    roots.push(root);
    const service = createService(root);
    const applyOnce = vi.fn();
    (service as any).applyOnce = applyOnce;
    await expect(service.apply({ targetVersion: "1.0.0", expectedCurrentVersion: "0.2.118" }))
      .rejects.toThrow("跨主版本更新");
    expect(applyOnce).not.toHaveBeenCalled();
  });

  it("marks a stable 1.0 target as a major upgrade in the preview", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-update-service-"));
    roots.push(root);
    const harness = createUpdateHarness(root, { stableTarget: "1.0.0" });
    await expect(harness.service.preview()).resolves.toMatchObject({
      fromVersion: "0.2.117",
      targetVersion: "1.0.0",
      majorUpgrade: true,
      compatibilityGate: { status: "passed", liveVerified: false },
    });
  });

  it("redacts secrets before persisting update history", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-update-service-"));
    roots.push(root);
    const service = createService(root);
    await (service as any).record({ at: new Date().toISOString(), status: "failed", message: "token xai-very-secret-key-value" });
    const history = await service.history();
    expect(history[0]?.message).not.toContain("very-secret");
    expect(history[0]?.message).toContain("REDACTED");
  });

  it("pins the stable target, verifies it and restores suspended sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-update-service-"));
    roots.push(root);
    const harness = createUpdateHarness(root);
    await expect(harness.service.apply({ targetVersion: "0.2.118", expectedCurrentVersion: "0.2.117" })).resolves.toMatchObject({
      fromVersion: "0.2.117",
      toVersion: "0.2.118",
      status: "updated",
    });
    expect(harness.updates).toEqual([["update", "--version", "0.2.118"]]);
    expect(harness.restored).toHaveBeenCalledTimes(1);
  });

  it("rejects a target that drifted in the stable feed before suspending sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-update-service-"));
    roots.push(root);
    const harness = createUpdateHarness(root, { stableTarget: "0.2.119" });
    await expect(harness.service.apply({ targetVersion: "0.2.118", expectedCurrentVersion: "0.2.117" })).rejects.toThrow("stable 更新目标已从 0.2.118 变为 0.2.119");
    expect(harness.updates).toEqual([]);
    expect(harness.restored).not.toHaveBeenCalled();
  });

  it("rolls back to the exact previous version when post-update probing fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-update-service-"));
    roots.push(root);
    const harness = createUpdateHarness(root, { failProbeAtTarget: true });
    await expect(harness.service.apply({ targetVersion: "0.2.118", expectedCurrentVersion: "0.2.117" })).resolves.toMatchObject({
      toVersion: "0.2.117",
      status: "rolled-back",
    });
    expect(harness.updates).toEqual([
      ["update", "--version", "0.2.118"],
      ["update", "--version", "0.2.117"],
    ]);
    expect(harness.restored).toHaveBeenCalledTimes(1);
  });

  it("surfaces rollback failure and still attempts to restore suspended sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-update-service-"));
    roots.push(root);
    const harness = createUpdateHarness(root, { failProbeAtTarget: true, failRollback: true });
    await expect(harness.service.apply({ targetVersion: "0.2.118", expectedCurrentVersion: "0.2.117" })).rejects.toThrow("CLI 更新失败且回滚未通过");
    expect(harness.updates).toEqual([
      ["update", "--version", "0.2.118"],
      ["update", "--version", "0.2.117"],
    ]);
    expect(harness.restored).toHaveBeenCalledTimes(1);
  });
});
