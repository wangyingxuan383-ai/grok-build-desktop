import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolCallState } from "../../shared/types";
import { TurnFileChangeJournal } from "./turn-file-change-journal";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
async function root(): Promise<string> { const value = await mkdtemp(join(tmpdir(), "grok-turn-files-")); roots.push(value); return value; }

describe("TurnFileChangeJournal", () => {
  it("captures the real before and after content when ACP carries no diff", async () => {
    const cwd = await root();
    await writeFile(join(cwd, "a.txt"), "before\n", "utf8");
    const journal = new TurnFileChangeJournal();
    const base: Omit<ToolCallState, "status"> = { toolCallId: "write", title: "write", kind: "write", locations: [{ path: "a.txt" }] };
    await journal.observe("s", cwd, "turn", { ...base, status: "in_progress" });
    await writeFile(join(cwd, "a.txt"), "after\nnext\n", "utf8");
    const completed = await journal.observe("s", cwd, "turn", { ...base, status: "completed" });
    expect(completed).toMatchObject({ oldText: "before\n", newText: "after\nnext\n", additions: 2, deletions: 1 });
  });

  it("captures create and delete operations", async () => {
    const cwd = await root();
    const journal = new TurnFileChangeJournal();
    const create: Omit<ToolCallState, "status"> = { toolCallId: "create", title: "create", kind: "create", locations: [{ path: "new.txt" }] };
    await journal.observe("s", cwd, "turn", { ...create, status: "in_progress" });
    await writeFile(join(cwd, "new.txt"), "new", "utf8");
    expect(await journal.observe("s", cwd, "turn", { ...create, status: "completed" })).toMatchObject({ oldText: "", newText: "new" });

    const remove: Omit<ToolCallState, "status"> = { toolCallId: "delete", title: "delete", kind: "delete", locations: [{ path: "new.txt" }] };
    await journal.observe("s", cwd, "turn", { ...remove, status: "in_progress" });
    await rm(join(cwd, "new.txt"));
    expect(await journal.observe("s", cwd, "turn", { ...remove, status: "completed" })).toMatchObject({ oldText: "new", newText: "" });
  });

  it("does not invent an empty baseline for a completed-only existing file", async () => {
    const cwd = await root();
    await writeFile(join(cwd, "existing.txt"), "already existed\n", "utf8");
    const completed = await new TurnFileChangeJournal().observe("s", cwd, "turn", {
      toolCallId: "late",
      title: "write",
      kind: "write",
      status: "completed",
      locations: [{ path: "existing.txt" }],
    });
    expect(completed.newText).toBe("already existed\n");
    expect(completed.oldText).toBeUndefined();
    expect(completed.additions).toBeUndefined();
    expect(completed.output).toContain("无可靠基线");
  });

  it("rejects joining the baseline and result of two different paths", async () => {
    const cwd = await root();
    await writeFile(join(cwd, "a.txt"), "A-before", "utf8");
    await writeFile(join(cwd, "b.txt"), "B-after", "utf8");
    const journal = new TurnFileChangeJournal();
    await journal.observe("s", cwd, "turn", { toolCallId: "moved", title: "write", kind: "write", status: "in_progress", locations: [{ path: "a.txt" }] });
    await expect(journal.observe("s", cwd, "turn", { toolCallId: "moved", title: "write", kind: "write", status: "completed", locations: [{ path: "b.txt" }] }))
      .rejects.toThrow(/目标路径发生变化/);
  });

  it("bounds large-file snapshots to the preview limit", async () => {
    const cwd = await root();
    const path = join(cwd, "large.txt");
    await writeFile(path, "a".repeat(1024 * 1024), "utf8");
    const journal = new TurnFileChangeJournal();
    const base: Omit<ToolCallState, "status"> = { toolCallId: "large", title: "write", kind: "write", locations: [{ path: "large.txt" }] };
    await journal.observe("s", cwd, "turn", { ...base, status: "in_progress" });
    await writeFile(path, "b".repeat(1024 * 1024), "utf8");
    const completed = await journal.observe("s", cwd, "turn", { ...base, status: "completed" });
    expect(completed.oldText?.length).toBeLessThanOrEqual(256 * 1024);
    expect(completed.newText?.length).toBeLessThanOrEqual(256 * 1024);
    expect(completed.output).toContain("受限预览");
  });

  it("rejects a path outside the actual execution root", async () => {
    const cwd = await root();
    const outside = await root();
    await writeFile(join(outside, "escape.txt"), "secret", "utf8");
    const journal = new TurnFileChangeJournal();
    await expect(journal.observe("s", cwd, "turn", { toolCallId: "x", title: "write", kind: "write", status: "in_progress", locations: [{ path: join(outside, "escape.txt") }] })).rejects.toThrow(/超出当前工作区/);
  });

  it("marks a binary write without placing bytes into text fields", async () => {
    const cwd = await root();
    await mkdir(join(cwd, "data"));
    await writeFile(join(cwd, "data", "x.bin"), Buffer.from([0, 1, 2]));
    const journal = new TurnFileChangeJournal();
    const base: Omit<ToolCallState, "status"> = { toolCallId: "bin", title: "write", kind: "write", locations: [{ path: "data/x.bin" }] };
    await journal.observe("s", cwd, "turn", { ...base, status: "in_progress" });
    await writeFile(join(cwd, "data", "x.bin"), Buffer.from([0, 4, 5]));
    const result = await journal.observe("s", cwd, "turn", { ...base, status: "completed" });
    expect(result.oldText).toBeUndefined();
    expect(result.newText).toBeUndefined();
    expect(result.output).toContain("二进制");
    expect(await readFile(join(cwd, "data", "x.bin"))).toEqual(Buffer.from([0, 4, 5]));
  });
});
