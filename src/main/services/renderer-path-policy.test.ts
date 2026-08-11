import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalExistingPath, rememberCanonicalPath, resolveTrustedRendererPath } from "./renderer-path-policy";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tree(): Promise<{ root: string; outside: string; insideFile: string; outsideFile: string }> {
  const base = join(tmpdir(), `renderer-path-policy-${randomUUID()}`);
  roots.push(base);
  const root = join(base, "workspace");
  const outside = join(base, "outside");
  await Promise.all([mkdir(root, { recursive: true }), mkdir(outside, { recursive: true })]);
  const insideFile = join(root, "inside.txt");
  const outsideFile = join(outside, "secret.txt");
  await Promise.all([writeFile(insideFile, "inside"), writeFile(outsideFile, "secret")]);
  return { root, outside, insideFile, outsideFile };
}

describe("renderer path trust policy", () => {
  it("accepts an existing file inside a canonical trusted root", async () => {
    const value = await tree();
    await expect(resolveTrustedRendererPath(value.insideFile, { roots: [value.root], kind: "file" }))
      .resolves.toBe(await canonicalExistingPath(value.insideFile));
  });

  it("rejects an arbitrary existing file outside trusted roots", async () => {
    const value = await tree();
    await expect(resolveTrustedRendererPath(value.outsideFile, { roots: [value.root], kind: "file" }))
      .rejects.toThrow("未由文件选择器签发");
  });

  it("accepts an exact picker-issued external path but not its sibling", async () => {
    const value = await tree();
    const issued = new Set<string>();
    rememberCanonicalPath(issued, await canonicalExistingPath(value.outsideFile));
    await expect(resolveTrustedRendererPath(value.outsideFile, { roots: [value.root], issuedPaths: issued, kind: "file" }))
      .resolves.toBe(await canonicalExistingPath(value.outsideFile));
    const sibling = join(value.outside, "sibling.txt");
    await writeFile(sibling, "sibling");
    await expect(resolveTrustedRendererPath(sibling, { roots: [value.root], issuedPaths: issued, kind: "file" }))
      .rejects.toThrow("未由文件选择器签发");
  });

  it("rejects a symlink or junction that escapes a trusted root", async () => {
    const value = await tree();
    const link = join(value.root, "escaped");
    await symlink(value.outside, link, process.platform === "win32" ? "junction" : "dir");
    await expect(resolveTrustedRendererPath(join(link, "secret.txt"), { roots: [value.root], kind: "file" }))
      .rejects.toThrow("未由文件选择器签发");
  });
});
