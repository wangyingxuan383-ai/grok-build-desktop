import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";

export interface CliBinaryIdentity { key: string; pathFingerprint: string; version?: string; sha256: string }
const hashes = new Map<string, { stamp: string; hash: Promise<string> }>();

/** Hash only a changed binary. Never cache an unreadable or concurrently replaced file. */
export async function readCliBinaryIdentity(path: string, version?: string, force = false): Promise<CliBinaryIdentity> {
  const canonical = await realpath(resolve(path));
  const pathKey = process.platform === "win32" ? canonical.toLowerCase() : canonical;
  const stampOf = async (): Promise<string> => {
    const file = await stat(canonical);
    if (!file.isFile()) throw new Error("CLI is not a file");
    return [file.dev, file.ino, file.size, file.mtimeMs, file.ctimeMs].join(":");
  };
  const stamp = await stampOf();
  let entry = hashes.get(pathKey);
  if (!entry || entry.stamp !== stamp || force) {
    const hash = (async () => {
      const digest = createHash("sha256");
      for await (const chunk of createReadStream(canonical)) digest.update(chunk);
      if (await stampOf() !== stamp) throw new Error("CLI changed during identity detection");
      return digest.digest("hex");
    })();
    entry = { stamp, hash };
    hashes.set(pathKey, entry);
    if (hashes.size > 16) hashes.delete(hashes.keys().next().value!);
    const captured = entry;
    void hash.catch(() => { if (hashes.get(pathKey) === captured) hashes.delete(pathKey); });
  }
  const sha256 = await entry.hash;
  const pathFingerprint = createHash("sha256").update(pathKey).digest("hex");
  const normalizedVersion = version?.match(/\d+\.\d+\.\d+/)?.[0];
  return { key: `${pathFingerprint}:${normalizedVersion ?? "unknown"}:${sha256}`, pathFingerprint, version: normalizedVersion, sha256 };
}
