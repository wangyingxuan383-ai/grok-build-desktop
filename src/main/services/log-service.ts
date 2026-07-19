import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
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

export class LogService {
  constructor(readonly filePath: string) {}

  async log(message: unknown): Promise<void> {
    const raw = typeof message === "string" ? message : JSON.stringify(message);
    const line = `${new Date().toISOString()} ${redactSecrets(raw)}\n`;
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, line, "utf8").catch(async () => writeFile(this.filePath, line, "utf8"));
  }

  async read(): Promise<string> {
    return readFile(this.filePath, "utf8").catch(() => "");
  }
}
