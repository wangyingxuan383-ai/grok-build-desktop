import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaThumbnailService } from "./media-thumbnail-service";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
async function root(): Promise<string> { const value = await mkdtemp(join(tmpdir(), "grok-thumbnail-")); roots.push(value); return value; }

describe("MediaThumbnailService", () => {
  it("caches one bounded thumbnail for an unchanged source version", async () => {
    const userData = await root();
    const source = join(userData, "source.png");
    await writeFile(source, "first");
    const encoder = vi.fn(async () => Buffer.from("jpeg"));
    const service = new MediaThumbnailService(userData, encoder);
    const first = await service.get("session", source);
    const second = await service.get("session", source);
    expect(first).toEqual(second);
    expect(first.mimeType).toBe("image/jpeg");
    expect(encoder).toHaveBeenCalledTimes(1);
    expect(first.path).not.toContain("source.png");
  });

  it("invalidates a thumbnail when source size or mtime changes", async () => {
    const userData = await root();
    const source = join(userData, "source.png");
    await writeFile(source, "first");
    const encoder = vi.fn(async () => Buffer.from("jpeg"));
    const service = new MediaThumbnailService(userData, encoder);
    const first = await service.get("session", source);
    await writeFile(source, "second-version");
    await utimes(source, new Date(), new Date(Date.now() + 2_000));
    const second = await service.get("session", source);
    expect(second.path).not.toBe(first.path);
    expect(encoder).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent encoding and rejects oversized output", async () => {
    const userData = await root();
    const source = join(userData, "source.png");
    await writeFile(source, "source");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const encoder = vi.fn(async () => { await gate; return Buffer.from("jpeg"); });
    const service = new MediaThumbnailService(userData, encoder);
    const first = service.get("session", source);
    const second = service.get("session", source);
    release();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(encoder).toHaveBeenCalledTimes(1);
    await expect(new MediaThumbnailService(userData, async () => Buffer.alloc(9), { maxBytes: 8 }).get("other", source)).rejects.toThrow(/超过限制/);
  });

  it("removes one session and sweeps orphan session caches", async () => {
    const userData = await root();
    const source = join(userData, "source.png");
    await writeFile(source, "source");
    const service = new MediaThumbnailService(userData, async () => Buffer.from("jpeg"));
    const keep = await service.get("keep", source);
    const remove = await service.get("remove", source);
    await service.removeSession("remove");
    await expect(writeFile(remove.path, "x", { flag: "r+" })).rejects.toThrow();
    await service.sweep(new Set(["keep"]));
    await expect(writeFile(keep.path, "x", { flag: "r+" })).resolves.toBeUndefined();
  });

  it("bounds stale thumbnail versions within one long-lived session", async () => {
    const userData = await root();
    const source = join(userData, "source.png");
    await writeFile(source, "one");
    const service = new MediaThumbnailService(userData, async ({ sourcePath }) => Buffer.from(await import("node:fs/promises").then(({ readFile }) => readFile(sourcePath))), { maxEntriesPerSession: 1, maxSessionBytes: 64 });
    const first = await service.get("session", source);
    await writeFile(source, "second-version");
    await utimes(source, new Date(), new Date(Date.now() + 2_000));
    const second = await service.get("session", source);
    expect(second.path).not.toBe(first.path);
    await expect(writeFile(first.path, "x", { flag: "r+" })).rejects.toThrow();
  });
});
