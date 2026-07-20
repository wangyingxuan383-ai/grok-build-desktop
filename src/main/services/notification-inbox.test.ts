import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NotificationInboxService } from "./notification-inbox";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("NotificationInboxService", () => {
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
});
