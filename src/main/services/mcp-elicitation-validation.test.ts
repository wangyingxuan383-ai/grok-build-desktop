import { describe, expect, it } from "vitest";
import { normalizeMcpElicitationRequest, validateMcpElicitationContent } from "./grok-acp-adapter";

const normalize = (properties: Record<string, unknown>) => normalizeMcpElicitationRequest("r", { sessionId: "s", requestedSchema: { type: "object", properties } }, "s");
describe("MCP primitive constraints", () => {
  it.each([
    { type: "string", enum: [] }, { type: "string", enum: [1] },
    { type: "string", enum: "invalid" }, { type: "integer", enum: [1.5] },
    { type: "number", minimum: 5, maximum: 1 }, { type: "string", minimum: 1 },
  ])("rejects malformed constraints instead of allowing unrestricted input: %j", (schema) => {
    const request = normalize({ value: schema });
    expect(request.schemaSupported).toBe(false);
    expect(() => validateMcpElicitationContent(request, { value: "anything" })).toThrow();
  });
  it("checks numeric limits and Unicode codepoint lengths", () => {
    const request = normalize({ count: { type: "integer", minimum: 2, maximum: 4 }, name: { type: "string", minLength: 2, maxLength: 3 } });
    expect(request.schemaSupported).toBe(true);
    expect(() => validateMcpElicitationContent(request, { count: 1 })).toThrow("数值范围");
    expect(() => validateMcpElicitationContent(request, { name: "中" })).toThrow("长度");
    expect(validateMcpElicitationContent(request, { count: 3, name: "😀中" })).toEqual({ count: 3, name: "😀中" });
  });
  it.each(["pattern", "format", "oneOf", "anyOf", "allOf", "$ref"])("does not silently drop %s", (key) => {
    expect(normalize({ value: { type: "string", [key]: "unsupported" } }).schemaSupported).toBe(false);
  });
  it("accepts the IPv6 loopback authorization URL", () => {
    expect(normalizeMcpElicitationRequest("r", { sessionId: "s", mode: "url", url: "http://[::1]:3000/auth" }, "s").schemaSupported).toBe(true);
  });
  it("keeps enum restrictions", () => {
    expect(() => validateMcpElicitationContent(normalize({ value: { type: "string", enum: ["a", "b"] } }), { value: "c" })).toThrow("允许选项");
  });
});
