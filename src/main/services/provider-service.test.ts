import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "smol-toml";
import type { CustomProviderInput, ProviderConnectionDraft } from "../../shared/types";
import { LogService } from "./log-service";
import { ProviderService, providerModelLocalId, type ProviderEnvironment } from "./provider-service";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

class FakeEnvironment implements ProviderEnvironment {
  values = new Map<string, string>();
  async read(name: string) { return this.values.get(name); }
  async write(name: string, value: string | undefined) { if (value === undefined) this.values.delete(name); else this.values.set(name, value); }
}

async function fixture(config = "# 用户注释\n[ui]\nsimple_mode = true\n") {
  const root = await mkdtemp(join(tmpdir(), "grok-provider-")); roots.push(root);
  const grokHome = join(root, ".grok"); await mkdir(grokHome, { recursive: true }); await writeFile(join(grokHome, "config.toml"), config);
  const environment = new FakeEnvironment(); const log = new LogService(join(root, "logs", "app.log"));
  return { root, grokHome, environment, service: new ProviderService(join(root, "data"), log, { grokHome, environment }) };
}

function input(patch: Partial<CustomProviderInput> = {}): CustomProviderInput { return { id: "sample", name: "示例提供商", baseUrl: "https://api.example.test/v1", protocol: "responses", authScheme: "bearer", credentialMode: "managed", credentialValue: "test-secret-value", extraHeaders: {}, models: [{ id: "sample-model", model: "upstream/model", name: "示例模型", contextWindow: 128_000, maxCompletionTokens: 8192 }], ...patch }; }
function draft(baseUrl: string, patch: Partial<ProviderConnectionDraft> = {}): ProviderConnectionDraft { return { id: "draft", name: "草稿提供商", baseUrl, protocol: "chat_completions", authScheme: "bearer", credentialMode: "none", headers: [], models: [], ...patch }; }

describe("ProviderService", () => {
  it("preserves unrelated TOML and stores credentials only in the user environment abstraction", async () => {
    const { service, grokHome, environment } = await fixture();
    const values = await service.upsert(input());
    const config = await readFile(join(grokHome, "config.toml"), "utf8");
    expect(config).toContain("# 用户注释"); expect(config).toContain("[ui]"); expect(config).toContain("Grok Build Desktop managed models"); expect(config).toContain("sample-model");
    expect(config).not.toContain("test-secret-value"); expect(environment.values.get("GROK_DESKTOP_PROVIDER_SAMPLE_KEY")).toBe("test-secret-value");
    expect(values.find((value) => value.id === "sample")?.hasCredential).toBe(true);
  });

  it("writes CLI-compatible reasoning options and an environment-backed x-api-key without auth_scheme", async () => {
    const { service, grokHome } = await fixture();
    await service.upsert(input({
      protocol: "messages",
      authScheme: "x_api_key",
      models: [{ id: "sample-model", model: "claude-compatible", name: "示例模型", contextWindow: 128_000, reasoningEfforts: ["low", "high"] }],
    }));
    const raw = await readFile(join(grokHome, "config.toml"), "utf8");
    const model = ((parse(raw).model as Record<string, any>)["sample-model"]);
    expect(model).not.toHaveProperty("auth_scheme");
    expect(model.env_key).toBe("GROK_DESKTOP_PROVIDER_SAMPLE_KEY");
    expect(model.reasoning_efforts).toEqual([{ value: "low", label: "low" }, { value: "high", label: "high" }]);
    expect(model.extra_headers["x-api-key"]).toBe("${GROK_DESKTOP_PROVIDER_SAMPLE_KEY}");
    expect(model.extra_headers.Authorization).toBe("");
    expect(raw).not.toContain("test-secret-value");
  });

  it("rejects collisions with externally managed model ids", async () => {
    const { service } = await fixture('[model."sample-model"]\nmodel = "external"\nbase_url = "https://external.test/v1"\n');
    await expect(service.upsert(input())).rejects.toThrow("外部 config.toml");
  });

  it("rolls config and credentials back when CLI validation fails", async () => {
    const { root, grokHome, environment } = await fixture(); const original = await readFile(join(grokHome, "config.toml"), "utf8");
    const service = new ProviderService(join(root, "rollback-data"), new LogService(join(root, "rollback.log")), { grokHome, environment, validateConfig: async () => { throw new Error("fake incompatible CLI"); } });
    await expect(service.upsert(input())).rejects.toThrow("fake incompatible CLI");
    expect(await readFile(join(grokHome, "config.toml"), "utf8")).toBe(original); expect(environment.values.size).toBe(0);
  });

  it("rolls provider metadata and a replaced credential back when model reload fails", async () => {
    const { root, grokHome, environment, service } = await fixture();
    await service.upsert(input());
    const original = await readFile(join(grokHome, "config.toml"), "utf8");
    const failing = new ProviderService(join(root, "data"), new LogService(join(root, "reload-rollback.log")), {
      grokHome,
      environment,
      reloadModels: async () => { throw new Error("fake reload failure"); },
    });
    await expect(failing.upsert(input({ credentialMode: "none", credentialValue: undefined }))).rejects.toThrow("fake reload failure");
    expect(await readFile(join(grokHome, "config.toml"), "utf8")).toBe(original);
    expect(environment.values.get("GROK_DESKTOP_PROVIDER_SAMPLE_KEY")).toBe("test-secret-value");
    const restored = (await failing.list()).find((value) => value.id === "sample");
    expect(restored?.credentialMode).toBe("managed");
    expect(restored?.hasCredential).toBe(true);
  });

  it("rolls provider metadata and credential back when removal reload fails", async () => {
    const { root, grokHome, environment, service } = await fixture();
    await service.upsert(input());
    const original = await readFile(join(grokHome, "config.toml"), "utf8");
    const failing = new ProviderService(join(root, "data"), new LogService(join(root, "remove-rollback.log")), {
      grokHome,
      environment,
      reloadModels: async () => { throw new Error("fake remove reload failure"); },
    });
    await expect(failing.remove("sample")).rejects.toThrow("fake remove reload failure");
    expect(await readFile(join(grokHome, "config.toml"), "utf8")).toBe(original);
    expect(environment.values.get("GROK_DESKTOP_PROVIDER_SAMPLE_KEY")).toBe("test-secret-value");
    expect((await failing.list()).some((value) => value.id === "sample" && value.owned)).toBe(true);
  });

  it("updates the official CLI default without replacing the models table", async () => {
    const { service, grokHome } = await fixture("[models]\nweb_search = \"search-model\"\n"); await service.upsert(input({ credentialMode: "none", credentialValue: undefined })); await service.setCliDefault("sample-model");
    const config = await readFile(join(grokHome, "config.toml"), "utf8"); expect(config).toContain('default = "sample-model"'); expect(config).toContain('web_search = "search-model"');
  });

  it("blocks non-loopback plaintext HTTP unless explicitly acknowledged", async () => { const { service } = await fixture(); await expect(service.upsert(input({ baseUrl: "http://lan.example.test/v1", credentialMode: "none", credentialValue: undefined }))).rejects.toThrow("明确确认"); });

  it("pulls models from a local fake endpoint for all three protocols and applies auth headers without exposing the key", async () => {
    const seen: Array<Record<string, string | string[] | undefined>> = [];
    const server = createServer((request, response) => {
      seen.push(request.headers);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "remote-model", name: "Remote Model" }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("fake provider did not bind");
      const { service, environment } = await fixture();
      environment.values.set("CUSTOM_HEADER_VALUE", "header-secret");
      for (const [index, protocol] of (["chat_completions", "responses", "messages"] as const).entries()) {
        const id = `local-${protocol}`;
        await service.upsert(input({
          id,
          name: id,
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          protocol,
          authScheme: protocol === "messages" ? "x_api_key" : "bearer",
          credentialValue: `secret-${index}`,
          extraHeaders: { "x-custom-test": "CUSTOM_HEADER_VALUE" },
          models: [{ id: `${id}-model`, model: "remote-model", name: "Remote Model", contextWindow: 32_000 }],
        }));
        expect(await service.pullModels(id)).toEqual([{ id: "remote-model", name: "Remote Model" }]);
      }
      expect(seen[0]?.authorization).toBe("Bearer secret-0");
      expect(seen[1]?.authorization).toBe("Bearer secret-1");
      expect(seen[2]?.["x-api-key"]).toBe("secret-2");
      expect(seen.every((headers) => headers["x-custom-test"] === "header-secret")).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("probes unsaved drafts across OpenAI, Ollama and Anthropic model-list shapes", async () => {
    const server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/openai") response.end(JSON.stringify({ data: [{ id: "gpt-test", name: "GPT Test", owned_by: "test" }] }));
      else if (request.url === "/ollama") response.end(JSON.stringify({ models: [{ name: "qwen:test", model: "qwen:test" }] }));
      else response.end(JSON.stringify([{ id: "claude-test", display_name: "Claude Test", context_window: 200_000 }]));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address(); if (!address || typeof address === "string") throw new Error("fake provider did not bind");
      const { root, grokHome, environment } = await fixture();
      const service = new ProviderService(join(root, "draft-data"), new LogService(join(root, "draft.log")), { grokHome, environment });
      const base = `http://127.0.0.1:${address.port}`;
      const openai = await service.probeDraft(draft(base, { modelListUrl: `${base}/openai` }));
      const ollama = await service.discoverDraftModels(draft(base, { id: "ollama", modelListUrl: `${base}/ollama` }));
      const anthropic = await service.probeDraft(draft(base, { id: "anthropic", protocol: "messages", modelListUrl: `${base}/anthropic` }));
      expect(openai).toMatchObject({ ok: true, candidates: [{ remoteId: "gpt-test", name: "GPT Test", ownedBy: "test", alreadyConfigured: false }] });
      expect(ollama[0]).toMatchObject({ remoteId: "qwen:test", name: "qwen:test" });
      expect(anthropic.candidates[0]).toMatchObject({ remoteId: "claude-test", name: "Claude Test", contextWindow: 200_000 });
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });

  it("reports authentication, timeout and oversized-list failures without inference calls", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/auth") { response.writeHead(401); response.end("{}"); return; }
      if (request.url === "/large") { response.setHeader("content-length", "2048"); response.end(JSON.stringify({ data: [] })); return; }
      setTimeout(() => { response.end(JSON.stringify({ data: [] })); }, 120);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address(); if (!address || typeof address === "string") throw new Error("fake provider did not bind");
      const { root, grokHome, environment } = await fixture();
      const service = new ProviderService(join(root, "failure-data"), new LogService(join(root, "failure.log")), { grokHome, environment, probeTimeoutMs: 30, maxProbeResponseBytes: 1024 });
      const base = `http://127.0.0.1:${address.port}`;
      await expect(service.probeDraft(draft(base, { modelListUrl: `${base}/auth` }))).resolves.toMatchObject({ ok: false, status: 401, message: "认证失败（HTTP 401）" });
      await expect(service.probeDraft(draft(base, { modelListUrl: `${base}/large` }))).resolves.toMatchObject({ ok: false, message: "模型列表响应过大，已停止读取" });
      expect((await service.probeDraft(draft(base, { modelListUrl: `${base}/slow` }))).ok).toBe(false);
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });

  it("creates stable safe local model ids and adds a hash on collisions", () => {
    const occupied = new Set<string>();
    const first = providerModelLocalId("网关", "org/model:latest", occupied);
    const second = providerModelLocalId("网关", "org/model:latest", occupied);
    expect(first).toMatch(/^[a-z0-9][a-z0-9._-]{0,63}$/);
    expect(second).toMatch(/-[0-9a-f]{8}$/);
    expect(second).not.toBe(first);
  });
});
