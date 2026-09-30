import { randomUUID } from "node:crypto";
import { extname, isAbsolute, resolve } from "node:path";
import type { MediaArtifact } from "../../shared/types";

/**
 * Keys that carry what was sent *to* a tool (or human-readable labels) rather
 * than what a tool produced. An `image_edit` call echoes its reference image
 * path in `rawInput`; treating that as a result made the whole edit fail with
 * "outside the workspace".
 */
const INPUT_KEYS = new Set(["rawInput", "input", "arguments", "args", "locations", "title", "prompt", "_meta"]);
/** Streaming updates that are conversation narration, never tool output. */
const NARRATION_UPDATES = new Set(["agent_message_chunk", "agent_thought_chunk", "user_message_chunk", "plan", "available_commands_update"]);
/**
 * A failed or cancelled call must not contribute a path. The CLI echoes the *attempted* output
 * path in the failure text of a tool that never wrote it, and an error message that happens to
 * quote an older picture is not a result of this call.
 */
const FAILURE_STATES = new Set(["failed", "error", "cancelled", "canceled", "rejected"]);
/** Fields that describe a failure rather than a produced file. */
const ERROR_KEYS = new Set(["error", "errormessage", "stderr", "failurereason", "failure_reason", "exception"]);

export interface MediaArtifactParseOptions {
  /** Paths that were supplied as inputs (reference images) and must never be reported as results. */
  exclude?: readonly string[];
  /** Identity carried from a tool_call to its later tool_call_update in this process only. */
  toolIdentities?: Map<string, string>;
}

const MEDIA_TOOLS = { image: new Set(["imagegen", "imageedit"]), video: new Set(["videogen", "imagetovideo", "referencetovideo"]) };
function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function mediaIdentity(value: unknown): string | undefined {
  return typeof value === "string" ? value.toLowerCase().replace(/[_-]/g, "") : undefined;
}

/** Extract concrete image/video artifacts from Grok CLI streaming-json. */
export function mediaArtifactsFromStreamingLine(
  line: string,
  media: MediaArtifact["media"],
  cwd: string,
  options: MediaArtifactParseOptions = {},
): MediaArtifact[] {
  let envelope: Record<string, unknown> | undefined;
  try {
    const raw = record(JSON.parse(line));
    const params = record(raw?.params);
    envelope = record(params?.update) ?? record(raw?.update) ?? raw;
  } catch { return []; }
  if (!envelope || envelope.replay === true || envelope.replaying === true) return [];
  const tag = envelope.sessionUpdate ?? envelope.type;
  if (!["tool_call", "tool_call_update", "tool_result"].includes(String(tag))) return [];
  if (envelope.is_error === true || envelope.isError === true || FAILURE_STATES.has(String(envelope.status).toLowerCase())) return [];
  const input = record(envelope.rawInput);
  const output = record(envelope.rawOutput);
  const callId = String(envelope.toolCallId ?? envelope.tool_use_id ?? "");
  const identity = mediaIdentity(envelope.toolName ?? envelope.name ?? input?.variant ?? output?.type ?? output?.variant)
    ?? options.toolIdentities?.get(callId);
  if (tag === "tool_call") {
    if (callId && identity) options.toolIdentities?.set(callId, identity);
    return [];
  }
  if (!identity || !MEDIA_TOOLS[media].has(identity)) return [];
  if (tag === "tool_call_update" && envelope.status !== "completed") return [];
  const values: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === "string") {
      // Tool results arrive as JSON *inside* a text block. Scanning the encoded
      // text would see doubled backslashes (`C:\\work`) and report the same file
      // twice under two spellings, so decode nested JSON before matching.
      const trimmed = value.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try { collect(JSON.parse(trimmed)); return; } catch { /* plain text that merely starts with a brace */ }
      }
      values.push(value);
      return;
    }
    if (Array.isArray(value)) { for (const item of value) collect(item); return; }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (typeof record.sessionUpdate === "string" && NARRATION_UPDATES.has(record.sessionUpdate)) return;
      // `status` / `type` carry the call outcome; `is_error` is the tool_result spelling.
      if (typeof record.status === "string" && FAILURE_STATES.has(record.status.toLowerCase())) return;
      if (typeof record.type === "string" && FAILURE_STATES.has(record.type.toLowerCase())) return;
      if (record.is_error === true || record.isError === true) return;
      if (record.role === "user") return;
      for (const [key, item] of Object.entries(record)) {
        if (!INPUT_KEYS.has(key) && !ERROR_KEYS.has(key.toLowerCase())) collect(item);
      }
    }
  };
  // Only the successful tool's result fields are eligible, never the envelope, labels or narration.
  collect(envelope.rawOutput);
  collect(envelope.content);
  if (tag === "tool_result") collect(envelope.result);
  const extensions = media === "image" ? "png|jpe?g|webp|gif" : "mp4|webm|mov|mkv";
  // Keep the path prefix in the match. The former `\.{0,2}[\\/]` branch
  // also accepted *zero* dots, so `images/1.jpg` was truncated to `/1.jpg`.
  // `resolve(cwd, "/1.jpg")` then escaped to the drive root and the otherwise
  // valid media result was rejected by the workspace boundary check.
  const pattern = new RegExp(
    `(?:https?:\\/\\/[^\\s"'<>]+?\\.(?:${extensions})(?:\\?[^\\s"'<>]*)?|(?:[A-Za-z]:[\\\\/]|\\.{1,2}[\\\\/])[^\\r\\n"'<>]+?\\.(?:${extensions})|(?<![A-Za-z0-9_.-])(?:[^\\s"'<>:\\/]+[\\\\/])+[^\\s"'<>:\\/]+?\\.(?:${extensions}))`,
    "ig",
  );
  const excluded = new Set((options.exclude ?? []).map((value) => comparableSource(value, cwd)));
  const sources = new Map<string, string>();
  for (const value of values) {
    for (const match of value.matchAll(pattern)) {
      const source = match[0]!.replace(/[),.;]+$/, "");
      const resolved = /^https?:/i.test(source) || isAbsolute(source) ? source : resolve(cwd, source);
      const key = comparableSource(resolved, cwd);
      if (!excluded.has(key) && !sources.has(key)) sources.set(key, resolved);
    }
  }
  return [...sources.values()].map((source) => ({
    id: randomUUID(),
    media,
    source,
    mimeType: mimeForMediaPath(source, media),
    name: source.split(/[\\/]/).at(-1),
  }));
}

function comparableSource(value: string, cwd: string): string {
  if (/^https?:/i.test(value)) return value;
  return resolve(cwd, value).toLowerCase();
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
