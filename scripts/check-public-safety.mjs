#!/usr/bin/env node
/**
 * Cross-platform public-safety scan (Node port of check-public-safety.ps1).
 * Scans the working tree for local paths, real emails, and credential-like tokens.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join, relative, resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const excluded = new Set(["node_modules", ".git", "out", "release", "local", "coverage", "test-results", "playwright-report"]);
const textExt = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".yml", ".yaml", ".ps1", ".cs", ".html", ".css", ".toml", ".txt", ".svg"]);
const failures = [];
const home = homedir();
const user = userInfo().username;
const artifactPath = process.argv[2] || "";

const patterns = [
  { name: "当前用户主目录", re: new RegExp(escapeRegExp(home), "i") },
  { name: "非占位 Windows 用户路径", re: /[A-Z]:\\Users\\(?!TestUser(?:\\|$)|Public(?:\\|$)|Default(?:\\|$))[^\\/\r\n]+/i },
  { name: "旧本机代理", re: /127\.0\.0\.1:7897/ },
  { name: "真实邮箱", re: /\b[A-Z0-9._%+-]+@(?!example\.(?:com|invalid)\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
];
if (user && user.length >= 3) {
  patterns.push({ name: "当前用户名", re: new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(user)}(?![A-Za-z0-9_])`, "i") });
}

for await (const file of walk(root)) {
  const rel = relative(root, file).split(sep).join("/");
  const ext = extname(file).toLowerCase();
  if (!textExt.has(ext)) continue;
  let content;
  try {
    content = await readFile(file, "utf8");
  } catch {
    continue;
  }
  for (const pattern of patterns) {
    if (pattern.re.test(content) && !(rel === "package-lock.json" && pattern.name === "真实邮箱")) {
      failures.push(`${rel}：${pattern.name}`);
    }
  }
  if (!/\.test\.(ts|tsx)$/i.test(rel) && /\b(?:xai-|sk-)[A-Za-z0-9_-]{16,}\b/i.test(content)) {
    failures.push(`${rel}：疑似真实 API Key`);
  }
}

for (const forbidden of ["app.local.json", ".env", "auth.json", "accounts.vault"]) {
  try {
    await stat(join(root, forbidden));
    failures.push(`禁止提交的本地文件存在：${forbidden}`);
  } catch {
    /* absent */
  }
}

if (artifactPath) {
  const candidate = resolve(root, artifactPath);
  if (!candidate.startsWith(root)) throw new Error("构建产物路径必须位于仓库内。");
  const needles = [home.toLowerCase(), user ? `/Users/${user}`.toLowerCase() : ""].filter(Boolean);
  for await (const file of walk(candidate)) {
    const name = file.split(sep).at(-1) || "";
    if (name === "builder-debug.yml" || name === "builder-effective-config.yaml") continue;
    const buf = await readFile(file).catch(() => null);
    if (!buf) continue;
    const lower = buf.toString("utf8").toLowerCase();
    if (needles.some((needle) => lower.includes(needle))) failures.push(`构建产物包含本机构建路径：${name}`);
  }
}

if (failures.length) {
  console.error("公开安全扫描失败：");
  for (const row of failures) console.error(`  - ${row}`);
  process.exit(1);
}
console.log("公开安全扫描通过。");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (excluded.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}
