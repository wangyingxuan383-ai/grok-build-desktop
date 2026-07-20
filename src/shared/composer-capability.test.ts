import { describe, expect, it } from "vitest";
import { buildComposerCommand, normalizeSkillCommand } from "./composer-capability";

describe("one-shot composer capabilities", () => {
  it("turns Computer Use into a generic skill invocation without a preselected window", () => {
    expect(buildComposerCommand("打开计算器并输入 42", { kind: "computer", label: "Computer", command: "/computer" })).toBe("/computer 打开计算器并输入 42");
  });

  it("normalizes plugin skills and leaves ordinary prompts untouched", () => {
    expect(normalizeSkillCommand("documents")).toBe("/documents");
    expect(buildComposerCommand("创建报告", { kind: "skill", label: "Documents", command: "documents", source: "fixture" })).toBe("/documents 创建报告");
    expect(buildComposerCommand("普通消息")).toBe("普通消息");
  });
});
