import { useEffect, useRef, useState } from "react";

/** Conversation text that can be quoted: answers, user messages, final-answer cards. */
const QUOTABLE = ".message-row, .final-answer, .turn-card, .subagent-conversation";
const MAX_QUOTE = 8000;

/** Markdown quote block appended to a draft, keeping one blank line between parts. */
export function appendQuote(draft: string, selection: string): string {
  const text = selection.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_QUOTE);
  if (!text) return draft;
  const block = text.split("\n").map((line) => line ? `> ${line}` : ">").join("\n");
  const base = draft.replace(/\s+$/, "");
  return `${base ? `${base}\n\n` : ""}${block}\n\n`;
}

/** Ask the app to put a quote into the active composer (handled in App). */
export function requestQuote(text: string) {
  window.dispatchEvent(new CustomEvent("grok:quote", { detail: { text } }));
}

/**
 * Select any part of a message with the mouse and a small "引用 / 复制" bar appears above the
 * selection. Mouse users get partial quoting that the phone's whole-message quote can't offer.
 */
export function QuoteSelection(): React.JSX.Element | null {
  const [target, setTarget] = useState<{ text: string; x: number; y: number }>();
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const read = () => {
      const selection = window.getSelection();
      const text = selection?.toString() ?? "";
      if (!selection || selection.isCollapsed || !text.trim()) { setTarget(undefined); return; }
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
      // Only conversation content; never inputs, code editors or panels.
      if (!container?.closest(QUOTABLE) || container.closest("textarea, input, [contenteditable='true'], .composer")) { setTarget(undefined); return; }
      const rect = range.getBoundingClientRect();
      setTarget({ text, x: Math.min(window.innerWidth - 150, Math.max(8, rect.left + rect.width / 2 - 70)), y: rect.top > 52 ? rect.top - 44 : rect.bottom + 8 });
    };
    const up = (event: MouseEvent) => { if (bar.current?.contains(event.target as Node)) return; window.setTimeout(read, 0); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setTarget(undefined); else if (event.shiftKey) window.setTimeout(read, 0); };
    const clear = () => setTarget(undefined);
    document.addEventListener("mouseup", up);
    document.addEventListener("keyup", key);
    document.addEventListener("scroll", clear, true);
    window.addEventListener("blur", clear);
    return () => { document.removeEventListener("mouseup", up); document.removeEventListener("keyup", key); document.removeEventListener("scroll", clear, true); window.removeEventListener("blur", clear); };
  }, []);
  if (!target) return null;
  const done = () => { window.getSelection()?.removeAllRanges(); setTarget(undefined); };
  return <div ref={bar} className="quote-selection-bar" role="toolbar" aria-label="选中文字操作" style={{ left: target.x, top: target.y }} onMouseDown={(event) => event.preventDefault()}>
    <button type="button" onClick={() => { requestQuote(target.text); done(); }} title="把选中内容作为引用加入输入框">❝ 引用</button>
    <button type="button" onClick={() => { void navigator.clipboard.writeText(target.text); done(); }}>复制</button>
  </div>;
}
