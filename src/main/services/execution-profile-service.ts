import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  AgentDefinition,
  ExecutionProfileField,
  ExecutionProfileFieldSupport,
  ExecutionProfileSaveInput,
  ExecutionProfileValidation,
  ReasoningEffort,
  SessionExecutionAssignment,
  SessionExecutionProfile,
  SessionMode,
} from "../../shared/types";
import { REASONING_EFFORTS } from "../../shared/types";
import { JsonStore } from "./json-store";

const execFileAsync = promisify(execFile);
const PROFILE_FIELDS: ExecutionProfileField[] = [
  "agentId", "modelId", "effort", "mode", "allowTools", "denyTools", "sandbox", "webSearch",
  "subagents", "memory", "worktree", "worktreeRef", "maxTurns", "additionalRules", "allowedPersonaIds", "subagentIsolation",
];

interface StoredExecutionProfiles {
  version: 1;
  global: SessionExecutionProfile[];
  projects: Record<string, SessionExecutionProfile[]>;
  assignments: Record<string, SessionExecutionAssignment>;
}

export interface CompiledExecutionProfile {
  profile: SessionExecutionProfile;
  validation: ExecutionProfileValidation;
  effort: ReasoningEffort;
  mode: SessionMode;
  modelId: string;
  environment: Record<string, string>;
  agentProfilePath: string;
  sessionMeta: Record<string, unknown>;
}

export interface ExecutionProfileServiceOptions {
  resolveWorkspaceIdentity?: (workspacePath: string) => Promise<string>;
  now?: () => Date;
}

const BUILTIN_PROFILES: SessionExecutionProfile[] = [
  builtin("builtin-normal", "普通开发", "继承桌面默认模型与推理强度，在当前工作区进行常规开发。", { mode: "agent", sandbox: "workspace" }),
  builtin("builtin-review", "只读审查", "只读检查代码、配置与差异，不修改工作区。", { mode: "plan", sandbox: "read-only", denyTools: ["search_replace", "write_file", "apply_patch"], subagentIsolation: "workspace" }),
  builtin("builtin-auto", "自动修改", "在工作区沙箱中自动批准普通工具并完成修改。", { mode: "auto", sandbox: "workspace" }),
  builtin("builtin-worktree", "Worktree 隔离开发", "在独立 Git Worktree 中执行修改，完成后通过安全 Apply 合并。", { mode: "agent", sandbox: "workspace", worktree: true, subagentIsolation: "worktree" }),
  builtin("builtin-research", "研究与探索", "允许搜索和只读分析，禁止直接修改项目文件。", { mode: "agent", sandbox: "read-only", webSearch: "enabled", denyTools: ["search_replace", "write_file", "apply_patch"] }),
];

export class ExecutionProfileService {
  private readonly store: JsonStore<StoredExecutionProfiles>;
  private readonly runtimeRoot: string;
  private readonly resolveIdentity: NonNullable<ExecutionProfileServiceOptions["resolveWorkspaceIdentity"]>;
  private readonly now: () => Date;

  constructor(userDataPath: string, options: ExecutionProfileServiceOptions = {}) {
    this.store = new JsonStore(join(userDataPath, "execution-profiles.json"), { version: 1, global: [], projects: {}, assignments: {} });
    this.runtimeRoot = join(userDataPath, "execution-profiles", "runtime");
    this.resolveIdentity = options.resolveWorkspaceIdentity ?? workspaceIdentity;
    this.now = options.now ?? (() => new Date());
  }

  async list(workspacePath: string): Promise<SessionExecutionProfile[]> {
    const identity = await this.resolveIdentity(workspacePath);
    const state = await this.store.get();
    state.global ??= [];
    state.projects ??= {};
    const all = [
      ...BUILTIN_PROFILES.map((value) => structuredClone(value)),
      ...state.global.map(normalizeStoredProfile),
      ...(state.projects[identity] ?? []).map(normalizeStoredProfile),
    ];
    const priority = (scope: SessionExecutionProfile["scope"]): number => scope === "project" ? 3 : scope === "global" ? 2 : 1;
    const winners = new Map<string, SessionExecutionProfile>();
    for (const value of all) {
      const key = profileNameKey(value.name);
      const current = winners.get(key);
      if (!current || priority(value.scope) > priority(current.scope)) winners.set(key, value);
    }
    return all.map((value) => {
      const winner = winners.get(profileNameKey(value.name))!;
      return {
        ...value,
        effective: winner.id === value.id,
        ...(winner.id === value.id ? {} : { shadowedBy: winner.scope }),
      };
    }).sort((left, right) => priority(right.scope) - priority(left.scope) || left.name.localeCompare(right.name, "zh-CN"));
  }

  async resolve(workspacePath: string, profileId?: string): Promise<SessionExecutionProfile> {
    const profiles = await this.list(workspacePath);
    if (!profileId) return profiles.find((value) => value.id === "builtin-normal" && value.effective) ?? profiles.find((value) => value.effective)!;
    const selected = profiles.find((value) => value.id === profileId || profileNameKey(value.name) === profileNameKey(profileId));
    if (!selected) throw new Error("执行配置档已不存在，请重新选择");
    return profiles.find((value) => value.effective && profileNameKey(value.name) === profileNameKey(selected.name)) ?? selected;
  }

  async save(input: ExecutionProfileSaveInput): Promise<SessionExecutionProfile[]> {
    const identity = await this.resolveIdentity(input.workspacePath);
    const now = this.now().toISOString();
    const candidate = normalizeProfile({
      ...input.profile,
      id: input.profile.id?.trim() || crypto.randomUUID(),
      scope: input.scope,
      workspaceIdentity: input.scope === "project" ? identity : undefined,
      readOnly: false,
      createdAt: input.profile.id ? undefined : now,
      updatedAt: now,
    });
    const validation = this.validate(candidate);
    if (!validation.valid) throw new Error(validation.message || "执行配置档无效");
    if (BUILTIN_PROFILES.some((value) => value.id === candidate.id)) throw new Error("内置配置档不可覆盖；请复制为全局或项目配置档");
    const state = await this.store.get();
    state.global ??= [];
    state.projects ??= {};
    const target = input.scope === "global" ? state.global : (state.projects[identity] ??= []);
    const duplicate = target.find((value) => profileNameKey(value.name) === profileNameKey(candidate.name) && value.id !== candidate.id);
    if (duplicate) throw new Error("同一范围内已存在同名执行配置档");
    const previous = [...state.global, ...Object.values(state.projects).flat()].find((value) => value.id === candidate.id);
    candidate.createdAt = previous?.createdAt ?? now;
    state.global = state.global.filter((value) => value.id !== candidate.id);
    for (const key of Object.keys(state.projects)) state.projects[key] = state.projects[key]!.filter((value) => value.id !== candidate.id);
    const destination = input.scope === "global" ? state.global : (state.projects[identity] ??= []);
    destination.push(candidate);
    await this.store.set(state);
    return this.list(input.workspacePath);
  }

  async remove(workspacePath: string, profileId: string, confirmed: boolean): Promise<SessionExecutionProfile[]> {
    if (!confirmed) throw new Error("删除执行配置档前需要明确确认");
    if (BUILTIN_PROFILES.some((value) => value.id === profileId)) throw new Error("内置执行配置档不可删除");
    const identity = await this.resolveIdentity(workspacePath);
    const state = await this.store.get();
    const before = state.global.length + Object.values(state.projects).reduce((total, values) => total + values.length, 0);
    state.global = state.global.filter((value) => value.id !== profileId);
    for (const key of Object.keys(state.projects)) state.projects[key] = state.projects[key]!.filter((value) => value.id !== profileId);
    const after = state.global.length + Object.values(state.projects).reduce((total, values) => total + values.length, 0);
    if (before === after) throw new Error("执行配置档不存在或已删除");
    await this.store.set(state);
    return this.list(workspacePath || identity);
  }

  validate(profile: SessionExecutionProfile): ExecutionProfileValidation {
    const support = Object.fromEntries(PROFILE_FIELDS.map((field) => [field, supported(mappingFor(field))])) as Record<ExecutionProfileField, ExecutionProfileFieldSupport>;
    support.maxTurns = { state: "unsupported", reason: "当前 Grok ACP session/new 未公布 maxTurns；桌面不会静默忽略该值" };
    support.allowedPersonaIds = { state: "degraded", reason: "当前 CLI 没有会话级 Persona 强制白名单，使用原生 rules 明示约束", mapping: "session/new._meta.rules" };
    support.subagentIsolation = { state: "degraded", reason: "当前 CLI 没有会话级默认隔离参数，使用原生 rules 要求 spawn_subagent isolation", mapping: "session/new._meta.rules" };
    try {
      validateProfile(profile);
      return { valid: true, fieldSupport: support };
    } catch (error) {
      return { valid: false, message: error instanceof Error ? error.message : String(error), fieldSupport: support };
    }
  }

  async compile(workspacePath: string, profileId: string | undefined, agents: AgentDefinition[]): Promise<CompiledExecutionProfile> {
    const profile = await this.resolve(workspacePath, profileId);
    return this.compileProfile(profile, agents);
  }

  async compileProfile(profileInput: SessionExecutionProfile, agents: AgentDefinition[]): Promise<CompiledExecutionProfile> {
    const profile = normalizeProfile(profileInput);
    const validation = this.validate(profile);
    if (!validation.valid) throw new Error(validation.message || "执行配置档无效");
    if (profile.maxTurns !== undefined) throw new Error(validation.fieldSupport.maxTurns.reason);
    const agent = profile.agentId ? agents.find((value) => value.effective && value.enabled && value.name === profile.agentId) : undefined;
    if (profile.agentId && !agent) throw new Error(`配置档指定的 Agent“${profile.agentId}”不存在或未启用`);
    const raw = runtimeAgentMarkdown(profile, agent);
    const hash = createHash("sha256").update(raw).digest("hex");
    const agentProfilePath = join(this.runtimeRoot, `${hash}.md`);
    await mkdir(this.runtimeRoot, { recursive: true });
    if (!await stat(agentProfilePath).then((value) => value.isFile()).catch(() => false)) await atomicWrite(agentProfilePath, raw);
    const ruleParts = [profile.additionalRules?.trim()].filter(Boolean) as string[];
    if (profile.allowedPersonaIds.length) ruleParts.push(`子 Agent 只能使用以下 Persona：${profile.allowedPersonaIds.join("、")}。如果无法解析，停止并说明原因。`);
    if (profile.subagentIsolation === "worktree") ruleParts.push("创建会修改文件的子 Agent 时必须使用 isolation: worktree；只读子 Agent 也优先隔离。 ");
    const environment: Record<string, string> = {
      GROK_MEMORY: profile.memory ? "1" : "0",
      GROK_SUBAGENTS: profile.subagents ? "1" : "0",
      ...(profile.sandbox ? { GROK_SANDBOX: profile.sandbox } : {}),
      ...(profile.webSearch === "enabled" ? { GROK_WEB_FETCH: "1" } : profile.webSearch === "disabled" ? { GROK_WEB_FETCH: "0" } : {}),
    };
    return {
      profile,
      validation,
      effort: profile.effort,
      mode: profile.mode,
      modelId: profile.modelId ?? "",
      environment,
      agentProfilePath,
      sessionMeta: ruleParts.length ? { rules: ruleParts.join("\n\n") } : {},
    };
  }

  async assign(value: SessionExecutionAssignment): Promise<void> {
    const state = await this.store.get();
    state.assignments ??= {};
    state.assignments[value.sessionId] = structuredClone(value);
    await this.store.set(state);
  }

  async assignment(sessionId: string): Promise<SessionExecutionAssignment | undefined> {
    const state = await this.store.get();
    return state.assignments?.[sessionId] ? structuredClone(state.assignments[sessionId]) : undefined;
  }

  async removeAssignment(sessionId: string): Promise<void> {
    const state = await this.store.get();
    if (!state.assignments?.[sessionId]) return;
    delete state.assignments[sessionId];
    await this.store.set(state);
  }

  async listAssignments(): Promise<SessionExecutionAssignment[]> {
    const state = await this.store.get();
    return Object.values(state.assignments ?? {}).map((value) => structuredClone(value));
  }

  async repairAssignments(exists: (assignment: SessionExecutionAssignment) => Promise<boolean>): Promise<string[]> {
    const state = await this.store.get();
    const removed: string[] = [];
    for (const [sessionId, assignment] of Object.entries(state.assignments ?? {})) {
      if (await exists(assignment)) continue;
      delete state.assignments[sessionId];
      removed.push(sessionId);
    }
    if (removed.length) await this.store.set(state);
    return removed;
  }
}

function builtin(id: string, name: string, description: string, patch: Partial<SessionExecutionProfile>): SessionExecutionProfile {
  return normalizeProfile({
    id, name, description, scope: "builtin", readOnly: true, effort: "", mode: "agent", allowTools: [], denyTools: [],
    webSearch: "default", subagents: true, memory: false, worktree: false, allowedPersonaIds: [], subagentIsolation: "workspace", ...patch,
  });
}

function normalizeStoredProfile(profile: SessionExecutionProfile): SessionExecutionProfile { return normalizeProfile(profile); }

function normalizeProfile(profile: SessionExecutionProfile): SessionExecutionProfile {
  return {
    ...profile,
    name: profile.name?.trim(),
    description: profile.description?.trim() || undefined,
    agentId: profile.agentId?.trim() || undefined,
    modelId: profile.modelId?.trim() || undefined,
    effort: profile.effort ?? "",
    mode: profile.mode ?? "agent",
    allowTools: unique(profile.allowTools ?? []),
    denyTools: unique(profile.denyTools ?? []),
    sandbox: profile.sandbox?.trim() || undefined,
    webSearch: profile.webSearch ?? "default",
    subagents: profile.subagents ?? true,
    memory: profile.memory ?? false,
    worktree: profile.worktree ?? false,
    worktreeRef: profile.worktreeRef?.trim() || undefined,
    additionalRules: profile.additionalRules?.trim() || undefined,
    allowedPersonaIds: unique(profile.allowedPersonaIds ?? []),
    subagentIsolation: profile.subagentIsolation ?? "workspace",
  };
}

function validateProfile(profile: SessionExecutionProfile): void {
  if (!profile.id?.trim() || profile.id.length > 160 || /[\0\r\n]/.test(profile.id)) throw new Error("执行配置档 ID 无效");
  if (!profile.name || profile.name.length > 80 || /[\0\r\n]/.test(profile.name)) throw new Error("执行配置档名称不能为空且不得超过 80 个字符");
  if (!REASONING_EFFORTS.includes(profile.effort)) throw new Error("推理强度无效");
  if (!(profile.mode === "agent" || profile.mode === "plan" || profile.mode === "auto")) throw new Error("会话模式无效");
  if (!(profile.webSearch === "default" || profile.webSearch === "enabled" || profile.webSearch === "disabled")) throw new Error("联网搜索策略无效");
  if (!(profile.subagentIsolation === "workspace" || profile.subagentIsolation === "worktree")) throw new Error("子 Agent 隔离策略无效");
  if (profile.maxTurns !== undefined && (!Number.isInteger(profile.maxTurns) || profile.maxTurns < 1 || profile.maxTurns > 1000)) throw new Error("最大轮次必须是 1–1000 的整数");
  if (profile.additionalRules && Buffer.byteLength(profile.additionalRules, "utf8") > 64 * 1024) throw new Error("追加规则超过 64 KiB 限制");
  for (const value of [...profile.allowTools, ...profile.denyTools, ...profile.allowedPersonaIds]) if (!value || value.length > 160 || /[\0\r\n]/.test(value)) throw new Error("工具或 Persona 标识无效");
  if (profile.sandbox && (!/^[A-Za-z0-9._-]+$/.test(profile.sandbox) || profile.sandbox.length > 80)) throw new Error("Sandbox 配置名称无效");
  if (profile.worktreeRef && (/\0|[\r\n]/.test(profile.worktreeRef) || profile.worktreeRef.length > 240)) throw new Error("Worktree 基础 Ref 无效");
}

function runtimeAgentMarkdown(profile: SessionExecutionProfile, agent?: AgentDefinition): string {
  const denied = unique([
    ...(agent?.disallowedTools ?? []),
    ...profile.denyTools,
    ...(profile.webSearch === "disabled" ? ["web_search", "web_fetch"] : []),
    ...(!profile.subagents ? ["Agent"] : []),
  ]);
  const tools = profile.allowTools.length ? profile.allowTools : agent?.tools ?? [];
  const fields = [
    "---",
    `name: ${yamlScalar(`desktop-${profile.id}`)}`,
    `description: ${yamlScalar(profile.description || `Grok Build Desktop 执行配置档：${profile.name}`)}`,
    `model: ${yamlScalar(profile.modelId || agent?.modelId || "inherit")}`,
    `prompt_mode: ${agent?.promptMode ?? "extend"}`,
    `permission_mode: ${profile.mode === "plan" ? "plan" : profile.mode === "auto" ? "auto" : agent?.permissionMode || "default"}`,
    "agents_md: true",
    ...yamlList("tools", tools),
    ...yamlList("disallowed_tools", denied),
    ...yamlList("skills", agent?.skills ?? []),
    "---",
    "",
    agent?.instructions?.trim() || "遵循当前会话的用户要求与项目规则。",
    "",
  ];
  return fields.join("\n");
}

function yamlList(name: string, values: string[]): string[] { return values.length ? [`${name}:`, ...values.map((value) => `  - ${yamlScalar(value)}`)] : []; }
function yamlScalar(value: string): string { return JSON.stringify(value); }
function unique(values: string[]): string[] { return [...new Set(values.map((value) => value.trim()).filter(Boolean))]; }
function profileNameKey(value: string): string { return value.normalize("NFKC").trim().toLocaleLowerCase(); }
function supported(mapping?: string): ExecutionProfileFieldSupport { return { state: "supported", ...(mapping ? { mapping } : {}) }; }
function mappingFor(field: ExecutionProfileField): string {
  if (field === "agentId" || field === "allowTools" || field === "denyTools" || field === "webSearch") return "grok agent --agent-profile";
  if (field === "modelId") return "grok agent --model";
  if (field === "effort") return "grok agent --reasoning-effort";
  if (field === "mode") return "ACP session/set_mode + permission policy";
  if (field === "sandbox") return "GROK_SANDBOX";
  if (field === "subagents") return "GROK_SUBAGENTS";
  if (field === "memory") return "GROK_MEMORY";
  if (field === "worktree" || field === "worktreeRef") return "x.ai/git/worktree/create or git worktree fallback";
  if (field === "additionalRules") return "session/new._meta.rules";
  return "";
}

async function workspaceIdentity(workspacePath: string): Promise<string> {
  const canonical = await realpath(resolve(workspacePath));
  if (!(await stat(canonical)).isDirectory()) throw new Error("工作区路径无效");
  try {
    const { stdout } = await execFileAsync("git", ["-C", canonical, "remote", "get-url", "origin"], { windowsHide: true, shell: false, encoding: "utf8", maxBuffer: 1024 * 1024 });
    const normalized = normalizeRemote(String(stdout).trim());
    if (normalized) return normalized;
  } catch { /* non-Git workspaces use their canonical path */ }
  return canonical;
}

function normalizeRemote(value: string): string | undefined {
  const scp = /^[^@\s]+@[^:\s]+:(.+)$/.exec(value);
  let path = scp?.[1];
  if (!path) {
    try { path = new URL(value).pathname.replace(/^\//, ""); } catch { return undefined; }
  }
  const result = path.replace(/\\/g, "/").replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
  return result.includes("/") ? result.toLocaleLowerCase() : undefined;
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temp, content, { encoding: "utf8", mode: 0o600 });
    try { await rename(temp, path); }
    catch (error) {
      if (!(["EEXIST", "EPERM"] as string[]).includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      await rm(path, { force: true });
      await rename(temp, path);
    }
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

export const executionProfileInternals = { BUILTIN_PROFILES, normalizeRemote, runtimeAgentMarkdown, validateProfile };
