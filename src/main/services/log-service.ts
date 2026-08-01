import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, "$1[REDACTED]"],
  [/((?:refresh_?token|access_?token|api_?key|xai_api_key|key)\s*["']?\s*[:=]\s*["'])[^"'\s]+/gi, "$1[REDACTED]"],
  [/([?&](?:refresh_?token|access_?token|api_?key|xai_api_key|key)=)[^&#\s]+/gi, "$1[REDACTED]"],
  [/(sk-[A-Za-z0-9_-]{12,})/g, "[REDACTED_API_KEY]"],
  [/(xai-[A-Za-z0-9_-]{12,})/g, "[REDACTED_API_KEY]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_JWT]"],
];

export function redactSecrets(input: string): string {
  return SECRET_PATTERNS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), input);
}

/** Redaction applied to the persistent AppData log, not only support bundles. */
export function redactLogText(input: string): string {
  return redactSecrets(input)
    .replace(/https?:\/\/[^\s"']+/gi, (value) => {
      try {
        const url = new URL(value);
        return `${url.protocol}//${url.hostname}${url.port ? ":<port>" : ""}`;
      } catch {
        return "[REDACTED_URL]";
      }
    })
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/(["'])(?:\\\\\?\\)?[A-Za-z]:[\\/][^"'\r\n]*\1/g, "$1[REDACTED_PATH]$1")
    .replace(/(["'])\\\\[^\\\s"']+\\[^"'\r\n]*\1/g, "$1[REDACTED_NETWORK_PATH]$1")
    // Unquoted paths can contain spaces and there is no reliable generic end
    // delimiter in arbitrary stderr. Redact the remainder of that log line
    // rather than retaining a private path suffix.
    .replace(/(?<![A-Za-z0-9])(?:\\\\\?\\)?[A-Za-z]:[\\/][^\r\n"']*/g, "[REDACTED_PATH]")
    .replace(/\\\\[^\\\s"']+\\[^\r\n"']*/g, "[REDACTED_NETWORK_PATH]");
}

export class LogService {
  private queue: Promise<void> = Promise.resolve();
  private prepared = false;

  constructor(readonly filePath: string, private readonly maxBytes = 8 * 1024 * 1024) {}

  async log(message: unknown): Promise<void> {
    const raw = typeof message === "string" ? message : JSON.stringify(message);
    const redacted = redactLogText(raw);
    const bounded = redacted.length > 65_536 ? `${redacted.slice(0, 65_536)}\n[LOG_ENTRY_TRUNCATED]` : redacted;
    const line = `${new Date().toISOString()} ${bounded}\n`;
    await this.enqueue(async () => {
      await this.prepare();
      const currentSize = await stat(this.filePath).then((value) => value.size).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return 0;
        throw error;
      });
      if (currentSize > 0 && currentSize + Buffer.byteLength(line) > this.maxBytes) {
        const backup = `${this.filePath}.1`;
        await rm(backup, { force: true });
        await rename(this.filePath, backup);
      }
      await appendFile(this.filePath, line, "utf8");
    });
  }

  async read(): Promise<string> {
    let value = "";
    await this.enqueue(async () => {
      await this.prepare();
      value = await readFile(this.filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "";
        throw error;
      });
    });
    return value;
  }

  /** Waits for already-enqueued writes; used before temporary fixtures or the app dispose their storage. */
  async flush(): Promise<void> {
    await this.queue;
  }

  private async prepare(): Promise<void> {
    if (this.prepared) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    const existing = await readFile(this.filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (existing !== undefined) {
      const sanitized = redactLogText(existing);
      if (sanitized !== existing) {
        const temp = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
        try {
          await writeFile(temp, sanitized, "utf8");
          await rename(temp, this.filePath);
        } catch (error) {
          await rm(temp, { force: true }).catch(() => undefined);
          throw error;
        }
      }
    }
    this.prepared = true;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
