import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import type {
  AppSettings,
  HookSummary,
  MarketplacePlugin,
  MarketplaceSource,
  McpDiagnostic,
  McpServerInput,
  McpServerSummary,
  PluginDetails,
  PluginInstallPreview,
  PluginSummary,
  SkillSummary,
} from "../../shared/types";
import { locateGrokCli } from "./cli-locator";
import type { LogService } from "./log-service";

type ExtensionRequest = (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown> | undefined>;

export class ExtensionService {
  private pluginsCache?: { at: number; value: PluginSummary[] };
  private marketplaceCache?: { at: number; value: MarketplaceSource[] };

  constructor(
    private readonly getSettings: () => Promise<AppSettings>,
    private readonly requestExtension: ExtensionRequest,
    private readonly log: LogService,
    private readonly storeMcpSecrets: (serverName: string, values: Record<string, string>) => Promise<Record<string, string>> = async () => ({}),
    private readonly removeMcpSecrets: (serverName: string) => Promise<void> = async () => undefined,
    private readonly reloadIdleSessions: () => Promise<number> = async () => 0,
  ) {}

  async listPlugins(force = false): Promise<PluginSummary[]> {
    if (!force && this.pluginsCache && Date.now() - this.pluginsCache.at < 30_000) return this.pluginsCache.value;
    let value: PluginSummary[] | undefined;
    try {
      const response = await this.requestExtension("x.ai/plugins/list");
      if (response) value = normalizePluginList(response);
    } catch (error) {
      await this.log.log(`extension plugins/list fallback: ${errorMessage(error)}`);
    }
    if (!value) value = normalizePluginList(await this.runJson(["plugin", "list", "--json"]));
    this.pluginsCache = { at: Date.now(), value };
    return value;
  }

  async details(id: string): Promise<PluginDetails> {
    const plugin = (await this.listPlugins()).find((value) => value.id === id || value.name === id);
    if (!plugin) throw new Error("插件不存在或尚未加载");
    let manifest: Record<string, unknown> | undefined;
    let license: string | undefined;
    if (plugin.path) {
      for (const candidate of [join(plugin.path, "plugin.json"), join(plugin.path, ".grok-plugin", "plugin.json")]) {
        const text = await readFile(candidate, "utf8").catch(() => "");
        if (text) { try { manifest = JSON.parse(text) as Record<string, unknown>; } catch { /* diagnostic-only */ } break; }
      }
      license = await firstText(plugin.path, ["LICENSE", "LICENSE.md", "NOTICE"]);
    }
    return {
      ...plugin,
      manifest,
      license,
      hooks: Array.from({ length: plugin.hookCount }, (_, index) => ({ name: `Hook ${index + 1}`, enabled: plugin.enabled })),
      mcpServers: Array.from({ length: plugin.mcpServerCount }, (_, index) => ({ name: `MCP ${index + 1}`, enabled: plugin.enabled })),
    };
  }

  async preview(source: string): Promise<PluginInstallPreview> {
    const safeSource = validatePluginSource(source);
    if (await stat(safeSource).then((value) => value.isDirectory()).catch(() => false)) return inspectLocalPlugin(safeSource);
    const parsed = parseGitSource(safeSource);
    const temp = await mkdtemp(join(tmpdir(), "grok-plugin-preview-"));
    const bare = join(temp, "repo.git");
    try {
      await execProgram("git", ["-c", "core.hooksPath=NUL", "clone", "--bare", "--filter=blob:none", "--depth", "1", parsed.cloneUrl, bare], 180_000);
      let commit = (await execProgram("git", ["-C", bare, "rev-parse", `${parsed.ref || "HEAD"}^{commit}`], 30_000).catch(() => "")).trim();
      if (!commit && parsed.ref) {
        await execProgram("git", ["-C", bare, "fetch", "--depth", "1", "origin", parsed.ref], 120_000);
        commit = (await execProgram("git", ["-C", bare, "rev-parse", "FETCH_HEAD^{commit}"], 30_000)).trim();
      }
      if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error("无法固定 Git 插件提交");
      return inspectGitPlugin(bare, commit, parsed.subdir, parsed.pinned(commit));
    } finally { await rm(temp, { recursive: true, force: true }); }
  }

  async action(id: string, action: "enable" | "disable" | "update" | "uninstall" | "reload"): Promise<PluginSummary[]> {
    if (action === "reload") {
      await this.reload();
      return this.listPlugins(true);
    }
    const allowed = new Set(["enable", "disable", "update", "uninstall"]);
    if (!allowed.has(action)) throw new Error("不支持的插件操作");
    let usedExtension = false;
    try {
      const actionValue: Record<string, unknown> = action === "update" ? { type: "update", plugin_id: id } : action === "uninstall" ? { type: "uninstall", plugin_id: id, confirmed: true } : { type: action, plugin_id: id };
      usedExtension = Boolean(await this.requestExtension("x.ai/plugins/action", { action: actionValue }));
    } catch (error) { await this.log.log(`plugins/action fallback: ${errorMessage(error)}`); }
    if (!usedExtension) await this.run(["plugin", action, id]);
    await this.reload().catch(() => undefined);
    this.clearCaches();
    return this.listPlugins(true);
  }

  async install(source: string, trust: boolean, expectedFingerprint?: string): Promise<PluginSummary[]> {
    const safeSource = validatePluginSource(source);
    if (!trust) throw new Error("安装前必须在确认界面明确授予信任");
    const preview = await this.preview(safeSource);
    if (!expectedFingerprint || preview.fingerprint !== expectedFingerprint) throw new Error("插件来源自确认后已变化；请重新检查并确认");
    await this.log.log(`plugin static preview name=${preview.name} commit=${preview.commit?.slice(0, 12) || "local"} skills=${preview.skills.length} hooks=${preview.hooks.length} mcp=${preview.mcpServers.length} executables=${preview.executableFiles.length}`);
    await this.run(["plugin", "install", safeSource, "--trust"], 180_000);
    await this.reload().catch(() => undefined);
    this.clearCaches();
    return this.listPlugins(true);
  }

  async listMarketplace(force = false): Promise<MarketplaceSource[]> {
    if (!force && this.marketplaceCache && Date.now() - this.marketplaceCache.at < 60_000) return this.marketplaceCache.value;
    let value: MarketplaceSource[] | undefined;
    try {
      const response = await this.requestExtension("x.ai/marketplace/list");
      if (response) value = normalizeMarketplace(response);
    } catch (error) {
      await this.log.log(`extension marketplace/list fallback: ${errorMessage(error)}`);
    }
    if (!value?.length) {
      value = normalizeMarketplace(await this.runJson(["plugin", "list", "--available", "--json"], 180_000));
      const inventory = await this.runJson(["plugin", "marketplace", "list", "--json"], 60_000).catch(() => undefined);
      value = enrichMarketplaceSources(value, inventory);
      value = await Promise.all(value.map(async (source) => {
        if (!source.urlOrPath || source.kind !== "git") return source;
        const line = await execProgram("git", ["ls-remote", source.urlOrPath, source.branch || "HEAD"], 20_000).catch(() => "");
        const commit = line.match(/^[0-9a-f]{40}/i)?.[0]; return { ...source, commit };
      }));
    }
    this.marketplaceCache = { at: Date.now(), value };
    return value;
  }

  async installMarketplace(source: string, name: string, trust: boolean): Promise<PluginSummary[]> {
    const catalog = await this.listMarketplace();
    const sourceEntry = catalog.find((value) => (value.name === source || value.urlOrPath === source) && value.plugins.some((plugin) => plugin.name === name));
    const entry = sourceEntry?.plugins.find((value) => value.name === name);
    if (!entry) throw new Error("市场插件不存在或目录已更新，请刷新后重试");
    if (!trust) throw new Error("安装市场插件前必须明确授予信任");
    if (sourceEntry?.urlOrPath && entry.relativePath) {
      try {
        const response = await this.requestExtension("x.ai/marketplace/action", { action: { type: "install", source_url_or_path: sourceEntry.urlOrPath, plugin_relative_path: entry.relativePath } });
        if (response) { await this.reload().catch(() => undefined); this.clearCaches(); return this.listPlugins(true); }
      } catch (error) { await this.log.log(`marketplace/action fallback: ${errorMessage(error)}`); }
    }
    await this.run(["plugin", "install", name, "--trust"], 180_000);
    await this.reload().catch(() => undefined);
    this.clearCaches();
    return this.listPlugins(true);
  }

  async listSkills(): Promise<SkillSummary[]> {
    const plugins = await this.listPlugins();
    return plugins.filter((plugin) => plugin.enabled).flatMap((plugin) => plugin.skills.map((name) => ({ name, source: plugin.name, command: `/${name}`, description: `由 ${plugin.name} 插件提供` })));
  }

  async listHooks(): Promise<HookSummary[]> {
    const plugins = await this.listPlugins();
    return plugins.flatMap((plugin) => Array.from({ length: plugin.hookCount }, (_, index) => ({
      id: `${plugin.id}:${index}`,
      name: `${plugin.name} Hook ${index + 1}`,
      pluginId: plugin.id,
      source: plugin.name,
      enabled: plugin.enabled,
    })));
  }

  async listMcp(force = false): Promise<McpServerSummary[]> {
    try {
      const response = await this.requestExtension("x.ai/mcp/list", { cache: !force });
      if (response) return normalizeMcpList(response);
    } catch (error) {
      await this.log.log(`extension mcp/list fallback: ${errorMessage(error)}`);
    }
    return normalizeMcpList(await this.runJson(["mcp", "list", "--json"]));
  }

  async diagnoseMcp(name?: string): Promise<McpDiagnostic[]> {
    const args = ["mcp", "doctor", ...(name ? [name] : []), "--json"];
    try {
      const value = await this.runJson(args, 60_000);
      return normalizeMcpDiagnostics(value, name);
    } catch (error) {
      return [{ name: name || "全部 MCP", ok: false, message: errorMessage(error), checkedAt: new Date().toISOString() }];
    }
  }

  async toggleMcp(name: string, enabled: boolean): Promise<McpServerSummary[]> {
    const response = await this.requestExtension("x.ai/mcp/toggle", { serverName: name, enabled });
    if (!response) throw new Error("当前没有空闲 Grok 会话；MCP 启停将在打开会话后可用");
    return this.listMcp(true);
  }

  async upsertMcp(input: McpServerInput): Promise<McpServerSummary[]> {
    const name = input.name.trim(); const command = input.commandOrUrl.trim();
    if (!/^[a-zA-Z0-9._-]{1,80}$/.test(name)) throw new Error("MCP 名称只能包含字母、数字、点、下划线和连字符");
    if (!command || /[\r\n\0]/.test(command)) throw new Error("MCP 命令或 URL 无效");
    if (input.transport !== "stdio" && !/^https?:\/\//i.test(command)) throw new Error("远程 MCP 必须使用 HTTP/HTTPS URL");
    const secretNames = await this.storeMcpSecrets(name, input.secretEnv);
    const args = ["mcp", "add", "--transport", input.transport];
    for (const [key, value] of Object.entries(input.env)) if (key && value) args.push("--env", `${key}=${value}`);
    for (const [key, envName] of Object.entries(secretNames)) args.push("--env", `${key}=\${${envName}}`);
    for (const [key, value] of Object.entries(input.headers)) if (key && value) args.push("--header", `${key}: ${value}`);
    args.push(name);
    if (input.transport === "stdio") args.push("--", command, ...input.args.filter((value) => value && !/[\r\n\0]/.test(value)));
    else args.push(command);
    try { await this.run(args); }
    catch (error) { await this.removeMcpSecrets(name); throw error; }
    await this.reload().catch(() => undefined);
    return this.listMcp(true);
  }

  async triggerMcpAuth(name: string): Promise<{ url?: string; code?: string; message?: string }> {
    const response = await this.requestExtension("x.ai/mcp/auth_trigger", { serverName: name });
    if (!response) throw new Error("需要先打开一个 Grok 会话才能启动 MCP OAuth");
    return { url: asString(response.url), code: asString(response.code), message: asString(response.error || response.status) };
  }

  async removeMcp(name: string): Promise<McpServerSummary[]> {
    const response = await this.requestExtension("x.ai/mcp/delete", { serverName: name });
    if (!response) await this.run(["mcp", "remove", name]);
    await this.removeMcpSecrets(name);
    return this.listMcp(true);
  }

  async reload(): Promise<void> {
    const response = await this.requestExtension("x.ai/plugins/reload").catch(() => undefined);
    if (!response) {
      const count = await this.reloadIdleSessions();
      await this.log.log(count ? `CLI 不支持插件热重载；已安全重启并恢复 ${count} 个空闲会话` : "当前没有需重载的实时会话；新会话会读取最新扩展配置");
    }
    this.clearCaches();
  }

  private clearCaches(): void { this.pluginsCache = undefined; this.marketplaceCache = undefined; }

  private async runJson(args: string[], timeout = 60_000): Promise<unknown> {
    const output = await this.run(args, timeout);
    try { return JSON.parse(output); } catch { throw new Error(`Grok CLI 返回了无效 JSON：${output.slice(0, 200)}`); }
  }

  private async run(args: string[], timeout = 60_000): Promise<string> {
    const settings = await this.getSettings();
    const cli = await locateGrokCli(settings.cliPath);
    if (!cli) throw new Error("未找到 Grok CLI");
    await this.log.log(`extension cli ${args.slice(0, 3).join(" ")}`);
    return new Promise((resolve, reject) => execFile(cli, args, { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || stdout || error.message).trim()));
      else resolve(String(stdout || stderr).trim());
    }));
  }
}

export function normalizePluginList(value: unknown): PluginSummary[] {
  const root = asRecord(value);
  const rows = Array.isArray(value) ? value : Array.isArray(root.plugins) ? root.plugins : [];
  return rows.map(asRecord).map((row) => {
    const origin = asRecord(row.origin);
    const id = asString(row.id) || asString(row.name);
    return {
      id,
      name: asString(row.name) || id,
      version: asString(row.version) || undefined,
      description: asString(row.description) || undefined,
      enabled: row.enabled === undefined ? asString(row.status) !== "disabled" : Boolean(row.enabled),
      trusted: row.trusted === undefined ? true : Boolean(row.trusted),
      scope: asString(row.scope) || undefined,
      path: asString(row.path || row.root || row.canonicalRoot) || undefined,
      source: asString(row.marketplaceSource || row.marketplace) || undefined,
      origin: asString(origin.kind || row.origin) || undefined,
      skills: stringArray(row.skillNames),
      commands: stringArray(row.commandNames),
      agents: stringArray(row.agentNames),
      hookCount: asNumber(row.hookCount) || (row.has_hooks ? 1 : 0),
      mcpServerCount: asNumber(row.mcpServerCount) || (row.has_mcp ? 1 : 0),
      conflict: asString(row.conflict) || undefined,
    };
  }).filter((row) => row.name);
}

export function normalizeMarketplace(value: unknown): MarketplaceSource[] {
  const root = asRecord(value);
  const sourceRows = Array.isArray(root.sources) ? root.sources : undefined;
  if (sourceRows) return sourceRows.map(asRecord).map((source) => {
    const sourceName = asString(source.sourceName || source.name) || "Marketplace";
    return {
      name: sourceName,
      kind: asString(source.sourceKind || source.kind) || "unknown",
      urlOrPath: asString(source.sourceUrlOrPath || source.urlOrPath) || "",
      error: asString(source.error) || undefined,
      plugins: (Array.isArray(source.plugins) ? source.plugins : []).map((row) => normalizeMarketplacePlugin(asRecord(row), sourceName)),
    };
  });
  const rows = Array.isArray(value) ? value.map(asRecord) : [];
  const groups = new Map<string, MarketplacePlugin[]>();
  for (const row of rows) {
    const source = asString(row.marketplace) || "Marketplace";
    const list = groups.get(source) ?? [];
    list.push(normalizeMarketplacePlugin(row, source)); groups.set(source, list);
  }
  return Array.from(groups, ([name, plugins]) => ({ name, kind: "catalog", urlOrPath: "", plugins }));
}

export function enrichMarketplaceSources(catalog: MarketplaceSource[], value: unknown): MarketplaceSource[] {
  const rows = (Array.isArray(value) ? value : Array.isArray(asRecord(value).sources) ? asRecord(value).sources as unknown[] : []).map(asRecord);
  return catalog.map((source) => {
    const match = rows.find((row) => asString(row.name) === source.name); if (!match) return source;
    const descriptor = asRecord(match.source);
    return { ...source, kind: asString(match.kind) || source.kind, urlOrPath: asString(descriptor.url || descriptor.path || match.urlOrPath) || source.urlOrPath, branch: asString(descriptor.branch) || undefined };
  });
}

function normalizeMarketplacePlugin(row: Record<string, unknown>, source: string): MarketplacePlugin {
  const components = asRecord(row.components);
  return {
    id: asString(row.id) || `${source}:${asString(row.name)}`,
    name: asString(row.name), description: asString(row.description) || undefined, version: asString(row.version) || undefined,
    source, official: /xai|x\.ai/i.test(source), installed: asString(row.status) === "installed" || Boolean(row.installed), commit: asString(row.commit) || undefined,
    relativePath: asString(row.relativePath) || undefined,
    components: {
      skills: itemNames(components.skills), commands: itemNames(components.commands), agents: itemNames(components.agents),
      hooks: Array.isArray(components.hooks) ? components.hooks.length : 0,
      mcpServers: Array.isArray(components.mcpServers) ? components.mcpServers.length : 0,
    },
  };
}

export function normalizeMcpList(value: unknown): McpServerSummary[] {
  const root = asRecord(value);
  const rows = Array.isArray(value) ? value : Array.isArray(root.servers) ? root.servers : [];
  return rows.map(asRecord).map((row) => {
    const session = asRecord(row.session);
    const toolsRaw = Array.isArray(row.tools) ? row.tools : Array.isArray(session.tools) ? session.tools : [];
    const tools = toolsRaw.map(asRecord).map((tool) => ({ name: asString(tool.displayName || tool.name), description: asString(tool.description) || undefined }));
    return {
      name: asString(row.displayName || row.name), source: asString(row.source) || "local",
      enabled: row.enabled === undefined ? session.enabled !== false : row.enabled !== false,
      status: asString(row.status || session.status) || undefined,
      toolCount: asNumber(row.toolCount) || tools.length, tools,
      configSource: asString(row.configSource || row.sourceLabel) || undefined,
      oauth: Boolean(session.authRequired || row.authRequired),
    };
  }).filter((row) => row.name);
}

function normalizeMcpDiagnostics(value: unknown, fallback?: string): McpDiagnostic[] {
  const rows = Array.isArray(value) ? value : Array.isArray(asRecord(value).servers) ? asRecord(value).servers as unknown[] : [value];
  const checkedAt = new Date().toISOString();
  return rows.map(asRecord).map((row) => ({ name: asString(row.name) || fallback || "MCP", ok: row.ok !== false && !row.error, message: asString(row.message || row.error || row.status) || "诊断完成", checkedAt }));
}

async function firstText(root: string, names: string[]): Promise<string | undefined> {
  for (const name of names) {
    const path = join(root, name);
    if (await stat(path).then((value) => value.isFile()).catch(() => false)) return readFile(path, "utf8").catch(() => undefined);
  }
  return undefined;
}

async function inspectLocalPlugin(sourceRoot: string): Promise<PluginInstallPreview> {
  const root = resolve(sourceRoot);
  let manifest: Record<string, unknown> | undefined;
  let manifestPath = "";
  for (const path of [join(root, "plugin.json"), join(root, ".grok-plugin", "plugin.json")]) {
    const text = await readFile(path, "utf8").catch(() => "");
    if (text) { try { manifest = JSON.parse(text) as Record<string, unknown>; manifestPath = path; } catch { throw new Error("本地插件 manifest 不是有效 JSON"); } break; }
  }
  if (!manifest) throw new Error("本地插件缺少 plugin.json 或 .grok-plugin/plugin.json");
  const files = await listTree(root, 8);
  const components = manifestComponents(manifest, files.map((path) => relative(root, path).replaceAll("\\", "/")));
  return {
    name: asString(manifest.name) || basename(root), version: asString(manifest.version) || undefined, description: asString(manifest.description) || undefined,
    source: root, installSource: root, kind: "local", fingerprint: await hashTree(root, manifestPath),
    ...components, license: asString(manifest.license) || files.map((path) => basename(path)).find((name) => /^(?:license|notice)(?:\.|$)/i.test(name)),
  };
}

async function inspectGitPlugin(bare: string, commit: string, requestedSubdir: string, installSource: string): Promise<PluginInstallPreview> {
  const rawFiles = (await execProgram("git", ["-C", bare, "ls-tree", "-r", "--name-only", commit], 60_000)).split(/\r?\n/).filter(Boolean);
  const subdir = requestedSubdir.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  const candidates = [subdir ? `${subdir}/plugin.json` : "plugin.json", subdir ? `${subdir}/.grok-plugin/plugin.json` : ".grok-plugin/plugin.json"];
  if (!subdir) candidates.push(...rawFiles.filter((path) => /(?:^|\/)\.grok-plugin\/plugin\.json$/.test(path) && path.split("/").length <= 4));
  const manifestPath = candidates.find((path) => rawFiles.includes(path));
  if (!manifestPath) throw new Error("Git 来源中未找到 plugin.json 或 .grok-plugin/plugin.json；多插件仓库请使用 #subdir");
  const root = manifestPath.endsWith("/.grok-plugin/plugin.json") ? manifestPath.slice(0, -"/.grok-plugin/plugin.json".length) : manifestPath === ".grok-plugin/plugin.json" ? "" : manifestPath.slice(0, -"/plugin.json".length);
  const manifestText = await execProgram("git", ["-C", bare, "show", `${commit}:${manifestPath}`], 60_000);
  let manifest: Record<string, unknown>; try { manifest = JSON.parse(manifestText) as Record<string, unknown>; } catch { throw new Error("Git 插件 manifest 不是有效 JSON"); }
  const files = rawFiles.filter((path) => !root || path === root || path.startsWith(`${root}/`)).map((path) => root ? path.slice(root.length + 1) : path);
  const components = manifestComponents(manifest, files);
  return {
    name: asString(manifest.name) || basename(root) || "plugin", version: asString(manifest.version) || undefined, description: asString(manifest.description) || undefined,
    source: installSource, installSource, kind: "git", commit, fingerprint: createHash("sha256").update(`${commit}\0${manifestPath}\0${manifestText}`).digest("hex"),
    ...components, license: asString(manifest.license) || files.find((name) => /^(?:license|notice)(?:\.|$)/i.test(basename(name))),
  };
}

function manifestComponents(manifest: Record<string, unknown>, files: string[]): Pick<PluginInstallPreview, "skills" | "commands" | "hooks" | "mcpServers" | "executableFiles"> {
  const skills = new Set(itemNames(manifest.skills)); const commands = new Set(itemNames(manifest.commands));
  for (const path of files) {
    const parts = path.split("/");
    if (parts[0] === "skills" && parts[1] && /skill\.md$/i.test(parts.at(-1) || "")) skills.add(parts[1]);
    if (parts[0] === "commands" && parts[1]) commands.add(parts[1].replace(/\.[^.]+$/, ""));
  }
  const hookNames = itemNames(manifest.hooks); const mcpNames = itemNames(manifest.mcpServers);
  const hooks = [...new Set([...hookNames, ...files.filter((path) => /(?:^|\/)hooks?(?:\/|\.|$)/i.test(path)).map((path) => path.split("/")[0] || path)])];
  const mcpServers = [...new Set([...mcpNames, ...files.filter((path) => /(?:^|\/)\.?(?:mcp)(?:\.json|\/|$)/i.test(path)).map((path) => basename(path))])];
  const executableFiles = files.filter((path) => /\.(?:exe|dll|com|bat|cmd|ps1|js|mjs|cjs|py)$/i.test(path));
  return { skills: [...skills], commands: [...commands], hooks, mcpServers, executableFiles };
}

async function listTree(root: string, depth: number): Promise<string[]> {
  if (depth < 0) return [];
  const rows = await readdir(root, { withFileTypes: true }).catch(() => []); const output: string[] = [];
  for (const row of rows) {
    if (row.isSymbolicLink()) continue;
    if (row.isDirectory() && [".git", "node_modules", ".cache"].includes(row.name)) continue;
    const path = join(root, row.name);
    if (row.isDirectory()) output.push(...await listTree(path, depth - 1)); else if (row.isFile()) output.push(path);
  }
  return output;
}

async function hashTree(root: string, manifestPath: string): Promise<string> {
  const hash = createHash("sha256"); const files = await listTree(root, 8);
  for (const path of files.sort()) {
    const info = await stat(path); hash.update(relative(root, path)); hash.update(String(info.size));
    if (info.size <= 20 * 1024 * 1024) hash.update(await readFile(path));
  }
  hash.update(relative(root, manifestPath)); return hash.digest("hex");
}

function validatePluginSource(source: string): string {
  const value = source.trim(); if (!value || /[\r\n\0]/.test(value) || value.length > 2048) throw new Error("插件来源无效"); return value;
}

function parseGitSource(source: string): { cloneUrl: string; ref?: string; subdir: string; pinned(commit: string): string } {
  const hashIndex = source.indexOf("#"); const baseWithRef = hashIndex >= 0 ? source.slice(0, hashIndex) : source; const subdir = hashIndex >= 0 ? source.slice(hashIndex + 1) : "";
  if (subdir.split(/[\\/]+/).some((part) => part === "..") || /^[\\/]/.test(subdir)) throw new Error("插件子目录无效");
  const shorthand = baseWithRef.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:@([^#]+))?$/);
  if (shorthand) {
    const repo = `${shorthand[1]}/${shorthand[2]}`; const ref = shorthand[3];
    return { cloneUrl: `https://github.com/${repo}.git`, ref, subdir, pinned: (commit) => `${repo}@${commit}${subdir ? `#${subdir}` : ""}` };
  }
  if (!/^(?:https?:\/\/|ssh:\/\/|git@)/i.test(baseWithRef)) throw new Error("Git 插件请使用 HTTPS/SSH URL 或 user/repo；本地插件请填写绝对目录");
  let cloneUrl = baseWithRef; let ref: string | undefined;
  const gitRef = baseWithRef.match(/^(.*\.git)@([^@]+)$/i); if (gitRef) { cloneUrl = gitRef[1]!; ref = gitRef[2]!; }
  return { cloneUrl, ref, subdir, pinned: (commit) => `${cloneUrl}@${commit}${subdir ? `#${subdir}` : ""}` };
}

function execProgram(file: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolvePromise, reject) => execFile(file, args, { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) reject(new Error(String(stderr || stdout || error.message).trim())); else resolvePromise(String(stdout || stderr).trim());
  }));
}

function itemNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => asString(asRecord(item).name || item)).filter(Boolean);
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>);
  return [];
}
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.map(asString).filter(Boolean) : []; }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function asString(value: unknown): string { return typeof value === "string" ? value : ""; }
function asNumber(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
