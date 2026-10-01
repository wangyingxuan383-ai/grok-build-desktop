import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, rm, stat } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import type { OwnedMediaFile } from "../../shared/types";

const identity = (path: string): string => process.platform === "win32" ? path.toLowerCase() : path;
const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return Boolean(rel) && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\") && !isAbsolute(rel);
};
async function digest(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/** Called only after a tool result was validated and copied by main. */
export async function recordOwnedMediaFile(path: string, root: string): Promise<OwnedMediaFile> {
  const [canonical, canonicalRoot] = await Promise.all([realpath(path), realpath(root)]);
  if (!inside(canonicalRoot, canonical) || !(await stat(canonical)).isFile()) throw new Error("媒体文件不属于已确认的产物目录");
  return { path: canonical, root: canonicalRoot, sha256: await digest(canonical) };
}

/** Exact files only. Changed content, escaped junctions and shared outputs are retained. */
export async function removeProvenMediaFiles(files: readonly OwnedMediaFile[], protectedPaths: ReadonlySet<string> = new Set()): Promise<{ removed: number; keptFiles: string[] }> {
  const result = { removed: 0, keptFiles: [] as string[] };
  const protectedIds = new Set([...protectedPaths].map(identity));
  const seen = new Set<string>();
  const verified: string[] = [];
  for (const file of files) {
    if (seen.has(identity(file.path))) continue;
    seen.add(identity(file.path));
    try {
      if (!isAbsolute(file.path) || !isAbsolute(file.root) || !/^[0-9a-f]{64}$/i.test(file.sha256)) throw new Error("产物归属未确认");
      const canonical = await realpath(file.path);
      const root = await realpath(file.root);
      if (identity(canonical) !== identity(file.path) || identity(root) !== identity(file.root) || !inside(root, canonical)
        || protectedIds.has(identity(canonical)) || !(await stat(canonical)).isFile() || await digest(canonical) !== file.sha256) throw new Error("文件已改变或仍被其他产物使用");
      verified.push(canonical);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") result.keptFiles.push(file.path);
    }
  }
  // Preflight all proofs before unlinking any: a modified saved copy must not
  // leave its still-visible record pointing at an already-deleted preview.
  if (result.keptFiles.length) return result;
  for (const path of verified) {
    try { await rm(path); result.removed++; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") result.keptFiles.push(path); }
  }
  return result;
}
