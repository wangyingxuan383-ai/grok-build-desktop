import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parse, stringify, type TomlTable } from "smol-toml";
import type {
  CustomProviderInput,
  CustomProviderProfile,
  CapabilityApplicationDraft,
  CapabilityApplicationSelection,
  ProviderCapabilitySnapshot,
  ProviderCompatibilityFlavor,
  ProviderConnectionDraft,
  ProviderContextProbeOptions,
  ProviderContextProbeResult,
  ProviderConnectivityResult,
  ProviderDeepScanOptions,
  ProviderDeepScanResult,
  ProviderDraftProbeResult,
  ProviderModelCandidate,
  ProviderModelCapabilityProfile,
  ProviderModelDefinition,
  ProviderProtocol,
  ProviderProtocolCapability,
  ProviderProxyMode,
  ProviderScanJob,
  ProviderScanProgress,
  ProviderScanScope,
  ProviderScanStage,
  ReasoningEffort,
  MediaArtifact,
  MediaAspectRatio,
  ProviderImageTransport,
  ProviderModelMediaConfiguration,
} from "../../shared/types";
import { DEFAULT_PROVIDER_INFERENCE_IDLE_TIMEOUT_SECONDS, providerReasoningEfforts } from "../../shared/provider-model-capabilities";
import { compatibilityReasoningTransport, inferCompatibilityFlavor, PROVIDER_PROTOCOLS, PROVIDER_REASONING_LEVELS } from "../../shared/provider-compatibility";
import { JsonStore } from "./json-store";
import type { LogService } from "./log-service";
import { ProviderGatewayService } from "./provider-gateway-service";

const START = "# >>> Grok Build Desktop managed models >>>";
const END = "# <<< Grok Build Desktop managed models <<<";
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

interface ProviderStoreData { providers: CustomProviderProfile[]; }
interface ProviderCapabilityStoreData { snapshots: ProviderCapabilitySnapshot[]; }

export type ProviderFetcher = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
  proxyMode?: ProviderProxyMode,
) => Promise<Response>;

export interface ProviderEnvironment {
  read(name: string): Promise<string | undefined>;
  readFresh?(name: string): Promise<string | undefined>;
  write(name: string, value: string | undefined): Promise<void>;
}

export interface ProviderServiceOptions {
  grokHome?: string;
  fetcher?: ProviderFetcher;
  environment?: ProviderEnvironment;
  validateConfig?: () => Promise<void>;
  reloadModels?: () => Promise<void>;
  references?: (providerId: string) => Promise<string[]>;
  probeTimeoutMs?: number;
  maxProbeResponseBytes?: number;
  onScanProgress?: (progress: ProviderScanProgress) => void;
}

export class ProviderService {
  private readonly configPath: string;
  private readonly store: JsonStore<ProviderStoreData>;
  private readonly capabilityStore: JsonStore<ProviderCapabilityStoreData>;
  private readonly fetcher: ProviderFetcher;
  private readonly environment: ProviderEnvironment;
  private readonly gateway: ProviderGatewayService;
  private readonly scanControllers = new Map<string, { controller: AbortController; jobId?: string; generation: number }>();
  private readonly scanGenerations = new Map<string, number>();
  private readonly scanJobs = new Map<string, ProviderScanJob>();

  constructor(userDataPath: string, private readonly log: LogService, private readonly options: ProviderServiceOptions = {}) {
    this.configPath = join(options.grokHome ?? join(homedir(), ".grok"), "config.toml");
    this.store = new JsonStore(join(userDataPath, "providers.json"), { providers: [] });
    this.capabilityStore = new JsonStore(join(userDataPath, "provider-capabilities.json"), { snapshots: [] });
    this.fetcher = options.fetcher ?? fetch;
    this.environment = options.environment ?? new DesktopUserEnvironment();
    this.gateway = new ProviderGatewayService({
      providers: async () => (await this.store.get()).providers,
      environment: async (name) => this.environment.readFresh ? this.environment.readFresh(name) : this.environment.read(name),
      fetcher: this.fetcher,
      log: this.log,
    });
  }

  async list(): Promise<CustomProviderProfile[]> {
    const managed = (await this.store.get()).providers;
    const snapshots = (await this.capabilityStore.get()).snapshots;
    const managedModels = new Set(managed.flatMap((provider) => provider.models.map((model) => model.id)));
    const external = await this.readExternalProviders(managedModels);
    const values = await Promise.all([...managed, ...external].map(async (provider) => ({
      ...provider,
      enabled: provider.enabled !== false,
      proxyMode: provider.proxyMode ?? "inherit",
      models: provider.owned ? provider.models.map((model) => ({
        ...model,
        enabled: model.enabled !== false,
        inferenceIdleTimeoutSeconds: providerInferenceIdleTimeoutSeconds(model),
        reasoningEfforts: providerReasoningEfforts(model.model, model.reasoningEfforts),
        capabilities: snapshots.find((snapshot) => snapshot.providerId === provider.id)?.models.find((capability) => capability.modelId === model.id) ?? model.capabilities,
      })) : provider.models,
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
    const baseUrlEnv = managedBaseUrlEnvironmentName(input.id);
    const previousBaseUrl = await this.environment.read(baseUrlEnv);
    const previousExistingSecret = existingEnvName && existingEnvName !== envName ? await this.environment.read(existingEnvName) : previousSecret;
    if (input.credentialMode === "managed" && !input.credentialValue && !previousSecret) throw new Error("请输入提供商密钥");
    await this.assertNoExternalCollision(input, originalConfig, data.providers);
    const now = new Date().toISOString();
    const profile: CustomProviderProfile = {
      enabled: input.models.length > 0 && input.enabled !== false,
      id: input.id,
      name: input.name.trim(),
      baseUrl: normalizeBaseUrl(input.baseUrl),
      modelListUrl: input.modelListUrl?.trim() || undefined,
      protocol: input.protocol,
      upstreamProtocol: input.upstreamProtocol ?? protocolUpstreamDefault(input.protocol),
      schemaProfile: input.schemaProfile ?? "standard",
      compatibilityFlavor: input.compatibilityFlavor ?? "auto",
      proxyMode: input.proxyMode ?? "inherit",
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
      if (previousBaseUrl !== profile.baseUrl) await this.environment.write(baseUrlEnv, profile.baseUrl);
      if (existingEnvName && existingEnvName !== envName && !nextProviders.some((value) => value.credentialEnv === existingEnvName)) {
        await this.environment.write(existingEnvName, undefined);
        previousEnvironmentCleared = true;
      }
      await this.replaceManagedBlock(originalConfig, nextProviders, originalHash, data.providers);
      await this.options.validateConfig?.();
      await this.store.set({ providers: nextProviders });
      storeChanged = true;
      await this.markCapabilitiesExpired(profile);
      await this.rotateBackups();
      await this.options.reloadModels?.();
      return this.list();
    } catch (error) {
      await this.restoreConfig(originalConfig).catch((rollbackError) => this.log.log(`提供商配置文件回滚失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`));
      if (storeChanged) await this.store.set(data).catch((rollbackError) => this.log.log(`提供商索引回滚失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`));
      if (environmentChanged && envName) await this.environment.write(envName, previousSecret).catch((rollbackError) => this.log.log(`提供商凭据回滚失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`));
      if (previousEnvironmentCleared && existingEnvName) await this.environment.write(existingEnvName, previousExistingSecret).catch((rollbackError) => this.log.log(`旧提供商凭据回滚失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`));
      if (previousBaseUrl !== profile.baseUrl) await this.environment.write(baseUrlEnv, previousBaseUrl).catch((rollbackError) => this.log.log(`提供商地址环境变量回滚失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`));
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
    const baseUrlEnv = managedBaseUrlEnvironmentName(target.id);
    const previousBaseUrl = await this.environment.read(baseUrlEnv);
    let storeChanged = false;
    let environmentChanged = false;
    try {
      await this.replaceManagedBlock(originalConfig, nextProviders, hash(originalConfig), data.providers);
      await this.options.validateConfig?.();
      await this.store.set({ providers: nextProviders });
      storeChanged = true;
      const capabilities = await this.capabilityStore.get();
      await this.capabilityStore.set({ snapshots: capabilities.snapshots.filter((value) => value.providerId !== id) });
      if (removeEnvironment && target.credentialEnv) {
        await this.environment.write(target.credentialEnv, undefined);
        environmentChanged = true;
      }
      await this.environment.write(baseUrlEnv, undefined);
      await this.rotateBackups();
      await this.options.reloadModels?.();
      return this.list();
    } catch (error) {
      await this.restoreConfig(originalConfig).catch((rollbackError) => this.log.log(`提供商配置文件回滚失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`));
      if (storeChanged) await this.store.set(data).catch((rollbackError) => this.log.log(`提供商索引回滚失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`));
      if (environmentChanged && target.credentialEnv) await this.environment.write(target.credentialEnv, previousSecret).catch((rollbackError) => this.log.log(`提供商凭据回滚失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`));
      await this.environment.write(baseUrlEnv, previousBaseUrl).catch((rollbackError) => this.log.log(`提供商地址环境变量回滚失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`));
      throw error;
    }
  }

  /**
   * Session-launch path. Refresh credential/header values from their declared
   * user-environment source instead of trusting the Electron process snapshot:
   * a provider key can be rotated after the app starts. The Renderer never
   * receives this object; it is merged only into the spawned CLI process.
   */
  async desktopEnvironment(scopeId: string = randomUUID()): Promise<Record<string, string>> {
    const storedProviders = (await this.store.get()).providers;
    const providers = storedProviders.filter((provider) => provider.enabled !== false && provider.models.some((model) => model.enabled !== false));
    if (!providers.length) return {};
    const config = await readFile(this.configPath, "utf8").catch(() => "");
    let needsMigration = managedCapabilitiesOutdated(config, providers);
    const environment: Record<string, string> = {};
    for (const provider of providers) {
      for (const variable of [
        provider.credentialEnv,
        ...Object.values(provider.extraHeaders ?? {}),
      ].filter((value): value is string => Boolean(value))) {
        const value = this.environment.readFresh
          ? await this.environment.readFresh(variable)
          : await this.environment.read(variable);
        if (value) environment[variable] = value;
      }
      const name = managedBaseUrlEnvironmentName(provider.id);
      try {
        if (await this.environment.read(name) !== provider.baseUrl) await this.environment.write(name, provider.baseUrl);
      } catch (error) {
        await this.log.log(`提供商地址环境变量写入失败，直接命令行使用需手动设置 ${name}：${error instanceof Error ? error.message : String(error)}`);
      }
      if (!config.includes(`\${${name}}`)) needsMigration = true;
      environment[name] = await this.gateway.route(provider.id, scopeId);
    }
    if (needsMigration) {
      try {
        await this.replaceManagedBlock(config, storedProviders, hash(config), storedProviders);
        await this.options.validateConfig?.();
      } catch (error) {
        await this.log.log(`提供商管理块迁移失败，本次会话沿用现有 config.toml：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return environment;
  }

  dispose(): Promise<void> { return this.gateway.dispose(); }

  /**
   * Finds which managed provider serves a local model id, so a failed turn can
   * be matched to what the gateway observed for that upstream.
   */
  async providerForModel(modelId: string | undefined): Promise<CustomProviderProfile | undefined> {
    if (!modelId) return undefined;
    const providers = (await this.store.get()).providers;
    return providers.find((provider) => provider.enabled !== false && provider.models.some((model) => model.enabled !== false && model.id === modelId));
  }

  /** Most recent gateway-observed failures, newest first. */
  gatewayFailures(providerId?: string, scopeId?: string): ReturnType<ProviderGatewayService["recentFailures"]> {
    return this.gateway.recentFailures(providerId, scopeId);
  }

  /** Successful and failed body-free gateway observations, newest first. */
  gatewayObservations(providerId?: string, scopeId?: string): ReturnType<ProviderGatewayService["recentObservations"]> {
    return this.gateway.recentObservations(providerId, scopeId);
  }

  async test(id: string): Promise<ProviderConnectivityResult> {
    const provider = (await this.store.get()).providers.find((value) => value.id === id);
    if (!provider) throw new Error("提供商不存在或为只读外部配置");
    const result = await this.probeDraft({
      id: provider.id,
      enabled: provider.enabled !== false,
      name: provider.name,
      baseUrl: provider.baseUrl,
      modelListUrl: provider.modelListUrl,
      protocol: provider.protocol,
      upstreamProtocol: provider.upstreamProtocol,
      schemaProfile: provider.schemaProfile,
      compatibilityFlavor: provider.compatibilityFlavor,
      proxyMode: provider.proxyMode ?? "inherit",
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
      }, input.proxyMode ?? "inherit");
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
          reasoningEfforts: providerReasoningEfforts(model.id, model.reasoningEfforts),
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

  async generateImage(input: { providerId: string; modelId: string; prompt: string; aspectRatio: MediaAspectRatio; signal: AbortSignal }): Promise<MediaArtifact[]> {
    const provider = (await this.store.get()).providers.find((value) => value.id === input.providerId && value.enabled !== false);
    const model = provider?.models.find((value) => value.id === input.modelId && value.enabled !== false);
    if (!provider || !model) throw new Error("媒体 Provider 或模型不存在、已停用");
    const snapshot = await this.getCapabilities(provider.id);
    const capability = snapshot?.models.find((value) => value.modelId === model.id);
    if (!model.media?.image && !Object.values(capability?.protocols ?? {}).some((value) => value?.imageGeneration)) {
      throw new Error("该模型既没有显式图片传输配置，也没有已验证的图片能力");
    }
    const spec = providerImageRequest(provider, model, input.prompt, input.aspectRatio);
    const response = await this.fetcher(spec.endpoint, {
      method: "POST",
      headers: { ...(await this.providerHeaders(provider)), "Content-Type": "application/json" },
      body: JSON.stringify(spec.body),
      redirect: "manual",
      signal: input.signal,
    }, provider.proxyMode ?? "inherit");
    const raw = await readLimitedResponse(response, 24 * 1024 * 1024);
    if (!response.ok) throw new Error(`图片端点返回 HTTP ${response.status}：${sanitizeProbeMessage(raw)}`);
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { throw new Error("图片端点未返回 JSON"); }
    const rows = extractMediaAssets(parsed, "image");
    const artifacts: MediaArtifact[] = [];
    for (const row of rows) {
      const data = row.data;
      const url = row.url;
      if (data) {
        const mimeType = row.mimeType ?? "image/png";
        artifacts.push({ id: randomUUID(), media: "image", source: data, isData: true, mimeType, name: `${model.name}.${mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png"}` });
        continue;
      }
      if (url && /^https?:\/\//i.test(url)) {
        const imageResponse = await this.fetcher(url, {
          method: "GET",
          headers: { Accept: "image/*" },
          redirect: "manual",
          signal: input.signal,
        }, provider.proxyMode ?? "inherit");
        if (!imageResponse.ok) throw new Error(`图片下载返回 HTTP ${imageResponse.status}`);
        const mimeType = imageResponse.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
        if (!mimeType?.startsWith("image/")) throw new Error("图片下载端点返回了非图片内容");
        const buffer = await readLimitedBuffer(imageResponse, 24 * 1024 * 1024);
        artifacts.push({ id: randomUUID(), media: "image", source: buffer.toString("base64"), isData: true, mimeType, name: `${model.name}.${mimeType === "image/jpeg" ? "jpg" : "png"}` });
      }
    }
    if (!artifacts.length) throw new Error("图片端点成功，但没有返回可识别的图片");
    return artifacts;
  }

  async generateVideo(input: {
    providerId: string;
    modelId: string;
    prompt: string;
    aspectRatio: MediaAspectRatio;
    duration: number;
    resolution: string;
    referencePaths?: string[];
    signal: AbortSignal;
  }): Promise<MediaArtifact[]> {
    const provider = (await this.store.get()).providers.find((value) => value.id === input.providerId && value.enabled !== false);
    const model = provider?.models.find((value) => value.id === input.modelId && value.enabled !== false);
    if (!provider || !model) throw new Error("媒体 Provider 或模型不存在、已停用");
    const snapshot = await this.getCapabilities(provider.id);
    const capability = snapshot?.models.find((value) => value.modelId === model.id);
    const configured = model.media?.video;
    if (!configured?.endpoint && !Object.values(capability?.protocols ?? {}).some((value) => value?.videoGeneration)) {
      throw new Error("该模型既没有显式视频端点，也没有已验证的视频能力");
    }
    if (!configured?.endpoint) throw new Error("该 Provider 模型没有显式视频端点");
    const referenceImages = await Promise.all((input.referencePaths ?? []).slice(0, 8).map(async (path) => {
      const buffer = await readFile(path);
      if (buffer.length > 20 * 1024 * 1024) throw new Error("参考图超过 20 MiB");
      return { mime_type: mimeForImagePath(path), data: buffer.toString("base64") };
    }));
    const response = await this.fetcher(resolveProviderEndpoint(provider.baseUrl, configured.endpoint), {
      method: "POST",
      headers: { ...(await this.providerHeaders(provider)), "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model.model,
        prompt: input.prompt,
        aspect_ratio: input.aspectRatio === "auto" ? undefined : input.aspectRatio,
        duration: input.duration,
        resolution: input.resolution,
        ...(referenceImages.length ? { reference_images: referenceImages } : {}),
      }),
      redirect: "manual",
      signal: input.signal,
    }, provider.proxyMode ?? "inherit");
    const raw = await readLimitedResponse(response, 4 * 1024 * 1024);
    if (!response.ok) throw new Error(`视频端点返回 HTTP ${response.status}：${sanitizeProbeMessage(raw)}`);
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error("视频端点未返回 JSON"); }
    const rows = extractMediaAssets(parsed, "video");
    const artifacts = rows.flatMap((row): MediaArtifact[] => {
      if (row.data) return [{ id: randomUUID(), media: "video", source: row.data, isData: true, mimeType: row.mimeType ?? "video/mp4", name: `${model.name}.mp4` }];
      if (row.url) return [{ id: randomUUID(), media: "video", source: row.url, isData: false, mimeType: row.mimeType, name: `${model.name}.mp4` }];
      return [];
    });
    if (!artifacts.length) throw new Error("视频端点成功，但没有返回实际视频资产；异步任务 ID 暂不冒充完成结果");
    return artifacts;
  }

  async getCapabilities(id: string): Promise<ProviderCapabilitySnapshot | undefined> {
    return (await this.capabilityStore.get()).snapshots.find((value) => value.providerId === id);
  }

  async startScan(scope: ProviderScanScope): Promise<ProviderScanJob> {
    if (
      this.scanControllers.has(scope.providerId)
      || [...this.scanJobs.values()].some((value) => value.providerId === scope.providerId && !isTerminalScanStatus(value.status))
    ) throw new Error("该提供商正在执行兼容扫描");
    const provider = (await this.store.get()).providers.find((value) => value.id === scope.providerId);
    if (!provider) throw new Error("提供商不存在或为只读外部配置");
    const models = provider.models.filter((model) => !scope.modelIds?.length || scope.modelIds.includes(model.id));
    if (!models.length) throw new Error("扫描范围中没有模型");
    const protocols = scope.protocols?.length ? scope.protocols : PROVIDER_PROTOCOLS;
    if (scope.context?.mode === "exact" && scope.context.confirmedCost !== true) {
      throw new Error("精确上下文探测需要明确确认请求成本");
    }
    if (scope.context?.mode === "exact" && (models.length !== 1 || protocols.length !== 1)) {
      throw new Error("精确上下文探测只允许单模型、单协议运行");
    }
    const now = new Date().toISOString();
    const generation = (this.scanGenerations.get(provider.id) ?? 0) + 1;
    this.scanGenerations.set(provider.id, generation);
    const job: ProviderScanJob = {
      jobId: randomUUID(),
      providerId: provider.id,
      generation,
      scope: { ...scope, protocols: [...protocols], modelIds: models.map((model) => model.id) },
      status: "queued",
      stage: "preparing",
      completed: 0,
      total: estimatedScanUnits(models.length, protocols.length, scope),
      succeeded: 0,
      failed: 0,
      message: `准备扫描 ${provider.name}：${models.length} 个模型 · ${protocols.length} 种协议`,
      startedAt: now,
      updatedAt: now,
    };
    this.scanJobs.set(job.jobId, job);
    this.publishScan(job);
    void this.runScanJob(job.jobId);
    return cloneScanJob(job);
  }

  getScanJob(jobId: string): ProviderScanJob | undefined {
    const job = this.scanJobs.get(jobId);
    return job ? cloneScanJob(job) : undefined;
  }

  listScanJobs(providerId?: string): ProviderScanJob[] {
    return [...this.scanJobs.values()]
      .filter((job) => !providerId || job.providerId === providerId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map(cloneScanJob);
  }

  cancelScan(jobId: string): ProviderScanJob {
    const job = this.scanJobs.get(jobId);
    if (!job) throw new Error("兼容扫描任务不存在");
    if (isTerminalScanStatus(job.status)) return cloneScanJob(job);
    job.status = "cancelling";
    job.updatedAt = new Date().toISOString();
    job.message = "正在取消扫描；已完成结果将保留";
    this.publishScan(job);
    const active = this.scanControllers.get(job.providerId);
    if (active?.jobId === jobId && active.generation === job.generation) {
      active.controller.abort(new Error("用户取消了兼容扫描"));
      // Invalidate the generation immediately. Some third-party fetch
      // implementations do not honor AbortSignal; without this guard a
      // response arriving during the two-second cancellation grace period
      // could still overwrite capability evidence.
      this.scanControllers.delete(job.providerId);
      this.scanGenerations.set(job.providerId, job.generation + 1);
    }
    const generation = job.updatedAt;
    setTimeout(() => {
      const current = this.scanJobs.get(jobId);
      if (!current || current.updatedAt !== generation || isTerminalScanStatus(current.status)) return;
      current.status = "cancelled";
      current.stage = "complete";
      current.completedAt = new Date().toISOString();
      current.updatedAt = current.completedAt;
      current.message = "扫描已取消；迟到响应将被忽略";
      this.publishScan(current);
    }, 2_000).unref?.();
    return cloneScanJob(job);
  }

  cancelDeepScan(id: string): boolean {
    const active = this.scanControllers.get(id);
    if (!active) return false;
    active.controller.abort(new Error("用户取消了兼容扫描"));
    return true;
  }

  async getCapabilityApplication(id: string): Promise<CapabilityApplicationDraft> {
    const provider = (await this.store.get()).providers.find((value) => value.id === id);
    if (!provider) throw new Error("提供商不存在或为只读外部配置");
    const snapshot = await this.getCapabilities(id);
    if (!snapshot) throw new Error("没有兼容扫描结果");
    const changes: CapabilityApplicationDraft["changes"] = [];
    const addChange = (
      change: Omit<CapabilityApplicationDraft["changes"][number], "evidenceSource" | "checkedAt" | "expired">,
      evidenceSource: CapabilityApplicationDraft["changes"][number]["evidenceSource"] = "live_probe",
      checkedAt: string | undefined = snapshot.checkedAt,
    ): void => {
      changes.push({ ...change, evidenceSource, checkedAt, expired: snapshot.expired });
    };
    if ((provider.compatibilityFlavor ?? "auto") !== snapshot.serverFlavor && snapshot.serverFlavor !== "auto") {
      addChange({ id: "compatibility", kind: "compatibility", label: "兼容家族", before: provider.compatibilityFlavor ?? "auto", after: snapshot.serverFlavor, selectedByDefault: false });
    }
    for (const model of provider.models) {
      const scanned: ProviderModelCapabilityProfile | undefined = snapshot.models.find((value: ProviderModelCapabilityProfile) => value.modelId === model.id);
      if (!scanned) continue;
      const currentProtocol = model.protocol ?? provider.protocol;
      const currentCapability = scanned.protocols[currentProtocol];
      const preferred = PROVIDER_PROTOCOLS.find((protocol) => scanned.protocols[protocol]?.available);
      if (!currentCapability?.available && preferred) {
        addChange({ id: `protocol:${model.id}`, modelId: model.id, kind: "protocol", label: `${model.name} 请求协议`, before: currentProtocol, after: preferred, selectedByDefault: false }, scanned.source, scanned.protocols[preferred]?.checkedAt);
      }
      if (currentCapability?.reasoning?.source === "live_probe") {
        const after = currentCapability.reasoning.efforts.join(" / ") || "无";
        const before = (model.reasoningEfforts ?? []).join(" / ") || "未配置";
        if (after !== before) addChange({ id: `reasoning:${model.id}`, modelId: model.id, kind: "reasoning", label: `${model.name} 思考档位`, before, after, selectedByDefault: true }, currentCapability.reasoning.source, currentCapability.checkedAt);
      }
      if (currentCapability?.context) {
        const context = currentCapability.context;
        const after = context.acceptedTokens
          ? `${context.acceptedTokens} Token`
          : context.verifiedAtLeastTokens
            ? `至少 ${context.verifiedAtLeastTokens} Token`
            : `${context.verifiedCharacters ?? 0} 字符`;
        addChange({ id: `context:${model.id}`, modelId: model.id, kind: "context", label: `${model.name} 上下文证据`, before: model.contextWindow ? `${model.contextWindow} Token` : "未知", after, selectedByDefault: false }, scanned.source, context.checkedAt);
      }
      const flags = (Object.entries(scanned.protocols) as Array<[ProviderProtocol, ProviderProtocolCapability | undefined]>)
        .filter(([, capability]) => capability?.available)
        .map(([protocol, capability]) => `${protocol}:${[capability?.streaming && "SSE", capability?.tools && "工具", capability?.imageGeneration && "图片", capability?.videoGeneration && "视频"].filter(Boolean).join("+") || "基础"}`)
        .join("；");
      if (flags) addChange({ id: `capabilities:${model.id}`, modelId: model.id, kind: "capabilities", label: `${model.name} 协议能力`, after: flags, selectedByDefault: true }, scanned.source, scanned.checkedAt);
      if (scanned.returnedModelIds?.length) addChange({ id: `aliases:${model.id}`, modelId: model.id, kind: "aliases", label: `${model.name} 返回别名`, after: scanned.returnedModelIds.join(", "), selectedByDefault: true }, scanned.source, scanned.checkedAt);
    }
    return { providerId: id, checkedAt: snapshot.checkedAt, expired: snapshot.expired, changes };
  }

  async applyCapabilities(id: string, selection: CapabilityApplicationSelection = { reasoning: true }): Promise<CustomProviderProfile[]> {
    const provider = (await this.store.get()).providers.find((value) => value.id === id);
    if (!provider) throw new Error("提供商不存在或为只读外部配置");
    const snapshot = await this.getCapabilities(id);
    if (!snapshot || snapshot.expired) throw new Error("没有可应用的有效兼容扫描结果");
    const models = provider.models.map((model) => {
      const scanned = snapshot.models.find((value) => value.modelId === model.id);
      const clientProtocol = model.protocol ?? provider.protocol;
      const capability = scanned?.protocols[clientProtocol];
      const selectedProtocol = selection.protocolsByModel?.[model.id];
      const selectedCapability = scanned?.protocols[selectedProtocol ?? clientProtocol];
      let next = selectedProtocol ? { ...model, protocol: selectedProtocol } : model;
      const verifiedContext = selectedCapability?.context?.acceptedTokens ?? selectedCapability?.context?.verifiedAtLeastTokens;
      if (selection.context && verifiedContext) next = { ...next, contextWindow: verifiedContext };
      if (selection.capabilities && scanned) next = { ...next, capabilities: structuredClone(scanned) };
      if (selection.aliases && scanned?.returnedModelIds?.length) next = { ...next, returnedModelAliases: [...scanned.returnedModelIds] };
      if (!selection.reasoning || !selectedCapability?.available || !selectedCapability.reasoning || selectedCapability.reasoning.source !== "live_probe") return next;
      const appliedProtocol = selectedProtocol ?? clientProtocol;
      const upstream = model.upstreamProtocol ?? provider.upstreamProtocol ?? protocolUpstreamDefault(appliedProtocol);
      const reasoningKey = upstream === "compatible_passthrough" ? protocolUpstreamDefault(appliedProtocol) : upstream;
      return {
        ...next,
        reasoningEfforts: [...selectedCapability.reasoning.efforts],
        reasoning: {
          ...(next.reasoning ?? {}),
          [reasoningKey]: {
            ...selectedCapability.reasoning,
            source: "live_probe" as const,
          },
        },
      };
    });
    return this.upsert({
      id: provider.id,
      enabled: provider.enabled !== false,
      name: provider.name,
      baseUrl: provider.baseUrl,
      modelListUrl: provider.modelListUrl,
      protocol: provider.protocol,
      upstreamProtocol: provider.upstreamProtocol,
      schemaProfile: provider.schemaProfile,
      compatibilityFlavor: selection.compatibilityFlavor && snapshot.serverFlavor !== "auto" ? snapshot.serverFlavor : provider.compatibilityFlavor,
      proxyMode: provider.proxyMode,
      authScheme: provider.authScheme,
      credentialMode: provider.credentialMode,
      credentialEnv: provider.credentialEnv,
      extraHeaders: provider.extraHeaders,
      models,
      allowInsecureHttp: provider.insecureHttp,
    });
  }

  async deepScan(id: string, options: ProviderDeepScanOptions = {}, jobId?: string, requestedGeneration?: number): Promise<ProviderDeepScanResult> {
    if (this.scanControllers.has(id)) throw new Error("该提供商正在执行兼容扫描");
    const provider = (await this.store.get()).providers.find((value) => value.id === id);
    if (!provider) throw new Error("提供商不存在或为只读外部配置");
    const controller = new AbortController();
    const generation = requestedGeneration ?? ((this.scanGenerations.get(id) ?? 0) + 1);
    this.scanGenerations.set(id, generation);
    this.scanControllers.set(id, { controller, jobId, generation });
    const startedAt = new Date().toISOString();
    const protocols = options.protocols?.length ? options.protocols : PROVIDER_PROTOCOLS;
    const models = provider.models.filter((model) => !options.modelIds?.length || options.modelIds.includes(model.id));
    if (options.context?.mode === "exact" && options.context.confirmedCost !== true) {
      throw new Error("精确上下文探测需要明确确认请求成本");
    }
    if (options.context?.mode === "exact" && (models.length !== 1 || protocols.length !== 1)) {
      throw new Error("精确上下文探测只允许单模型、单协议运行");
    }
    const total = models.length * protocols.length;
    let completed = 0;
    const warnings: string[] = [];
    const existing = await this.getCapabilities(id);
    this.updateScanStage(jobId, "metadata", { message: "正在识别 Provider 兼容家族" });
    const flavor = await this.detectCompatibilityFlavor(provider, controller.signal);
    this.finishScanUnit(jobId, true);
    const modelProfiles: ProviderModelCapabilityProfile[] = [];
    try {
      const headers = await this.providerHeaders(provider);
      for (const model of models) {
        const previousModel = existing?.models.find((value) => value.modelId === model.id);
        const protocolCapabilities: Partial<Record<ProviderProtocol, ProviderProtocolCapability>> = { ...(previousModel?.protocols ?? {}) };
        const profile: ProviderModelCapabilityProfile = {
          modelId: model.id,
          protocols: protocolCapabilities,
          returnedModelIds: [...(previousModel?.returnedModelIds ?? [])],
          checkedAt: new Date().toISOString(),
          source: "live_probe",
        };
        modelProfiles.push(profile);
        for (const protocol of protocols) {
          if (controller.signal.aborted) break;
          try {
            protocolCapabilities[protocol] = await scanProtocolCapability({
              provider,
              model,
              protocol,
              headers,
              fetcher: this.fetcher,
              signal: controller.signal,
              includeReasoning: options.includeReasoning !== false,
              includeTools: options.includeTools !== false,
              includeImages: options.includeImages === true,
              timeoutMs: Math.max(30_000, this.options.probeTimeoutMs ?? 180_000),
              maxResponseBytes: this.options.maxProbeResponseBytes ?? 4 * 1024 * 1024,
              profileReasoning: compatibilityReasoningTransport(flavor, model.model, protocol),
              context: options.context,
              onStage: (stage, phase, ok, effort, message) => {
                if (phase === "start") this.updateScanStage(jobId, stage, {
                  modelId: model.id,
                  protocol,
                  effort,
                  message: message ?? `${model.name} · ${protocolLabel(protocol)} · ${scanStageLabel(stage, effort)}`,
                });
                else this.finishScanUnit(jobId, ok !== false, message);
              },
            });
          } catch (error) {
            if (controller.signal.aborted) break;
            const message = error instanceof Error ? error.message : String(error);
            protocolCapabilities[protocol] = emptyProtocolCapability(protocol, message);
            warnings.push(`${model.name} · ${protocolLabel(protocol)}：${message}`);
          } finally {
            completed += 1;
          }
          profile.protocols = { ...protocolCapabilities };
          profile.returnedModelIds = Array.from(new Set([
            ...(profile.returnedModelIds ?? []),
            protocolCapabilities[protocol]?.returnedModel,
          ].filter((value): value is string => Boolean(value))));
          profile.checkedAt = new Date().toISOString();
          if (this.isCurrentScan(id, jobId, generation)) {
            await this.saveCapabilityCheckpoint(provider, flavor, modelProfiles, existing);
          }
        }
      }
      const previousModels = existing?.models.filter((value) => !modelProfiles.some((next) => next.modelId === value.modelId)) ?? [];
      const snapshot: ProviderCapabilitySnapshot = {
        providerId: provider.id,
        checkedAt: new Date().toISOString(),
        modelListHash: hash(provider.models.map((model) => model.model).sort().join("\0")),
        serverFlavor: flavor,
        models: [...modelProfiles, ...previousModels],
        expired: false,
      };
      if (!this.isCurrentScan(id, jobId, generation)) {
        const previous = existing ?? snapshot;
        return {
          providerId: id,
          startedAt,
          completedAt: new Date().toISOString(),
          cancelled: true,
          completed,
          total,
          snapshot: previous,
          warnings,
        };
      }
      this.updateScanStage(jobId, "saving", { message: controller.signal.aborted ? "正在保存取消前已完成的兼容证据" : "正在保存已验证兼容证据" });
      const data = await this.capabilityStore.get();
      await this.capabilityStore.set({ snapshots: [...data.snapshots.filter((value) => value.providerId !== id), snapshot] });
      this.finishScanUnit(jobId, true);
      return {
        providerId: id,
        startedAt,
        completedAt: new Date().toISOString(),
        cancelled: controller.signal.aborted,
        completed,
        total,
        snapshot,
        warnings,
      };
    } finally {
      const active = this.scanControllers.get(id);
      if (active?.generation === generation && active.jobId === jobId) this.scanControllers.delete(id);
    }
  }

  private async runScanJob(jobId: string): Promise<void> {
    const job = this.scanJobs.get(jobId);
    if (!job) return;
    job.status = "running";
    job.updatedAt = new Date().toISOString();
    this.publishScan(job);
    try {
      const result = await this.deepScan(job.providerId, job.scope, jobId, job.generation);
      const current = this.scanJobs.get(jobId);
      if (!current) return;
      current.result = result;
      current.completedAt = result.completedAt;
      current.updatedAt = result.completedAt;
      current.stage = "complete";
      current.status = result.cancelled || current.status === "cancelling" || current.status === "cancelled" ? "cancelled" : "completed";
      current.completed = Math.min(current.total, Math.max(current.completed, result.cancelled ? current.completed : current.total));
      current.message = current.status === "cancelled" ? "扫描已取消；已完成结果已保存" : "兼容扫描完成";
      this.publishScan(current);
    } catch (error) {
      const current = this.scanJobs.get(jobId);
      if (!current) return;
      const cancelled = current.status === "cancelling" || current.status === "cancelled";
      current.status = cancelled ? "cancelled" : "failed";
      current.stage = "complete";
      current.completedAt = new Date().toISOString();
      current.updatedAt = current.completedAt;
      current.error = cancelled ? undefined : sanitizeProbeMessage(error instanceof Error ? error.message : String(error));
      current.message = cancelled ? "扫描已取消" : `扫描失败：${current.error}`;
      this.publishScan(current);
    }
  }

  private updateScanStage(jobId: string | undefined, stage: ProviderScanStage, patch: Partial<Pick<ProviderScanProgress, "modelId" | "protocol" | "effort" | "message">> = {}): void {
    if (!jobId) return;
    const job = this.scanJobs.get(jobId);
    if (!job || isTerminalScanStatus(job.status)) return;
    Object.assign(job, patch);
    job.stage = stage;
    job.updatedAt = new Date().toISOString();
    this.publishScan(job);
  }

  private finishScanUnit(jobId: string | undefined, ok: boolean, message?: string): void {
    if (!jobId) return;
    const job = this.scanJobs.get(jobId);
    if (!job || isTerminalScanStatus(job.status)) return;
    job.completed = Math.min(job.total, job.completed + 1);
    if (ok) job.succeeded += 1; else job.failed += 1;
    if (message) job.message = message;
    job.updatedAt = new Date().toISOString();
    this.publishScan(job);
  }

  private publishScan(job: ProviderScanJob): void {
    this.options.onScanProgress?.(cloneScanJob(job));
  }

  private isCurrentScan(providerId: string, jobId: string | undefined, generation: number): boolean {
    if (this.scanGenerations.get(providerId) !== generation) return false;
    const active = this.scanControllers.get(providerId);
    if (!active || active.generation !== generation || active.jobId !== jobId) return false;
    if (!jobId) return true;
    const job = this.scanJobs.get(jobId);
    return Boolean(job && job.generation === generation);
  }

  private async saveCapabilityCheckpoint(
    provider: CustomProviderProfile,
    flavor: ProviderCompatibilityFlavor,
    scannedModels: ProviderModelCapabilityProfile[],
    existing: ProviderCapabilitySnapshot | undefined,
  ): Promise<void> {
    const previousModels = existing?.models.filter((value) => !scannedModels.some((next) => next.modelId === value.modelId)) ?? [];
    const snapshot: ProviderCapabilitySnapshot = {
      providerId: provider.id,
      checkedAt: new Date().toISOString(),
      modelListHash: hash(provider.models.map((model) => model.model).sort().join("\0")),
      serverFlavor: flavor,
      models: [...scannedModels.map((value) => ({
        ...value,
        protocols: { ...value.protocols },
        returnedModelIds: [...(value.returnedModelIds ?? [])],
      })), ...previousModels],
      expired: false,
    };
    const data = await this.capabilityStore.get();
    await this.capabilityStore.set({ snapshots: [...data.snapshots.filter((value) => value.providerId !== provider.id), snapshot] });
  }

  async setCliDefault(modelId: string): Promise<CustomProviderProfile[]> {
    const data = await this.store.get();
    if (!data.providers.some((provider) => provider.enabled !== false && provider.models.some((model) => model.enabled !== false && model.id === modelId))) throw new Error("只能选择已启用的应用管理模型作为 CLI 默认值");
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

  private async providerHeaders(provider: CustomProviderProfile): Promise<Record<string, string>> {
    const result: Record<string, string> = { Accept: "application/json" };
    const secret = provider.credentialEnv
      ? await (this.environment.readFresh ? this.environment.readFresh(provider.credentialEnv) : this.environment.read(provider.credentialEnv))
      : undefined;
    if (secret) result[provider.authScheme === "x_api_key" ? "x-api-key" : "Authorization"] = provider.authScheme === "x_api_key" ? secret : `Bearer ${secret}`;
    for (const [name, env] of Object.entries(provider.extraHeaders)) {
      const value = await (this.environment.readFresh ? this.environment.readFresh(env) : this.environment.read(env));
      if (value) result[name] = value;
    }
    return result;
  }

  private async detectCompatibilityFlavor(provider: CustomProviderProfile, signal?: AbortSignal): Promise<ProviderCompatibilityFlavor> {
    const configured = inferCompatibilityFlavor({
      configured: provider.compatibilityFlavor,
      baseUrl: provider.baseUrl,
    });
    if (provider.compatibilityFlavor && provider.compatibilityFlavor !== "auto") return configured;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("Provider 元数据探测超时")),
      Math.min(this.options.probeTimeoutMs ?? 15_000, 15_000),
    );
    timeout.unref?.();
    const cancel = (): void => controller.abort(signal?.reason);
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      if (signal?.aborted) throw signal.reason;
      const response = await this.fetcher(provider.modelListUrl?.trim() || `${provider.baseUrl.replace(/\/+$/, "")}/models`, {
        method: "GET",
        headers: await this.providerHeaders(provider),
        redirect: "manual",
        signal: controller.signal,
      }, provider.proxyMode ?? "inherit");
      if (!response.ok) return configured;
      const models = parseModelList(await readLimitedResponse(response, this.options.maxProbeResponseBytes ?? 2 * 1024 * 1024));
      return inferCompatibilityFlavor({
        configured: provider.compatibilityFlavor,
        baseUrl: provider.baseUrl,
        ownedBy: models.map((model) => model.ownedBy).filter((value): value is string => Boolean(value)),
      });
    } catch {
      return configured;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
    }
  }

  private async markCapabilitiesExpired(provider: CustomProviderProfile): Promise<void> {
    const data = await this.capabilityStore.get();
    const modelListHash = hash(provider.models.map((model) => model.model).sort().join("\0"));
    const snapshots = data.snapshots.map((snapshot) => snapshot.providerId === provider.id && snapshot.modelListHash !== modelListHash
      ? { ...snapshot, expired: true }
      : snapshot);
    if (snapshots.some((value, index) => value !== data.snapshots[index])) await this.capabilityStore.set({ snapshots });
  }

  private async assertNoExternalCollision(input: CustomProviderInput, config: string, managed: CustomProviderProfile[]): Promise<void> {
    const managedIds = new Set(managed.flatMap((provider) => provider.models.map((model) => model.id)));
    let parsed: TomlTable = {};
    try { parsed = config.trim() ? parse(config) : {}; } catch (error) { throw new Error(`现有 config.toml 无法解析：${error instanceof Error ? error.message : String(error)}`); }
    const modelTable = asRecord(parsed.model);
    for (const model of input.models) if (modelTable[model.id] && !managedIds.has(model.id)) throw new Error(`模型 ID“${model.id}”已由外部 config.toml 配置占用`);
  }

  private async replaceManagedBlock(
    original: string,
    providers: CustomProviderProfile[],
    expectedHash: string,
    previousProviders: CustomProviderProfile[] = providers,
  ): Promise<void> {
    const model: Record<string, Record<string, unknown>> = {};
    for (const provider of providers) {
      if (provider.enabled === false) continue;
      for (const item of provider.models) {
        if (item.enabled === false) continue;
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
        base_url: `\${${managedBaseUrlEnvironmentName(provider.id)}}`,
        name: `${provider.name} · ${item.name}`,
        description: item.description,
        env_key: provider.credentialEnv,
        api_backend: item.protocol ?? provider.protocol,
        context_window: item.contextWindow,
        max_completion_tokens: item.maxCompletionTokens,
        inference_idle_timeout_secs: providerInferenceIdleTimeoutSeconds(item),
        reasoning_efforts: providerReasoningEfforts(item.model, item.reasoningEfforts).map((value) => ({ value, label: value })),
        extra_headers: Object.keys(extraHeaders).length ? extraHeaders : undefined,
      };
      }
    }
    const managed = Object.keys(model).length ? `${START}\n${stringify({ model }).trim()}\n${END}` : "";
    const previousManagedIds = new Set([
      ...managedModelIds(original),
      ...previousProviders.flatMap((provider) => provider.models.map((item) => item.id)),
    ]);
    const currentDefault = modelsDefault(original);
    const enabledManagedIds = new Set(Object.keys(model));
    const reconciledOriginal = currentDefault && previousManagedIds.has(currentDefault) && !enabledManagedIds.has(currentDefault)
      ? clearModelsDefault(original)
      : original;
    const without = stripLegacyManagedModelTables(stripManagedBlock(reconciledOriginal), previousManagedIds).trimEnd();
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
        enabled: true,
        name: typeof item.name === "string" ? item.name : id,
        baseUrl,
        protocol: item.api_backend === "responses" || item.api_backend === "messages" ? item.api_backend : "chat_completions",
        upstreamProtocol: item.api_backend === "responses" ? "openai_responses" : item.api_backend === "messages" ? "anthropic_messages" : "openai_chat",
        schemaProfile: "standard",
        compatibilityFlavor: "generic",
        proxyMode: "inherit",
        authScheme: item.auth_scheme === "x_api_key" ? "x_api_key" : "bearer",
        credentialMode: envKey ? "existing" : "none",
        credentialEnv: envKey,
        extraHeaders: {},
        models: [{
          enabled: true,
          id,
          model: typeof item.model === "string" ? item.model : id,
          name: typeof item.name === "string" ? item.name : id,
          contextWindow: typeof item.context_window === "number" ? item.context_window : undefined,
          inferenceIdleTimeoutSeconds: typeof item.inference_idle_timeout_secs === "number" ? item.inference_idle_timeout_secs : undefined,
        }],
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

/** Prefer this name in new code. Alias kept for existing tests/imports. */
export class DesktopUserEnvironment implements ProviderEnvironment {
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
  async readFresh(name: string): Promise<string | undefined> {
    if (process.platform !== "win32") return this.read(name);
    const result = await new Promise<{ ok: boolean; value?: string }>((resolve) => {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", "[Console]::Out.Write([Environment]::GetEnvironmentVariable($args[0],[EnvironmentVariableTarget]::User))", name],
        { windowsHide: true, timeout: 10_000 },
        (error, stdout) => resolve(error ? { ok: false } : { ok: true, value: String(stdout) }),
      );
    });
    if (!result.ok) return process.env[name];
    if (result.value) {
      process.env[name] = result.value;
      return result.value;
    }
    delete process.env[name];
    return undefined;
  }
  async write(name: string, value: string | undefined): Promise<void> {
    // Non-Windows: process-scoped for now. Cross-restart persistence is tracked in docs/MACOS_PORT.md.
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

/** @deprecated Use DesktopUserEnvironment */
export class WindowsUserEnvironment extends DesktopUserEnvironment {}

export async function validateGrokConfig(cliPath: string, cwd = process.cwd()): Promise<void> {
  await exec(cliPath, ["inspect", "--json"], cwd);
  await exec(cliPath, ["models"], cwd);
}

function exec(file: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => execFile(file, args, { cwd, windowsHide: true, timeout: 30_000, env: process.env }, (error, _stdout, stderr) => error ? reject(new Error(String(stderr || error.message).trim())) : resolve()));
}

function validateInput(input: CustomProviderInput): void {
  validateConnection(input);
  if (input.compatibilityFlavor && !["auto", "cliproxyapi", "grok2api", "sub2api", "new-api", "generic"].includes(input.compatibilityFlavor)) throw new Error("提供商兼容档无效");
  if (input.upstreamProtocol && !["openai_chat", "openai_responses", "anthropic_messages", "gemini_generate_content", "compatible_passthrough"].includes(input.upstreamProtocol)) throw new Error("提供商上游协议无效");
  const seen = new Set<string>();
  for (const model of input.models) {
    if (!ID_PATTERN.test(model.id)) throw new Error(`无效模型 ID：${model.id}`);
    if (seen.has(model.id)) throw new Error(`模型 ID 重复：${model.id}`); seen.add(model.id);
    if (!model.model.trim() || !model.name.trim()) throw new Error("模型路由 ID 和显示名称不能为空");
    if (model.protocol && !["chat_completions", "responses", "messages"].includes(model.protocol)) throw new Error("模型请求协议无效");
    if (model.contextWindow !== undefined && (!Number.isInteger(model.contextWindow) || model.contextWindow < 1024)) throw new Error("上下文窗口必须是不小于 1024 的整数");
    if (model.maxCompletionTokens !== undefined && (!Number.isInteger(model.maxCompletionTokens) || model.maxCompletionTokens < 1)) throw new Error("最大输出必须是正整数");
    if (model.inferenceIdleTimeoutSeconds !== undefined && (!Number.isInteger(model.inferenceIdleTimeoutSeconds) || model.inferenceIdleTimeoutSeconds < 30 || model.inferenceIdleTimeoutSeconds > 3600)) throw new Error("推理空闲超时必须是 30–3600 秒的整数");
    if (model.reasoningEfforts?.some((value) => !["auto", "none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value))) throw new Error("推理强度包含不支持的值");
    if (model.upstreamProtocol && !["openai_chat", "openai_responses", "anthropic_messages", "gemini_generate_content", "compatible_passthrough"].includes(model.upstreamProtocol)) throw new Error("模型上游协议无效");
    validateReasoningTransports(model);
    validateMediaConfiguration(input.baseUrl, model.media);
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

function validateConnection(input: Pick<CustomProviderInput, "id" | "name" | "baseUrl" | "modelListUrl" | "credentialMode" | "credentialEnv" | "allowInsecureHttp" | "proxyMode">): void {
  if (!ID_PATTERN.test(input.id)) throw new Error("提供商 ID 只能包含字母、数字、点、下划线和连字符");
  if (!input.name.trim()) throw new Error("请输入提供商名称");
  if (input.proxyMode !== undefined && input.proxyMode !== "inherit" && input.proxyMode !== "direct") throw new Error("提供商网络路由无效");
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

function normalizeModel(value: ProviderModelDefinition): ProviderModelDefinition {
  const model = value.model.trim();
  return {
    ...value,
    enabled: value.enabled !== false,
    id: value.id.trim(),
    model,
    name: value.name.trim(),
    description: value.description?.trim() || undefined,
    upstreamProtocol: value.upstreamProtocol ?? (value.protocol ? protocolUpstreamDefault(value.protocol) : undefined),
    inferenceIdleTimeoutSeconds: providerInferenceIdleTimeoutSeconds(value),
    reasoningEfforts: providerReasoningEfforts(model, value.reasoningEfforts),
    reasoning: normalizeReasoningTransports(value),
    media: normalizeMediaConfiguration(value.media),
  };
}

function validateReasoningTransports(model: ProviderModelDefinition): void {
  for (const [protocol, transport] of Object.entries(model.reasoning ?? {})) {
    if (!["chat_completions", "responses", "messages", "openai_chat", "openai_responses", "anthropic_messages", "gemini_generate_content", "compatible_passthrough"].includes(protocol)) throw new Error("思考传输协议无效");
    if (!transport || !["effort_enum", "budget_tokens", "adaptive", "model_suffix", "fixed", "unsupported"].includes(transport.mode)) throw new Error("思考传输模式无效");
    if (transport.efforts.some((value) => !PROVIDER_REASONING_LEVELS.includes(value))) throw new Error("思考传输等级无效");
    for (const value of Object.values(transport.budgetByEffort ?? {})) if (value !== undefined && (!Number.isInteger(value) || value < -1 || value > 1_000_000)) throw new Error("思考 Token 预算必须是 -1 到 1000000 的整数");
    for (const value of Object.values(transport.suffixByEffort ?? {})) if (value !== undefined && (typeof value !== "string" || value.length > 64)) throw new Error("思考模型后缀无效");
  }
}

function normalizeReasoningTransports(model: ProviderModelDefinition): ProviderModelDefinition["reasoning"] {
  if (!model.reasoning) return undefined;
  return Object.fromEntries(Object.entries(model.reasoning).filter((entry): entry is [string, NonNullable<typeof entry[1]>] => Boolean(entry[1])).map(([protocol, transport]) => [protocol, {
    ...transport,
    efforts: providerReasoningEfforts(model.model, transport.efforts),
    budgetByEffort: transport.budgetByEffort ? Object.fromEntries(Object.entries(transport.budgetByEffort).filter(([, value]) => value !== undefined)) : undefined,
    suffixByEffort: transport.suffixByEffort ? Object.fromEntries(Object.entries(transport.suffixByEffort).filter(([, value]) => typeof value === "string")) : undefined,
    source: transport.source ?? "manual",
  }])) as ProviderModelDefinition["reasoning"];
}

function validateMediaConfiguration(baseUrl: string, media: ProviderModelMediaConfiguration | undefined): void {
  if (!media) return;
  if (media.image && !["openai_images", "openai_responses_image", "gemini_generate_content"].includes(media.image.transport)) {
    throw new Error("图片媒体传输档无效");
  }
  if (media.video?.transport !== undefined && media.video.transport !== "compatible_video") throw new Error("视频媒体传输档无效");
  if (media.video && !media.video.endpoint.trim()) throw new Error("兼容视频端点不能为空");
  for (const endpoint of [media.image?.endpoint, media.video?.endpoint]) {
    if (!endpoint?.trim()) continue;
    resolveProviderEndpoint(baseUrl, endpoint);
  }
}

function normalizeMediaConfiguration(media: ProviderModelMediaConfiguration | undefined): ProviderModelMediaConfiguration | undefined {
  if (!media) return undefined;
  const image = media.image ? { ...media.image, endpoint: media.image.endpoint?.trim() || undefined } : undefined;
  const video = media.video ? { ...media.video, endpoint: media.video.endpoint.trim() } : undefined;
  return image || video ? { image, video } : undefined;
}
function providerInferenceIdleTimeoutSeconds(model: ProviderModelDefinition): number {
  return model.inferenceIdleTimeoutSeconds ?? DEFAULT_PROVIDER_INFERENCE_IDLE_TIMEOUT_SECONDS;
}
function normalizeHeaders(value: Record<string, string>): Record<string, string> { return Object.fromEntries(Object.entries(value).filter(([key, env]) => key.trim() && env.trim()).map(([key, env]) => [key.trim(), normalizeEnvironmentName(env)])); }
function normalizeEnvironmentName(value: string): string { const normalized = value.trim().toUpperCase(); if (!/^[A-Z_][A-Z0-9_]*$/.test(normalized)) throw new Error("环境变量名格式无效"); return normalized; }
function managedEnvironmentName(id: string): string { return `GROK_DESKTOP_PROVIDER_${id}`.toUpperCase().replace(/[^A-Z0-9_]/g, "_") + "_KEY"; }
export function managedBaseUrlEnvironmentName(id: string): string { return `GROK_DESKTOP_PROVIDER_${id}`.toUpperCase().replace(/[^A-Z0-9_]/g, "_") + "_BASE_URL"; }
function protocolUpstreamDefault(protocol: CustomProviderInput["protocol"]): NonNullable<CustomProviderInput["upstreamProtocol"]> {
  return protocol === "responses" ? "openai_responses" : protocol === "messages" ? "anthropic_messages" : "openai_chat";
}
function normalizeBaseUrl(value: string): string { return value.trim().replace(/\/+$/, ""); }
function isInsecureRemote(value: string): boolean { const url = new URL(value); return url.protocol === "http:" && !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname.toLowerCase()); }
function draftModelListUrl(provider: ProviderConnectionDraft): string { return provider.modelListUrl?.trim() || `${provider.baseUrl.trim().replace(/\/+$/, "")}/models`; }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function stripManagedBlock(value: string): string { return value.replace(new RegExp(`${escapeRegex(START)}[\\s\\S]*?${escapeRegex(END)}\\s*`, "g"), ""); }
/**
 * 0.6.15 and older builds could leave Desktop-owned model tables outside the
 * managed markers. Appending a new marked block then defines the same TOML
 * table twice and Grok CLI rejects the complete config. Remove only table
 * sections whose IDs are still known by the private Provider store; unrelated
 * user-authored model tables and comments remain byte-for-byte untouched.
 */
function stripLegacyManagedModelTables(value: string, managedIds: ReadonlySet<string>): string {
  if (!managedIds.size) return value;
  const lines = value.split(/\r?\n/);
  const kept: string[] = [];
  let removing = false;
  for (const line of lines) {
    const header = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/.exec(line);
    if (header) {
      const modelId = modelTableId(header[1] ?? "");
      removing = modelId !== undefined && managedIds.has(modelId);
    }
    if (!removing) kept.push(line);
  }
  return kept.join("\n");
}
function modelTableId(path: string): string | undefined {
  const trimmed = path.trim();
  if (!trimmed.startsWith("model.")) return undefined;
  const value = trimmed.slice("model.".length);
  if (!value) return undefined;

  if (value[0] === '"') {
    let escaped = false;
    for (let index = 1; index < value.length; index += 1) {
      const character = value[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character !== '"') continue;
      const remainder = value.slice(index + 1);
      if (remainder !== "" && !remainder.startsWith(".")) return undefined;
      try { return JSON.parse(value.slice(0, index + 1)) as string; } catch { return undefined; }
    }
    return undefined;
  }

  if (value[0] === "'") {
    const end = value.indexOf("'", 1);
    if (end < 0) return undefined;
    const remainder = value.slice(end + 1);
    if (remainder !== "" && !remainder.startsWith(".")) return undefined;
    return value.slice(1, end);
  }

  const end = value.indexOf(".");
  const bare = end < 0 ? value : value.slice(0, end);
  return /^[A-Za-z0-9_-]+$/.test(bare) ? bare : undefined;
}
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function asRecord(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
function managedModelIds(value: string): Set<string> {
  const start = value.indexOf(START);
  const end = value.indexOf(END, start + START.length);
  if (start < 0 || end < 0) return new Set();
  try {
    return new Set(Object.keys(asRecord(asRecord(parse(value.slice(start, end + END.length))).model)));
  } catch {
    return new Set();
  }
}
function modelsDefault(value: string): string | undefined {
  try {
    const configured = asRecord(asRecord(parse(value)).models).default;
    return typeof configured === "string" && configured ? configured : undefined;
  } catch {
    return undefined;
  }
}
function clearModelsDefault(config: string): string {
  const lines = config.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*\[models\]\s*(?:#.*)?$/.test(line));
  if (start < 0) return config;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(lines[index]!)) { end = index; break; }
  }
  const existing = lines.slice(start + 1, end).findIndex((line) => /^\s*default\s*=/.test(line));
  if (existing < 0) return config;
  lines.splice(start + 1 + existing, 1);
  return lines.join("\n");
}
function managedCapabilitiesOutdated(config: string, providers: CustomProviderProfile[]): boolean {
  if (!config.trim()) return false;
  try {
    const models = asRecord(asRecord(parse(config)).model);
    return providers.some((provider) => provider.models.some((model) => {
      const expected = providerReasoningEfforts(model.model, model.reasoningEfforts);
      const expectedProtocol = model.protocol ?? provider.protocol;
      const configured = asRecord(models[model.id]);
      if (configured.api_backend !== expectedProtocol) return true;
      if (configured.inference_idle_timeout_secs !== providerInferenceIdleTimeoutSeconds(model)) return true;
      const current = Array.isArray(configured.reasoning_efforts)
        ? configured.reasoning_efforts.map(reasoningEffortValue).filter(Boolean)
        : [];
      return expected.join("\0") !== current.join("\0");
    }));
  } catch {
    // Invalid user TOML is diagnosed elsewhere; never overwrite it merely to
    // refresh optional capability metadata.
    return false;
  }
}
function parseModelList(raw: string): Array<{ id: string; name?: string; description?: string; ownedBy?: string; contextWindow?: number; reasoningEfforts?: ProviderModelDefinition["reasoningEfforts"] }> {
  const parsed = JSON.parse(raw) as any;
  const values = Array.isArray(parsed) ? parsed : Array.isArray(parsed.data) ? parsed.data : Array.isArray(parsed.models) ? parsed.models : [];
  const seen = new Set<string>();
  return values.map((value: any) => typeof value === "string" ? { id: value } : {
    id: String(value.id || value.model || value.name || ""),
    name: typeof value.name === "string" ? value.name : typeof value.display_name === "string" ? value.display_name : undefined,
    description: typeof value.description === "string" ? value.description : undefined,
    ownedBy: typeof value.owned_by === "string" ? value.owned_by : typeof value.ownedBy === "string" ? value.ownedBy : undefined,
    contextWindow: Number.isInteger(value.context_window) ? value.context_window : Number.isInteger(value.contextWindow) ? value.contextWindow : undefined,
    reasoningEfforts: providerReasoningEfforts(String(value.id || value.model || value.name || ""), modelReasoningMetadata(value)),
  }).filter((value: { id: string }) => Boolean(value.id) && !seen.has(value.id) && Boolean(seen.add(value.id)));
}

function modelReasoningMetadata(value: any): ReasoningEffort[] | undefined {
  const capabilities = asRecord(value?.capabilities);
  const candidates = [
    value?.reasoning_efforts,
    value?.reasoningEfforts,
    value?.supported_reasoning_efforts,
    value?.supportedReasoningEfforts,
    capabilities.reasoning_efforts,
    capabilities.reasoningEfforts,
  ];
  const declared = candidates.find(Array.isArray);
  return declared?.map(reasoningEffortValue);
}

function reasoningEffortValue(value: unknown): ReasoningEffort {
  if (typeof value === "string") return value as ReasoningEffort;
  if (value && typeof value === "object" && typeof (value as { value?: unknown }).value === "string") {
    return (value as { value: ReasoningEffort }).value;
  }
  return "";
}

async function readLimitedResponse(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new Error("模型列表响应过大，已停止读取");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > limit) {
        await reader.cancel("response too large").catch(() => undefined);
        throw new Error("模型列表响应过大，已停止读取");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

async function readLimitedBuffer(response: Response, limit: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new Error("媒体响应过大，已停止读取");
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > limit) {
        await reader.cancel("response too large").catch(() => undefined);
        throw new Error("媒体响应过大，已停止读取");
      }
      chunks.push(Buffer.from(next.value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function scanProtocolCapability(input: {
  provider: CustomProviderProfile;
  model: ProviderModelDefinition;
  protocol: ProviderProtocol;
  headers: Record<string, string>;
  fetcher: ProviderFetcher;
  signal: AbortSignal;
  includeReasoning: boolean;
  includeTools: boolean;
  includeImages: boolean;
  timeoutMs: number;
  maxResponseBytes: number;
  profileReasoning?: NonNullable<ProviderProtocolCapability["reasoning"]>;
  context?: ProviderContextProbeOptions;
  onStage?: (
    stage: ProviderScanStage,
    phase: "start" | "finish",
    ok?: boolean,
    effort?: Exclude<ReasoningEffort, "">,
    message?: string,
  ) => void;
}): Promise<ProviderProtocolCapability> {
  const checkedAt = new Date().toISOString();
  input.onStage?.("baseline", "start");
  const baseline = await inferenceProbe({ ...input, stream: false });
  input.onStage?.("baseline", "finish", baseline.ok, undefined, baseline.message);
  const available = baseline.ok;
  const capability: ProviderProtocolCapability = {
    protocol: input.protocol,
    available,
    nonStreaming: baseline.ok,
    streaming: false,
    tools: false,
    toolContinuation: false,
    imageInput: false,
    imageGeneration: false,
    imageEditing: false,
    videoGeneration: false,
    usage: baseline.hasUsage,
    verification: baseline.ok ? "response_confirmed" : "rejected",
    checkedAt,
    latencyMs: baseline.latencyMs,
    status: baseline.status,
    returnedModel: baseline.returnedModel,
    message: baseline.message,
  };
  if (!available) return capability;

  input.onStage?.("stream", "start");
  const stream = await inferenceProbe({ ...input, stream: true });
  input.onStage?.("stream", "finish", stream.ok && stream.sse && stream.completed, undefined, stream.message);
  capability.streaming = stream.ok && stream.sse && stream.completed;
  capability.usage ||= stream.hasUsage;
  capability.returnedModel ??= stream.returnedModel;
  input.onStage?.("usage", "start");
  input.onStage?.(
    "usage",
    "finish",
    capability.usage,
    undefined,
    capability.usage ? "Provider 返回了精确 Usage 字段" : "本协议响应未返回 Usage 明细",
  );
  if (input.includeTools) {
    input.onStage?.("tool", "start");
    const tool = await inferenceProbe({ ...input, stream: true, tool: true });
    input.onStage?.("tool", "finish", tool.ok && tool.toolEvidence, undefined, tool.message);
    capability.tools = tool.ok && tool.toolEvidence;
    if (capability.tools && tool.toolCall) {
      input.onStage?.("tool-continuation", "start");
      const continuation = await toolContinuationProbe(input, tool.toolCall);
      input.onStage?.("tool-continuation", "finish", continuation.ok, undefined, continuation.message);
      capability.toolContinuation = continuation.ok;
      capability.usage ||= continuation.hasUsage;
    }
    capability.usage ||= tool.hasUsage;
  }
  if (input.includeImages && input.protocol === (input.model.protocol ?? input.provider.protocol)) {
    input.onStage?.("image", "start");
    const image = await imageGenerationProbe(input);
    input.onStage?.("image", "finish", image.ok, undefined, image.message);
    capability.imageGeneration = image.ok;
    if (!image.ok && image.message) capability.message = `${capability.message ?? "文本协议可用"}；图片生成：${image.message}`;
    if (input.model.media?.video) {
      input.onStage?.("video", "start");
      const video = await videoGenerationProbe(input);
      input.onStage?.("video", "finish", video.ok, undefined, video.message);
      capability.videoGeneration = video.ok;
      if (!video.ok && video.message) capability.message = `${capability.message ?? "文本协议可用"}；视频生成：${video.message}`;
    }
  }
  if (input.includeReasoning) {
    const accepted: Exclude<ReasoningEffort, "">[] = [];
    for (const level of PROVIDER_REASONING_LEVELS) {
      if (input.signal.aborted) break;
      input.onStage?.("reasoning", "start", undefined, level);
      const result = await inferenceProbe({ ...input, stream: false, effortValue: level });
      input.onStage?.("reasoning", "finish", result.ok, level, result.message);
      if (result.ok) accepted.push(level);
    }
    capability.reasoning = {
      mode: input.profileReasoning?.mode ?? "effort_enum",
      efforts: accepted,
      budgetByEffort: input.profileReasoning?.budgetByEffort,
      suffixByEffort: input.profileReasoning?.suffixByEffort,
      fixedEffort: input.profileReasoning?.fixedEffort,
      source: "live_probe",
    };
  } else if (input.profileReasoning) {
    capability.reasoning = input.profileReasoning;
  }
  if (input.context?.mode && input.context.mode !== "off" && !input.signal.aborted) {
    capability.context = await contextCapabilityProbe(input, input.context, (phase, request, target, result) => {
      input.onStage?.(
        "context",
        phase,
        result?.ok,
        undefined,
        phase === "start"
          ? `上下文探测第 ${request} 次 · 目标 ${target.toLocaleString()} Token`
          : `上下文探测第 ${request} 次${result?.ok ? "通过" : "未通过"} · ${result?.message ?? ""}`,
      );
    });
  }
  return capability;
}

async function contextCapabilityProbe(
  input: {
    provider: CustomProviderProfile;
    model: ProviderModelDefinition;
    protocol: ProviderProtocol;
    headers: Record<string, string>;
    fetcher: ProviderFetcher;
    signal: AbortSignal;
    timeoutMs: number;
    maxResponseBytes: number;
  },
  options: ProviderContextProbeOptions,
  onRequest?: (phase: "start" | "finish", request: number, target: number, result?: InferenceProbeResult) => void,
): Promise<ProviderContextProbeResult> {
  const checkedAt = new Date().toISOString();
  const declaredTokens = input.model.contextWindow;
  const ceiling = Math.max(1_024, Math.min(options.targetTokens ?? (declaredTokens ? Math.min(declaredTokens, 32_768) : 32_768), 2_000_000));
  const maxRequests = Math.max(1, Math.min(options.maxRequests ?? (options.mode === "exact" ? 8 : 1), 12));
  let requests = 0;
  let accepted: { requested: number; characters: number; exact?: number } | undefined;
  let rejected: { requested: number; characters: number; exact?: number } | undefined;
  const run = async (requested: number): Promise<InferenceProbeResult & { characters: number }> => {
    if (input.signal.aborted) throw input.signal.reason instanceof Error ? input.signal.reason : new Error("兼容扫描已取消");
    const prompt = contextProbeText(requested);
    requests += 1;
    onRequest?.("start", requests, requested);
    const result = await rawInferenceProbe(input, contextProbeBody(input.protocol, input.model.model, prompt));
    onRequest?.("finish", requests, requested, result);
    return { ...result, characters: prompt.length };
  };

  if (options.mode === "safe") {
    const result = await run(ceiling);
    if (!result.ok) {
      return {
        mode: "safe",
        verification: "rejected",
        declaredTokens,
        exactUsage: false,
        requests,
        checkedAt,
        message: `未验证目标下限：${result.message}`,
      };
    }
    return {
      mode: "safe",
      verification: "response_confirmed",
      declaredTokens,
      verifiedAtLeastTokens: result.inputTokens,
      verifiedCharacters: result.characters,
      exactUsage: result.inputTokens !== undefined,
      requests,
      checkedAt,
      message: result.inputTokens !== undefined
        ? `至少验证到 ${result.inputTokens} Token`
        : `至少验证到 ${result.characters} 字符；Provider 未返回精确输入 Token`,
    };
  }

  let low = 1_024;
  let high = ceiling;
  const upper = await run(high);
  if (upper.ok) accepted = { requested: high, characters: upper.characters, exact: upper.inputTokens };
  else rejected = { requested: high, characters: upper.characters, exact: upper.inputTokens };
  if (!accepted && requests < maxRequests) {
    const lower = await run(low);
    if (lower.ok) accepted = { requested: low, characters: lower.characters, exact: lower.inputTokens };
    else {
      return {
        mode: "exact",
        verification: "rejected",
        declaredTokens,
        rejectedTokens: lower.inputTokens,
        rejectedCharacters: lower.characters,
        exactUsage: lower.inputTokens !== undefined,
        requests,
        checkedAt,
        message: `最小探测请求也被拒绝：${lower.message}`,
      };
    }
  }
  while (accepted && rejected && requests < maxRequests && rejected.requested - accepted.requested > 1_024) {
    const middle = Math.floor((accepted.requested + rejected.requested) / 2 / 1_024) * 1_024;
    if (middle <= accepted.requested || middle >= rejected.requested) break;
    const result = await run(middle);
    if (result.ok) accepted = { requested: middle, characters: result.characters, exact: result.inputTokens };
    else rejected = { requested: middle, characters: result.characters, exact: result.inputTokens };
  }
  const exactUsage = accepted?.exact !== undefined;
  return {
    mode: "exact",
    verification: rejected ? "capped" : "response_confirmed",
    declaredTokens,
    acceptedTokens: exactUsage ? accepted?.exact : undefined,
    rejectedTokens: rejected?.exact,
    acceptedCharacters: accepted?.characters,
    rejectedCharacters: rejected?.characters,
    verifiedAtLeastTokens: exactUsage ? accepted?.exact : undefined,
    verifiedCharacters: accepted?.characters,
    exactUsage,
    requests,
    checkedAt,
    message: rejected
      ? exactUsage
        ? `已验证 ${accepted?.exact} Token${rejected.exact !== undefined ? `；${rejected.exact} Token 的请求被拒绝` : ""}`
        : `已验证 ${accepted?.characters ?? 0} 字符；${rejected.characters} 字符的请求被拒绝；Provider 未返回精确 Token`
      : exactUsage
        ? `配置上界 ${accepted?.exact} Token 已通过`
        : `配置上界 ${accepted?.characters ?? 0} 字符已通过；Provider 未返回精确 Token`,
  };
}

function contextProbeText(targetTokens: number): string {
  return `${"x ".repeat(Math.max(1, targetTokens - 16))}\nReply with OK only.`;
}

function contextProbeBody(protocol: ProviderProtocol, model: string, prompt: string): Record<string, unknown> {
  if (protocol === "responses") return { model, input: prompt, stream: false, max_output_tokens: 1 };
  if (protocol === "messages") return { model, messages: [{ role: "user", content: prompt }], stream: false, max_tokens: 1 };
  return { model, messages: [{ role: "user", content: prompt }], stream: false, max_completion_tokens: 1 };
}

interface InferenceProbeResult {
  ok: boolean;
  status?: number;
  latencyMs: number;
  message: string;
  returnedModel?: string;
  hasUsage: boolean;
  inputTokens?: number;
  sse: boolean;
  completed: boolean;
  toolEvidence: boolean;
  toolCall?: { id: string; name: string; arguments: string };
}

async function inferenceProbe(input: {
  provider: CustomProviderProfile;
  model: ProviderModelDefinition;
  protocol: ProviderProtocol;
  headers: Record<string, string>;
  fetcher: ProviderFetcher;
  signal: AbortSignal;
  timeoutMs: number;
  maxResponseBytes: number;
  stream: boolean;
  tool?: boolean;
  effortValue?: Exclude<ReasoningEffort, "">;
}): Promise<InferenceProbeResult> {
  throwIfProbeAborted(input.signal);
  const endpoint = `${input.provider.baseUrl.replace(/\/+$/, "")}${protocolPath(input.protocol)}`;
  const body = probeBody(input.protocol, input.model.model, input.stream, input.tool, input.effortValue);
  const headers: Record<string, string> = { ...input.headers, "content-type": "application/json" };
  if (input.protocol === "messages") headers["anthropic-version"] ??= "2023-06-01";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("兼容探测超时")), input.timeoutMs);
  const onAbort = (): void => controller.abort(input.signal.reason);
  input.signal.addEventListener("abort", onAbort, { once: true });
  if (input.signal.aborted) onAbort();
  const started = Date.now();
  try {
    const response = await input.fetcher(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "manual",
      signal: controller.signal,
    }, input.provider.proxyMode ?? "inherit");
    const raw = await readLimitedResponse(response, input.maxResponseBytes);
    const contentType = response.headers.get("content-type") ?? "";
    let returnedModel: string | undefined;
    let hasUsage = false;
    let inputTokens: number | undefined;
    let message = response.ok ? "请求完成" : `HTTP ${response.status}`;
    if (/json/i.test(contentType) || raw.trimStart().startsWith("{")) {
      try {
        const parsed = JSON.parse(raw) as any;
        returnedModel = typeof parsed.model === "string" ? parsed.model : typeof parsed.modelVersion === "string" ? parsed.modelVersion : undefined;
        hasUsage = Boolean(parsed.usage || parsed.usageMetadata);
        inputTokens = usageInputTokens(parsed);
        if (!response.ok) message = sanitizeProbeMessage(parsed?.error?.message ?? parsed?.message ?? message);
      } catch {
        // The status and bounded response metadata remain sufficient.
      }
    } else {
      returnedModel = firstSseModel(raw);
      hasUsage = /"usage"\s*:|"usageMetadata"\s*:/.test(raw);
    }
    const sse = /text\/event-stream/i.test(contentType) || /(?:^|\n)(?:event:|data:)/.test(raw);
    const completed = !input.stream || /\[DONE\]|response\.completed|message_stop|"finishReason"|"finish_reason"/.test(raw);
    const toolEvidence = /tool_calls|function_call|tool_use|functionCall|response\.function_call/.test(raw);
    const toolCall = extractToolCall(raw);
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - started,
      message,
      returnedModel,
      hasUsage,
      inputTokens,
      sse,
      completed,
      toolEvidence,
      toolCall,
    };
  } catch (error) {
    if (input.signal.aborted) throw input.signal.reason instanceof Error ? input.signal.reason : new Error("兼容扫描已取消");
    return {
      ok: false,
      latencyMs: Date.now() - started,
      message: sanitizeProbeMessage(error instanceof Error ? error.message : String(error)),
      hasUsage: false,
      sse: false,
      completed: false,
      toolEvidence: false,
    };
  } finally {
    clearTimeout(timer);
    input.signal.removeEventListener("abort", onAbort);
  }
}

async function toolContinuationProbe(
  input: {
    provider: CustomProviderProfile;
    model: ProviderModelDefinition;
    protocol: ProviderProtocol;
    headers: Record<string, string>;
    fetcher: ProviderFetcher;
    signal: AbortSignal;
    timeoutMs: number;
    maxResponseBytes: number;
  },
  call: { id: string; name: string; arguments: string },
): Promise<InferenceProbeResult> {
  const prompt = "Call lookup_value with key alpha.";
  let body: Record<string, unknown>;
  if (input.protocol === "responses") {
    body = {
      model: input.model.model,
      input: [
        { role: "user", content: prompt },
        { type: "function_call", call_id: call.id, name: call.name, arguments: call.arguments },
        { type: "function_call_output", call_id: call.id, output: "{\"value\":\"42\"}" },
      ],
      stream: false,
      max_output_tokens: 64,
    };
  } else if (input.protocol === "messages") {
    body = {
      model: input.model.model,
      messages: [
        { role: "user", content: prompt },
        { role: "assistant", content: [{ type: "tool_use", id: call.id, name: call.name, input: safeJsonObject(call.arguments) }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: call.id, content: "{\"value\":\"42\"}" }] },
      ],
      stream: false,
      max_tokens: 64,
    };
  } else {
    body = {
      model: input.model.model,
      messages: [
        { role: "user", content: prompt },
        { role: "assistant", content: null, tool_calls: [{ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } }] },
        { role: "tool", tool_call_id: call.id, content: "{\"value\":\"42\"}" },
      ],
      stream: false,
      max_completion_tokens: 64,
    };
  }
  return rawInferenceProbe(input, body);
}

async function rawInferenceProbe(
  input: {
    provider: CustomProviderProfile;
    protocol: ProviderProtocol;
    headers: Record<string, string>;
    fetcher: ProviderFetcher;
    signal: AbortSignal;
    timeoutMs: number;
    maxResponseBytes: number;
  },
  body: Record<string, unknown>,
): Promise<InferenceProbeResult> {
  throwIfProbeAborted(input.signal);
  const endpoint = `${input.provider.baseUrl.replace(/\/+$/, "")}${protocolPath(input.protocol)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("兼容探测超时")), input.timeoutMs);
  const onAbort = (): void => controller.abort(input.signal.reason);
  input.signal.addEventListener("abort", onAbort, { once: true });
  if (input.signal.aborted) onAbort();
  const started = Date.now();
  try {
    const headers: Record<string, string> = { ...input.headers, "content-type": "application/json" };
    if (input.protocol === "messages") headers["anthropic-version"] ??= "2023-06-01";
    const response = await input.fetcher(endpoint, { method: "POST", headers, body: JSON.stringify(body), redirect: "manual", signal: controller.signal }, input.provider.proxyMode ?? "inherit");
    const raw = await readLimitedResponse(response, input.maxResponseBytes);
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - started,
      message: response.ok ? "工具结果续写完成" : `HTTP ${response.status}`,
      returnedModel: firstSseModel(raw),
      hasUsage: /"usage"\s*:|"usageMetadata"\s*:/.test(raw),
      inputTokens: firstSseInputTokens(raw),
      sse: false,
      completed: response.ok,
      toolEvidence: false,
    };
  } catch (error) {
    if (input.signal.aborted) throw input.signal.reason instanceof Error ? input.signal.reason : new Error("兼容扫描已取消");
    return { ok: false, latencyMs: Date.now() - started, message: sanitizeProbeMessage(error instanceof Error ? error.message : String(error)), hasUsage: false, sse: false, completed: false, toolEvidence: false };
  } finally {
    clearTimeout(timer);
    input.signal.removeEventListener("abort", onAbort);
  }
}

function probeBody(
  protocol: ProviderProtocol,
  model: string,
  stream: boolean,
  tool = false,
  effortValue?: Exclude<ReasoningEffort, "">,
): Record<string, unknown> {
  const prompt = tool ? "Call lookup_value with key alpha." : "Reply exactly OK.";
  const schema = { type: "object", properties: { key: { type: "string" } }, required: ["key"], additionalProperties: false };
  if (protocol === "responses") {
    const body: Record<string, unknown> = { model, input: prompt, stream, max_output_tokens: 64 };
    if (effortValue) body.reasoning = { effort: effortValue };
    if (tool) {
      body.tools = [{ type: "function", name: "lookup_value", description: "Look up a value", parameters: schema, strict: true }];
      body.tool_choice = { type: "function", name: "lookup_value" };
    }
    return body;
  }
  if (protocol === "messages") {
    const body: Record<string, unknown> = { model, messages: [{ role: "user", content: prompt }], max_tokens: 64, stream };
    if (effortValue === "none") body.thinking = { type: "disabled" };
    else if (effortValue) {
      body.thinking = { type: "adaptive" };
      body.output_config = { effort: effortValue === "xhigh" ? "max" : effortValue };
    }
    if (tool) {
      body.tools = [{ name: "lookup_value", description: "Look up a value", input_schema: schema }];
      body.tool_choice = { type: "tool", name: "lookup_value" };
    }
    return body;
  }
  const body: Record<string, unknown> = { model, messages: [{ role: "user", content: prompt }], stream, max_completion_tokens: 64 };
  if (stream) body.stream_options = { include_usage: true };
  if (effortValue) body.reasoning_effort = effortValue;
  if (tool) {
    body.tools = [{ type: "function", function: { name: "lookup_value", description: "Look up a value", parameters: schema } }];
    body.tool_choice = { type: "function", function: { name: "lookup_value" } };
  }
  return body;
}

function emptyProtocolCapability(protocol: ProviderProtocol, message: string): ProviderProtocolCapability {
  return {
    protocol,
    available: false,
    nonStreaming: false,
    streaming: false,
    tools: false,
    toolContinuation: false,
    imageInput: false,
    imageGeneration: false,
    imageEditing: false,
    usage: false,
    verification: "unknown",
    checkedAt: new Date().toISOString(),
    message: sanitizeProbeMessage(message),
  };
}

async function imageGenerationProbe(input: {
  provider: CustomProviderProfile;
  model: ProviderModelDefinition;
  headers: Record<string, string>;
  fetcher: ProviderFetcher;
  signal: AbortSignal;
  timeoutMs: number;
  maxResponseBytes: number;
}): Promise<{ ok: boolean; message?: string }> {
  throwIfProbeAborted(input.signal);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("图片兼容探测超时")), input.timeoutMs);
  const onAbort = (): void => controller.abort(input.signal.reason);
  input.signal.addEventListener("abort", onAbort, { once: true });
  if (input.signal.aborted) onAbort();
  try {
    const spec = providerImageRequest(input.provider, input.model, "A small blue circle on a white background.", "1:1");
    const response = await input.fetcher(spec.endpoint, {
      method: "POST",
      headers: { ...input.headers, "content-type": "application/json" },
      body: JSON.stringify(spec.body),
      redirect: "manual",
      signal: controller.signal,
    }, input.provider.proxyMode ?? "inherit");
    const raw = await readLimitedResponse(response, Math.max(input.maxResponseBytes, 16 * 1024 * 1024));
    if (!response.ok) {
      try {
        const parsed = JSON.parse(raw) as any;
        return { ok: false, message: sanitizeProbeMessage(parsed?.error?.message ?? `HTTP ${response.status}`) };
      } catch {
        return { ok: false, message: `HTTP ${response.status}` };
      }
    }
    const parsed = JSON.parse(raw) as any;
    const ok = extractMediaAssets(parsed, "image").some((value) => value.url || value.data);
    return { ok, message: ok ? "图片端点返回了可用资产" : "响应未包含图片资产" };
  } catch (error) {
    if (input.signal.aborted) throw input.signal.reason instanceof Error ? input.signal.reason : new Error("兼容扫描已取消");
    return { ok: false, message: sanitizeProbeMessage(error instanceof Error ? error.message : String(error)) };
  } finally {
    clearTimeout(timer);
    input.signal.removeEventListener("abort", onAbort);
  }
}

async function videoGenerationProbe(input: {
  provider: CustomProviderProfile;
  model: ProviderModelDefinition;
  headers: Record<string, string>;
  fetcher: ProviderFetcher;
  signal: AbortSignal;
  timeoutMs: number;
  maxResponseBytes: number;
}): Promise<{ ok: boolean; message?: string }> {
  throwIfProbeAborted(input.signal);
  const configured = input.model.media?.video;
  if (!configured?.endpoint) return { ok: false, message: "未配置显式视频端点" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("视频兼容探测超时")), Math.max(input.timeoutMs, 360_000));
  const onAbort = (): void => controller.abort(input.signal.reason);
  input.signal.addEventListener("abort", onAbort, { once: true });
  if (input.signal.aborted) onAbort();
  try {
    const response = await input.fetcher(resolveProviderEndpoint(input.provider.baseUrl, configured.endpoint), {
      method: "POST",
      headers: { ...input.headers, "content-type": "application/json" },
      body: JSON.stringify({
        model: input.model.model,
        prompt: "A blue circle moves slowly from left to right.",
        duration: 6,
        resolution: "480p",
        aspect_ratio: "16:9",
      }),
      redirect: "manual",
      signal: controller.signal,
    }, input.provider.proxyMode ?? "inherit");
    const raw = await readLimitedResponse(response, Math.max(input.maxResponseBytes, 4 * 1024 * 1024));
    if (!response.ok) return { ok: false, message: `HTTP ${response.status}` };
    const parsed = JSON.parse(raw) as unknown;
    const ok = extractMediaAssets(parsed, "video").some((value) => value.url || value.data);
    return {
      ok,
      message: ok ? "视频端点返回了实际媒体资产" : "端点未返回视频资产；异步任务 ID 不视为已完成能力",
    };
  } catch (error) {
    if (input.signal.aborted) throw input.signal.reason instanceof Error ? input.signal.reason : new Error("兼容扫描已取消");
    return { ok: false, message: sanitizeProbeMessage(error instanceof Error ? error.message : String(error)) };
  } finally {
    clearTimeout(timer);
    input.signal.removeEventListener("abort", onAbort);
  }
}

function throwIfProbeAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error("兼容扫描已取消");
}

function providerImageRequest(
  provider: CustomProviderProfile,
  model: ProviderModelDefinition,
  prompt: string,
  aspectRatio: MediaAspectRatio,
): { endpoint: string; body: Record<string, unknown>; transport: ProviderImageTransport } {
  const upstream = model.upstreamProtocol ?? provider.upstreamProtocol ?? protocolUpstreamDefault(model.protocol ?? provider.protocol);
  const configured = model.media?.image;
  const transport: ProviderImageTransport = configured?.transport
    ?? (upstream === "openai_chat" || upstream === "openai_responses" || upstream === "compatible_passthrough"
      ? "openai_images"
      : (() => { throw new Error("该模型需要显式选择图片媒体传输档和端点"); })());
  const defaultPath = transport === "openai_images"
    ? "images/generations"
    : transport === "openai_responses_image"
      ? "responses"
      : `models/${encodeURIComponent(model.model)}:generateContent`;
  const endpoint = resolveProviderEndpoint(provider.baseUrl, configured?.endpoint || defaultPath);
  if (transport === "openai_responses_image") {
    return { endpoint, transport, body: { model: model.model, input: prompt, tools: [{ type: "image_generation" }] } };
  }
  if (transport === "gemini_generate_content") {
    return {
      endpoint,
      transport,
      body: {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          ...(aspectRatio === "auto" ? {} : { imageConfig: { aspectRatio } }),
        },
      },
    };
  }
  return {
    endpoint,
    transport,
    body: {
      model: model.model,
      prompt,
      n: 1,
      response_format: "b64_json",
      ...(aspectRatio === "1:1" ? { size: "1024x1024" }
        : aspectRatio === "9:16" || aspectRatio === "3:4" ? { size: "1024x1536" }
          : aspectRatio === "16:9" || aspectRatio === "4:3" ? { size: "1536x1024" } : {}),
    },
  };
}

function resolveProviderEndpoint(baseUrl: string, endpoint: string): string {
  const base = new URL(baseUrl);
  const value = endpoint.trim();
  const resolved = /^https?:\/\//i.test(value)
    ? new URL(value)
    : value.startsWith("/")
      ? new URL(value, base.origin)
      : new URL(value, `${base.href.replace(/\/+$/, "")}/`);
  if (!/^https?:$/.test(resolved.protocol)) throw new Error("媒体端点只支持 HTTP 或 HTTPS");
  if (resolved.origin !== base.origin) throw new Error("媒体端点必须与 Provider 基础地址同源，避免向第三方泄露凭据");
  return resolved.href;
}

interface ExtractedMediaAsset {
  data?: string;
  url?: string;
  mimeType?: string;
}

function extractMediaAssets(value: unknown, kind: "image" | "video"): ExtractedMediaAsset[] {
  if (!value || typeof value !== "object") return [];
  const parsed = value as any;
  const rows: any[] = [
    ...(Array.isArray(parsed.data) ? parsed.data : []),
    ...(Array.isArray(parsed.images) ? parsed.images : []),
    ...(Array.isArray(parsed.videos) ? parsed.videos : []),
    ...(Array.isArray(parsed.output) ? parsed.output : []),
  ];
  for (const candidate of parsed.candidates ?? []) {
    for (const part of candidate?.content?.parts ?? []) rows.push(part?.inlineData ?? part?.inline_data ?? part);
  }
  const assets: ExtractedMediaAsset[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rawData = [row.b64_json, row.b64, row.data, row.result]
      .find((item) => typeof item === "string" && !/^https?:\/\//i.test(item)) as string | undefined;
    const url = [row.url, row.uri, row.download_url, row.video_url, row.result]
      .find((item) => typeof item === "string" && /^https?:\/\//i.test(item)) as string | undefined;
    const mimeType = typeof row.mimeType === "string" ? row.mimeType
      : typeof row.mime_type === "string" ? row.mime_type
        : kind === "video" ? "video/mp4" : "image/png";
    const data = normalizeBase64Media(rawData, kind);
    if (data || url) assets.push({ data, url, mimeType });
    for (const part of row.content ?? []) {
      const nested = part?.inlineData ?? part?.inline_data ?? part;
      const nestedData = normalizeBase64Media(typeof nested?.data === "string" ? nested.data : undefined, kind);
      const nestedUrl = typeof nested?.url === "string" ? nested.url : undefined;
      if (nestedData || nestedUrl) assets.push({ data: nestedData, url: nestedUrl, mimeType: nested?.mimeType ?? nested?.mime_type ?? mimeType });
    }
  }
  return assets;
}

function normalizeBase64Media(value: string | undefined, kind: "image" | "video"): string | undefined {
  if (!value) return undefined;
  const dataUrl = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(value.trim());
  if (dataUrl && !dataUrl[1]?.toLowerCase().startsWith(`${kind}/`)) return undefined;
  const payload = (dataUrl?.[2] ?? value).replace(/\s+/g, "");
  if (payload.length < 16 || payload.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) return undefined;
  let buffer: Buffer;
  try { buffer = Buffer.from(payload, "base64"); } catch { return undefined; }
  if (!matchesMediaSignature(buffer, kind)) return undefined;
  return payload;
}

function matchesMediaSignature(buffer: Buffer, kind: "image" | "video"): boolean {
  if (kind === "image") {
    return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      || buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
      || buffer.subarray(0, 6).toString("ascii") === "GIF87a"
      || buffer.subarray(0, 6).toString("ascii") === "GIF89a"
      || (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP");
  }
  return buffer.subarray(4, 8).toString("ascii") === "ftyp"
    || buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    || buffer.subarray(0, 4).toString("ascii") === "OggS";
}

function mimeForImagePath(path: string): string {
  const extension = path.toLocaleLowerCase().split(".").at(-1);
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  return "image/png";
}

function protocolPath(protocol: ProviderProtocol): string {
  return protocol === "responses" ? "/responses" : protocol === "messages" ? "/messages" : "/chat/completions";
}
function protocolLabel(protocol: ProviderProtocol): string {
  return protocol === "responses" ? "Responses" : protocol === "messages" ? "Messages" : "Chat Completions";
}
function firstSseModel(raw: string): string | undefined {
  const match = /"model(?:Version)?"\s*:\s*"([^"]+)"/.exec(raw);
  return match?.[1];
}
function usageInputTokens(parsed: any): number | undefined {
  const value = parsed?.usage?.input_tokens
    ?? parsed?.usage?.inputTokens
    ?? parsed?.usage?.prompt_tokens
    ?? parsed?.usageMetadata?.promptTokenCount;
  return Number.isFinite(Number(value)) ? Number(value) : undefined;
}
function firstSseInputTokens(raw: string): number | undefined {
  for (const match of raw.matchAll(/^data:\s*(\{.*\})\s*$/gm)) {
    try {
      const value = usageInputTokens(JSON.parse(match[1]!));
      if (value !== undefined) return value;
    } catch { /* ignore malformed chunks */ }
  }
  try { return usageInputTokens(JSON.parse(raw)); } catch { return undefined; }
}
function extractToolCall(raw: string): { id: string; name: string; arguments: string } | undefined {
  const events: any[] = [];
  try { events.push(JSON.parse(raw)); } catch {
    for (const match of raw.matchAll(/^data:\s*(\{.*\})\s*$/gm)) {
      try { events.push(JSON.parse(match[1]!)); } catch { /* ignore malformed fixture chunks */ }
    }
  }
  const partial = new Map<string, { id: string; name: string; arguments: string }>();
  for (const event of events) {
    for (const call of event?.choices?.[0]?.message?.tool_calls ?? event?.choices?.[0]?.delta?.tool_calls ?? []) {
      const key = String(call.index ?? call.id ?? 0);
      const current = partial.get(key) ?? { id: String(call.id ?? `call_${key}`), name: "", arguments: "" };
      if (call.id) current.id = String(call.id);
      if (call.function?.name) current.name += String(call.function.name);
      if (call.function?.arguments) current.arguments += String(call.function.arguments);
      partial.set(key, current);
    }
    const item = event?.item ?? event?.response?.output?.find?.((value: any) => value?.type === "function_call");
    if (item?.type === "function_call") {
      const key = String(event.output_index ?? item.call_id ?? item.id);
      partial.set(key, { id: String(item.call_id ?? item.id), name: String(item.name), arguments: String(item.arguments ?? "") });
    }
    if (event?.type === "response.function_call_arguments.delta") {
      const key = String(event.output_index ?? event.item_id);
      const current = partial.get(key) ?? { id: String(event.item_id ?? `call_${key}`), name: "", arguments: "" };
      current.arguments += String(event.delta ?? "");
      partial.set(key, current);
    }
    for (const block of event?.content ?? []) if (block?.type === "tool_use") partial.set(String(block.id), { id: String(block.id), name: String(block.name), arguments: JSON.stringify(block.input ?? {}) });
    if (event?.type === "content_block_start" && event?.content_block?.type === "tool_use") {
      const block = event.content_block;
      partial.set(String(event.index), { id: String(block.id), name: String(block.name), arguments: JSON.stringify(block.input ?? {}).replace(/^\{\}$/, "") });
    }
    if (event?.type === "content_block_delta" && event?.delta?.type === "input_json_delta") {
      const key = String(event.index);
      const current = partial.get(key) ?? { id: `call_${key}`, name: "", arguments: "" };
      current.arguments += String(event.delta.partial_json ?? "");
      partial.set(key, current);
    }
  }
  return [...partial.values()].find((value) => value.name && value.arguments);
}
function safeJsonObject(value: string): Record<string, unknown> { try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } }
function sanitizeProbeMessage(value: unknown): string {
  return String(value ?? "请求失败")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer <redacted>")
    .replace(/(?:sk|g2a)_[A-Za-z0-9_-]{8,}/g, "<redacted>")
    .replace(/[A-Za-z]:\\[^\r\n"']+/g, "<local-path>")
    .slice(0, 500);
}

function estimatedScanUnits(modelCount: number, protocolCount: number, options: ProviderDeepScanOptions): number {
  const perProtocol = 3
    + (options.includeTools === false ? 0 : 2)
    + (options.includeReasoning === false ? 0 : PROVIDER_REASONING_LEVELS.length)
    + (options.context?.mode && options.context.mode !== "off" ? (options.context.mode === "exact" ? Math.max(1, Math.min(options.context.maxRequests ?? 8, 12)) : 1) : 0);
  // Media is scoped to the configured/current protocol. Reserve two units per
  // model (image and optional explicit video); the terminal job clamps to 100%
  // when a model has no video configuration.
  return 2 + Math.max(1, modelCount * protocolCount * perProtocol) + (options.includeImages === true ? modelCount * 2 : 0);
}
function cloneScanJob(job: ProviderScanJob): ProviderScanJob {
  return structuredClone(job);
}
function isTerminalScanStatus(status: ProviderScanJob["status"]): boolean {
  return status === "completed" || status === "cancelled" || status === "failed";
}
function scanStageLabel(stage: ProviderScanStage, effort?: Exclude<ReasoningEffort, "">): string {
  if (stage === "baseline") return "基础非流式";
  if (stage === "stream") return "SSE 流式";
  if (stage === "usage") return "Usage";
  if (stage === "tool") return "工具调用";
  if (stage === "tool-continuation") return "工具续写";
  if (stage === "image") return "图片能力";
  if (stage === "video") return "视频能力";
  if (stage === "reasoning") return `思考档位 ${effort ?? ""}`.trim();
  if (stage === "context") return "上下文探测";
  return stage;
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
