import { join } from "node:path";
import type { ComposerCapabilitySelection, ComposerDraftState } from "../../shared/types";
import { JsonStore } from "./json-store";

interface UiStateData {
  drafts: Record<string, ComposerDraftState>;
  promptHistory: Record<string, string[]>;
}

export class UiStateService {
  private readonly store: JsonStore<UiStateData>;

  constructor(userDataPath: string) {
    this.store = new JsonStore(join(userDataPath, "ui-state.json"), { drafts: {}, promptHistory: {} });
  }

  async getDraft(key: string): Promise<ComposerDraftState | null> {
    return (await this.store.get()).drafts[normalizeKey(key)] ?? null;
  }

  async setDraft(key: string, text: string, capability?: ComposerCapabilitySelection): Promise<void> {
    const data = await this.store.get();
    const normalized = normalizeKey(key);
    if (!text && !capability) delete data.drafts[normalized];
    else data.drafts[normalized] = { key, text, capability, updatedAt: new Date().toISOString() };
    await this.store.set(data);
  }

  async clearDraft(key: string): Promise<void> {
    const data = await this.store.get();
    delete data.drafts[normalizeKey(key)];
    await this.store.set(data);
  }

  async listPromptHistory(cwd: string): Promise<string[]> {
    return [...((await this.store.get()).promptHistory[normalizeKey(cwd)] ?? [])];
  }

  async appendPromptHistory(cwd: string, text: string): Promise<void> {
    const value = text.trim();
    if (!value) return;
    const data = await this.store.get();
    const key = normalizeKey(cwd);
    data.promptHistory[key] = [value, ...(data.promptHistory[key] ?? []).filter((entry) => entry !== value)].slice(0, 50);
    await this.store.set(data);
  }
}

function normalizeKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}
