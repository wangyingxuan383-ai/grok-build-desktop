import { useEffect, useRef, useState } from "react";
import type { editor } from "monaco-editor";
import { UiDialog } from "./ui/primitives";
import { addDiffAnnotation, appendDiffAnnotations, assertFeedbackOwner, boundedDiffRange, feedbackOwner, type DiffAnnotation, type DiffLineRange, type FeedbackOwner } from "./feedback-context";
import "../styles/context-feedback.css";

type PendingAnnotation = DiffLineRange & { owner: FeedbackOwner; validate(): Promise<boolean> };

export function useDiffAnnotations(onError: (message: string) => void) {
  const [pending, setPending] = useState<PendingAnnotation>();
  const [comment, setComment] = useState("");
  const [items, setItems] = useState<DiffAnnotation[]>([]);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const begin = (range: DiffLineRange, sessionId: string | undefined, workspace: string, validate: () => Promise<boolean>): void => {
    try {
      const next = { ...boundedDiffRange(range), owner: feedbackOwner(sessionId, workspace), validate };
      // Keep unfinished text when selecting another range.
      setPending(next);
    } catch (error) { onError(String(error)); }
  };
  const save = (): void => {
    if (!pending) return;
    try {
      assertFeedbackOwner(pending.owner);
      const next = addDiffAnnotation(items, { ...pending, id: crypto.randomUUID(), comment });
      setItems(next); setPending(undefined); setComment("");
    } catch (error) { onError(String(error)); }
  };
  const send = async (): Promise<void> => {
    if (sending.current) return;
    sending.current = true;
    const submittedIds = new Set(items.map(item => item.id));
    setBusy(true);
    try { await appendDiffAnnotations(items); if (mounted.current) setItems(current => current.filter(item => !submittedIds.has(item.id))); }
    catch (error) { onError(String(error)); }
    finally { sending.current = false; if (mounted.current) setBusy(false); }
  };
  const panel = <>
    {items.length > 0 && <section className="diff-annotation-drafts" aria-label="待发送的 Diff 批注"><header><strong>{items.length} 条批注</strong><button disabled={busy} onClick={() => void send()}>{busy ? "正在核对…" : "加入当前会话草稿"}</button></header><ul>{items.map(item => <li key={item.id}><span><strong>{item.path}:{item.startLine}{item.endLine !== item.startLine ? `–${item.endLine}` : ""} · {item.side === "new" ? "新文件" : "旧文件"}</strong><p>{item.comment}</p></span><button aria-label={`移除 ${item.path}:${item.startLine} 批注`} disabled={busy} onClick={() => setItems(values => values.filter(value => value.id !== item.id))}>×</button></li>)}</ul></section>}
    <UiDialog open={Boolean(pending)} onOpenChange={open => { if (!open) setPending(undefined); }} title="添加 Diff 批注">
      {pending && <><p>{pending.path}:{pending.startLine}{pending.endLine !== pending.startLine ? `–${pending.endLine}` : ""} · {pending.side === "new" ? "新文件" : "旧文件"}</p><textarea autoFocus aria-label="Diff 批注" value={comment} maxLength={2000} onChange={event => setComment(event.target.value)} placeholder="写下需要修改或核对的内容…"/><p>先保存批注，再明确加入当前会话草稿；由你发送。</p><button disabled={!comment.trim()} onClick={save}>保存批注</button></>}
    </UiDialog>
  </>;
  return { begin, panel };
}

/** Selection lives in the actual Monaco model; never derive lines from copied text. */
export function installDiffAnnotationActions(diff: editor.IStandaloneDiffEditor, begin: (side: "old" | "new", start: number, end: number) => void): () => void {
  const actions = (["old", "new"] as const).map(side => {
    const target = side === "old" ? diff.getOriginalEditor() : diff.getModifiedEditor();
    return target.addAction({ id: `grok.diff.comment.${side}`, label: "为所选行添加批注", contextMenuGroupId: "9_cutcopypaste", contextMenuOrder: 10, run: () => {
      const selection = target.getSelection();
      if (!selection || selection.isEmpty()) return;
      const end = selection.endLineNumber > selection.startLineNumber && selection.endColumn === 1 ? selection.endLineNumber - 1 : selection.endLineNumber;
      begin(side, selection.startLineNumber, end);
    } });
  });
  return () => actions.forEach(action => action.dispose());
}

/** Compact patch models omit unchanged gaps, so maintain exact source line maps. */
export function splitPatchWithLines(patch: string): { original: string; modified: string; oldLines: number[]; newLines: number[] } {
  const original: string[] = [], modified: string[] = [], oldLines: number[] = [], newLines: number[] = [];
  let old = 0, next = 0, inHunk = false;
  for (const line of patch.replace(/\r\n/g, "\n").split("\n")) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) { old = Number(header[1]); next = Number(header[2]); inHunk = true; continue; }
    if (line.startsWith("diff --git")) { inHunk = false; continue; }
    if (!inHunk || line.startsWith("\\ No newline")) continue;
    if (line.startsWith("-")) { original.push(line.slice(1)); oldLines.push(old++); }
    else if (line.startsWith("+")) { modified.push(line.slice(1)); newLines.push(next++); }
    else if (line.startsWith(" ")) { original.push(line.slice(1)); modified.push(line.slice(1)); oldLines.push(old++); newLines.push(next++); }
  }
  return { original: original.join("\n"), modified: modified.join("\n"), oldLines, newLines };
}

export function mappedDiffRange(lines: number[], start: number, end: number): { startLine: number; endLine: number } {
  const selected = lines.slice(start - 1, end);
  if (start < 1 || end < start || selected.length !== end - start + 1 || !selected.length || selected.some((line, i) => i > 0 && line !== selected[i - 1]! + 1)) throw Error("所选内容跨越 Diff 区块或不属于文件行，请重新选择");
  return { startLine: selected[0]!, endLine: selected.at(-1)! };
}
