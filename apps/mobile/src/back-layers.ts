import { useEffect, useRef } from "react";

/**
 * Pages inside a tab (image editor, task editor, selection mode…) register a back layer while
 * they are open. The Android back gesture asks the most recently opened layer first, so it
 * always leaves the innermost page instead of jumping to the conversation home.
 *
 * A handler returns true when it consumed the gesture (closed itself or asked to confirm
 * unsaved changes) and false to let the next layer or the shell handle it.
 */
type Handler = () => boolean;
interface Layer { id: number; handler: { current: Handler } }

export function createBackStack() {
    let layers: Layer[] = [], seq = 0;
    return {
        push(handler: { current: Handler }) { const layer = { id: ++seq, handler }; layers = [...layers, layer]; return () => { layers = layers.filter(l => l !== layer); }; },
        /** Innermost first; a layer that declines passes the gesture outward. */
        handle(): boolean { for (const layer of [...layers].reverse()) if (layer.handler.current()) return true; return false; },
        depth: () => layers.length,
        clear() { layers = []; },
    };
}

export const backStack = createBackStack();

/** Registers `onBack` while `active`. Return false from `onBack` to decline. */
export function useBackLayer(active: boolean, onBack: () => boolean | void) {
    const handler = useRef<Handler>(() => true);
    handler.current = () => onBack() !== false;
    useEffect(() => active ? backStack.push(handler) : undefined, [active]);
}
