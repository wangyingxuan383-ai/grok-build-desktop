import { describe, expect, it, vi } from "vitest";
import {
  buildSessionExport, DEFAULT_SESSION_EXPORT_OPTIONS, normalizeSessionExportOptions,
  type ConversationExportOptions, type SessionExportSource,
} from "./conversation-export";

const unchanged = (content: string) => ({ content, redactionCount: 0 });
function source(events: Array<Record<string, unknown>> = []): SessionExportSource {
  return { sessionId: "session-123", title: "A conversation", projection: { sessionId: "session-123", events } };
}
const user = (text = "Question", clientMessageId = "user-1") => ({ type: "user-message", text, clientMessageId });

describe("export contract and privacy defaults", () => {
  it("defaults to redacted Markdown without tools/thinking and rejects invalid wire options", () => {
    expect(normalizeSessionExportOptions()).toEqual(DEFAULT_SESSION_EXPORT_OPTIONS);
    for (const options of [null, [], { format: "pdf" }, { redaction: false }, { redaction: "false" }, { includeTools: "true" }]) {
      expect(() => normalizeSessionExportOptions(options as ConversationExportOptions)).toThrow();
    }
    expect(normalizeSessionExportOptions({ includeTools: undefined }).redaction).toBe("redacted");
  });

  it("redacts every included text field and counts only included replacements", () => {
    const redact = vi.fn((content: string) => ({ content: content.replaceAll("SECRET", "[REDACTED]"), redactionCount: content.split("SECRET").length - 1 }));
    const session = { ...source([
      user("SECRET"), { type: "thought-chunk", text: "SECRET thinking" },
      { type: "message-chunk", text: "SECRET reply" },
      { type: "tool-call", tool: { toolCallId: "t1", title: "SECRET tool", status: "failed", output: "SECRET output" } },
    ]), title: "SECRET title" };
    const defaultPreview = buildSessionExport(session, {}, redact);
    expect(defaultPreview.redactionCount).toBe(3);
    expect(defaultPreview.content).not.toContain("SECRET");
    expect(defaultPreview.content).not.toContain("thinking");
    expect(defaultPreview.content).not.toContain("### Tool");
    expect(defaultPreview.content).toContain("Tools: 1");
    expect(buildSessionExport(session, { includeThinking: true, includeTools: true }, redact).redactionCount).toBe(6);
  });

  it("requires the explicit original policy and preserves that choice across format changes", () => {
    const redact = vi.fn(unchanged);
    const session = source([user("password=original-value")]);
    for (const format of ["markdown", "html"] as const) {
      const preview = buildSessionExport(session, { format, redaction: "original" }, redact);
      expect(preview).toMatchObject({ format, redacted: false, redactionCount: 0 });
      expect(preview.content).toContain("password=original-value");
    }
    expect(redact).not.toHaveBeenCalled();
    expect(buildSessionExport(session, {}, unchanged).redacted).toBe(true);
  });
});

describe("static HTML safety", () => {
  it("escapes adversarial content in titles, messages, thinking, tool data, errors and metadata", () => {
    const attack = '</title></style><script>alert(1)</script><img src="https://tracker.invalid/pixel" onerror="alert(2)"><iframe srcdoc="bad"></iframe><svg onload="alert(3)"><a href="javascript:alert(4)">x</a>';
    const session = { ...source([
      user(attack), { type: "thought-chunk", text: attack }, { type: "message-chunk", text: attack },
      { type: "tool-call", tool: { toolCallId: "t", title: attack, status: "failed", rawInput: { attack }, output: attack, error: attack } },
      { type: "error", message: attack }, { type: "meta", meta: { modelId: attack } },
    ]), title: attack };
    const html = buildSessionExport(session, { format: "html", redaction: "original", includeTools: true, includeThinking: true }, unchanged).content;
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=&quot;https://tracker.invalid/pixel&quot;");
    expect(html).not.toMatch(/<(?:script|img|iframe|svg|a|link|object|embed|video|audio|base)\b/i);
    expect(html).not.toMatch(/<[^>]*\s(?:src|srcdoc|href|onerror|onload)=/i);
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("default-src &#39;none&#39;");
    expect(html).toContain("img-src &#39;none&#39;");
  });

  it("never embeds Markdown images, data media, CSS imports, or local/remote resources", () => {
    const text = '![tracking](https://tracker.invalid/a.png)\n![local](file:///C:/private/a.png)\n<style>@import "https://tracker.invalid/x.css";body{background:url(https://tracker.invalid/y)}</style>';
    const html = buildSessionExport(source([
      user(text), { type: "media", source: "data:image/svg+xml;base64,secret-data", media: "image" },
    ]), { format: "html", redaction: "original" }, unchanged).content;
    expect(html).not.toMatch(/<(?:img|image|link|video|audio)\b/i);
    expect(html.match(/<style>/g)).toHaveLength(1);
    expect(html).toContain("&lt;style&gt;@import");
    expect(html).not.toContain("secret-data");
    expect(html).toContain("Media omitted");
  });
});

describe("turn readability and recorded evidence", () => {
  it("coalesces streamed text/tool updates, keeps interjections, and counts distinct referenced files", () => {
    const events = [user(),
      { type: "turn-started", presentation: { turnId: "turn-1", clientMessageId: "user-1" } },
      { type: "message-chunk", text: "Hel" }, { type: "message-chunk", text: "lo" },
      { type: "interjection", text: "Also test this" },
      { type: "tool-call", tool: { toolCallId: "tool-1", title: "Read", status: "pending", locations: [{ path: "src/a.ts" }, { path: "src/a.ts" }] } },
      { type: "tool-call", tool: { toolCallId: "tool-1", status: "failed", error: "Read failed" } },
      { type: "turn-completed", presentation: { turnId: "turn-1", outcome: "failed" } },
      user("Next", "user-2"), { type: "message-chunk", text: "Next reply" },
    ];
    const preview = buildSessionExport(source(events), { includeTools: true }, unchanged);
    expect(preview.content).toContain("Hello");
    expect(preview.content).toContain("User (interjection)");
    expect(preview.content).toContain("Tools: 1 · Referenced files: 1 · Failed tools: 1");
    expect(preview.content.match(/### Tool\n/g)).toHaveLength(1);
    expect(preview.content.match(/## Turn /g)).toHaveLength(2);
    expect(buildSessionExport(source(events), { includeTurnSummary: false }, unchanged).content).not.toContain("Referenced files:");
  });

  it("keeps explicit zero, missing total and incomplete usage distinct, without arithmetic", () => {
    const session = { ...source([user(), { type: "message-chunk", text: "Reply" }]), presentations: [{
      turnId: "t1", clientMessageId: "user-1", ordinal: 1, startedAt: "2026-10-18T00:00:00Z",
      usage: { source: "acp-turn" as const, exact: true as const, inputTokens: 0, outputTokens: 4, usageIsIncomplete: true },
    }] };
    for (const format of ["markdown", "html"] as const) {
      const content = buildSessionExport(session, { format }, unchanged).content;
      expect(content).toContain("Input: 0");
      expect(content).toContain("Output: 4");
      expect(content).toContain("Total: unknown");
      expect(content).toContain("Incomplete usage report");
      expect(content).not.toContain("Total: 4");
      expect(content).not.toContain("Cached read: 0");
    }
    expect(buildSessionExport(source([user()]), {}, unchanged).content).toContain("Input: unknown");
  });

  it("uses restored presentations by identity, not array position or an invented session total", () => {
    const content = buildSessionExport(source([
      user("First", "a"), { type: "turn-completed" }, user("Second", "b"),
      { type: "turn-presentations-restore", presentations: [
        { turnId: "t2", clientMessageId: "b", usage: { totalTokens: 0 } },
        { turnId: "unrelated", usage: { totalTokens: 999 } },
      ] },
    ]), {}, unchanged).content;
    expect(content.slice(0, content.indexOf("## Turn 2"))).toContain("Total: unknown");
    expect(content.slice(content.indexOf("## Turn 2"))).toContain("Total: 0");
    expect(content).not.toContain("999");
  });

  it("does not mutate frozen input, cross session boundaries, or include attachment/media payloads", () => {
    const events = Object.freeze([
      Object.freeze({ ...user(), attachments: [{ name: "notes.txt", source: "https://private.invalid", data: "PRIVATE_BYTES" }] }),
      Object.freeze({ type: "message-chunk", sessionId: "other-session", text: "OTHER_SESSION" }),
    ]);
    const session = Object.freeze({ ...source(), projection: Object.freeze({ sessionId: "session-123", events }) });
    const preview = buildSessionExport(session, {}, unchanged);
    expect(preview.content).toContain("notes.txt");
    expect(preview.content).not.toContain("PRIVATE_BYTES");
    expect(preview.content).not.toContain("private.invalid");
    expect(preview.content).not.toContain("OTHER_SESSION");
    expect(() => buildSessionExport({ ...session, projection: { sessionId: "wrong", events } }, {}, unchanged)).toThrow("another session");
  });
});
