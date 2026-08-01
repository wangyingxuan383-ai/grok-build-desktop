import { createHash } from "node:crypto";
import { readdir, realpath, rm, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;

export interface MediaCacheSweepResult {
  removedOrphanDirectories: number;
  removedFiles: number;
  bytesBefore: number;
  bytesAfter: number;
}

/**
 * Removes media directories whose Grok session no longer exists, then applies
 * a global oldest-first capacity bound. Directory names are hashes, so neither
 * session IDs nor media paths enter diagnostics.
 */
export async function sweepSessionMediaCache(
  root: string,
  sessionIds: ReadonlySet<string>,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<MediaCacheSweepResult> {
  const valid = new Set([...sessionIds].map(sessionCacheKey));
  const directories = await readdir(root, { withFileTypes: true }).catch(() => []);
  let removedOrphanDirectories = 0;
  let removedFiles = 0;
  let bytesBefore = 0;
  const files: Array<{ path: string; size: number; mtimeMs: number }> = [];

  for (const directory of directories) {
    const path = join(root, directory.name);
    if (!directory.isDirectory() || !valid.has(directory.name)) {
      await rm(path, { recursive: true, force: true });
      removedOrphanDirectories += 1;
      continue;
    }
    const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const filePath = join(path, entry.name);
      if (!entry.isFile()) {
        await rm(filePath, { recursive: true, force: true });
        continue;
      }
      const info = await stat(filePath).catch(() => undefined);
      if (!info?.isFile()) continue;
      bytesBefore += info.size;
      files.push({ path: filePath, size: info.size, mtimeMs: info.mtimeMs });
    }
  }

  let bytesAfter = bytesBefore;
  if (bytesAfter > maxBytes) {
    files.sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path));
    for (const file of files) {
      if (bytesAfter <= maxBytes) break;
      await rm(file.path, { force: true });
      bytesAfter -= file.size;
      removedFiles += 1;
    }
  }

  return { removedOrphanDirectories, removedFiles, bytesBefore, bytesAfter };
}

export function sessionCacheKey(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
}

/**
 * Resolve a CLI-produced artifact only when it belongs to one of the exact
 * roots owned by the current media job. A headless Grok invocation writes to
 * its transient ~/.grok session, not the workspace cwd, so callers must pass
 * that one transient session directory explicitly rather than broadening the
 * policy to all files under the user profile.
 */
export async function resolveTrustedMediaArtifactSource(
  source: string,
  trustedRoots: readonly string[],
): Promise<string | undefined> {
  const canonicalSource = await realpath(source).catch(() => undefined);
  if (!canonicalSource) return undefined;
  for (const root of trustedRoots) {
    const canonicalRoot = await realpath(root).catch(() => undefined);
    if (!canonicalRoot) continue;
    const child = relative(canonicalRoot, canonicalSource);
    if (child === "" || (!child.startsWith("..") && child !== ".." && !/^([A-Za-z]:)?[\\/]/.test(child))) return canonicalSource;
  }
  return undefined;
}
