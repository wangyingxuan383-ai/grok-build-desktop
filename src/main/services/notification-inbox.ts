import { join } from "node:path";
import type { NotificationInboxItem } from "../../shared/types";
import { JsonStore } from "./json-store";

interface InboxData { items: NotificationInboxItem[]; }

export class NotificationInboxService {
  private readonly store: JsonStore<InboxData>;
  constructor(userDataPath: string) { this.store = new JsonStore(join(userDataPath, "notification-inbox.json"), { items: [] }); }
  async list(): Promise<NotificationInboxItem[]> { return (await this.store.get()).items.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async add(input: Omit<NotificationInboxItem, "id" | "read" | "createdAt">): Promise<NotificationInboxItem> {
    const data = await this.store.get();
    if (input.automationRunId) {
      const existing = data.items.find((item) => item.automationRunId === input.automationRunId);
      if (existing) return existing;
    }
    const item: NotificationInboxItem = { ...input, id: crypto.randomUUID(), read: false, createdAt: new Date().toISOString() };
    data.items = [item, ...data.items].slice(0, 500);
    await this.store.set(data);
    return item;
  }
  async markRead(id: string, read: boolean): Promise<NotificationInboxItem[]> { const data = await this.store.get(); data.items = data.items.map((value) => value.id === id ? { ...value, read } : value); await this.store.set(data); return this.list(); }
  async clear(): Promise<NotificationInboxItem[]> { await this.store.set({ items: [] }); return []; }
}
