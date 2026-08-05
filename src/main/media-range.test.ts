import { describe, expect, it } from "vitest";
import { parseByteRange } from "./media-range";

describe("parseByteRange", () => {
  it("leaves requests without a range untouched", () => {
    expect(parseByteRange(null, 100)).toBeUndefined();
  });

  it("parses closed, open-ended, and suffix ranges", () => {
    expect(parseByteRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseByteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=-200", 100)).toEqual({ start: 0, end: 99 });
  });

  it("caps an end offset at the media size", () => {
    expect(parseByteRange("bytes=95-999", 100)).toEqual({ start: 95, end: 99 });
  });

  it.each([
    ["bytes=", 100],
    ["bytes=1-2,5-6", 100],
    ["items=0-1", 100],
    ["bytes=100-", 100],
    ["bytes=20-10", 100],
    ["bytes=-0", 100],
    ["bytes=0-0", 0],
  ])("rejects unsupported or unsatisfiable range %s", (header, size) => {
    expect(parseByteRange(header, size)).toBe("invalid");
  });
});
