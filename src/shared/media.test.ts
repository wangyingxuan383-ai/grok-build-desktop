import { describe, expect, it } from "vitest";
import { buildMediaSlashCommand, detectMediaCapabilities } from "./media";

describe("media creation helpers", () => {
  it("detects slash commands with or without a leading slash", () => {
    expect(detectMediaCapabilities([
      { name: "/imagine" },
      { name: "imagine-video" },
      { name: "compact" },
    ])).toEqual({
      image: true,
      video: true,
      commands: ["imagine", "imagine-video", "compact"],
      tools: [],
      imageCommand: "imagine",
      videoCommand: "imagine-video",
      diagnostic: undefined,
    });
  });

  it("recognizes namespaced 1.0 skills and registered media tools", () => {
    expect(detectMediaCapabilities(
      [{ name: "bundled:imagine" }, { name: "compact" }],
      ["image_gen", "image_to_video", "reference_to_video"],
    )).toEqual({
      image: true,
      video: true,
      commands: ["bundled:imagine", "compact"],
      tools: ["image_gen", "image_to_video", "reference_to_video"],
      imageCommand: "bundled:imagine",
      videoCommand: "bundled:imagine",
      diagnostic: undefined,
    });
  });

  it("does not invent video support when only the raw image tool is registered", () => {
    const result = detectMediaCapabilities([], ["image_gen"]);
    expect(result.image).toBe(true);
    expect(result.video).toBe(false);
    expect(result.diagnostic).toContain("ZDR");
  });

  it("blocks media generation when the CLI does not publish either command", () => {
    const result = detectMediaCapabilities([{ name: "compact" }]);
    expect(result.image).toBe(false);
    expect(result.video).toBe(false);
    expect(result.diagnostic).toContain("已阻止");
  });

  it("uses the ACP-advertised Imagine skill as the video workflow fallback", () => {
    const capabilities = detectMediaCapabilities([{ name: "imagine" }]);
    expect(capabilities.video).toBe(true);
    expect(capabilities.videoCommand).toBe("imagine");
    expect(buildMediaSlashCommand({
      kind: "video",
      prompt: "云海中的飞船",
      aspectRatio: "16:9",
      duration: 6,
      resolution: "480p",
    }, capabilities)).toBe("/imagine 请使用 image_to_video 工作流生成视频：云海中的飞船 画面比例 16:9。 生成 6 秒视频，分辨率 480p。");
  });

  it("builds an official image slash command and normalizes multiline input", () => {
    expect(buildMediaSlashCommand({
      kind: "image",
      prompt: "一只猫\n 在月球散步",
      aspectRatio: "16:9",
    })).toBe("/imagine 一只猫 在月球散步 画面比例 16:9。");
  });

  it("builds an official video slash command with supported options", () => {
    expect(buildMediaSlashCommand({
      kind: "video",
      prompt: "雨夜中的霓虹街道",
      aspectRatio: "9:16",
      duration: 10,
      resolution: "720p",
    })).toBe("/imagine-video 雨夜中的霓虹街道 画面比例 9:16。 生成 10 秒视频，分辨率 720p。");
    expect(buildMediaSlashCommand({ kind: "video", prompt: "参考短片", aspectRatio: "4:3", duration: 15, resolution: "480p", voice: "温和旁白" }))
      .toContain("生成 15 秒视频，分辨率 480p。 参考视频声音：温和旁白。");
  });

  it("rejects empty prompts and unsupported video values", () => {
    expect(() => buildMediaSlashCommand({ kind: "image", prompt: "  ", aspectRatio: "auto" })).toThrow("请输入");
    expect(() => buildMediaSlashCommand({
      kind: "video",
      prompt: "test",
      aspectRatio: "auto",
      duration: 16 as 15,
      resolution: "480p",
    })).toThrow("时长");
  });
});
