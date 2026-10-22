import type { AttachmentDropEvent } from "../../shared/attachment-drop";
import type { Attachment } from "../../shared/types";

export interface AttachmentDropTarget {
  isCurrent(): boolean;
  receive(attachments: Attachment[]): void;
}

/** Resolve the destination at drop time, never after asynchronous attachment preparation. */
export function observeAttachmentDrops(
  subscribe: (listener: (event: AttachmentDropEvent) => void) => () => void,
  capture: () => AttachmentDropTarget | undefined,
  onError: (message: string) => void,
): () => void {
  const pending = new Map<string, AttachmentDropTarget>();
  const off = subscribe(event => {
    if (event.phase === "started") {
      const target = capture();
      if (target) pending.set(event.id, target);
      return;
    }
    const target = pending.get(event.id);
    pending.delete(event.id);
    if (!target) return;
    if (!target.isCurrent()) {
      if (event.phase === "completed") onError("会话或草稿已切换，拖入的附件未添加。请在目标会话重新拖入。");
      return;
    }
    if (event.phase === "failed") onError(event.message);
    else target.receive(event.attachments);
  });
  return () => { off(); pending.clear(); };
}
