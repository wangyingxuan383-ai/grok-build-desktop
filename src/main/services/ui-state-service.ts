import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { Attachment, ComposerCapabilitySelection, ComposerDraftState } from "../../shared/types";
import { JsonStore } from "./json-store";

const MAX_TEXT_DRAFT_BYTES = 5 * 1024 * 1024;

interface UiStateData {
  drafts: Record<string, ComposerDraftState>;
  promptHistory: Record<string, string[]>;
}

export class UiStateService {
  private readonly store: JsonStore<UiStateData>;
  private readonly draftAttachmentRoot: string;

  constructor(userDataPath: string) {
    this.store = new JsonStore(join(userDataPath, "ui-state.json"), { drafts: {}, promptHistory: {} });
    this.draftAttachmentRoot = join(userDataPath, "composer-drafts");
  }

  async getDraft(key: string): Promise<ComposerDraftState | null> {
    return (await this.store.get()).drafts[normalizeKey(key)] ?? null;
  }

  async setDraft(key: string, text: string, capability?: ComposerCapabilitySelection, attachments: Attachment[] = []): Promise<void> {
    const normalized = normalizeKey(key);
    const persistedAttachments = attachments.filter((attachment) => attachment.draftText && attachment.path && this.isDraftPathForKey(key, attachment.path));
    await this.store.mutate((data) => {
      if (!text && !capability && !persistedAttachments.length) delete data.drafts[normalized];
      else data.drafts[normalized] = { key, text, capability, attachments: persistedAttachments, updatedAt: new Date().toISOString() };
    });
    await this.cleanupDraftDirectory(key, new Set(persistedAttachments.flatMap((attachment) => attachment.path ? [resolve(attachment.path)] : [])));
  }

  async clearDraft(key: string): Promise<void> {
    await this.store.mutate((data) => { delete data.drafts[normalizeKey(key)]; });
    await rm(this.draftDirectory(key), { recursive: true, force: true });
  }

  async createTextDraftAttachment(key: string, text: string): Promise<Attachment> {
    const buffer = Buffer.from(text, "utf8");
    if (!buffer.length) throw new Error("文本附件不能为空");
    if (buffer.length > MAX_TEXT_DRAFT_BYTES) throw new Error("文本附件超过 5 MiB 限制");
    const directory = this.draftDirectory(key);
    await mkdir(directory, { recursive: true });
    const id = randomUUID();
    const target = join(directory, `${id}.txt`);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, buffer, { flag: "wx" });
    await rename(temporary, target);
    const previewText = text.replace(/\s+/g, " ").trim().slice(0, 160);
    return {
      id,
      name: `pasted-text-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`,
      kind: "file",
      mimeType: "text/plain; charset=utf-8",
      size: buffer.length,
      path: target,
      draftText: true,
      previewText,
    };
  }

  async readTextDraftAttachment(path: string): Promise<string> {
    const target = await this.resolveDraftPath(path, true);
    const info = await stat(target);
    if (!info.isFile() || info.size > MAX_TEXT_DRAFT_BYTES) throw new Error("文本草稿不存在或超过大小限制");
    return readFile(target, "utf8");
  }

  async deleteTextDraftAttachment(path: string): Promise<void> {
    const target = await this.resolveDraftPath(path, false);
    await rm(target, { force: true });
  }

  async sweepDraftAttachments(): Promise<void> {
    const drafts = Object.values((await this.store.get()).drafts);
    const keep = new Set(drafts.flatMap((draft) => (draft.attachments ?? []).flatMap((attachment) => attachment.draftText && attachment.path ? [resolve(attachment.path)] : [])));
    for (const directory of await readdir(this.draftAttachmentRoot, { withFileTypes: true }).catch(() => [])) {
      const directoryPath = join(this.draftAttachmentRoot, directory.name);
      if (!directory.isDirectory()) { await rm(directoryPath, { recursive: true, force: true }); continue; }
      for (const entry of await readdir(directoryPath, { withFileTypes: true }).catch(() => [])) {
        const path = join(directoryPath, entry.name);
        if (!entry.isFile() || !keep.has(resolve(path))) await rm(path, { recursive: true, force: true });
      }
      if (!(await readdir(directoryPath).catch(() => [])).length) await rm(directoryPath, { recursive: true, force: true });
    }
  }

  async listPromptHistory(cwd: string): Promise<string[]> {
    return [...((await this.store.get()).promptHistory[normalizeKey(cwd)] ?? [])];
  }

  async appendPromptHistory(cwd: string, text: string): Promise<void> {
    const value = text.trim();
    if (!value) return;
    const data = await this.store.get();
    const key = normalizeKey(cwd);
    data.promptHistory[key] = [value, ...(data.promptHistory[key] ?? []).filter((entry) => entry !== value)].slice(0, 50);
    await this.store.set(data);
  }

  private draftDirectory(key: string): string {
    return join(this.draftAttachmentRoot, createHash("sha256").update(normalizeKey(key)).digest("hex").slice(0, 32));
  }

  private isDraftPathForKey(key: string, path: string): boolean {
    if (!isAbsolute(path)) return false;
    const value = relative(resolve(this.draftDirectory(key)), resolve(path));
    return value !== "" && !value.startsWith("..") && !isAbsolute(value);
  }

  private async resolveDraftPath(path: string, mustExist: boolean): Promise<string> {
    if (!isAbsolute(path)) throw new Error("文本草稿路径无效");
    const target = resolve(path);
    const value = relative(resolve(this.draftAttachmentRoot), target);
    if (!value || value.startsWith("..") || isAbsolute(value)) throw new Error("文本草稿路径超出应用缓存");
    const canonicalRoot = await realpath(this.draftAttachmentRoot).catch(() => resolve(this.draftAttachmentRoot));
    const canonicalTarget = await realpath(target).catch(() => undefined);
    if (!canonicalTarget) {
      if (mustExist) throw new Error("文本草稿不存在或无法读取");
      return target;
    }
    const canonicalRelative = relative(canonicalRoot, canonicalTarget);
    if (!canonicalRelative || canonicalRelative.startsWith("..") || isAbsolute(canonicalRelative)) {
      throw new Error("文本草稿路径超出应用缓存");
    }
    return canonicalTarget;
  }

  private async cleanupDraftDirectory(key: string, keep: Set<string>): Promise<void> {
    const directory = this.draftDirectory(key);
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const path = join(directory, entry.name);
      if (!entry.isFile() || !keep.has(resolve(path))) await rm(path, { recursive: true, force: true });
    }
    if (!(await readdir(directory).catch(() => [])).length) await rm(directory, { recursive: true, force: true });
  }
}

function normalizeKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}
