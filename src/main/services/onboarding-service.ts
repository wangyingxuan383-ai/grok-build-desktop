import { join } from "node:path";
import type { OnboardingState } from "../../shared/types";
import { JsonStore } from "./json-store";

const CURRENT_VERSION = 1;
const DEFAULT_STATE: OnboardingState = { version: CURRENT_VERSION, completed: false, skipped: false, currentStep: 0 };

export class OnboardingService {
  private readonly store: JsonStore<OnboardingState>;
  constructor(userDataPath: string) { this.store = new JsonStore(join(userDataPath, "onboarding.json"), DEFAULT_STATE); }

  async get(): Promise<OnboardingState> {
    const state = await this.store.get();
    if (state.version === CURRENT_VERSION) return state;
    return this.store.set({ ...DEFAULT_STATE, currentStep: state.completed ? 0 : state.currentStep });
  }

  async update(patch: Partial<OnboardingState>): Promise<OnboardingState> {
    const current = await this.get();
    return this.store.set({
      ...current,
      ...patch,
      version: CURRENT_VERSION,
      currentStep: Math.max(0, Math.min(6, patch.currentStep ?? current.currentStep)),
    });
  }

  reset(): Promise<OnboardingState> { return this.store.set(DEFAULT_STATE); }
}
