import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionRelayService } from "./session-relay-service";
import { acquireProcessResource } from "./process-resource-lease";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function directory() { const path = await mkdtemp(join(tmpdir(), "grok-relay-")); cleanup.push(() => rm(path, { recursive: true, force: true })); return path; }
describe("session ownership and scheduled continuation", () => {
  it("forwards to the existing owner and removes its descriptor on release", async () => {
    const root = await directory();
    const execute = vi.fn(async () => ({ id: "run", taskId: "task", status: "completed" as const, scheduledAt: "now", sessionId: "parent" }));
    const owner = new SessionRelayService(root, execute), worker = new SessionRelayService(root, vi.fn());
    cleanup.push(() => owner.dispose(), () => worker.dispose());
    await owner.own("parent");
    expect(await worker.forward("parent", "task", "run")).toMatchObject({ status: "completed", sessionId: "parent" });
    expect(execute).toHaveBeenCalledExactlyOnceWith("parent", "task", "run");
    expect(await owner.forward("parent", "task")).toBeUndefined();
    await owner.release("parent"); expect(await worker.forward("parent", "task")).toBeUndefined();
  });
  it("does not fall back to duplicate local execution after a dispatched failure", async () => {
    const root = await directory();
    const owner = new SessionRelayService(root, async () => { throw new Error("task target mismatch"); }), worker = new SessionRelayService(root, vi.fn());
    cleanup.push(() => owner.dispose(), () => worker.dispose());
    await owner.own("parent");
    await expect(worker.forward("parent", "wrong-task")).rejects.toThrow("target mismatch");
  });
  it("excludes a second CLI owner until release and recovers a dead owner", async () => {
    const path = join(await directory(), "session.lock");
    const first = await acquireProcessResource(path);
    try { await expect(acquireProcessResource(path, 25)).rejects.toThrow(); } finally { await first.release(); }
    const second = await acquireProcessResource(path); await second.release();
    await writeFile(path, JSON.stringify({ pid: 2147483647, createdAt: new Date().toISOString(), nonce: "dead-owner" }));
    const recovered = await acquireProcessResource(path); await recovered.release();
  });
});


it("does not remove a replacement relay descriptor during a rapid session restart", async () => {
  const root = await directory();
  const owner = new SessionRelayService(root, async () => ({ id: "run", taskId: "task", status: "completed", scheduledAt: "now" }));
  const worker = new SessionRelayService(root, vi.fn()); cleanup.push(() => owner.dispose(), () => worker.dispose());
  await owner.own("parent");
  await Promise.all([owner.release("parent"), owner.own("parent")]);
  expect(await worker.forward("parent", "task")).toMatchObject({ status: "completed" });
});
