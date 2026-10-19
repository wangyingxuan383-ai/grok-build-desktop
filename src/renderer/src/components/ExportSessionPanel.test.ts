import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SessionExportPreview } from "../../../shared/conversation-export";
import { ExportSessionPreview } from "./ExportSessionPanel";

const preview = (format: "markdown" | "html", content: string): SessionExportPreview => ({ content, format, fileName: "export", redacted: true, redactionCount: 0 });

describe("local export preview", () => {
  it("shows Markdown as text so raw HTML, Markdown images and URLs cannot load resources", () => {
    const markup = renderToStaticMarkup(createElement(ExportSessionPreview, { preview: preview("markdown", '<img src="https://private.invalid/pixel"><script>alert(1)</script>\n![tracking](https://private.invalid/x.png)') }));
    expect(markup).toContain("<pre");
    expect(markup).toContain("&lt;img");
    expect(markup).not.toMatch(/<(img|script|iframe|a)\b/i);
    expect(markup).toContain("![tracking]");
  });

  it("contains HTML preview in an empty sandbox with no referrer or external frame URL", () => {
    const markup = renderToStaticMarkup(createElement(ExportSessionPreview, { preview: preview("html", "<!doctype html><html><body>Local only</body></html>") }));
    expect(markup).toContain('sandbox=""');
    expect(markup).toMatch(/referrerPolicy="no-referrer"/i);
    expect(markup).toMatch(/srcDoc="&lt;!doctype html&gt;/i);
    expect(markup).not.toMatch(/\ssrc=/i);
    expect(markup).not.toContain("allow-scripts");
    expect(markup).not.toContain("allow-same-origin");
  });
});
