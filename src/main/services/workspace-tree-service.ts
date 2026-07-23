import { createHash } from "node:crypto";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { basename, relative, sep } from "node:path";
import type { WorkspaceTreeNode, WorkspaceTreeOptions } from "../../shared/types";
import { rejectSymbolicLink, resolveExistingWorkspacePath } from "./workspace-path-policy";

const HARD_IGNORES = new Set([".git", "node_modules", "out", "release", "dist", "build", "coverage", ".next", ".cache", "target"]);

export class WorkspaceTreeService {
  async list(workspacePath: string, directoryPath = "", options: WorkspaceTreeOptions = {}): Promise<WorkspaceTreeNode[]> {
    const resolved = await resolveExistingWorkspacePath(workspacePath, directoryPath, true);
    await rejectSymbolicLink(resolved.path);
    if (!(await stat(resolved.path)).isDirectory()) throw new Error("请求的路径不是目录");
    const ignores = await readIgnoreRules(resolved.root);
    const rows = await readdir(resolved.path, { withFileTypes: true });
    const output: WorkspaceTreeNode[] = [];
    for (const row of rows) {
      const relativePath = relative(resolved.root, `${resolved.path}${sep}${row.name}`).split(sep).join("/");
      const hardIgnored = HARD_IGNORES.has(row.name.toLowerCase());
      const ignored = hardIgnored || isIgnored(relativePath, row.isDirectory(), ignores);
      const hidden = row.name.startsWith(".");
      if (ignored && !options.showIgnored) continue;
      if (hidden && !options.showHidden && !ignored) continue;
      const path = `${resolved.path}${sep}${row.name}`;
      const info = await lstat(path).catch(() => undefined);
      if (!info) continue;
      output.push({
        id: createHash("sha256").update(relativePath).digest("hex").slice(0, 20),
        path,
        relativePath,
        name: basename(path),
        kind: info.isSymbolicLink() ? "symlink" : info.isDirectory() ? "directory" : "file",
        ...(info.isFile() ? { size: info.size } : {}),
        modifiedAt: info.mtime.toISOString(),
        hidden,
        ignored,
        readOnly: info.isSymbolicLink(),
      });
    }
    return output.sort((left, right) => {
      const leftRank = left.kind === "directory" ? 0 : left.kind === "file" ? 1 : 2;
      const rightRank = right.kind === "directory" ? 0 : right.kind === "file" ? 1 : 2;
      return leftRank - rightRank || left.name.localeCompare(right.name, "zh-CN", { sensitivity: "base", numeric: true });
    });
  }
}

interface IgnoreRule { pattern: RegExp; negated: boolean }

async function readIgnoreRules(root: string): Promise<IgnoreRule[]> {
  const raw = await readFile(`${root}${sep}.gitignore`, "utf8").catch(() => "");
  return raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")).map((line) => {
    const negated = line.startsWith("!");
    return { pattern: globToRegex(negated ? line.slice(1) : line), negated };
  });
}

function isIgnored(path: string, directory: boolean, rules: IgnoreRule[]): boolean {
  const value = directory ? `${path}/` : path;
  let ignored = false;
  for (const rule of rules) if (rule.pattern.test(value)) ignored = !rule.negated;
  return ignored;
}

function globToRegex(pattern: string): RegExp {
  let value = pattern.replace(/\\/g, "/");
  const anchored = value.startsWith("/");
  if (anchored) value = value.slice(1);
  const directory = value.endsWith("/");
  if (directory) value = value.slice(0, -1);
  const escaped = value.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\0").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\0/g, ".*");
  return new RegExp(`${anchored ? "^" : "(?:^|/)"}${escaped}${directory ? "(?:/|$)" : "$"}`, "i");
}
