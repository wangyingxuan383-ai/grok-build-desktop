import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UiStateService } from "./ui-state-service";

describe("UiStateService", () => {
  it("restores and clears drafts with case-insensitive keys", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-ui-state-"));
    const service = new UiStateService(root);

    await service.setDraft("Session-A", "未发送草稿");
    expect((await service.getDraft("session-a"))?.text).toBe("未发送草稿");

    await service.clearDraft("SESSION-A");
    expect(await service.getDraft("session-a")).toBeNull();
  });

  it("persists a one-shot capability even when the prompt is still empty", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-ui-capability-"));
    const service = new UiStateService(root);
    const capability = { kind: "computer" as const, label: "Computer", command: "/computer" };
    await service.setDraft("Session-C", "", capability);
    expect(await service.getDraft("session-c")).toMatchObject({ text: "", capability });
  });

  it("writes long text to a keyed draft file, restores it, and removes it when the draft is cleared", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-ui-text-draft-"));
    const service = new UiStateService(root);
    const attachment = await service.createTextDraftAttachment("Session-Text", "第一行\n第二行");
    expect(attachment).toMatchObject({ kind: "file", draftText: true, mimeType: "text/plain; charset=utf-8" });
    expect(await service.readTextDraftAttachment(attachment.path!)).toBe("第一行\n第二行");
    await service.setDraft("Session-Text", "", undefined, [attachment]);
    expect((await service.getDraft("session-text"))?.attachments).toMatchObject([{ path: attachment.path, draftText: true }]);
    await service.clearDraft("SESSION-TEXT");
    await expect(stat(attachment.path!)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("deduplicates prompt history and keeps the newest fifty entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-ui-history-"));
    const service = new UiStateService(root);
    const cwd = "D:\\Workspace\\Project";

    for (let index = 0; index < 55; index += 1) await service.appendPromptHistory(cwd, `prompt-${index}`);
    await service.appendPromptHistory(cwd.toLocaleLowerCase(), "prompt-20");

    const history = await service.listPromptHistory(cwd.toLocaleUpperCase());
    expect(history).toHaveLength(50);
    expect(history[0]).toBe("prompt-20");
    expect(history.filter((value) => value === "prompt-20")).toHaveLength(1);
    expect(history).not.toContain("prompt-0");
  });

  it("preserves concurrent prompt history writes", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-ui-history-concurrent-"));
    const service = new UiStateService(root);
    await Promise.all(Array.from({ length: 25 }, (_, index) => service.appendPromptHistory("workspace", `parallel-${index}`)));
    expect(await service.listPromptHistory("workspace")).toHaveLength(25);
  });

  it("moves a new-task draft and its text attachment to the created session atomically", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-ui-draft-move-"));
    const service = new UiStateService(root);
    const sourceKey = "new:project-123";
    const attachment = await service.createTextDraftAttachment(sourceKey, "长文本草稿");
    const newTask = { projectId: "project-123", workspacePath: "C:\\Project", modelId: "custom-model", effort: "high" as const, mode: "plan" as const };
    await service.setDraft(sourceKey, "准备发送", undefined, [attachment], newTask);

    const moved = await service.moveDraft(sourceKey, "session-created");
    expect(await service.getDraft(sourceKey)).toBeNull();
    expect(moved).toMatchObject({ key: "session-created", text: "准备发送", newTask });
    expect(await service.readTextDraftAttachment(moved?.attachments?.[0]?.path!)).toBe("长文本草稿");
    expect(await service.listDrafts()).toHaveLength(1);
  });

  it("does not overwrite an existing target draft during migration", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-ui-state-collision-"));
    const service = new UiStateService(root);
    await service.setDraft("new:project", "source");
    await service.setDraft("session-1", "target");
    await expect(service.moveDraft("new:project", "session-1")).rejects.toThrow("已有草稿");
    expect((await service.getDraft("new:project"))?.text).toBe("source");
    expect((await service.getDraft("session-1"))?.text).toBe("target");
  });

  it("restores draft attachments when the atomic store migration fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-ui-state-rollback-"));
    const service = new UiStateService(root);
    const attachment = await service.createTextDraftAttachment("new:rollback", "需要保留");
    await service.setDraft("new:rollback", "source", undefined, [attachment]);
    const originalMutate = (service as any).store.mutate.bind((service as any).store);
    (service as any).store.mutate = async () => { throw new Error("simulated write failure"); };

    await expect(service.moveDraft("new:rollback", "session-failed")).rejects.toThrow("simulated write failure");
    (service as any).store.mutate = originalMutate;
    expect((await service.getDraft("new:rollback"))?.text).toBe("source");
    expect(await service.readTextDraftAttachment(attachment.path!)).toBe("需要保留");
    expect(await service.getDraft("session-failed")).toBeNull();
  });
});
