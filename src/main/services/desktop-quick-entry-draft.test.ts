import { describe, expect, it, vi } from "vitest";
import type { AppSettings, SessionSummary } from "../../shared/types";
import { DesktopQuickEntryDraft, type QuickEntryController } from "./desktop-quick-entry-draft";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, failed) => { resolve = done; reject = failed; });
  return { promise, resolve, reject };
}

function fixture() {
  const session = { id: "session-1", cwd: "D:/project", title: "Task", status: "idle" } as SessionSummary;
  const controller: QuickEntryController = {
    getSettings: vi.fn(async () => ({ activeWorkspace: "D:/project", recentWorkspaces: [], theme: { mode: "dark" } } as unknown as AppSettings)),
    discoverWorkspaces: vi.fn(async () => [{ cwd: "D:/project", name: "Project", exists: true, hidden: false }]),
    listSessions: vi.fn(async () => [session]), getDesktopActivity: vi.fn(async () => ({ sessions: [] })),
    openSession: vi.fn(async () => ({ sessionId: "session-1", hydration: "ready" })), sendPrompt: vi.fn(async () => undefined),
  };
  const dispatched = vi.fn(), error = vi.fn();
  const draft = new DesktopQuickEntryDraft(controller, "ask", dispatched, error);
  const input = { draftId: draft.id, cwd: "D:/project", sessionId: "session-1", text: "Explain this", attachmentIds: [] as string[] };
  return { controller, draft, input, dispatched, error, session };
}

describe("quick-entry draft ownership and explicit dispatch", () => {
  it("creates an empty-session target with the normal project defaults and dispatches to its returned worktree", async () => {
    const { draft, controller, input, dispatched } = fixture(); await draft.context();
    controller.createSession = vi.fn(async () => ({ sessionId: "created", cwd: "D:/worktrees/task" }));
    controller.openSession = vi.fn(async () => ({ sessionId: "created", hydration: "ready" }));
    await draft.send({ ...input, sessionId: "" });
    expect(controller.createSession).toHaveBeenCalledExactlyOnceWith("D:/project", false);
    expect(controller.openSession).toHaveBeenCalledExactlyOnceWith("D:/worktrees/task", "created", false);
    expect(controller.sendPrompt).toHaveBeenCalledExactlyOnceWith("created", input.text, [], expect.any(String));
    expect(dispatched).toHaveBeenCalledExactlyOnceWith({ cwd: "D:/worktrees/task", sessionId: "created" });
  });
  it("rejects duplicate sends while creating and after transferring the draft", async () => {
    const { draft, controller, input } = fixture(); await draft.context();
    const creation = deferred<{ sessionId: string }>();
    controller.createSession = vi.fn(() => creation.promise);
    const request = { ...input, sessionId: "" };
    const sending = draft.send(request);
    await vi.waitFor(() => expect(controller.createSession).toHaveBeenCalledOnce());
    await expect(draft.send(request)).rejects.toThrow("重复发送");
    expect(() => draft.add(draft.id, [])).toThrow("正在提交");
    creation.resolve({ sessionId: "session-1" }); await sending;
    await expect(draft.send(request)).rejects.toThrow("已关闭");
    expect(controller.createSession).toHaveBeenCalledOnce(); expect(controller.sendPrompt).toHaveBeenCalledOnce();
  });
  it("does not open or send a late creation after cancellation", async () => {
    const { draft, controller, input, dispatched } = fixture(); await draft.context();
    const creation = deferred<{ sessionId: string; cwd: string }>();
    controller.createSession = vi.fn(() => creation.promise);
    draft.add(draft.id, [{ id: "image", name: "Private.png", kind: "image", data: "c2VjcmV0" }]);
    const sending = draft.send({ ...input, sessionId: "", attachmentIds: ["image"] });
    await vi.waitFor(() => expect(controller.createSession).toHaveBeenCalledOnce());
    draft.discard(); creation.resolve({ sessionId: "created", cwd: "D:/worktrees/task" });
    await expect(sending).rejects.toThrow("已关闭");
    expect(controller.openSession).not.toHaveBeenCalled(); expect(controller.sendPrompt).not.toHaveBeenCalled();
    expect(dispatched).not.toHaveBeenCalled(); expect(draft.attachments.size).toBe(0);
  });
  it("keeps text and attachments available after creation failure and permits an explicit retry", async () => {
    const { draft, controller, input } = fixture(); await draft.context();
    controller.createSession = vi.fn().mockRejectedValueOnce(Error("creation failed")).mockResolvedValueOnce({ sessionId: "session-1" });
    draft.add(draft.id, [{ id: "file", name: "notes.txt", kind: "file", path: "D:/project/notes.txt" }]);
    const request = { ...input, sessionId: "", attachmentIds: ["file"] };
    await expect(draft.send(request)).rejects.toThrow("creation failed");
    expect((await draft.context()).attachments).toHaveLength(1); expect(controller.sendPrompt).not.toHaveBeenCalled();
    await draft.send(request);
    expect(controller.createSession).toHaveBeenCalledTimes(2);
    expect(controller.sendPrompt).toHaveBeenCalledWith("session-1", input.text, [expect.objectContaining({ id: "file" })], expect.any(String));
  });
  it("reuses a created worktree after a hydration failure instead of creating another session", async () => {
    const { draft, controller, input, session } = fixture(); await draft.context();
    const created = { ...session, id: "created", cwd: "D:/worktrees/task", worktreeId: "worktree-1" };
    controller.createSession = vi.fn(async () => { controller.listSessions = async () => [created]; return { sessionId: created.id, cwd: created.cwd }; });
    controller.openSession = vi.fn().mockResolvedValueOnce({ sessionId: created.id, hydration: "offline" }).mockResolvedValueOnce({ sessionId: created.id, hydration: "ready" });
    draft.add(draft.id, [{ id: "file", name: "notes.txt", kind: "file", path: "D:/project/notes.txt" }]);
    const request = { ...input, sessionId: "", attachmentIds: ["file"] };
    await expect(draft.send(request)).rejects.toThrow("尚未就绪");
    expect(draft.attachments.size).toBe(1); expect(controller.sendPrompt).not.toHaveBeenCalled();
    await draft.send(request);
    expect(controller.createSession).toHaveBeenCalledOnce(); expect(controller.openSession).toHaveBeenCalledTimes(2);
    expect(controller.openSession).toHaveBeenLastCalledWith(created.cwd, created.id, false);
    expect(controller.sendPrompt).toHaveBeenCalledExactlyOnceWith(created.id, input.text, [expect.objectContaining({ id: "file" })], expect.any(String));
  });
  it("does not replace or send to a created target that was removed before retry", async () => {
    const { draft, controller, input } = fixture(); await draft.context();
    controller.createSession = vi.fn(async () => ({ sessionId: "created", cwd: "D:/worktrees/task" }));
    controller.openSession = vi.fn(async () => ({ sessionId: "created", hydration: "failed" }));
    const request = { ...input, sessionId: "" };
    await expect(draft.send(request)).rejects.toThrow("尚未就绪");
    await expect(draft.send(request)).rejects.toThrow("已不存在");
    expect(controller.createSession).toHaveBeenCalledOnce(); expect(controller.sendPrompt).not.toHaveBeenCalled();
  });
  it("retains the source project and actual worktree owner when recovering a failed dispatch", async () => {
    const { draft, controller, input, session, error } = fixture(); await draft.context();
    const created = { ...session, id: "created", cwd: "D:/worktrees/task", worktreeId: "worktree-1" };
    controller.createSession = vi.fn(async () => ({ sessionId: created.id, cwd: created.cwd }));
    controller.openSession = vi.fn(async () => ({ sessionId: created.id, hydration: "ready" }));
    controller.sendPrompt = vi.fn(async () => { throw Error("send failed"); });
    await draft.send({ ...input, sessionId: "" }); await Promise.resolve();
    controller.listSessions = vi.fn(async () => [created]);
    controller.getSettings = vi.fn(async () => ({ activeWorkspace: "D:/other", recentWorkspaces: [input.cwd], theme: {} } as AppSettings));
    const restored = new DesktopQuickEntryDraft(controller, "ask", vi.fn(), vi.fn()); restored.restore(error.mock.calls[0]![1]);
    const context = await restored.context();
    expect(context.workspace).toBe(input.cwd); expect(context.workspaces.map(row => row.cwd)).not.toContain(created.cwd);
    expect(context.sessions).toEqual([expect.objectContaining({ id: created.id, cwd: created.cwd })]);
    expect(context.recovery).toMatchObject({ sessionId: created.id, text: input.text });
    controller.sendPrompt = vi.fn(async () => undefined);
    await restored.send({ ...input, draftId: restored.id, sessionId: context.recovery!.sessionId });
    expect(controller.createSession).toHaveBeenCalledOnce();
    expect(controller.openSession).toHaveBeenLastCalledWith(created.cwd, created.id, false);
  });
  it("does not create a session for an empty workspace even before context has loaded", async () => {
    const { draft, controller, input } = fixture();
    controller.createSession = vi.fn(async () => ({ sessionId: "created" }));
    await expect(draft.send({ ...input, cwd: "", sessionId: "" })).rejects.toThrow();
    expect(controller.createSession).not.toHaveBeenCalled();
  });
  it("loads context without connecting a CLI, choosing a session or sending", async () => {
    const { draft, controller } = fixture(); const context = await draft.context();
    expect(context.sessions).toHaveLength(1); expect(controller.openSession).not.toHaveBeenCalled(); expect(controller.sendPrompt).not.toHaveBeenCalled();
  });
  it("uses only issued attachment IDs and leaves main renderer drafts untouched", async () => {
    const { draft, controller, input, dispatched } = fixture(); await draft.context();
    draft.add(draft.id, [{ id: "image", name: "Screenshot.png", kind: "image", data: "aGVsbG8=", mimeType: "image/png" }]);
    await expect(draft.send({ ...input, attachmentIds: ["forged"] })).rejects.toThrow();
    expect(controller.openSession).not.toHaveBeenCalled();
    await draft.send({ ...input, attachmentIds: ["image"] });
    expect(controller.openSession).toHaveBeenCalledWith("D:/project", "session-1", false);
    expect(controller.sendPrompt).toHaveBeenCalledWith("session-1", "Explain this", [expect.objectContaining({ id: "image" })], expect.any(String));
    expect(dispatched).toHaveBeenCalledWith({ cwd: "D:/project", sessionId: "session-1" });
    expect(draft.attachments.size).toBe(0); await expect(draft.send(input)).rejects.toThrow("已关闭");
  });
  it("rejects stale or busy targets without opening or sending", async () => {
    const { draft, controller, input, session } = fixture(); await draft.context(); session.status = "needs-user";
    await expect(draft.send(input)).rejects.toThrow("等你处理"); expect(controller.openSession).not.toHaveBeenCalled();
    session.status = "idle"; controller.listSessions = async () => [];
    await expect(draft.send(input)).rejects.toThrow("已不存在"); expect(controller.sendPrompt).not.toHaveBeenCalled();
  });
  it("checks authoritative live activity both before and after opening", async () => {
    const { draft, controller, input } = fixture(); await draft.context();
    controller.getDesktopActivity = vi.fn().mockResolvedValueOnce({ sessions: [] }).mockResolvedValueOnce({ sessions: [{ sessionId: "session-1", status: "awaiting" }] });
    await expect(draft.send(input)).rejects.toThrow("等你处理"); expect(controller.sendPrompt).not.toHaveBeenCalled();
  });
  it("discards canceled in-memory captures and prevents a delayed open from sending", async () => {
    let finish!: (value: { sessionId: string }) => void;
    const { draft, controller, input } = fixture(); await draft.context();
    controller.openSession = vi.fn(() => new Promise<{ sessionId: string }>(resolve => { finish = resolve; }));
    draft.add(draft.id, [{ id: "image", name: "Private.png", kind: "image", data: "c2VjcmV0" }]);
    const sending = draft.send(input); while (!finish) await Promise.resolve();
    draft.discard(); finish({ sessionId: "session-1" });
    await expect(sending).rejects.toThrow("已关闭"); expect(controller.sendPrompt).not.toHaveBeenCalled(); expect(draft.attachments.size).toBe(0);
  });
  it("transfers a single dispatch without awaiting an entire model turn or automatically retrying", async () => {
    let reject!: (reason: unknown) => void;
    const { draft, controller, input, error } = fixture(); await draft.context();
    controller.sendPrompt = vi.fn(() => new Promise<void>((_, failed) => { reject = failed; }));
    await draft.send(input); reject(Error("delivery failed")); await Promise.resolve();
    expect(error).toHaveBeenCalledOnce(); expect(controller.sendPrompt).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ text: "Explain this", cwd: "D:/project", sessionId: "session-1" }));
  });
  it("rejects renderer-supplied paths, whitespace-only submissions and unknown workspaces", async () => {
    const { draft, input } = fixture(); await draft.context();
    await expect(draft.send({ ...input, attachments: [{ path: "C:/private" }] } as typeof input)).rejects.toThrow();
    await expect(draft.send({ ...input, text: "  " })).rejects.toThrow();
    await expect(draft.context("C:/unknown")).rejects.toThrow("主窗口");
  });
  it.each(["offline", "failed", "connecting"])("does not send to a %s hydration result", async hydration => {
    const { draft, controller, input } = fixture(); await draft.context();
    controller.openSession = async () => ({ sessionId: "session-1", hydration });
    await expect(draft.send(input)).rejects.toThrow("尚未就绪"); expect(controller.sendPrompt).not.toHaveBeenCalled();
  });
  it("offers assigned worktrees but excludes foreign, archived, worker-managed and child sessions", async () => {
    const { draft, controller, session } = fixture();
    controller.listSessions = async () => [session, { ...session, id: "child", parentSessionId: session.id }, { ...session, id: "worker", originKind: "automation" },
      { ...session, id: "archived", archived: true }, { ...session, id: "foreign", cwd: "D:/other" },
      { ...session, id: "worktree", cwd: "D:/worktrees/task", worktreeId: "worktree-1" }];
    expect((await draft.context()).sessions.map(row => row.id)).toEqual([session.id, "worktree"]);
  });
  it.each(["session-1", ""])("checks attachment consent before connecting or creating target '%s' and keeps a declined draft available", async sessionId => {
    const { controller } = fixture(), consent = vi.fn(async () => false);
    controller.createSession = vi.fn(async () => ({ sessionId: "created" }));
    const draft = new DesktopQuickEntryDraft(controller, "ask", vi.fn(), vi.fn(), consent); await draft.context();
    draft.add(draft.id, [{ id: "file", name: ".env", path: "D:/project/.env", kind: "file" }]);
    await draft.send({ draftId: draft.id, cwd: "D:/project", sessionId, text: "Review", attachmentIds: ["file"] });
    expect(consent).toHaveBeenCalledOnce(); expect(controller.openSession).not.toHaveBeenCalled(); expect(controller.createSession).not.toHaveBeenCalled(); expect(draft.attachments.size).toBe(1);
  });
  it("restores failed-dispatch text and attachments into a separate draft without sending again", async () => {
    const { controller, draft, input, error } = fixture(); await draft.context();
    draft.add(draft.id, [{ id: "image", name: "Screenshot.png", kind: "image", data: "aGVsbG8=", mimeType: "image/png" }]);
    controller.sendPrompt = vi.fn(async () => { throw Error("attachment preparation failed"); });
    await draft.send({ ...input, attachmentIds: ["image"] }); await Promise.resolve();
    const recovery = error.mock.calls[0]![1];
    const restored = new DesktopQuickEntryDraft(controller, "ask", vi.fn(), vi.fn()); restored.restore(recovery);
    const context = await restored.context(); expect(context.recovery).toMatchObject({ text: "Explain this", sessionId: "session-1" });
    expect(context.attachments).toHaveLength(1); expect(controller.sendPrompt).toHaveBeenCalledOnce();
    restored.discard(); expect(restored.attachments.size).toBe(0);
  });
});
