import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

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
  let verifiedFiles = 0;
  for (const entry of manifest.entries) {
    const path = resolve(root, ...entry.path.split("/"));
    if (path !== root && !path.startsWith(`${root}${sep}`)) {
      diagnostics.push(`资源路径越界：${entry.path}`);
      continue;
    }
    try {
      const info = statSync(path);
      const bytes = readFileSync(path);
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (!info.isFile() || info.size !== entry.size || hash !== entry.sha256) diagnostics.push(`资源校验失败：${entry.path}`);
      else verifiedFiles++;
    } catch {
      diagnostics.push(`资源缺失：${entry.path}`);
    }
  }
  return { ok: diagnostics.length === 0, diagnostics, verifiedFiles };
}

function safeMessage(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value.replace(/[A-Za-z]:\\Users\\[^\\\s]+/gi, "%USERPROFILE%");
}
