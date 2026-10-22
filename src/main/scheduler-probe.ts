import { realpath, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

/** Resolve Windows long/8.3 aliases without allowing arbitrary marker writes. */
export async function writeSchedulerProbeMarker(tempDirectory: string, requestedMarker: string, pid = process.pid): Promise<void> {
  const marker = resolve(requestedMarker);
  if (!/^grok-build-desktop-scheduler-probe-[a-f0-9]{32}\.json$/i.test(basename(marker))) throw new Error("计划任务探针路径无效");
  const [tempRoot, parent] = await Promise.all([realpath(tempDirectory), realpath(dirname(marker))]);
  const same = process.platform === "win32" ? parent.toLowerCase() === tempRoot.toLowerCase() : parent === tempRoot;
  if (!same) throw new Error("计划任务探针路径无效");
  await writeFile(marker, JSON.stringify({ ok: true, pid, at: new Date().toISOString() }), { encoding: "utf8", flag: "wx" });
}
