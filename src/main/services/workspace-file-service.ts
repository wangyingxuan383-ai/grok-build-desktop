import { readFile, readdir, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import type { WorkspaceFileCandidate } from "../../shared/types";

const HARD_IGNORES = new Set([".git", "node_modules", "out", "release", "dist", "build", "coverage", ".next", ".cache", "target"]);
const MAX_FILES = 20_000;
const MAX_INDEXED_SIZE = 10 * 1024 * 1024;

interface CacheEntry { at: number; files: WorkspaceFileCandidate[] }

export class WorkspaceFileService {
  private readonly cache = new Map<string, CacheEntry>();

  async search(cwd: string, query: string, limit = 12): Promise<WorkspaceFileCandidate[]> {
    const root = resolve(cwd);
    if (!isAbsolute(cwd) || !(await stat(root).then((value) => value.isDirectory()).catch(() => false))) throw new Error("工作区路径无效");
    const key = process.platform === "win32" ? root.toLowerCase() : root;
    let entry = this.cache.get(key);
    if (!entry || Date.now() - entry.at > 60_000) {
      entry = { at: Date.now(), files: await indexWorkspace(root) };
      this.cache.set(key, entry);
    }
    const needle = normalize(query);
    return entry.files
      .map((file) => ({ ...file, score: fuzzyScore(normalize(file.relativePath), needle) }))
      .filter((file) => !needle || file.score > 0)
      .sort((left, right) => right.score - left.score || left.relativePath.length - right.relativePath.length || left.relativePath.localeCompare(right.relativePath, "zh-CN"))
      .slice(0, Math.max(1, Math.min(50, limit)));
  }

  invalidate(cwd?: string): void {
    if (!cwd) this.cache.clear();
    else this.cache.delete(process.platform === "win32" ? resolve(cwd).toLowerCase() : resolve(cwd));
  }
}

async function indexWorkspace(root: string): Promise<WorkspaceFileCandidate[]> {
  const rules = await readIgnoreRules(root);
  const files: WorkspaceFileCandidate[] = [];
  const visit = async (directory: string): Promise<void> => {
    if (files.length >= MAX_FILES) return;
    const rows = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const row of rows) {
      if (files.length >= MAX_FILES) break;
      if (row.isSymbolicLink()) continue;
      const path = resolve(directory, row.name);
      const relativePath = relative(root, path).split(sep).join("/");
      if (row.isDirectory()) {
        if (HARD_IGNORES.has(row.name.toLowerCase()) || isIgnored(`${relativePath}/`, rules)) continue;
        await visit(path);
      } else if (row.isFile() && !isIgnored(relativePath, rules)) {
        const info = await stat(path).catch(() => undefined);
        if (!info || info.size > MAX_INDEXED_SIZE) continue;
        files.push({ path, relativePath, name: row.name, size: info.size, score: 0 });
      }
    }
  };
  await visit(root);
  return files;
}

async function readIgnoreRules(root: string): Promise<RegExp[]> {
  const raw = await readFile(resolve(root, ".gitignore"), "utf8").catch(() => "");
  return raw.split(/\r?\n/).map((value) => value.trim()).filter((value) => value && !value.startsWith("#") && !value.startsWith("!")).map(globToRegex);
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

function isIgnored(path: string, rules: RegExp[]): boolean { return rules.some((rule) => rule.test(path)); }
function normalize(value: string): string { return value.toLocaleLowerCase("zh-CN").replace(/\\/g, "/"); }

export function fuzzyScore(value: string, needle: string): number {
  if (!needle) return 1;
  const direct = value.indexOf(needle);
  if (direct >= 0) return 1_000 - direct * 2 - value.length * 0.01;
  let cursor = 0;
  let score = 0;
  let last = -2;
  for (const character of needle) {
    const index = value.indexOf(character, cursor);
    if (index < 0) return 0;
    score += index === last + 1 ? 8 : 2;
    if (index === 0 || value[index - 1] === "/" || value[index - 1] === "-" || value[index - 1] === "_") score += 5;
    cursor = index + 1;
    last = index;
  }
  return score - value.length * 0.01;
}
