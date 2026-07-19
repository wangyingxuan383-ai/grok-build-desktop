import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { enrichMarketplaceSources, ExtensionService, normalizeMarketplace, normalizeMcpList, normalizePluginList } from "./extension-service";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("ExtensionService normalization", () => {
  it("normalizes private ACP plugin inventory", () => {
    expect(normalizePluginList({ plugins: [{ id: "user:test", name: "test", enabled: true, trusted: true, skillNames: ["review"], hookCount: 2, mcpServerCount: 1, marketplaceSource: "xAI Official" }] })).toEqual([
      expect.objectContaining({ id: "user:test", name: "test", enabled: true, trusted: true, skills: ["review"], hookCount: 2, mcpServerCount: 1, source: "xAI Official" }),
    ]);
  });

  it("normalizes CLI marketplace rows and preserves components", () => {
    const result = normalizeMarketplace([{ status: "available", name: "chrome-devtools", marketplace: "xAI Official", components: { skills: [{ name: "chrome-devtools" }], mcpServers: [{ name: "chrome-devtools" }] } }]);
    expect(result[0]?.plugins[0]).toEqual(expect.objectContaining({ name: "chrome-devtools", official: true, installed: false, components: expect.objectContaining({ skills: ["chrome-devtools"], mcpServers: 1 }) }));
    expect(enrichMarketplaceSources(result, [{ name: "xAI Official", kind: "git", source: { url: "https://github.com/xai-org/plugin-marketplace.git", branch: "main" } }])[0]).toEqual(expect.objectContaining({ kind: "git", urlOrPath: "https://github.com/xai-org/plugin-marketplace.git", branch: "main" }));
  });

  it("normalizes nested MCP session status without exposing headers", () => {
    const result = normalizeMcpList({ servers: [{ name: "browser", source: "local", session: { enabled: true, status: "ready", authRequired: true, tools: [{ name: "click", description: "Click" }] } }] });
    expect(result).toEqual([{ name: "browser", source: "local", enabled: true, status: "ready", toolCount: 1, tools: [{ name: "click", description: "Click" }], configSource: undefined, oauth: true }]);
  });

  it("statically previews a local plugin before trust and fingerprints all files", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-plugin-preview-test-")); roots.push(root);
    await mkdir(join(root, "skills", "review"), { recursive: true });
    await writeFile(join(root, "plugin.json"), JSON.stringify({ name: "preview-demo", version: "1.2.3", commands: [{ name: "review" }], mcpServers: { demo: {} }, license: "MIT" }));
    await writeFile(join(root, "skills", "review", "SKILL.md"), "# review");
    await writeFile(join(root, "hook.js"), "export default {};");
    const service = new ExtensionService(async () => ({ cliPath: "" }) as never, async () => undefined, { log: async () => undefined } as never);
    const first = await service.preview(root);
    expect(first).toEqual(expect.objectContaining({ name: "preview-demo", version: "1.2.3", kind: "local", skills: ["review"], commands: ["review"], mcpServers: ["demo"], license: "MIT" }));
    expect(first.executableFiles).toContain("hook.js");
    await writeFile(join(root, "hook.js"), "export default { changed: true };");
    expect((await service.preview(root)).fingerprint).not.toBe(first.fingerprint);
  });
});
