import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parse, stringify, type TomlTable } from "smol-toml";
import type { CustomProviderInput, CustomProviderProfile, ProviderConnectionDraft, ProviderConnectivityResult, ProviderDraftProbeResult, ProviderModelCandidate, ProviderModelDefinition } from "../../shared/types";
import { JsonStore } from "./json-store";
import type { LogService } from "./log-service";

const START = "# >>> Grok Build Desktop managed models >>>";
const END = "# <<< Grok Build Desktop managed models <<<";
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

interface ProviderStoreData { providers: CustomProviderProfile[]; }

export interface ProviderEnvironment {
  read(name: string): Promise<string | undefined>;
  write(name: string, value: string | undefined): Promise<void>;
}

export interface ProviderServiceOptions {
  grokHome?: string;
  fetcher?: typeof fetch;
  environment?: ProviderEnvironment;
  validateConfig?: () => Promise<void>;
  reloadModels?: () => Promise<void>;
  references?: (providerId: string) => Promise<string[]>;
  probeTimeoutMs?: number;
  maxProbeResponseBytes?: number;
}

export class ProviderService {
  private readonly configPath: string;
  private readonly store: JsonStore<ProviderStoreData>;
  private readonly fetcher: typeof fetch;
  private readonly environment: ProviderEnvironment;

  constructor(userDataPath: string, private readonly log: LogService, private readonly options: ProviderServiceOptions = {}) {
    this.configPath = join(options.grokHome ?? join(homedir(), ".grok"), "config.toml");
    this.store = new JsonStore(join(userDataPath, "providers.json"), { providers: [] });
    this.fetcher = options.fetcher ?? fetch;
    this.environment = options.environment ?? new WindowsUserEnvironment();
  }

  async list(): Promise<CustomProviderProfile[]> {
    const managed = (await this.store.get()).providers;
    const managedModels = new Set(managed.flatMap((provider) => provider.models.map((model) => model.id)));
    const external = await this.readExternalProviders(managedModels);
    const values = await Promise.all([...managed, ...external].map(async (provider) => ({
      ...provider,
      hasCredential: provider.credentialMode === "none" ? true : Boolean(provider.credentialEnv && await this.environment.read(provider.credentialEnv)),
    })));
    return values.sort((a, b) => Number(b.owned) - Number(a.owned) || a.name.localeCompare(b.name, "zh-CN"));
  }

  async upsert(input: CustomProviderInput): Promise<CustomProviderProfile[]> {
    validateInput(input);
    const originalConfig = await readFile(this.configPath, "utf8").catch(() => "");
    const originalHash = hash(originalConfig);
    const data = await this.store.get();
    const previous = data.providers.find((value) => value.id === input.id);
    const existingEnvName = previous?.credentialEnv;
    const envName = input.credentialMode === "managed" ? managedEnvironmentName(input.id) : input.credentialMode === "existing" ? normalizeEnvironmentName(input.credentialEnv || "") : undefined;
    const previousSecret = envName ? await this.environment.read(envName) : undefined;
    const previousExistingSecret = existingEnvName && existingEnvName !== envName ? await this.environment.read(existingEnvName) : previousSecret;
    if (input.credentialMode === "managed" && !input.credentialValue && !previousSecret) throw new Error("请输入提供商密钥");
    await this.assertNoExternalCollision(input, originalConfig, data.providers);
    const now = new Date().toISOString();
    const profile: CustomProviderProfile = {
      id: input.id,
      name: input.name.trim(),
      baseUrl: normalizeBaseUrl(input.baseUrl),
      modelListUrl: input.modelListUrl?.trim() || undefined,
      protocol: input.protocol,
      authScheme: input.authScheme,
      credentialMode: input.credentialMode,
      credentialEnv: envName,
      extraHeaders: normalizeHeaders(input.extraHeaders),
      models: input.models.map(normalizeModel),
      owned: true,
      hasCredential: input.credentialMode === "none" || Boolean(input.credentialValue || previousSecret),
      insecureHttp: isInsecureRemote(input.baseUrl),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    const nextProviders = [...data.providers.filter((value) => value.id !== profile.id), profile];
    let environmentChanged = false;
    let previousEnvironmentCleared = false;
    let storeChanged = false;
    try {
      if (input.credentialMode === "managed" && input.credentialValue) {
        await this.environment.write(envName!, input.credentialValue);
        environmentChanged = true;
      }
      if (existingEnvName && existingEnvName !== envName && !nextProviders.some((value) => value.credentialEnv === existingEnvName)) {
        await this.environment.write(existingEnvName, undefined);
        previousEnvironmentCleared = true;
      }
      await this.replaceManagedBlock(originalConfig, nextProviders, originalHash);
      await this.options.validateConfig?.();
      await this.store.set({ providers: nextProviders });
      storeChanged = true;
      await this.rotateBackups();
      await this.options.reloadModels?.();
      return this.list();
    } catch (error) {
      await this.restoreConfig(originalConfig).catch((rollbackError) => this.log.log(`提供商配置文件回滚失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`));
      if (storeChanged) await this.store.set(data).catch((rollbackError) => this.log.log(`提供商索引回滚失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`));
      if (environmentChanged && envName) await this.environment.write(envName, previousSecret).catch((rollbackError) => this.log.log(`提供商凭据回滚失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`));
      if (previousEnvironmentCleared && existingEnvName) await this.environment.write(existingEnvName, previousExistingSecret).catch((rollbackError) => this.log.log(`旧提供商凭据回滚失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`));
      await this.log.log(`提供商配置回滚：${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async remove(id: string): Promise<CustomProviderProfile[]> {
    const references = await this.options.references?.(id) ?? [];
    if (references.length) throw new Error(`提供商仍被引用：${references.join("、")}`);
    const data = await this.store.get();
    const target = data.providers.find((value) => value.id === id);
    if (!target) throw new Error("只能移除由 Grok Build Desktop 管理的提供商");
    const originalConfig = await readFile(this.configPath, "utf8").catch(() => "");
    const nextProviders = data.providers.filter((value) => value.id !== id);
    const removeEnvironment = Boolean(target.credentialMode === "managed" && target.credentialEnv && !nextProviders.some((value) => value.credentialEnv === target.credentialEnv));
    const previousSecret = removeEnvironment && target.credentialEnv ? await this.environment.read(target.credentialEnv) : undefined;
    let storeChanged = false;
    let environmentChanged = false;
    try {
      await this.replaceManagedBlock(originalConfig, nextProviders, hash(originalConfig));
      await this.options.validateConfig?.();
      await this.store.set({ providers: nextProviders });
      storeChanged = true;
      if (removeEnvironment && target.credentialEnv) {
        await this.environment.write(target.credentialEnv, undefined);
        environmentChanged = true;
      }
      await this.rotateBackups();
      await this.options.reloadModels?.();
      return this.list();
    } catch (error) {
      await this.restoreConfig(originalConfig).catch((rollbackError) => this.log.log(`提供商配置文件回滚失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`));
      if (storeChanged) await this.store.set(data).catch((rollbackError) => this.log.log(`提供商索引回滚失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`));
      if (environmentChanged && target.credentialEnv) await this.environment.write(target.credentialEnv, previousSecret).catch((rollbackError) => this.log.log(`提供商凭据回滚失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`));
      throw error;
    }
  }

  async test(id: string): Promise<ProviderConnectivityResult> {
    const provider = (await this.store.get()).providers.find((value) => value.id === id);
    if (!provider) throw new Error("提供商不存在或为只读外部配置");
    const result = await this.probeDraft({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      modelListUrl: provider.modelListUrl,
      protocol: provider.protocol,
      authScheme: provider.authScheme,
      credentialMode: provider.credentialMode,
      credentialEnv: provider.credentialEnv,
      allowInsecureHttp: provider.insecureHttp,
      headers: Object.entries(provider.extraHeaders).map(([name, value]) => ({ name, source: "environment", value })),
      models: provider.models,
    });
    return { ok: result.ok, checkedAt: result.checkedAt, latencyMs: result.latencyMs, status: result.status, message: result.message, models: result.models };
  }

  async pullModels(id: string): Promise<Array<{ id: string; name?: string }>> {
    const result = await this.test(id);
    if (!result.ok) throw new Error(result.message);
    return result.models;
  }

  async probeDraft(input: ProviderConnectionDraft): Promise<ProviderDraftProbeResult> {
    validateDraft(input);
    const endpoint = draftModelListUrl(input);
    const warnings: string[] = [];
    if (input.protocol === "messages" && !input.modelListUrl?.trim()) warnings.push("Anthropic Messages 服务不一定提供标准模型列表端点；失败时可手工添加模型。 ");
    const started = Date.now();
    try {
      const response = await this.fetcher(endpoint, {
        method: "GET",
        headers: await this.draftHeaders(input),
        redirect: "manual",
        signal: AbortSignal.timeout(this.options.probeTimeoutMs ?? 15_000),
      });
      if (response.status >= 300 && response.status < 400) {
        return { ok: false, checkedAt: new Date().toISOString(), latencyMs: Date.now() - started, status: response.status, message: "模型列表端点返回重定向，已拒绝跨源跟随", models: [], endpoint, warnings, candidates: [] };
      }
      const body = await readLimitedResponse(response, this.options.maxProbeResponseBytes ?? 2 * 1024 * 1024);
      const models = response.ok ? parseModelList(body) : [];
      const existing = (await this.list()).flatMap((provider) => provider.models.map((model) => ({ providerId: provider.id, localId: model.id, remoteId: model.model })));
      const occupied = new Set(existing.map((value) => value.localId));
      const candidates = models.map((model) => {
        const configured = existing.find((value) => value.providerId === input.id && value.remoteId === model.id);
        return {
          remoteId: model.id,
          localId: configured?.localId ?? providerModelLocalId(input.id, model.id, occupied),
          name: model.name || model.id,
          description: model.description,
          ownedBy: model.ownedBy,
          contextWindow: model.contextWindow,
          alreadyConfigured: Boolean(configured),
        } satisfies ProviderModelCandidate;
      });
      if (response.ok && !candidates.length) warnings.push("服务连接成功，但模型列表中没有可识别的模型；可手工补充。 ");
      return {
        ok: response.ok,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        status: response.status,
        message: response.ok ? `连接成功，发现 ${candidates.length} 个模型` : response.status === 401 || response.status === 403 ? `认证失败（HTTP ${response.status}）` : `服务返回 HTTP ${response.status}`,
        models: models.map(({ id, name }) => ({ id, name })),
        endpoint,
        warnings,
        candidates,
      };
    } catch (error) {
      return { ok: false, checkedAt: new Date().toISOString(), latencyMs: Date.now() - started, message: error instanceof Error ? error.message : String(error), models: [], endpoint, warnings, candidates: [] };
    }
  }

  async discoverDraftModels(input: ProviderConnectionDraft): Promise<ProviderModelCandidate[]> {
    const result = await this.probeDraft(input);
    if (!result.ok) throw new Error(result.message);
    return result.candidates;
  }

  async setCliDefault(modelId: string): Promise<CustomProviderProfile[]> {
    const data = await this.store.get();
    if (!data.providers.some((provider) => provider.models.some((model) => model.id === modelId))) throw new Error("只能选择由应用管理的模型作为 CLI 默认值");
    const original = await readFile(this.configPath, "utf8").catch(() => "");
    const next = setModelsDefault(original, modelId);
    try {
      await this.atomicWrite(next, hash(original));
      await this.options.validateConfig?.();
      await this.options.reloadModels?.();
      return this.list();
    } catch (error) {
      await this.restoreConfig(original);
      throw error;
    }
  }

  reload(): Promise<void> { return this.options.reloadModels?.() ?? Promise.resolve(); }

  private async draftHeaders(input: ProviderConnectionDraft): Promise<Record<string, string>> {
    const result: Record<string, string> = { Accept: "application/json" };
    const secret = input.credentialMode === "managed"
      ? input.credentialValue || await this.environment.read(managedEnvironmentName(input.id))
      : input.credentialMode === "existing" && input.credentialEnv ? await this.environment.read(normalizeEnvironmentName(input.credentialEnv)) : undefined;
    if (secret) result[input.authScheme === "x_api_key" ? "x-api-key" : "Authorization"] = input.authScheme === "x_api_key" ? secret : `Bearer ${secret}`;
    for (const header of input.headers) {
      const value = await this.environment.read(normalizeEnvironmentName(header.value));
      if (value) result[header.name.trim()] = value;
    }
    return result;
  }

  private async assertNoExternalCollision(input: CustomProviderInput, config: string, managed: CustomProviderProfile[]): Promise<void> {
    const managedIds = new Set(managed.flatMap((provider) => provider.models.map((model) => model.id)));
    let parsed: TomlTable = {};
    try { parsed = config.trim() ? parse(config) : {}; } catch (error) { throw new Error(`现有 config.toml 无法解析：${error instanceof Error ? error.message : String(error)}`); }
    const modelTable = asRecord(parsed.model);
    for (const model of input.models) if (modelTable[model.id] && !managedIds.has(model.id)) throw new Error(`模型 ID“${model.id}”已由外部 config.toml 配置占用`);
  }

  private async replaceManagedBlock(original: string, providers: CustomProviderProfile[], expectedHash: string): Promise<void> {
    const model: Record<string, Record<string, unknown>> = {};
    for (const provider of providers) for (const item of provider.models) {
      const extraHeaders = Object.fromEntries(Object.entries(provider.extraHeaders).map(([key, env]) => [key, `\${${env}}`]));
      // Grok CLI 0.2.102 accepts model-level env expansion but does not yet
      // accept `auth_scheme` in user model overrides. Keep the key in env_key
      // so the model is treated as BYOK, then replace the default bearer header
      // for Anthropic-compatible endpoints without ever writing the key itself.
      if (provider.authScheme === "x_api_key" && provider.credentialEnv) {
        extraHeaders.Authorization = "";
        extraHeaders["x-api-key"] = `\${${provider.credentialEnv}}`;
      }
      model[item.id] = {
        model: item.model,
        base_url: provider.baseUrl,
        name: item.name,
        description: item.description,
        env_key: provider.credentialEnv,
        api_backend: provider.protocol,
        context_window: item.contextWindow,
        max_completion_tokens: item.maxCompletionTokens,
        reasoning_efforts: item.reasoningEfforts?.filter(Boolean).map((value) => ({ value, label: value })),
        extra_headers: Object.keys(extraHeaders).length ? extraHeaders : undefined,
      };
    }
    const managed = Object.keys(model).length ? `${START}\n${stringify({ model }).trim()}\n${END}` : "";
    const without = stripManagedBlock(original).trimEnd();
    const next = [without, managed].filter(Boolean).join("\n\n") + (without || managed ? "\n" : "");
    parse(next || "");
    await this.backup(original);
    await this.atomicWrite(next, expectedHash);
  }

  private async atomicWrite(content: string, expectedHash: string): Promise<void> {
    const current = await readFile(this.configPath, "utf8").catch(() => "");
    if (hash(current) !== expectedHash) throw new Error("config.toml 已被其他程序修改，请重新加载后再试");
    await mkdir(dirname(this.configPath), { recursive: true });
    const temp = `${this.configPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try { await writeFile(temp, content, "utf8"); await rename(temp, this.configPath); }
    catch (error) { await rm(temp, { force: true }).catch(() => undefined); throw error; }
  }

  private async backup(content: string): Promise<void> {
    if (!content) return;
    const path = `${this.configPath}.grok-desktop-${Date.now()}.bak`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  }

  private async rotateBackups(): Promise<void> {
    const { readdir } = await import("node:fs/promises");
    const folder = dirname(this.configPath);
    const files = (await readdir(folder).catch(() => [])).filter((name) => /^config\.toml\.grok-desktop-\d+\.bak$/.test(name)).sort().reverse();
    await Promise.all(files.slice(5).map((name) => rm(join(folder, name), { force: true })));
  }

  private async restoreConfig(content: string): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, content, "utf8");
  }

  private async readExternalProviders(managedModels: Set<string>): Promise<CustomProviderProfile[]> {
    const raw = await readFile(this.configPath, "utf8").catch(() => "");
    let parsed: TomlTable; try { parsed = raw.trim() ? parse(raw) : {}; } catch { return []; }
    const models = asRecord(parsed.model);
    const updatedAt = (await stat(this.configPath).catch(() => undefined))?.mtime.toISOString() ?? new Date(0).toISOString();
    return Object.entries(models).filter(([id]) => !managedModels.has(id)).map(([id, value]) => {
      const item = asRecord(value);
      const envKey = typeof item.env_key === "string" ? item.env_key : undefined;
      const baseUrl = typeof item.base_url === "string" ? item.base_url : "";
      return {
        id: `external-${id}`,
        name: typeof item.name === "string" ? item.name : id,
        baseUrl,
        protocol: item.api_backend === "responses" || item.api_backend === "messages" ? item.api_backend : "chat_completions",
        authScheme: item.auth_scheme === "x_api_key" ? "x_api_key" : "bearer",
        credentialMode: envKey ? "existing" : "none",
        credentialEnv: envKey,
        extraHeaders: {},
        models: [{ id, model: typeof item.model === "string" ? item.model : id, name: typeof item.name === "string" ? item.name : id, contextWindow: typeof item.context_window === "number" ? item.context_window : undefined }],
        owned: false,
        hasCredential: false,
        insecureHttp: baseUrl ? isInsecureRemote(baseUrl) : false,
        createdAt: updatedAt,
        updatedAt,
        diagnostic: "来自外部 config.toml，仅供查看",
      };
    });
  }
}

export class WindowsUserEnvironment implements ProviderEnvironment {
  async read(name: string): Promise<string | undefined> {
    const inherited = process.env[name];
    if (inherited !== undefined) return inherited;
    if (process.platform !== "win32") return undefined;
    const value = await new Promise<string | undefined>((resolve) => {
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[Console]::Out.Write([Environment]::GetEnvironmentVariable($args[0],[EnvironmentVariableTarget]::User))", name], { windowsHide: true, timeout: 10_000 }, (error, stdout) => resolve(error ? undefined : String(stdout)));
    });
    if (value !== undefined && value !== "") process.env[name] = value;
    return value || undefined;
  }
  async write(name: string, value: string | undefined): Promise<void> {
    if (process.platform !== "win32") { if (value === undefined) delete process.env[name]; else process.env[name] = value; return; }
    const script = "$payload=[Console]::In.ReadToEnd()|ConvertFrom-Json;[Environment]::SetEnvironmentVariable($payload.name,$payload.value,[EnvironmentVariableTarget]::User);$sig='[DllImport(\"user32.dll\",SetLastError=true,CharSet=CharSet.Auto)]public static extern IntPtr SendMessageTimeout(IntPtr hWnd,uint Msg,UIntPtr wParam,string lParam,uint flags,uint timeout,out UIntPtr result);';$t=Add-Type -MemberDefinition $sig -Name NativeMethods -Namespace GrokDesktop -PassThru;$r=[UIntPtr]::Zero;[void]$t::SendMessageTimeout([IntPtr]0xffff,0x1A,[UIntPtr]::Zero,'Environment',2,5000,[ref]$r)";
    await new Promise<void>((resolve, reject) => {
      const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
      let error = ""; child.stderr.setEncoding("utf8"); child.stderr.on("data", (chunk) => { error += chunk; });
      child.on("error", reject); child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(error.trim() || `写入用户环境变量失败（${code}）`)));
      child.stdin.end(JSON.stringify({ name, value: value ?? null }));
    });
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
}

export async function validateGrokConfig(cliPath: string, cwd = process.cwd()): Promise<void> {
  await exec(cliPath, ["inspect", "--json"], cwd);
  await exec(cliPath, ["models"], cwd);
}

function exec(file: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => execFile(file, args, { cwd, windowsHide: true, timeout: 30_000, env: process.env }, (error, _stdout, stderr) => error ? reject(new Error(String(stderr || error.message).trim())) : resolve()));
}

function validateInput(input: CustomProviderInput): void {
  validateConnection(input);
  if (!input.models.length) throw new Error("至少配置一个模型");
  const seen = new Set<string>();
  for (const model of input.models) {
    if (!ID_PATTERN.test(model.id)) throw new Error(`无效模型 ID：${model.id}`);
    if (seen.has(model.id)) throw new Error(`模型 ID 重复：${model.id}`); seen.add(model.id);
    if (!model.model.trim() || !model.name.trim()) throw new Error("模型路由 ID 和显示名称不能为空");
    if (model.contextWindow !== undefined && (!Number.isInteger(model.contextWindow) || model.contextWindow < 1024)) throw new Error("上下文窗口必须是不小于 1024 的整数");
    if (model.maxCompletionTokens !== undefined && (!Number.isInteger(model.maxCompletionTokens) || model.maxCompletionTokens < 1)) throw new Error("最大输出必须是正整数");
    if (model.reasoningEfforts?.some((value) => !["none", "minimal", "low", "medium", "high", "xhigh"].includes(value))) throw new Error("推理强度包含不支持的值");
  }
  if (input.credentialMode === "existing") normalizeEnvironmentName(input.credentialEnv || "");
  for (const [header, env] of Object.entries(input.extraHeaders)) { if (!header.trim()) throw new Error("请求头名称不能为空"); normalizeEnvironmentName(env); }
}

function validateDraft(input: ProviderConnectionDraft): void {
  validateConnection(input);
  const seen = new Set<string>();
  for (const header of input.headers) {
    const name = header.name.trim().toLocaleLowerCase();
    if (!name || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) throw new Error("请求头名称格式无效");
    if (seen.has(name)) throw new Error(`请求头重复：${header.name}`);
    seen.add(name);
    normalizeEnvironmentName(header.value);
  }
}

function validateConnection(input: Pick<CustomProviderInput, "id" | "name" | "baseUrl" | "modelListUrl" | "credentialMode" | "credentialEnv" | "allowInsecureHttp">): void {
  if (!ID_PATTERN.test(input.id)) throw new Error("提供商 ID 只能包含字母、数字、点、下划线和连字符");
  if (!input.name.trim()) throw new Error("请输入提供商名称");
  const url = new URL(input.baseUrl);
  if (!/^https?:$/.test(url.protocol)) throw new Error("提供商地址只支持 HTTP 或 HTTPS");
  if (isInsecureRemote(input.baseUrl) && !input.allowInsecureHttp) throw new Error("非本机 HTTP 地址需要明确确认不安全连接");
  if (input.modelListUrl?.trim()) {
    const modelUrl = new URL(input.modelListUrl);
    if (!/^https?:$/.test(modelUrl.protocol)) throw new Error("模型列表地址只支持 HTTP 或 HTTPS");
    if (isInsecureRemote(input.modelListUrl) && !input.allowInsecureHttp) throw new Error("非本机 HTTP 模型列表地址需要明确确认不安全连接");
  }
  if (input.credentialMode === "existing") normalizeEnvironmentName(input.credentialEnv || "");
}

function normalizeModel(value: ProviderModelDefinition): ProviderModelDefinition { return { ...value, id: value.id.trim(), model: value.model.trim(), name: value.name.trim(), description: value.description?.trim() || undefined, reasoningEfforts: value.reasoningEfforts?.filter(Boolean) }; }
function normalizeHeaders(value: Record<string, string>): Record<string, string> { return Object.fromEntries(Object.entries(value).filter(([key, env]) => key.trim() && env.trim()).map(([key, env]) => [key.trim(), normalizeEnvironmentName(env)])); }
function normalizeEnvironmentName(value: string): string { const normalized = value.trim().toUpperCase(); if (!/^[A-Z_][A-Z0-9_]*$/.test(normalized)) throw new Error("环境变量名格式无效"); return normalized; }
function managedEnvironmentName(id: string): string { return `GROK_DESKTOP_PROVIDER_${id}`.toUpperCase().replace(/[^A-Z0-9_]/g, "_") + "_KEY"; }
function normalizeBaseUrl(value: string): string { return value.trim().replace(/\/+$/, ""); }
function isInsecureRemote(value: string): boolean { const url = new URL(value); return url.protocol === "http:" && !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname.toLowerCase()); }
function draftModelListUrl(provider: ProviderConnectionDraft): string { return provider.modelListUrl?.trim() || `${provider.baseUrl.trim().replace(/\/+$/, "")}/models`; }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function stripManagedBlock(value: string): string { return value.replace(new RegExp(`${escapeRegex(START)}[\\s\\S]*?${escapeRegex(END)}\\s*`, "g"), ""); }
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function asRecord(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
function parseModelList(raw: string): Array<{ id: string; name?: string; description?: string; ownedBy?: string; contextWindow?: number }> {
  const parsed = JSON.parse(raw) as any;
  const values = Array.isArray(parsed) ? parsed : Array.isArray(parsed.data) ? parsed.data : Array.isArray(parsed.models) ? parsed.models : [];
  const seen = new Set<string>();
  return values.map((value: any) => typeof value === "string" ? { id: value } : {
    id: String(value.id || value.model || value.name || ""),
    name: typeof value.name === "string" ? value.name : typeof value.display_name === "string" ? value.display_name : undefined,
    description: typeof value.description === "string" ? value.description : undefined,
    ownedBy: typeof value.owned_by === "string" ? value.owned_by : typeof value.ownedBy === "string" ? value.ownedBy : undefined,
    contextWindow: Number.isInteger(value.context_window) ? value.context_window : Number.isInteger(value.contextWindow) ? value.contextWindow : undefined,
  }).filter((value: { id: string }) => Boolean(value.id) && !seen.has(value.id) && Boolean(seen.add(value.id)));
}

async function readLimitedResponse(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new Error("模型列表响应过大，已停止读取");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > limit) throw new Error("模型列表响应过大，已停止读取");
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export function providerModelLocalId(providerId: string, remoteId: string, occupied: Set<string> = new Set()): string {
  const prefix = providerId.toLocaleLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "provider";
  const remote = remoteId.toLocaleLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "model";
  const base = `${prefix}-${remote}`.slice(0, 64).replace(/[-._]+$/, "") || "provider-model";
  if (!occupied.has(base)) { occupied.add(base); return base; }
  const suffix = hash(`${providerId}\0${remoteId}`).slice(0, 8);
  const candidate = `${base.slice(0, Math.max(1, 63 - suffix.length)).replace(/[-._]+$/, "")}-${suffix}`;
  occupied.add(candidate);
  return candidate;
}
function setModelsDefault(config: string, modelId: string): string {
  const escaped = JSON.stringify(modelId);
  const lines = config.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*\[models\]\s*(?:#.*)?$/.test(line));
  if (start < 0) return `[models]\ndefault = ${escaped}\n\n${config.trimStart()}`.trimEnd() + "\n";
  let end = lines.length; for (let index = start + 1; index < lines.length; index++) if (/^\s*\[/.test(lines[index]!)) { end = index; break; }
  const existing = lines.slice(start + 1, end).findIndex((line) => /^\s*default\s*=/.test(line));
  if (existing >= 0) lines[start + 1 + existing] = `default = ${escaped}`; else lines.splice(start + 1, 0, `default = ${escaped}`);
  return lines.join("\n").replace(/\n*$/, "\n");
}
