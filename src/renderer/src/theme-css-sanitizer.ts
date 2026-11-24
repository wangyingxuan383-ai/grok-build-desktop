export const MAX_CUSTOM_THEME_CSS_BYTES = 64 * 1024;

export interface SanitizedThemeCssResult {
  css: string;
  strippedCount: number;
  truncated: boolean;
  warnings: string[];
}

/**
 * Sanitizes user-supplied custom theme CSS before injecting into the renderer
 * document. Enforces a 64 KiB UTF-8 ceiling, strips @import / image-set() /
 * external url() references, and allows only #id fragments and non-executable
 * data: URIs so custom themes cannot exfiltrate tokens or trigger network I/O.
 */
export function sanitizeThemeCss(rawInput: string | undefined | null): SanitizedThemeCssResult {
  if (!rawInput || typeof rawInput !== "string") {
    return { css: "", strippedCount: 0, truncated: false, warnings: [] };
  }

  const warnings: string[] = [];
  let strippedCount = 0;

  let working = rawInput.replace(/\0/g, "");
  const bounded = truncateUtf8(working, MAX_CUSTOM_THEME_CSS_BYTES);
  const truncated = bounded.truncated;
  if (truncated) {
    warnings.push("自定义 CSS 超过 64 KiB 上限，超出部分已截断");
  }
  working = bounded.text;

  const stripClosingStyleTag = (value: string): string => {
    if (!/<\/\s*style/i.test(value)) return value;
    strippedCount += 1;
    if (!warnings.includes("已移除非法 </style> 标签片段")) {
      warnings.push("已移除非法 </style> 标签片段");
    }
    return value.replace(/<\/\s*style/gi, "/* stripped-tag */");
  };

  working = stripClosingStyleTag(working);
  working = stripCommentsAndDecodeIdentifierEscapes(working);
  working = stripClosingStyleTag(working);

  working = stripForbiddenAtRules(working, () => {
    strippedCount += 1;
    if (!warnings.includes("已移除禁止的 @import / @charset 规则")) {
      warnings.push("已移除禁止的 @import / @charset 规则");
    }
  });

  working = working.replace(/(?:(?<![-\w])expression\s*\(|(?<![-\w])-moz-binding\s*:|(?<![-\w])behavior\s*:)/gi, () => {
    strippedCount += 1;
    return "/* stripped */:";
  });

  working = replaceCssFunctions(working, ["-webkit-image-set", "image-set"], () => {
    strippedCount += 1;
    if (!warnings.includes("已移除禁止的 image-set() 引用")) {
      warnings.push("已移除禁止的 image-set() 引用");
    }
    return "none";
  });

  working = replaceCssFunctions(working, ["url"], (innerRaw) => {
    const cleaned = unquoteAndDecodeCssUrl(innerRaw);
    if (isAllowedCssUrl(cleaned)) {
      return `url("${cleaned.replace(/["\\\r\n]/g, "")}")`;
    }
    strippedCount += 1;
    if (!warnings.includes("已移除外部或本地 url() 资源（仅允许 data: 与 #id）")) {
      warnings.push("已移除外部或本地 url() 资源（仅允许 data: 与 #id）");
    }
    return "none";
  });

  return {
    css: working.trim(),
    strippedCount,
    truncated,
    warnings,
  };
}

export function sanitizeCustomCss(rawInput: string | undefined | null): string {
  return sanitizeThemeCss(rawInput).css;
}

function truncateUtf8(input: string, maxBytes: number): { text: string; truncated: boolean } {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(input);
  if (encoded.byteLength <= maxBytes) {
    return { text: input, truncated: false };
  }
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let sliceEnd = maxBytes;
  while (sliceEnd > 0 && ((encoded[sliceEnd] ?? 0) & 0xc0) === 0x80) {
    sliceEnd -= 1;
  }
  return { text: decoder.decode(encoded.subarray(0, sliceEnd)), truncated: true };
}

function decodeCssEscapes(value: string): string {
  return value
    .replace(/\\([0-9a-fA-F]{1,6})(?:\r\n|[ \t\r\n\f])?/g, (_m, hex: string) => {
      const code = Number.parseInt(hex, 16);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        return "\ufffd";
      }
      return String.fromCodePoint(code);
    })
    .replace(/\\([^\r\n\f0-9a-fA-F])/g, "$1");
}

function stripCommentsAndDecodeIdentifierEscapes(css: string): string {
  let out = "";
  let nonStringChunk = "";
  let i = 0;
  const flushNonString = (): void => {
    if (!nonStringChunk) return;
    out += decodeCssEscapes(nonStringChunk);
    nonStringChunk = "";
  };

  while (i < css.length) {
    const ch = css[i]!;
    const next = css[i + 1];
    if (ch === "/" && next === "*") {
      nonStringChunk += " ";
      i += 2;
      while (i < css.length && !(css[i] === "*" && css[i + 1] === "/")) {
        i += 1;
      }
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      flushNonString();
      const quote = ch;
      out += quote;
      i += 1;
      while (i < css.length) {
        const c = css[i]!;
        out += c;
        i += 1;
        if (c === "\\" && i < css.length) {
          out += css[i]!;
          i += 1;
          continue;
        }
        if (c === quote) break;
      }
      continue;
    }
    nonStringChunk += ch;
    i += 1;
  }
  flushNonString();
  return out;
}

function replaceCssFunctions(
  css: string,
  names: readonly string[],
  replacer: (inner: string, fnName: string) => string,
): string {
  const lowered = names.map((n) => n.toLowerCase());
  let out = "";
  let i = 0;

  while (i < css.length) {
    const ch = css[i]!;
    if (ch === '"' || ch === "'") {
      const quote = ch;
      out += quote;
      i += 1;
      while (i < css.length) {
        const c = css[i]!;
        out += c;
        i += 1;
        if (c === "\\" && i < css.length) {
          out += css[i]!;
          i += 1;
          continue;
        }
        if (c === quote) break;
      }
      continue;
    }

    let matchedName: string | undefined;
    let openParenIndex = -1;
    const prev = i > 0 ? css[i - 1]! : "";
    if (!/[A-Za-z0-9_-]/.test(prev)) {
      for (const candidate of lowered) {
        if (css.slice(i, i + candidate.length).toLowerCase() === candidate) {
          let cursor = i + candidate.length;
          while (cursor < css.length && /\s/.test(css[cursor]!)) cursor += 1;
          if (css[cursor] === "(") {
            matchedName = candidate;
            openParenIndex = cursor;
            break;
          }
        }
      }
    }

    if (!matchedName || openParenIndex < 0) {
      out += ch;
      i += 1;
      continue;
    }

    let depth = 1;
    let cursor = openParenIndex + 1;
    while (cursor < css.length && depth > 0) {
      const c = css[cursor]!;
      if (c === '"' || c === "'") {
        const q = c;
        cursor += 1;
        while (cursor < css.length) {
          const qc = css[cursor]!;
          cursor += 1;
          if (qc === "\\" && cursor < css.length) {
            cursor += 1;
            continue;
          }
          if (qc === q) break;
        }
        continue;
      }
      if (c === "(") depth += 1;
      else if (c === ")") depth -= 1;
      cursor += 1;
    }

    const inner = depth === 0 ? css.slice(openParenIndex + 1, cursor - 1) : css.slice(openParenIndex + 1);
    out += replacer(inner, matchedName);
    i = cursor;
  }

  return out;
}

function stripForbiddenAtRules(css: string, onStrip: () => void): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const ch = css[i]!;
    if (ch === '"' || ch === "'") {
      const quote = ch;
      out += quote;
      i += 1;
      while (i < css.length) {
        const c = css[i]!;
        out += c;
        i += 1;
        if (c === "\\" && i < css.length) {
          out += css[i]!;
          i += 1;
          continue;
        }
        if (c === quote) break;
      }
      continue;
    }
    if (ch === "@" && /^@(?:import|charset)\b/i.test(css.slice(i, i + 10))) {
      onStrip();
      let cursor = i + 1;
      let parenDepth = 0;
      while (cursor < css.length) {
        const c = css[cursor]!;
        if (c === '"' || c === "'") {
          const q = c;
          cursor += 1;
          while (cursor < css.length) {
            const qc = css[cursor]!;
            cursor += 1;
            if (qc === "\\" && cursor < css.length) {
              cursor += 1;
              continue;
            }
            if (qc === q) break;
          }
          continue;
        }
        if (c === "(") parenDepth += 1;
        else if (c === ")" && parenDepth > 0) parenDepth -= 1;
        else if (parenDepth === 0 && c === ";") {
          cursor += 1;
          break;
        } else if (parenDepth === 0 && (c === "{" || c === "}")) {
          break;
        }
        cursor += 1;
      }
      i = cursor;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function unquoteAndDecodeCssUrl(raw: string): string {
  let trimmed = raw.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    trimmed = trimmed.slice(1, -1);
  }
  const decoded = decodeCssEscapes(trimmed).replace(/[\x00-\x1f\x7f]+/g, "").trim();
  if (/^data:[^,]*;base64\b/i.test(decoded)) {
    const commaIdx = decoded.indexOf(",");
    return commaIdx >= 0 ? `${decoded.slice(0, commaIdx + 1)}${decoded.slice(commaIdx + 1).replace(/\s+/g, "")}` : decoded;
  }
  return decoded;
}

function isAllowedCssUrl(url: string): boolean {
  if (!url) return false;
  if (/^#[A-Za-z_][A-Za-z0-9_-]*$/.test(url)) {
    return true;
  }
  if (!/^data:/i.test(url)) {
    return false;
  }
  if (/^data:\s*(?:text\/html|text\/javascript|application\/javascript)/i.test(url)) {
    return false;
  }
  if (/^data:\s*image\/svg\+xml/i.test(url)) {
    const decoded = safeDecodePercent(url);
    if (/(?:<\s*script|javascript:|on[a-z]+\s*=|<\s*foreignobject)/i.test(decoded)) {
      return false;
    }
    const commaIdx = url.indexOf(",");
    if (commaIdx > 0 && /;base64\b/i.test(url.slice(0, commaIdx))) {
      const b64 = url.slice(commaIdx + 1).replace(/\s+/g, "");
      try {
        const svgText = atob(b64);
        if (/(?:<\s*script|javascript:|on[a-z]+\s*=|<\s*foreignobject)/i.test(svgText)) {
          return false;
        }
      } catch {
        return false;
      }
    }
  }
  return /^data:[A-Za-z0-9.+/-]+(?:;[A-Za-z0-9=+._-]+)*,[\x20-\x7e]+$/i.test(url);
}

function safeDecodePercent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
