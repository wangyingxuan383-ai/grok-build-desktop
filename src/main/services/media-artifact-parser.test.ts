import { describe, expect, it } from "vitest";
import { mediaArtifactsFromStreamingLine } from "./media-artifact-parser";

describe("mediaArtifactsFromStreamingLine", () => {
  it("extracts nested streaming-json image paths and de-duplicates them", () => {
    const artifacts = mediaArtifactsFromStreamingLine(JSON.stringify({
      type: "tool_result",
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
      '{"artifact":"https://example.test/video/final.mp4?token=short","log":"opened C:\\\\secrets\\\\notes.txt"}',
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
      JSON.stringify({ result: "已生成图片，产物路径： images/1.jpg" }),
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
});
