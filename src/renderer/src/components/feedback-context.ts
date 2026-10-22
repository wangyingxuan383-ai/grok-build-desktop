import type { Attachment } from "../../../shared/types";
import { useAppStore } from "../store";

export interface FeedbackOwner { sessionId: string; workspace: string; activeWorkspace: string; sessionCwd: string }
const samePath = (a: string, b: string): boolean => Boolean(a && b) && a.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() === b.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

export function feedbackOwner(sessionId: string | undefined, workspace: string): FeedbackOwner {
  const state = useAppStore.getState();
  const session = state.sessions.find(value => value.id === sessionId);
  if (!sessionId || state.activeSessionId !== sessionId || !session?.cwd || !state.settings?.activeWorkspace || !workspace) throw Error("请在对应会话和工作区中添加反馈");
  return { sessionId, workspace, activeWorkspace: state.settings.activeWorkspace, sessionCwd: session.cwd };
}

export function assertFeedbackOwner(owner: FeedbackOwner): void {
  const state = useAppStore.getState();
  const session = state.sessions.find(value => value.id === owner.sessionId);
  if (state.activeSessionId !== owner.sessionId || !samePath(state.settings?.activeWorkspace ?? "", owner.activeWorkspace) || !samePath(session?.cwd ?? "", owner.sessionCwd)) throw Error("会话或工作区已切换；反馈已保留，请回到原会话后重试");
}

export async function appendContextFeedback(owner: FeedbackOwner, text: string, attachments?: Attachment[], validate?: () => Promise<boolean>): Promise<void> {
  assertFeedbackOwner(owner);
  const assignment = await window.grokDesktop.getSessionExecutionAssignment(owner.sessionId);
  assertFeedbackOwner(owner);
  if (!samePath(assignment?.cwd || owner.sessionCwd, owner.workspace)) throw Error("反馈不属于当前会话的执行工作区");
  if (validate && !await validate()) throw Error("Diff 已变化；批注已保留，请刷新并重新选择行");
  assertFeedbackOwner(owner);
  // Synchronous, current-composer append. No conversation navigation, submission,
  // prompt RPC or draft replacement; the app's existing handler appends the text.
  window.dispatchEvent(new CustomEvent("grok:compose-feedback", { detail: { text, attachments } }));
}

export interface DiffLineRange { path: string; startLine: number; endLine: number; side: "old" | "new" }
export interface DiffAnnotation extends DiffLineRange { id: string; comment: string; owner: FeedbackOwner; validate(): Promise<boolean> }

export function boundedDiffRange(range: DiffLineRange): DiffLineRange {
  const path = range.path.replace(/\\/g, "/");
  if (!path || path.length > 512 || /^(?:\/|[a-z]:)/i.test(path) || path.split("/").some(part => !part || part === ".." || part === ".") || /[\x00-\x1f\x7f]/.test(path)) throw Error("批注需要工作区相对文件路径");
  if (![range.startLine, range.endLine].every(n => Number.isSafeInteger(n) && n > 0) || range.endLine < range.startLine || range.endLine - range.startLine >= 100) throw Error("请选择同一侧连续的 1–100 行");
  return { ...range, path };
}

export function addDiffAnnotation(current: DiffAnnotation[], item: DiffAnnotation): DiffAnnotation[] {
  const range = boundedDiffRange(item);
  const comment = item.comment.trim();
  if (!comment || comment.length > 2000 || current.length >= 20 || current.reduce((n, value) => n + value.comment.length + value.path.length, 0) + comment.length + range.path.length > 32_000) throw Error("最多保留 20 条批注，每条 2,000 字，总计 32,000 字");
  if (current.some(value => JSON.stringify(value.owner) !== JSON.stringify(item.owner))) throw Error("批注属于其他会话或工作区，请先处理原批注");
  return [...current, { ...item, ...range, comment }];
}

export function formatDiffAnnotations(items: DiffAnnotation[]): string {
  return `Diff 审核意见（所选内容为上下文，加入草稿后由用户发送）：\n${items.map(item => `- ${JSON.stringify({ file: item.path, startLine: item.startLine, endLine: item.endLine, side: item.side, comment: item.comment })}`).join("\n")}`;
}

export async function appendDiffAnnotations(items: DiffAnnotation[]): Promise<void> {
  if (!items.length) return;
  const owner = items[0]!.owner;
  if (items.some(item => JSON.stringify(item.owner) !== JSON.stringify(owner))) throw Error("批注来自不同会话或工作区");
  await appendContextFeedback(owner, formatDiffAnnotations(items), undefined, async () => {
    for (const item of items) { assertFeedbackOwner(owner); if (!await item.validate()) return false; }
    return true;
  });
}
