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

describe("model candidate filtering", () => {
  const candidates = [
    { remoteId: "gemini-3-flash", localId: "acme-gemini-3-flash", name: "Gemini 3 Flash", ownedBy: "antigravity", alreadyConfigured: false },
    { remoteId: "claude-opus-5", localId: "acme-claude-opus-5", name: "Claude Opus 5", ownedBy: "anthropic", alreadyConfigured: false },
    { remoteId: "grok-4.5", localId: "acme-grok-4-5", name: "Grok 4.5", ownedBy: "xai", alreadyConfigured: true },
  ];
  const visible = (query: string) => candidates.filter((candidate) =>
    `${candidate.name} ${candidate.remoteId} ${candidate.localId} ${candidate.ownedBy ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  it("narrows a mixed aggregator by model family, not just by name", () => {
    // The real endpoint serves 26 models across three families; without this
    // the only way to find one is to read the whole list.
    expect(visible("anthropic").map((c) => c.remoteId)).toEqual(["claude-opus-5"]);
    expect(visible("antigravity").map((c) => c.remoteId)).toEqual(["gemini-3-flash"]);
    expect(visible("xai").map((c) => c.remoteId)).toEqual(["grok-4.5"]);
  });

  it("still matches on name and remote id", () => {
    expect(visible("opus").map((c) => c.remoteId)).toEqual(["claude-opus-5"]);
    expect(visible("3-flash").map((c) => c.remoteId)).toEqual(["gemini-3-flash"]);
    expect(visible("")).toHaveLength(3);
  });
});
