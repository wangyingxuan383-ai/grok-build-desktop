import { describe, expect, it } from "vitest";
import { providerReasoningEfforts, uniqueEfforts } from "./provider-model-capabilities";

describe("provider model capabilities", () => {
  it("uses the exact Grok CLI catalog values for CPA grok-4.5 when /models omits metadata", () => {
    expect(providerReasoningEfforts("grok-4.5")).toEqual(["high", "medium", "low"]);
    expect(providerReasoningEfforts("GROK-4.5")).toEqual(["high", "medium", "low"]);
  });

  it("does not guess capabilities for future or similarly named models", () => {
    expect(providerReasoningEfforts("grok-4.5-mini")).toEqual([]);
    expect(providerReasoningEfforts("grok-5")).toEqual([]);
  });

  it("prefers declared metadata and removes empty, duplicate or invalid values", () => {
    expect(providerReasoningEfforts("grok-4.5", ["low", "xhigh", "low"])).toEqual(["low", "xhigh"]);
    expect(providerReasoningEfforts("grok-4.5", [])).toEqual([]);
    expect(uniqueEfforts(["", "medium", "medium"])).toEqual(["medium"]);
  });
});
