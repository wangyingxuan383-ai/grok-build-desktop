import { randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";

export const HTML_PREVIEW_CSP = "sandbox allow-scripts; default-src 'none'; script-src grok-html://preview 'unsafe-inline'; style-src grok-html://preview 'unsafe-inline'; img-src grok-html://preview data: blob:; font-src grok-html://preview data:; media-src grok-html://preview data: blob:; connect-src grok-html://preview; form-action 'none'; base-uri grok-html://preview; object-src 'none'; frame-src 'none'; worker-src 'none'";

export interface HtmlPreviewRegisterOptions {
  path?: string;
  root?: string;
}

const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title", "xmp"]);
const ASSET_MIME_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

/** Memory-only, opaque preview handles. No renderer-selected filesystem URLs. */
export class HtmlPreviewService {
  private readonly documents = new Map<string, { data: string; bytes: number; at: number; root?: string }>();

  constructor(private readonly now: () => number = Date.now) {}

  register(data: string, pathOrOptions?: string | HtmlPreviewRegisterOptions, options?: { root?: string }): string {
    const bytes = Buffer.byteLength(data);
    if (bytes > 20 * 1024 * 1024) throw Error("HTML 超过 20 MB 预览上限");
    this.prune();
    while (this.documents.size >= 6 || [...this.documents.values()].reduce((sum, row) => sum + row.bytes, 0) + bytes > 40 * 1024 * 1024) {
      this.documents.delete(this.documents.keys().next().value!);
    }
    const id = randomUUID();
    const path = typeof pathOrOptions === "string" ? pathOrOptions : pathOrOptions?.path;
    const explicitRootProvided = typeof pathOrOptions === "object" && pathOrOptions !== null
      ? "root" in pathOrOptions
      : Boolean(options && "root" in options);
    const root = explicitRootProvided
      ? (typeof pathOrOptions === "object" && pathOrOptions !== null ? pathOrOptions.root : options?.root)
      : (path ? dirname(path) : undefined);

    if (path) {
      data = injectPreviewBaseTag(data, `<base href="grok-html://preview/${id}/assets/">`);
    }
    this.documents.set(id, { data, bytes: Buffer.byteLength(data), at: this.now(), root });
    return `grok-html://preview/${id}`;
  }

  response(url: string): Response {
    this.prune();
    let id: string;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "grok-html:" || parsed.hostname !== "preview" || parsed.search || parsed.hash) throw Error();
      id = parsed.pathname.slice(1);
    } catch {
      return new Response("Not found", { status: 404 });
    }
    const row = this.documents.get(id);
    if (!row) return new Response("Preview expired; reread the file.", { status: 404 });
    row.at = this.now();
    return new Response(row.data, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": HTML_PREVIEW_CSP,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  }

  clear(): void {
    this.documents.clear();
  }

  async request(url: string): Promise<Response> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return new Response("Not found", { status: 404 });
    }
    if (parsed.protocol !== "grok-html:" || parsed.hostname !== "preview" || parsed.search || parsed.hash) {
      return new Response("Not found", { status: 404 });
    }
    const assetMatch = /^\/([0-9a-f-]{36})\/assets\/(.*)$/i.exec(parsed.pathname);
    if (!assetMatch) {
      if (/^\/[0-9a-f-]{36}$/i.test(parsed.pathname)) return this.response(url);
      return new Response("Not found", { status: 404 });
    }
    this.prune();
    const document = this.documents.get(assetMatch[1]!);
    if (!document?.root || !assetMatch[2]) return new Response("Not found", { status: 404 });
    try {
      const decodedAsset = decodeURIComponent(assetMatch[2]);
      if (!decodedAsset || decodedAsset.includes("\0")) throw Error();
      const root = await realpath(document.root);
      const path = await realpath(resolve(root, decodedAsset));
      const rel = relative(root, path);
      if (!rel || rel === "." || rel.startsWith("..") || isAbsolute(rel)) throw Error();
      if (rel.split(/[\\/]+/).some((segment) => segment.startsWith("."))) throw Error();
      const type = ASSET_MIME_TYPES[extname(path).toLowerCase()];
      const info = await stat(path);
      if (!type || !info.isFile() || info.size > 20 * 1024 * 1024) throw Error();
      document.at = this.now();
      return new Response(new Uint8Array(await readFile(path)), {
        headers: {
          "Content-Type": type,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
          "Content-Security-Policy": HTML_PREVIEW_CSP,
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
        },
      });
    } catch {
      return new Response("Resource unavailable", { status: 404 });
    }
  }

  private prune(): void {
    for (const [id, row] of this.documents) {
      if (this.now() - row.at > 10 * 60_000) this.documents.delete(id);
    }
  }
}

/**
 * Strips top-level `<base>` tags outside comments/raw-text tags and injects our
 * opaque preview `<base>` into the real `<head>` (or after `<html>` / `<!doctype>`),
 * never inside `<script>`, `<style>`, `<textarea>`, `<title>`, or HTML comments.
 */
function injectPreviewBaseTag(html: string, baseTag: string): string {
  interface TagSpan {
    name: string;
    closing: boolean;
    start: number;
    end: number;
  }
  const tags: TagSpan[] = [];
  let doctypeEnd = 0;
  let index = 0;
  const length = html.length;

  while (index < length) {
    const lt = html.indexOf("<", index);
    if (lt < 0) break;
    if (html.startsWith("<!--", lt)) {
      const closeComment = html.indexOf("-->", lt + 4);
      index = closeComment < 0 ? length : closeComment + 3;
      continue;
    }
    if (html.slice(lt, lt + 9).toLowerCase() === "<!doctype") {
      const gt = findTagEnd(html, lt + 9);
      if (gt < 0) break;
      if (doctypeEnd === 0) doctypeEnd = gt + 1;
      index = gt + 1;
      continue;
    }
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const gt = html.indexOf(">", lt + 2);
      index = gt < 0 ? length : gt + 1;
      continue;
    }
    const match = /^<\/?\s*([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(lt));
    if (!match) {
      index = lt + 1;
      continue;
    }
    const closing = html[lt + 1] === "/";
    const name = match[1]!.toLowerCase();
    const gt = findTagEnd(html, lt + match[0].length);
    if (gt < 0) break;
    const selfClosing = !closing && /\/\s*>$/.test(html.slice(lt, gt + 1));
    tags.push({ name, closing, start: lt, end: gt + 1 });
    index = gt + 1;

    if (!closing && !selfClosing && RAW_TEXT_TAGS.has(name)) {
      const closeRegex = new RegExp(`<\\/\\s*${name}\\b[^>]*>`, "gi");
      closeRegex.lastIndex = index;
      const closeMatch = closeRegex.exec(html);
      index = closeMatch ? closeMatch.index + closeMatch[0].length : length;
    }
  }

  let cleaned = "";
  let cursor = 0;
  for (const tag of tags) {
    if (!tag.closing && tag.name === "base") {
      cleaned += html.slice(cursor, tag.start);
      cursor = tag.end;
    }
  }
  cleaned += html.slice(cursor);

  // Re-scan cleaned top-level markup to find real <head> or <html>.
  let realHeadEnd = -1;
  let realHtmlEnd = -1;
  let cleanedDoctypeEnd = 0;
  index = 0;
  while (index < cleaned.length) {
    const lt = cleaned.indexOf("<", index);
    if (lt < 0) break;
    if (cleaned.startsWith("<!--", lt)) {
      const closeComment = cleaned.indexOf("-->", lt + 4);
      index = closeComment < 0 ? cleaned.length : closeComment + 3;
      continue;
    }
    if (cleaned.slice(lt, lt + 9).toLowerCase() === "<!doctype") {
      const gt = findTagEnd(cleaned, lt + 9);
      if (gt < 0) break;
      if (cleanedDoctypeEnd === 0) cleanedDoctypeEnd = gt + 1;
      index = gt + 1;
      continue;
    }
    if (cleaned[lt + 1] === "!" || cleaned[lt + 1] === "?") {
      const gt = cleaned.indexOf(">", lt + 2);
      index = gt < 0 ? cleaned.length : gt + 1;
      continue;
    }
    const match = /^<\/?\s*([a-zA-Z][a-zA-Z0-9:-]*)/.exec(cleaned.slice(lt));
    if (!match) {
      index = lt + 1;
      continue;
    }
    const closing = cleaned[lt + 1] === "/";
    const name = match[1]!.toLowerCase();
    const gt = findTagEnd(cleaned, lt + match[0].length);
    if (gt < 0) break;
    const selfClosing = !closing && /\/\s*>$/.test(cleaned.slice(lt, gt + 1));
    if (!closing) {
      if (name === "head" && realHeadEnd < 0) {
        realHeadEnd = gt + 1;
        break;
      }
      if (name === "html" && realHtmlEnd < 0) {
        realHtmlEnd = gt + 1;
      }
    }
    index = gt + 1;
    if (!closing && !selfClosing && RAW_TEXT_TAGS.has(name)) {
      const closeRegex = new RegExp(`<\\/\\s*${name}\\b[^>]*>`, "gi");
      closeRegex.lastIndex = index;
      const closeMatch = closeRegex.exec(cleaned);
      index = closeMatch ? closeMatch.index + closeMatch[0].length : cleaned.length;
    }
  }

  if (realHeadEnd >= 0) {
    return `${cleaned.slice(0, realHeadEnd)}${baseTag}${cleaned.slice(realHeadEnd)}`;
  }
  if (realHtmlEnd >= 0) {
    return `${cleaned.slice(0, realHtmlEnd)}<head>${baseTag}</head>${cleaned.slice(realHtmlEnd)}`;
  }
  if (cleanedDoctypeEnd > 0) {
    return `${cleaned.slice(0, cleanedDoctypeEnd)}<head>${baseTag}</head>${cleaned.slice(cleanedDoctypeEnd)}`;
  }
  return `${baseTag}${cleaned}`;
}

function findTagEnd(source: string, start: number): number {
  let quote: '"' | "'" | undefined;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  return -1;
}
