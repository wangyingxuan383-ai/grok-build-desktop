import { realpath, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

export type TrustedPathKind = "file" | "directory" | "either";

/** Canonicalize a path without accepting a missing leaf or a symlink escape. */
export async function canonicalExistingPath(path: string, kind: TrustedPathKind = "either"): Promise<string> {
  const canonical = await realpath(path).catch(() => undefined);
  if (!canonical) throw new Error("目标路径不存在或无法读取");
  const info = await stat(canonical).catch(() => undefined);
  if (!info) throw new Error("目标路径不存在或无法读取");
  if (kind === "file" && !info.isFile()) throw new Error("目标路径不是文件");
  if (kind === "directory" && !info.isDirectory()) throw new Error("目标路径不是目录");
  if (kind === "either" && !info.isFile() && !info.isDirectory()) throw new Error("目标路径类型不受支持");
  return canonical;
}

/**
 * A renderer path is trusted only when it was explicitly issued by a native
 * picker/main-process cache, or resolves below a canonical workspace/session
 * root. `realpath` on both sides prevents `..`, symlink and junction escapes.
 */
export async function resolveTrustedRendererPath(
  requestedPath: string,
  options: {
    roots?: readonly string[];
    issuedPaths?: ReadonlySet<string>;
    kind?: TrustedPathKind;
  } = {},
): Promise<string> {
  const canonical = await canonicalExistingPath(requestedPath, options.kind);
  if (hasCanonicalPath(options.issuedPaths, canonical)) return canonical;
  for (const root of options.roots ?? []) {
    const canonicalRoot = await realpath(root).catch(() => undefined);
    if (canonicalRoot && pathInside(canonicalRoot, canonical)) return canonical;
  }
  throw new Error("目标路径未由文件选择器签发，且不属于当前会话或工作区");
}

export function pathInside(root: string, path: string): boolean {
  const value = relative(normalize(root), normalize(path));
  return value === "" || (value !== ".." && !value.startsWith(`..${sep}`) && !/^[A-Za-z]:[\\/]/.test(value));
}

export function rememberCanonicalPath(set: Set<string>, path: string, limit = 512): void {
  const normalized = normalize(resolve(path));
  set.delete(normalized);
  set.add(normalized);
  while (set.size > limit) {
    const oldest = set.values().next().value as string | undefined;
    if (!oldest) break;
    set.delete(oldest);
  }
}

export function hasCanonicalPath(set: ReadonlySet<string> | undefined, path: string): boolean {
  return Boolean(set?.has(normalize(resolve(path))));
}

function normalize(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}
