import { describe, expect, it } from "vitest";
import { isPathInExecutionRoot } from "./use-conversation-derived-state";

describe("conversation derived state", () => {
  it("Windows 路径比较忽略大小写但拒绝相邻前缀", () => {
    expect(isPathInExecutionRoot("C:\\Repo\\src\\a.ts", "c:\\repo")).toBe(true);
    expect(isPathInExecutionRoot("C:\\Repository\\a.ts", "C:\\Repo")).toBe(false);
    expect(isPathInExecutionRoot("src/a.ts", "C:\\Repo")).toBe(true);
  });
});
