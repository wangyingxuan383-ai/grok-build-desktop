import { describe, expect, it } from "vitest";
import { providerReasoningEfforts, uniqueEfforts } from "./provider-model-capabilities";

describe("provider model capabilities", () => {
  it("uses the five live-verified grok-4.5 values when /models omits metadata", () => {
    expect(providerReasoningEfforts("grok-4.5")).toEqual(["xhigh", "high", "medium", "low", "minimal"]);
    expect(providerReasoningEfforts("GROK-4.5")).toEqual(["xhigh", "high", "medium", "low", "minimal"]);
    expect(providerReasoningEfforts("grok-4.5", ["high", "medium", "low"])).toEqual(["xhigh", "high", "medium", "low", "minimal"]);
  });

  it("does not guess capabilities for future or similarly named models", () => {
    expect(providerReasoningEfforts("grok-4.5-mini")).toEqual([]);
    expect(providerReasoningEfforts("grok-5")).toEqual([]);
  });

  it("preserves non-legacy declared metadata and removes empty, duplicate or invalid values", () => {
    expect(providerReasoningEfforts("grok-4.5", ["low", "xhigh", "low"])).toEqual(["low", "xhigh"]);
    expect(providerReasoningEfforts("grok-4.5", [])).toEqual([]);
    expect(uniqueEfforts(["", "medium", "medium"])).toEqual(["medium"]);
  });
});
