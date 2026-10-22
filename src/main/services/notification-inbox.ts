import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { NotificationInboxItem } from "../../shared/types";
import { JsonStore } from "./json-store";

interface InboxData { items: NotificationInboxItem[]; }
type InboxInput = Omit<NotificationInboxItem, "id" | "read" | "createdAt">;
type InboxListener = (items: NotificationInboxItem[]) => void | Promise<void>;

export function sortInboxItems(items: NotificationInboxItem[]): NotificationInboxItem[] {
  const priority = (item: NotificationInboxItem): number => item.read ? 3 : item.kind === "confirmation" ? 0 : item.kind === "failure" ? 1 : item.kind === "completion" ? 2 : 3;
  return items.slice().sort((a, b) => priority(a) - priority(b) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

export class NotificationInboxService {
  private readonly store: JsonStore<InboxData>;
  private readonly listeners = new Set<InboxListener>();
  private watcher?: FSWatcher;
  private watchStarting = false;
  private refreshTimer?: NodeJS.Timeout;
  private fingerprint?: string;
  private disposed = false;
  constructor(private readonly userDataPath: string) { this.store = new JsonStore(join(userDataPath, "notification-inbox.json"), { items: [] }); }
  async list(): Promise<NotificationInboxItem[]> { return sortInboxItems((await this.store.get()).items); }
  get observing(): boolean { return Boolean(this.watcher) && !this.disposed; }

  /** Watches atomic replacements too, including writes from scheduler workers. */
  onChanged(listener: InboxListener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    this.startWatching();
    return () => { this.listeners.delete(listener); if (!this.listeners.size) this.stopWatching(); };
  }
  async add(input: InboxInput, eventKey?: string): Promise<NotificationInboxItem> { return (await this.addOnce(input, eventKey)).item; }

  /** The duplicate check and insertion share the cross-process store lock. */
  async addOnce(input: InboxInput, eventKey?: string): Promise<{ item: NotificationInboxItem; added: boolean }> {
    let item: NotificationInboxItem | undefined;
    let added = false;
    const id = eventKey ? `event:${createHash("sha256").update(eventKey).digest("hex")}` : crypto.randomUUID();
    const data = await this.store.mutate((data) => {
      item = data.items.find((value) => value.id === id || Boolean(input.automationRunId && value.automationRunId === input.automationRunId && value.kind !== "confirmation"));
      if (item) return;
      item = { ...input, id, read: false, createdAt: new Date().toISOString() };
      data.items = [item, ...data.items].slice(0, 500);
      added = true;
    });
    if (!item) throw new Error("通知写入失败");
    if (added) this.publish(data.items);
    return { item: structuredClone(item), added };
  }
  async markRead(id: string, read: boolean): Promise<NotificationInboxItem[]> {
    const data = await this.store.mutate((value) => { value.items = value.items.map((item) => item.id === id ? { ...item, read } : item); });
    this.publish(data.items);
    return sortInboxItems(data.items);
  }
  async markAllRead(): Promise<NotificationInboxItem[]> {
    const data = await this.store.mutate((value) => { value.items = value.items.map((item) => ({ ...item, read: true })); });
    this.publish(data.items);
    return sortInboxItems(data.items);
  }
  async markTargetRead(kind:"session"|"image"|"automation",id:string):Promise<void>{
    const data=await this.store.mutate(value=>{value.items=value.items.map(item=>{
      const matches=kind==="automation"?(item.automationRunId||item.taskId)===id:!item.automationRunId&&!item.taskId&&item.sessionId===id;
      return matches&&item.kind!=="confirmation"?{...item,read:true}:item;
    });});this.publish(data.items);
  }
  async clear(): Promise<NotificationInboxItem[]> {
    await this.store.mutate((value) => { value.items = []; });
    this.publish([]);
    return [];
  }
  dispose(): void { this.disposed = true; this.listeners.clear(); this.stopWatching(); }

  private publish(items: NotificationInboxItem[]): void {
    if (this.disposed) return;
    const sorted = sortInboxItems(items), fingerprint = JSON.stringify(sorted);
    if (this.fingerprint === fingerprint) return;
    this.fingerprint = fingerprint;
    for (const listener of this.listeners) {
      if (this.disposed) break;
      try { void Promise.resolve(listener(structuredClone(sorted))).catch(() => undefined); } catch { /* Isolate observers. */ }
    }
  }
  private startWatching(): void {
    if (this.watcher || this.watchStarting || this.disposed) return;
    this.watchStarting = true;
    void mkdir(this.userDataPath, { recursive: true }).then(() => realpath(this.userDataPath)).then(root => {
      if (this.disposed || !this.listeners.size) return;
      this.watcher = watch(root, { persistent: false }, (_event, name) => {
        if (name && name.toString() !== "notification-inbox.json") return;
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => {
          this.refreshTimer = undefined;
          void this.list().then(items => { if (this.listeners.size) this.publish(items); }).catch(() => undefined);
        }, 25);
        this.refreshTimer.unref?.();
      });
      this.watcher.on("error", () => this.stopWatching());
      return this.list().then(items => this.publish(items));
    }).catch(() => undefined).finally(() => { this.watchStarting = false; });
  }
  private stopWatching(): void {
    this.watcher?.close(); this.watcher = undefined;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
  }
}
