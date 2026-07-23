import { resolve } from "node:path";
import type { TurnPresentation } from "../../shared/types";
import { JsonStore } from "./json-store";

interface TurnPresentationState {
  sessions: Record<string, TurnPresentation[]>;
}

export class TurnPresentationService {
  private readonly store: JsonStore<TurnPresentationState>;

  constructor(userDataPath: string) {
    this.store = new JsonStore(resolve(userDataPath, "turn-presentations.json"), { sessions: {} });
  }

  async list(sessionId: string): Promise<TurnPresentation[]> {
    const state = await this.store.get();
    return [...(state.sessions[sessionId] ?? [])].sort((a, b) => a.ordinal - b.ordinal);
  }

  async recordForSession(sessionId: string, presentation: TurnPresentation): Promise<TurnPresentation[]> {
    const state = await this.store.get();
    const records = [...(state.sessions[sessionId] ?? [])];
    const index = records.findIndex((value) => value.turnId === presentation.turnId);
    if (index >= 0) records[index] = { ...records[index], ...presentation };
    else records.push({ ...presentation });
    records.sort((a, b) => a.ordinal - b.ordinal);
    state.sessions[sessionId] = records;
    await this.store.set(state);
    return records;
  }

  async delete(sessionId: string): Promise<void> {
    const state = await this.store.get();
    if (!(sessionId in state.sessions)) return;
    delete state.sessions[sessionId];
    await this.store.set(state);
  }
}
