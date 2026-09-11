import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CliUpdateService } from "./cli-update-service";

const mocks = vi.hoisted(() => ({ adapters: [] as any[], remove: vi.fn() }));
vi.mock("./grok-acp-adapter", () => ({ GrokAcpAdapter: class { constructor() { return mocks.adapters.shift(); } } }));
vi.mock("./cli-locator", async (original) => ({ ...await original<typeof import("./cli-locator")>(), readCliVersion: async () => "1.0.3" }));
vi.mock("./cli-session-service", () => ({ deleteCliSession: (...args: unknown[]) => mocks.remove(...args) }));
const roots: string[] = [];
afterEach(async () => { mocks.adapters = []; mocks.remove.mockReset(); await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "grok-probe-cleanup-unit-")); roots.push(root);
  mocks.remove.mockResolvedValue({ deleted: true });
  return new CliUpdateService(root, async () => ({}) as any, async () => undefined, async () => [], async () => undefined, { log: async () => { throw Error("log unavailable"); } } as any);
}
function adapter(id: string) {
  return {
    sessionId: id, start: vi.fn(async () => ({ sessionId: id })), dispose: vi.fn(async () => undefined),
    lastCloseReceipt: { completed: true }, runtimeHandshake: { protocolVersion: PROTOCOL_VERSION, features: {}, commands: [], models: [] },
    extension: async () => ({}), sessionInfo: async () => ({ supported: false }), sessionUsage: async () => ({ supported: false }),
    renameSession: async () => "local", officialGitStatus: async () => undefined, waitForCommands: async () => [],
  };
}
describe("probe cleanup on real control-flow with fake transport only", () => {
  it("deletes an acquired session even when start fails, preserving the main failure", async () => {
    const service = await setup(); const a = adapter("probe-failed"); a.start.mockRejectedValue(Error("start failed")); mocks.adapters.push(a);
    mocks.remove.mockRejectedValue(Error("cleanup failed"));
    await expect((service as any).probe("fixture.exe", {})).rejects.toThrow("start failed");
    expect(mocks.remove).toHaveBeenCalledWith("fixture.exe", "probe-failed", {}, 60_000, expect.any(Function));
  });
  it("requires resume/close/delete success and removes the probe only once", async () => {
    const service = await setup(); mocks.adapters.push(adapter("probe-ok"), adapter("probe-ok"));
    const result = await (service as any).probe("fixture.exe", {});
    expect(result.capabilities).toEqual(expect.arrayContaining([expect.objectContaining({ name: "core.delete", state: "supported" })]));
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });
  it("does not let non-Git/optional extension errors fail the core rollback probe", async () => {
    const service = await setup(); const a = adapter("non-git");
    a.officialGitStatus = async () => { throw Error("hub error: CLI fallback also failed: not a git repository"); };
    a.sessionInfo = async () => { throw Error("optional info unavailable"); };
    a.sessionUsage = async () => { throw Error("optional usage unavailable"); };
    a.renameSession = async () => { throw Error("optional rename unavailable"); };
    mocks.adapters.push(a, adapter("non-git"));
    const result = await (service as any).probe("fixture.exe", {});
    expect(result.capabilities).toEqual(expect.arrayContaining([expect.objectContaining({ name: "core.resume", state: "supported" }), expect.objectContaining({ name: "core.delete", state: "supported" })]));
    expect(result.capabilities.find((item: any) => item.name === "x.ai/git/status").state).not.toBe("supported");
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });
  it("removes both IDs if resume unexpectedly creates another session", async () => {
    const service = await setup(); mocks.adapters.push(adapter("original"), adapter("unexpected"));
    await expect((service as any).probe("fixture.exe", {})).rejects.toThrow("不同会话");
    expect(mocks.remove.mock.calls.map((v) => v[1])).toEqual(["unexpected", "original"]);
  });
  it("cleans optional Computer sessions even when their capability is unavailable", async () => {
    const service = await setup(); (service as any).optionalCapabilities = { pluginDir: "fixture-plugin" };
    mocks.adapters.push(adapter("optional"));
    await (service as any).probeOptionalComputerCapability("fixture.exe", "fixture", {});
    expect(mocks.remove).toHaveBeenCalledWith("fixture.exe", "optional", {}, 60_000, expect.any(Function));
  });
});
