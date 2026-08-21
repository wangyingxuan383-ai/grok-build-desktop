import { describe, expect, it } from "vitest";
import { normalizeBoundedToolPayload } from "./bounded-tool-payload";

describe("normalizeBoundedToolPayload", () => {
  it("keeps JSON-looking strings and 64-bit identifiers exact without reparsing", () => {
    const id = "9223372036854775807";
    const json = `{"id":${id}}`;
    expect(normalizeBoundedToolPayload({ id, json }).value).toEqual({ id, json });
  });

  it("bounds strings, arrays, keys and depth while traversing", () => {
    const value = {
      rows: Array.from({ length: 50 }, (_, index) => ({ index, payload: "值".repeat(100) })),
      nested: { a: { b: { c: { d: true } } } },
    };
    const result = normalizeBoundedToolPayload(value, { maxBytes: 1_024, maxArrayItems: 3, maxDepth: 3, maxObjectKeys: 4 });
    expect(result.truncated).toBe(true);
    expect((result.value as any).rows).toHaveLength(3);
    expect(Buffer.byteLength(JSON.stringify(result.value), "utf8")).toBeLessThan(2_048);
  });

  it("handles circular values without throwing", () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    expect(normalizeBoundedToolPayload(value)).toMatchObject({ truncated: true, value: { self: "[循环引用]" } });
  });
});
