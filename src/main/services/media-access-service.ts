import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import type { MediaAccessHandle, MediaCreationKind } from "../../shared/types";
import { JsonStore } from "./json-store";
import { sessionCacheKey } from "./media-cache-service";

interface MediaAccessRecord extends MediaAccessHandle { path: string; createdAt: string; lastAccessedAt?: string; cacheKind?: "media" | "attachment" }
interface MediaAccessState { version: 1; records: Record<string, MediaAccessRecord> }

const DEFAULT_HANDLE_TTL_MS = 13 * 31 * 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_RECORDS = 50_000;
const DEFAULT_MAX_RECORDS_PER_SESSION = 10_000;
const ACCESS_TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const MAX_SESSION_ID_LENGTH = 512;

export class MediaAccessService {
  private readonly store: JsonStore<MediaAccessState>;
  private readonly cacheRoot: string;

  constructor(userDataPath: string, private readonly options: {
    now?: () => Date;
    ttlMs?: number;
    maxRecords?: number;
    maxRecordsPerSession?: number;
  } = {}) {
    this.cacheRoot = join(userDataPath, "session-media");
    this.store = new JsonStore(join(userDataPath, "media-access.json"), { version: 1, records: {} });
  }

  async register(sessionId: string, path: string, media: MediaCreationKind, mimeType: string, name?: string): Promise<MediaAccessHandle> {
    return this.registerFromRoot(sessionId, path, media, mimeType, name, "media");
  }

  async registerAttachment(sessionId: string, path: string, mimeType: string, name?: string): Promise<MediaAccessHandle> {
    return this.registerFromRoot(sessionId, path, "image", mimeType, name, "attachment");
  }

  private async registerFromRoot(sessionId: string, path: string, media: MediaCreationKind, mimeType: string, name: string | undefined, cacheKind: "media" | "attachment"): Promise<MediaAccessHandle> {
    assertSessionId(sessionId);
    const root = cacheKind === "attachment" ? join(this.cacheRoot, "..", "session-attachments") : this.cacheRoot;
    const sessionRoot = await realpath(join(root, sessionCacheKey(sessionId))).catch(() => undefined);
    const canonical = await realpath(path).catch(() => undefined);
    if (!sessionRoot || !canonical || !inside(sessionRoot, canonical)) throw new Error("媒体文件不属于当前会话缓存");
    const info = await stat(canonical);
    if (!info.isFile()) throw new Error("媒体访问目标不是文件");
    const now = this.now().toISOString();
    let selected!: MediaAccessRecord;
    await this.store.mutate((state) => {
      const matches = Object.entries(state.records).filter(([, record]) => record.sessionId === sessionId
        && record.cacheKind === cacheKind
        && record.media === media
        && normalizeCase(record.path) === normalizeCase(canonical));
      const existingEntry = newestFirst(matches)[0];
      const existing = existingEntry?.[1];
      if (existing) {
        existing.mimeType = mimeType;
        existing.name = name || existing.name || basename(canonical);
        existing.lastAccessedAt = now;
        for (const [duplicateId] of matches) if (duplicateId !== existingEntry![0]) delete state.records[duplicateId];
        selected = structuredClone(existing);
        return;
      }
      const id = randomUUID();
      selected = {
        id,
        sessionId,
        media,
        mimeType,
        name: name || basename(canonical),
        url: `grok-media://access/${id}`,
        path: canonical,
        createdAt: now,
        lastAccessedAt: now,
        cacheKind,
      };
      state.records[id] = selected;
    });
    return publicHandle(selected);
  }

  async resolve(source: string, expectedSessionId?: string): Promise<MediaAccessRecord> {
    if (expectedSessionId !== undefined) assertSessionId(expectedSessionId);
    let id = "";
    try {
      const url = new URL(source);
      if (url.protocol !== "grok-media:" || url.hostname !== "access") throw new Error();
      id = url.pathname.replace(/^\/+/, "");
    } catch { throw new Error("媒体访问句柄无效"); }
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("媒体访问句柄无效");
    const record = (await this.store.get()).records[id];
    if (!record) throw new Error("媒体访问句柄已失效");
    if (expectedSessionId && record.sessionId !== expectedSessionId) throw new Error("媒体访问句柄不属于当前会话");
    if (this.expired(record)) {
      await this.store.mutate((state) => { delete state.records[id]; });
      throw new Error("媒体访问句柄已过期");
    }
    const root = record.cacheKind === "attachment" ? join(this.cacheRoot, "..", "session-attachments") : this.cacheRoot;
    const sessionRoot = await realpath(join(root, sessionCacheKey(record.sessionId))).catch(() => undefined);
    const canonical = await realpath(record.path).catch(() => undefined);
    if (!sessionRoot || !canonical || !inside(sessionRoot, canonical)) throw new Error("媒体文件不存在或已离开会话缓存");
    const info = await stat(canonical);
    if (!info.isFile()) throw new Error("媒体文件不存在");
    const touchedAt = Date.parse(record.lastAccessedAt ?? record.createdAt);
    if (!Number.isFinite(touchedAt) || this.now().getTime() - touchedAt >= ACCESS_TOUCH_INTERVAL_MS) {
      const lastAccessedAt = this.now().toISOString();
      await this.store.mutate((state) => {
        if (state.records[id]) state.records[id]!.lastAccessedAt = lastAccessedAt;
      });
      record.lastAccessedAt = lastAccessedAt;
    }
    return { ...record, path: canonical };
  }

  async removeSession(sessionId: string): Promise<void> {
    assertSessionId(sessionId);
    await this.store.mutate((state) => {
      for (const [id, record] of Object.entries(state.records)) if (record.sessionId === sessionId) delete state.records[id];
    });
  }

  async sweep(sessionIds: ReadonlySet<string>): Promise<void> {
    const snapshot = await this.store.get();
    const missing = new Map<string, MediaAccessRecord>();
    await Promise.all(Object.entries(snapshot.records).map(async ([id, record]) => {
      if (!(await stat(record.path).then((value) => value.isFile()).catch(() => false))) missing.set(id, record);
    }));
    await this.store.mutate((state) => {
      const remove = new Set<string>();
      for (const [id, record] of Object.entries(state.records)) {
        const staleMissing = missing.get(id);
        if (!sessionIds.has(record.sessionId)
          || this.expired(record)
          || (staleMissing && sameRecordVersion(record, staleMissing))) remove.add(id);
      }
      const surviving = Object.entries(state.records).filter(([id]) => !remove.has(id));
      // Old builds could issue several handles for the same canonical file.
      // Retain the newest identity and remove the rest during bounded cleanup.
      const samePath = new Map<string, Array<[string, MediaAccessRecord]>>();
      for (const entry of surviving) {
        const key = `${entry[1].sessionId}\0${entry[1].cacheKind ?? "media"}\0${entry[1].media}\0${normalizeCase(entry[1].path)}`;
        const group = samePath.get(key) ?? [];
        group.push(entry);
        samePath.set(key, group);
      }
      for (const group of samePath.values()) for (const [id] of newestFirst(group).slice(1)) remove.add(id);
      const unique = surviving.filter(([id]) => !remove.has(id));
      for (const group of groupBySession(unique).values()) {
        for (const [id] of newestFirst(group).slice(this.options.maxRecordsPerSession ?? DEFAULT_MAX_RECORDS_PER_SESSION)) remove.add(id);
      }
      for (const [id] of newestFirst(unique.filter(([id]) => !remove.has(id))).slice(this.options.maxRecords ?? DEFAULT_MAX_RECORDS)) remove.add(id);
      for (const id of remove) delete state.records[id];
    });
  }

  private now(): Date { return this.options.now?.() ?? new Date(); }
  private expired(record: MediaAccessRecord): boolean {
    const timestamp = Date.parse(record.lastAccessedAt ?? record.createdAt);
    return !Number.isFinite(timestamp) || this.now().getTime() - timestamp > (this.options.ttlMs ?? DEFAULT_HANDLE_TTL_MS);
  }
}

function publicHandle(record: MediaAccessRecord): MediaAccessHandle {
  const { path: _path, createdAt: _createdAt, lastAccessedAt: _lastAccessedAt, cacheKind: _cacheKind, ...handle } = record;
  return handle;
}

function inside(root: string, path: string): boolean {
  const value = relative(normalize(root), normalize(path));
  return value === "" || (value !== ".." && !value.startsWith(`..${sep}`) && !/^[A-Za-z]:[\\/]/.test(value));
}

function normalizeCase(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function newestFirst(entries: Array<[string, MediaAccessRecord]>): Array<[string, MediaAccessRecord]> {
  return entries.slice().sort((left, right) => accessTime(right[1]) - accessTime(left[1]));
}

function groupBySession(entries: Array<[string, MediaAccessRecord]>): Map<string, Array<[string, MediaAccessRecord]>> {
  const grouped = new Map<string, Array<[string, MediaAccessRecord]>>();
  for (const entry of entries) {
    const group = grouped.get(entry[1].sessionId) ?? [];
    group.push(entry);
    grouped.set(entry[1].sessionId, group);
  }
  return grouped;
}

function accessTime(record: MediaAccessRecord): number {
  const value = Date.parse(record.lastAccessedAt ?? record.createdAt);
  return Number.isFinite(value) ? value : 0;
}
function normalize(path: string): string { return process.platform === "win32" ? path.toLowerCase() : path; }

function assertSessionId(sessionId: string): void {
  if (!sessionId || sessionId.length > MAX_SESSION_ID_LENGTH || sessionId.includes("\0")) throw new Error("媒体会话 ID 无效");
}

function sameRecordVersion(left: MediaAccessRecord, right: MediaAccessRecord): boolean {
  return normalizeCase(left.path) === normalizeCase(right.path)
    && left.createdAt === right.createdAt
    && left.lastAccessedAt === right.lastAccessedAt;
}
