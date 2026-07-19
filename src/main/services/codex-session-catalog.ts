import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { CodexSessionDetail, CodexSessionSummary, CodexTurn } from "../../shared/types";
import { JsonStore } from "./json-store";
import type { LogService } from "./log-service";

interface CodexMetadata {
  hidden: Record<string, boolean>;
  continuations: Record<string, string>;
}

interface RawSessionMeta {
  id?: string;
  session_id?: string;
  cwd?: string;
  timestamp?: string;
  source?: string;
  thread_source?: string;
  originator?: string;
}

export class CodexSessionCatalog {
  private readonly metadata: JsonStore<CodexMetadata>;
  private cache?: { at: number; rows: CodexSessionSummary[] };
  private byId = new Map<string, CodexSessionSummary>();

  constructor(
    userDataPath: string,
    private readonly log: LogService,
    private readonly codexHome = join(homedir(), ".codex"),
    private readonly grokHome = join(homedir(), ".grok"),
  ) {
    this.metadata = new JsonStore(join(userDataPath, "codex-metadata.json"), { hidden: {}, continuations: {} });
  }

  async list(cwd = "", includeArchived = false, force = false, includeHidden = false): Promise<CodexSessionSummary[]> {
    const rows = await this.scan(force);
    const metadata = await this.metadata.get();
    return rows.filter((row) => {
      if (!includeArchived && row.archived) return false;
      if (!includeHidden && metadata.hidden[row.id]) return false;
      return !cwd || pathWithin(row.cwd, cwd);
    }).map((row) => ({ ...row, hidden: Boolean(metadata.hidden[row.id]) }));
  }

  async listAll(force = false): Promise<CodexSessionSummary[]> {
    return this.list("", true, force, true);
  }

  async open(id: string, force = false): Promise<CodexSessionDetail> {
    await this.scan(force);
    const row = this.byId.get(id);
    if (!row) throw new Error("Codex 会话不存在或尚未索引");
    assertCodexPath(row.path, this.codexHome);
    const hash = await sha256File(row.path);
    const reader = join(this.grokHome, "bundled", "skills", "shared", "resume-session", "session_reader.py");
    let turns: CodexTurn[] = [];
    let warnings: string[] = [];
    let lastUserRequest: string | undefined;
    let lastAssistantAction: string | undefined;
    try {
      const readerAvailable = await stat(reader).then((value) => value.isFile()).catch(() => false);
      if (!readerAvailable) throw new Error("Grok Codex 读取器不存在");
      const output = await runFile("python", [reader, "codex", "show", row.path, "--json"]);
      const parsed = JSON.parse(output) as { turns?: Array<{ role?: string; text?: string; tool_calls?: unknown[]; tool_results?: unknown[]; inert?: boolean }>; warnings?: string[]; last_user_request?: string; last_assistant_action?: string };
      turns = (parsed.turns ?? []).map(normalizeReaderTurn).filter((value): value is CodexTurn => Boolean(value));
      warnings = parsed.warnings ?? [];
      lastUserRequest = parsed.last_user_request;
      lastAssistantAction = parsed.last_assistant_action;
    } catch (error) {
      await this.log.log(`Codex reader fallback ${id}: ${error instanceof Error ? error.message : String(error)}`);
      turns = await parseCodexJsonl(row.path);
      warnings.push("Grok Codex 读取器不可用，已使用内置只读兼容解析器。");
    }
    return { ...row, turns, warnings, lastUserRequest, lastAssistantAction, contentHash: hash };
  }

  refresh(id: string): Promise<CodexSessionDetail> {
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
    data.continuations[id] = grokSessionId;
    await this.metadata.set(data);
  }

  async contentHash(id: string): Promise<string> {
    await this.scan(false);
    const row = this.byId.get(id);
    if (!row) throw new Error("Codex 会话不存在");
    assertCodexPath(row.path, this.codexHome);
    return sha256File(row.path);
  }

  private async scan(force: boolean): Promise<CodexSessionSummary[]> {
    if (!force && this.cache && Date.now() - this.cache.at < 30_000) return this.cache.rows.map((row) => ({ ...row }));
    const titles = await readTitles(join(this.codexHome, "session_index.jsonl"));
    const sqlite = await this.scanSqlite().catch(async (error) => {
      await this.log.log(`Codex sqlite index unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    });
    const rows = sqlite.length ? sqlite.map((row) => ({ ...row, title: titles.get(row.id)?.title || row.title, updatedAt: titles.get(row.id)?.updatedAt || row.updatedAt })) : await this.scanJsonl(titles);
    this.byId = new Map(rows.map((row) => [row.id, row]));
    this.cache = { at: Date.now(), rows };
    return rows.map((row) => ({ ...row }));
  }

  private async scanSqlite(): Promise<CodexSessionSummary[]> {
    const databases = (await readdir(this.codexHome, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isFile() && /^state_.*\.sqlite$/i.test(entry.name))
      .map((entry) => join(this.codexHome, entry.name));
    if (!databases.length) return [];
    const code = [
      "import sqlite3,json,sys,os",
      "rows=[]",
      "for p in sys.argv[1:]:",
      " try:",
      "  c=sqlite3.connect('file:'+p.replace('\\\\','/')+'?mode=ro', uri=True)",
      "  q=\"select t.id,t.rollout_path,t.cwd,t.title,t.created_at,t.updated_at,t.archived,t.source,coalesce(t.thread_source,''),coalesce(t.agent_role,''),coalesce(t.agent_path,'') from threads t left join thread_spawn_edges e on e.child_thread_id=t.id where e.child_thread_id is null\"",
      "  rows += [dict(zip(['id','path','cwd','title','created','updated','archived','source','thread_source','agent_role','agent_path'],r)) for r in c.execute(q) if not r[9] and not r[10]]",
      " except Exception: pass",
      "print(json.dumps(rows))",
    ].join("\n");
    const output = await runFile("python", ["-c", code, ...databases]);
    const values = JSON.parse(output) as Array<Record<string, unknown>>;
    return values.flatMap((value): CodexSessionSummary[] => {
      const path = normalizeWindowsPath(String(value.path || ""));
      const cwd = normalizeWindowsPath(String(value.cwd || ""));
      if (!path || !cwd || !isAbsolute(path)) return [];
      return [{
        id: String(value.id), path, cwd,
        title: String(value.title || "Codex 会话"),
        createdAt: epochToIso(value.created), updatedAt: epochToIso(value.updated),
        archived: Boolean(value.archived), hidden: false,
        source: String(value.thread_source || value.source || ""), origin: "Codex",
      }];
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private async scanJsonl(titles: Map<string, { title: string; updatedAt: string }>): Promise<CodexSessionSummary[]> {
    const roots = [
      { path: join(this.codexHome, "sessions"), archived: false },
      { path: join(this.codexHome, "archived_sessions"), archived: true },
    ];
    const rows: CodexSessionSummary[] = [];
    for (const root of roots) {
      for (const path of await findJsonl(root.path)) {
        const meta = await readSessionMeta(path);
        const id = String(meta?.id || meta?.session_id || extractId(path));
        const cwd = String(meta?.cwd || "");
        if (!id || !cwd || isSubagent(meta)) continue;
        const info = await stat(path).catch(() => undefined);
        const indexed = titles.get(id);
        rows.push({
          id, path, cwd,
          title: indexed?.title || "Codex 会话",
          createdAt: String(meta?.timestamp || info?.birthtime.toISOString() || ""),
          updatedAt: indexed?.updatedAt || info?.mtime.toISOString() || String(meta?.timestamp || ""),
          archived: root.archived, hidden: false,
          source: meta?.thread_source || meta?.source,
          origin: meta?.originator,
        });
      }
    }
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}

function normalizeReaderTurn(value: { role?: string; text?: string; tool_calls?: unknown[]; tool_results?: unknown[]; inert?: boolean }): CodexTurn | null {
  const role = value.role === "user" || value.role === "assistant" || value.role === "tool" || value.role === "thought" ? value.role : undefined;
  if (!role || (!value.text && !value.tool_calls?.length && !value.tool_results?.length)) return null;
  return { role, text: value.text || "", toolCalls: value.tool_calls, toolResults: value.tool_results, inert: value.inert };
}

async function parseCodexJsonl(path: string): Promise<CodexTurn[]> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const turns: CodexTurn[] = [];
  for await (const line of lines) {
    try {
      const value = JSON.parse(line) as { type?: string; payload?: Record<string, unknown> };
      const payload = value.payload ?? {};
      if (value.type === "response_item" && payload.type === "message") {
        const role = payload.role === "user" ? "user" : payload.role === "assistant" ? "assistant" : undefined;
        const text = contentText(payload.content);
        if (role && text) turns.push({ role, text });
      } else if (value.type === "event_msg" && (payload.type === "agent_reasoning" || payload.type === "agent_reasoning_delta")) {
        const text = String(payload.text || payload.delta || "");
        if (text) turns.push({ role: "thought", text });
      } else if (value.type === "response_item" && (payload.type === "function_call" || payload.type === "custom_tool_call")) {
        turns.push({ role: "tool", text: String(payload.name || payload.type), toolCalls: [payload] });
      } else if (value.type === "response_item" && (payload.type === "function_call_output" || payload.type === "custom_tool_call_output")) {
        turns.push({ role: "tool", text: contentText(payload.output), toolResults: [payload] });
      }
    } catch { /* A malformed line must not make the read-only mirror unusable. */ }
  }
  return turns;
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((item) => {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return "";
    const row = item as Record<string, unknown>;
    return String(row.text || row.output_text || row.input_text || "");
  }).filter(Boolean).join("\n\n");
}

async function readSessionMeta(path: string): Promise<RawSessionMeta | undefined> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    lines.close(); stream.destroy();
    try {
      const value = JSON.parse(line) as { type?: string; payload?: RawSessionMeta };
      return value.type === "session_meta" ? value.payload : undefined;
    } catch { return undefined; }
  }
  return undefined;
}

async function readTitles(path: string): Promise<Map<string, { title: string; updatedAt: string }>> {
  const result = new Map<string, { title: string; updatedAt: string }>();
  const content = await readFile(path, "utf8").catch(() => "");
  for (const line of content.split(/\r?\n/)) {
    try {
      const value = JSON.parse(line) as { id?: string; thread_name?: string; updated_at?: string };
      if (value.id) result.set(value.id, { title: value.thread_name || "Codex 会话", updatedAt: value.updated_at || "" });
    } catch { /* ignore damaged index rows */ }
  }
  return result;
}

async function findJsonl(root: string): Promise<string[]> {
  const result: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl")) result.push(path);
    }
  };
  await walk(root);
  return result;
}

function isSubagent(meta?: RawSessionMeta): boolean {
  const source = `${meta?.thread_source || ""} ${meta?.source || ""}`.toLowerCase();
  return /subagent|sub-agent|spawn/.test(source);
}

function extractId(path: string): string {
  return basename(path).match(/([0-9a-f]{8}-[0-9a-f-]{27,})/i)?.[1] || "";
}

function pathWithin(candidate: string, root: string): boolean {
  const rel = relative(resolve(normalizeWindowsPath(root)), resolve(normalizeWindowsPath(candidate)));
  return !rel || (!rel.startsWith("..") && !isAbsolute(rel));
}

function assertCodexPath(path: string, codexHome: string): void {
  const rel = relative(resolve(normalizeWindowsPath(codexHome)), resolve(normalizeWindowsPath(path)));
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || !path.toLowerCase().endsWith(".jsonl")) throw new Error("非法 Codex 会话路径");
}

function normalizeWindowsPath(value: string): string {
  return value.replace(/^\\\\\?\\/, "");
}

function epochToIso(value: unknown): string {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "";
  return new Date(number > 10_000_000_000 ? number : number * 1000).toISOString();
}

async function sha256File(path: string): Promise<string> {
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

export { parseCodexJsonl, pathWithin };
