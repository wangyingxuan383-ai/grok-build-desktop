import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import path from "node:path";
import { resolvePath } from "../../shared/path-utils";
import type { MediaArtifact } from "../../shared/types";

function isAbsoluteMediaPath(value: string): boolean {
  return path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
}

/** Extract concrete image/video artifacts from Grok CLI streaming-json. */
export function mediaArtifactsFromStreamingLine(
  line: string,
  media: MediaArtifact["media"],
  cwd: string,
): MediaArtifact[] {
  const values: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === "string") { values.push(value); return; }
    if (Array.isArray(value)) { for (const item of value) collect(item); return; }
    if (value && typeof value === "object") {
      for (const item of Object.values(value as Record<string, unknown>)) collect(item);
    }
  };
  try { collect(JSON.parse(line)); } catch { values.push(line); }
  const extensions = media === "image" ? "png|jpe?g|webp|gif" : "mp4|webm|mov|mkv";
  // Keep the path prefix in the match. The former `\.{0,2}[\\/]` branch
  // also accepted *zero* dots, so `images/1.jpg` was truncated to `/1.jpg`.
  // `resolve(cwd, "/1.jpg")` then escaped to the drive root and the otherwise
  // valid media result was rejected by the workspace boundary check.
  //
  // Branch order:
  // 1) http(s) URLs
  // 2) POSIX absolute paths (/...)
  // 3) Windows drive / relative (.\, ..\, C:\)
  // 4) bare relative segments (images/1.jpg)
  const pattern = new RegExp(
    `(?:https?:\\/\\/[^\\s"'<>]+?\\.(?:${extensions})(?:\\?[^\\s"'<>]*)?|\\/(?:[^\\s"'<>]+\\/)*[^\\s"'<>]+?\\.(?:${extensions})|(?:[A-Za-z]:[\\\\/]|\\.{1,2}[\\\\/])[^\\r\\n"'<>]+?\\.(?:${extensions})|(?<![A-Za-z0-9_./-])(?:[^\\s"'<>:\\/]+[\\\\/])+[^\\s"'<>:\\/]+?\\.(?:${extensions}))`,
    "ig",
  );
  const sources = new Set<string>();
  for (const value of values) {
    for (const match of value.matchAll(pattern)) {
      const source = match[0]!.replace(/[),.;]+$/, "");
      if (/^https?:/i.test(source) || isAbsoluteMediaPath(source)) sources.add(source);
      else sources.add(resolvePath(cwd, source));
    }
  }
  return [...sources].map((source) => ({
    id: randomUUID(),
    media,
    source,
    mimeType: mimeForMediaPath(source, media),
    name: source.split(/[\\/]/).at(-1),
  }));
}

function mimeForMediaPath(value: string, media: MediaArtifact["media"]): string {
  const extension = extname(value.split("?", 1)[0] ?? value).toLowerCase();
  if (media === "video") {
    return extension === ".webm"
      ? "video/webm"
      : extension === ".mov"
        ? "video/quicktime"
        : "video/mp4";
  }
  return extension === ".jpg" || extension === ".jpeg"
    ? "image/jpeg"
    : extension === ".webp"
      ? "image/webp"
      : extension === ".gif"
        ? "image/gif"
        : "image/png";
}
