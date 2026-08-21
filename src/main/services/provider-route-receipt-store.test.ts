import { describe, expect, it } from "vitest";
import { ProviderRouteReceiptStore } from "./provider-route-receipt-store";

const provider = {
  id: "provider", name: "Provider", baseUrl: "https://example.test/v1", protocol: "openai-compatible",
  credentialMode: "managed", schemaProfile: "strict", models: [], owned: true, hasCredential: true,
  insecureHttp: false, authScheme: "bearer", createdAt: "", updatedAt: "",
} as never;
const model = { id: "local", model: "upstream", enabled: true } as never;

describe("ProviderRouteReceiptStore", () => {
  it("freezes body-free route identity and returns a defensive copy", () => {
    const store = new ProviderRouteReceiptStore(2, () => new Date("2026-08-20T00:00:00.000Z"));
    const receipt = store.capture({ scopeId: "scope", sessionId: "session", cwd: "C:\\repo", effort: "xhigh" }, provider, model, () => "openai_chat");
    expect(receipt).toMatchObject({ upstreamOrigin: "https://example.test", credentialSource: "managed-environment", localModelId: "local", upstreamModelId: "upstream", effort: "xhigh" });
    expect(JSON.stringify(receipt)).not.toContain("credentialEnv");
    expect(store.get("scope")).not.toBe(receipt);
  });

  it("evicts the oldest opaque scope at the configured bound", () => {
    const store = new ProviderRouteReceiptStore(1);
    store.capture({ scopeId: "old", cwd: "C:\\repo" }, provider, model, () => "openai_chat");
    store.capture({ scopeId: "new", cwd: "C:\\repo" }, provider, model, () => "openai_chat");
    expect(store.get("old")).toBeUndefined();
    expect(store.get("new")).toBeDefined();
  });
});
