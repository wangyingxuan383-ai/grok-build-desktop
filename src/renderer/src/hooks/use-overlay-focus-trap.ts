import { useEffect } from "react";

/** Keep focus and scrolling inside the highest blocking portal layer. */
export function useOverlayFocusTrap(enabled: boolean, rootId = "overlay-root"): void {
  useEffect(() => {
    if (!enabled) return;
    const root = document.getElementById(rootId);
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const isVisible = (element: HTMLElement): boolean => {
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    };
    const topLayer = (): HTMLElement | undefined => root
      ? Array.from(root.children).filter((element): element is HTMLElement => element instanceof HTMLElement && isVisible(element)).at(-1)
      : undefined;
    const focusTopLayer = (): void => {
      if (root?.contains(document.activeElement)) return;
      topLayer()?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')?.focus();
    };
    const focusFirst = window.setTimeout(focusTopLayer, 0);
    const focusObserver = new MutationObserver(() => window.setTimeout(focusTopLayer, 0));
    if (root) focusObserver.observe(root, { childList: true, subtree: true });
    const trapFocus = (event: KeyboardEvent): void => {
      const layer = topLayer();
      if (event.key !== "Tab" || !layer) return;
      const focusable = Array.from(layer.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')).filter(isVisible);
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", trapFocus, true);
    return () => {
      window.clearTimeout(focusFirst);
      focusObserver.disconnect();
      window.removeEventListener("keydown", trapFocus, true);
      document.body.style.overflow = previousOverflow;
      window.setTimeout(() => previousFocus?.focus(), 0);
    };
  }, [enabled, rootId]);
}
