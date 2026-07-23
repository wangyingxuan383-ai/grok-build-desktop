import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { parse as parseToml } from "smol-toml";
import type {
  AgentDefinition,
  AgentDefinitionSaveInput,
  AppSettings,
  DefinitionActionResult,
  DefinitionMutationResult,
  DefinitionReloadResult,
  DefinitionSource,
  DefinitionValidation,
  PersonaContractField,
  PersonaDefinition,
  PersonaDefinitionSaveInput,
  ReasoningEffort,
} from "../../shared/types";
import { buildCliEnv, locateGrokCli } from "./cli-locator";

const execFileAsync = promisify(execFile);
const MAX_DEFINITION_BYTES = 2 * 1024 * 1024;
const EFFORTS = new Set<ReasoningEffort>(["", "none", "minimal", "low", "medium", "high", "xhigh"]);

interface InspectReport {
  grokVersion?: string;
  agents?: Array<{ name?: string; description?: string; source?: { type?: string; plugin_name?: string; path?: string } }>;
  plugins?: Array<{ name?: string; path?: string; enabled?: boolean; provides?: { agents?: number } }>;
  [key: string]: unknown;
}

export interface DefinitionReloadHooks {
  hotReload?(): Promise<boolean>;
  restartIdleSessions?(): Promise<number>;
  hasLiveSessions?(): boolean;
}

export interface AgentDefinitionServiceOptions {
  grokHome?: string;
  resolveProjectRoot?: (workspacePath: string) => Promise<string>;
  runInspect?: (cliPath: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) => Promise<InspectReport | string>;
  reload?: DefinitionReloadHooks;
}

interface ScannedFile {
  path: string;
  source: DefinitionSource;
  enabled: boolean;
  readOnly: boolean;
  pluginName?: string;
}

interface ParsedAgent {
  name: string;
  description?: string;
  modelId?: string;
  effort?: ReasoningEffort;
  promptMode?: "extend" | "full";
  permissionMode?: string;
  tools?: string[];
  disallowedTools?: string[];
  skills?: string[];
  agentsMd?: boolean;
  instructions: string;
  validation: DefinitionValidation;
}

interface ParsedPersona {
  description?: string;
  instructions?: string;
  instructionFile?: string;
  modelId?: string;
  effort?: ReasoningEffort;
  defaultCapabilityMode?: string;
  defaultForkContext?: boolean;
  defaultIsolation?: "none" | "worktree";
  inputContract: PersonaContractField[];
  outputContract: PersonaContractField[];
  validation: DefinitionValidation;
}

export class AgentDefinitionService {
  private readonly grokHome: string;
  private readonly resolveProjectRoot: (workspacePath: string) => Promise<string>;
  private readonly runInspect: NonNullable<AgentDefinitionServiceOptions["runInspect"]>;
  private readonly reloadHooks: DefinitionReloadHooks;

  constructor(private readonly getSettings: () => Promise<AppSettings>, options: AgentDefinitionServiceOptions = {}) {
    this.grokHome = resolve(options.grokHome ?? process.env.GROK_HOME ?? join(homedir(), ".grok"));
    this.resolveProjectRoot = options.resolveProjectRoot ?? resolveGitProjectRoot;
    this.runInspect = options.runInspect ?? runInspect;
    this.reloadHooks = options.reload ?? {};
  }

  async listAgents(workspacePath: string): Promise<AgentDefinition[]> {
    const [roots, report] = await Promise.all([this.definitionRoots(workspacePath), this.inspect(workspacePath).catch(() => undefined)]);
    const files: ScannedFile[] = [
      ...await scanDefinitionDirectory(join(this.grokHome, "bundled", "agents"), "agent", "builtin", true),
      ...await this.scanPluginAgents(report),
      ...await scanDefinitionDirectory(roots.userAgents, "agent", "user", false),
      ...await scanDefinitionDirectory(roots.projectAgents, "agent", "project", false),
    ];
    const definitions = await Promise.all(files.map((file) => this.readAgent(file)));
    markEffective(definitions);
    return sortDefinitions(definitions);
  }

  async listPersonas(workspacePath: string): Promise<PersonaDefinition[]> {
    const roots = await this.definitionRoots(workspacePath);
    const files: ScannedFile[] = [
      ...await scanDefinitionDirectory(join(this.grokHome, "bundled", "personas"), "persona", "builtin", true),
      ...await scanDefinitionDirectory(roots.userPersonas, "persona", "user", false),
      ...await scanDefinitionDirectory(roots.projectPersonas, "persona", "project", false),
    ];
    const definitions = await Promise.all(files.map((file) => this.readPersona(file)));
    markEffective(definitions);
    return sortDefinitions(definitions);
  }

  validateAgent(rawMarkdown: string, expectedName?: string): DefinitionValidation {
    return parseAgent(rawMarkdown, expectedName).validation;
  }

  validatePersona(rawToml: string): DefinitionValidation {
    return parsePersona(rawToml).validation;
  }

  async saveAgent(input: AgentDefinitionSaveInput): Promise<DefinitionMutationResult<AgentDefinition>> {
    const parsed = parseAgent(input.rawMarkdown, input.name);
    return this.saveDefinition("agent", input, parsed.validation) as Promise<DefinitionMutationResult<AgentDefinition>>;
  }

  async savePersona(input: PersonaDefinitionSaveInput): Promise<DefinitionMutationResult<PersonaDefinition>> {
    const parsed = parsePersona(input.rawToml);
    return this.saveDefinition("persona", input, parsed.validation) as Promise<DefinitionMutationResult<PersonaDefinition>>;
  }

  async copyAgent(workspacePath: string, sourcePath: string, targetSource: "user" | "project", newName: string): Promise<DefinitionMutationResult<AgentDefinition>> {
    const source = await this.resolveReadableDefinition(workspacePath, sourcePath, "agent");
    const raw = await readLimitedUtf8(source.path);
    const updated = setAgentFrontmatterField(raw, "name", newName);
    return this.saveAgent({ workspacePath, targetSource, name: newName, rawMarkdown: updated });
  }

  async copyPersona(workspacePath: string, sourcePath: string, targetSource: "user" | "project", newName: string): Promise<DefinitionMutationResult<PersonaDefinition>> {
    const source = await this.resolveReadableDefinition(workspacePath, sourcePath, "persona");
    return this.savePersona({ workspacePath, targetSource, name: newName, rawToml: await readLimitedUtf8(source.path) });
  }

  async renameAgent(workspacePath: string, sourcePath: string, newName: string): Promise<DefinitionMutationResult<AgentDefinition>> {
    return this.renameDefinition(workspacePath, sourcePath, newName, "agent") as Promise<DefinitionMutationResult<AgentDefinition>>;
  }

  async renamePersona(workspacePath: string, sourcePath: string, newName: string): Promise<DefinitionMutationResult<PersonaDefinition>> {
    return this.renameDefinition(workspacePath, sourcePath, newName, "persona") as Promise<DefinitionMutationResult<PersonaDefinition>>;
  }

  async setAgentEnabled(workspacePath: string, sourcePath: string, enabled: boolean): Promise<DefinitionMutationResult<AgentDefinition>> {
    return this.toggleDefinition(workspacePath, sourcePath, enabled, "agent") as Promise<DefinitionMutationResult<AgentDefinition>>;
  }

  async setPersonaEnabled(workspacePath: string, sourcePath: string, enabled: boolean): Promise<DefinitionMutationResult<PersonaDefinition>> {
    return this.toggleDefinition(workspacePath, sourcePath, enabled, "persona") as Promise<DefinitionMutationResult<PersonaDefinition>>;
  }

  deleteAgent(workspacePath: string, sourcePath: string, confirmed: boolean): Promise<DefinitionActionResult> {
    return this.deleteDefinition(workspacePath, sourcePath, confirmed, "agent");
  }

  deletePersona(workspacePath: string, sourcePath: string, confirmed: boolean): Promise<DefinitionActionResult> {
    return this.deleteDefinition(workspacePath, sourcePath, confirmed, "persona");
  }

  private async saveDefinition(kind: "agent" | "persona", input: AgentDefinitionSaveInput | PersonaDefinitionSaveInput, validation: DefinitionValidation): Promise<DefinitionMutationResult<AgentDefinition | PersonaDefinition>> {
    if (!validation.valid) return { saved: false, validation, reload: noReload() };
    const name = validateDefinitionName(input.name);
    const roots = await this.definitionRoots(input.workspacePath);
    const root = kind === "agent"
      ? input.targetSource === "user" ? roots.userAgents : roots.projectAgents
      : input.targetSource === "user" ? roots.userPersonas : roots.projectPersonas;
    await ensureMutableDirectory(root, input.targetSource === "project" ? roots.projectRoot : this.grokHome);
    const suffix = kind === "agent" ? ".md" : ".toml";
    let targetPath = join(root, `${name}${suffix}`);
    let existing = false;
    if (input.originalPath) {
      const source = await this.resolveMutableDefinition(input.workspacePath, input.originalPath, kind);
      if (source.source !== input.targetSource) throw new Error("不能跨来源覆盖定义，请使用复制操作");
      if (definitionFileName(source.path, kind) !== name) throw new Error("保存时定义名称与文件名不一致，请使用重命名操作");
      targetPath = source.path;
      existing = true;
    } else if (await exists(targetPath)) {
      throw new Error(`目标${kind === "agent" ? " Agent" : " Persona"} 已存在`);
    }
    const raw = kind === "agent" ? (input as AgentDefinitionSaveInput).rawMarkdown : (input as PersonaDefinitionSaveInput).rawToml;
    const current = existing ? await readLimitedUtf8(targetPath) : "";
    const actualHash = existing ? hashText(current) : "";
    if (existing && input.expectedHash !== actualHash) {
      return {
        saved: false,
        validation,
        reload: noReload(),
        conflict: { path: targetPath, expectedHash: input.expectedHash ?? "", actualHash, diskContent: current },
      };
    }
    const backupPath = existing ? persistentBackupPath(targetPath) : undefined;
    if (backupPath) await copyFile(targetPath, backupPath);
    try {
      await atomicWrite(targetPath, raw);
      await this.inspect(input.workspacePath, kind === "agent" && isEnabledDefinitionPath(targetPath, kind) ? name : undefined);
    } catch (error) {
      if (backupPath) await atomicWrite(targetPath, await readLimitedUtf8(backupPath)).catch(() => undefined);
      else await rm(targetPath, { force: true }).catch(() => undefined);
      return { saved: false, validation: invalidValidation(`grok inspect 校验失败，已恢复原文件：${errorMessage(error)}`, false), reload: noReload(), backupPath };
    }
    const reload = await this.reloadDefinitions();
    const file: ScannedFile = { path: targetPath, source: input.targetSource, enabled: !targetPath.endsWith(".disabled"), readOnly: false };
    const definition = kind === "agent" ? await this.readAgent(file) : await this.readPersona(file);
    definition.effective = true;
    return { saved: true, definition, validation: { ...validation, inspectPassed: true }, reload, backupPath };
  }

  private async renameDefinition(workspacePath: string, sourcePath: string, newNameInput: string, kind: "agent" | "persona"): Promise<DefinitionMutationResult<AgentDefinition | PersonaDefinition>> {
    const source = await this.resolveMutableDefinition(workspacePath, sourcePath, kind);
    const newName = validateDefinitionName(newNameInput);
    const enabled = isEnabledDefinitionPath(source.path, kind);
    const suffix = kind === "agent" ? enabled ? ".md" : ".md.disabled" : enabled ? ".toml" : ".toml.disabled";
    const targetPath = join(dirname(source.path), `${newName}${suffix}`);
    if (samePath(source.path, targetPath)) {
      const current = kind === "agent" ? await this.readAgent(source) : await this.readPersona(source);
      return { saved: true, definition: current, validation: current.validation ?? validValidation(), reload: noReload() };
    }
    if (await exists(targetPath)) throw new Error("重命名目标已存在");
    const originalRaw = await readLimitedUtf8(source.path);
    const raw = kind === "agent" ? setAgentFrontmatterField(originalRaw, "name", newName) : originalRaw;
    const validation = kind === "agent" ? parseAgent(raw, newName).validation : parsePersona(raw).validation;
    if (!validation.valid) return { saved: false, validation, reload: noReload() };
    const backupPath = persistentBackupPath(source.path);
    await copyFile(source.path, backupPath);
    try {
      await rename(source.path, targetPath);
      if (raw !== originalRaw) await atomicWrite(targetPath, raw);
      await this.inspect(workspacePath, kind === "agent" && enabled ? newName : undefined);
    } catch (error) {
      await rm(targetPath, { force: true }).catch(() => undefined);
      await copyFile(backupPath, source.path).catch(() => undefined);
      return { saved: false, validation: invalidValidation(`grok inspect 校验失败，已恢复原文件：${errorMessage(error)}`, false), reload: noReload(), backupPath };
    }
    const reload = await this.reloadDefinitions();
    const file: ScannedFile = { ...source, path: targetPath, enabled };
    const definition = kind === "agent" ? await this.readAgent(file) : await this.readPersona(file);
    definition.effective = enabled;
    return { saved: true, definition, validation: { ...validation, inspectPassed: true }, reload, backupPath };
  }

  private async toggleDefinition(workspacePath: string, sourcePath: string, enabled: boolean, kind: "agent" | "persona"): Promise<DefinitionMutationResult<AgentDefinition | PersonaDefinition>> {
    const source = await this.resolveMutableDefinition(workspacePath, sourcePath, kind);
    const currentlyEnabled = isEnabledDefinitionPath(source.path, kind);
    const current = kind === "agent" ? await this.readAgent(source) : await this.readPersona(source);
    if (currentlyEnabled === enabled) return { saved: true, definition: current, validation: current.validation ?? validValidation(), reload: noReload() };
    const activeSuffix = kind === "agent" ? ".md" : ".toml";
    const targetPath = enabled ? source.path.slice(0, -".disabled".length) : `${source.path}.disabled`;
    if (extname(enabled ? targetPath : source.path) !== activeSuffix) throw new Error("定义文件扩展名无效");
    if (await exists(targetPath)) throw new Error("启停目标文件已存在");
    const backupPath = persistentBackupPath(source.path);
    await copyFile(source.path, backupPath);
    try {
      await rename(source.path, targetPath);
      await this.inspect(workspacePath, kind === "agent" && enabled ? definitionFileName(targetPath, kind) : undefined);
    } catch (error) {
      await rename(targetPath, source.path).catch(async () => copyFile(backupPath, source.path));
      return { saved: false, validation: invalidValidation(`grok inspect 校验失败，已恢复原文件：${errorMessage(error)}`, false), reload: noReload(), backupPath };
    }
    const reload = await this.reloadDefinitions();
    const file = { ...source, path: targetPath, enabled };
    const definition = kind === "agent" ? await this.readAgent(file) : await this.readPersona(file);
    definition.effective = enabled;
    return { saved: true, definition, validation: { ...(definition.validation ?? validValidation()), inspectPassed: true }, reload, backupPath };
  }

  private async deleteDefinition(workspacePath: string, sourcePath: string, confirmed: boolean, kind: "agent" | "persona"): Promise<DefinitionActionResult> {
    if (!confirmed) throw new Error("删除定义前需要明确确认");
    const source = await this.resolveMutableDefinition(workspacePath, sourcePath, kind);
    const backupPath = persistentBackupPath(source.path);
    await copyFile(source.path, backupPath);
    await rm(source.path);
    try {
      await this.inspect(workspacePath);
    } catch (error) {
      await copyFile(backupPath, source.path).catch(() => undefined);
      throw new Error(`grok inspect 校验失败，已恢复原文件：${errorMessage(error)}`);
    }
    return { reload: await this.reloadDefinitions(), backupPath };
  }

  private async readAgent(file: ScannedFile): Promise<AgentDefinition> {
    const rawMarkdown = await readLimitedUtf8(file.path);
    const parsed = parseAgent(rawMarkdown, definitionFileName(file.path, "agent"), false);
    return {
      id: definitionId("agent", file.source, file.path),
      name: parsed.name || definitionFileName(file.path, "agent"),
      description: parsed.description,
      source: file.source,
      path: file.path,
      enabled: file.enabled,
      readOnly: file.readOnly,
      effective: false,
      pluginName: file.pluginName,
      hash: hashText(rawMarkdown),
      modelId: parsed.modelId,
      effort: parsed.effort,
      promptMode: parsed.promptMode,
      permissionMode: parsed.permissionMode,
      tools: parsed.tools,
      disallowedTools: parsed.disallowedTools,
      skills: parsed.skills,
      agentsMd: parsed.agentsMd,
      instructions: parsed.instructions,
      rawMarkdown,
      validation: parsed.validation,
    };
  }

  private async readPersona(file: ScannedFile): Promise<PersonaDefinition> {
    const rawToml = await readLimitedUtf8(file.path);
    const parsed = parsePersona(rawToml);
    return {
      id: definitionId("persona", file.source, file.path),
      name: definitionFileName(file.path, "persona"),
      description: parsed.description,
      source: file.source,
      path: file.path,
      enabled: file.enabled,
      readOnly: file.readOnly,
      effective: false,
      hash: hashText(rawToml),
      instructions: parsed.instructions,
      instructionFile: parsed.instructionFile,
      modelId: parsed.modelId,
      effort: parsed.effort,
      defaultCapabilityMode: parsed.defaultCapabilityMode,
      defaultForkContext: parsed.defaultForkContext,
      defaultIsolation: parsed.defaultIsolation,
      inputContract: parsed.inputContract,
      outputContract: parsed.outputContract,
      rawToml,
      validation: parsed.validation,
    };
  }

  private async definitionRoots(workspacePath: string): Promise<{ projectRoot: string; userAgents: string; userPersonas: string; projectAgents: string; projectPersonas: string }> {
    const projectRoot = await realpath(await this.resolveProjectRoot(workspacePath));
    return {
      projectRoot,
      userAgents: join(this.grokHome, "agents"),
      userPersonas: join(this.grokHome, "personas"),
      projectAgents: join(projectRoot, ".grok", "agents"),
      projectPersonas: join(projectRoot, ".grok", "personas"),
    };
  }

  private async scanPluginAgents(report?: InspectReport): Promise<ScannedFile[]> {
    const output: ScannedFile[] = [];
    for (const plugin of report?.plugins ?? []) {
      if (!plugin.path || !plugin.name || !(plugin.provides?.agents ?? 0)) continue;
      output.push(...await scanDefinitionDirectory(join(plugin.path, "agents"), "agent", "plugin", true, plugin.enabled !== false, plugin.name));
    }
    return output;
  }

  private async resolveReadableDefinition(workspacePath: string, requestedPath: string, kind: "agent" | "persona"): Promise<ScannedFile> {
    const roots = await this.definitionRoots(workspacePath);
    const report = await this.inspect(workspacePath).catch(() => undefined);
    const candidates: Array<{ root: string; source: DefinitionSource; readOnly: boolean; pluginName?: string }> = [
      { root: join(this.grokHome, "bundled", kind === "agent" ? "agents" : "personas"), source: "builtin", readOnly: true },
      { root: kind === "agent" ? roots.userAgents : roots.userPersonas, source: "user", readOnly: false },
      { root: kind === "agent" ? roots.projectAgents : roots.projectPersonas, source: "project", readOnly: false },
    ];
    if (kind === "agent") for (const plugin of report?.plugins ?? []) if (plugin.path && plugin.name) candidates.push({ root: join(plugin.path, "agents"), source: "plugin", readOnly: true, pluginName: plugin.name });
    for (const candidate of candidates) {
      if (!pathInside(candidate.root, requestedPath)) continue;
      const path = await assertDefinitionFile(candidate.root, requestedPath, kind);
      return { path, source: candidate.source, readOnly: candidate.readOnly, pluginName: candidate.pluginName, enabled: isEnabledDefinitionPath(path, kind) };
    }
    throw new Error("定义路径不属于允许的 Agent/Persona 目录");
  }

  private async resolveMutableDefinition(workspacePath: string, requestedPath: string, kind: "agent" | "persona"): Promise<ScannedFile> {
    const file = await this.resolveReadableDefinition(workspacePath, requestedPath, kind);
    if (file.readOnly || (file.source !== "user" && file.source !== "project")) throw new Error("内置和插件定义只读，请先复制到用户或项目范围");
    return file;
  }

  private async inspect(workspacePath: string, expectedAgentName?: string): Promise<InspectReport> {
    const settings = await this.getSettings();
    const cliPath = await locateGrokCli(settings.cliPath);
    if (!cliPath) throw new Error("未找到 Grok CLI，无法运行 grok inspect --json");
    const value = await this.runInspect(cliPath, ["inspect", "--json"], workspacePath, { ...buildCliEnv(settings), GROK_HOME: this.grokHome });
    const report = typeof value === "string" ? JSON.parse(value) as InspectReport : value;
    if (!report || typeof report !== "object") throw new Error("grok inspect --json 未返回有效对象");
    if (expectedAgentName && Array.isArray(report.agents) && !report.agents.some((agent) => agent.name === expectedAgentName)) throw new Error(`grok inspect 未加载 Agent “${expectedAgentName}”`);
    return report;
  }

  private async reloadDefinitions(): Promise<DefinitionReloadResult> {
    try {
      if (this.reloadHooks.hotReload && await this.reloadHooks.hotReload()) return { strategy: "hot-reload", restartedSessions: 0 };
      const restartedSessions = this.reloadHooks.restartIdleSessions ? await this.reloadHooks.restartIdleSessions() : 0;
      if (restartedSessions) return { strategy: "idle-restart", restartedSessions };
      return this.reloadHooks.hasLiveSessions?.() ? { strategy: "deferred", restartedSessions: 0, message: "运行中的会话将在下次恢复时加载新定义" } : noReload();
    } catch (error) {
      return { strategy: "deferred", restartedSessions: 0, message: `定义已保存，但会话重载失败：${errorMessage(error)}` };
    }
  }
}

function parseAgent(rawMarkdown: string, expectedName?: string, requireNameMatch = true): ParsedAgent {
  try {
    const frontmatter = extractFrontmatter(rawMarkdown);
    const values = parseSimpleYaml(frontmatter.header);
    const name = stringValue(values.name) ?? "";
    if (!name) throw new Error("Agent frontmatter 缺少 name");
    if (requireNameMatch && expectedName && name !== expectedName) throw new Error(`Agent name “${name}” 与文件名 “${expectedName}” 不一致`);
    const description = stringValue(values.description);
    if (!description) throw new Error("Agent frontmatter 缺少 description");
    const promptMode = stringValue(values.prompt_mode);
    if (promptMode && promptMode !== "extend" && promptMode !== "full") throw new Error("prompt_mode 必须是 extend 或 full");
    const effort = stringValue(values.effort) as ReasoningEffort | undefined;
    if (effort && !EFFORTS.has(effort)) throw new Error(`不支持的 effort：${effort}`);
    const agentsMd = booleanValue(values.agents_md);
    if (values.agents_md !== undefined && agentsMd === undefined) throw new Error("agents_md 必须是布尔值");
    return {
      name,
      description,
      modelId: stringValue(values.model),
      effort,
      promptMode: promptMode as "extend" | "full" | undefined,
      permissionMode: stringValue(values.permission_mode),
      tools: stringArray(values.tools),
      disallowedTools: stringArray(values.disallowed_tools),
      skills: stringArray(values.skills),
      agentsMd,
      instructions: frontmatter.body,
      validation: validValidation(),
    };
  } catch (error) {
    return { name: expectedName ?? "", instructions: "", validation: invalidValidation(errorMessage(error)) };
  }
}

function parsePersona(rawToml: string): ParsedPersona {
  try {
    const value = parseToml(rawToml) as Record<string, unknown>;
    const instructions = stringValue(value.instructions);
    const instructionFile = stringValue(value.instructions_file);
    if (!instructions && !instructionFile) throw new Error("Persona 必须提供 instructions 或 instructions_file");
    const effort = stringValue(value.reasoning_effort) as ReasoningEffort | undefined;
    if (effort && !EFFORTS.has(effort)) throw new Error(`不支持的 reasoning_effort：${effort}`);
    const isolation = stringValue(value.default_isolation);
    if (isolation && isolation !== "none" && isolation !== "worktree") throw new Error("default_isolation 必须是 none 或 worktree");
    return {
      description: stringValue(value.description),
      instructions,
      instructionFile,
      modelId: stringValue(value.model),
      effort,
      defaultCapabilityMode: stringValue(value.default_capability_mode),
      defaultForkContext: booleanValue(value.default_fork_context),
      defaultIsolation: isolation as "none" | "worktree" | undefined,
      inputContract: parseContract(value.inputs, "inputs"),
      outputContract: parseContract(value.outputs, "outputs"),
      validation: validValidation(),
    };
  } catch (error) {
    return { inputContract: [], outputContract: [], validation: invalidValidation(errorMessage(error)) };
  }
}

function parseContract(value: unknown, label: string): PersonaContractField[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} 必须是 TOML 表数组`);
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${label}[${index}] 必须是表`);
    const row = item as Record<string, unknown>;
    const name = stringValue(row.name);
    if (!name) throw new Error(`${label}[${index}] 缺少 name`);
    if (row.required !== undefined && typeof row.required !== "boolean") throw new Error(`${label}[${index}].required 必须是布尔值`);
    return { name, ioType: stringValue(row.io_type) ?? "file", required: row.required === true, description: stringValue(row.description) };
  });
}

function extractFrontmatter(raw: string): { header: string; body: string } {
  const normalized = raw.replace(/^\uFEFF/, "");
  const match = /^(---)[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(normalized);
  if (!match) throw new Error("Agent 文件必须以 YAML frontmatter 开头并用 --- 闭合");
  return { header: match[2] ?? "", body: normalized.slice(match[0].length) };
}

function parseSimpleYaml(header: string): Record<string, unknown> {
  const lines = header.split(/\r?\n/);
  const output: Record<string, unknown> = {};
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):(?:[ \t]*(.*))?$/.exec(line);
    if (!match) throw new Error(`无法解析 frontmatter 第 ${index + 1} 行`);
    const key = match[1]!;
    const rawValue = match[2] ?? "";
    if (rawValue === ">" || rawValue === "|" || rawValue === ">-" || rawValue === "|-") {
      const block: string[] = [];
      while (index + 1 < lines.length && (/^[ \t]+/.test(lines[index + 1] ?? "") || !(lines[index + 1] ?? "").trim())) {
        index += 1;
        block.push((lines[index] ?? "").replace(/^(?:  |\t)/, ""));
      }
      output[key] = rawValue.startsWith(">") ? block.join(" ").replace(/\s+/g, " ").trim() : block.join("\n");
    } else if (!rawValue.trim()) {
      const block: string[] = [];
      while (index + 1 < lines.length && (/^[ \t]+/.test(lines[index + 1] ?? "") || !(lines[index + 1] ?? "").trim())) {
        index += 1;
        block.push((lines[index] ?? "").replace(/^(?:  |\t)/, ""));
      }
      const populated = block.filter((value) => value.trim());
      output[key] = populated.length && populated.every((value) => /^-\s+/.test(value)) ? populated.map((value) => parseYamlScalar(value.replace(/^-\s+/, ""))) : block.join("\n");
    } else output[key] = parseYamlScalar(rawValue);
  }
  return output;
}

function parseYamlScalar(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) return splitInlineArray(trimmed.slice(1, -1)).map((item) => String(parseYamlScalar(item)));
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try { return JSON.parse(trimmed) as unknown; } catch { throw new Error("frontmatter 双引号字符串无效"); }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/''/g, "'");
  return trimmed.replace(/[ \t]+#.*$/, "").trim();
}

function splitInlineArray(value: string): string[] {
  const output: string[] = [];
  let current = "";
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (quote) {
      current += char;
      if (char === quote && value[index - 1] !== "\\") quote = "";
    } else if (char === '"' || char === "'") { quote = char; current += char; }
    else if (char === ",") { if (current.trim()) output.push(current.trim()); current = ""; }
    else current += char;
  }
  if (quote) throw new Error("frontmatter 数组引号未闭合");
  if (current.trim()) output.push(current.trim());
  return output;
}

export function setAgentFrontmatterField(raw: string, key: string, value: string | boolean | string[] | undefined): string {
  const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(raw);
  if (!opening) throw new Error("Agent 文件缺少 frontmatter");
  const closing = /\r?\n---[ \t]*(?:\r?\n|$)/g;
  closing.lastIndex = opening[0].length;
  const close = closing.exec(raw);
  if (!close) throw new Error("Agent frontmatter 未闭合");
  const newline = raw.includes("\r\n") ? "\r\n" : "\n";
  const headerStart = opening[0].length;
  const header = raw.slice(headerStart, close.index).replace(/\r\n/g, "\n");
  const lines = header.split("\n");
  const keyIndex = lines.findIndex((line) => new RegExp(`^${escapeRegExp(key)}:`).test(line));
  const serialized = value === undefined ? undefined : `${key}: ${serializeYamlValue(value)}`;
  if (keyIndex < 0) {
    if (serialized) lines.push(serialized);
  } else {
    let end = keyIndex + 1;
    while (end < lines.length && (/^[ \t]+/.test(lines[end] ?? "") || !(lines[end] ?? "").trim())) end += 1;
    if (serialized) lines.splice(keyIndex, end - keyIndex, serialized);
    else lines.splice(keyIndex, end - keyIndex);
  }
  return `${raw.slice(0, headerStart)}${lines.join(newline)}${raw.slice(close.index)}`;
}

function serializeYamlValue(value: string | boolean | string[]): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
  if (/^[A-Za-z0-9_.\/-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

async function scanDefinitionDirectory(root: string, kind: "agent" | "persona", source: DefinitionSource, readOnly: boolean, parentEnabled = true, pluginName?: string): Promise<ScannedFile[]> {
  if (!await exists(root)) return [];
  const info = await lstat(root);
  if (info.isSymbolicLink() || !info.isDirectory()) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const activeSuffix = kind === "agent" ? ".md" : ".toml";
  return entries
    .filter((entry) => entry.isFile() && (entry.name.endsWith(activeSuffix) || entry.name.endsWith(`${activeSuffix}.disabled`)))
    .map((entry) => ({ path: join(root, entry.name), source, readOnly, pluginName, enabled: parentEnabled && entry.name.endsWith(activeSuffix) }));
}

async function assertDefinitionFile(root: string, requestedPath: string, kind: "agent" | "persona"): Promise<string> {
  const rootReal = await realpath(root);
  const requested = resolve(requestedPath);
  if (!pathInside(rootReal, requested)) throw new Error("定义路径越界");
  const info = await lstat(requested);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error("拒绝符号链接或非文件定义");
  const resolved = await realpath(requested);
  if (!pathInside(rootReal, resolved)) throw new Error("定义 realpath 越界");
  const suffix = kind === "agent" ? ".md" : ".toml";
  if (!resolved.endsWith(suffix) && !resolved.endsWith(`${suffix}.disabled`)) throw new Error("定义扩展名无效");
  return resolved;
}

async function ensureMutableDirectory(target: string, boundary: string): Promise<void> {
  const boundaryReal = await realpath(boundary).catch(async () => { await mkdir(boundary, { recursive: true }); return realpath(boundary); });
  if (!pathInside(boundaryReal, target)) throw new Error("目标定义目录越界");
  let cursor = boundaryReal;
  const parts = relative(boundaryReal, target).split(/[\\/]+/).filter(Boolean);
  for (const part of parts) {
    cursor = join(cursor, part);
    if (await exists(cursor)) {
      const info = await lstat(cursor);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("定义目录包含符号链接或非目录节点");
      if (!pathInside(boundaryReal, await realpath(cursor))) throw new Error("定义目录 realpath 越界");
    } else await mkdir(cursor);
  }
}

async function readLimitedUtf8(path: string): Promise<string> {
  const info = await stat(path);
  if (info.size > MAX_DEFINITION_BYTES) throw new Error("Agent/Persona 定义超过 2 MiB 上限");
  return readFile(path, "utf8");
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const replacementBackup = `${path}.${process.pid}.${randomUUID()}.replace.bak`;
  let movedOriginal = false;
  try {
    const mode = await stat(path).then((value) => value.mode).catch(() => undefined);
    const handle = await open(temp, "wx", mode);
    try { await handle.writeFile(content, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    if (mode !== undefined) await chmod(temp, mode).catch(() => undefined);
    try { await rename(temp, path); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!await exists(path) || !["EEXIST", "EPERM", "EACCES"].includes(code ?? "")) throw error;
      await rename(path, replacementBackup);
      movedOriginal = true;
      try { await rename(temp, path); }
      catch (replacementError) { await rename(replacementBackup, path).catch(() => undefined); movedOriginal = false; throw replacementError; }
    }
    if (movedOriginal) await rm(replacementBackup, { force: true });
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    if (movedOriginal) await rename(replacementBackup, path).catch(() => undefined);
    throw error;
  }
}

async function resolveGitProjectRoot(workspacePath: string): Promise<string> {
  const workspace = await realpath(workspacePath);
  try {
    const { stdout } = await execFileAsync("git", ["-C", workspace, "rev-parse", "--show-toplevel"], { windowsHide: true, shell: false, encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024 });
    return stdout.trim() || workspace;
  } catch { return workspace; }
}

async function runInspect(cliPath: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<InspectReport> {
  const { stdout } = await execFileAsync(cliPath, args, { cwd, env, windowsHide: true, shell: false, encoding: "utf8", timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(stdout) as InspectReport;
}

function markEffective<T extends { name: string; source: DefinitionSource; enabled: boolean; effective: boolean; shadowedBy?: DefinitionSource }>(definitions: T[]): void {
  const priority: Record<DefinitionSource, number> = { builtin: 0, plugin: 1, user: 2, project: 3 };
  const names = new Map<string, T[]>();
  for (const definition of definitions) {
    const key = definition.name.toLocaleLowerCase();
    const group = names.get(key) ?? [];
    group.push(definition);
    names.set(key, group);
  }
  for (const group of names.values()) {
    const effective = group.filter((value) => value.enabled).sort((a, b) => priority[b.source]! - priority[a.source]!)[0];
    if (effective) effective.effective = true;
    for (const definition of group) if (definition !== effective && effective) definition.shadowedBy = effective.source;
  }
}

function sortDefinitions<T extends { name: string; source: DefinitionSource }>(definitions: T[]): T[] {
  const order: Record<DefinitionSource, number> = { project: 0, user: 1, plugin: 2, builtin: 3 };
  return definitions.sort((a, b) => order[a.source]! - order[b.source]! || a.name.localeCompare(b.name, "zh-CN"));
}

function definitionFileName(path: string, kind: "agent" | "persona"): string {
  const suffix = kind === "agent" ? ".md" : ".toml";
  const file = basename(path);
  return file.endsWith(`${suffix}.disabled`) ? file.slice(0, -`${suffix}.disabled`.length) : file.endsWith(suffix) ? file.slice(0, -suffix.length) : file;
}

function isEnabledDefinitionPath(path: string, kind: "agent" | "persona"): boolean {
  return path.endsWith(kind === "agent" ? ".md" : ".toml");
}

function definitionId(kind: string, source: DefinitionSource, path: string): string { return `${kind}:${source}:${createHash("sha256").update(path.toLocaleLowerCase()).digest("hex").slice(0, 16)}`; }
function hashText(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function persistentBackupPath(path: string): string { return `${path}.grok-desktop.bak`; }
function validValidation(): DefinitionValidation { return { valid: true, checkedAt: new Date().toISOString() }; }
function invalidValidation(message: string, inspectPassed?: boolean): DefinitionValidation { return { valid: false, message, checkedAt: new Date().toISOString(), ...(inspectPassed === undefined ? {} : { inspectPassed }) }; }
function noReload(): DefinitionReloadResult { return { strategy: "not-needed", restartedSessions: 0 }; }
function stringValue(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function booleanValue(value: unknown): boolean | undefined { return typeof value === "boolean" ? value : undefined; }
function stringArray(value: unknown): string[] | undefined { return Array.isArray(value) && value.every((item) => typeof item === "string") ? value as string[] : value === undefined ? undefined : typeof value === "string" ? [value] : undefined; }
function exists(path: string): Promise<boolean> { return lstat(path).then(() => true).catch(() => false); }
function samePath(left: string, right: string): boolean { return process.platform === "win32" ? resolve(left).toLocaleLowerCase() === resolve(right).toLocaleLowerCase() : resolve(left) === resolve(right); }
function pathInside(root: string, candidate: string): boolean { const value = relative(resolve(root), resolve(candidate)); return value === "" || (!value.startsWith("..") && !isAbsolute(value)); }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function errorMessage(value: unknown): string { return value instanceof Error ? value.message : String(value); }

function validateDefinitionName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 80 || name === "." || name === ".." || /[\u0000-\u001f<>:"/\\|?*]/.test(name) || /[. ]$/.test(name)) throw new Error("定义名称为空、过长或包含 Windows 文件名禁用字符");
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) throw new Error("定义名称是 Windows 保留名称");
  return name;
}

export const agentDefinitionInternals = { parseAgent, parsePersona, setAgentFrontmatterField, validateDefinitionName, markEffective };
