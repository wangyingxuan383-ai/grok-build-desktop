import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
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

  it("serializes complete concurrent read-modify-write transactions", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-json-store-"));
    roots.push(root);
    const store = new JsonStore(join(root, "counter.json"), { count: 0, items: [] as string[] });

    await Promise.all(Array.from({ length: 20 }, (_, index) => store.mutate((value) => {
      value.count += 1;
      value.items.push(String(index));
    })));

    const value = await store.get();
    expect(value.count).toBe(20);
    expect(new Set(value.items).size).toBe(20);
  });

  it("preserves malformed JSON as a recovery backup before using defaults", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-json-store-"));
    roots.push(root);
    const path = join(root, "settings.json");
    await writeFile(path, '{"broken":', "utf8");
    const store = new JsonStore(path, { enabled: true });
    expect(await store.get()).toEqual({ enabled: true });
    const backups = (await readdir(root)).filter((name) => name.startsWith("settings.json.corrupt-") && name.endsWith(".bak"));
    expect(backups).toHaveLength(1);
    expect(await readFile(join(root, backups[0]!), "utf8")).toBe('{"broken":');
    await store.set({ enabled: false });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ enabled: false });
  });

  it("removes only stale atomic temp files for the same store", async () => {
    const root = await mkdtemp(join(tmpdir(), "grok-json-store-"));
    roots.push(root);
    const stale = join(root, "settings.json.1.old.tmp");
    const recent = join(root, "settings.json.1.recent.tmp");
    const unrelated = join(root, "other.json.1.old.tmp");
    await Promise.all([stale, recent, unrelated].map((path) => writeFile(path, "", "utf8")));
    const old = new Date(Date.now() - 25 * 60 * 60 * 1_000);
    await utimes(stale, old, old);
    await utimes(unrelated, old, old);
    const store = new JsonStore(join(root, "settings.json"), { value: 1 });
    await store.get();
    expect(await readdir(root)).toEqual(expect.arrayContaining(["settings.json.1.recent.tmp", "other.json.1.old.tmp"]));
    expect(await readdir(root)).not.toContain("settings.json.1.old.tmp");
  });
});
