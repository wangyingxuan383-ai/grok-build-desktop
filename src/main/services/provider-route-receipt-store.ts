import type { CustomProviderProfile, ProviderLaunchContext, ProviderModelDefinition, ProviderRouteReceipt, ProviderUpstreamProtocol } from "../../shared/types";

export class ProviderRouteReceiptStore {
  private readonly receipts = new Map<string, ProviderRouteReceipt>();

  constructor(private readonly maxEntries = 256, private readonly now: () => Date = () => new Date()) {}

  capture(context: ProviderLaunchContext, provider: CustomProviderProfile, model: ProviderModelDefinition, defaultUpstream: (protocol: ProviderRouteReceipt["clientProtocol"]) => ProviderUpstreamProtocol): ProviderRouteReceipt {
    const receipt: ProviderRouteReceipt = Object.freeze({
      scopeId: context.scopeId,
      sessionId: context.sessionId,
      providerId: provider.id,
      providerName: provider.name,
      upstreamOrigin: new URL(provider.baseUrl).origin,
      credentialSource: provider.credentialMode === "managed"
        ? "managed-environment"
        : provider.credentialMode === "existing" ? "existing-environment" : "none",
      localModelId: model.id,
      upstreamModelId: model.model,
      clientProtocol: model.protocol ?? provider.protocol,
      upstreamProtocol: model.upstreamProtocol ?? provider.upstreamProtocol ?? defaultUpstream(model.protocol ?? provider.protocol),
      schemaProfile: provider.schemaProfile ?? "standard",
      effort: context.effort,
      createdAt: this.now().toISOString(),
    });
    this.receipts.delete(context.scopeId);
    this.receipts.set(context.scopeId, receipt);
    while (this.receipts.size > this.maxEntries) this.receipts.delete(this.receipts.keys().next().value!);
    return receipt;
  }

  get(scopeId: string | undefined): ProviderRouteReceipt | undefined {
    const receipt = scopeId ? this.receipts.get(scopeId) : undefined;
    return receipt ? { ...receipt } : undefined;
  }
}
