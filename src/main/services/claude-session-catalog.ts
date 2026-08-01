import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { pathWithin as sharedPathWithin, samePath as sharedSamePath, normalizeComparablePath } from "../../shared/path-utils";
import type { ClaudeSessionDetail, ClaudeSessionSummary, ClaudeTurn } from "../../shared/types";
import { JsonStore } from "./json-store";
import type { LogService } from "./log-service";

interface ClaudeMetadata {
  hidden: Record<string, boolean>;
  continuations: Record<string, string | string[]>;
}

export interface ClaudeContinuationMapping {
  claudeId: string;
  sessionId: string;
  cwd: string;
  title: string;
}

interface ClaudeScanState {
  id: string;
  cwd: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  source?: string;
  origin?: string;
  model?: string;
  sidechainOnly: boolean;
}

interface ReaderTurn {
  role?: string;
  text?: string;
  tool_calls?: unknown[];
  tool_results?: unknown[];
  inert?: boolean;
}

export class ClaudeSessionCatalog {
  private readonly metadata: JsonStore<ClaudeMetadata>;
  private cache?: { at: number; rows: ClaudeSessionSummary[] };
  private byId = new Map<string, ClaudeSessionSummary>();

  constructor(
    userDataPath: string,
    private readonly log: LogService,
    private readonly claudeHome = join(homedir(), ".claude"),
    private readonly grokHome = join(homedir(), ".grok"),
  ) {
    this.metadata = new JsonStore(join(userDataPath, "claude-metadata.json"), { hidden: {}, continuations: {} });
  }

  async list(cwd = "", force = false, includeHidden = false): Promise<ClaudeSessionSummary[]> {
    const [rows, metadata] = await Promise.all([this.scan(force), this.metadata.get()]);
    return rows.filter((row) => {
      if (!includeHidden && metadata.hidden[row.id]) return false;
      return !cwd || pathWithin(row.cwd, cwd);
    }).map((row) => ({ ...row, hidden: Boolean(metadata.hidden[row.id]) }));
  }

  async listAll(force = false): Promise<ClaudeSessionSummary[]> {
    return this.list("", force, true);
  }

  async open(id: string, force = false): Promise<ClaudeSessionDetail> {
    await this.scan(force);
    const row = this.byId.get(id);
    if (!row) throw new Error("Claude 会话不存在或尚未索引");
    assertClaudePath(row.path, this.claudeHome);
    const hash = await sha256File(row.path);
    const reader = join(this.grokHome, "bundled", "skills", "shared", "resume-session", "session_reader.py");
    let turns: ClaudeTurn[] = [];
    let warnings: string[] = [];
    let lastUserRequest: string | undefined;
    let lastAssistantAction: string | undefined;
    try {
      const readerAvailable = await stat(reader).then((value) => value.isFile()).catch(() => false);
      if (!readerAvailable) throw new Error("Grok Claude 读取器不存在");
      const output = await runFile("python", [reader, "claude", "show", row.path, "--cwd", row.cwd, "--json"]);
      const parsed = JSON.parse(output) as {
        turns?: ReaderTurn[];
        warnings?: string[];
        last_user_request?: string;
        last_assistant_action?: string;
      };
      turns = (parsed.turns ?? []).map(normalizeReaderTurn).filter((value): value is ClaudeTurn => Boolean(value));
      warnings = parsed.warnings ?? [];
      lastUserRequest = parsed.last_user_request;
      lastAssistantAction = parsed.last_assistant_action;
    } catch (error) {
      await this.log.log(`Claude reader fallback ${id}: ${error instanceof Error ? error.message : String(error)}`);
      turns = await parseClaudeJsonl(row.path);
      warnings.push("Grok Claude 读取器不可用，已使用内置只读兼容解析器。");
    }
    // The bundled resume reader deliberately returns a compact handoff rather
    // than a complete transcript. Keep using it for warnings and continuation
    // metadata, but render the richer read-only history when it is available.
    const mirrorTurns = await parseClaudeJsonl(row.path);
    if (mirrorTurns.some((turn) => turn.role === "user") && mirrorTurns.length > turns.length) turns = mirrorTurns;
    return { ...row, turns, warnings, lastUserRequest, lastAssistantAction, contentHash: hash };
  }

  refresh(id: string): Promise<ClaudeSessionDetail> {
    return this.open(id, true);
  }

  async hide(id: string, hidden = true): Promise<void> {
    const data = await this.metadata.get();
    if (hidden) data.hidden[id] = true;
    else delete data.hidden[id];
    await this.metadata.set(data);
  }

  async recordContinuation(id: string, grokSessionId: string): Promise<void> {
    const data = await this.metadata.get();
    const current = data.continuations[id];
    const values = Array.isArray(current) ? current : current ? [current] : [];
    if (!values.includes(grokSessionId)) values.push(grokSessionId);
    data.continuations[id] = values;
    await this.metadata.set(data);
  }

  async listContinuations(cwd = ""): Promise<ClaudeContinuationMapping[]> {
    const [rows, data] = await Promise.all([this.scan(false), this.metadata.get()]);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const output: ClaudeContinuationMapping[] = [];
    for (const [claudeId, stored] of Object.entries(data.continuations)) {
      const row = byId.get(claudeId);
      if (!row || (cwd && !pathWithin(row.cwd, cwd))) continue;
      for (const sessionId of Array.isArray(stored) ? stored : [stored]) {
        if (sessionId) output.push({ claudeId, sessionId, cwd: row.cwd, title: row.title });
      }
    }
    return output;
  }

  async contentHash(id: string): Promise<string> {
    await this.scan(false);
    const row = this.byId.get(id);
    if (!row) throw new Error("Claude 会话不存在");
    assertClaudePath(row.path, this.claudeHome);
    return sha256File(row.path);
  }

  private async scan(force: boolean): Promise<ClaudeSessionSummary[]> {
    if (!force && this.cache && Date.now() - this.cache.at < 30_000) return structuredClone(this.cache.rows);
    const projectsRoot = join(this.claudeHome, "projects");
    const rows: ClaudeSessionSummary[] = [];
    for (const path of await findJsonl(projectsRoot)) {
      if (path.split(/[\\/]/).some((part) => part.toLocaleLowerCase() === "subagents")) continue;
      const info = await stat(path).catch(() => undefined);
      if (!info?.isFile()) continue;
      const scanned = await scanClaudeJsonl(path, info.birthtime.toISOString(), info.mtime.toISOString());
      if (!scanned.id || !scanned.cwd || scanned.sidechainOnly) continue;
      rows.push({
        id: scanned.id,
        path,
        cwd: scanned.cwd,
        title: scanned.title || "Claude 会话",
        createdAt: scanned.createdAt,
        updatedAt: scanned.updatedAt,
        hidden: false,
        source: scanned.source,
        origin: scanned.origin,
        model: scanned.model,
      });
    }
    rows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    this.byId = new Map(rows.map((row) => [row.id, row]));
    this.cache = { at: Date.now(), rows };
    return structuredClone(rows);
  }
}

function normalizeReaderTurn(value: ReaderTurn): ClaudeTurn | null {
  const role = value.role === "user" || value.role === "assistant" || value.role === "tool" || value.role === "thought" ? value.role : undefined;
  if (!role || (!value.text && !value.tool_calls?.length && !value.tool_results?.length)) return null;
  return { role, text: value.text || "", toolCalls: value.tool_calls, toolResults: value.tool_results, inert: value.inert };
}

async function scanClaudeJsonl(path: string, fallbackCreatedAt: string, fallbackUpdatedAt: string): Promise<ClaudeScanState> {
  const state: ClaudeScanState = {
    id: extractId(path),
    cwd: "",
    title: "",
    createdAt: fallbackCreatedAt,
    updatedAt: fallbackUpdatedAt,
    sidechainOnly: true,
  };
  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      if (typeof value.sessionId === "string" && value.sessionId) state.id = value.sessionId;
      if (typeof value.cwd === "string" && value.cwd) state.cwd = normalizeComparablePath(value.cwd);
      if (typeof value.timestamp === "string" && value.timestamp) {
        if (!state.createdAt || value.timestamp < state.createdAt) state.createdAt = value.timestamp;
        if (!state.updatedAt || value.timestamp > state.updatedAt) state.updatedAt = value.timestamp;
      }
      if (value.isSidechain !== true && (value.type === "user" || value.type === "assistant")) state.sidechainOnly = false;
      if (typeof value.entrypoint === "string") state.source = value.entrypoint;
      if (typeof value.origin === "string") state.origin = value.origin;
      if (value.type === "custom-title" && typeof value.customTitle === "string" && value.customTitle.trim()) {
        state.title = compactTitle(value.customTitle);
      } else if (!state.title && value.type === "user" && value.isMeta !== true && value.isSidechain !== true) {
        state.title = compactTitle(messageText(value.message));
      }
      if (value.type === "assistant" && value.message && typeof value.message === "object") {
        const model = (value.message as Record<string, unknown>).model;
        if (typeof model === "string" && model) state.model = model;
      }
    } catch { /* A malformed line must not hide the rest of a read-only session. */ }
  }
  return state;
}

export async function parseClaudeJsonl(path: string): Promise<ClaudeTurn[]> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const turns: ClaudeTurn[] = [];
  for await (const line of lines) {
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      if (value.isSidechain === true) continue;
      if (value.type === "user" && value.isMeta !== true) {
        const message = value.message && typeof value.message === "object" ? value.message as Record<string, unknown> : undefined;
        const content = message?.content;
        const text = visibleContentText(content);
        if (text) turns.push({ role: "user", text });
        if (Array.isArray(content)) {
          for (const block of content) {
            if (!block || typeof block !== "object") continue;
            const row = block as Record<string, unknown>;
            if (row.type === "tool_result") {
              const text = toolResultText(row.content);
              turns.push({ role: "tool", text: text || "Claude 工具结果", toolResults: [{ type: "tool_result", tool_use_id: row.tool_use_id }], inert: true });
            }
          }
        }
      } else if (value.type === "assistant") {
        const message = value.message && typeof value.message === "object" ? value.message as Record<string, unknown> : undefined;
        const content = message?.content;
        if (!Array.isArray(content)) {
          const text = visibleContentText(content);
          if (text) turns.push({ role: "assistant", text });
          continue;
        }
        for (const block of content) {
          if (!block || typeof block !== "object") continue;
          const row = block as Record<string, unknown>;
          if (row.type === "text") {
            const text = typeof row.text === "string" ? row.text : "";
            if (text) turns.push({ role: "assistant", text });
          } else if (row.type === "thinking") {
            const text = typeof row.thinking === "string" ? row.thinking : "";
            if (text) turns.push({ role: "thought", text, inert: true });
          } else if (row.type === "tool_use") {
            turns.push({ role: "tool", text: String(row.name || "Claude 工具调用"), toolCalls: [{ type: "tool_use", name: row.name, id: row.id }], inert: true });
          }
        }
      } else if (value.type === "system" && value.error) {
        turns.push({ role: "tool", text: String(value.error), inert: true });
      }
    } catch { /* ignore damaged rows */ }
  }
  return turns;
}

function messageText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  return visibleContentText((value as Record<string, unknown>).content);
}

function visibleContentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((item) => {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return "";
    const row = item as Record<string, unknown>;
    if (row.type === "text") return typeof row.text === "string" ? row.text : "";
    if (typeof row.content === "string" && row.type !== "tool_result") return row.content;
    return "";
  }).filter(Boolean).join("\n\n");
}

function toolResultText(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 12_000);
  if (!Array.isArray(value)) return "";
  return value.map((item) => {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return "";
    const row = item as Record<string, unknown>;
    return typeof row.text === "string" ? row.text : typeof row.content === "string" ? row.content : "";
  }).filter(Boolean).join("\n\n").slice(0, 12_000);
}

function compactTitle(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 96);
}

async function findJsonl(root: string): Promise<string[]> {
  const result: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.toLocaleLowerCase().endsWith(".jsonl")) result.push(path);
    }
  };
  await walk(root);
  return result;
}

function extractId(path: string): string {
  return basename(path).replace(/\.jsonl$/i, "");
}

export function pathWithin(candidate: string, root: string): boolean {
  return sharedPathWithin(candidate, root);
}

function assertClaudePath(path: string, claudeHome: string): void {
  const projectsRoot = join(claudeHome, "projects");
  if (!sharedPathWithin(path, projectsRoot) || !path.toLocaleLowerCase().endsWith(".jsonl")) throw new Error("非法 Claude 会话路径");
  // pathWithin treats root itself as inside; session files must be strict descendants.
  if (sharedSamePath(path, projectsRoot)) throw new Error("非法 Claude 会话路径");
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

function runFile(command: string, args: string[]): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 100 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message)));
      else resolveOutput(String(stdout));
    });
  });
}
