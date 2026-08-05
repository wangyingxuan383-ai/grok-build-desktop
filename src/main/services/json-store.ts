import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";

const STALE_TEMP_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
const STALE_LOCK_MS = 2 * 60 * 1_000;

interface FileLockRecord {
  pid: number;
  createdAt: string;
  nonce: string;
}

class CorruptJsonStoreError extends Error {}

export class JsonStore<T extends object> {
  private value: T | undefined;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly defaults: T,
  ) {}

  async get(): Promise<T> {
    // A scheduled automation worker and the visible Desktop can use the same
    // canonical AppData concurrently. Never return an instance-local cache
    // without first observing the file another process may have replaced.
    return this.enqueue(async () => {
      try { return structuredClone(await this.loadFresh(false)); }
      catch (error) {
        if (!(error instanceof CorruptJsonStoreError)) throw error;
        return withCrossProcessFileLock(`${this.filePath}.lock`, async () => structuredClone(await this.loadFresh(true)));
      }
    });
  }

  async set(next: T): Promise<T> {
    return this.enqueue(async () => {
      const candidate = structuredClone(next);
      await withCrossProcessFileLock(`${this.filePath}.lock`, async () => {
        await this.persist(candidate);
        this.value = candidate;
      });
      return structuredClone(candidate);
    });
  }

  async patch(patch: Partial<T>): Promise<T> {
    return this.enqueue(async () => {
      let candidate!: T;
      await withCrossProcessFileLock(`${this.filePath}.lock`, async () => {
        candidate = { ...(await this.loadFresh()), ...patch } as T;
        await this.persist(candidate);
        this.value = structuredClone(candidate);
      });
      return structuredClone(candidate);
    });
  }

  /**
   * Runs a complete read/modify/write transaction inside this store's queue.
   * Callers must not call get/set/patch from the mutator itself because that
   * would enqueue behind the transaction that is currently waiting for it.
   */
  async mutate(mutator: (current: T) => T | void | Promise<T | void>): Promise<T> {
    return this.enqueue(async () => {
      let candidate!: T;
      await withCrossProcessFileLock(`${this.filePath}.lock`, async () => {
        // The lock is intentionally acquired before the read. Reading an
        // instance cache here would still lose a worker's accepted update.
        const current = structuredClone(await this.loadFresh());
        const result = await mutator(current);
        candidate = structuredClone(result ?? current);
        await this.persist(candidate);
        this.value = candidate;
      });
      return structuredClone(candidate);
    });
  }

  private async loadFresh(repairCorrupt = true): Promise<T> {
    await this.cleanupStaleTemps();
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.value = structuredClone(this.defaults);
      return structuredClone(this.value);
    }
    try {
      const parsed = JSON.parse(raw) as Partial<T>;
      this.value = { ...this.defaults, ...parsed };
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      if (!repairCorrupt) throw new CorruptJsonStoreError("配置存储 JSON 已损坏");
      await mkdir(dirname(this.filePath), { recursive: true });
      const backup = `${this.filePath}.corrupt-${Date.now()}-${crypto.randomUUID()}.bak`;
      await rename(this.filePath, backup);
      this.value = structuredClone(this.defaults);
    }
    return structuredClone(this.value);
  }

  private async persist(value: T): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      await rename(temp, this.filePath);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private enqueue<R>(operation: () => Promise<R>): Promise<R> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async cleanupStaleTemps(): Promise<void> {
    const directory = dirname(this.filePath);
    const prefix = `${basename(this.filePath)}.`;
    const entries = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [] as string[];
      throw error;
    });
    const now = Date.now();
    await Promise.all(entries
      .filter((name) => name.startsWith(prefix) && name.endsWith(".tmp"))
      .map(async (name) => {
        const path = join(directory, name);
        const info = await stat(path).catch(() => undefined);
        if (info && now - info.mtimeMs >= STALE_TEMP_MS) await rm(path, { force: true });
      }));
  }
}

/**
 * A small cross-process transaction lock used by AppData stores and the
 * conversation projection journal. `wx` is the only atomic primitive needed:
 * exactly one Desktop/worker process can create the lock file. A dead owner's
 * lock is reclaimed immediately; a malformed owner is reclaimed only after a
 * grace period so a contender cannot delete a lock that is still being born.
 */
export async function withCrossProcessFileLock<R>(
  lockPath: string,
  action: () => Promise<R>,
  options: { timeoutMs?: number; staleMs?: number } = {},
): Promise<R> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const staleMs = options.staleMs ?? STALE_LOCK_MS;
  const deadline = Date.now() + timeoutMs;
  await mkdir(dirname(lockPath), { recursive: true });
  while (true) {
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(lockPath, "wx");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Windows can surface an already-open `wx` target as EPERM/EBUSY
      // instead of EEXIST. Only treat those codes as contention when the
      // lock path is still present; unrelated permission failures must escape.
      const lockExists = code === "EEXIST" || ((code === "EPERM" || code === "EBUSY" || code === "EACCES")
        && Boolean(await stat(lockPath).catch(() => undefined)));
      if (!lockExists) throw error;
      if (await reclaimDeadLock(lockPath, staleMs)) continue;
      if (Date.now() >= deadline) throw new Error(`等待配置存储锁超时：${basename(lockPath)}`);
      await delay(15 + Math.floor(Math.random() * 35));
      continue;
    }
    try {
      const record: FileLockRecord = { pid: process.pid, createdAt: new Date().toISOString(), nonce: crypto.randomUUID() };
      await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(lockPath, { force: true }).catch(() => undefined);
      throw error;
    }
    try {
      // Business errors (including an EEXIST raised by the action itself) are
      // not lock-acquisition failures and must never cause an implicit retry.
      return await action();
    } finally {
      await handle.close().catch(() => undefined);
      await rm(lockPath, { force: true }).catch(() => undefined);
    }
  }
}

async function reclaimDeadLock(lockPath: string, staleMs: number): Promise<boolean> {
  const observed = await inspectLock(lockPath, staleMs);
  if (!observed) return true;
  if (!observed.reclaimable) return false;

  // Several Desktop/worker processes can notice the same dead owner at once.
  // A claim keyed by the observed lock identity makes exactly one of them the
  // reaper. Without this second atomic create, a late reaper could unlink the
  // healthy lock that an earlier reaper has already replaced.
  const claimPath = `${lockPath}.reclaim-${createHash("sha256").update(observed.identity).digest("hex").slice(0, 24)}`;
  let claim: Awaited<ReturnType<typeof open>>;
  try { claim = await open(claimPath, "wx"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    const current = await inspectLock(lockPath, staleMs);
    if (!current) return true;
    if (current.identity !== observed.identity || !current.reclaimable) return false;
    await rm(lockPath, { force: true });
    return true;
  } finally {
    await claim.close().catch(() => undefined);
    await rm(claimPath, { force: true }).catch(() => undefined);
  }
}

async function inspectLock(lockPath: string, staleMs: number): Promise<{ identity: string; reclaimable: boolean } | undefined> {
  const info = await stat(lockPath).catch(() => undefined);
  if (!info) return undefined;
  let raw = "";
  let owner: Partial<FileLockRecord> | undefined;
  try {
    raw = await readFile(lockPath, "utf8");
    owner = JSON.parse(raw) as Partial<FileLockRecord>;
  } catch { owner = undefined; }
  const pid = Number(owner?.pid);
  const validPid = Number.isSafeInteger(pid) && pid > 0;
  const identity = typeof owner?.nonce === "string" && owner.nonce
    ? `nonce:${owner.nonce}`
    : `file:${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${createHash("sha256").update(raw).digest("hex")}`;
  if (validPid && processAlive(pid)) return { identity, reclaimable: false };
  return { identity, reclaimable: validPid || Date.now() - info.mtimeMs >= staleMs };
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
