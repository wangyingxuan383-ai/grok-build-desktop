import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { basename, parse, resolve, sep } from "node:path";
import type { ProjectIdentity } from "../../shared/types";

/**
 * Produces the one project identity used by catalogs, drafts and navigation.
 * Existing paths are resolved through Windows reparse points. Missing paths
 * retain a stable lexical identity so they can still be hidden/restored.
 */
export async function resolveProjectIdentity(input: string): Promise<ProjectIdentity> {
  const displayPath = cleanDisplayPath(input);
  const lexicalPath = normalizeProjectPath(displayPath);
  const info = await stat(displayPath).catch(() => undefined);
  const exists = Boolean(info?.isDirectory());
  const canonicalPath = exists
    ? cleanDisplayPath(await realpath(displayPath).catch(() => lexicalPath))
    : lexicalPath;
  const comparisonPath = normalizeProjectPath(canonicalPath);
  return {
    id: `project-${createHash("sha256").update(comparisonPath).digest("hex").slice(0, 24)}`,
    displayPath,
    canonicalPath,
    comparisonPath,
    name: basename(canonicalPath) || canonicalPath,
    exists,
    ...(exists ? {} : { diagnostic: "路径不存在或当前不可访问" }),
  };
}

/** Windows project keys are case-insensitive and ignore trailing separators. */
export function normalizeProjectPath(input: string): string {
  const value = cleanDisplayPath(input);
  return value.toLocaleLowerCase();
}

function cleanDisplayPath(input: string): string {
  const resolved = resolve(input.trim() || ".");
  const root = parse(resolved).root;
  let value = resolved;
  while (value.length > root.length && (value.endsWith("\\") || value.endsWith("/"))) value = value.slice(0, -1);
  // Keep native separators in values shown to Windows APIs and the user.
  return sep === "\\" ? value.replace(/\//g, "\\") : value;
}
