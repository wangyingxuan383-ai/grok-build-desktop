import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readCliBinaryIdentity } from "./cli-binary-identity";
it("separates equal-version executables and refreshes replaced bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "grok-cli-identity-"));
  const a = join(root, "a.exe"), b = join(root, "b.exe");
  await writeFile(a, "first"); await writeFile(b, "first");
  const first = await readCliBinaryIdentity(a, "1.0.60 (build)");
  const other = await readCliBinaryIdentity(b, "1.0.60");
  expect(first.sha256).toBe(other.sha256);
  expect(first.key).not.toBe(other.key);
  await writeFile(a, "replacement-binary");
  expect((await readCliBinaryIdentity(a, "1.0.60")).key).not.toBe(first.key);
  expect((await readCliBinaryIdentity(a, "1.0.60", true)).version).toBe("1.0.60");
});
