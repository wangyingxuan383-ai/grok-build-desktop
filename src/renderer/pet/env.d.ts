import type { PetApi } from "../../shared/desktop-pet";

declare global {
  interface Window { grokPet: PetApi; }
}

export {};
