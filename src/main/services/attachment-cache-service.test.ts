import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Attachment } from "../../shared/types";
import { AttachmentCacheService, detectImageMime } from "./attachment-cache-service";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlWQAAAAASUVORK5CYII=", "base64");
const roots: string[] = [];

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "grok-attachment-cache-"));
  roots.push(value);
  return value;
}

function pasted(overrides: Partial<Attachment> = {}): Attachment {
  return { id: "pasted-one", name: "paste.png", kind: "image", mimeType: "image/png", size: PNG.length, data: PNG.toString("base64"), ...overrides };
}

describe("attachment cache", () => {
  it("copies cached image attachments to a rebound session", async () => {
    const userData = await root();
    const service = new AttachmentCacheService(userData);
    const prepared = await service.prepare("parent", [pasted()]);
    await service.record("parent", "message", "image", prepared.previews, "sent");
    await service.cloneSession("parent", "child");
    const restored = await service.restore("child");
    expect(restored).toEqual([expect.objectContaining({ clientMessageId: "message", attachments: [expect.objectContaining({ availability: "ready" })] })]);
    expect(restored[0]!.attachments[0]!.source).not.toBe(prepared.previews[0]!.source);
  });
  it("materializes a pasted image inside a hashed session directory and restores it after restart", async () => {
    const userData = await root();
    const service = new AttachmentCacheService(userData);
    const prepared = await service.prepare("../unsafe/session", [pasted()]);
    const preview = prepared.previews[0]!;
    expect(prepared.attachments[0]).toMatchObject({ data: undefined, mimeType: "image/png", size: PNG.length });
    expect(preview).toMatchObject({ name: "paste.png", kind: "image", availability: "ready", isData: false });
    expect(resolve(preview.source!)).toBe(resolve(join(userData, "session-attachments"), relative(join(userData, "session-attachments"), preview.source!)));
    expect(relative(join(userData, "session-attachments"), preview.source!)).not.toMatch(/^\.\./);
    expect(await readFile(preview.source!)).toEqual(PNG);

    await service.record("../unsafe/session", "client-1", "look", prepared.previews, "sending");
    const restarted = new AttachmentCacheService(userData);
    expect(await restarted.restore("../unsafe/session")).toEqual([expect.objectContaining({ clientMessageId: "client-1", text: "look", delivery: "sent", attachments: [expect.objectContaining({ availability: "ready" })] })]);

    await rm(preview.source!, { force: true });
    expect(await restarted.restore("../unsafe/session")).toEqual([expect.objectContaining({ attachments: [expect.objectContaining({ availability: "missing" })] })]);
    await restarted.cleanupSession("../unsafe/session");
    expect(await restarted.restore("../unsafe/session")).toEqual([]);
    await expect(stat(dirname(preview.source!))).rejects.toThrow();
  });

  it("recognizes PNG, JPEG and WebP magic bytes and rejects invalid MIME declarations", async () => {
    expect(detectImageMime(PNG)).toBe("image/png");
    expect(detectImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectImageMime(Buffer.from("RIFF0000WEBP", "ascii"))).toBe("image/webp");
    const service = new AttachmentCacheService(await root());
    await expect(service.prepare("session", [pasted({ mimeType: "image/jpeg" })])).rejects.toThrow("类型与内容不一致");
    await expect(service.prepare("session", [pasted({ data: Buffer.from("not an image").toString("base64") })])).rejects.toThrow("不是受支持");
  });

  it("enforces the 20 MiB limit in the main process for path-based images", async () => {
    const userData = await root();
    const source = join(userData, "large.png");
    const oversized = Buffer.alloc(20 * 1024 * 1024 + 1);
    PNG.subarray(0, 8).copy(oversized);
    await writeFile(source, oversized);
    const service = new AttachmentCacheService(userData);
    await expect(service.prepare("session", [{ id: "large", name: "large.png", kind: "image", mimeType: "image/png", path: source, size: oversized.length }])).rejects.toThrow("超过 20 MiB");
  });

  it("copies a picked image into the trusted session cache so the message survives source removal", async () => {
    const userData = await root();
    const source = join(userData, "picked.png");
    await writeFile(source, PNG);
    const service = new AttachmentCacheService(userData);
    const prepared = await service.prepare("picked-session", [{
      id: "picked-image",
      name: "picked.png",
      kind: "image",
      mimeType: "image/png",
      path: source,
      size: PNG.length,
    }]);
    expect(prepared.attachments[0]?.path).not.toBe(source);
    expect(relative(join(userData, "session-attachments"), prepared.attachments[0]!.path!)).not.toMatch(/^\.\./);
    await rm(source);
    expect(await readFile(prepared.attachments[0]!.path!)).toEqual(PNG);
  });

  it("materializes a long pasted UTF-8 text draft exactly once as a txt attachment", async () => {
    const userData = await root();
    const service = new AttachmentCacheService(userData);
    const text = "长文本🙂".repeat(3_000);
    const prepared = await service.prepare("text-session", [{
      id: "long-text",
      name: "pasted-text.txt",
      kind: "file",
      mimeType: "text/plain; charset=utf-8",
      size: Buffer.byteLength(text),
      data: Buffer.from(text).toString("base64"),
    }]);
    expect(prepared.attachments[0]).toMatchObject({ kind: "file", data: undefined, mimeType: "text/plain" });
    expect(await readFile(prepared.attachments[0]!.path!, "utf8")).toBe(text);
    expect(prepared.previews[0]).toMatchObject({ kind: "file", availability: "ready" });
  });

  it("copies a path-backed composer text draft before the source draft is cleared", async () => {
    const userData = await root();
    const source = join(userData, "composer-draft.txt");
    const text = "持久化长文本".repeat(2_000);
    await writeFile(source, text, "utf8");
    const service = new AttachmentCacheService(userData);
    const prepared = await service.prepare("text-session", [{
      id: "path-text",
      name: "pasted-text.txt",
      kind: "file",
      mimeType: "text/plain; charset=utf-8",
      size: Buffer.byteLength(text),
      path: source,
      draftText: true,
    }]);
    expect(prepared.attachments[0]?.path).not.toBe(source);
    await rm(source);
    expect(await readFile(prepared.attachments[0]!.path!, "utf8")).toBe(text);
    expect(prepared.previews[0]).toMatchObject({ availability: "ready", isData: false });
  });

  it("does not lose concurrent message attachment records", async () => {
    const userData = await root();
    const service = new AttachmentCacheService(userData);
    const prepared = await service.prepare("session", [pasted()]);
    await Promise.all(Array.from({ length: 20 }, (_, index) => service.record(
      "session",
      `message-${index}`,
      `text-${index}`,
      prepared.previews,
      "sent",
    )));
    expect(await service.restore("session")).toHaveLength(20);
  });
});
