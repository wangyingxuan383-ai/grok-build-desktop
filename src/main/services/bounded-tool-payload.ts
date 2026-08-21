export interface BoundedToolPayloadOptions {
  maxBytes?: number;
  maxDepth?: number;
  maxArrayItems?: number;
  maxObjectKeys?: number;
}

export interface BoundedToolPayloadResult {
  value: unknown;
  truncated: boolean;
  observedBytes: number;
}

const TRUNCATED_VALUE = "[内容已截断]";

/**
 * Bounds untrusted MCP/tool JSON before it enters the projection or Renderer.
 * Strings are never parsed as JSON, so string-encoded 64-bit identifiers keep
 * their exact bytes. Traversal stops while building the value rather than
 * pretty-printing an arbitrarily large object and slicing afterwards.
 */
export function normalizeBoundedToolPayload(value: unknown, options: BoundedToolPayloadOptions = {}): BoundedToolPayloadResult {
  const maxBytes = Math.max(1_024, options.maxBytes ?? 256 * 1_024);
  const maxDepth = Math.max(1, options.maxDepth ?? 12);
  const maxArrayItems = Math.max(1, options.maxArrayItems ?? 256);
  const maxObjectKeys = Math.max(1, options.maxObjectKeys ?? 256);
  const seen = new WeakSet<object>();
  let observedBytes = 0;
  let truncated = false;

  const reserve = (text: string): string => {
    const bytes = Buffer.byteLength(text, "utf8");
    const remaining = maxBytes - observedBytes;
    if (bytes <= remaining) {
      observedBytes += bytes;
      return text;
    }
    truncated = true;
    if (remaining <= 0) return "";
    // Slice by code point and account in UTF-8 bytes; this avoids producing a
    // dangling surrogate while keeping ordinary strings byte-for-byte exact.
    let output = "";
    let used = 0;
    for (const character of text) {
      const size = Buffer.byteLength(character, "utf8");
      if (used + size > remaining) break;
      output += character;
      used += size;
    }
    observedBytes += used;
    return output;
  };

  const walk = (input: unknown, depth: number): unknown => {
    if (input === null || typeof input === "boolean" || typeof input === "number") {
      reserve(String(input));
      return input;
    }
    if (typeof input === "string") {
      const exact = reserve(input);
      return exact.length === input.length ? input : `${exact}${TRUNCATED_VALUE}`;
    }
    if (typeof input === "undefined") return null;
    if (typeof input === "bigint") return reserve(input.toString());
    if (typeof input !== "object") return reserve(String(input));
    if (depth >= maxDepth || observedBytes >= maxBytes) {
      truncated = true;
      return TRUNCATED_VALUE;
    }
    if (seen.has(input)) {
      truncated = true;
      return "[循环引用]";
    }
    seen.add(input);
    if (Array.isArray(input)) {
      const limit = Math.min(input.length, maxArrayItems);
      const output: unknown[] = [];
      for (let index = 0; index < limit && observedBytes < maxBytes; index += 1) output.push(walk(input[index], depth + 1));
      if (limit < input.length || output.length < limit) truncated = true;
      seen.delete(input);
      return output;
    }
    const output: Record<string, unknown> = {};
    const entries = Object.entries(input as Record<string, unknown>);
    const limit = Math.min(entries.length, maxObjectKeys);
    for (let index = 0; index < limit && observedBytes < maxBytes; index += 1) {
      const [key, child] = entries[index]!;
      const boundedKey = reserve(key);
      if (!boundedKey) break;
      output[boundedKey] = walk(child, depth + 1);
    }
    if (limit < entries.length || Object.keys(output).length < limit) truncated = true;
    seen.delete(input);
    return output;
  };

  return { value: walk(value, 0), truncated, observedBytes };
}
