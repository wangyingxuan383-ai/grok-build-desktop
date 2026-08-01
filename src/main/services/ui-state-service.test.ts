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
});
