import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexPluginService } from "./codex-plugin-service";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("CodexPluginService", () => {
  it("classifies and creates a read-only Skill adapter without changing the source", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-codex-plugin-")); roots.push(root);
    const codexRoot = join(root, "codex"); const userData = join(root, "user"); const plugin = join(codexRoot, "demo");
    await mkdir(join(plugin, ".codex-plugin"), { recursive: true }); await mkdir(join(plugin, "skills", "review"), { recursive: true });
    await writeFile(join(plugin, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "demo", version: "1.0.0" }));
    await writeFile(join(plugin, "skills", "review", "SKILL.md"), "# Review\n");
    const before = await readFile(join(plugin, "skills", "review", "SKILL.md"), "utf8");
    const service = new CodexPluginService(userData, { log: async () => undefined } as never, codexRoot);
    const scanned = await service.scan(); expect(scanned[0]).toEqual(expect.objectContaining({ name: "demo", level: "adaptable", skills: ["review"] }));
    const adapted = await service.adapt(scanned[0]!.id); expect(adapted[0]!.adapterPath).toBeTruthy();
    expect(await readFile(join(plugin, "skills", "review", "SKILL.md"), "utf8")).toBe(before);
    await writeFile(join(plugin, "skills", "review", "SKILL.md"), "# Review changed\n");
    const stale = await service.scan(true); expect(stale[0]).toEqual(expect.objectContaining({ adapterStale: true }));
  });

  it("marks Codex Computer Use as not directly portable", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-codex-computer-")); roots.push(root);
    const plugin = join(root, "plugins", "computer-use"); await mkdir(join(plugin, ".codex-plugin"), { recursive: true });
    await writeFile(join(plugin, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "computer-use" }));
    const service = new CodexPluginService(join(root, "user"), { log: async () => undefined } as never, join(root, "plugins"));
    const result = await service.scan(); expect(result[0]).toEqual(expect.objectContaining({ level: "incompatible" })); expect(result[0]!.reasons.join(" ")).toContain("专有");
  });
});
