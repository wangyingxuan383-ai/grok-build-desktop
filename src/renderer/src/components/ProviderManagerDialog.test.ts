import { describe, expect, it } from "vitest";
import { looksGemini } from "./ProviderManagerDialog";

describe("gemini upstream detection", () => {
  it("recognises the model families that reject empty enum members", () => {
    // Verified live: gemini-3-flash returns HTTP 400 INVALID_ARGUMENT for a
    // tool schema containing an empty-string enum unless the gemini profile
    // sanitizes it first.
    for (const value of ["gemini-3-flash", "gemini-3.1-pro-low", "Gemini 3 Flash Agent", "antigravity/gemini-pro", "vertex-gemini", "PaLM 2"]) {
      expect(looksGemini(value)).toBe(true);
    }
  });

  it("does not claim unrelated models need schema rewriting", () => {
    for (const value of ["claude-opus-4-6", "grok-4", "gpt-4o", "llama-3-70b", undefined, ""]) {
      expect(looksGemini(value)).toBe(false);
    }
  });
});
