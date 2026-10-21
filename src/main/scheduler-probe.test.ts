import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSchedulerProbeMarker } from "./scheduler-probe";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function directory() { const root = await mkdtemp(join(tmpdir(), "grok-scheduler-test-")); roots.push(root); return root; }
const file = "grok-build-desktop-scheduler-probe-0123456789abcdef0123456789abcdef.json";
it("accepts a physical temp directory even when Windows expands its short-path alias", async () => {
  const root = await directory(), marker = join(await realpath(root), file);
  await writeSchedulerProbeMarker(root, marker, 123);
  expect(JSON.parse(await readFile(marker, "utf8"))).toMatchObject({ ok: true, pid: 123 });
});
it("rejects another directory and unsupported names", async () => {
  const root = await directory(), nested = join(root, "nested"); await mkdir(nested);
  await expect(writeSchedulerProbeMarker(root, join(nested, file))).rejects.toThrow("路径无效");
  await expect(writeSchedulerProbeMarker(root, join(root, "grok-build-desktop-scheduler-probe-arbitrary.json"))).rejects.toThrow("路径无效");
});
it("never overwrites an existing marker", async () => {
  const root = await directory(), marker = join(root, file);
  await writeSchedulerProbeMarker(root, marker, 123);
  await expect(writeSchedulerProbeMarker(root, marker, 456)).rejects.toThrow();
  expect(JSON.parse(await readFile(marker, "utf8")).pid).toBe(123);
});
