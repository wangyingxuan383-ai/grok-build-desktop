import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildForkRuntimePreferences, SessionRuntimeStateService } from "./session-runtime-state-service";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("SessionRuntimeStateService", () => {
  it("persists model, effort, mode and Desktop-owned queue across service restarts", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-runtime-")); roots.push(root);
    const first = new SessionRuntimeStateService(root);
    await first.save({ sessionId: "s1", cwd: "E:\\work", modelId: "provider-model", providerId: "provider", effort: "xhigh", mode: "plan" });
    await first.saveQueue("s1", [{ id: "q1", sessionId: "s1", text: "later", position: 0, createdAt: new Date().toISOString(), state: "queued" }]);
    const second = new SessionRuntimeStateService(root);
    expect(await second.get("s1")).toMatchObject({ modelId: "provider-model", providerId: "provider", effort: "xhigh", mode: "plan" });
    expect(await second.getQueue("s1")).toEqual([expect.objectContaining({ id: "q1", text: "later" })]);
  });

  it("deletes session preferences and queue together", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-runtime-")); roots.push(root);
    const service = new SessionRuntimeStateService(root);
    await service.save({ sessionId: "s1", cwd: "E:\\work", effort: "", mode: "agent" });
    await service.saveQueue("s1", [{ id: "q1", sessionId: "s1", text: "later", position: 0, createdAt: new Date().toISOString(), state: "queued" }]);
    await service.delete("s1");
    expect(await service.get("s1")).toBeUndefined();
    expect(await service.getQueue("s1")).toEqual([]);
  });

  it("can roll back an uncommitted model target without deleting its prompt queue", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-runtime-")); roots.push(root);
    const service = new SessionRuntimeStateService(root);
    await service.save({ sessionId: "s1", cwd: "E:\\work", modelId: "target", providerId: "target-provider", effort: "high", mode: "agent" });
    await service.saveQueue("s1", [{ id: "q1", sessionId: "s1", text: "keep me", position: 0, createdAt: new Date().toISOString(), state: "queued" }]);
    await service.deletePreferences("s1");
    expect(await service.get("s1")).toBeUndefined();
    expect(await service.getQueue("s1")).toEqual([expect.objectContaining({ id: "q1", text: "keep me" })]);
  });

  it("retains a bounded terminal queue history without restoring it as pending work", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-runtime-")); roots.push(root);
    const first = new SessionRuntimeStateService(root);
    const entry = { id: "q1", sessionId: "s1", text: "later", position: 0, createdAt: new Date().toISOString(), state: "accepted" as const };
    await first.saveQueue("s1", [entry]);
    expect(await new SessionRuntimeStateService(root).getQueue("s1")).toEqual([expect.objectContaining({ id: "q1", state: "accepted" })]);
    await first.recordQueueTerminal("s1", { ...entry, state: "completed" });
    // A late visible queue snapshot cannot resurrect a terminal entry as work.
    await first.saveQueue("s1", [{ ...entry, state: "completed" }]);
    const second = new SessionRuntimeStateService(root);
    expect(await second.getQueue("s1")).toEqual([]);
    expect(await second.getTerminalQueue("s1")).toEqual([expect.objectContaining({ id: "q1", state: "completed" })]);
  });

  it("preserves the exact Provider and local model identity when session-ready reports an upstream alias", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-runtime-")); roots.push(root);
    const service = new SessionRuntimeStateService(root);
    await service.save({ sessionId: "s1", cwd: "E:\\work", modelId: "provider-model", providerId: "provider-a", effort: "high", mode: "agent" });
    await service.reconcileSessionReady("s1", "upstream-model-alias", "different-provider");
    expect(await service.get("s1")).toMatchObject({ modelId: "provider-model", providerId: "provider-a" });
  });

  it("accepts session-ready as the model source for an official session", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-runtime-")); roots.push(root);
    const service = new SessionRuntimeStateService(root);
    await service.save({ sessionId: "s1", cwd: "E:\\work", modelId: "old-official", effort: "high", mode: "agent" });
    await service.reconcileSessionReady("s1", "new-official");
    expect(await service.get("s1")).toMatchObject({ modelId: "new-official" });
    expect((await service.get("s1"))?.providerId).toBeUndefined();
  });
});

describe("fork runtime inheritance", () => {
  it("inherits the parent Provider, local model, effort, mode and profile instead of global fallbacks", () => {
    const inherited = buildForkRuntimePreferences({
      sessionId: "parent",
      cwd: "E:\\parent",
      modelId: "provider-local-model",
      providerId: "provider-a",
      effort: "xhigh",
      mode: "plan",
      profileId: "profile-a",
      updatedAt: "2026-08-05T00:00:00.000Z",
    }, {
      sessionId: "child",
      cwd: "E:\\fork",
      modelId: "global-default",
      effort: "medium",
      mode: "agent",
      profileId: "global-profile",
    });

    expect(inherited).toEqual({
      sessionId: "child",
      cwd: "E:\\fork",
      modelId: "provider-local-model",
      providerId: "provider-a",
      effort: "xhigh",
      mode: "plan",
      profileId: "profile-a",
    });
  });
});
