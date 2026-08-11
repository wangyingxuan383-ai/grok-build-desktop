export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parse the single byte range supported by the media protocol. Multi-range
 * requests are deliberately rejected so the protocol never has to construct a
 * multipart body or buffer media in memory.
 */
export function parseByteRange(header: string | null, size: number): ByteRange | "invalid" | undefined {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || !Number.isSafeInteger(size) || size <= 0) return "invalid";
  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  let start: number;
  let end: number;
  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0) return "invalid";
    end = Math.min(end, size - 1);
  }
  if (start >= size || start > end) return "invalid";
  return { start, end };
}
