import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, CliCompatibilitySnapshot, CliVersionStatus } from "../../shared/types";
import { CliUpdateService, type CliUpdateServiceRuntime } from "./cli-update-service";

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
