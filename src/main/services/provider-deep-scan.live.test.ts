import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CustomProviderInput, ProviderCompatibilityFlavor, ProviderProtocol } from "../../shared/types";
import { providerReasoningEfforts } from "../../shared/provider-model-capabilities";
import { LogService } from "./log-service";
import { ProviderService } from "./provider-service";

const enabled = process.platform === "win32"
  && process.env.GROK_PROVIDER_DEEP_SCAN === "1"
  && Boolean(process.env.GROK_PROVIDER_DEEP_SCAN_ID);

describe.runIf(enabled)("installed provider deep compatibility scan", () => {
  it("records bounded live evidence for the selected provider models", async () => {
    const appData = process.env.APPDATA;
    if (!appData) throw new Error("APPDATA is unavailable");
    const providerId = process.env.GROK_PROVIDER_DEEP_SCAN_ID!;
    const protocols = (process.env.GROK_PROVIDER_DEEP_SCAN_PROTOCOLS ?? "responses,chat_completions,messages")
      .split(",")
      .filter((value): value is ProviderProtocol => value === "responses" || value === "chat_completions" || value === "messages");
    const modelIds = (process.env.GROK_PROVIDER_DEEP_SCAN_MODELS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    const service = new ProviderService(
      join(appData, "Grok Build Desktop"),
      new LogService(join(appData, "Grok Build Desktop", "logs", "provider-deep-scan-live.log")),
      {
        grokHome: join(homedir(), ".grok"),
        probeTimeoutMs: 360_000,
        maxProbeResponseBytes: 8 * 1024 * 1024,
      },
    );
    try {
      const configuredFlavor = process.env.GROK_PROVIDER_CONFIGURE_FLAVOR as ProviderCompatibilityFlavor | undefined;
      const responseModels = new Set((process.env.GROK_PROVIDER_CONFIGURE_RESPONSES_MODELS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
      if (configuredFlavor || responseModels.size) {
        const provider = (await service.list()).find((value) => value.id === providerId && value.owned);
        if (!provider) throw new Error("managed provider is unavailable");
        const models = provider.models.map((model) => {
          if (!responseModels.has(model.id)) return model;
          const efforts = providerReasoningEfforts(model.model, model.reasoningEfforts);
          return {
            ...model,
            protocol: "responses" as const,
            upstreamProtocol: "openai_responses" as const,
            reasoningEfforts: efforts,
            reasoning: {
              ...(model.reasoning ?? {}),
              openai_responses: { mode: "effort_enum" as const, efforts, source: "manual" as const },
            },
          };
        });
        const input: CustomProviderInput = {
          id: provider.id,
          name: provider.name,
          baseUrl: provider.baseUrl,
          modelListUrl: provider.modelListUrl,
          protocol: provider.protocol,
          upstreamProtocol: provider.upstreamProtocol,
          schemaProfile: provider.schemaProfile,
          compatibilityFlavor: configuredFlavor ?? provider.compatibilityFlavor,
          proxyMode: provider.proxyMode,
          authScheme: provider.authScheme,
          credentialMode: provider.credentialMode,
          credentialEnv: provider.credentialEnv,
          extraHeaders: provider.extraHeaders,
          models,
          allowInsecureHttp: provider.insecureHttp,
        };
        await service.upsert(input);
      }
      const result = await service.deepScan(providerId, {
        protocols,
        modelIds: modelIds.length ? modelIds : undefined,
        includeReasoning: process.env.GROK_PROVIDER_DEEP_SCAN_REASONING !== "0",
        includeTools: process.env.GROK_PROVIDER_DEEP_SCAN_TOOLS !== "0",
        includeImages: process.env.GROK_PROVIDER_DEEP_SCAN_IMAGES === "1",
      });
      expect(result.cancelled).toBe(false);
      expect(result.snapshot.models.some((model) => Object.values(model.protocols).some((protocol) => protocol?.available))).toBe(true);
    } finally {
      await service.dispose();
    }
  }, 30 * 60_000);
});
