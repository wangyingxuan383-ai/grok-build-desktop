import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, CliUpdatePolicy } from "../../shared/types";
import { CliUpdateService, type CliUpdateServiceRuntime } from "./cli-update-service";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "grok-policy-offline-")); roots.push(root);
  const state = { version: "1.0.3", stable: "2.0.0", badCore: false, badDownload: false, unreadable: false, wrongVersion: false, hash: "original" };
  const update = vi.fn(async (_path: string, args: string[]) => {
    if (state.badDownload && args[2] !== "1.0.3") throw new Error("download failed");
    state.version = state.wrongVersion && args[2] !== "1.0.3" ? "1.0.4" : args[2]!;
  });
  const restore = vi.fn(async () => undefined);
  const runtime: CliUpdateServiceRuntime = {
    locateCli: async () => "fixture.exe",
    identity: async () => state.hash,
    readVersion: async () => { if (state.unreadable) throw new Error("version unreadable"); return state.version; },
    check: async () => ({ found: true, currentVersion: state.version, latestVersion: state.stable, updateAvailable: state.version !== state.stable }),
    runUpdate: update,
    probe: async () => {
      if (state.badCore && state.version !== "1.0.3") throw new Error("core rejected");
      return { cliVersion: state.version, checkedAt: new Date().toISOString(), capabilities: ["acp.initialize", "session.new", "core.resume", "core.close", "core.delete"].map((name) => ({ name, state: "supported" as const, source: "successful-probe" as const, observedAt: new Date().toISOString() })) };
    },
  };
  const service = () => new CliUpdateService(root, async () => ({}) as AppSettings, async () => undefined,
    async () => [{ sessionId: "s1", cwd: root, mode: "agent", effort: "low", processOptions: { environmentOverride: { PRIVATE_API_KEY: "must-not-persist" } } }],
    restore, { log: async () => { throw new Error("disk log failure"); } } as never, undefined, runtime);
  const updater = service();
  const apply = async (policy: CliUpdatePolicy, action: "update" | "verify" | "rollback" = "update", owner = updater) => {
    const preview = await owner.preview(policy, action);
    return owner.apply({ policy, action, targetVersion: preview.targetVersion, expectedCurrentVersion: preview.fromVersion, allowMajorUpgrade: true, confirmationToken: preview.confirmationToken });
  };
  return { state, updater, apply, restore, update, root, service, runtime };
}

describe("confirmed CLI policies (no CLI or model requests)", () => {
  it("rejects an expired or stale stable preview before touching sessions", async () => {
    const f = await fixture(); const p = await f.updater.preview("try-new");
    (f.updater as any).confirmations.get(p.confirmationToken).expires = 0;
    await expect(f.updater.apply({ policy: "try-new", targetVersion: "2.0.0", expectedCurrentVersion: "1.0.3", allowMajorUpgrade: true, confirmationToken: p.confirmationToken })).rejects.toThrow("确认已失效");
    const fresh = await f.updater.preview("try-new"); f.state.stable = "2.0.1";
    await expect(f.updater.apply({ policy: "try-new", targetVersion: "2.0.0", expectedCurrentVersion: "1.0.3", allowMajorUpgrade: true, confirmationToken: fresh.confirmationToken })).rejects.toThrow("stable 更新目标");
    expect(f.update).not.toHaveBeenCalled(); expect(f.restore).not.toHaveBeenCalled();
  });
  it("does not merge simultaneous requests with different policies", async () => {
    const f = await fixture(); const p = await f.updater.preview("try-new");
    const first = f.updater.apply({ policy: "try-new", targetVersion: "2.0.0", expectedCurrentVersion: "1.0.3", allowMajorUpgrade: true, confirmationToken: p.confirmationToken });
    await expect(f.updater.apply({ policy: "retain-unverified", targetVersion: "2.0.0", expectedCurrentVersion: "1.0.3", allowMajorUpgrade: true })).rejects.toThrow();
    await first; expect(f.update).toHaveBeenCalledTimes(1);
  });
  it("keeps the standard major allowlist and rejects missing confirmations", async () => {
    const f = await fixture();
    await expect(f.apply("standard")).rejects.toThrow("兼容门禁");
    await expect(f.updater.apply({ policy: "try-new", targetVersion: "2.0.0", expectedCurrentVersion: "1.0.3", allowMajorUpgrade: true })).rejects.toThrow("确认已失效");
    expect(f.update).not.toHaveBeenCalled();
  });
  it("binds confirmation to the policy, target and action and consumes it once", async () => {
    const f = await fixture(); const p = await f.updater.preview("try-new");
    await expect(f.updater.apply({ policy: "retain-unverified", targetVersion: p.targetVersion, expectedCurrentVersion: p.fromVersion, allowMajorUpgrade: true, confirmationToken: p.confirmationToken })).rejects.toThrow("确认已失效");
    const input = { policy: "try-new" as const, targetVersion: p.targetVersion, expectedCurrentVersion: p.fromVersion, allowMajorUpgrade: true, confirmationToken: p.confirmationToken };
    await f.updater.apply(input);
    await expect(f.updater.apply(input)).rejects.toThrow("确认已失效");
  });
  it("permits a new major only after core success and binds it to the binary", async () => {
    const f = await fixture();
    await expect(f.apply("try-new")).resolves.toMatchObject({ status: "updated", sessionRestore: { status: "restored" } });
    expect(await f.updater.isRuntimeVersionAllowed("2.0.0")).toBe(true);
    f.state.hash = "external-replacement";
    expect(await f.updater.isRuntimeVersionAllowed("2.0.0")).toBe(false);
  });
  it("rolls back on core failure and restores even when every log write fails", async () => {
    const f = await fixture(); f.state.badCore = true;
    await expect(f.apply("try-new")).resolves.toMatchObject({ status: "rolled-back", toVersion: "1.0.3" });
    expect(f.restore).toHaveBeenCalledTimes(1);
    expect(f.update.mock.calls.map((call) => call[1][2])).toEqual(["2.0.0", "1.0.3"]);
  });
  it("retains an installed but incompatible version without restoring or resending, including after restart", async () => {
    const f = await fixture(); f.state.badCore = true;
    await expect(f.apply("retain-unverified")).resolves.toMatchObject({ status: "retained-unverified", sessionRestore: { status: "deferred" } });
    expect(f.restore).not.toHaveBeenCalled();
    expect(f.update).toHaveBeenCalledTimes(1);
    const restarted = f.service();
    expect((await restarted.state()).recovery?.retained).toBe(true);
    expect(await restarted.isRuntimeVersionAllowed("2.0.0")).toBe(false);
    await expect(restarted.compatibility()).rejects.toThrow("不会自动启动诊断 ACP");
    expect(await readFile(join(f.root, "cli-update-recovery.json"), "utf8")).not.toContain("must-not-persist");
    f.state.stable = "2.0.1";
    f.runtime.check = async () => { throw Error("stable source unavailable"); };
    await expect(f.apply("standard", "rollback", restarted)).resolves.toMatchObject({ status: "rolled-back", toVersion: "1.0.3" });
    expect(f.restore).toHaveBeenCalledTimes(1);
  });
  it("revalidates a retained binary and only then restores", async () => {
    const f = await fixture(); f.state.badCore = true;
    await f.apply("retain-unverified"); f.state.badCore = false;
    await expect(f.apply("try-new", "verify", f.service())).resolves.toMatchObject({ status: "updated" });
    expect(f.update).toHaveBeenCalledTimes(1);
    expect(f.restore).toHaveBeenCalledTimes(1);
  });
  it("does not certify a binary replaced during validation", async () => {
    const f = await fixture(); const original = f.runtime.probe;
    f.runtime.probe = async (...args) => { const value = await original(...args); f.state.hash += "changed"; return value; };
    await expect(f.apply("retain-unverified")).resolves.toMatchObject({ status: "retained-unverified" });
    expect(await f.updater.isRuntimeVersionAllowed("2.0.0")).toBe(false);
  });
  it("does not let force-retain bypass a wrong binary or download failure", async () => {
    const f = await fixture(); f.state.wrongVersion = true;
    await expect(f.apply("retain-unverified")).resolves.toMatchObject({ status: "rolled-back" });
    f.state.wrongVersion = false; f.state.badDownload = true;
    await expect(f.apply("retain-unverified")).resolves.toMatchObject({ status: "failed", toVersion: "1.0.3" });
  });
  it("does not accept missing core evidence even in advanced mode", async () => {
    const f = await fixture();
    f.runtime.probe = async () => ({ checkedAt: new Date().toISOString(), capabilities: [] });
    await expect(f.apply("retain-unverified")).resolves.toMatchObject({ status: "retained-unverified" });
    expect(f.restore).not.toHaveBeenCalled();
  });
});
