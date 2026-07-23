import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { AppSettings, MemoryDeletePreview, MemoryEntry, MemoryLayout, MemoryRememberPreview, MemorySaveInput, MemorySaveResult, MemorySettings, MemoryStructuredEntry } from "../../shared/types";
import { locateGrokCli } from "./cli-locator";
import { EditorService } from "./editor-service";
import { JsonStore } from "./json-store";

const execFileAsync = promisify(execFile);
const MAX_MEMORY_FILE_SIZE = 5 * 1024 * 1024;

interface MemoryMetadataState {
  workspaces: Record<string, Omit<MemorySettings, "workspaceIdentity" | "indexStatus">>;
}

export interface MemoryServiceOptions {
  grokHome?: string;
  runCli?: (cliPath: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) => Promise<void>;
}

export class MemoryService {
  private readonly grokHome: string;
  private readonly store: JsonStore<MemoryMetadataState>;
  private readonly editor = new EditorService({ editableLimit: MAX_MEMORY_FILE_SIZE, readableLimit: MAX_MEMORY_FILE_SIZE });
  private readonly runCli: NonNullable<MemoryServiceOptions["runCli"]>;

  constructor(userDataPath: string, private readonly getSettings: () => Promise<AppSettings>, options: MemoryServiceOptions = {}) {
    this.grokHome = resolve(options.grokHome ?? process.env.GROK_HOME ?? join(homedir(), ".grok"));
    this.store = new JsonStore(join(userDataPath, "memory-settings.json"), { workspaces: {} });
    this.runCli = options.runCli ?? runCli;
  }

  async resolveLayout(workspacePath: string): Promise<MemoryLayout> {
    const workspace = await realpath(workspacePath);
    if (!(await stat(workspace)).isDirectory()) throw new Error("工作区路径无效");
    const identity = await repositoryIdentity(workspace) ?? workspace;
    const slugSource = identity.includes("/") && !isAbsoluteLike(identity) ? identity.split("/").at(-1)! : basename(workspace);
    const workspaceKey = `${slugify(slugSource, 40) || "workspace"}-${bytesToHex(blake3(new TextEncoder().encode(identity))).slice(0, 8)}`;
    const memoryRoot = join(this.grokHome, "memory");
    const workspaceDirectory = join(memoryRoot, workspaceKey);
    return { grokHome: this.grokHome, memoryRoot, workspaceIdentity: identity, workspaceKey, globalFile: join(memoryRoot, "MEMORY.md"), workspaceDirectory, workspaceFile: join(workspaceDirectory, "MEMORY.md"), sessionsDirectory: join(workspaceDirectory, "sessions") };
  }

  async getSettingsForWorkspace(workspacePath: string): Promise<MemorySettings> {
    const layout = await this.resolveLayout(workspacePath);
    const state = await this.store.get();
    const value = state.workspaces[layout.workspaceIdentity] ?? { enabled: false, saveOnSessionEnd: true, autoDream: true };
    const indexExists = await stat(join(layout.workspaceDirectory, "index.sqlite")).then((info) => info.isFile()).catch(() => false);
    return { workspaceIdentity: layout.workspaceIdentity, ...value, indexStatus: value.enabled ? indexExists ? "ready" : "unknown" : "disabled" };
  }

  async updateSettings(workspacePath: string, patch: Partial<Pick<MemorySettings, "enabled" | "saveOnSessionEnd" | "autoDream">>): Promise<MemorySettings> {
    const layout = await this.resolveLayout(workspacePath);
    const current = await this.getSettingsForWorkspace(workspacePath);
    const state = await this.store.get();
    state.workspaces[layout.workspaceIdentity] = {
      enabled: patch.enabled ?? current.enabled,
      saveOnSessionEnd: patch.saveOnSessionEnd ?? current.saveOnSessionEnd,
      autoDream: patch.autoDream ?? current.autoDream,
      lastFlushAt: current.lastFlushAt,
      lastDreamAt: current.lastDreamAt,
      dreamStatus: current.dreamStatus,
    };
    await this.store.set(state);
    return this.getSettingsForWorkspace(workspacePath);
  }

  async sessionEnvironment(workspacePath: string): Promise<Record<string, string>> {
    const settings = await this.getSettingsForWorkspace(workspacePath);
    return { GROK_MEMORY: settings.enabled ? "1" : "0", GROK_MEMORY_LOG: "0" };
  }

  async list(workspacePath: string, query = ""): Promise<MemoryEntry[]> {
    const layout = await this.resolveLayout(workspacePath);
    await mkdir(layout.memoryRoot, { recursive: true });
    const canonicalRoot = await realpath(layout.memoryRoot);
    const entries: MemoryEntry[] = [];
    entries.push(await readMemoryEntry(canonicalRoot, layout.globalFile, { id: "global", scope: "global", title: "全局 MEMORY.md", workspaceIdentity: layout.workspaceIdentity, readOnly: false }, true));
    entries.push(await readMemoryEntry(canonicalRoot, layout.workspaceFile, { id: "workspace", scope: "workspace", title: "工作区 MEMORY.md", workspaceIdentity: layout.workspaceIdentity, readOnly: false }, true));
    const sessions = await readdir(layout.sessionsDirectory, { withFileTypes: true }).catch(() => []);
    for (const item of sessions) {
      if (!item.isFile() || item.isSymbolicLink() || !item.name.toLowerCase().endsWith(".md")) continue;
      const path = join(layout.sessionsDirectory, item.name);
      entries.push(await readMemoryEntry(canonicalRoot, path, { id: `session:${item.name}`, scope: "session", title: item.name.replace(/\.md$/i, ""), workspaceIdentity: layout.workspaceIdentity, sessionId: sessionIdFromName(item.name), readOnly: true }, false));
    }
    const normalized = query.trim().toLocaleLowerCase();
    return (normalized ? entries.filter((entry) => `${entry.title}\n${entry.content}`.toLocaleLowerCase().includes(normalized)) : entries).sort((left, right) => left.scope === right.scope ? (right.modifiedAt ?? "").localeCompare(left.modifiedAt ?? "") : scopeOrder(left.scope) - scopeOrder(right.scope));
  }

  async save(input: MemorySaveInput): Promise<MemorySaveResult> {
    const layout = await this.resolveLayout(input.workspacePath);
    const target = input.scope === "global" ? layout.globalFile : layout.workspaceFile;
    await mkdir(resolve(target, ".."), { recursive: true });
    const exists = await lstat(target).then((value) => value.isFile() && !value.isSymbolicLink()).catch(() => false);
    if (!exists) {
      if (input.expectedHash || input.expectedModifiedAt) return { saved: false, conflict: { kind: "deleted", path: target, expectedHash: input.expectedHash, expectedModifiedAt: input.expectedModifiedAt } };
      try {
        await this.editor.createFile(layout.memoryRoot, relative(layout.memoryRoot, target), input.content);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const disk = await readMemoryEntry(await realpath(layout.memoryRoot), target, { id: input.scope, scope: input.scope, title: "MEMORY.md", readOnly: false }, false);
        return { saved: false, conflict: { kind: "modified", path: target, expectedHash: "", actualHash: disk.hash, expectedModifiedAt: "", actualModifiedAt: disk.modifiedAt, diskContent: disk.content, diskEncoding: "utf8", diskLineEnding: "lf" } };
      }
    } else {
      const result = await this.editor.save({ workspacePath: layout.memoryRoot, path: target, content: input.content, encoding: "utf8", lineEnding: detectLineEnding(input.content), expectedHash: input.expectedHash, expectedModifiedAt: input.expectedModifiedAt, overwrite: input.overwrite });
      if (!result.saved) return result;
    }
    const entries = await this.list(input.workspacePath);
    return { saved: true, entry: entries.find((entry) => entry.id === input.scope) };
  }

  async previewRemember(workspacePath: string, scope: "global" | "workspace", text: string): Promise<MemoryRememberPreview> {
    const note = text.trim();
    if (!note || note.includes("\0")) throw new Error("记忆内容不能为空");
    if (Buffer.byteLength(note, "utf8") > 20 * 1024) throw new Error("单条记忆内容过长");
    const layout = await this.resolveLayout(workspacePath);
    const entry = (await this.list(workspacePath)).find((value) => value.id === scope)!;
    const targetPath = scope === "global" ? layout.globalFile : layout.workspaceFile;
    const confirmationToken = createHash("sha256").update(JSON.stringify({ scope, note, targetPath, hash: entry.hash ?? "", modifiedAt: entry.modifiedAt ?? "" })).digest("hex");
    return { workspacePath, scope, text: note, targetPath, confirmationToken };
  }

  async remember(preview: MemoryRememberPreview, confirmationToken: string, confirmed: boolean): Promise<MemoryEntry> {
    await this.confirmRememberPreview(preview, confirmationToken, confirmed);
    const entry = (await this.list(preview.workspacePath)).find((value) => value.id === preview.scope)!;
    const prefix = entry.content.trimEnd();
    const heading = /(?:^|\n)## Notes\s*(?:\n|$)/i.test(prefix) ? "" : `${prefix ? "\n\n" : ""}## Notes\n`;
    const line = `\n- ${preview.text.replace(/\r?\n/g, "\n  ")}\n`;
    const saved = await this.save({ workspacePath: preview.workspacePath, scope: preview.scope, content: `${prefix}${heading}${line}`, expectedHash: entry.hash ?? "", expectedModifiedAt: entry.modifiedAt ?? "" });
    if (!saved.saved || !saved.entry) throw new Error("Memory 保存发生冲突，请重新预览");
    return saved.entry;
  }

  async confirmRememberPreview(preview: MemoryRememberPreview, confirmationToken: string, confirmed: boolean): Promise<void> {
    if (!confirmed || confirmationToken !== preview.confirmationToken) throw new Error("保存记忆前需要确认当前预览");
    const current = await this.previewRemember(preview.workspacePath, preview.scope, preview.text);
    if (current.confirmationToken !== confirmationToken) throw new Error("Memory 已变化，请重新预览");
  }

  async listStructured(workspacePath: string, scope?: "global" | "workspace"): Promise<MemoryStructuredEntry[]> {
    const entries = (await this.list(workspacePath)).filter((value) => value.scope !== "session" && (!scope || value.scope === scope));
    return entries.flatMap((entry) => parseStructuredEntries(entry.scope as "global" | "workspace", entry.content));
  }

  async previewDelete(workspacePath: string, entryId: string): Promise<MemoryDeletePreview> {
    const layout = await this.resolveLayout(workspacePath);
    const files = await this.list(workspacePath);
    for (const file of files) {
      if (file.scope === "session") continue;
      const parsed = parseStructuredEntriesWithOffsets(file.scope, file.content).find((value) => value.entry.id === entryId);
      if (!parsed) continue;
      const targetPath = file.scope === "global" ? layout.globalFile : layout.workspaceFile;
      const confirmationToken = createHash("sha256").update(JSON.stringify({ entry: parsed.entry, targetPath, fileHash: file.hash ?? "", modifiedAt: file.modifiedAt ?? "" })).digest("hex");
      return { workspacePath, entry: parsed.entry, targetPath, confirmationToken };
    }
    throw new Error("Memory 条目已不存在，请刷新后重试");
  }

  async deleteStructured(preview: MemoryDeletePreview, confirmationToken: string, confirmed: boolean): Promise<MemoryEntry> {
    if (!confirmed || confirmationToken !== preview.confirmationToken) throw new Error("删除 Memory 条目前需要确认当前预览");
    const currentPreview = await this.previewDelete(preview.workspacePath, preview.entry.id).catch(() => { throw new Error("Memory 已变化，请重新预览删除"); });
    if (currentPreview.confirmationToken !== confirmationToken) throw new Error("Memory 已变化，请重新预览删除");
    const file = (await this.list(preview.workspacePath)).find((value) => value.scope === preview.entry.scope)!;
    const parsed = parseStructuredEntriesWithOffsets(preview.entry.scope, file.content).find((value) => value.entry.id === preview.entry.id);
    if (!parsed || parsed.entry.hash !== preview.entry.hash) throw new Error("Memory 条目已变化，请重新预览删除");
    const result = await this.save({ workspacePath: preview.workspacePath, scope: preview.entry.scope, content: file.content.slice(0, parsed.startOffset) + file.content.slice(parsed.endOffset), expectedHash: file.hash ?? "", expectedModifiedAt: file.modifiedAt ?? "" });
    if (!result.saved || !result.entry) throw new Error("Memory 保存发生冲突，请重新预览删除");
    return result.entry;
  }

  async deleteSession(workspacePath: string, entryId: string, confirmed: boolean): Promise<void> {
    if (!confirmed || !entryId.startsWith("session:")) throw new Error("删除会话 Memory 前需要明确确认");
    const entry = (await this.list(workspacePath)).find((value) => value.id === entryId && value.scope === "session");
    if (!entry?.path) throw new Error("找不到会话 Memory 文件");
    const layout = await this.resolveLayout(workspacePath);
    await this.editor.delete(layout.memoryRoot, entry.path, true);
  }

  async clear(workspacePath: string, scope: "workspace" | "global" | "all", confirmed: boolean): Promise<MemoryEntry[]> {
    if (!confirmed) throw new Error("清空 Memory 前需要明确确认");
    const settings = await this.getSettings();
    const cliPath = await locateGrokCli(settings.cliPath);
    if (!cliPath) throw new Error("未找到 Grok CLI");
    await this.runCli(cliPath, ["memory", "clear", `--${scope}`, "--yes"], workspacePath, { ...process.env, GROK_HOME: this.grokHome, GROK_MEMORY_LOG: "0" });
    return this.list(workspacePath);
  }

  async markCommand(workspacePath: string, command: "flush" | "dream", status: "running" | "completed" | "failed"): Promise<MemorySettings> {
    const current = await this.getSettingsForWorkspace(workspacePath);
    const patch: Partial<MemorySettings> = command === "flush" ? status === "completed" ? { lastFlushAt: new Date().toISOString() } : {} : { dreamStatus: status, ...(status === "completed" ? { lastDreamAt: new Date().toISOString() } : {}) };
    const state = await this.store.get();
    state.workspaces[current.workspaceIdentity] = { enabled: current.enabled, saveOnSessionEnd: current.saveOnSessionEnd, autoDream: current.autoDream, lastFlushAt: patch.lastFlushAt ?? current.lastFlushAt, lastDreamAt: patch.lastDreamAt ?? current.lastDreamAt, dreamStatus: patch.dreamStatus ?? current.dreamStatus };
    await this.store.set(state);
    return this.getSettingsForWorkspace(workspacePath);
  }
}

async function readMemoryEntry(root: string, path: string, base: Omit<MemoryEntry, "content" | "path" | "hash" | "modifiedAt">, allowMissing: boolean): Promise<MemoryEntry> {
  const info = await lstat(path).catch(() => undefined);
  if (!info) { if (!allowMissing) throw new Error("Memory 文件不存在"); return { ...base, content: "", path, hash: "", modifiedAt: "" }; }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Memory 路径不是普通文件");
  const canonical = await realpath(path);
  if (!isInside(root, canonical)) throw new Error("Memory 文件超出 GROK_HOME/memory");
  if (info.size > MAX_MEMORY_FILE_SIZE) throw new Error("Memory 文件超过 5 MiB 管理上限");
  const bytes = await readFile(canonical);
  const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const heading = content.match(/^#(?:#)?\s+(.+)$/m)?.[1]?.trim();
  return { ...base, title: heading || base.title, content, path: canonical, hash: createHash("sha256").update(bytes).digest("hex"), modifiedAt: info.mtime.toISOString() };
}

async function repositoryIdentity(workspace: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", workspace, "remote", "get-url", "origin"], { windowsHide: true, shell: false, encoding: "utf8", maxBuffer: 1024 * 1024 });
    return normalizeRemoteIdentity(stdout.trim());
  } catch { return undefined; }
}

function normalizeRemoteIdentity(url: string): string | undefined {
  const colon = url.indexOf(":");
  let path: string | undefined;
  if (colon >= 0 && url.slice(0, colon).includes("@") && !url.slice(0, colon).includes("/")) path = url.slice(colon + 1);
  else if (colon >= 0) { const afterScheme = url.split("//")[1]; path = afterScheme?.split("/").slice(1).join("/"); }
  if (!path) return undefined;
  const cleaned = path.replace(/\.git$/, "").replace(/\/$/, "").replace(/^\//, "");
  return cleaned.includes("/") ? cleaned : undefined;
}

function slugify(input: string, maxLength: number): string {
  return [...input.toLowerCase()].map((character) => /[a-z0-9]/.test(character) ? character : "-").join("").replace(/-+/g, "-").slice(0, maxLength).replace(/^-|-$/g, "");
}

function isInside(root: string, path: string): boolean { const value = relative(root, path); return value === "" || (value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value)); }
function isAbsoluteLike(value: string): boolean { return /^[a-zA-Z]:[\\/]|^[/\\]/.test(value); }
function sessionIdFromName(name: string): string | undefined { return name.match(/-([a-zA-Z0-9]{8})\.md$/)?.[1]; }
function scopeOrder(scope: MemoryEntry["scope"]): number { return scope === "global" ? 0 : scope === "workspace" ? 1 : 2; }
function detectLineEnding(content: string): "lf" | "crlf" | "mixed" | "none" { const crlf = (content.match(/\r\n/g) ?? []).length; const lf = (content.match(/(?<!\r)\n/g) ?? []).length; return crlf && lf ? "mixed" : crlf ? "crlf" : lf ? "lf" : "none"; }

interface ParsedStructuredEntry { entry: MemoryStructuredEntry; startOffset: number; endOffset: number }

function parseStructuredEntries(scope: "global" | "workspace", content: string): MemoryStructuredEntry[] {
  return parseStructuredEntriesWithOffsets(scope, content).map((value) => value.entry);
}

function parseStructuredEntriesWithOffsets(scope: "global" | "workspace", content: string): ParsedStructuredEntry[] {
  const lines: Array<{ raw: string; text: string; start: number; end: number }> = [];
  const matcher = /.*(?:\r\n|\n|$)/g;
  for (let match = matcher.exec(content); match && match[0]; match = matcher.exec(content)) lines.push({ raw: match[0], text: match[0].replace(/\r?\n$/, ""), start: match.index, end: match.index + match[0].length });
  const result: ParsedStructuredEntry[] = [];
  let heading = scope === "global" ? "全局" : "工作区";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const headingMatch = line.text.match(/^#{1,6}\s+(.+?)\s*$/);
    if (headingMatch) { heading = headingMatch[1]!; continue; }
    const item = line.text.match(/^( {0,3})[-*+]\s+(.+)$/);
    if (!item) continue;
    let end = index + 1;
    while (end < lines.length) {
      if (/^#{1,6}\s+/.test(lines[end]!.text) || /^( {0,3})[-*+]\s+/.test(lines[end]!.text)) break;
      end += 1;
    }
    const raw = content.slice(line.start, lines[end - 1]!.end);
    const text = [item[2]!, ...lines.slice(index + 1, end).map((value) => value.text.replace(/^ {2,4}/, ""))].join("\n").trimEnd();
    const hash = createHash("sha256").update(raw).digest("hex");
    const id = `${scope}:${index + 1}:${hash.slice(0, 16)}`;
    result.push({ entry: { id, scope, heading, text, lineStart: index + 1, lineEnd: end, hash }, startOffset: line.start, endOffset: lines[end - 1]!.end });
    index = end - 1;
  }
  return result;
}

async function runCli(cliPath: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  await execFileAsync(cliPath, args, { cwd, env, windowsHide: true, shell: false, encoding: "utf8", maxBuffer: 5 * 1024 * 1024 });
}

export const memoryInternals = { normalizeRemoteIdentity, slugify, parseStructuredEntries };
