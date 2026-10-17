import { describe, expect, it } from "vitest";
import { matchesAllWords, searchWords } from "./search-words";

describe("multi-word session search", () => {
  it("requires every word in any order and keeps single-word behaviour", () => {
    expect(matchesAllWords("移动端 验收 结果", "结果 移动端")).toBe(true);
    expect(matchesAllWords("Fix Login Flow", "flow LOGIN")).toBe(true);
    expect(matchesAllWords("Fix Login Flow", "login")).toBe(true);
    expect(matchesAllWords("Fix Login Flow", "login cache")).toBe(false);
    expect(matchesAllWords("anything", "   ")).toBe(true);
  });
  it("normalizes, de-duplicates and accepts pre-split words", () => {
    expect(searchWords("  A  b   a ")).toEqual(["a", "b"]);
    expect(matchesAllWords("alpha beta", searchWords("beta ALPHA"))).toBe(true);
  });
});
