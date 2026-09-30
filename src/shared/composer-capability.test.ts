import { describe, expect, it } from "vitest";
import { buildComposerCommand, normalizeSkillCommand, selectComposerCommand } from "./composer-capability";

describe("one-shot composer capabilities", () => {
  it("keeps draft arguments and Chinese text when selecting or replacing a CLI command", () => {
    expect(selectComposerCommand("保留草稿\n第二行", "review")).toBe("/review 保留草稿\n第二行");
    expect(selectComposerCommand("/old  参数", "/new", ["old"])).toBe("/new 参数");
    expect(selectComposerCommand("/rev", "review")).toBe("/review ");
    expect(selectComposerCommand("/tmp/image.png", "review")).toBe("/review /tmp/image.png");
    expect(selectComposerCommand("", "compact")).toBe("/compact ");
  });
  it("turns Computer Use into a generic skill invocation without a preselected window", () => {
    expect(buildComposerCommand("打开计算器并输入 42", { kind: "computer", label: "Computer", command: "/computer" })).toBe("/computer 打开计算器并输入 42");
  });

  it("normalizes plugin skills and leaves ordinary prompts untouched", () => {
    expect(normalizeSkillCommand("documents")).toBe("/documents");
    expect(buildComposerCommand("创建报告", { kind: "skill", label: "Documents", command: "documents", source: "fixture" })).toBe("/documents 创建报告");
    expect(buildComposerCommand("普通消息")).toBe("普通消息");
  });
});
