import { mkdtemp, mkdir, rm, symlink, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EditorService } from "./editor-service";
import { SessionCatalog } from "./session-catalog";
import { SessionRuntimeStateService } from "./session-runtime-state-service";

const tempRoots: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const dir = tempRoots.pop()!;
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe("SessionCatalog V2 lifecycle & unread/snooze/settle invariants", () => {
  it("preserves unread and error badges when a resident live adapter is idle, and handles snooze/settle/dismissed", async () => {
    const root = await makeTempDir("grok-catalog-v2-");
    const userData = join(root, "userdata");
    const grokHome = join(root, "grok-home");
    const workspace = join(root, "project");
    await mkdir(workspace, { recursive: true });

    const catalog = new SessionCatalog(userData, grokHome);
    const sessionDir1 = join(catalog.sessionRoot(workspace), "sess-a");
    const sessionDir2 = join(catalog.sessionRoot(workspace), "sess-dismissed");
    await mkdir(sessionDir1, { recursive: true });
    await mkdir(sessionDir2, { recursive: true });

    const summaryPayload = JSON.stringify({
      created_at: "2026-11-24T00:00:00.000Z",
      updated_at: "2026-11-24T01:00:00.000Z",
      num_chat_messages: 4,
      generated_title: "Original CLI Title",
    });
    await writeFile(join(sessionDir1, "summary.json"), summaryPayload, "utf8");
    await writeFile(join(sessionDir2, "summary.json"), summaryPayload, "utf8");

    await catalog.markUnread("sess-a", false);
    const liveIdle = new Map([["sess-a", "idle" as const]]);
    const [listedIdle] = await catalog.list(workspace, "", liveIdle);
    expect(listedIdle?.status).toBe("unread");

    const liveWorking = new Map([["sess-a", "working" as const]]);
    const [listedWorking] = await catalog.list(workspace, "", liveWorking);
    expect(listedWorking?.status).toBe("working");

    await catalog.markUnread("sess-a", true);
    const [listedError] = await catalog.list(workspace, "", liveIdle);
    expect(listedError?.status).toBe("error");

    // Snoozing clears unread; waking expired snooze restores unread except for dismissed sessions
    const snoozeIso = new Date(Date.now() + 60_000).toISOString();
    await catalog.snooze("sess-a", snoozeIso);
    await catalog.snooze("sess-dismissed", snoozeIso);
    await catalog.dismiss("sess-dismissed");

    const woken = await catalog.wakeExpiredSnoozes(Date.now() + 120_000);
    expect(woken).toEqual(["sess-a"]);

    const afterWake = await catalog.list(workspace, "", liveIdle);
    expect(afterWake.map((s) => s.id)).toEqual(["sess-a"]);
    expect(afterWake[0]?.status).toBe("unread");

    // Settling clears both unread and any active snooze
    await catalog.snooze("sess-a", new Date(Date.now() + 60_000).toISOString());
    await catalog.settle("sess-a", true);
    const [settledRow] = await catalog.list(workspace, "", liveIdle);
    expect(settledRow?.settled).toBe(true);
    expect(settledRow?.snoozedUntil).toBeUndefined();
    expect(settledRow?.status).toBe("idle");

    // decorateSearchHits applies renames and drops dismissed sessions
    await catalog.rename("sess-a", "Renamed Local Title");
    const hits = await catalog.decorateSearchHits([
      { sessionId: "sess-a", title: "Old" },
      { sessionId: "sess-dismissed", title: "Hidden" },
    ]);
    expect(hits).toEqual([{ sessionId: "sess-a", title: "Renamed Local Title" }]);
  });
});

describe("SessionRuntimeStateService stagedMergeBacks & save() preservation", () => {
  it("preserves stagedMergeBacks and settleOnTurnEnd across save() and guards restoreStagedMergeBacks by timestamp", async () => {
    const userData = await makeTempDir("grok-runtime-v2-");
    const service = new SessionRuntimeStateService(userData);

    await service.save({
      sessionId: "parent-1",
      cwd: "D:/workspace",
      modelId: "grok-4",
      effort: "",
      mode: "agent",
      settleOnTurnEnd: true,
    });

    await service.upsertStagedMergeBack("parent-1", {
      parentSessionId: "parent-1",
      childSessionId: "child-1",
      childTitle: "Branch Experiment",
      summary: "Older summary",
      keyChanges: ["src/a.ts"],
      stagedAt: "2026-11-24T01:00:00.000Z",
    });

    // Subsequent save() without stagedMergeBacks or settleOnTurnEnd must keep both intact
    const savedAgain = await service.save({
      sessionId: "parent-1",
      cwd: "D:/workspace",
      modelId: "grok-4-heavy",
      effort: "high",
      mode: "plan",
    });
    expect(savedAgain.settleOnTurnEnd).toBe(true);
    expect(savedAgain.stagedMergeBacks).toHaveLength(1);
    expect(savedAgain.stagedMergeBacks?.[0]?.summary).toBe("Older summary");

    // Consume and simulate a newer concurrent stage before rollback restore
    const consumed = await service.consumeStagedMergeBacks("parent-1");
    expect(consumed).toHaveLength(1);

    await service.upsertStagedMergeBack("parent-1", {
      parentSessionId: "parent-1",
      childSessionId: "child-1",
      childTitle: "Branch Experiment",
      summary: "Newer summary",
      keyChanges: ["src/a.ts", "src/b.ts"],
      stagedAt: "2026-11-24T02:00:00.000Z",
    });

    await service.restoreStagedMergeBacks("parent-1", consumed);
    const finalPrefs = await service.get("parent-1");
    expect(finalPrefs?.stagedMergeBacks).toHaveLength(1);
    expect(finalPrefs?.stagedMergeBacks?.[0]?.summary).toBe("Newer summary");
  });
});

describe("EditorService lexical symlink/junction escape protection", () => {
  it("refuses to delete or traverse through a directory junction pointing outside the workspace", async () => {
    const root = await makeTempDir("grok-editor-sec-");
    const workspace = join(root, "workspace");
    const outside = join(root, "outside-secret");
    await mkdir(workspace, { recursive: true });
    await mkdir(outside, { recursive: true });
    const secretFile = join(outside, "keep-me.txt");
    await writeFile(secretFile, "sensitive external data", "utf8");

    const linkDir = join(workspace, "linked-outside");
    await symlink(outside, linkDir, process.platform === "win32" ? "junction" : "dir");

    const editor = new EditorService();
    await expect(editor.delete(workspace, "linked-outside", true)).rejects.toThrow(/符号链接|超出当前工作区/);
    await expect(editor.delete(workspace, "linked-outside/keep-me.txt", true)).rejects.toThrow(/符号链接|超出当前工作区/);
    await expect(editor.open(workspace, "linked-outside/keep-me.txt")).rejects.toThrow(/符号链接|超出当前工作区/);

    const externalStillExists = await stat(secretFile).then(() => true).catch(() => false);
    expect(externalStillExists).toBe(true);
  });
});
