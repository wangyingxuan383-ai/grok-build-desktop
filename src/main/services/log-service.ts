import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const SENSITIVE_NAME = String.raw`[A-Za-z0-9_.-]*(?:(?:proxy[-_])?authorization|refresh[-_]?token|access[-_]?token|api[-_]?key|x[-_]?api[-_]?key|client[-_]?secret|private[-_]?key|secret[-_]?key|password|passwd|credential|secret|token|signature|header)[A-Za-z0-9_.-]*`;
const QUOTED_SECRET_ASSIGNMENT = new RegExp(String.raw`((?:["']?${SENSITIVE_NAME}["']?)\s*[:=]\s*)("(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*')`, "gi");
const UNQUOTED_SECRET_ASSIGNMENT = new RegExp(String.raw`((?:["']?${SENSITIVE_NAME}["']?)\s*[:=]\s*)(?!["'])([^\r\n,;}&]+)`, "gi");

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/([?&](?:(?:access|refresh|id)[_-]?token|token|api[_-]?key|access[_-]?key|key|secret|password|credential|authorization|auth|signature|sig|jwt|code)=)[^&#\s"']*/gi, "$1[REDACTED]"],
  [/(\bhttps?:\/\/)[^@\s/"']+@/gi, "$1[REDACTED]@"],
  [/(sk-[A-Za-z0-9_-]{12,})/g, "[REDACTED_API_KEY]"],
  [/(xai-[A-Za-z0-9_-]{12,})/g, "[REDACTED_API_KEY]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_JWT]"],
  // Opaque credentials exported by local gateways are often bare Base64 or
  // base64url strings without a recognizable vendor prefix.
  [/\b(?:[A-Za-z0-9+/]{40,}={0,2}|[A-Za-z0-9_-]{48,})\b/g, "[REDACTED_OPAQUE_TOKEN]"],
];

export function redactSecrets(input: string): string {
  let value = input
    // Custom header/environment names cannot be enumerated safely. When a
    // diagnostic serializes one of these containers, remove the flat payload
    // instead of trying to guess which values are credentials.
    .replace(/((?:["']?(?:headers?|environment|env)["']?)\s*[:=]\s*)\{[\s\S]{0,65536}?\}/gi, "$1{[REDACTED_VALUES]}")
    .replace(/((?:environment|env)(?:\.|\s+)[A-Za-z0-9_.-]+\s*[:=]\s*)(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\r\n]+)/gi, "$1[REDACTED]")
    .replace(/((?:(?:request|response)\s+)?header\s+[A-Za-z0-9_.-]+\s*[:=]\s*)(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\r\n]+)/gi, "$1[REDACTED]")
    .replace(/((?:--header|-H)\s+)(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\s]+)/gi, "$1[REDACTED_HEADER]")
    .replace(QUOTED_SECRET_ASSIGNMENT, (_match, prefix: string, quoted: string) => `${prefix}${quoted[0]}[REDACTED]${quoted.at(-1)}`)
    .replace(UNQUOTED_SECRET_ASSIGNMENT, "$1[REDACTED]");
  value = SECRET_PATTERNS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), value);
  return value;
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
    .replace(/(["'])\/\/[^/\s"']+\/[^"'\r\n]*\1/g, "$1[REDACTED_NETWORK_PATH]$1")
    // Unquoted paths can contain spaces and there is no reliable generic end
    // delimiter in arbitrary stderr. Redact the remainder of that log line
    // rather than retaining a private path suffix.
    .replace(/(?<![A-Za-z0-9])(?:\\\\\?\\)?[A-Za-z]:[\\/][^\r\n"']*/g, "[REDACTED_PATH]")
    .replace(/\\\\[^\\\s"']+\\[^\r\n"']*/g, "[REDACTED_NETWORK_PATH]")
    .replace(/\/\/[^/\s"']+\/[^\r\n"']*/g, "[REDACTED_NETWORK_PATH]");
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
