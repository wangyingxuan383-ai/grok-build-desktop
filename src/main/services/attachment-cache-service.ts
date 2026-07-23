import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { Attachment, UserMessageAttachmentPreview, UserMessageAttachmentRestore, UserMessageDeliveryState } from "../../shared/types";
import { JsonStore } from "./json-store";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_CACHE_BYTES = 512 * 1024 * 1024;
const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60_000;

interface AttachmentLedgerEntry extends UserMessageAttachmentRestore {
  createdAt: string;
}

interface AttachmentLedger {
  sessions: Record<string, AttachmentLedgerEntry[]>;
}

export interface PreparedAttachments {
  attachments: Attachment[];
  previews: UserMessageAttachmentPreview[];
}

export class AttachmentCacheService {
  private readonly root: string;
  private readonly ledger: JsonStore<AttachmentLedger>;

  constructor(userDataPath: string) {
    this.root = join(userDataPath, "session-attachments");
    this.ledger = new JsonStore(join(userDataPath, "attachment-ledger.json"), { sessions: {} });
  }

  async prepare(sessionId: string, attachments: Attachment[]): Promise<PreparedAttachments> {
    const prepared: Attachment[] = [];
    for (const attachment of attachments) prepared.push(await this.materialize(sessionId, attachment));
    return { attachments: prepared, previews: await Promise.all(prepared.map((attachment) => this.preview(attachment))) };
  }

  async record(sessionId: string, clientMessageId: string, text: string, previews: UserMessageAttachmentPreview[], delivery: UserMessageDeliveryState): Promise<void> {
    if (!previews.length) return;
    const ledger = await this.ledger.get();
    const entries = ledger.sessions[sessionId] ?? [];
    const value: AttachmentLedgerEntry = { clientMessageId, text, attachments: previews, delivery, createdAt: new Date().toISOString() };
    const index = entries.findIndex((entry) => entry.clientMessageId === clientMessageId);
    if (index >= 0) entries[index] = value; else entries.push(value);
    ledger.sessions[sessionId] = entries.slice(-500);
    await this.ledger.set(ledger);
  }

  async updateDelivery(sessionId: string, clientMessageId: string, delivery: UserMessageDeliveryState): Promise<void> {
    const ledger = await this.ledger.get();
    const entry = ledger.sessions[sessionId]?.find((value) => value.clientMessageId === clientMessageId);
    if (!entry || entry.delivery === delivery) return;
    entry.delivery = delivery;
    await this.ledger.set(ledger);
  }

  async restore(sessionId: string): Promise<UserMessageAttachmentRestore[]> {
    const ledger = await this.ledger.get();
    const entries = ledger.sessions[sessionId] ?? [];
    return Promise.all(entries.map(async (entry) => ({
      clientMessageId: entry.clientMessageId,
      text: entry.text,
      delivery: entry.delivery === "sending" ? "sent" : entry.delivery,
      attachments: await Promise.all(entry.attachments.map(async (preview) => ({ ...preview, availability: preview.source && !preview.isData && !(await exists(preview.source)) ? "missing" as const : "ready" as const }))),
    })));
  }

  async cleanupSession(sessionId: string): Promise<void> {
    await rm(this.sessionRoot(sessionId), { recursive: true, force: true });
    const ledger = await this.ledger.get();
    if (!(sessionId in ledger.sessions)) return;
    delete ledger.sessions[sessionId];
    await this.ledger.set(ledger);
  }

  async sweep(existingSessionIds?: Set<string>, now = Date.now()): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const ledger = await this.ledger.get();
    let ledgerChanged = false;
    for (const [sessionId, entries] of Object.entries(ledger.sessions)) {
      const newest = Math.max(0, ...entries.map((entry) => Date.parse(entry.createdAt) || 0));
      if ((existingSessionIds && !existingSessionIds.has(sessionId)) || (newest && now - newest > MAX_CACHE_AGE_MS)) {
        await rm(this.sessionRoot(sessionId), { recursive: true, force: true });
        delete ledger.sessions[sessionId];
        ledgerChanged = true;
      }
    }
    const files = await collectFiles(this.root);
    let total = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (total <= MAX_CACHE_BYTES) break;
      await rm(file.path, { force: true });
      total -= file.size;
    }
    if (ledgerChanged) await this.ledger.set(ledger);
  }

  private async materialize(sessionId: string, attachment: Attachment): Promise<Attachment> {
    if (!attachment.data) {
      if (attachment.kind !== "image" || !attachment.path) return attachment;
      const info = await stat(attachment.path);
      if (info.size > MAX_IMAGE_BYTES) throw new Error(`${attachment.name || "图片"} 超过 20 MiB 图片限制`);
      const buffer = await readFile(attachment.path);
      const mimeType = detectImageMime(buffer);
      if (!mimeType) throw new Error(`${attachment.name || "图片"} 不是受支持的 PNG、JPEG、WebP 或 GIF 图片`);
      if (attachment.mimeType?.startsWith("image/") && normalizeMime(attachment.mimeType) !== mimeType) throw new Error(`${attachment.name || "图片"} 的图片类型与内容不一致`);
      return { ...attachment, mimeType, size: info.size };
    }
    if (attachment.kind !== "image") throw new Error("只有图片附件可以使用内嵌数据");
    const buffer = decodeBase64(attachment.data);
    if (buffer.length > MAX_IMAGE_BYTES) throw new Error(`${attachment.name || "粘贴的图片"} 超过 20 MiB 图片限制`);
    const mimeType = detectImageMime(buffer);
    if (!mimeType) throw new Error(`${attachment.name || "粘贴的图片"} 不是受支持的 PNG、JPEG、WebP 或 GIF 图片`);
    if (attachment.mimeType?.startsWith("image/") && normalizeMime(attachment.mimeType) !== mimeType) throw new Error(`${attachment.name || "粘贴的图片"} 的图片类型与内容不一致`);
    const extension = extensionForMime(mimeType);
    const directory = this.sessionRoot(sessionId);
    await mkdir(directory, { recursive: true });
    const stem = createHash("sha256").update(attachment.id).digest("hex").slice(0, 24);
    const target = join(directory, `${stem}${extension}`);
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, buffer, { flag: "wx" });
    await rename(temporary, target).catch(async (error) => {
      await rm(temporary, { force: true });
      if (!(await exists(target))) throw error;
    });
    return { ...attachment, data: undefined, path: target, mimeType, size: buffer.length };
  }

  private async preview(attachment: Attachment): Promise<UserMessageAttachmentPreview> {
    const source = attachment.path || attachment.data;
    return {
      id: attachment.id,
      name: attachment.name,
      kind: attachment.kind,
      mimeType: attachment.mimeType,
      size: attachment.size,
      source,
      isData: Boolean(attachment.data && !attachment.path),
      availability: source && !attachment.data && !(await exists(source)) ? "missing" : "ready",
    };
  }

  private sessionRoot(sessionId: string): string {
    return join(this.root, createHash("sha256").update(sessionId).digest("hex").slice(0, 32));
  }
}

export function detectImageMime(buffer: Buffer): string | undefined {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))) return "image/gif";
  return undefined;
}

function decodeBase64(value: string): Buffer {
  const normalized = value.replace(/\s+/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1) throw new Error("图片数据不是有效的 Base64");
  return Buffer.from(normalized, "base64");
}

function normalizeMime(value: string): string {
  const mime = value.toLowerCase().split(";", 1)[0];
  return mime === "image/jpg" ? "image/jpeg" : mime || "image/png";
}

function extensionForMime(mimeType: string): string {
  return mimeType === "image/jpeg" ? ".jpg" : mimeType === "image/webp" ? ".webp" : mimeType === "image/gif" ? ".gif" : ".png";
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then((value) => value.isFile() || value.isDirectory()).catch(() => false);
}

async function collectFiles(root: string): Promise<Array<{ path: string; size: number; mtimeMs: number }>> {
  const output: Array<{ path: string; size: number; mtimeMs: number }> = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const info = await stat(path).catch(() => undefined);
        if (info) output.push({ path, size: info.size, mtimeMs: info.mtimeMs });
      }
    }
  };
  await visit(root);
  return output;
}

export function inferredMimeFromName(name: string): string | undefined {
  const extension = extname(name).toLowerCase();
  return extension === ".png" ? "image/png" : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".webp" ? "image/webp" : extension === ".gif" ? "image/gif" : undefined;
}
