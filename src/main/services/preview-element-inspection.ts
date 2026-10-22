import type { PreviewElementContext } from "../../shared/preview-feedback";

/** Runs once, in the preview's isolated world. No listeners or globals survive it. */
function inspectPoint(x: number, y: number): PreviewElementContext | null {
  const element = document.elementFromPoint(x * innerWidth, y * innerHeight);
  if (!(element instanceof HTMLElement) || element.closest("input,textarea,select,[contenteditable],iframe,object,embed")) return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const parts: string[] = [];
  let siblingsVisited = 0;
  let current: Element | null = element;
  // Structural selectors contain no page-supplied IDs, attributes or text.
  // Escape tag names too: custom-element names are untrusted page content.
  for (let depth = 0; current && depth < 12; depth++, current = current.parentElement) {
    const tag = current.localName;
    if (!tag || tag.length > 64) return null;
    let position = 1;
    for (let sibling = current.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      if (++siblingsVisited > 2000) return null;
      if (sibling.localName === tag) position++;
    }
    parts.unshift(`${CSS.escape(tag)}:nth-of-type(${position})`);
    if (!current.parentElement) break;
  }
  const selector = parts.join(" > ");
  if (selector.length > 1024 || document.querySelector(selector) !== element) return null;
  // Never read values, HTML, hidden descendants, or the entire document.
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let text = "", visited = 0;
  for (let node = walker.nextNode(); node && visited++ < 300 && text.length < 2000; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest("script,style,noscript,input,textarea,select,[contenteditable],[hidden],[aria-hidden='true']")) continue;
    let hidden = false;
    for (let ancestor: Element | null = parent; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (style.visibility !== "visible" || style.display === "none" || style.opacity === "0") { hidden = true; break; }
    }
    if (hidden) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    if (![...range.getClientRects()].some(box => box.width > 0 && box.height > 0 && box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth)) continue;
    text += ` ${node.textContent?.slice(0, 2000 - text.length) ?? ""}`;
  }
  const left = Math.max(0, rect.left), top = Math.max(0, rect.top);
  return { selector, text: text.replace(/\s+/g, " ").trim().slice(0, 2000), bounds: {
    x: left / innerWidth, y: top / innerHeight,
    width: Math.max(0, Math.min(innerWidth, rect.right) - left) / innerWidth,
    height: Math.max(0, Math.min(innerHeight, rect.bottom) - top) / innerHeight,
  } };
}

export function previewElementInspectionScript(x: number, y: number): string {
  if (![x, y].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1)) throw Error("元素选择坐标无效");
  return `(${inspectPoint.toString()})(${x},${y})`;
}

/** Treat even isolated-world results as untrusted, bounded data at the boundary. */
export function boundedPreviewElement(value: unknown): PreviewElementContext {
  if (!value || typeof value !== "object") throw Error("此位置没有可读取的页面元素，请重新选择");
  const result = value as PreviewElementContext;
  if (typeof result.selector !== "string" || !result.selector || result.selector.length > 1024 ||
      typeof result.text !== "string" || result.text.length > 2000 || !result.bounds ||
      ![result.bounds.x, result.bounds.y, result.bounds.width, result.bounds.height].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1)) throw Error("页面元素反馈无效或过大");
  return { selector: result.selector, text: result.text, bounds: { ...result.bounds } };
}
