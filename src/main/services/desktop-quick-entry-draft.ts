import { randomUUID } from "node:crypto";
import type { AppSettings, Attachment, SessionSummary } from "../../shared/types";
import type { QuickEntryAttachment, QuickEntryContext, QuickEntryIntent, QuickEntrySubmission } from "../../renderer/quick-entry/contracts";

export interface QuickEntryController {
  getSettings(): Promise<AppSettings>;
  discoverWorkspaces(): Promise<Array<{ cwd: string; name: string; exists: boolean; hidden: boolean }>>;
  listSessions(cwd: string): Promise<SessionSummary[]>;
  getDesktopActivity(): Promise<{ sessions: Array<{ sessionId: string; status: string }> }>;
  openSession(cwd: string, sessionId: string, activate?: boolean): Promise<{ sessionId: string; hydration?: string }>;
  createSession?(cwd: string, activate?: boolean): Promise<{ sessionId: string; cwd?: string }>;
  sendPrompt(sessionId: string, text: string, attachments: Attachment[], clientMessageId?: string): Promise<void>;
}

export interface QuickEntryRecovery { cwd: string; sourceWorkspacePath?: string; sessionId: string; text: string; attachments: Attachment[]; }

/** Draft attachments live only in main memory; the renderer can reference issued IDs only. */
export class DesktopQuickEntryDraft {
  readonly id = randomUUID();
  readonly attachments = new Map<string, Attachment>();
  private canceled = false;
  private submitting = false;
  private workspace = "";
  private recovery?: QuickEntryRecovery;
  private createdTarget?: { sourceWorkspacePath: string; cwd: string; sessionId: string };
  constructor(private readonly controller: QuickEntryController, readonly intent: QuickEntryIntent,
    private readonly dispatched: (target: { cwd: string; sessionId: string }) => void,
    private readonly sendError: (error: unknown, recovery: QuickEntryRecovery) => void,
    private readonly confirmAttachments: (cwd: string, attachments: Attachment[]) => Promise<boolean> = async () => true) {}

  assertActive(id: unknown): void { if (this.canceled || id !== this.id) throw new Error("快速提问草稿已关闭，请重新打开"); }

  async context(cwd?: string, warnings: string[] = []): Promise<QuickEntryContext> {
    this.assertActive(this.id);
    const settings = await this.controller.getSettings();
    const discovered = await this.controller.discoverWorkspaces();
    const workspaces = discovered.filter(row => row.exists && !row.hidden).map(({ cwd, name }) => ({ cwd, name }));
    // Settings roots are useful before a project catalog has been populated.
    for (const path of [settings.activeWorkspace, ...settings.recentWorkspaces]) {
      if (path && !workspaces.some(row => row.cwd === path)) workspaces.push({ cwd: path, name: path.split(/[\\/]/).filter(Boolean).at(-1) || path });
    }
    const recoveryWorkspace = this.recovery?.sourceWorkspacePath || this.recovery?.cwd;
    const recoveredWorkspace = workspaces.some(row => row.cwd === recoveryWorkspace) ? recoveryWorkspace : "";
    const workspace = cwd ?? (this.workspace || recoveredWorkspace || settings.activeWorkspace || workspaces[0]?.cwd || "");
    if (workspace && !workspaces.some(row => row.cwd === workspace)) throw new Error("请在主窗口添加此项目");
    // The controller's project catalog also includes its assigned worktree sessions.
    // Keep their actual cwd so opening/recovery never rebinds them to the source root.
    const sessions = (workspace ? await this.controller.listSessions(workspace) : [])
      .filter(row => !row.archived && !row.parentSessionId && row.originKind !== "automation" && (row.cwd === workspace || Boolean(row.worktreeId)));
    this.assertActive(this.id);
    this.workspace = workspace;
    return { draftId: this.id, intent: this.intent, workspaces, workspace,
      sessions: sessions.map(({ id, cwd, title, status }) => ({ id, cwd, title, status })),
      attachments: this.views(), theme: settings.theme, warnings,
      ...(this.recovery ? { recovery: { text: this.recovery.text, sessionId: sessions.some(row => row.id === this.recovery!.sessionId && row.cwd === this.recovery!.cwd) ? this.recovery.sessionId : "",
        message: "上次发送未能确认完成，内容已恢复。请先查看主窗口的发送状态，再决定是否重试。" } } : {}) };
  }

  add(id: unknown, attachments: Attachment[]): QuickEntryAttachment[] {
    this.assertActive(id);
    if (this.submitting) throw new Error("正在提交，请稍候");
    if (this.attachments.size + attachments.length > 20) throw new Error("每次最多添加 20 个附件");
    for (const attachment of attachments) this.attachments.set(attachment.id, structuredClone(attachment));
    return this.views();
  }

  remove(id: unknown, attachmentId: unknown): void {
    this.assertActive(id);
    if (this.submitting) throw new Error("正在提交，请稍候");
    if (typeof attachmentId !== "string" || !this.attachments.delete(attachmentId)) throw new Error("附件已移除");
  }

  async send(input: QuickEntrySubmission): Promise<void> {
    this.assertActive(input?.draftId);
    if (this.submitting) throw new Error("正在提交，请勿重复发送");
    if (!input || Object.keys(input).some(key => !["draftId", "cwd", "sessionId", "text", "attachmentIds"].includes(key))
      || typeof input.cwd !== "string" || !input.cwd.trim() || input.cwd.length > 4096 || typeof input.sessionId !== "string" || input.sessionId.length > 256
      || typeof input.text !== "string" || input.text.length > 100_000
      || !Array.isArray(input.attachmentIds) || input.attachmentIds.length > 20
      || input.attachmentIds.some(id => typeof id !== "string" || !this.attachments.has(id))
      || new Set(input.attachmentIds).size !== input.attachmentIds.length
      || (!input.text.trim() && !input.attachmentIds.length)) throw new Error("请选择会话并输入内容或添加附件");
    if (input.cwd !== this.workspace) throw new Error("项目已更改，请重新选择会话");
    this.submitting = true;
    try {
      const context = await this.context(input.cwd);
      const createdTarget = this.createdTarget?.sourceWorkspacePath === input.cwd ? this.createdTarget : undefined;
      const sessionId = input.sessionId || createdTarget?.sessionId || "";
      const session = context.sessions.find(row => row.id === sessionId);
      if (sessionId && (!session || (sessionId === createdTarget?.sessionId && session.cwd !== createdTarget.cwd))) throw new Error("会话已不存在或已迁移，请在主窗口选择会话");
      if (session && ["working", "needs-user", "queued"].includes(session.status)) throw new Error("此会话正在运行或等你处理，请前往主窗口");
      const attachments = input.attachmentIds.map(id => structuredClone(this.attachments.get(id)!));
      if (!await this.confirmAttachments(input.cwd, attachments)) return;
      this.assertActive(input.draftId);
      let target = { sessionId, cwd: session?.cwd || input.cwd };
      if (!target.sessionId) {
        if (!this.controller.createSession) throw new Error("请先在主窗口创建会话");
        const created = await this.controller.createSession(input.cwd, false);
        target = { sessionId: created.sessionId, cwd: created.cwd || input.cwd };
        this.assertActive(input.draftId);
        // A failed preflight must retry the same owned session/worktree, not create another.
        this.createdTarget = { ...target, sourceWorkspacePath: input.cwd };
      }
      await this.assertTargetReady(target.sessionId);
      this.assertActive(input.draftId);
      const opened = await this.controller.openSession(target.cwd, target.sessionId, false);
      this.assertActive(input.draftId);
      if (opened.sessionId !== target.sessionId || opened.hydration !== "ready") throw new Error("会话尚未就绪，请在主窗口重试");
      await this.assertTargetReady(target.sessionId);
      this.assertActive(input.draftId);
      // The existing controller owns attachment validation, delivery and failure records.
      // Its promise spans the entire turn; transfer ownership without holding the floater open.
      // Keep a separate recovery copy until the complete turn promise settles.
      const recovery = { cwd: target.cwd, sourceWorkspacePath: input.cwd, sessionId: target.sessionId, text: input.text, attachments: structuredClone(attachments) };
      const delivery = this.controller.sendPrompt(target.sessionId, input.text, attachments, randomUUID());
      void delivery.catch(error => this.sendError(error, recovery));
      this.discard();
      this.dispatched(target);
    } finally { this.submitting = false; }
  }

  restore(recovery: QuickEntryRecovery): void {
    this.assertActive(this.id);
    this.recovery = structuredClone(recovery);
    for (const attachment of recovery.attachments) this.attachments.set(attachment.id, structuredClone(attachment));
  }
  discard(): void { this.canceled = true; this.attachments.clear(); this.workspace = ""; this.recovery = undefined; this.createdTarget = undefined; }

  private async assertTargetReady(sessionId: string): Promise<void> {
    const activity = await this.controller.getDesktopActivity();
    if (activity.sessions.some(row => row.sessionId === sessionId && ["running", "awaiting"].includes(row.status))) {
      throw new Error("此会话正在运行或等你处理，请前往主窗口");
    }
  }

  private views(): QuickEntryAttachment[] {
    return [...this.attachments.values()].map(({ id, name, kind, size, data, mimeType }) => ({ id, name, kind, size,
      ...(data && kind === "image" && /^image\/(png|jpeg|webp|gif)$/.test(mimeType ?? "") ? { previewUrl: `data:${mimeType};base64,${data}` } : {}) }));
  }
}
