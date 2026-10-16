import type { CliSessionInfo } from "../../shared/types";

type Entry = { revision: string; value?: CliSessionInfo; request: Promise<void>; pending: boolean };
/** Shared by the composer and detail pane; no timer or implicit session launch. */
export class SessionContextCache {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  get(sessionId: string, revision: string): CliSessionInfo | undefined {
    const entry = this.entries.get(sessionId);
    return entry?.revision === revision ? entry.value : undefined;
  }
  read(sessionId: string, revision: string, load: (id: string) => Promise<CliSessionInfo>, force = false): Promise<void> {
    const previous = this.entries.get(sessionId);
    if (previous?.revision === revision && (!force || previous.pending)) return previous.request;
    const entry: Entry = { revision, request: Promise.resolve(), pending: true };
    this.entries.set(sessionId, entry);
    if (this.entries.size > 128) this.entries.delete(this.entries.keys().next().value!);
    this.notify();
    entry.request = Promise.resolve().then(() => load(sessionId)).then(value => {
      if (this.entries.get(sessionId) !== entry) return;
      if (value.sessionId === sessionId && value.supported) entry.value = value;
      this.notify();
    }).catch(() => { if (this.entries.get(sessionId) === entry) this.notify(); }).finally(() => { entry.pending = false; });
    return entry.request;
  }
  private notify(): void { for (const listener of this.listeners) listener(); }
}
