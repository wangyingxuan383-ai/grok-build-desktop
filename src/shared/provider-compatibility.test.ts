import { describe, expect, it } from "vitest";
import {
  compatibilityReasoningTransport,
  defaultUpstreamProtocol,
  inferCompatibilityFlavor,
} from "./provider-compatibility";

describe("provider compatibility profiles", () => {
  it("recognizes declared gateway families without guessing from unrelated models", () => {
    expect(inferCompatibilityFlavor({ configured: "sub2api" })).toBe("sub2api");
    expect(inferCompatibilityFlavor({ ownedBy: ["grok2api"] })).toBe("grok2api");
    expect(inferCompatibilityFlavor({ baseUrl: "https://gateway.example/v1" })).toBe("generic");
    expect(compatibilityReasoningTransport("sub2api", "future-model", "responses")).toBeUndefined();
  });

  it("maps the live-verified grok2api grok-4.5 effort field only for the exact model", () => {
    expect(compatibilityReasoningTransport("grok2api", "grok-4.5", "responses")).toMatchObject({
      mode: "effort_enum",
      efforts: ["minimal", "low", "medium", "high", "xhigh"],
      source: "compatibility_profile",
    });
    expect(compatibilityReasoningTransport("grok2api", "grok-4.5-preview", "responses")).toBeUndefined();
  });

  it("uses adaptive Anthropic effort only for recognized Claude generations", () => {
    expect(compatibilityReasoningTransport("cliproxyapi", "claude-opus-4.8", "messages")).toMatchObject({
      mode: "adaptive",
      efforts: ["low", "medium", "high", "max"],
    });
    expect(compatibilityReasoningTransport("cliproxyapi", "claude-opus-4.8", "responses")).toBeUndefined();
    expect(defaultUpstreamProtocol("responses")).toBe("openai_responses");
  });
});
