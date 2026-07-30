import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "smol-toml";
import { afterEach, describe, expect, it } from "vitest";
import type { CustomProviderProfile, ReasoningEffort } from "../../shared/types";
import { DEFAULT_PROVIDER_INFERENCE_IDLE_TIMEOUT_SECONDS, providerReasoningEfforts } from "../../shared/provider-model-capabilities";
import { locateGrokCli } from "./cli-locator";
import { GrokAcpAdapter } from "./grok-acp-adapter";
import { LogService } from "./log-service";
import { ProviderGatewayService } from "./provider-gateway-service";
import { WindowsUserEnvironment } from "./provider-service";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, {
  recursive: true,
  force: true,
  maxRetries: 8,
  retryDelay: 75,
}))));

describe.runIf(process.platform === "win32" && process.env.GROK_CURRENT_PROVIDER_PROBE === "1")("current managed provider", () => {
  it("completes one minimal ACP turn through the schema compatibility gateway", async () => {
    const appData = process.env.APPDATA;
    if (!appData) throw new Error("APPDATA is unavailable");
    const stored = JSON.parse(await readFile(join(appData, "Grok Build Desktop", "providers.json"), "utf8")) as { providers?: CustomProviderProfile[] };
    const requestedModel = process.env.GROK_CURRENT_PROVIDER_MODEL;
    const provider = requestedModel
      ? stored.providers?.find((value) => value.owned && value.models.some((model) => model.id === requestedModel || model.model === requestedModel))
      : stored.providers?.find((value) => value.owned);
    if (!provider) throw new Error("No managed provider is configured");
    const model = (requestedModel
      ? provider.models.find((value) => value.id === requestedModel || value.model === requestedModel)
      : provider.models.find((value) => /gemini/i.test(value.model))) ?? provider.models[0];
    if (!model) throw new Error("The managed provider has no model");
    if (!provider.credentialEnv) throw new Error("The managed provider has no credential environment");
    const userEnvironment = new WindowsUserEnvironment();
    const storedCredential = await userEnvironment.read(provider.credentialEnv);
    const providerHost = new URL(provider.baseUrl).hostname;
    const allowLoopbackWithoutCredential = process.env.GROK_CURRENT_PROVIDER_ALLOW_NO_CREDENTIAL === "1"
      && (providerHost === "127.0.0.1" || providerHost === "localhost" || providerHost === "::1");
    if (!storedCredential && !allowLoopbackWithoutCredential) throw new Error("The managed provider credential is unavailable");
    const credential = storedCredential ?? "loopback-probe-placeholder";
    const root = await mkdtemp(join(tmpdir(), "grok-current-provider-")); roots.push(root);
    const grokHome = join(root, ".grok");
    const workspace = join(root, "workspace");
    await mkdir(grokHome, { recursive: true });
    await mkdir(workspace, { recursive: true });
    const log = new LogService(join(root, "provider-probe.log"));
    const protocol = process.env.GROK_CURRENT_PROVIDER_PROTOCOL === "responses"
      ? "responses"
      : model.protocol ?? provider.protocol;
    const effectiveProvider: CustomProviderProfile = {
      ...provider,
      protocol,
      upstreamProtocol: protocol === "responses" ? "openai_responses" : provider.upstreamProtocol,
      credentialMode: allowLoopbackWithoutCredential ? "none" : provider.credentialMode,
    };
    const reasoningEfforts = providerReasoningEfforts(model.model, model.reasoningEfforts);
    const gateway = new ProviderGatewayService({
      providers: async () => [{ ...effectiveProvider, schemaProfile: effectiveProvider.schemaProfile ?? "standard" }],
      environment: async (name) => userEnvironment.readFresh ? userEnvironment.readFresh(name) : userEnvironment.read(name),
      fetcher: fetch,
      log,
      requestTimeoutMs: 120_000,
    });
    const localBaseEnv = "GROK_DESKTOP_CURRENT_PROVIDER_BASE_URL";
    const route = await gateway.route(provider.id);
    const extraHeaders = Object.fromEntries(await Promise.all(Object.entries(provider.extraHeaders ?? {}).map(async ([name, envName]) => {
      const value = await userEnvironment.read(envName);
      return [name, value ? `\${${envName}}` : ""] as const;
    })));
    if (provider.authScheme === "x_api_key") {
      extraHeaders.Authorization = "";
      extraHeaders["x-api-key"] = `\${${provider.credentialEnv}}`;
    }
    await writeFile(join(grokHome, "config.toml"), stringify({
      model: {
        "grok-desktop-current-provider-probe": {
          model: model.model,
          base_url: `\${${localBaseEnv}}`,
          name: "Current provider compatibility probe",
          env_key: provider.credentialEnv,
          api_backend: protocol,
          context_window: model.contextWindow ?? 128_000,
          max_completion_tokens: Math.min(model.maxCompletionTokens ?? 1024, 1024),
          inference_idle_timeout_secs: model.inferenceIdleTimeoutSeconds ?? DEFAULT_PROVIDER_INFERENCE_IDLE_TIMEOUT_SECONDS,
          reasoning_efforts: reasoningEfforts.map((value) => ({ value, label: value })),
          extra_headers: Object.fromEntries(Object.entries(extraHeaders).filter(([, value]) => value)),
        },
      },
    }), "utf8");
    const cliPath = await locateGrokCli("");
    if (!cliPath) throw new Error("installed Grok CLI was not found");
    const providerHeaderEnvironment = Object.fromEntries(await Promise.all(Object.values(provider.extraHeaders ?? {}).map(async (name) => [name, await userEnvironment.read(name)] as const)));
    const requestedInitialEffort = process.env.GROK_CURRENT_PROVIDER_INITIAL_EFFORT;
    const initialEffort: ReasoningEffort = requestedInitialEffort && ["none", "minimal", "low", "medium", "high", "xhigh"].includes(requestedInitialEffort)
      ? requestedInitialEffort as ReasoningEffort
      : "";
    const adapter = new GrokAcpAdapter({
      cliPath,
      cwd: workspace,
      env: {
        ...process.env,
        ...providerHeaderEnvironment,
        GROK_HOME: grokHome,
        [localBaseEnv]: route,
        [provider.credentialEnv]: credential,
      },
      effort: initialEffort,
      mode: "agent",
      modelId: "grok-desktop-current-provider-probe",
      log,
    });
    try {
      await adapter.start();
      const active = adapter.models.find((value) => value.modelId === "grok-desktop-current-provider-probe");
      if (reasoningEfforts.length) {
        expect(active).toMatchObject({
          supportsReasoningEffort: true,
          reasoningEfforts: reasoningEfforts.map((value) => expect.objectContaining({ value })),
        });
      }
      const nextEffort = process.env.GROK_CURRENT_PROVIDER_SWITCH_EFFORT;
      if (nextEffort === "none" || nextEffort === "minimal" || nextEffort === "low" || nextEffort === "medium" || nextEffort === "high" || nextEffort === "xhigh") {
        await adapter.setEffort(nextEffort);
        expect(adapter.effort).toBe(nextEffort);
      }
      await adapter.prompt("Reply with exactly OK.");
      expect(await log.read()).toMatch(/Provider gateway request \w+ completed status=2\d\d/);
      expect(adapter.currentModelId).toBe("grok-desktop-current-provider-probe");
    } finally {
      await adapter.dispose();
      await gateway.dispose();
    }
  }, 180_000);
});
