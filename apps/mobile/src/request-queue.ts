/**
 * Prioritised, de-duplicated and cancellable work queue for media reads. Kept free of React
 * Native imports so the scheduling rules run under plain Node tests.
 *
 * Priority 0 is a picture the user just opened, 1 is a visible thumbnail, 2 is prefetch.
 * Asking again for a queued key joins the same job and can only raise its priority.
 * A job nobody wants any more is dropped before it starts; a started job always finishes,
 * because its result is a cache file other screens may reuse.
 */
export type Priority = 0 | 1 | 2;
export const PRIORITY = { user: 0, visible: 1, prefetch: 2 } as const;

export class CancelledError extends Error {
    constructor() { super("已取消"); this.name = "CancelledError"; }
}

interface Waiter<T> { resolve: (value: T) => void; reject: (error: unknown) => void; cancelled: boolean }
interface Job<T> { key: string; priority: Priority; order: number; run: () => Promise<T>; waiters: Waiter<T>[]; started: boolean }

export interface Ticket<T> { promise: Promise<T>; cancel: () => void }

export function createRequestQueue(maxParallel = 3) {
    const jobs = new Map<string, Job<unknown>>();
    let pending: Job<unknown>[] = [], active = 0, order = 0;
    const live = (job: Job<unknown>) => job.waiters.some(w => !w.cancelled);
    const pump = () => {
        while (active < maxParallel && pending.length) {
            pending.sort((a, b) => a.priority - b.priority || a.order - b.order);
            const job = pending.shift()!;
            if (!live(job)) { jobs.delete(job.key); continue; }
            job.started = true; active++;
            job.run().then(
                value => { for (const w of job.waiters) if (!w.cancelled) w.resolve(value); },
                error => { for (const w of job.waiters) if (!w.cancelled) w.reject(error); },
            ).finally(() => { active--; jobs.delete(job.key); pump(); });
        }
    };
    function request<T>(key: string, priority: Priority, run: () => Promise<T>): Ticket<T> {
        let job = jobs.get(key) as Job<T> | undefined;
        if (!job) {
            job = { key, priority, order: order++, run, waiters: [], started: false };
            jobs.set(key, job as Job<unknown>);
            pending.push(job as Job<unknown>);
        } else if (priority < job.priority) job.priority = priority;
        const waiter: Waiter<T> = { resolve: () => undefined, reject: () => undefined, cancelled: false };
        const promise = new Promise<T>((resolve, reject) => { waiter.resolve = resolve; waiter.reject = reject; });
        job.waiters.push(waiter);
        const owner = job;
        queueMicrotask(pump);
        return {
            promise,
            cancel: () => {
                if (waiter.cancelled) return;
                waiter.cancelled = true;
                waiter.reject(new CancelledError());
                if (!owner.started && !live(owner as Job<unknown>)) { pending = pending.filter(j => j !== owner); jobs.delete(owner.key); }
            },
        };
    }
    return { request, stats: () => ({ active, queued: pending.length }) };
}
