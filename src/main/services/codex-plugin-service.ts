import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import type { CodexPluginCompatibility, CodexPluginCompatibilityLevel } from "../../shared/types";
import type { LogService } from "./log-service";

interface Candidate {
  id: string;
  root: string;
  manifestPath: string;
  manifest: Record<string, unknown>;
}

export class CodexPluginService {
  private cache?: CodexPluginCompatibility[];
  private readonly adaptersRoot: string;

  constructor(userDataPath: string, private readonly log: LogService, private readonly codexRoot = join(homedir(), ".codex", "plugins")) {
    this.adaptersRoot = join(userDataPath, "codex-plugin-adapters");
  }

  async scan(force = false): Promise<CodexPluginCompatibility[]> {
    if (this.cache && !force) return this.cache;
    const manifests = await findManifests(this.codexRoot, 5);
    const candidates: Candidate[] = [];
    for (const manifestPath of manifests) {
      const root = manifestPath.endsWith(`${sep}.codex-plugin${sep}plugin.json`) ? resolve(manifestPath, "..", "..") : resolve(manifestPath, "..");
      const manifest = await readJson(manifestPath);
      const name = safeName(stringValue(manifest.name) || basename(root));
      if (!name) continue;
      candidates.push({ id: `${name}:${shortHash(root)}`, root, manifestPath, manifest });
    }
    const unique = new Map(candidates.map((value) => [value.root.toLocaleLowerCase(), value]));
    // Hashing a plugin tree is read-only but can be expensive for bundled plugins.
    // Run independent candidates concurrently so opening the lazy tab does not
    // serially block on every Codex plugin in the local cache.
    const results = await Promise.all([...unique.values()].map((candidate) => this.classify(candidate)));
    this.cache = results.sort((a, b) => a.name.localeCompare(b.name));
    return this.cache;
  }

  async adapt(id: string): Promise<CodexPluginCompatibility[]> {
    const item = (await this.scan()).find((value) => value.id === id);
    if (!item) throw new Error("Codex 插件不存在或已移动");
    if (item.level === "incompatible") throw new Error(item.reasons.join("；") || "此插件不能安全适配");
    const sourceRoot = resolve(item.sourcePath);
    if (!inside(this.codexRoot, sourceRoot)) throw new Error("插件源路径超出只读 Codex 插件目录");
    const target = join(this.adaptersRoot, safeName(item.name), item.sourceHash.slice(0, 12));
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });
    const skills = join(sourceRoot, "skills");
    if (await isDirectory(skills)) await cp(skills, join(target, "skills"), { recursive: true, dereference: false, filter: (_source) => inside(sourceRoot, resolve(_source)) });
    for (const name of [".mcp.json", "mcp.json", "LICENSE", "LICENSE.md", "NOTICE"]) {
      const source = join(sourceRoot, name);
      if (await isFile(source)) await cp(source, join(target, name), { dereference: false });
    }
    await writeFile(join(target, "plugin.json"), JSON.stringify({
      name: `codex-adapter-${safeName(item.name)}`,
      version: item.version || "0.0.0",
      description: `Read-only compatibility copy of ${item.name}`,
      license: stringValue((await readJson(join(sourceRoot, ".codex-plugin", "plugin.json"))).license) || undefined,
      _grokDesktop: { sourcePath: item.sourcePath, sourceHash: item.sourceHash, sourceVersion: item.version, adaptedAt: new Date().toISOString() },
    }, null, 2), "utf8");
    const adapterRoot = resolve(target, "..");
    for (const entry of await readdir(adapterRoot, { withFileTypes: true }).catch(() => [])) if (entry.isDirectory() && resolve(adapterRoot, entry.name) !== resolve(target)) await rm(resolve(adapterRoot, entry.name), { recursive: true, force: true });
    await this.log.log(`created Codex plugin adapter ${item.id} hash=${item.sourceHash.slice(0, 12)}`);
    this.cache = undefined;
    return this.scan(true);
  }

  async removeAdapter(id: string): Promise<CodexPluginCompatibility[]> {
    const item = (await this.scan()).find((value) => value.id === id);
    if (!item?.adapterPath) return this.scan();
    const path = resolve(item.adapterPath);
    if (!inside(this.adaptersRoot, path)) throw new Error("适配副本路径无效");
    await rm(path, { recursive: true, force: true });
    this.cache = undefined;
    return this.scan(true);
  }

  private async classify(candidate: Candidate): Promise<CodexPluginCompatibility> {
    const entries = await readdir(candidate.root, { withFileTypes: true }).catch(() => []);
    const names = new Set(entries.map((entry) => entry.name.toLocaleLowerCase()));
    const skillsRoot = join(candidate.root, "skills");
    const skills = await readdir(skillsRoot, { withFileTypes: true }).then((rows) => rows.filter((row) => row.isDirectory()).map((row) => row.name)).catch(() => []);
    const hasMcp = names.has(".mcp.json") || names.has("mcp.json") || Boolean(candidate.manifest.mcpServers);
    const hasApps = names.has("apps") || names.has("app-templates") || Boolean(candidate.manifest.apps);
    const hasNative = names.has("native") || names.has("bin") || Boolean(candidate.manifest.repl);
    const isComputerUse = /computer[-_ ]?use/i.test(stringValue(candidate.manifest.name) || candidate.root);
    const reasons: string[] = [];
    let level: CodexPluginCompatibilityLevel = "adaptable";
    if (isComputerUse) { level = "incompatible"; reasons.push("依赖 Codex 专有 Computer Use 宿主和授权通道；请使用内置 Grok Computer Use"); }
    if (hasApps) { level = "incompatible"; reasons.push("包含 Codex Apps 或 App Templates"); }
    if (hasNative) { level = "incompatible"; reasons.push("包含可信 REPL、原生宿主或可执行组件"); }
    if (level !== "incompatible" && hasMcp) { level = "partial"; reasons.push("MCP 需要重新填写环境变量或完成认证"); }
    if (!skills.length && !hasMcp && level !== "incompatible") { level = "incompatible"; reasons.push("没有可适配的 Skill 或标准 MCP 配置"); }
    if (!reasons.length) reasons.push("纯 Skill/资源组件可复制为独立 Grok 适配副本");
    const sourceHash = await hashTree(candidate.root);
    const adapterRoot = join(this.adaptersRoot, safeName(stringValue(candidate.manifest.name) || basename(candidate.root)));
    const adapterBase = join(adapterRoot, sourceHash.slice(0, 12));
    const currentAdapter = await isDirectory(adapterBase) ? adapterBase : undefined;
    const previousAdapters = await readdir(adapterRoot, { withFileTypes: true }).then((rows) => rows.filter((row) => row.isDirectory()).map((row) => join(adapterRoot, row.name))).catch(() => []);
    const adapterPath = currentAdapter || previousAdapters[0];
    return {
      id: candidate.id,
      name: stringValue(candidate.manifest.name) || basename(candidate.root),
      version: stringValue(candidate.manifest.version) || undefined,
      sourcePath: candidate.root,
      sourceHash,
      level,
      reasons,
      skills,
      hasStandardMcp: hasMcp,
      adapterPath,
      adapterStale: Boolean(adapterPath && !currentAdapter),
    };
  }
}

async function findManifests(root: string, depth: number): Promise<string[]> {
  if (depth < 0 || !await isDirectory(root)) return [];
  const output: string[] = [];
  const rows = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const row of rows) {
    if (row.isSymbolicLink()) continue;
    const path = join(root, row.name);
    if (row.isFile() && row.name === "plugin.json" && (basename(resolve(path, "..")) === ".codex-plugin" || await isDirectory(join(resolve(path, ".."), "skills")))) output.push(path);
    else if (row.isDirectory()) output.push(...await findManifests(path, depth - 1));
  }
  return output;
}

async function hashTree(root: string): Promise<string> {
  const hash = createHash("sha256");
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth < 0) return;
    const rows = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const row of rows.sort((a, b) => a.name.localeCompare(b.name))) {
      if (row.isSymbolicLink()) continue;
      const path = join(dir, row.name); hash.update(path.slice(root.length));
      if (row.isDirectory()) await walk(path, depth - 1);
      else if (row.isFile()) hash.update(await readFile(path).catch(() => Buffer.alloc(0)));
    }
  };
  await walk(root, 6); return hash.digest("hex");
}

function inside(root: string, target: string): boolean { const base = resolve(root).toLocaleLowerCase(); const path = resolve(target).toLocaleLowerCase(); return path === base || path.startsWith(`${base}${sep}`); }
function safeName(value: string): string { return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80); }
function shortHash(value: string): string { return createHash("sha256").update(value.toLocaleLowerCase()).digest("hex").slice(0, 12); }
function stringValue(value: unknown): string { return typeof value === "string" ? value : ""; }
async function readJson(path: string): Promise<Record<string, unknown>> { try { return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>; } catch { return {}; } }
async function isDirectory(path: string): Promise<boolean> { return stat(path).then((value) => value.isDirectory()).catch(() => false); }
async function isFile(path: string): Promise<boolean> { return stat(path).then((value) => value.isFile()).catch(() => false); }
