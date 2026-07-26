import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CustomProviderProfile } from "../../shared/types";
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
    } finally {
      await gateway.dispose();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
});
