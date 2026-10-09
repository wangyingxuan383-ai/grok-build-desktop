/**
 * In-memory record of uploads and downloads for the transfer centre. A transfer only moves a
 * file; cancelling or retrying it never stops, repeats or resends work on the computer.
 * Kept free of React Native imports so it runs under Node tests.
 */
export type TransferKind = "thumbnail" | "original" | "upload" | "update";
export type TransferState = "queued" | "running" | "done" | "failed" | "cancelled";
export interface Transfer {
    id: string;
    kind: TransferKind;
    label: string;
    state: TransferState;
    error?: string;
    updatedAt: number;
    received?: number;
    total?: number;
}

type Listener = () => void;
const LIMIT = 60;
let items: Transfer[] = [];
const listeners = new Set<Listener>();
const retries = new Map<string, () => void>();
const cancellations = new Map<string, () => void>();

function emit() { for (const listener of listeners) listener(); }

export function subscribeTransfers(listener: Listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function transfersSnapshot(): Transfer[] { return items; }

/** Thumbnails are too frequent to list individually; only their failures are recorded. */
export function trackTransfer(id: string, kind: TransferKind, label: string, state: TransferState, error?: string, retry?: () => void, progress?: { received: number; total?: number }, cancel?: () => void) {
    if (kind === "thumbnail" && state !== "failed" && !items.some(item => item.id === id)) return;
    const next: Transfer = { id, kind, label, state, error, updatedAt: Date.now(), ...progress };
    items = [next, ...items.filter(item => item.id !== id)].slice(0, LIMIT);
    if (retry) retries.set(id, retry); else if (state === "done") retries.delete(id);
    if (cancel) cancellations.set(id, cancel);
    if (state !== "running" && state !== "queued") cancellations.delete(id);
    for (const key of [...retries.keys()]) if (!items.some(item => item.id === key)) retries.delete(key);
    for (const key of [...cancellations.keys()]) if (!items.some(item => item.id === key)) cancellations.delete(key);
    emit();
}

export function retryTransfer(id: string) { const retry = retries.get(id); if (retry) retry(); }
export function canRetry(id: string) { return retries.has(id); }
export function cancelTransfer(id: string) { cancellations.get(id)?.(); }
export function canCancel(id: string) { return cancellations.has(id); }

/** Keeps running and failed entries; finished ones are history the user may clear. */
export function clearFinishedTransfers() {
    items = items.filter(item => item.state === "running" || item.state === "queued" || item.state === "failed");
    for (const id of [...retries.keys()]) if (!items.some(item => item.id === id)) retries.delete(id);
    emit();
}

export function transferCounts(list: Transfer[]) {
    return {
        running: list.filter(item => item.state === "running" || item.state === "queued").length,
        failed: list.filter(item => item.state === "failed").length,
    };
}
