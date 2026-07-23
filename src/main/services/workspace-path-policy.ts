import { lstat, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export interface ResolvedWorkspacePath {
  root: string;
  path: string;
  relativePath: string;
}

export async function resolveWorkspaceRoot(workspacePath: string): Promise<string> {
  if (!workspacePath || !isAbsolute(workspacePath) || workspacePath.includes("\0")) throw new Error("工作区路径无效");
  const resolved = resolve(workspacePath);
  const canonical = await realpath(resolved).catch(() => undefined);
  if (!canonical || !(await stat(canonical).then((value) => value.isDirectory()).catch(() => false))) throw new Error("工作区路径无效");
  return canonical;
}

export async function resolveExistingWorkspacePath(workspacePath: string, requestedPath: string, allowRoot = true): Promise<ResolvedWorkspacePath> {
  const root = await resolveWorkspaceRoot(workspacePath);
  const lexical = lexicalWorkspacePath(root, requestedPath, allowRoot);
  const canonical = await realpath(lexical.path).catch(() => undefined);
  if (!canonical) throw new Error("文件或目录不存在");
  assertInside(root, canonical, allowRoot);
  return { root, path: canonical, relativePath: toRelative(root, lexical.path) };
}

export async function resolveNewWorkspacePath(workspacePath: string, requestedPath: string): Promise<ResolvedWorkspacePath> {
  const root = await resolveWorkspaceRoot(workspacePath);
  const lexical = lexicalWorkspacePath(root, requestedPath, false);
  const parent = resolve(lexical.path, "..");
  const canonicalParent = await realpath(parent).catch(() => undefined);
  if (!canonicalParent) throw new Error("目标父目录不存在");
  assertInside(root, canonicalParent, true);
  if (!(await stat(canonicalParent).then((value) => value.isDirectory()).catch(() => false))) throw new Error("目标父路径不是目录");
  const candidate = resolve(canonicalParent, lexical.path.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
  assertInside(root, candidate, false);
  return { root, path: candidate, relativePath: toRelative(root, candidate) };
}

export async function rejectSymbolicLink(path: string): Promise<void> {
  if ((await lstat(path)).isSymbolicLink()) throw new Error("不允许通过符号链接执行此操作");
}

export function isPathInside(root: string, path: string, allowRoot = true): boolean {
  const value = relative(root, path);
  if (!value) return allowRoot;
  return value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

function lexicalWorkspacePath(root: string, requestedPath: string, allowRoot: boolean): ResolvedWorkspacePath {
  if (requestedPath.includes("\0")) throw new Error("路径包含无效字符");
  const path = resolve(root, requestedPath || ".");
  assertInside(root, path, allowRoot);
  return { root, path, relativePath: toRelative(root, path) };
}

function assertInside(root: string, path: string, allowRoot: boolean): void {
  const comparableRoot = normalizeCase(resolve(root));
  const comparablePath = normalizeCase(resolve(path));
  if (!isPathInside(comparableRoot, comparablePath, allowRoot)) throw new Error("路径超出当前工作区");
}

function toRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function normalizeCase(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}
