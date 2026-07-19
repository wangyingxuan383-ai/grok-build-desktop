import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonStore } from "./json-store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("JsonStore", () => {
  it("serializes concurrent patches without losing independent fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-json-store-"));
    roots.push(root);
    const path = join(root, "settings.json");
    const store = new JsonStore(path, { first: 0, second: 0, third: 0 });

    await Promise.all([
      store.patch({ first: 1 }),
      store.patch({ second: 2 }),
      store.patch({ third: 3 }),
    ]);

    expect(await store.get()).toEqual({ first: 1, second: 2, third: 3 });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ first: 1, second: 2, third: 3 });
  });

  it("does not expose caller mutations through its cache", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-json-store-"));
    roots.push(root);
    const store = new JsonStore(join(root, "value.json"), { nested: { value: 0 } });
    const result = await store.set({ nested: { value: 1 } });
    result.nested.value = 99;
    expect((await store.get()).nested.value).toBe(1);
  });
});
