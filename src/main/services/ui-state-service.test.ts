import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UiStateService } from "./ui-state-service";

describe("UiStateService", () => {
  it("consumes a retried failed snapshot without resurrecting it after success", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-ui-state-retry-"));
    const service = new UiStateService(root);
    const attachment = await service.createTextDraftAttachment("s1", "retry");
    await service.setDraft("s1", "retry", undefined, [attachment], undefined, "first");
    await service.detachDraftForSubmission("s1", "first");
    await service.settleSubmission("first", false);
    await service.setDraft("s1", "retry", undefined, [attachment], undefined, "retry");
    await service.detachDraftForSubmission("s1", "retry");
    await service.settleSubmission("retry", true);
    await service.sweepDraftAttachments();
    expect(await service.getDraft("s1")).toBeNull();
    await expect(stat(attachment.path!)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("keeps submitted text alive after empty autosave and restores a failed RPC", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-ui-state-submit-"));
    const service = new UiStateService(root);
    const attachment = await service.createTextDraftAttachment("s1", "recover me");
    await service.setDraft("s1", "prompt", undefined, [attachment], undefined, "claim-1");
    await service.detachDraftForSubmission("s1", "claim-1");
    await service.setDraft("s1", "");
    expect((await stat(attachment.path!)).isFile()).toBe(true);
    await service.settleSubmission("claim-1", false);
    expect((await service.getDraft("s1"))?.text).toBe("prompt");
    expect(await service.readTextDraftAttachment(attachment.path!)).toBe("recover me");
  });

  it("keeps the newer draft authoritative and offers the failed snapshot once it is consumed", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-ui-state-followup-"));
    const service = new UiStateService(root);
    const attachment = await service.createTextDraftAttachment("s1", "first");
    await service.setDraft("s1", "first", undefined, [attachment], undefined, "first");
    await service.detachDraftForSubmission("s1", "first");
    await service.setDraft("s1", "newer");
    await service.settleSubmission("first", false);
    expect((await service.getDraft("s1"))?.text).toBe("newer");
    await service.setDraft("s1", "");
    expect((await service.getDraft("s1"))?.text).toBe("first");
    expect((await stat(attachment.path!)).isFile()).toBe(true);
  });

  it("recovers interrupted submissions across restart without overwriting the next draft", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-ui-state-crash-"));
    const service = new UiStateService(root);
    const attachment = await service.createTextDraftAttachment("s1", "crash snapshot");
    await service.setDraft("s1", "first", undefined, [attachment], undefined, "first");
    await service.detachDraftForSubmission("s1", "first");
    await service.setDraft("s1", "next");
    const restarted = new UiStateService(root); await restarted.sweepDraftAttachments();
    expect((await restarted.getDraft("s1"))?.text).toBe("next");
    expect((await stat(attachment.path!)).isFile()).toBe(true);
  });

  it("does not delete an attachment reused by a newer draft after success", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-ui-state-reuse-"));
    const service = new UiStateService(root);
    const attachment = await service.createTextDraftAttachment("s1", "shared");
    await service.setDraft("s1", "first", undefined, [attachment], undefined, "first");
    const detached = await service.detachDraftForSubmission("s1", "first");
    await service.setDraft("s1", "next", undefined, [attachment]);
    await service.settleSubmission("first", true);
    await service.discardDetachedDraftFiles("s1", detached);
    expect((await stat(attachment.path!)).isFile()).toBe(true);
  });

  it("restores and clears drafts with case-insensitive keys", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-ui-state-"));
    const service = new UiStateService(root);

    await service.setDraft("Session-A", "未发送草稿");
    expect((await service.getDraft("session-a"))?.text).toBe("未发送草稿");

    await service.clearDraft("SESSION-A");
    expect(await service.getDraft("session-a")).toBeNull();
  });

  it("keeps deletion authoritative when a prompt autosave was already queued", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-ui-state-delete-race-"));
    const service = new UiStateService(root);
    await service.setDraft("new:project", "正在输入的正文", undefined, [], { projectId: "project", workspacePath: root });
    const alreadyQueuedSave = service.setDraft("new:project", "最后一次自动保存", undefined, [], { projectId: "project", workspacePath: root });
    const deletion = service.clearDraft("new:project");
    await Promise.all([alreadyQueuedSave, deletion]);
    expect(await service.getDraft("new:project")).toBeNull();
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

  it("detaches a submitted draft row without deleting its text file until final cleanup", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-ui-text-submit-"));
    const service = new UiStateService(root);
    const attachment = await service.createTextDraftAttachment("session-submit", "发送中的长文本");
    await service.setDraft("session-submit", "问题", undefined, [attachment]);

    const detached = await service.detachDraftForSubmission("session-submit");
    expect(await service.getDraft("session-submit")).toBeNull();
    expect(await service.readTextDraftAttachment(attachment.path!)).toBe("发送中的长文本");

    await service.discardDetachedDraftFiles("session-submit", detached);
    await expect(stat(attachment.path!)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("never deletes a follow-up attachment created while the prior turn is running", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-ui-text-follow-up-"));
    const service = new UiStateService(root);
    const submitted = await service.createTextDraftAttachment("session-follow-up", "第一回合附件");
    await service.setDraft("session-follow-up", "第一回合", undefined, [submitted]);
    const detached = await service.detachDraftForSubmission("session-follow-up");

    const followUp = await service.createTextDraftAttachment("session-follow-up", "下一回合附件");
    await service.setDraft("session-follow-up", "下一回合", undefined, [followUp]);
    await service.discardDetachedDraftFiles("session-follow-up", detached);

    await expect(stat(submitted.path!)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await service.readTextDraftAttachment(followUp.path!)).toBe("下一回合附件");
    expect((await service.getDraft("session-follow-up"))?.attachments?.[0]?.path).toBe(followUp.path);
  });

  it("does not detach a newer follow-up row when an older submission finishes preparing", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-ui-draft-generation-"));
    const service = new UiStateService(root);
    await service.setDraft("session-generation", "旧问题", undefined, [], undefined, "submission-old");
    await service.setDraft("session-generation", "新的跟进");

    expect(await service.detachDraftForSubmission("session-generation", "submission-old")).toEqual([]);
    const followUp = await service.getDraft("session-generation");
    expect(followUp).toMatchObject({ text: "新的跟进" });
    expect(followUp).not.toHaveProperty("submissionId");
  });

  it("protects a submitted text file from follow-up autosave cleanup until caching ends", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-ui-draft-protection-"));
    const service = new UiStateService(root);
    const submitted = await service.createTextDraftAttachment("session-protected", "正在复制");
    await service.setDraft("session-protected", "旧问题", undefined, [submitted], undefined, "submission-protected");
    const release = service.protectDraftFiles("session-protected", [submitted.path!]);

    await service.setDraft("session-protected", "新的跟进");
    expect(await service.readTextDraftAttachment(submitted.path!)).toBe("正在复制");
    release();
    expect(await service.detachDraftForSubmission("session-protected", "submission-protected")).toEqual([]);
    expect((await service.getDraft("session-protected"))?.text).toBe("新的跟进");
  });

  it("ignores cleanup paths from another draft key", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-ui-text-cross-key-"));
    const service = new UiStateService(root);
    const other = await service.createTextDraftAttachment("session-other", "必须保留");
    await service.discardDetachedDraftFiles("session-submit", [other.path!]);
    expect(await service.readTextDraftAttachment(other.path!)).toBe("必须保留");
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
    expect(await service.resolveTextDraftAttachment("session-created", moved?.attachments?.[0]?.path!)).toBe(moved?.attachments?.[0]?.path);
    await expect(service.resolveTextDraftAttachment("another-session", moved?.attachments?.[0]?.path!)).rejects.toThrow("不属于当前会话");
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
