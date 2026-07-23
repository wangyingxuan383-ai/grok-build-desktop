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
});
