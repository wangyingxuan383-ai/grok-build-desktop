import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PromptSnippet, PromptSnippetInput } from "../../shared/prompt-snippets";
import { JsonStore } from "./json-store";

export class PromptSnippetService {
  private readonly store: JsonStore<{ items: PromptSnippet[] }>;
  constructor(userDataPath: string) { this.store = new JsonStore(join(userDataPath, "prompt-snippets.json"), { items: [] }); }
  async list(): Promise<PromptSnippet[]> { return (await this.store.get()).items; }
  async save(input: PromptSnippetInput): Promise<PromptSnippet[]> {
    if (!input || typeof input.title !== "string" || !input.title.trim() || [...input.title.trim()].length > 100 || typeof input.body !== "string" || !input.body.trim() || Buffer.byteLength(input.body, "utf8") > 65_536 || /\0/.test(input.title + input.body)) throw new Error("片段需有名称和内容，名称最多 100 字，内容最多 64 KiB");
    const next = await this.store.mutate(data => {
      const existing = input.id ? data.items.find(item => item.id === input.id) : undefined;
      if (input.id && (!existing || !input.updatedAt || existing.updatedAt !== input.updatedAt)) throw new Error("片段已被其他端修改或删除，请刷新后再保存");
      if (!existing && data.items.length >= 200) throw new Error("最多保存 200 个片段，请先整理片段库");
      const updatedAt = new Date(Math.max(Date.now(), existing ? Date.parse(existing.updatedAt) + 1 : 0)).toISOString();
      const item: PromptSnippet = { id: existing?.id ?? randomUUID(), title: input.title.trim(), body: input.body, updatedAt };
      if (existing) data.items = data.items.map(row => row.id === existing.id ? item : row);
      else data.items.unshift(item);
    });
    return next.items;
  }
  async delete(id: string, updatedAt?: string): Promise<PromptSnippet[]> {
    const next = await this.store.mutate(data => {
      const item = data.items.find(item => item.id === id);
      if (!item || !updatedAt || updatedAt !== item.updatedAt) throw new Error("片段已被其他端修改或删除，请刷新后再操作");
      data.items = data.items.filter(item => item.id !== id);
    });
    return next.items;
  }
}
