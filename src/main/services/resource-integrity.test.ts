import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyResourceManifest } from "./resource-integrity";

describe("resource integrity", () => {
  it("verifies generated resource hashes and rejects tampering", async () => {
    const root = await mkdtemp(join(tmpdir(), "resource-integrity-"));
    const path = join(root, "plugins", "skill.md");
    await mkdir(join(root, "plugins"), { recursive: true });
    await writeFile(path, "safe", "utf8");
    await writeFile(join(root, "resource-manifest.json"), JSON.stringify({ version: 1, entries: [{ path: "plugins/skill.md", size: 4, sha256: createHash("sha256").update("safe").digest("hex") }] }));
    expect(verifyResourceManifest(root, true).ok).toBe(true);
    await writeFile(path, "changed", "utf8");
    expect(verifyResourceManifest(root, true).ok).toBe(false);
  });
});
