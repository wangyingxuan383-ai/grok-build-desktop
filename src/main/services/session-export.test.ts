import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ConversationExportOptions, SessionExportSource } from "../../shared/conversation-export";
import { redactSessionExportText, SessionExportService, type SessionExportDependencies } from "./session-export";

function session(text = "Hello"): SessionExportSource {
  return { sessionId: "session-123", title: "Export test", projection: { sessionId: "session-123", events: [{ type: "user-message", text }] } };
}
function fixture(overrides: Partial<SessionExportDependencies> = {}) {
  const dependencies = {
    readSession: vi.fn(async () => session()),
    showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: "chosen.md" })),
    writeFile: vi.fn(async () => {}), ...overrides,
  };
  return { dependencies, service: new SessionExportService(dependencies) };
}

describe("session export redaction", () => {
  it("counts new replacements even when a redacted span contains a pre-existing marker", () => {
    const result = redactSessionExportText('already [REDACTED]; password="[REDACTED] still-secret"');
    expect(result.redactionCount).toBe(1);
    expect(result.content).not.toContain("still-secret");
    expect(result.content).toContain("already [REDACTED]");
  });
  it("reuses credential redaction and removes private Windows, UNC, POSIX/home paths and PEM keys", () => {
    const lines = [
      'Authorization: "Bearer bearer-private"', 'api_key="api-private"',
      "xai-FAKE_EXPORT_SECRET_123456789", "ghp_export_private_token123456",
      "https://user:proxy-private@example.invalid/?token=query-private",
      'C:\\Users\\Private Person\\secret.txt', '\\\\private-server\\share\\private.txt',
      "/home/private-person/secrets/key.pem", "/Users/private-person/Documents/private.txt", "~/private/key.txt",
      "-----BEGIN PRIVATE KEY-----\nprivate-key-body\n-----END PRIVATE KEY-----",
    ];
    const output = redactSessionExportText(lines.join("\n"));
    for (const secret of ["bearer-private", "api-private", "FAKE_EXPORT_SECRET", "export_private_token", "proxy-private", "query-private", "Private Person", "private-server", "private-person", "~/private", "private-key-body"]) {
      expect(output.content).not.toContain(secret);
    }
    expect(output.redactionCount).toBeGreaterThanOrEqual(10);
    expect(redactSessionExportText("ordinary text")).toEqual({ content: "ordinary text", redactionCount: 0 });
    expect(redactSessionExportText("already [REDACTED]").redactionCount).toBe(0);
  });

  it("redacts title, attachment names, nested tool data, thinking, errors and usage model metadata", async () => {
    const value = session("password=user-private");
    const data = {
      ...value, title: "token=title-private", projection: { ...value.projection, events: [
        ...value.projection.events,
        { type: "thought-chunk", text: "secret=thinking-private" },
        { type: "tool-call", tool: { toolCallId: "t", title: "tool", status: "failed", rawInput: { password: "input-private" }, output: "token=output-private", error: "secret=tool-error-private" } },
        { type: "error", message: "secret=error-private" }, { type: "meta", meta: { modelId: "token=model-private" } },
      ] },
    };
    const { service } = fixture({ readSession: async () => data });
    const preview = await service.previewSessionExport(value.sessionId, { includeTools: true, includeThinking: true });
    expect(preview.content).not.toMatch(/(?:user|title|thinking|input|output|tool-error|error|model)-private/);
    expect(preview.redactionCount).toBeGreaterThanOrEqual(8);
    const original = await service.previewSessionExport(value.sessionId, { redaction: "original", includeTools: true, includeThinking: true });
    expect(original.content).toContain("password=user-private");
    expect(original.content).toContain("thinking-private");
    expect(original).toMatchObject({ redacted: false, redactionCount: 0 });
  });
});

describe("read-only export service", () => {
  it("previews using only the injected projection reader, with backwards-compatible Markdown defaults", async () => {
    const { service, dependencies } = fixture();
    const preview = await service.previewSessionExport("session-123");
    expect(preview).toMatchObject({ format: "markdown", redacted: true, redactionCount: 0, fileName: "grok-session-session-.md" });
    expect(dependencies.readSession).toHaveBeenCalledExactlyOnceWith("session-123");
    expect(dependencies.showSaveDialog).not.toHaveBeenCalled();
    expect(dependencies.writeFile).not.toHaveBeenCalled();
  });

  it("builds a fresh payload for save, preserving the exact payload across the dialog await", async () => {
    let data = session("First");
    const { service, dependencies } = fixture({
      readSession: async () => data,
      showSaveDialog: async options => {
        expect(options).toMatchObject({ defaultPath: "grok-session-session-.html", filters: [{ name: "HTML", extensions: ["html"] }] });
        data = session("Changed during dialog");
        return { canceled: false, filePath: "selected.html" };
      },
    });
    await service.previewSessionExport("session-123", {});
    data = session("secret=second-private");
    expect(await service.saveSessionExport("session-123", { format: "html" })).toBe("selected.html");
    const saved = vi.mocked(dependencies.writeFile!).mock.calls[0] as unknown as [string, string];
    expect(saved[0]).toBe("selected.html");
    expect(saved[1]).toContain("[REDACTED]");
    expect(saved[1]).not.toContain("second-private");
    expect(saved[1]).not.toContain("Changed during dialog");
  });

  it("treats cancel and missing paths as no write", async () => {
    for (const target of [{ canceled: true, filePath: "do-not-write.md" }, { canceled: false }]) {
      const { service, dependencies } = fixture({ showSaveDialog: async () => target });
      expect(await service.saveSessionExport("session-123", {})).toBeUndefined();
      expect(dependencies.writeFile).not.toHaveBeenCalled();
    }
  });

  it("writes UTF-8 content through the default filesystem implementation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "session-export-"));
    try {
      const path = join(directory, "conversation.md");
      const service = new SessionExportService({
        readSession: async () => session("你好\npassword=private-secret"),
        showSaveDialog: async () => ({ canceled: false, filePath: path }),
      });
      await service.saveSessionExport("session-123", {});
      const content = await readFile(path, "utf8");
      expect(content).toContain("你好");
      expect(content).not.toContain("private-secret");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("rejects malformed options, missing/foreign sessions and IO failures without fallback or CLI work", async () => {
    const { service, dependencies } = fixture();
    await expect(service.previewSessionExport("session-123", { redaction: false } as unknown as ConversationExportOptions)).rejects.toThrow("redaction");
    await expect(service.previewSessionExport(" ")).rejects.toThrow("session ID");
    expect(dependencies.readSession).not.toHaveBeenCalled();
    for (const data of [undefined, { ...session(), sessionId: "foreign" }, { ...session(), projection: { sessionId: "foreign", events: [] } }]) {
      const f = fixture({ readSession: async () => data });
      await expect(f.service.saveSessionExport("session-123", {})).rejects.toThrow();
      expect(f.dependencies.showSaveDialog).not.toHaveBeenCalled();
    }
    const failed = fixture({ writeFile: async () => { throw new Error("disk failure"); } });
    await expect(failed.service.saveSessionExport("session-123", {})).rejects.toThrow("disk failure");
  });
});
