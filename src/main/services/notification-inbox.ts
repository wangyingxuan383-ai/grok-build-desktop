import { join } from "node:path";
import type { NotificationInboxItem } from "../../shared/types";
import { JsonStore } from "./json-store";

interface InboxData { items: NotificationInboxItem[]; }

export class NotificationInboxService {
  private readonly store: JsonStore<InboxData>;
  constructor(userDataPath: string) { this.store = new JsonStore(join(userDataPath, "notification-inbox.json"), { items: [] }); }
  async list(): Promise<NotificationInboxItem[]> { return (await this.store.get()).items.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async add(input: Omit<NotificationInboxItem, "id" | "read" | "createdAt">): Promise<NotificationInboxItem> {
    let item: NotificationInboxItem | undefined;
    await this.store.mutate((data) => {
      if (input.automationRunId) item = data.items.find((value) => value.automationRunId === input.automationRunId);
      if (item) return;
      item = { ...input, id: crypto.randomUUID(), read: false, createdAt: new Date().toISOString() };
      data.items = [item, ...data.items].slice(0, 500);
    });
    if (!item) throw new Error("通知写入失败");
    return item;
  }
  async markRead(id: string, read: boolean): Promise<NotificationInboxItem[]> {
    const data = await this.store.mutate((value) => { value.items = value.items.map((item) => item.id === id ? { ...item, read } : item); });
    return data.items.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async clear(): Promise<NotificationInboxItem[]> {
    await this.store.mutate((value) => { value.items = []; });
    return [];
  }
}
