import { describe, expect, it } from "vitest";
import { mediaArtifactsFromStreamingLine } from "./media-artifact-parser";

describe("mediaArtifactsFromStreamingLine", () => {
  it("extracts nested streaming-json image paths and de-duplicates them", () => {
    const artifacts = mediaArtifactsFromStreamingLine(JSON.stringify({
      type: "tool_result",
      name: "image_gen",
      result: {
        content: [
          { type: "text", text: "Saved to .\\outputs\\result.webp" },
          { path: ".\\outputs\\result.webp" },
        ],
      },
    }), "image", "C:\\workspace");
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      media: "image",
      source: "C:\\workspace\\outputs\\result.webp",
      mimeType: "image/webp",
    });
  });

  it("accepts media URLs but ignores unrelated tool text", () => {
    const artifacts = mediaArtifactsFromStreamingLine(
      JSON.stringify({type:"tool_result",name:"video_gen",result:{artifact:"https://example.test/video/final.mp4?token=short"},log:"opened secrets/old.mp4"}),
      "video",
      "C:\\workspace",
    );
    expect(artifacts).toEqual([
      expect.objectContaining({
        source: "https://example.test/video/final.mp4?token=short",
        mimeType: "video/mp4",
      }),
    ]);
  });

  it("keeps an ordinary relative artifact path rooted in the media workspace", () => {
    const artifacts = mediaArtifactsFromStreamingLine(
      JSON.stringify({ type: "tool_result", name: "image_gen", result: "已生成图片，产物路径： images/1.jpg" }),
      "image",
      "C:\\workspace",
    );
    expect(artifacts).toEqual([
      expect.objectContaining({
        source: "C:\\workspace\\images\\1.jpg",
        mimeType: "image/jpeg",
      }),
    ]);
  });

  it("reads the generated file from rawOutput and ignores the edit tool's reference input", () => {
    const reference = "C:\\Users\\me\\AppData\\Roaming\\Grok\\session-media\\abc\\source.png";
    const start = JSON.stringify({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-1",
      title: `image_edit ${reference}`,
      rawInput: { variant: "ImageEdit", prompt: "make it blue", image_paths: [reference] },
      locations: [{ path: reference }],
    });
    const done = JSON.stringify({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-1",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: JSON.stringify({ path: "C:\\work\\images\\2.png", message: "Image generated" }) } }],
      rawOutput: { type: "ImageEdit", path: "C:\\work\\images\\2.png", filename: "2.png" },
    });
    expect(mediaArtifactsFromStreamingLine(start, "image", "C:\\work")).toEqual([]);
    expect(mediaArtifactsFromStreamingLine(done, "image", "C:\\work")).toEqual([
      expect.objectContaining({ source: "C:\\work\\images\\2.png" }),
    ]);
  });

  it("does not treat assistant narration as an artifact", () => {
    const line = JSON.stringify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "已保存到 C:\\somewhere\\old.png" } });
    expect(mediaArtifactsFromStreamingLine(line, "image", "C:\\work")).toEqual([]);
  });

  it("ignores the path a failed call merely mentions", () => {
    // A failed generation echoes the output path it never wrote, and an error message that quotes
    // an older picture is not this call's result.
    const failed = JSON.stringify({
      sessionUpdate: "tool_call_update",
      status: "failed",
      content: [{ type: "text", text: "image_gen failed: could not write " + "C:\\work\\images\\5.png" }],
    });
    expect(mediaArtifactsFromStreamingLine(failed, "image", "C:\\work")).toEqual([]);
    const errored = JSON.stringify({ type: "tool_result", is_error: true, result: "boom " + "C:\\work\\old\\6.png" });
    expect(mediaArtifactsFromStreamingLine(errored, "image", "C:\\work")).toEqual([]);
    // The error text is skipped but a real result in the same record is still read.
    const mixed = JSON.stringify({ type: "tool_result", name: "image_gen", status: "completed", error: "previous run wrote " + "C:\\work\\7.png", result: "saved " + "C:\\work\\images\\8.png" });
    expect(mediaArtifactsFromStreamingLine(mixed, "image", "C:\\work").map((value) => value.source)).toEqual(["C:\\work\\images\\8.png"]);
  });

  it("drops any explicitly excluded reference path even when a tool result echoes it", () => {
    const reference = "C:\\cache\\source.png";
    const line = JSON.stringify({ type: "tool_result", name: "image_gen", result: `used ${reference} to produce images/3.png` });
    const artifacts = mediaArtifactsFromStreamingLine(line, "image", "C:\\work", { exclude: [reference] });
    expect(artifacts.map((value) => value.source)).toEqual(["C:\\work\\images\\3.png"]);
  });

  it("rejects narration, unknown envelopes, unrelated successful tools and replay", () => {
    for (const value of [
      { type: "assistant", message: "images/old.png" },
      { result: "images/old.png" },
      { type: "tool_result", name: "read_file", result: "images/old.png" },
      { type: "tool_call_update", status: "completed", rawOutput: { type: "ImageGen", path: "images/old.png" }, replay: true },
    ]) expect(mediaArtifactsFromStreamingLine(JSON.stringify(value), "image", "C:\\work")).toEqual([]);
  });

  it("correlates the official type-tagged ACP completion with its media call", () => {
    const toolIdentities = new Map<string, string>();
    const parse = (value: object) => mediaArtifactsFromStreamingLine(JSON.stringify(value), "image", "C:\\work", { toolIdentities });
    expect(parse({type:"tool_call",toolCallId:"a",rawInput:{variant:"ImageGen",prompt:"images/old.png"}})).toEqual([]);
    expect(parse({type:"tool_call_update",toolCallId:"a",status:"in_progress",rawOutput:{path:"images/old.png"}})).toEqual([]);
    expect(parse({type:"tool_call_update",toolCallId:"a",status:"completed",rawOutput:{path:"images/new.png"}})).toEqual([expect.objectContaining({source:"C:\\work\\images\\new.png"})]);
  });
});
