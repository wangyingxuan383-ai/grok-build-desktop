import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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

  private async load(): Promise<T> {
    if (this.value) return structuredClone(this.value);
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<T>;
      this.value = { ...this.defaults, ...parsed };
    } catch {
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
}
