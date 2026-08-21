import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sessionCacheKey } from "./media-cache-service";

export interface MediaThumbnailEncoderInput {
  sourcePath: string;
  maxEdge: number;
  quality: number;
}

export interface MediaThumbnailResult {
  path: string;
  mimeType: "image/jpeg";
  size: number;
}

export type MediaThumbnailEncoder = (input: MediaThumbnailEncoderInput) => Promise<Uint8Array> | Uint8Array;

const DEFAULT_MAX_EDGE = 512;
const DEFAULT_QUALITY = 78;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES_PER_SESSION = 1_024;
const DEFAULT_MAX_SESSION_BYTES = 256 * 1024 * 1024;

/**
 * Creates bounded, session-scoped chat thumbnails in the main process.
 *
 * The cache key includes the canonical source identity and its observed file
 * version. Renderer URLs never expose either value; they continue to use the
 * opaque MediaAccessHandle and request `variant=thumbnail` from the protocol.
 */
export class MediaThumbnailService {
  private readonly root: string;
  private readonly inflight = new Map<string, Promise<MediaThumbnailResult>>();

  constructor(userDataPath: string, private readonly encoder: MediaThumbnailEncoder, private readonly options: {
    maxEdge?: number;
    quality?: number;
    maxBytes?: number;
    maxEntriesPerSession?: number;
    maxSessionBytes?: number;
  } = {}) {
    this.root = join(userDataPath, "media-thumbnails");
  }

  async get(sessionId: string, sourcePath: string): Promise<MediaThumbnailResult> {
    if (!sessionId || sessionId.length > 512 || sessionId.includes("\0")) throw new Error("媒体会话 ID 无效");
    const canonical = await realpath(sourcePath).catch(() => undefined);
    if (!canonical) throw new Error("缩略图源文件不存在");
    const info = await stat(canonical);
    if (!info.isFile()) throw new Error("缩略图源不是文件");
    const maxEdge = this.options.maxEdge ?? DEFAULT_MAX_EDGE;
    const quality = this.options.quality ?? DEFAULT_QUALITY;
    const version = createHash("sha256")
      .update(canonical)
      .update("\0")
      .update(String(info.size))
      .update("\0")
      .update(String(info.mtimeMs))
      .update("\0")
      .update(`${maxEdge}:${quality}`)
      .digest("hex");
    const directory = join(this.root, sessionCacheKey(sessionId));
    const target = join(directory, `${version}.jpg`);
    const existing = await stat(target).catch(() => undefined);
    if (existing?.isFile() && existing.size > 0 && existing.size <= (this.options.maxBytes ?? DEFAULT_MAX_BYTES)) {
      return { path: target, mimeType: "image/jpeg", size: existing.size };
    }
    const key = `${sessionId}\0${version}`;
    const running = this.inflight.get(key);
    if (running) return running;
    const task = this.create(canonical, directory, target, maxEdge, quality).finally(() => this.inflight.delete(key));
    this.inflight.set(key, task);
    return task;
  }

  async removeSession(sessionId: string): Promise<void> {
    if (!sessionId || sessionId.length > 512 || sessionId.includes("\0")) throw new Error("媒体会话 ID 无效");
    await rm(join(this.root, sessionCacheKey(sessionId)), { recursive: true, force: true });
  }

  async sweep(sessionIds: ReadonlySet<string>): Promise<void> {
    const retained = new Set([...sessionIds].map(sessionCacheKey));
    const entries = await readdir(this.root, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries
      .filter((entry) => entry.isDirectory() && !retained.has(entry.name))
      .map((entry) => rm(join(this.root, entry.name), { recursive: true, force: true })));
  }

  private async create(sourcePath: string, directory: string, target: string, maxEdge: number, quality: number): Promise<MediaThumbnailResult> {
    const encoded = Buffer.from(await this.encoder({ sourcePath, maxEdge, quality }));
    const maxBytes = this.options.maxBytes ?? DEFAULT_MAX_BYTES;
    if (encoded.length === 0) throw new Error("缩略图编码结果为空");
    if (encoded.length > maxBytes) throw new Error("缩略图编码结果超过限制");
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, `.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, encoded, { flag: "wx" });
      await rename(temporary, target).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST" && error.code !== "EPERM") throw error;
        const current = await stat(target).catch(() => undefined);
        if (!current?.isFile() || current.size <= 0 || current.size > maxBytes) throw error;
      });
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
    const info = await stat(target);
    await this.pruneDirectory(directory, target).catch(() => undefined);
    return { path: target, mimeType: "image/jpeg", size: info.size };
  }

  private async pruneDirectory(directory: string, retainedTarget: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = (await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith(".jpg")).map(async (entry) => {
      const path = join(directory, entry.name);
      const info = await stat(path).catch(() => undefined);
      return info?.isFile() ? { path, size: info.size, mtimeMs: info.mtimeMs } : undefined;
    }))).filter((value): value is { path: string; size: number; mtimeMs: number } => Boolean(value))
      .sort((left, right) => left.path === retainedTarget ? -1 : right.path === retainedTarget ? 1 : right.mtimeMs - left.mtimeMs);
    const maxEntries = Math.max(1, this.options.maxEntriesPerSession ?? DEFAULT_MAX_ENTRIES_PER_SESSION);
    const maxSessionBytes = Math.max(this.options.maxBytes ?? DEFAULT_MAX_BYTES, this.options.maxSessionBytes ?? DEFAULT_MAX_SESSION_BYTES);
    let retainedBytes = 0;
    let retainedEntries = 0;
    for (const file of files) {
      const keep = file.path === retainedTarget || (retainedEntries < maxEntries && retainedBytes + file.size <= maxSessionBytes);
      if (keep) {
        retainedEntries += 1;
        retainedBytes += file.size;
      } else await rm(file.path, { force: true }).catch(() => undefined);
    }
  }
}
