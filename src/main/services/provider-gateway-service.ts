import { randomBytes } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { CustomProviderProfile, ProviderSchemaProfile } from "../../shared/types";
import type { LogService } from "./log-service";

const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10 * 60_000;
const RESPONSE_HEADERS = new Set([
  "content-type", "date", "retry-after", "server-timing", "x-request-id",
  "x-trace-id", "x-cloud-trace-context", "x-cloudaicompanion-trace-id",
  "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset",
]);

/** What the gateway saw for one failed upstream call. Kept in memory only. */
export interface GatewayFailureRecord {
  at: string;
  providerId: string;
  status?: number;
  statusText?: string;
  traceId?: string;
  retryAfter?: string;
  phase: "pre-send" | "upstream" | "response";
  sanitizedCount: number;
  message: string;
}

export interface ProviderSchemaSanitizeResult {
  value: unknown;
  changed: number;
  paths: string[];
}

export interface ProviderGatewayOptions {
  providers(): Promise<CustomProviderProfile[]>;
  fetcher: typeof fetch;
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
  private readonly token = randomBytes(24).toString("base64url");

  constructor(private readonly options: ProviderGatewayOptions) {}

  /** Most recent failures first, optionally narrowed to one provider. */
  recentFailures(providerId?: string): GatewayFailureRecord[] {
    return this.failures.filter((value) => !providerId || value.providerId === providerId).slice().reverse();
  }

  private record(entry: GatewayFailureRecord): void {
    this.failures.push(entry);
    while (this.failures.length > 20) this.failures.shift();
  }

  async route(providerId: string): Promise<string> {
    await this.start();
    return `http://127.0.0.1:${this.port}/${this.token}/${encodeURIComponent(providerId)}`;
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
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let failingProviderId = "unknown";
    try {
      if (request.method !== "POST") return jsonError(response, 405, "只允许推理 POST 请求");
      const match = new RegExp(`^/${escapeRegex(this.token)}/([^/]+)(/.*)?$`).exec(request.url ?? "");
      if (!match) return jsonError(response, 404, "提供商路由不存在");
      const providerId = decodeURIComponent(match[1]!);
      failingProviderId = providerId;
      const provider = (await this.options.providers()).find((value) => value.owned && value.id === providerId);
      if (!provider) return jsonError(response, 404, "提供商不存在");
      const raw = await readRequest(request, this.options.maxRequestBytes ?? MAX_REQUEST_BYTES);
      let body = raw;
      let changed = 0;
      if (/application\/json/i.test(String(request.headers["content-type"] ?? "")) && raw.length) {
        const parsed = JSON.parse(raw.toString("utf8"));
        const sanitized = sanitizeProviderSchema(parsed, provider.schemaProfile ?? "standard");
        body = Buffer.from(JSON.stringify(sanitized.value));
        changed = sanitized.changed;
      }
      const upstreamUrl = joinUrl(provider.baseUrl, match[2] || "");
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(new Error("提供商请求超时")), this.options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS);
      request.once("aborted", () => abort.abort());
      response.once("close", () => { if (!response.writableEnded) abort.abort(); });
      let upstream: Response;
      try {
        upstream = await this.options.fetcher(upstreamUrl, {
          method: "POST",
          headers: forwardHeaders(request.headers),
          // Forwarded as bytes: re-encoding through a UTF-8 string would
          // corrupt binary and multipart payloads.
          body: new Uint8Array(body),
          redirect: "manual",
          signal: abort.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (changed) await this.options.log.log(`Provider gateway sanitized ${changed} schema value(s) for ${provider.id}`);
      const declaredLength = Number(upstream.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > (this.options.maxResponseBytes ?? MAX_RESPONSE_BYTES)) {
        throw new Error("提供商响应过大");
      }
      if (upstream.status >= 400) {
        this.record({
          at: new Date().toISOString(),
          providerId: provider.id,
          status: upstream.status,
          statusText: upstream.statusText,
          traceId: traceHeader(upstream.headers),
          retryAfter: upstream.headers.get("retry-after") ?? undefined,
          phase: "upstream",
          sanitizedCount: changed,
          message: `${upstream.status} ${upstream.statusText}`.trim(),
        });
      }
      response.statusCode = upstream.status;
      response.statusMessage = upstream.statusText;
      for (const [name, value] of upstream.headers) if (RESPONSE_HEADERS.has(name.toLowerCase())) response.setHeader(name, value);
      if (!upstream.body) {
        response.end();
        return;
      }
      await pipeLimitedResponse(Readable.fromWeb(upstream.body as never), response, this.options.maxResponseBytes ?? MAX_RESPONSE_BYTES);
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.record({ at: new Date().toISOString(), providerId: failingProviderId, phase: "pre-send", sanitizedCount: 0, message: redactGatewayError(message) });
      await this.options.log.log(`Provider gateway request failed: ${redactGatewayError(message)}`);
      jsonError(response, /过大|too large/i.test(message) ? 413 : /JSON/i.test(message) ? 400 : 502, message);
    }
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

async function pipeLimitedResponse(source: Readable, response: ServerResponse, limit: number): Promise<void> {
  let size = 0;
  for await (const raw of source) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    size += chunk.length;
    if (size > limit) throw new Error("提供商响应过大");
    if (!response.write(chunk)) await waitForDrain(response);
  }
  response.end();
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

function jsonError(response: ServerResponse, status: number, message: string): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify({ error: { message, phase: "provider-gateway" } }));
}

function redactGatewayError(value: string): string {
  return value.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").replace(/([?&](?:key|token|api_key)=)[^&\s]+/gi, "$1[REDACTED]").slice(0, 600);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
