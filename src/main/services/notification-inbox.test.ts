import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationInboxService, sortInboxItems } from "./notification-inbox";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("NotificationInboxService", () => {
  it("claims an event once across independent store instances", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-inbox-claim-")); roots.push(root);
    const first = new NotificationInboxService(root), second = new NotificationInboxService(root);
    const input = { kind: "failure" as const, title: "Failed" };
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? first : second).addOnce(input, "session:one:turn:two")));
    expect(results.filter(result => result.added)).toHaveLength(1);
    expect(new Set(results.map(result => result.item.id)).size).toBe(1);
    expect(await first.list()).toHaveLength(1);
  });

  it("prioritizes unread confirmations, failures and completions, then sorts the rest by date", () => {
    const items = [
      { id: "read-failure", kind: "failure", read: true, createdAt: "2026-10-20" },
      { id: "other", kind: "info", read: false, createdAt: "2026-10-19" },
      { id: "completion", kind: "completion", read: false, createdAt: "2026-10-18" },
      { id: "failure", kind: "failure", read: false, createdAt: "2026-10-17" },
      { id: "confirmation", kind: "confirmation", read: false, createdAt: "2026-10-16" },
    ] as Parameters<typeof sortInboxItems>[0];
    expect(sortInboxItems(items).map(item => item.id)).toEqual(["confirmation", "failure", "completion", "read-failure", "other"]);
    expect(items[0]!.id).toBe("read-failure");
  });

  it("observes worker writes, all-read and clear; unsubscribes and isolates failing observers", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-inbox-watch-")); roots.push(root);
    const inbox = new NotificationInboxService(root), worker = new NotificationInboxService(root);
    const changed = vi.fn(), bad = vi.fn(async () => { throw Error("observer failed"); });
    const off = inbox.onChanged(changed), offBad = inbox.onChanged(bad);
    try {
      await vi.waitFor(() => expect(inbox.observing).toBe(true));
      await worker.add({ kind: "completion", title: "worker result" });
      await vi.waitFor(() => expect(changed.mock.calls.at(-1)?.[0]).toHaveLength(1));
      const read = await inbox.markAllRead();
      expect(read.every(item => item.read)).toBe(true);
      expect(changed.mock.calls.at(-1)?.[0][0].read).toBe(true);
      const fresh = await inbox.add({ kind: "failure", title: "new result" });
      expect(fresh.read).toBe(false);
      await inbox.clear(); expect(changed.mock.calls.at(-1)?.[0]).toEqual([]);
      off(); offBad(); const count = changed.mock.calls.length;
      await inbox.add({ kind: "info", title: "after unsubscribe" });
      expect(changed).toHaveBeenCalledTimes(count);
    } finally { inbox.dispose(); worker.dispose(); }
  });

  it("suppresses callbacks for an in-flight mutation after disposal", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-inbox-dispose-")); roots.push(root);
    const inbox = new NotificationInboxService(root), changed = vi.fn();
    inbox.onChanged(changed);
    const pending = inbox.add({ kind: "info", title: "late" });
    inbox.dispose(); await pending;
    expect(changed).not.toHaveBeenCalled();
  });
  it("deduplicates terminal automation events by run id", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-inbox-test-"));
    roots.push(root);
    const inbox = new NotificationInboxService(root);
    const input = { kind: "completion" as const, title: "定时任务已完成", taskId: "task-1", automationRunId: "run-1" };

    const first = await inbox.add(input);
    const repeated = await inbox.add(input);

    expect(repeated.id).toBe(first.id);
    expect(await inbox.list()).toHaveLength(1);
  });

  it("does not lose concurrent notifications", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-inbox-concurrent-"));
    roots.push(root);
    const inbox = new NotificationInboxService(root);
    await Promise.all(Array.from({ length: 25 }, (_, index) => inbox.add({ kind: "completion", title: `任务 ${index}` })));
    expect(await inbox.list()).toHaveLength(25);
  });
});
