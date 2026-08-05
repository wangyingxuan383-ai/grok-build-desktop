import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { readdir, realpath, rm, stat } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { isAbsolute, join, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;
const DEFAULT_MAX_REMOTE_REDIRECTS = 4;

export interface RemoteMediaResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type RemoteMediaDnsResolver = (hostname: string) => Promise<readonly RemoteMediaResolvedAddress[]>;

export interface PinnedRemoteMediaRequest {
  url: URL;
  addresses: readonly RemoteMediaResolvedAddress[];
  signal?: AbortSignal;
}

export type PinnedRemoteMediaFetcher = (input: PinnedRemoteMediaRequest) => Promise<Response>;

export interface RemoteMediaFetchOptions {
  /** Exact HTTP(S) origins which may host this media asset. */
  allowedOrigins?: readonly string[];
  signal?: AbortSignal;
  maxRedirects?: number;
  resolver?: RemoteMediaDnsResolver;
  /** Test seam. Production callers should use the pinned native requester. */
  fetcher?: PinnedRemoteMediaFetcher;
}

export interface NormalizeAcpMediaOptions {
  /** Remote ACP artifacts are denied unless their exact origin is listed. */
  allowedOrigins?: readonly string[];
}

const nonPublicIpv4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) nonPublicIpv4.addSubnet(address, prefix, "ipv4");

const nonPublicIpv6 = new BlockList();
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) nonPublicIpv6.addSubnet(address, prefix, "ipv6");
const publicIpv6 = new BlockList();
publicIpv6.addSubnet("2000::", 3, "ipv6");

export interface MediaCacheSweepResult {
  removedOrphanDirectories: number;
  removedFiles: number;
  bytesBefore: number;
  bytesAfter: number;
}

/**
 * Removes media directories whose Grok session no longer exists, then applies
 * a global oldest-first capacity bound. Directory names are hashes, so neither
 * session IDs nor media paths enter diagnostics.
 */
export async function sweepSessionMediaCache(
  root: string,
  sessionIds: ReadonlySet<string>,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<MediaCacheSweepResult> {
  const valid = new Set([...sessionIds].map(sessionCacheKey));
  const directories = await readdir(root, { withFileTypes: true }).catch(() => []);
  let removedOrphanDirectories = 0;
  let removedFiles = 0;
  let bytesBefore = 0;
  const files: Array<{ path: string; size: number; mtimeMs: number }> = [];

  for (const directory of directories) {
    const path = join(root, directory.name);
    if (!directory.isDirectory() || !valid.has(directory.name)) {
      await rm(path, { recursive: true, force: true });
      removedOrphanDirectories += 1;
      continue;
    }
    const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const filePath = join(path, entry.name);
      if (!entry.isFile()) {
        await rm(filePath, { recursive: true, force: true });
        continue;
      }
      const info = await stat(filePath).catch(() => undefined);
      if (!info?.isFile()) continue;
      bytesBefore += info.size;
      files.push({ path: filePath, size: info.size, mtimeMs: info.mtimeMs });
    }
  }

  let bytesAfter = bytesBefore;
  if (bytesAfter > maxBytes) {
    files.sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path));
    for (const file of files) {
      if (bytesAfter <= maxBytes) break;
      await rm(file.path, { force: true });
      bytesAfter -= file.size;
      removedFiles += 1;
    }
  }

  return { removedOrphanDirectories, removedFiles, bytesBefore, bytesAfter };
}

export function sessionCacheKey(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
}

/**
 * Normalize one ACP media reference without broadening the trust boundary.
 * Relative paths are owned by the session cwd, file URLs are decoded with the
 * platform URL implementation, and every other URI scheme is rejected. HTTP
 * URLs remain URLs so the caller can download them under its response limits.
 */
export function normalizeAcpMediaArtifactSource(
  source: string,
  cwd: string,
  options: NormalizeAcpMediaOptions = {},
): string {
  const value = source.trim();
  if (!value) throw new Error("媒体工具没有返回产物位置");
  if (/^https?:\/\//i.test(value)) return assertAllowedRemoteMediaUrl(value, options.allowedOrigins).href;
  if (/^file:/i.test(value)) {
    try { return fileURLToPath(value); }
    catch { throw new Error("媒体工具返回了无效的 file URL"); }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) {
    throw new Error("媒体工具返回了不受支持的 URI 协议");
  }
  if (isAbsolute(value)) return value;
  if (!cwd) throw new Error("无法确定媒体产物所属的会话工作区");
  return resolve(cwd, value);
}

/**
 * Download an explicitly trusted remote media URL without giving DNS a second
 * opportunity to change the destination between validation and connect.
 *
 * Every DNS answer must be globally routable. The native requester connects
 * through a pinned `lookup` callback while retaining the original Host header
 * and TLS SNI. Redirects are manual, same-origin only, and independently
 * resolved/validated before the next connection.
 */
export async function fetchTrustedRemoteMediaArtifact(
  source: string,
  options: RemoteMediaFetchOptions,
): Promise<Response> {
  const initial = assertAllowedRemoteMediaUrl(source, options.allowedOrigins);
  const resolver = options.resolver ?? systemRemoteMediaResolver;
  const fetcher = options.fetcher ?? pinnedNativeRemoteMediaFetch;
  const maxRedirects = normalizeRedirectLimit(options.maxRedirects);
  let current = initial;

  for (let redirectCount = 0; ; redirectCount += 1) {
    const addresses = await resolvePublicRemoteMediaAddresses(current, resolver);
    const response = await fetcher({ url: current, addresses, signal: options.signal });
    const location = redirectLocation(response);
    if (!location) return response;

    await response.body?.cancel().catch(() => undefined);
    if (redirectCount >= maxRedirects) throw new Error("媒体产物 URL 重定向次数过多");
    const next = assertAllowedRemoteMediaUrl(new URL(location, current).href, options.allowedOrigins);
    if (next.origin !== initial.origin) throw new Error("媒体产物 URL 不允许跨源重定向");
    current = next;
  }
}

/** Exact-origin validation performed before any DNS lookup or HTTP request. */
export function assertAllowedRemoteMediaUrl(source: string, allowedOrigins: readonly string[] | undefined): URL {
  let target: URL;
  try { target = new URL(source); }
  catch { throw new Error("媒体工具返回了无效的远程 URL"); }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    throw new Error("远程媒体产物只支持 HTTP 或 HTTPS");
  }
  if (target.username || target.password) throw new Error("远程媒体产物 URL 不能包含凭据");
  const origins = new Set((allowedOrigins ?? []).map(normalizeAllowedRemoteMediaOrigin));
  if (!origins.size) throw new Error("远程媒体产物未配置允许的来源");
  if (!origins.has(target.origin)) throw new Error("远程媒体产物来源不在允许列表中");
  return target;
}

/** Resolve and reject the whole host if even one answer is not public. */
export async function resolvePublicRemoteMediaAddresses(
  target: URL,
  resolver: RemoteMediaDnsResolver = systemRemoteMediaResolver,
): Promise<readonly RemoteMediaResolvedAddress[]> {
  const hostname = stripIpv6Brackets(target.hostname);
  const literalFamily = isIP(hostname);
  const answers = literalFamily
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : await resolver(hostname).catch(() => {
      throw new Error("无法验证远程媒体产物主机的 DNS 地址");
    });
  if (!answers.length) throw new Error("远程媒体产物主机没有可用的 DNS 地址");

  const unique = new Map<string, RemoteMediaResolvedAddress>();
  for (const answer of answers) {
    const family = isIP(answer.address);
    if ((family !== 4 && family !== 6) || family !== answer.family) {
      throw new Error("远程媒体产物主机返回了无效的 DNS 地址");
    }
    if (!isPublicInternetAddress(answer.address, family)) {
      throw new Error("远程媒体产物主机解析到了非公网地址");
    }
    unique.set(`${family}:${answer.address}`, { address: answer.address, family });
  }
  return [...unique.values()];
}

export function isPublicInternetAddress(address: string, family = isIP(address)): boolean {
  if (family === 4) return !nonPublicIpv4.check(address, "ipv4");
  if (family !== 6) return false;
  // Global-unicast IPv6 is 2000::/3. Block the special-purpose allocations
  // inside it as well (documentation, benchmarking, ORCHID and Teredo).
  return publicIpv6.check(address, "ipv6") && !nonPublicIpv6.check(address, "ipv6");
}

async function systemRemoteMediaResolver(hostname: string): Promise<readonly RemoteMediaResolvedAddress[]> {
  const answers = await dnsLookup(hostname, { all: true, verbatim: true });
  return answers.map((answer) => ({ address: answer.address, family: answer.family as 4 | 6 }));
}

function normalizeAllowedRemoteMediaOrigin(value: string): string {
  let origin: URL;
  try { origin = new URL(value); }
  catch { throw new Error("远程媒体产物允许来源无效"); }
  if (origin.protocol !== "https:" && origin.protocol !== "http:") {
    throw new Error("远程媒体产物允许来源只支持 HTTP 或 HTTPS");
  }
  if (origin.username || origin.password) throw new Error("远程媒体产物允许来源不能包含凭据");
  return origin.origin;
}

function normalizeRedirectLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_REMOTE_REDIRECTS;
  if (!Number.isSafeInteger(value) || value < 0 || value > 10) throw new Error("媒体产物重定向上限无效");
  return value;
}

function redirectLocation(response: Response): string | undefined {
  if (![301, 302, 303, 307, 308].includes(response.status)) return undefined;
  const location = response.headers.get("location")?.trim();
  if (!location) throw new Error("媒体产物 URL 返回了无目标重定向");
  return location;
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

async function pinnedNativeRemoteMediaFetch(input: PinnedRemoteMediaRequest): Promise<Response> {
  const request = input.url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise<Response>((resolveResponse, rejectResponse) => {
    const operation = request(input.url, {
      method: "GET",
      headers: { Accept: "image/*, video/*;q=0.9, application/octet-stream;q=0.1" },
      signal: input.signal,
      lookup: (_hostname, options, callback) => {
        const all = typeof options === "object" && options.all === true;
        if (all) {
          callback(null, input.addresses.map((answer) => ({ ...answer })));
          return;
        }
        const family = typeof options === "number" ? options : typeof options === "object" ? options.family : 0;
        const selected = input.addresses.find((answer) => !family || answer.family === family) ?? input.addresses[0];
        if (!selected) {
          callback(new Error("没有可用的已验证媒体地址"), "");
          return;
        }
        callback(null, selected.address, selected.family);
      },
    }, (response) => {
      const headers = new Headers();
      for (let index = 0; index < response.rawHeaders.length; index += 2) {
        const name = response.rawHeaders[index];
        const value = response.rawHeaders[index + 1];
        if (name && value !== undefined) headers.append(name, value);
      }
      const hasBody = response.statusCode !== 204 && response.statusCode !== 205 && response.statusCode !== 304;
      const body = hasBody ? Readable.toWeb(response) as ReadableStream<Uint8Array> : null;
      try {
        resolveResponse(new Response(body, {
          status: response.statusCode ?? 500,
          statusText: response.statusMessage,
          headers,
        }));
      } catch (error) {
        response.destroy();
        rejectResponse(error);
      }
    });
    operation.once("error", rejectResponse);
  });
}

/**
 * Resolve a CLI-produced artifact only when it belongs to one of the exact
 * roots owned by the current media job. A headless Grok invocation writes to
 * its transient ~/.grok session, not the workspace cwd, so callers must pass
 * that one transient session directory explicitly rather than broadening the
 * policy to all files under the user profile.
 */
export async function resolveTrustedMediaArtifactSource(
  source: string,
  trustedRoots: readonly string[],
): Promise<string | undefined> {
  const canonicalSource = await realpath(source).catch(() => undefined);
  if (!canonicalSource) return undefined;
  for (const root of trustedRoots) {
    const canonicalRoot = await realpath(root).catch(() => undefined);
    if (!canonicalRoot) continue;
    const child = relative(canonicalRoot, canonicalSource);
    if (child === "" || (!child.startsWith("..") && child !== ".." && !/^([A-Za-z]:)?[\\/]/.test(child))) return canonicalSource;
  }
  return undefined;
}
