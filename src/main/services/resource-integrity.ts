import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

interface ResourceManifest {
  version: number;
  entries: Array<{ path: string; size: number; sha256: string }>;
}

export interface ResourceIntegrityResult {
  ok: boolean;
  diagnostics: string[];
  verifiedFiles: number;
}

export function verifyResourceManifest(resourcesRoot: string, required: boolean): ResourceIntegrityResult {
  const manifestPath = resolve(resourcesRoot, "resource-manifest.json");
  let manifest: ResourceManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ResourceManifest;
  } catch (error) {
    return required
      ? { ok: false, diagnostics: [`资源清单缺失或无效：${safeMessage(error)}`], verifiedFiles: 0 }
      : { ok: true, diagnostics: ["开发构建未提供资源清单"], verifiedFiles: 0 };
  }
  if (manifest.version !== 1 || !Array.isArray(manifest.entries) || !manifest.entries.length) return { ok: false, diagnostics: ["资源清单版本或内容无效"], verifiedFiles: 0 };
  const root = resolve(resourcesRoot);
  const diagnostics: string[] = [];
  const declaredPaths = new Set<string>();
  let verifiedFiles = 0;
  for (const entry of manifest.entries) {
    declaredPaths.add(entry.path);
    const path = resolve(root, ...entry.path.split("/"));
    if (path !== root && !path.startsWith(`${root}${sep}`)) {
      diagnostics.push(`资源路径越界：${entry.path}`);
      continue;
    }
    try {
      const info = lstatSync(path);
      if (info.isSymbolicLink() || !info.isFile()) {
        diagnostics.push(`资源类型无效：${entry.path}`);
        continue;
      }
      const bytes = readFileSync(path);
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (info.size !== entry.size || hash !== entry.sha256) diagnostics.push(`资源校验失败：${entry.path}`);
      else verifiedFiles++;
    } catch {
      diagnostics.push(`资源缺失：${entry.path}`);
    }
  }
  for (const guardedSubdir of ["plugins", "native"]) {
    const dir = join(root, guardedSubdir);
    if (!existsSync(dir)) continue;
    scanUnlistedFiles(root, dir, declaredPaths, diagnostics);
  }
  return { ok: diagnostics.length === 0, diagnostics, verifiedFiles };
}

function scanUnlistedFiles(root: string, currentDir: string, declaredPaths: ReadonlySet<string>, diagnostics: string[]): void {
  let entries;
  try {
    const dirStat = lstatSync(currentDir);
    if (dirStat.isSymbolicLink()) {
      diagnostics.push(`未授权符号链接目录：${relative(root, currentDir).split(sep).join("/")}`);
      return;
    }
    entries = readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(currentDir, entry.name);
    const rel = relative(root, full).split(sep).join("/");
    try {
      const info = lstatSync(full);
      if (info.isSymbolicLink()) {
        diagnostics.push(`未授权符号链接资源：${rel}`);
      } else if (info.isDirectory()) {
        scanUnlistedFiles(root, full, declaredPaths, diagnostics);
      } else if (info.isFile() && !declaredPaths.has(rel)) {
        diagnostics.push(`发现未登记资源文件：${rel}`);
      }
    } catch {
      diagnostics.push(`无法校验资源项：${rel}`);
    }
  }
}

function safeMessage(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value.replace(/[A-Za-z]:\\Users\\[^\\\s]+/gi, "%USERPROFILE%");
}
