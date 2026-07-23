import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, extname } from "node:path";
import iconv from "iconv-lite";
import type { EditorDocument, EditorEncoding, EditorLineEnding, EditorOpenResult, EditorSaveConflict, EditorSaveInput, EditorSaveResult } from "../../shared/types";
import { rejectSymbolicLink, resolveExistingWorkspacePath, resolveNewWorkspacePath } from "./workspace-path-policy";

const DEFAULT_EDITABLE_LIMIT = 5 * 1024 * 1024;
const DEFAULT_READABLE_LIMIT = 20 * 1024 * 1024;
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export class EditorService {
  private readonly editableLimit: number;
  private readonly readableLimit: number;

  constructor(limits: { editableLimit?: number; readableLimit?: number } = {}) {
    this.editableLimit = limits.editableLimit ?? DEFAULT_EDITABLE_LIMIT;
    this.readableLimit = limits.readableLimit ?? DEFAULT_READABLE_LIMIT;
    if (this.editableLimit <= 0 || this.readableLimit < this.editableLimit) throw new Error("编辑器文件大小门槛无效");
  }

  async open(workspacePath: string, requestedPath: string): Promise<EditorOpenResult> {
    const resolved = await resolveExistingWorkspacePath(workspacePath, requestedPath, false);
    await rejectSymbolicLink(resolved.path);
    const info = await stat(resolved.path);
    if (!info.isFile()) throw new Error("请求的路径不是文件");
    if (info.size > this.readableLimit) return {
      kind: "external",
      path: resolved.path,
      relativePath: resolved.relativePath,
      byteLength: info.size,
      reason: "文件大于 20 MiB，请使用外部应用打开",
    };
    const document = await readDocument(resolved.root, resolved.path, resolved.relativePath, this.editableLimit);
    return { kind: "document", document, path: resolved.path, relativePath: resolved.relativePath, byteLength: document.byteLength };
  }

  async save(input: EditorSaveInput): Promise<EditorSaveResult> {
    const resolved = await resolveExistingOrDeletedPath(input.workspacePath, input.path);
    const current = await currentFileState(resolved.path, this.readableLimit);
    const conflict = buildConflict(input, current);
    if (conflict && !input.overwrite) return { saved: false, conflict };
    if (current.kind === "type-changed") throw new Error("目标路径不再是普通文件");
    const content = normalizeLineEndings(input.content, input.lineEnding);
    const bytes = encode(content, input.encoding);
    if (bytes.length > this.editableLimit) throw new Error("保存内容超过 5 MiB 编辑上限");
    await atomicReplace(resolved.path, bytes, current.mode);
    const document = await readDocument(resolved.root, resolved.path, resolved.relativePath, this.editableLimit);
    return { saved: true, document };
  }

  async createFile(workspacePath: string, requestedPath: string, content = ""): Promise<EditorDocument> {
    const resolved = await resolveNewWorkspacePath(workspacePath, requestedPath);
    const handle = await open(resolved.path, "wx");
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    return readDocument(resolved.root, resolved.path, resolved.relativePath, this.editableLimit);
  }

  async createDirectory(workspacePath: string, requestedPath: string): Promise<void> {
    const resolved = await resolveNewWorkspacePath(workspacePath, requestedPath);
    await mkdir(resolved.path, { recursive: false });
  }

  async rename(workspacePath: string, requestedPath: string, targetPath: string): Promise<string> {
    const source = await resolveExistingWorkspacePath(workspacePath, requestedPath, false);
    await rejectSymbolicLink(source.path);
    const target = await resolveNewWorkspacePath(source.root, targetPath);
    if (await lstat(target.path).then(() => true).catch(() => false)) throw new Error("目标路径已存在");
    await rename(source.path, target.path);
    return target.path;
  }

  async delete(workspacePath: string, requestedPath: string, confirmed: boolean): Promise<void> {
    if (!confirmed) throw new Error("删除操作需要明确确认");
    const resolved = await resolveExistingWorkspacePath(workspacePath, requestedPath, false);
    await rejectSymbolicLink(resolved.path);
    const info = await lstat(resolved.path);
    await rm(resolved.path, { recursive: info.isDirectory(), force: false });
  }
}

interface CurrentFileState {
  kind: "file" | "deleted" | "type-changed";
  hash?: string;
  modifiedAt?: string;
  content?: string;
  encoding?: EditorEncoding;
  lineEnding?: EditorLineEnding;
  mode?: number;
}

async function resolveExistingOrDeletedPath(workspacePath: string, requestedPath: string) {
  try {
    return await resolveExistingWorkspacePath(workspacePath, requestedPath, false);
  } catch (error) {
    if (error instanceof Error && error.message === "文件或目录不存在") return resolveNewWorkspacePath(workspacePath, requestedPath);
    throw error;
  }
}

async function currentFileState(path: string, readableLimit: number): Promise<CurrentFileState> {
  const info = await lstat(path).catch(() => undefined);
  if (!info) return { kind: "deleted" };
  if (!info.isFile() || info.isSymbolicLink()) return { kind: "type-changed", modifiedAt: info.mtime.toISOString(), mode: info.mode };
  const bytes = await readFile(path);
  const decoded = bytes.length <= readableLimit ? decode(bytes) : undefined;
  return {
    kind: "file",
    hash: hash(bytes),
    modifiedAt: info.mtime.toISOString(),
    content: decoded?.content,
    encoding: decoded?.encoding,
    lineEnding: decoded ? detectLineEnding(decoded.content) : undefined,
    mode: info.mode,
  };
}

function buildConflict(input: EditorSaveInput, current: CurrentFileState): EditorSaveConflict | undefined {
  if (current.kind === "deleted") return {
    kind: "deleted",
    path: input.path,
    expectedHash: input.expectedHash,
    expectedModifiedAt: input.expectedModifiedAt,
  };
  if (current.kind === "type-changed") return {
    kind: "type-changed",
    path: input.path,
    expectedHash: input.expectedHash,
    expectedModifiedAt: input.expectedModifiedAt,
    actualModifiedAt: current.modifiedAt,
  };
  if (current.hash !== input.expectedHash || current.modifiedAt !== input.expectedModifiedAt) return {
    kind: "modified",
    path: input.path,
    expectedHash: input.expectedHash,
    actualHash: current.hash,
    expectedModifiedAt: input.expectedModifiedAt,
    actualModifiedAt: current.modifiedAt,
    diskContent: current.content,
    diskEncoding: current.encoding,
    diskLineEnding: current.lineEnding,
  };
  return undefined;
}

async function readDocument(root: string, path: string, relativePath: string, editableLimit: number): Promise<EditorDocument> {
  const [bytes, info] = await Promise.all([readFile(path), stat(path)]);
  if (bytes.includes(0)) throw new Error("二进制文件不能在轻量编辑器中打开");
  const decoded = decode(bytes);
  return {
    workspacePath: root,
    path,
    relativePath,
    content: decoded.content,
    encoding: decoded.encoding,
    lineEnding: detectLineEnding(decoded.content),
    byteLength: bytes.length,
    editable: bytes.length <= editableLimit,
    ...(bytes.length > editableLimit ? { readOnlyReason: "文件大于 5 MiB，仅可只读查看" } : {}),
    hash: hash(bytes),
    modifiedAt: info.mtime.toISOString(),
    languageId: languageForPath(path),
  };
}

function decode(bytes: Buffer): { content: string; encoding: EditorEncoding } {
  if (bytes.subarray(0, 3).equals(UTF8_BOM)) return { content: bytes.subarray(3).toString("utf8"), encoding: "utf8-bom" };
  try {
    return { content: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf8" };
  } catch {
    return { content: iconv.decode(bytes, "gb18030"), encoding: "gb18030" };
  }
}

function encode(content: string, encoding: EditorEncoding): Buffer {
  if (encoding === "utf8") return Buffer.from(content, "utf8");
  if (encoding === "utf8-bom") return Buffer.concat([UTF8_BOM, Buffer.from(content, "utf8")]);
  return iconv.encode(content, "gb18030");
}

function detectLineEnding(content: string): EditorLineEnding {
  const crlf = (content.match(/\r\n/g) ?? []).length;
  const lf = (content.match(/(?<!\r)\n/g) ?? []).length;
  if (crlf && lf) return "mixed";
  if (crlf) return "crlf";
  if (lf) return "lf";
  return "none";
}

function normalizeLineEndings(content: string, lineEnding: EditorLineEnding): string {
  if (lineEnding === "mixed" || lineEnding === "none") return content;
  const normalized = content.replace(/\r\n|\r/g, "\n");
  return lineEnding === "crlf" ? normalized.replace(/\n/g, "\r\n") : normalized;
}

async function atomicReplace(path: string, bytes: Buffer, mode?: number): Promise<void> {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const backup = `${path}.${process.pid}.${randomUUID()}.bak`;
  let backedUp = false;
  try {
    const handle = await open(temp, "wx", mode);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (mode !== undefined) await chmod(temp, mode).catch(() => undefined);
    try {
      await rename(temp, path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!await lstat(path).then(() => true).catch(() => false) || !["EEXIST", "EPERM", "EACCES"].includes(code ?? "")) throw error;
      await rename(path, backup);
      backedUp = true;
      try {
        await rename(temp, path);
      } catch (replacementError) {
        await rename(backup, path).catch(() => undefined);
        backedUp = false;
        throw replacementError;
      }
    }
    if (backedUp) await rm(backup, { force: true });
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    if (backedUp) await rename(backup, path).catch(() => undefined);
    throw error;
  }
}

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function languageForPath(path: string): string {
  return ({
    ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".ts": "typescript", ".tsx": "typescript", ".json": "json", ".md": "markdown",
    ".css": "css", ".scss": "scss", ".html": "html", ".xml": "xml", ".yaml": "yaml", ".yml": "yaml",
    ".py": "python", ".rs": "rust", ".go": "go", ".java": "java", ".cs": "csharp",
    ".ps1": "powershell", ".sh": "shell", ".toml": "toml", ".sql": "sql",
  } as Record<string, string>)[extname(path).toLowerCase()] ?? "plaintext";
}
