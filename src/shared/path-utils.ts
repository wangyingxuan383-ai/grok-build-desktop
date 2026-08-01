/**
 * Cross-platform filesystem path helpers.
 *
 * Session catalogs, media artifacts and plan gates may receive Windows-style
 * paths (drive letters, backslashes) even when the desktop host runs on macOS
 * or Linux — for example when replaying fixtures or reading mixed-origin data.
 * These helpers pick win32 or posix semantics based on the path shape, not only
 * on process.platform.
 */
import path from "node:path";

const WIN_ABS = /^[A-Za-z]:[\\/]/;
const WIN_UNC = /^\\\\[^\\]+\\/;

export function isWindowsStylePath(value: string): boolean {
  return WIN_ABS.test(value) || WIN_UNC.test(value) || value.includes("\\");
}

function apiFor(...values: string[]): path.PlatformPath {
  if (process.platform === "win32") return path.win32;
  if (values.some((value) => WIN_ABS.test(value) || WIN_UNC.test(value) || (value.includes("\\") && !value.startsWith("/")))) {
    return path.win32;
  }
  return path.posix;
}

/** Strip extended-length prefix and normalize separators for the chosen API. */
export function normalizeComparablePath(value: string): string {
  const stripped = value.replace(/^\\\\\?\\/, "");
  const api = apiFor(stripped);
  // path.normalize keeps drive letters with win32 and collapses . / ..
  const normalized = api.normalize(stripped);
  return api.isAbsolute(normalized) || process.platform === "win32"
    ? normalized
    : normalized;
}

export function resolvePath(base: string, ...parts: string[]): string {
  const api = apiFor(base, ...parts);
  return api.resolve(base, ...parts);
}

export function relativePath(from: string, to: string): string {
  const api = apiFor(from, to);
  return api.relative(normalizeComparablePath(from), normalizeComparablePath(to));
}

/**
 * True when `candidate` is the same as `root` or a descendant.
 * Windows-style paths compare case-insensitively.
 */
export function pathWithin(candidate: string, root: string): boolean {
  const api = apiFor(candidate, root);
  const from = normalizeComparablePath(root);
  const to = normalizeComparablePath(candidate);
  const left = api === path.win32 ? from.toLowerCase() : from;
  const right = api === path.win32 ? to.toLowerCase() : to;
  const rel = api.relative(left, right);
  return rel === "" || (!rel.startsWith("..") && !api.isAbsolute(rel));
}

export function samePath(left: string, right: string): boolean {
  const api = apiFor(left, right);
  const a = normalizeComparablePath(left).replace(/[\\/]+$/, "");
  const b = normalizeComparablePath(right).replace(/[\\/]+$/, "");
  return api === path.win32 ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Join with the API implied by the first absolute / Windows-style segment. */
export function joinPath(...parts: string[]): string {
  const api = apiFor(...parts);
  return api.join(...parts);
}
