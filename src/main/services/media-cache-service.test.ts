import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveTrustedMediaArtifactSource, sessionCacheKey, sweepSessionMediaCache } from "./media-cache-service";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "grok-media-cache-"));
  roots.push(root);
  return root;
}

describe("sweepSessionMediaCache", () => {
  it("removes only orphan session directories", async () => {
    const root = await tempRoot();
    const kept = join(root, sessionCacheKey("kept"));
    const orphan = join(root, sessionCacheKey("orphan"));
    await mkdir(kept, { recursive: true });
    await mkdir(orphan, { recursive: true });
    await writeFile(join(kept, "image.png"), "kept");
    await writeFile(join(orphan, "image.png"), "orphan");

    const result = await sweepSessionMediaCache(root, new Set(["kept"]));
    expect(result.removedOrphanDirectories).toBe(1);
    expect(await readFile(join(kept, "image.png"), "utf8")).toBe("kept");
    await expect(readFile(join(orphan, "image.png"), "utf8")).rejects.toThrow();
  });

  it("evicts the oldest files when the global bound is exceeded", async () => {
    const root = await tempRoot();
    const directory = join(root, sessionCacheKey("session"));
    await mkdir(directory, { recursive: true });
    const first = join(directory, "first.png");
    const second = join(directory, "second.png");
    await writeFile(first, "123456");
    await new Promise((resolve) => setTimeout(resolve, 15));
    await writeFile(second, "abcdef");

    const result = await sweepSessionMediaCache(root, new Set(["session"]), 6);
    expect(result).toMatchObject({ removedFiles: 1, bytesBefore: 12, bytesAfter: 6 });
    await expect(readFile(first, "utf8")).rejects.toThrow();
    expect(await readFile(second, "utf8")).toBe("abcdef");
  });

  it("accepts an artifact from the exact transient CLI session and rejects siblings", async () => {
    const root = await tempRoot();
    const transient = join(root, "sessions", "transient-id");
    const sibling = join(root, "sessions", "another-id");
    await mkdir(join(transient, "images"), { recursive: true });
    await mkdir(join(sibling, "images"), { recursive: true });
    const accepted = join(transient, "images", "1.png");
    const rejected = join(sibling, "images", "2.png");
    await writeFile(accepted, "accepted");
    await writeFile(rejected, "rejected");

    expect(await resolveTrustedMediaArtifactSource(accepted, [transient])).toBe(await realpath(accepted));
    expect(await resolveTrustedMediaArtifactSource(rejected, [transient])).toBeUndefined();
  });
});
