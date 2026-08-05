import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CustomProviderProfile } from "../../shared/types";
import { PROVIDER_THINKING_END, PROVIDER_THINKING_START } from "../../shared/provider-gateway-markers";
import { LogService } from "./log-service";
import { ProviderGatewayService, sanitizeProviderSchema } from "./provider-gateway-service";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("provider schema compatibility", () => {
  it("removes the null/empty enum values rejected by Gemini tool declarations", () => {
    const input = { tools: [{ function: { parameters: { properties: {
      todos: { items: { properties: { status: { enum: ["pending", "completed", null, ""] } } } },
      isolation: { enum: ["none", "worktree", null] },
      capability_mode: { type: ["string", "null"], enum: ["all", null] },
    } } } }] };
    const result = sanitizeProviderSchema(input, "gemini");
    expect(result.value).toEqual({ tools: [{ function: { parameters: { properties: {
      todos: { items: { properties: { status: { enum: ["pending", "completed"] } } } },
      isolation: { enum: ["none", "worktree"] },
      capability_mode: { type: "string", enum: ["all"] },
    } } } }] });
    expect(result.changed).toBe(4);
  });

  it("preserves required fields and tool names", () => {
    const result = sanitizeProviderSchema({ name: "todo_write", required: ["todos"], properties: { todos: { type: "array" } } }, "strict");
    expect(result.value).toMatchObject({ name: "todo_write", required: ["todos"] });
  });

  it("leaves standard-profile bodies byte-identical instead of dropping legitimate empty enum members", () => {
    const input = { tools: [{ function: { parameters: { properties: { separator: { enum: ["", ",", null] } } } } }], messages: [{ role: "user", content: "" }] };
    const result = sanitizeProviderSchema(input, "standard");
    expect(result.value).toBe(input);
    expect(result.changed).toBe(0);
    expect(JSON.parse(JSON.stringify(result.value))).toEqual(input);
  });
});

describe("ProviderGatewayService", () => {
  it("rejects a cross-origin upstream redirect without following it", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-gateway-redirect-")); roots.push(root);
    const provider: CustomProviderProfile = {
      id: "redirect", name: "Redirect", baseUrl: "https://provider.example/v1", protocol: "chat_completions",
      upstreamProtocol: "openai_chat", schemaProfile: "standard", authScheme: "bearer", credentialMode: "existing",
      credentialEnv: "REDIRECT_KEY", extraHeaders: {}, models: [], owned: true, hasCredential: true, insecureHttp: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    let calls = 0;
    const gateway = new ProviderGatewayService({
      providers: async () => [provider], environment: async () => "secret", log: new LogService(join(root, "gateway.log")),
      fetcher: async () => { calls += 1; return new Response(null, { status: 307, headers: { location: "https://attacker.example/steal" } }); },
    });
    try {
      const response = await fetch(`${await gateway.route(provider.id)}/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      expect(response.status).toBe(502);
      expect(await response.text()).toContain("其他 Origin");
      expect(calls).toBe(1);
    } finally { await gateway.dispose(); }
  });

  it("replaces the CLI authorization header with the managed provider credential", async () => {
    let capturedAuthorization = "";
    let capturedApiKey = "";
    let capturedRoute = "";
    let capturedProxyMode = "";
    const upstream = createServer((request, response) => {
      capturedAuthorization = String(request.headers.authorization ?? "");
      capturedApiKey = String(request.headers["x-api-key"] ?? "");
      capturedRoute = String(request.headers["x-route"] ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("fixture failed");
    const root = await mkdtemp(join(tmpdir(), "provider-gateway-auth-")); roots.push(root);
    const provider: CustomProviderProfile = {
      id: "managed-auth", name: "Managed auth", baseUrl: `http://127.0.0.1:${address.port}/v1`, protocol: "chat_completions",
      upstreamProtocol: "openai_chat", schemaProfile: "standard", authScheme: "bearer", credentialMode: "managed",
      proxyMode: "direct",
      credentialEnv: "MANAGED_PROVIDER_KEY", extraHeaders: { "x-route": "MANAGED_PROVIDER_ROUTE" },
      models: [], owned: true, hasCredential: true, insecureHttp: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const values: Record<string, string> = {
      MANAGED_PROVIDER_KEY: "fresh-provider-key",
      MANAGED_PROVIDER_ROUTE: "route-a",
    };
    const gateway = new ProviderGatewayService({
      providers: async () => [provider],
      environment: async (name) => values[name],
      fetcher: (input, init, proxyMode) => {
        capturedProxyMode = proxyMode ?? "";
        return fetch(input, init);
      },
      log: new LogService(join(root, "gateway.log")),
    });
    try {
      const response = await fetch(`${await gateway.route(provider.id)}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer stale-cli-session-token",
          "x-api-key": "stale-cli-api-key",
          "x-route": "stale-route",
        },
        body: "{}",
      });
      expect(response.status).toBe(200);
      expect(capturedAuthorization).toBe("Bearer fresh-provider-key");
      expect(capturedApiKey).toBe("");
      expect(capturedRoute).toBe("route-a");
      expect(capturedProxyMode).toBe("direct");
    } finally {
      await gateway.dispose();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("injects x-api-key credentials and fails before upstream when the managed credential is missing", async () => {
    let calls = 0;
    const upstream = createServer((request, response) => {
      calls += 1;
      expect(request.headers.authorization).toBeUndefined();
      expect(request.headers["x-api-key"]).toBe("fresh-anthropic-key");
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("fixture failed");
    const root = await mkdtemp(join(tmpdir(), "provider-gateway-api-key-")); roots.push(root);
    const provider: CustomProviderProfile = {
      id: "api-key", name: "API key", baseUrl: `http://127.0.0.1:${address.port}`, protocol: "messages",
      upstreamProtocol: "anthropic_messages", schemaProfile: "standard", authScheme: "x_api_key", credentialMode: "existing",
      credentialEnv: "ANTHROPIC_FIXTURE_KEY", extraHeaders: {}, models: [], owned: true, hasCredential: true, insecureHttp: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    let value: string | undefined = "fresh-anthropic-key";
    const gateway = new ProviderGatewayService({
      providers: async () => [provider],
      environment: async () => value,
      fetcher: fetch,
      log: new LogService(join(root, "gateway.log")),
    });
    try {
      const route = await gateway.route(provider.id);
      expect((await fetch(`${route}/messages`, { method: "POST", headers: { authorization: "Bearer cli-token" }, body: "{}" })).status).toBe(200);
      value = undefined;
      const missing = await fetch(`${route}/messages`, { method: "POST", headers: { authorization: "Bearer cli-token" }, body: "{}" });
      expect(missing.status).toBe(401);
      expect(await missing.json()).toEqual({ error: { message: "提供商凭据不可用", phase: "provider-gateway" } });
      expect(calls).toBe(1);
    } finally {
      await gateway.dispose();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("downgrades only unsigned Anthropic thinking SSE blocks to compatible text", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-gateway-anthropic-thinking-")); roots.push(root);
    const provider: CustomProviderProfile = {
      id: "anthropic-thinking", name: "Anthropic thinking", baseUrl: "https://fixture.invalid/v1", protocol: "messages",
      upstreamProtocol: "anthropic_messages", schemaProfile: "standard", authScheme: "x_api_key", credentialMode: "none",
      extraHeaders: {}, models: [], owned: true, hasCredential: true, insecureHttp: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const malformed = [
      'event: message_start\ndata: {"type":"message_start","message":{"content":[]}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"private route"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"answer"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ].join("");
    const gateway = new ProviderGatewayService({
      providers: async () => [provider],
      fetcher: async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          // Deliberately split JSON/SSE boundaries to exercise incremental
          // parsing instead of a whole-response fixture shortcut.
          for (let offset = 0; offset < malformed.length; offset += 17) {
            controller.enqueue(new TextEncoder().encode(malformed.slice(offset, offset + 17)));
          }
          controller.close();
        },
      }), { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } }),
      log: new LogService(join(root, "gateway.log")),
    });
    try {
      const response = await fetch(`${await gateway.route(provider.id)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stream: true }),
      });
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain(`"content_block":{"type":"text","text":"${PROVIDER_THINKING_START}"}`);
      expect(body).toContain('"delta":{"type":"text_delta","text":"private route"}');
      expect(body).toContain(`"delta":{"type":"text_delta","text":"${PROVIDER_THINKING_END}"}`);
      expect(body).toContain('"delta":{"type":"text_delta","text":"answer"}');
      expect(body).not.toContain('"type":"thinking"');
      expect(body).not.toContain('"type":"thinking_delta"');
      const log = new LogService(join(root, "gateway.log"));
      let logged = "";
      for (let attempt = 0; attempt < 20; attempt += 1) {
        logged = await log.read();
        if (logged.includes("adapted 3 unsigned Anthropic thinking event(s)")) break;
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      }
      expect(logged).toContain("adapted 3 unsigned Anthropic thinking event(s)");
    } finally {
      await gateway.dispose();
    }
  });

  it("keeps valid signed Anthropic thinking SSE byte-for-byte unchanged", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-gateway-anthropic-signed-")); roots.push(root);
    const provider: CustomProviderProfile = {
      id: "anthropic-signed", name: "Anthropic signed", baseUrl: "https://fixture.invalid/v1", protocol: "messages",
      upstreamProtocol: "anthropic_messages", schemaProfile: "standard", authScheme: "x_api_key", credentialMode: "none",
      extraHeaders: {}, models: [], owned: true, hasCredential: true, insecureHttp: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const signed = [
      'event: content_block_start\r\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}\r\n\r\n',
      'event: content_block_delta\r\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"ok"}}\r\n\r\n',
      'event: content_block_delta\r\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"signed-value"}}\r\n\r\n',
      'event: content_block_stop\r\ndata: {"type":"content_block_stop","index":0}\r\n\r\n',
    ].join("");
    const gateway = new ProviderGatewayService({
      providers: async () => [provider],
      fetcher: async () => new Response(signed, { status: 200, headers: { "content-type": "text/event-stream" } }),
      log: new LogService(join(root, "gateway.log")),
    });
    try {
      const response = await fetch(`${await gateway.route(provider.id)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stream: true }),
      });
      expect(await response.text()).toBe(signed);
    } finally {
      await gateway.dispose();
    }
  });

  it("downgrades unsigned thinking in non-streaming Anthropic Messages responses", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-gateway-anthropic-json-")); roots.push(root);
    const provider: CustomProviderProfile = {
      id: "anthropic-json", name: "Anthropic JSON", baseUrl: "https://fixture.invalid/v1", protocol: "messages",
      upstreamProtocol: "anthropic_messages", schemaProfile: "standard", authScheme: "x_api_key", credentialMode: "none",
      extraHeaders: {}, models: [], owned: true, hasCredential: true, insecureHttp: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const gateway = new ProviderGatewayService({
      providers: async () => [provider],
      fetcher: async () => Response.json({
        id: "msg_fixture",
        type: "message",
        content: [
          { type: "thinking", thinking: "route" },
          { type: "text", text: "answer" },
        ],
      }),
      log: new LogService(join(root, "gateway.log")),
    });
    try {
      const response = await fetch(`${await gateway.route(provider.id)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stream: false }),
      });
      expect(await response.json()).toMatchObject({
        content: [
          { type: "text", text: `${PROVIDER_THINKING_START}route${PROVIDER_THINKING_END}` },
          { type: "text", text: "answer" },
        ],
      });
    } finally {
      await gateway.dispose();
    }
  });

  it("binds only to loopback, sanitizes JSON and streams the upstream response", async () => {
    let captured: any;
    const upstream = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      captured = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "content-type": "text/event-stream", "x-request-id": "fixture-trace" });
      response.write("data: first\n\n");
      response.end("data: [DONE]\n\n");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("fixture failed");
    const root = await mkdtemp(join(tmpdir(), "provider-gateway-")); roots.push(root);
    const provider: CustomProviderProfile = {
      id: "fixture", name: "Fixture", baseUrl: `http://127.0.0.1:${address.port}/v1`, protocol: "chat_completions",
      upstreamProtocol: "openai_chat", schemaProfile: "gemini", authScheme: "bearer", credentialMode: "none",
      extraHeaders: {}, models: [], owned: true, hasCredential: true, insecureHttp: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const gateway = new ProviderGatewayService({ providers: async () => [provider], fetcher: fetch, log: new LogService(join(root, "gateway.log")) });
    try {
      const route = await gateway.route("fixture");
      expect(route).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
      const response = await fetch(`${route}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer fixture-secret" },
        body: JSON.stringify({ tools: [{ function: { parameters: { properties: { status: { enum: ["ok", null, ""] } } } } }] }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("x-request-id")).toBe("fixture-trace");
      expect(await response.text()).toContain("[DONE]");
      expect(captured.tools[0].function.parameters.properties.status.enum).toEqual(["ok"]);
    } finally {
      await gateway.dispose();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("binds exactly one listener when parallel session launches request routes at once", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-gateway-race-")); roots.push(root);
    const listeners = (): number => process.getActiveResourcesInfo().filter((value) => value.toLowerCase() === "tcpserverwrap").length;
    const gateway = new ProviderGatewayService({ providers: async () => [], fetcher: fetch, log: new LogService(join(root, "gateway.log")) });
    const before = listeners();
    try {
      const routes = await Promise.all(Array.from({ length: 8 }, (_value, index) => gateway.route(`p${index}`)));
      expect(new Set(routes.map((route) => new URL(route).port)).size).toBe(1);
      // Each caller past the `server` guard would otherwise bind its own port
      // and only the last would ever be closed.
      expect(listeners()).toBe(before + 1);
    } finally {
      await gateway.dispose();
    }
    // Node drops the closed handle from the resource list a few ticks later.
    for (let attempt = 0; attempt < 100 && listeners() > before; attempt++) await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(listeners()).toBe(before);
  });

  it("keeps failure observations isolated to the exact launched process scope", async () => {
    const upstream = createServer((_request, response) => response.writeHead(429, { "x-request-id": "scope-trace" }).end("{}"));
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("fixture failed");
    const root = await mkdtemp(join(tmpdir(), "provider-gateway-scope-")); roots.push(root);
    const provider: CustomProviderProfile = {
      id: "scoped", name: "Scoped", baseUrl: `http://127.0.0.1:${address.port}`, protocol: "chat_completions",
      upstreamProtocol: "openai_chat", schemaProfile: "standard", authScheme: "bearer", credentialMode: "none",
      extraHeaders: {}, models: [], owned: true, hasCredential: true, insecureHttp: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const gateway = new ProviderGatewayService({ providers: async () => [provider], fetcher: fetch, log: new LogService(join(root, "gateway.log")) });
    try {
      await fetch(`${await gateway.route("scoped", "session-a")}/chat/completions`, { method: "POST", body: "{}" });
      await fetch(`${await gateway.route("scoped", "session-b")}/chat/completions`, { method: "POST", body: "{}" });
      expect(gateway.recentFailures("scoped", "session-a")).toEqual([expect.objectContaining({ scopeId: "session-a", status: 429 })]);
      expect(gateway.recentFailures("scoped", "session-b")).toEqual([expect.objectContaining({ scopeId: "session-b", status: 429 })]);
    } finally {
      await gateway.dispose();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("keeps successful body-free observations for later CLI parser attribution", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-gateway-observation-")); roots.push(root);
    const provider: CustomProviderProfile = {
      id: "observed", name: "Observed", baseUrl: "https://fixture.invalid/v1", protocol: "responses",
      upstreamProtocol: "openai_responses", schemaProfile: "standard", authScheme: "bearer", credentialMode: "none",
      proxyMode: "direct", extraHeaders: {}, models: [], owned: true, hasCredential: true, insecureHttp: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const gateway = new ProviderGatewayService({
      providers: async () => [provider],
      fetcher: async () => new Response("data: done\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream", "x-request-id": "completed-trace" },
      }),
      log: new LogService(join(root, "gateway.log")),
    });
    try {
      const response = await fetch(`${await gateway.route(provider.id, "parser-scope")}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stream: true }),
      });
      await response.text();
      expect(gateway.recentFailures(provider.id, "parser-scope")).toEqual([]);
      expect(gateway.recentObservations(provider.id, "parser-scope")[0]).toMatchObject({
        outcome: "completed",
        status: 200,
        traceId: "completed-trace",
        endpoint: "responses",
        proxyMode: "direct",
      });
    } finally {
      await gateway.dispose();
    }
  });

  it("classifies a downstream stream close as cancellation instead of provider failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-gateway-downstream-close-")); roots.push(root);
    const provider: CustomProviderProfile = {
      id: "close", name: "Close", baseUrl: "https://fixture.invalid/v1", protocol: "responses",
      upstreamProtocol: "openai_responses", schemaProfile: "standard", authScheme: "bearer", credentialMode: "none",
      extraHeaders: {}, models: [], owned: true, hasCredential: true, insecureHttp: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const gateway = new ProviderGatewayService({
      providers: async () => [provider],
      fetcher: async (_input, init) => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: first\n\n"));
          const timer = setInterval(() => {
            try { controller.enqueue(new TextEncoder().encode("data: later\n\n")); }
            catch { clearInterval(timer); }
          }, 25);
          init?.signal?.addEventListener("abort", () => {
            clearInterval(timer);
            try { controller.error(new Error("fixture observed downstream abort")); } catch { /* already closed */ }
          }, { once: true });
        },
      }), { status: 200, headers: { "content-type": "text/event-stream" } }),
      log: new LogService(join(root, "gateway.log")),
    });
    try {
      const response = await fetch(`${await gateway.route(provider.id, "closed-scope")}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stream: true }),
      });
      const reader = response.body!.getReader();
      await reader.read();
      await reader.cancel();
      for (let attempt = 0; attempt < 100 && !gateway.recentObservations(provider.id, "closed-scope").length; attempt += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      expect(gateway.recentFailures(provider.id, "closed-scope")).toEqual([]);
      expect(gateway.recentObservations(provider.id, "closed-scope")[0]).toMatchObject({
        outcome: "downstream-closed",
        reason: "downstream-response-closed",
      });
    } finally {
      await gateway.dispose();
    }
  });

  it("forwards non-UTF-8 request bytes to the upstream unchanged", async () => {
    const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x1a]);
    let received = Buffer.alloc(0);
    const upstream = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      received = Buffer.concat(chunks);
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("fixture failed");
    const root = await mkdtemp(join(tmpdir(), "provider-gateway-binary-")); roots.push(root);
    const provider: CustomProviderProfile = {
      id: "binary", name: "Binary", baseUrl: `http://127.0.0.1:${address.port}/v1`, protocol: "chat_completions",
      upstreamProtocol: "openai_chat", schemaProfile: "standard", authScheme: "bearer", credentialMode: "none",
      extraHeaders: {}, models: [], owned: true, hasCredential: true, insecureHttp: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const gateway = new ProviderGatewayService({ providers: async () => [provider], fetcher: fetch, log: new LogService(join(root, "gateway.log")) });
    try {
      const route = await gateway.route("binary");
      const response = await fetch(`${route}/audio/transcriptions`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: new Uint8Array(payload),
      });
      expect(response.status).toBe(200);
      expect(received.equals(payload)).toBe(true);
    } finally {
      await gateway.dispose();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("returns structured errors for oversized requests, oversized responses and upstream timeouts", async () => {
    const upstream = createServer((request, response) => {
      if (request.url?.endsWith("/slow")) {
        setTimeout(() => response.end("{}"), 120);
        return;
      }
      response.writeHead(200, { "content-type": "application/json", "content-length": "32" });
      response.end("x".repeat(32));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("fixture failed");
    const root = await mkdtemp(join(tmpdir(), "provider-gateway-limits-")); roots.push(root);
    const provider: CustomProviderProfile = {
      id: "limits", name: "Limits", baseUrl: `http://127.0.0.1:${address.port}`, protocol: "chat_completions",
      upstreamProtocol: "openai_chat", schemaProfile: "strict", authScheme: "bearer", credentialMode: "none",
      extraHeaders: {}, models: [], owned: true, hasCredential: true, insecureHttp: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const gateway = new ProviderGatewayService({
      providers: async () => [provider],
      fetcher: fetch,
      log: new LogService(join(root, "gateway.log")),
      maxRequestBytes: 16,
      maxResponseBytes: 8,
      requestTimeoutMs: 25,
    });
    try {
      const route = await gateway.route("limits");
      const largeRequest = await fetch(`${route}/large-request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(32) }),
      });
      expect(largeRequest.status).toBe(413);
      expect(await largeRequest.json()).toMatchObject({ error: { phase: "provider-gateway" } });

      const largeResponse = await fetch(`${route}/large-response`, { method: "POST", body: "{}" });
      expect(largeResponse.status).toBe(413);
      expect(await largeResponse.json()).toMatchObject({ error: { message: "提供商响应过大", phase: "provider-gateway" } });

      const timeout = await fetch(`${route}/slow`, { method: "POST", body: "{}" });
      expect(timeout.status).toBe(502);
      expect(await timeout.json()).toMatchObject({ error: { message: "提供商请求超时", phase: "provider-gateway" } });
      expect(gateway.recentFailures("limits")[0]).toMatchObject({
        proxyMode: "inherit",
        reason: "gateway-timeout",
        phase: "pre-send",
        endpoint: "other",
      });
    } finally {
      await gateway.dispose();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("records an upstream stream truncation after response headers without exposing response content", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-gateway-stream-error-")); roots.push(root);
    const provider: CustomProviderProfile = {
      id: "stream-error", name: "Stream error", baseUrl: "https://fixture.invalid/v1", protocol: "responses",
      upstreamProtocol: "openai_responses", schemaProfile: "standard", proxyMode: "direct", authScheme: "bearer", credentialMode: "none",
      extraHeaders: {}, models: [], owned: true, hasCredential: true, insecureHttp: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const gateway = new ProviderGatewayService({
      providers: async () => [provider],
      fetcher: async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: first\n\n"));
          setTimeout(() => controller.error(new Error("upstream fixture stream truncated")), 10);
        },
      }), { status: 200, headers: { "content-type": "text/event-stream" } }),
      log: new LogService(join(root, "gateway.log")),
    });
    try {
      const response = await fetch(`${await gateway.route(provider.id, "stream-scope")}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stream: true }),
      });
      await expect(response.text()).rejects.toThrow();
      expect(gateway.recentFailures(provider.id, "stream-scope")[0]).toMatchObject({
        proxyMode: "direct",
        endpoint: "responses",
        phase: "response",
        reason: "upstream-stream",
      });
      expect(gateway.recentFailures(provider.id, "stream-scope")[0]?.message).not.toContain("data: first");
    } finally {
      await gateway.dispose();
    }
  });

  it("never returns arbitrary upstream exception or stack details to the loopback caller", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-gateway-public-error-")); roots.push(root);
    const provider: CustomProviderProfile = {
      id: "public-error", name: "Public error", baseUrl: "https://fixture.invalid", protocol: "chat_completions",
      upstreamProtocol: "openai_chat", schemaProfile: "standard", authScheme: "bearer", credentialMode: "none",
      extraHeaders: {}, models: [], owned: true, hasCredential: true, insecureHttp: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const gateway = new ProviderGatewayService({
      providers: async () => [provider],
      fetcher: async () => { throw new Error("C:\\private\\gateway.ts:44\nat internalHandler (secret.ts:2:1)"); },
      log: new LogService(join(root, "gateway.log")),
    });
    try {
      const response = await fetch(`${await gateway.route("public-error")}/chat/completions`, { method: "POST", body: "{}" });
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: { message: "提供商网关请求失败", phase: "provider-gateway" } });
    } finally {
      await gateway.dispose();
    }
  });
});

describe("ProviderGatewayService cross-protocol routing", () => {
  it("uses a model-level client protocol's native upstream instead of the Provider default", async () => {
    let upstreamPath = "";
    const upstream = createServer(async (request, response) => {
      upstreamPath = request.url ?? "";
      for await (const _chunk of request) { /* consume request */ }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "resp_native", object: "response", status: "completed", model: "grok-4.5", output: [] }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("fixture failed");
    const root = await mkdtemp(join(tmpdir(), "provider-gateway-model-protocol-")); roots.push(root);
    const provider: CustomProviderProfile = {
      id: "mixed", name: "Mixed", baseUrl: `http://127.0.0.1:${address.port}/v1`,
      protocol: "chat_completions", upstreamProtocol: "openai_chat", schemaProfile: "standard",
      authScheme: "bearer", credentialMode: "none", proxyMode: "direct", extraHeaders: {},
      models: [{ id: "mixed-grok", model: "grok-4.5", name: "Grok", protocol: "responses" }],
      owned: true, hasCredential: true, insecureHttp: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const gateway = new ProviderGatewayService({
      providers: async () => [provider],
      fetcher: (input, init) => fetch(input, init),
      log: new LogService(join(root, "gateway.log")),
    });
    try {
      const response = await fetch(`${await gateway.route(provider.id)}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "grok-4.5", input: "Hi", stream: false }),
      });
      expect(response.status).toBe(200);
      expect(upstreamPath).toBe("/v1/responses");
      expect((await response.json() as any).object).toBe("response");
    } finally {
      await gateway.dispose();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("routes a Chat client through a Responses-only upstream and converts the answer", async () => {
    let upstreamPath = "";
    let upstreamBody: any;
    const upstream = createServer(async (request, response) => {
      upstreamPath = request.url ?? "";
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      upstreamBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        id: "resp_fixture",
        object: "response",
        status: "completed",
        model: "grok-4.5",
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "OK" }] }],
        usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
      }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("fixture failed");
    const root = await mkdtemp(join(tmpdir(), "provider-gateway-translate-")); roots.push(root);
    const provider: CustomProviderProfile = {
      id: "translate", name: "Translate", baseUrl: `http://127.0.0.1:${address.port}/v1`,
      protocol: "chat_completions", upstreamProtocol: "openai_responses", schemaProfile: "standard",
      authScheme: "bearer", credentialMode: "none", proxyMode: "direct", extraHeaders: {},
      models: [{ id: "translate-grok", model: "grok-4.5", name: "Grok" }],
      owned: true, hasCredential: true, insecureHttp: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const gateway = new ProviderGatewayService({
      providers: async () => [provider],
      fetcher: (input, init) => fetch(input, init),
      log: new LogService(join(root, "gateway.log")),
    });
    try {
      const response = await fetch(`${await gateway.route(provider.id)}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "grok-4.5", messages: [{ role: "user", content: "Hi" }], stream: false, reasoning_effort: "high" }),
      });
      expect(response.status).toBe(200);
      expect(upstreamPath).toBe("/v1/responses");
      expect(upstreamBody).toMatchObject({ model: "grok-4.5", input: [{ role: "user" }], reasoning: { effort: "high" } });
      const body = await response.json() as any;
      expect(body.object).toBe("chat.completion");
      expect(body.choices[0].message.content).toBe("OK");
    } finally {
      await gateway.dispose();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("flushes a downstream SSE bridge before a delayed cross-protocol stream completes", async () => {
    const upstream = createServer(async (request, response) => {
      for await (const _chunk of request) { /* consume request */ }
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.flushHeaders();
      setTimeout(() => {
        response.write(`data: ${JSON.stringify({ id: "chat_1", model: "remote", choices: [{ delta: { content: "OK" }, finish_reason: null }] })}\n\n`);
      }, 20);
      setTimeout(() => {
        response.write(`data: ${JSON.stringify({ id: "chat_1", model: "remote", choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
        response.end("data: [DONE]\n\n");
      }, 120);
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("fixture failed");
    const root = await mkdtemp(join(tmpdir(), "provider-gateway-sse-bridge-")); roots.push(root);
    const provider: CustomProviderProfile = {
      id: "sse-bridge", name: "SSE bridge", baseUrl: `http://127.0.0.1:${address.port}/v1`,
      protocol: "responses", upstreamProtocol: "openai_chat", schemaProfile: "standard",
      authScheme: "bearer", credentialMode: "none", proxyMode: "direct", extraHeaders: {},
      models: [{ id: "bridge-model", model: "remote", name: "Remote" }],
      owned: true, hasCredential: true, insecureHttp: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const gateway = new ProviderGatewayService({
      providers: async () => [provider],
      fetcher: (input, init) => fetch(input, init),
      log: new LogService(join(root, "gateway.log")),
    });
    try {
      const response = await fetch(`${await gateway.route(provider.id)}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "remote", input: "Hi", stream: true }),
      });
      const reader = response.body!.getReader();
      const first = await reader.read();
      const firstText = new TextDecoder().decode(first.value);
      expect(firstText).toContain("response.output_text.delta");
      expect(firstText).not.toContain("response.completed");
      let rest = "";
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        rest += new TextDecoder().decode(next.value);
      }
      expect(rest).toContain("response.completed");
    } finally {
      await gateway.dispose();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it.each([
    {
      label: "premature EOF",
      frame: `data: ${JSON.stringify({ id: "partial", model: "remote", choices: [{ delta: { content: "half" }, finish_reason: null }] })}\n\n`,
      failure: "有效终态前结束",
    },
    {
      label: "explicit error event",
      frame: `data: ${JSON.stringify({ error: { message: "upstream failed" } })}\n\n`,
      failure: "错误终态",
    },
  ])("does not record a translated SSE $label as completed", async ({ frame, failure }) => {
    const upstream = createServer(async (request, response) => {
      for await (const _chunk of request) { /* consume request */ }
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(frame);
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("fixture failed");
    const root = await mkdtemp(join(tmpdir(), "provider-gateway-sse-terminal-")); roots.push(root);
    const provider: CustomProviderProfile = {
      id: "sse-terminal", name: "SSE terminal", baseUrl: `http://127.0.0.1:${address.port}/v1`,
      protocol: "responses", upstreamProtocol: "openai_chat", schemaProfile: "standard",
      authScheme: "bearer", credentialMode: "none", proxyMode: "direct", extraHeaders: {},
      models: [{ id: "terminal-model", model: "remote", name: "Remote" }],
      owned: true, hasCredential: true, insecureHttp: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const gateway = new ProviderGatewayService({
      providers: async () => [provider],
      fetcher: (input, init) => fetch(input, init),
      log: new LogService(join(root, "gateway.log")),
    });
    try {
      const response = await fetch(`${await gateway.route(provider.id, "terminal-scope")}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "remote", input: "Hi", stream: true }),
      });
      await response.text().catch(() => "");
      const observations = gateway.recentObservations(provider.id, "terminal-scope");
      expect(observations.some((entry) => entry.outcome === "completed")).toBe(false);
      expect(observations[0]).toMatchObject({ outcome: "failed", phase: "response", reason: "upstream-stream" });
      expect(gateway.recentFailures(provider.id, "terminal-scope")[0]?.message).toContain(failure);
    } finally {
      await gateway.dispose();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
});
