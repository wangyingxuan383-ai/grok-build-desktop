import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const STALE_TEMP_MS = 24 * 60 * 60 * 1_000;

export class JsonStore<T extends object> {
  private value: T | undefined;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly defaults: T,
  ) {}

  async get(): Promise<T> {
    return this.enqueue(async () => structuredClone(await this.load()));
  }

  async set(next: T): Promise<T> {
    return this.enqueue(async () => {
      const candidate = structuredClone(next);
      await this.persist(candidate);
      this.value = candidate;
      return structuredClone(candidate);
    });
  }

  async patch(patch: Partial<T>): Promise<T> {
    return this.enqueue(async () => {
      const candidate = { ...(await this.load()), ...patch } as T;
      await this.persist(candidate);
      this.value = structuredClone(candidate);
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
      const current = structuredClone(await this.load());
      const result = await mutator(current);
      const candidate = structuredClone(result ?? current);
      await this.persist(candidate);
      this.value = candidate;
      return structuredClone(candidate);
    });
  }

  private async load(): Promise<T> {
    if (this.value) return structuredClone(this.value);
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
