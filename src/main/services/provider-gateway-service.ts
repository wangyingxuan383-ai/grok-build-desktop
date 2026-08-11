import { randomBytes } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { CustomProviderProfile, ProviderProxyMode, ProviderSchemaProfile } from "../../shared/types";
import { PROVIDER_THINKING_END, PROVIDER_THINKING_START } from "../../shared/provider-gateway-markers";
import type { LogService } from "./log-service";
import {
  translateProviderRequest,
  translateProviderResponse,
  ProviderSseIncrementalBridge,
  type ProviderRequestTranslation,
} from "./provider-protocol-translator";

const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
/** Maximum wait for upstream response headers; stream-idle remains a CLI/model setting. */
const REQUEST_TIMEOUT_MS = 360_000;
const RESPONSE_HEADERS = new Set([
  "content-type", "date", "retry-after", "server-timing", "x-request-id",
  "x-trace-id", "x-cloud-trace-context", "x-cloudaicompanion-trace-id",
  "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset",
]);

/** What the gateway saw for one failed upstream call. Kept in memory only. */
export interface GatewayFailureRecord {
  requestId: string;
  at: string;
  providerId: string;
  scopeId: string;
  proxyMode: ProviderProxyMode;
  endpoint: "responses" | "chat-completions" | "messages" | "other";
  elapsedMs: number;
  status?: number;
  statusText?: string;
  traceId?: string;
  retryAfter?: string;
  phase: "pre-send" | "upstream" | "response";
  reason: "gateway-timeout" | "downstream-request-aborted" | "downstream-response-closed" | "upstream-connect" | "upstream-stream" | "request-validation" | "upstream-http";
  sanitizedCount: number;
  message: string;
}

/** Body-free terminal observation for provider attribution and diagnostics. */
export interface GatewayRequestObservation {
  requestId: string;
  at: string;
  providerId: string;
  scopeId: string;
  proxyMode: ProviderProxyMode;
  endpoint: GatewayFailureRecord["endpoint"];
  elapsedMs: number;
  status?: number;
  statusText?: string;
  traceId?: string;
  retryAfter?: string;
  phase: GatewayFailureRecord["phase"];
  reason?: GatewayFailureRecord["reason"];
  outcome: "completed" | "failed" | "downstream-closed";
  sanitizedCount: number;
}

export interface ProviderSchemaSanitizeResult {
  value: unknown;
  changed: number;
  paths: string[];
}

export interface ProviderGatewayOptions {
  providers(): Promise<CustomProviderProfile[]>;
  environment?(name: string): Promise<string | undefined>;
  fetcher(
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
    proxyMode?: ProviderProxyMode,
  ): Promise<Response>;
  log: LogService;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  requestTimeoutMs?: number;
}

/**
 * A per-process, loopback-only compatibility gateway. Grok CLI receives an
 * opaque local route while the renderer never receives provider credentials
 * or upstream request bodies.
 */
export class ProviderGatewayService {
  private server?: Server;
  private port = 0;
  private starting?: Promise<void>;
  /** Bounded, in-memory only. Never persisted and never contains a credential or a body. */
  private readonly failures: GatewayFailureRecord[] = [];
  /** Includes successful routes so a later CLI parser error can still be attributed. */
  private readonly observations: GatewayRequestObservation[] = [];
  private readonly token = randomBytes(24).toString("base64url");

  constructor(private readonly options: ProviderGatewayOptions) {}

  /** Most recent failures first, optionally narrowed to one provider. */
  recentFailures(providerId?: string, scopeId?: string): GatewayFailureRecord[] {
    return this.failures
      .filter((value) => (!providerId || value.providerId === providerId) && (!scopeId || value.scopeId === scopeId))
      .slice()
      .reverse();
  }

  recentObservations(providerId?: string, scopeId?: string): GatewayRequestObservation[] {
    return this.observations
      .filter((value) => (!providerId || value.providerId === providerId) && (!scopeId || value.scopeId === scopeId))
      .slice()
      .reverse();
  }

  private observe(entry: GatewayRequestObservation): void {
    this.observations.push(entry);
    while (this.observations.length > 200) this.observations.shift();
  }

  private recordFailure(entry: GatewayFailureRecord): void {
    this.failures.push(entry);
    while (this.failures.length > 100) this.failures.shift();
    this.observe({ ...entry, outcome: "failed" });
  }

  async route(providerId: string, scopeId = "unscoped"): Promise<string> {
    await this.start();
    return `http://127.0.0.1:${this.port}/${this.token}/${encodeURIComponent(providerId)}/${encodeURIComponent(scopeId)}`;
  }

  /**
   * Parallel session launches call this concurrently, so the in-flight listen
   * is shared. Without it every caller past the `server` check would bind its
   * own port and all but the last would leak.
   */
  async start(): Promise<void> {
    if (this.server) return;
    this.starting ??= this.listen().finally(() => { this.starting = undefined; });
    return this.starting;
  }

  private async listen(): Promise<void> {
    const server = createServer((request, response) => void this.handle(request, response));
    server.maxHeadersCount = 80;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        const address = server.address();
        if (!address || typeof address === "string") return reject(new Error("提供商兼容网关未获得本机端口"));
        this.port = address.port;
        this.server = server;
        resolve();
      });
    });
  }

  async dispose(): Promise<void> {
    await this.starting?.catch(() => undefined);
    const server = this.server;
    this.server = undefined;
    this.port = 0;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await this.options.log.flush();
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestId = randomBytes(6).toString("hex");
    const started = Date.now();
    let failingProviderId = "unknown";
    let failingScopeId = "unknown";
    let proxyMode: ProviderProxyMode = "inherit";
    let endpoint: GatewayFailureRecord["endpoint"] = "other";
    let changed = 0;
    let upstream: Response | undefined;
    let fetchStarted = false;
    let abortReason: GatewayFailureRecord["reason"] | undefined;
    let failureRecorded = false;
    let translation: ProviderRequestTranslation | undefined;
    let cleanupAbortHandlers = (): void => undefined;
    try {
      if (request.method !== "POST") return jsonError(response, 405, "只允许推理 POST 请求");
      const match = new RegExp(`^/${escapeRegex(this.token)}/([^/]+)/([^/]+)(/.*)?$`).exec(request.url ?? "");
      if (!match) return jsonError(response, 404, "提供商路由不存在");
      const providerId = decodeURIComponent(match[1]!);
      const scopeId = decodeURIComponent(match[2]!);
      failingProviderId = providerId;
      failingScopeId = scopeId;
      const provider = (await this.options.providers()).find((value) => value.owned && value.enabled !== false && value.id === providerId);
      if (!provider) return jsonError(response, 404, "提供商不存在");
      proxyMode = provider.proxyMode ?? "inherit";
      endpoint = gatewayEndpoint(match[3] || "");
      const raw = await readRequest(request, this.options.maxRequestBytes ?? MAX_REQUEST_BYTES);
      let body = raw;
      let streaming = false;
      let upstreamSuffix = match[3] || "";
      if (/application\/json/i.test(String(request.headers["content-type"] ?? "")) && raw.length) {
        const parsed = JSON.parse(raw.toString("utf8"));
        const modelId = parsed && typeof parsed === "object" ? String((parsed as Record<string, unknown>).model ?? "") : "";
        const model = provider.models.find((value) => value.enabled !== false && (value.model === modelId || value.id === modelId));
        translation = translateProviderRequest({
          path: upstreamSuffix,
          body: parsed as Record<string, unknown>,
          providerProtocol: model?.protocol ?? provider.protocol,
          // A model-level client-protocol override without an explicit
          // upstream override means the matching native upstream protocol,
          // not the Provider's differently shaped default.
          providerUpstreamProtocol: model?.upstreamProtocol ?? (model?.protocol ? undefined : provider.upstreamProtocol),
          model,
        });
        upstreamSuffix = translation.upstreamPath;
        streaming = translation.stream;
        const sanitized = sanitizeProviderSchema(translation.body, provider.schemaProfile ?? "standard");
        body = Buffer.from(JSON.stringify(sanitized.value));
        changed = sanitized.changed;
      }
      await this.options.log.log(`Provider gateway request ${requestId} started provider=${provider.id} route=${proxyMode} endpoint=${endpoint} bytes=${body.length} stream=${streaming} translated=${Boolean(translation?.translated)}`);
      const upstreamUrl = joinUrl(provider.baseUrl, upstreamSuffix);
      const abort = new AbortController();
      const abortWith = (reason: GatewayFailureRecord["reason"], message: string): void => {
        abortReason ??= reason;
        if (!abort.signal.aborted) abort.abort(new Error(message));
      };
      const onRequestAborted = (): void => abortWith("downstream-request-aborted", "本机调用方在请求阶段断开");
      const onResponseClosed = (): void => {
        if (!response.writableEnded) abortWith("downstream-response-closed", "本机调用方在响应阶段断开");
      };
      const timeout = setTimeout(() => abortWith("gateway-timeout", "提供商请求头超时"), this.options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS);
      request.once("aborted", onRequestAborted);
      response.once("close", onResponseClosed);
      cleanupAbortHandlers = () => {
        clearTimeout(timeout);
        request.off("aborted", onRequestAborted);
        response.off("close", onResponseClosed);
      };
      try {
        const headers = await this.forwardProviderHeaders(request.headers, provider);
        if (translation?.upstreamProtocol === "anthropic_messages" && !headers["anthropic-version"]) {
          headers["anthropic-version"] = "2023-06-01";
        }
        fetchStarted = true;
        upstream = await this.options.fetcher(upstreamUrl, {
          method: "POST",
          headers,
          // Forwarded as bytes: re-encoding through a UTF-8 string would
          // corrupt binary and multipart payloads.
          body: new Uint8Array(body),
          redirect: "manual",
          signal: abort.signal,
        }, proxyMode);
      } finally {
        clearTimeout(timeout);
      }
      if (changed) await this.options.log.log(`Provider gateway sanitized ${changed} schema value(s) for ${provider.id}`);
      const declaredLength = Number(upstream.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > (this.options.maxResponseBytes ?? MAX_RESPONSE_BYTES)) {
        throw new Error("提供商响应过大");
      }
      if (upstream.status >= 300 && upstream.status < 400) {
        const location = upstream.headers.get("location");
        const destination = location ? new URL(location, upstreamUrl) : undefined;
        if (destination && destination.origin !== new URL(provider.baseUrl).origin) {
          await upstream.body?.cancel().catch(() => undefined);
          this.recordFailure({
            at: new Date().toISOString(), requestId, providerId: provider.id, scopeId, proxyMode, endpoint,
            elapsedMs: Date.now() - started, status: upstream.status, statusText: upstream.statusText,
            phase: "upstream", reason: "upstream-http", sanitizedCount: changed,
            message: "提供商响应试图重定向到其他 Origin，已拒绝",
          });
          failureRecorded = true;
          cleanupAbortHandlers();
          return jsonError(response, 502, "提供商重定向到其他 Origin，已拒绝");
        }
      }
      if (upstream.status >= 400) {
        this.recordFailure({
          at: new Date().toISOString(),
          requestId,
          providerId: provider.id,
          scopeId,
          proxyMode,
          endpoint,
          elapsedMs: Date.now() - started,
          status: upstream.status,
          statusText: upstream.statusText,
          traceId: traceHeader(upstream.headers),
          retryAfter: upstream.headers.get("retry-after") ?? undefined,
          phase: "upstream",
          reason: "upstream-http",
          sanitizedCount: changed,
          message: `${upstream.status} ${upstream.statusText}`.trim(),
        });
        failureRecorded = true;
      }
      response.statusCode = upstream.status;
      response.statusMessage = upstream.statusText;
      for (const [name, value] of upstream.headers) if (RESPONSE_HEADERS.has(name.toLowerCase())) response.setHeader(name, value);
      if (!upstream.body) {
        response.end();
        cleanupAbortHandlers();
        if (!failureRecorded) this.observe({
          at: new Date().toISOString(),
          requestId,
          providerId: provider.id,
          scopeId,
          proxyMode,
          endpoint,
          elapsedMs: Date.now() - started,
          status: upstream.status,
          statusText: upstream.statusText,
          traceId: traceHeader(upstream.headers),
          retryAfter: upstream.headers.get("retry-after") ?? undefined,
          phase: "response",
          outcome: "completed",
          sanitizedCount: changed,
        });
        await this.options.log.log(`Provider gateway request ${requestId} completed status=${upstream.status} elapsedMs=${Date.now() - started}`);
        return;
      }
      const responseSource = Readable.fromWeb(upstream.body as never);
      const responseLimit = this.options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
      if (translation?.translated) {
        const contentType = upstream.headers.get("content-type") ?? "";
        const upstreamSse = /text\/event-stream/i.test(contentType);
        if (upstreamSse && upstream.status < 400) {
          response.setHeader("content-type", "text/event-stream; charset=utf-8");
          response.setHeader("cache-control", "no-cache");
          response.flushHeaders();
          const bridge = new ProviderSseIncrementalBridge(
            translation.clientProtocol,
            translation.upstreamProtocol,
            Math.min(responseLimit, 8 * 1024 * 1024),
          );
          const streamResult = await pipeTranslatedSseResponse(responseSource, response, responseLimit, bridge);
          cleanupAbortHandlers();
          if (streamResult.malformedEvents) {
            await this.options.log.log(`Provider gateway ignored ${streamResult.malformedEvents} malformed SSE event(s) before a valid terminal for ${requestId}`);
          }
          if (streamResult.outcome === "failed") {
            this.recordFailure({
              at: new Date().toISOString(), requestId, providerId: provider.id, scopeId, proxyMode, endpoint,
              elapsedMs: Date.now() - started, status: upstream.status, statusText: upstream.statusText,
              traceId: traceHeader(upstream.headers), retryAfter: upstream.headers.get("retry-after") ?? undefined,
              phase: "response", reason: "upstream-stream", sanitizedCount: changed,
              message: "提供商 SSE 返回错误终态",
            });
            failureRecorded = true;
            await this.options.log.log(`Provider gateway request ${requestId} translated an upstream SSE error terminal elapsedMs=${Date.now() - started}`);
            return;
          }
          if (!failureRecorded) this.observe({
            at: new Date().toISOString(), requestId, providerId: provider.id, scopeId, proxyMode, endpoint,
            elapsedMs: Date.now() - started, status: upstream.status, statusText: upstream.statusText,
            traceId: traceHeader(upstream.headers), retryAfter: upstream.headers.get("retry-after") ?? undefined,
            phase: "response", outcome: "completed", sanitizedCount: changed,
          });
          await this.options.log.log(`Provider gateway request ${requestId} incrementally translated ${translation.upstreamProtocol}->${translation.clientProtocol} status=${upstream.status} elapsedMs=${Date.now() - started}`);
          return;
        }
        const collected = await collectLimitedResponse(responseSource, responseLimit);
        const translated = translateProviderResponse({
            clientProtocol: translation.clientProtocol,
            upstreamProtocol: translation.upstreamProtocol,
            body: collected,
            status: upstream.status,
            contentType,
          });
        if (!upstreamSse) {
          response.setHeader("content-type", translated.contentType);
          response.setHeader("content-length", translated.body.byteLength);
        }
        await writeResponse(response, Buffer.from(translated.body));
        response.end();
        cleanupAbortHandlers();
        if (!failureRecorded) this.observe({
          at: new Date().toISOString(),
          requestId,
          providerId: provider.id,
          scopeId,
          proxyMode,
          endpoint,
          elapsedMs: Date.now() - started,
          status: upstream.status,
          statusText: upstream.statusText,
          traceId: traceHeader(upstream.headers),
          retryAfter: upstream.headers.get("retry-after") ?? undefined,
          phase: "response",
          outcome: "completed",
          sanitizedCount: changed,
        });
        await this.options.log.log(`Provider gateway request ${requestId} translated ${translation.upstreamProtocol}->${translation.clientProtocol} status=${upstream.status} elapsedMs=${Date.now() - started}`);
        return;
      }
      const anthropicCompatibility = upstream.status < 400
        && endpoint === "messages"
        && (provider.upstreamProtocol === "anthropic_messages" || provider.protocol === "messages");
      const responseChanged = anthropicCompatibility
        ? await pipeAnthropicMessageResponse(
          responseSource,
          response,
          responseLimit,
          upstream.headers.get("content-type") ?? "",
        )
        : await pipeLimitedResponse(responseSource, response, responseLimit);
      if (responseChanged) {
        await this.options.log.log(
          `Provider gateway adapted ${responseChanged} unsigned Anthropic thinking event(s) for ${provider.id}`,
        );
      }
      cleanupAbortHandlers();
      if (!failureRecorded) this.observe({
        at: new Date().toISOString(),
        requestId,
        providerId: provider.id,
        scopeId,
        proxyMode,
        endpoint,
        elapsedMs: Date.now() - started,
        status: upstream.status,
        statusText: upstream.statusText,
        traceId: traceHeader(upstream.headers),
        retryAfter: upstream.headers.get("retry-after") ?? undefined,
        phase: "response",
        outcome: "completed",
        sanitizedCount: changed,
      });
      await this.options.log.log(`Provider gateway request ${requestId} completed status=${upstream.status} elapsedMs=${Date.now() - started}`);
    } catch (error) {
      cleanupAbortHandlers();
      const phase: GatewayFailureRecord["phase"] = response.headersSent ? "response" : upstream ? "upstream" : "pre-send";
      const reason = abortReason ?? (phase === "response" ? "upstream-stream" : fetchStarted ? "upstream-connect" : "request-validation");
      const elapsedMs = Date.now() - started;
      if (reason === "downstream-request-aborted" || reason === "downstream-response-closed") {
        this.observe({
          requestId,
          at: new Date().toISOString(),
          providerId: failingProviderId,
          scopeId: failingScopeId,
          proxyMode,
          endpoint,
          elapsedMs,
          status: upstream?.status,
          statusText: upstream?.statusText,
          traceId: upstream ? traceHeader(upstream.headers) : undefined,
          retryAfter: upstream?.headers.get("retry-after") ?? undefined,
          phase,
          reason,
          outcome: "downstream-closed",
          sanitizedCount: changed,
        });
        await this.options.log.log(`Provider gateway request ${requestId} closed by downstream phase=${phase} reason=${reason} route=${proxyMode} elapsedMs=${elapsedMs}`);
        if (!response.destroyed) response.destroy();
        return;
      }
      if (response.headersSent) {
        const redacted = redactGatewayError(error instanceof Error ? error.message : String(error));
        if (!failureRecorded) this.recordFailure({
          requestId,
          at: new Date().toISOString(),
          providerId: failingProviderId,
          scopeId: failingScopeId,
          proxyMode,
          endpoint,
          elapsedMs,
          phase,
          reason,
          sanitizedCount: changed,
          message: redacted,
        });
        await this.options.log.log(`Provider gateway request ${requestId} failed phase=${phase} reason=${reason} route=${proxyMode} elapsedMs=${elapsedMs}: ${redacted}`);
        response.destroy();
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      const redacted = redactGatewayError(message);
      if (!failureRecorded) this.recordFailure({
        requestId,
        at: new Date().toISOString(),
        providerId: failingProviderId,
        scopeId: failingScopeId,
        proxyMode,
        endpoint,
        elapsedMs,
        phase,
        reason,
        sanitizedCount: changed,
        message: redacted,
      });
      await this.options.log.log(`Provider gateway request ${requestId} failed phase=${phase} reason=${reason} route=${proxyMode} elapsedMs=${elapsedMs}: ${redacted}`);
      jsonError(response, /凭据/.test(message) ? 401 : /过大|too large/i.test(message) ? 413 : /JSON/i.test(message) ? 400 : 502, publicGatewayError(message));
    }
  }

  /**
   * The loopback request is made by Grok CLI, whose Authorization header may
   * contain the signed-in xAI session token after auth recovery. Never forward
   * that token to a managed custom provider. The gateway is the credential
   * boundary and injects only the environment values owned by that provider.
   */
  private async forwardProviderHeaders(headers: IncomingHttpHeaders, provider: CustomProviderProfile): Promise<Record<string, string>> {
    const output = forwardHeaders(headers);
    delete output.authorization;
    delete output["x-api-key"];

    for (const [headerName, environmentName] of Object.entries(provider.extraHeaders ?? {})) {
      const normalized = headerName.trim().toLowerCase();
      if (!normalized) continue;
      delete output[normalized];
      const value = await this.options.environment?.(environmentName);
      if (value) output[normalized] = value;
    }

    if (provider.credentialMode === "none") return output;
    if (!provider.credentialEnv) throw new Error("提供商凭据不可用");
    const credential = await this.options.environment?.(provider.credentialEnv);
    if (!credential) throw new Error("提供商凭据不可用");
    if (provider.authScheme === "x_api_key") output["x-api-key"] = credential;
    else output.authorization = `Bearer ${credential}`;
    return output;
  }
}

export function sanitizeProviderSchema(value: unknown, profile: ProviderSchemaProfile): ProviderSchemaSanitizeResult {
  const paths: string[] = [];
  const strict = profile === "gemini" || profile === "strict";
  // `standard` is a declared pass-through: rewriting bodies for providers that
  // never asked for it would silently drop legitimate empty-string enum members.
  if (!strict) return { value, changed: 0, paths };
  const visit = (input: unknown, path: string): unknown => {
    if (Array.isArray(input)) return input.map((item, index) => visit(item, `${path}[${index}]`));
    if (!input || typeof input !== "object") return input;
    const output: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      if (["$schema", "$id", "unevaluatedProperties", "patternProperties", "examples"].includes(key)) {
        paths.push(childPath);
        continue;
      }
      if (key === "default" && raw === null) {
        paths.push(childPath);
        continue;
      }
      if (key === "enum" && Array.isArray(raw)) {
        const filtered = raw.filter((item) => item !== null && item !== "");
        if (filtered.length !== raw.length) paths.push(childPath);
        if (filtered.length) output[key] = filtered.map((item, index) => visit(item, `${childPath}[${index}]`));
        continue;
      }
      if (key === "type" && Array.isArray(raw)) {
        const filtered = raw.filter((item) => item !== null && item !== "" && item !== "null");
        if (filtered.length !== raw.length) paths.push(childPath);
        if (filtered.length === 1) output[key] = filtered[0];
        else if (filtered.length) output[key] = filtered;
        continue;
      }
      output[key] = visit(raw, childPath);
    }
    return output;
  };
  const sanitized = visit(value, "");
  return { value: sanitized, changed: paths.length, paths: paths.slice(0, 100) };
}

/** First allowed trace-style header the upstream returned, if any. */
function traceHeader(headers: Headers): string | undefined {
  for (const name of ["x-request-id", "x-trace-id", "x-cloudaicompanion-trace-id", "x-cloud-trace-context"]) {
    const value = headers.get(name);
    if (value) return value;
  }
  return undefined;
}

function forwardHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const blocked = new Set(["host", "content-length", "connection", "transfer-encoding", "keep-alive", "upgrade"]);
  const output: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (blocked.has(name.toLowerCase()) || value === undefined) continue;
    output[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  output["accept-encoding"] = "identity";
  return output;
}

async function readRequest(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > limit) throw new Error("提供商请求过大");
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function pipeLimitedResponse(source: Readable, response: ServerResponse, limit: number): Promise<number> {
  let size = 0;
  for await (const raw of source) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    size += chunk.length;
    if (size > limit) throw new Error("提供商响应过大");
    await writeResponse(response, chunk);
  }
  response.end();
  return 0;
}

async function pipeTranslatedSseResponse(
  source: Readable,
  response: ServerResponse,
  limit: number,
  bridge: ProviderSseIncrementalBridge,
): Promise<{ malformedEvents: number; outcome: "completed" | "failed" }> {
  let size = 0;
  for await (const raw of source) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    size += chunk.length;
    if (size > limit) throw new Error("提供商响应过大");
    for (const output of bridge.push(chunk)) await writeResponse(response, Buffer.from(output));
    if (bridge.outcome) {
      source.destroy();
      break;
    }
  }
  if (!bridge.outcome) for (const output of bridge.push(new Uint8Array(), true)) await writeResponse(response, Buffer.from(output));
  if (!bridge.outcome) {
    throw new Error(`提供商 SSE 在有效终态前结束${bridge.malformedEvents ? `（忽略了 ${bridge.malformedEvents} 个畸形事件）` : ""}`);
  }
  response.end();
  return { malformedEvents: bridge.malformedEvents, outcome: bridge.outcome };
}

/**
 * Some OpenAI-compatible/local routers expose an Anthropic Messages endpoint
 * but stream `thinking` blocks without the required `signature` field. Grok
 * CLI strictly deserializes Anthropic events and closes the response as soon
 * as it sees that malformed block.
 *
 * Do not forge a signature. For only the malformed block, carry thinking
 * through an internal marker-delimited text block. The ACP adapter restores it
 * to the semantic thought channel before it reaches the renderer. Valid signed
 * Anthropic streams remain byte-for-byte pass-through.
 */
async function pipeAnthropicMessageResponse(
  source: Readable,
  response: ServerResponse,
  limit: number,
  contentType: string,
): Promise<number> {
  if (/text\/event-stream/i.test(contentType)) {
    return pipeAnthropicSseResponse(source, response, limit);
  }
  if (!/application\/json/i.test(contentType)) return pipeLimitedResponse(source, response, limit);

  const body = await collectLimitedResponse(source, limit);
  let output = body;
  let changed = 0;
  try {
    const adapted = adaptAnthropicMessageJson(JSON.parse(body.toString("utf8")));
    changed = adapted.changed;
    if (changed) output = Buffer.from(JSON.stringify(adapted.value));
  } catch {
    // A provider may label a non-JSON error/body as JSON. Preserve it exactly;
    // the gateway must not replace the upstream's observable response.
  }
  await writeResponse(response, output);
  response.end();
  return changed;
}

async function pipeAnthropicSseResponse(source: Readable, response: ServerResponse, limit: number): Promise<number> {
  const decoder = new TextDecoder();
  const downgradedIndexes = new Set<string>();
  let pending = "";
  let inputSize = 0;
  let changed = 0;

  const flushCompleteRecords = async (): Promise<void> => {
    for (;;) {
      const boundary = /\r?\n\r?\n/.exec(pending);
      if (!boundary || boundary.index === undefined) return;
      const record = pending.slice(0, boundary.index);
      const separator = boundary[0];
      pending = pending.slice(boundary.index + separator.length);
      const adapted = adaptAnthropicSseRecord(record, downgradedIndexes);
      changed += adapted.changed;
      if (adapted.value !== undefined) await writeResponse(response, Buffer.from(adapted.value + separator));
    }
  };

  for await (const raw of source) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    inputSize += chunk.length;
    if (inputSize > limit) throw new Error("提供商响应过大");
    pending += decoder.decode(chunk, { stream: true });
    await flushCompleteRecords();
  }
  pending += decoder.decode();
  await flushCompleteRecords();
  if (pending) {
    const adapted = adaptAnthropicSseRecord(pending, downgradedIndexes);
    changed += adapted.changed;
    if (adapted.value !== undefined) await writeResponse(response, Buffer.from(adapted.value));
  }
  response.end();
  return changed;
}

function adaptAnthropicSseRecord(
  record: string,
  downgradedIndexes: Set<string>,
): { value?: string; changed: number } {
  const newline = record.includes("\r\n") ? "\r\n" : "\n";
  const lines = record.split(/\r?\n/);
  const dataIndexes: number[] = [];
  const dataParts: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^data:(?: ?)(.*)$/.exec(lines[index]!);
    if (!match) continue;
    dataIndexes.push(index);
    dataParts.push(match[1] ?? "");
  }
  if (!dataIndexes.length) return { value: record, changed: 0 };

  let payload: unknown;
  try {
    payload = JSON.parse(dataParts.join("\n"));
  } catch {
    return { value: record, changed: 0 };
  }
  if (!payload || typeof payload !== "object") return { value: record, changed: 0 };
  const event = payload as Record<string, unknown>;
  const indexKey = String(event.index ?? "");

  if (event.type === "content_block_start" && isUnsignedThinkingBlock(event.content_block)) {
    downgradedIndexes.add(indexKey);
    event.content_block = { type: "text", text: PROVIDER_THINKING_START };
    return { value: replaceSseData(lines, dataIndexes, event, newline), changed: 1 };
  }

  if (event.type === "content_block_delta" && downgradedIndexes.has(indexKey)) {
    const delta = event.delta;
    if (delta && typeof delta === "object") {
      const typedDelta = delta as Record<string, unknown>;
      if (typedDelta.type === "thinking_delta") {
        event.delta = { type: "text_delta", text: String(typedDelta.thinking ?? "") };
        return { value: replaceSseData(lines, dataIndexes, event, newline), changed: 1 };
      }
      if (typedDelta.type === "signature_delta") {
        // The block is now ordinary text; forwarding a signature delta would
        // make the downstream event invalid.
        return { changed: 1 };
      }
    }
  }

  if (event.type === "content_block_stop" && downgradedIndexes.delete(indexKey)) {
    const closing = {
      type: "content_block_delta",
      index: event.index,
      delta: { type: "text_delta", text: PROVIDER_THINKING_END },
    };
    const stop = replaceSseData(lines, dataIndexes, event, newline);
    const eventName = lines.findIndex((line) => /^event:/.test(line));
    const closingLines = lines.slice();
    if (eventName >= 0) closingLines[eventName] = "event: content_block_delta";
    const closingRecord = replaceSseData(closingLines, dataIndexes, closing, newline);
    return { value: `${closingRecord}${newline}${newline}${stop}`, changed: 1 };
  }

  return { value: record, changed: 0 };
}

function adaptAnthropicMessageJson(value: unknown): { value: unknown; changed: number } {
  if (!value || typeof value !== "object") return { value, changed: 0 };
  const message = value as Record<string, unknown>;
  if (!Array.isArray(message.content)) return { value, changed: 0 };
  let changed = 0;
  const content = message.content.map((block) => {
    if (!isUnsignedThinkingBlock(block)) return block;
    changed += 1;
    const thinking = String((block as Record<string, unknown>).thinking ?? "");
    return { type: "text", text: `${PROVIDER_THINKING_START}${thinking}${PROVIDER_THINKING_END}` };
  });
  return changed ? { value: { ...message, content }, changed } : { value, changed: 0 };
}

function isUnsignedThinkingBlock(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const block = value as Record<string, unknown>;
  return block.type === "thinking" && typeof block.signature !== "string";
}

function replaceSseData(
  lines: string[],
  dataIndexes: number[],
  payload: Record<string, unknown>,
  newline: string,
): string {
  const output = lines.slice();
  output[dataIndexes[0]!] = `data: ${JSON.stringify(payload)}`;
  for (let index = dataIndexes.length - 1; index >= 1; index -= 1) output.splice(dataIndexes[index]!, 1);
  return output.join(newline);
}

async function collectLimitedResponse(source: Readable, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const raw of source) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    size += chunk.length;
    if (size > limit) throw new Error("提供商响应过大");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function writeResponse(response: ServerResponse, chunk: Buffer): Promise<void> {
  if (!response.write(chunk)) await waitForDrain(response);
}

function waitForDrain(response: ServerResponse): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      response.off("drain", drained);
      response.off("close", closed);
      response.off("error", failed);
    };
    const drained = (): void => { cleanup(); resolve(); };
    const closed = (): void => { cleanup(); reject(new Error("提供商请求已取消")); };
    const failed = (error: Error): void => { cleanup(); reject(error); };
    response.once("drain", drained);
    response.once("close", closed);
    response.once("error", failed);
  });
}

function joinUrl(baseUrl: string, suffix: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const path = suffix ? `/${suffix.replace(/^\/+/, "")}` : "";
  return `${base}${path}`;
}

function gatewayEndpoint(suffix: string): GatewayFailureRecord["endpoint"] {
  const path = suffix.toLowerCase();
  if (/(^|\/)responses(?:\/|$)/.test(path)) return "responses";
  if (/(^|\/)chat\/completions(?:\/|$)/.test(path)) return "chat-completions";
  if (/(^|\/)messages(?:\/|$)/.test(path)) return "messages";
  return "other";
}

function jsonError(response: ServerResponse, status: number, message: string): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify({ error: { message, phase: "provider-gateway" } }));
}

function redactGatewayError(value: string): string {
  return value.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").replace(/([?&](?:key|token|api_key)=)[^&\s]+/gi, "$1[REDACTED]").slice(0, 600);
}

/** Never expose arbitrary exception text or stack/file details to the loopback caller. */
function publicGatewayError(value: string): string {
  if (/凭据/.test(value)) return "提供商凭据不可用";
  if (/请求过大|request too large/i.test(value)) return "提供商请求过大";
  if (/响应过大|response too large/i.test(value)) return "提供商响应过大";
  if (/JSON/i.test(value)) return "提供商请求不是有效 JSON";
  if (/超时|timed?\s*out|timeout/i.test(value)) return "提供商请求超时";
  if (/取消|cancel|abort/i.test(value)) return "提供商请求已取消";
  return "提供商网关请求失败";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
