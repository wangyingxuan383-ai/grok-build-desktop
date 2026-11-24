import { describe, it, expect, vi } from "vitest";
vi.mock("node:fs/promises", async importOriginal => { const actual = await importOriginal<typeof import("node:fs/promises")>(); return { ...actual, open: vi.fn(actual.open) }; });
import { readFile, open, mkdtemp, mkdir, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { DesktopPetAssets, validatePetSkin } from "./desktop-pet-assets";

describe("data-only pet packs", () => {
  it("rejects oversized files before reading and closes files that grow during import", async () => {
    const oversizedRead = vi.fn(), oversizedClose = vi.fn(async () => undefined);
    vi.mocked(open).mockResolvedValueOnce({ stat: async () => ({ isFile: () => true, size: 25 * 1024 * 1024 }), read: oversizedRead, close: oversizedClose } as unknown as Awaited<ReturnType<typeof open>>);
    const assets = new DesktopPetAssets("unused", "unused");
    await expect(assets.import("oversized.png")).rejects.toThrow("24 MiB");
    expect(oversizedRead).not.toHaveBeenCalled(); expect(oversizedClose).toHaveBeenCalledOnce();
    const growingRead = vi.fn().mockResolvedValueOnce({ bytesRead: 4 }).mockResolvedValueOnce({ bytesRead: 1 }), growingClose = vi.fn(async () => undefined);
    vi.mocked(open).mockResolvedValueOnce({ stat: async () => ({ isFile: () => true, size: 4 }), read: growingRead, close: growingClose } as unknown as Awaited<ReturnType<typeof open>>);
    await expect(assets.import("growing.png")).rejects.toThrow("发生变化"); expect(growingClose).toHaveBeenCalledOnce();
  });

  it("validates all built-in animation manifests including sleepy loopFrom and 4 new clips", async () => {
    for (const id of ["a", "b"]) {
      const skin = validatePetSkin(JSON.parse(await readFile(`resources/pets/${id}/skin.json`, "utf8")));
      expect(Object.keys(skin.clips)).toHaveLength(15);
      expect(skin.clips.sleepy?.frames).toHaveLength(4);
      expect(skin.clips.sleepy?.loopFrom).toBe(2);
      for (const clip of Object.values(skin.clips)) expect(clip!.frames.every(f => f.anchorY === 464)).toBe(true);
    }
  });

  it("rejects traversal, invalid loopFrom, impossible frames and unbounded resources", () => {
    const source = { id: "custom", name: "name", author: "author", license: "license", clips: { idle: { file: "a.webp", width: 100, height: 100, referenceHeight: 100, loop: true, frames: [{ x: 0, y: 0, width: 100, height: 100, anchorX: 50, anchorY: 100, duration: 1000 }] } } };
    for (const patch of [{ file: "../a.webp" }, { width: 99999 }, { loopFrom: 5 }, { loopFrom: -1 }, { frames: [{ x: 0, y: 0, width: 200, height: 100, anchorX: 50, anchorY: 100, duration: 1000 }] }])
      expect(() => validatePetSkin({ ...source, clips: { idle: { ...source.clips.idle, ...patch } } })).toThrow();
  });

  it("slices 2x2 sprite sheets and round-trips Codex / Grok pet ZIP packs", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-pet-studio-"));
    try {
      const assets = new DesktopPetAssets("resources/pets", root);
      const sheetPath = join(root, "sheet.webp");
      await writeFile(sheetPath, await readFile("resources/pets/a/walk.webp"));
      const sliced = await assets.importSpriteSheet({ path: sheetPath, rows: 2, cols: 2, clip: "walk", name: "漫步测试" });
      expect(sliced.id).toMatch(/^custom-/);
      expect(sliced.clips.walk?.frames).toHaveLength(4);
      expect(sliced.clips.idle?.frames).toHaveLength(4);

      const exportedCodex = join(root, "codex-export.zip");
      await assets.exportSkin(sliced.id, "codex", exportedCodex);
      const reimported = await assets.import(exportedCodex);
      expect(reimported.name).toBe("漫步测试");
      expect(reimported.clips.walk?.frames).toHaveLength(4);

      const shimeZip = join(root, "shimeji.zip");
      const idleBytes = await readFile("resources/pets/b/idle.webp");
      await writeFile(shimeZip, zipSync({ "img/shime1.webp": new Uint8Array(idleBytes), "conf/actions.xml": strToU8("<actions/>") }));
      const shimeSkin = await assets.import(shimeZip);
      expect(shimeSkin.clips.idle?.frames).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("removes only valid custom-<uuid> directories inside userRoot and rejects built-in or traversal ids", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-pet-assets-"));
    try {
      const customId = "custom-2f0c2e69-5f7b-455a-8f04-e8eaa60acfae";
      const customDir = join(root, customId);
      await mkdir(customDir, { recursive: true });
      await writeFile(join(customDir, "skin.json"), "{}");
      const assets = new DesktopPetAssets("resources/pets", root);
      for (const invalid of ["a", "b", "../custom-2f0c2e69-5f7b-455a-8f04-e8eaa60acfae", "custom-not-uuid"]) {
        await expect(assets.remove(invalid)).rejects.toThrow("自定义形象");
      }
      await assets.remove(customId);
      await expect(stat(customDir)).rejects.toThrow();
      await expect(assets.remove(customId)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
