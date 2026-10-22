import { writeFile } from "node:fs/promises";
import {
  buildSessionExport, normalizeSessionExportOptions,
  type SessionExportApi, type SessionExportOptions, type SessionExportPreview, type SessionExportSource,
} from "../../shared/conversation-export";
import { redactLogText } from "./log-service";

export interface SessionExportSaveDialogOptions {
  title: string;
  defaultPath: string;
  filters: Array<{ name: string; extensions: string[] }>;
}

export interface SessionExportDependencies {
  /** Read the full stored projection without focusing, resuming or launching a CLI. */
  readSession(sessionId: string): Promise<SessionExportSource | undefined>;
  /** Adapter around the parent's Electron window/dialog; cancellation is not an error. */
  showSaveDialog(options: SessionExportSaveDialogOptions): Promise<{ canceled: boolean; filePath?: string }>;
  writeFile?(path: string, content: string): Promise<void>;
}

/** Extend the existing log redactor for exported POSIX/home paths and private keys. */
export function redactSessionExportText(input: string): { content: string; redactionCount: number } {
  let prefix = "\uE000";
  while (input.includes(prefix)) prefix += "\uE000";
  const originals: string[] = [];
  const masked = input.replace(/\[REDACTED(?:_[A-Z_]+)?\]/g, match => `${prefix}${originals.push(match) - 1}\uE001`);
  // PEM and vendor tokens must be removed before the opaque-token rule splits them.
  const prepared = masked
    .replace(/-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/\b(?:gh[pousr]_|github_pat_|glpat-|AKIA)[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_API_KEY]");
  let content = redactLogText(prepared)
    .replace(/(?<![\w])(?:file:\/\/\/|\/)(?:Users|home|root|mnt|media|Volumes|private|tmp|var|opt|workspace|workspaces)(?:\/[^\r\n<>"'`]*|\b)/gi, "[REDACTED_PATH]")
    .replace(/(?<![\w])~[\\/][^\r\n<>"'`]*/g, "[REDACTED_PATH]");
  const redactionCount = (content.match(/\[REDACTED(?:_[A-Z_]+)?\]/g) ?? []).length;
  originals.forEach((original, index) => { content = content.split(`${prefix}${index}\uE001`).join(original); });
  return { content, redactionCount };
}

export class SessionExportService implements SessionExportApi {
  constructor(private readonly dependencies: SessionExportDependencies) {}

  async previewSessionExport(sessionId: string, options: SessionExportOptions = {}): Promise<SessionExportPreview> {
    const normalized = normalizeSessionExportOptions(options);
    if (typeof sessionId !== "string" || !sessionId.trim()) throw new Error("A session ID is required for export");
    const session = await this.dependencies.readSession(sessionId);
    if (!session) throw new Error("Session is unavailable for export");
    if (session.sessionId !== sessionId) throw new Error("Export source belongs to another session");
    return buildSessionExport(session, normalized, redactSessionExportText);
  }

  async saveSessionExport(sessionId: string, options: SessionExportOptions = {}): Promise<string | undefined> {
    // Generate one immutable payload before the dialog; never save a stale renderer preview.
    const preview = await this.previewSessionExport(sessionId, options);
    const target = await this.dependencies.showSaveDialog({
      title: preview.format === "html" ? "导出会话 HTML" : "导出会话 Markdown",
      defaultPath: preview.fileName,
      filters: [{ name: preview.format === "html" ? "HTML" : "Markdown", extensions: [preview.format === "html" ? "html" : "md"] }],
    });
    if (target.canceled || !target.filePath) return undefined;
    if (this.dependencies.writeFile) await this.dependencies.writeFile(target.filePath, preview.content);
    else await writeFile(target.filePath, preview.content, "utf8");
    return target.filePath;
  }
}
