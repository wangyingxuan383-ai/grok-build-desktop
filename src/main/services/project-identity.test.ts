import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeProjectPath, resolveProjectIdentity } from "./project-identity";

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("project identity", () => {
  it("uses one stable identity for case, trailing separators and junction aliases", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-project-identity-"));
    roots.push(root);
    const project = join(root, "Project");
    const alias = join(root, "Project-Alias");
    await mkdir(project, { recursive: true });
    await symlink(project, alias, "junction");

    const identities = await Promise.all([
      resolveProjectIdentity(project),
      resolveProjectIdentity(`${project}\\`),
      resolveProjectIdentity(project.toLocaleUpperCase()),
      resolveProjectIdentity(alias),
    ]);
    expect(new Set(identities.map((value) => value.id)).size).toBe(1);
    expect(identities.every((value) => value.exists)).toBe(true);
  });

  it("keeps missing projects recoverable with a deterministic lexical identity", async () => {
    const missing = join(tmpdir(), "grok-project-missing", "Child");
    const first = await resolveProjectIdentity(missing);
    const second = await resolveProjectIdentity(`${missing}\\`);
    expect(first.id).toBe(second.id);
    expect(first.exists).toBe(false);
    expect(first.diagnostic).toContain("路径不存在");
    expect(normalizeProjectPath(missing.toLocaleUpperCase())).toBe(normalizeProjectPath(missing));
  });
});
