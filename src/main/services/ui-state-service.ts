import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Attachment, ComposerCapabilitySelection, ComposerDraftState, NewTaskDraft } from "../../shared/types";
import { JsonStore } from "./json-store";

const MAX_TEXT_DRAFT_BYTES = 5 * 1024 * 1024;

interface UiStateData {
  drafts: Record<string, ComposerDraftState>;
  promptHistory: Record<string, string[]>;
  submissions?: Record<string, { draft: ComposerDraftState; state: "pending" | "failed" }>;
}

export class UiStateService {
  private readonly store: JsonStore<UiStateData>;
  private readonly draftAttachmentRoot: string;
  private readonly protectedDraftFiles = new Map<string, Map<string, number>>();

  constructor(userDataPath: string) {
    this.store = new JsonStore(join(userDataPath, "ui-state.json"), { drafts: {}, promptHistory: {} });
    this.draftAttachmentRoot = join(userDataPath, "composer-drafts");
  }

  async getDraft(key: string): Promise<ComposerDraftState | null> {
    const data = await this.store.get();
    return data.drafts[normalizeKey(key)] ?? Object.values(data.submissions ?? {}).reverse().find((entry) => entry.state === "failed" && normalizeKey(entry.draft.key) === normalizeKey(key))?.draft ?? null;
  }

  async setDraft(key: string, text: string, capability?: ComposerCapabilitySelection, attachments: Attachment[] = [], newTask?: NewTaskDraft, submissionId?: string): Promise<void> {
    const normalized = normalizeKey(key);
    const persistedAttachments = attachments.filter((attachment) => attachment.path && isAbsolute(attachment.path) && (!attachment.draftText || this.isDraftPathForKey(key, attachment.path)));
    await this.store.mutate((data) => {
      // Consume only the exact failed snapshot being retried. An unrelated failed
      // prompt remains recoverable even while a newer follow-up is submitted.
      if (submissionId) for (const [id, entry] of Object.entries(data.submissions ?? {})) {
        if (entry.state === "failed" && normalizeKey(entry.draft.key) === normalized && entry.draft.text === text
          && JSON.stringify(entry.draft.attachments ?? []) === JSON.stringify(persistedAttachments)
          && JSON.stringify(entry.draft.capability) === JSON.stringify(capability)) delete data.submissions![id];
      }
      if (!text && !capability && !persistedAttachments.length && !newTask) delete data.drafts[normalized];
      else data.drafts[normalized] = { key, text, capability, attachments: persistedAttachments, newTask, ...(submissionId ? { submissionId } : {}), updatedAt: new Date().toISOString() };
      if (submissionId && data.drafts[normalized]) (data.submissions ??= {})[submissionId] = { draft: structuredClone(data.drafts[normalized]), state: "pending" };
    });
    await this.cleanupDraftDirectory(key, new Set(persistedAttachments.flatMap((attachment) => attachment.draftText && attachment.path ? [resolve(attachment.path)] : [])));
  }

  async listDrafts(): Promise<ComposerDraftState[]> {
    return structuredClone(Object.values((await this.store.get()).drafts).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
  }

  async moveDraft(sourceKey: string, targetKey: string): Promise<ComposerDraftState | null> {
    const sourceNormalized = normalizeKey(sourceKey);
    const targetNormalized = normalizeKey(targetKey);
    if (!sourceNormalized || sourceNormalized === targetNormalized) return this.getDraft(targetKey);
    const snapshot = await this.store.get();
    const source = snapshot.drafts[sourceNormalized];
    if (!source) return null;
    if (snapshot.drafts[targetNormalized]) throw new Error("目标会话已有草稿；未覆盖任何内容");
    const sourceDirectory = this.draftDirectory(sourceKey);
    const targetDirectory = this.draftDirectory(targetKey);
    const movedAttachments = (source.attachments ?? []).map((attachment) => {
      if (!attachment.draftText || !attachment.path || !this.isDraftPathForKey(sourceKey, attachment.path)) return attachment;
      return { ...attachment, path: join(targetDirectory, relative(sourceDirectory, attachment.path)) };
    });
    let attachmentDirectoryMoved = false;
    if (await stat(sourceDirectory).then((value) => value.isDirectory()).catch(() => false)) {
      if (await stat(targetDirectory).then(() => true).catch(() => false)) throw new Error("目标草稿附件目录已存在；未覆盖任何文件");
      await mkdir(dirname(targetDirectory), { recursive: true });
      await rename(sourceDirectory, targetDirectory);
      attachmentDirectoryMoved = true;
    }
    const moved: ComposerDraftState = { ...source, key: targetKey, attachments: movedAttachments, updatedAt: new Date().toISOString() };
    try {
      await this.store.mutate((data) => {
        if (data.drafts[targetNormalized]) throw new Error("目标会话已有草稿；未覆盖任何内容");
        delete data.drafts[sourceNormalized];
        data.drafts[targetNormalized] = moved;
        for (const entry of Object.values(data.submissions ?? {})) {
          if (normalizeKey(entry.draft.key) === sourceNormalized) entry.draft = { ...entry.draft, key: targetKey, attachments: entry.draft.attachments?.map((attachment) => attachment.draftText && attachment.path && this.isDraftPathForKey(sourceKey, attachment.path) ? { ...attachment, path: join(targetDirectory, relative(sourceDirectory, attachment.path)) } : attachment) };
        }
      });
    } catch (error) {
      if (attachmentDirectoryMoved) {
        await rename(targetDirectory, sourceDirectory).catch(() => undefined);
      }
      throw error;
    }
    return structuredClone(moved);
  }

  async clearDraft(key: string): Promise<void> {
    await this.store.mutate((data) => { delete data.drafts[normalizeKey(key)]; });
    // The JSON row is authoritative. Windows Search/antivirus can briefly hold
    // a pasted-text attachment after the row has been removed; retry cache
    // cleanup, then leave any survivor for sweepDraftAttachments on startup
    // instead of reporting a false "draft deletion failed" to the user.
    await this.store.mutate((data) => { for (const [id, entry] of Object.entries(data.submissions ?? {})) if (entry.state === "failed" && normalizeKey(entry.draft.key) === normalizeKey(key)) delete data.submissions![id]; });
    await this.cleanupDraftDirectory(key, new Set()).catch(() => undefined);
  }

  /** Durable recovery is owned by the host, never by a late Renderer callback. */
  async settleSubmission(submissionId: string | undefined, succeeded: boolean): Promise<void> {
    if (!submissionId) return;
    let key: string | undefined;
    await this.store.mutate((data) => {
      const entry = data.submissions?.[submissionId];
      if (!entry) return;
      key = entry.draft.key;
      if (succeeded) delete data.submissions![submissionId];
      else {
        entry.state = "failed";
        const normalized = normalizeKey(key);
        if (!data.drafts[normalized]) data.drafts[normalized] = structuredClone(entry.draft);
      }
    });
    if (key && succeeded) await this.cleanupDraftDirectory(key, new Set()).catch(() => undefined);
  }

  private async referencedPaths(): Promise<Set<string>> {
    const data = await this.store.get();
    const drafts = [...Object.values(data.drafts), ...Object.values(data.submissions ?? {}).map((entry) => entry.draft)];
    return new Set(drafts.flatMap((draft) => (draft.attachments ?? []).flatMap((a) => a.draftText && a.path ? [resolve(a.path)] : [])));
  }

  /**
   * Consume the persisted row without deleting its attachment directory yet.
   * A send operation first materializes every attachment into the immutable
   * session cache, then calls this method. If ACP submission fails, the
   * Renderer can safely recreate the row from the still-existing files.
   */
  async detachDraftForSubmission(key: string, submissionId?: string): Promise<string[]> {
    const detachedFiles: string[] = [];
    await this.store.mutate((data) => {
      const draft = data.drafts[normalizeKey(key)];
      if (!draft || (submissionId && draft.submissionId !== submissionId)) return;
      for (const attachment of draft?.attachments ?? []) {
        if (attachment.draftText && attachment.path && this.isDraftPathForKey(key, attachment.path)) {
          detachedFiles.push(resolve(attachment.path));
        }
      }
      delete data.drafts[normalizeKey(key)];
    });
    return detachedFiles;
  }

  /** Keep a submitted text file alive while it is copied into session cache. */
  protectDraftFiles(key: string, paths: readonly string[]): () => void {
    const protectedPaths = paths.map((value) => resolve(value)).filter((value) => this.isDraftPathForKey(key, value));
    const normalized = normalizeKey(key);
    const current = this.protectedDraftFiles.get(normalized) ?? new Map<string, number>();
    for (const path of protectedPaths) current.set(path, (current.get(path) ?? 0) + 1);
    if (current.size) this.protectedDraftFiles.set(normalized, current);
    return () => {
      const active = this.protectedDraftFiles.get(normalized);
      if (!active) return;
      for (const path of protectedPaths) {
        const count = active.get(path) ?? 0;
        if (count <= 1) active.delete(path);
        else active.set(path, count - 1);
      }
      if (!active.size) this.protectedDraftFiles.delete(normalized);
    };
  }

  /**
   * Remove only the files that belonged to the submitted draft snapshot.
   * A user may start composing the next follow-up while the previous prompt is
   * still running; recursively deleting the keyed directory at turn completion
   * would otherwise erase those newly-created attachments.
   */
  async discardDetachedDraftFiles(key: string, paths: readonly string[]): Promise<void> {
    const referenced = await this.referencedPaths();
    for (const path of new Set(paths.map((value) => resolve(value)))) {
      if (!this.isDraftPathForKey(key, path) || referenced.has(path)) continue;
      await rm(path, { force: true, maxRetries: 3, retryDelay: 80 }).catch(() => undefined);
    }
    const directory = this.draftDirectory(key);
    if (!(await readdir(directory).catch(() => [])).length) {
      await rm(directory, { force: true }).catch(() => undefined);
    }
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

  /**
   * Re-authorize a renderer-restored text attachment for one concrete
   * session. Picker grants are intentionally process-local, while draft files
   * survive restarts, so relying only on the in-memory issued-path set makes a
   * legitimate restored attachment fail after relaunch. The keyed cache
   * directory is the durable authority and also prevents cross-draft reads.
   */
  async resolveTextDraftAttachment(key: string, path: string): Promise<string> {
    const target = await this.resolveDraftPath(path, true);
    if (!this.isDraftPathForKey(key, target)) throw new Error("文本草稿不属于当前会话");
    const info = await stat(target);
    if (!info.isFile() || info.size > MAX_TEXT_DRAFT_BYTES) throw new Error("文本草稿不存在或超过大小限制");
    return target;
  }

  async deleteTextDraftAttachment(path: string): Promise<void> {
    const target = await this.resolveDraftPath(path, false);
    const data = await this.store.get();
    if (Object.values(data.submissions ?? {}).some((entry) => entry.draft.attachments?.some((a) => a.path && resolve(a.path) === target))) return;
    await rm(target, { force: true });
  }

  async sweepDraftAttachments(): Promise<void> {
    // Called once on startup: pending records from the prior host are recoverable,
    // never automatically resent. Keep newer drafts authoritative.
    await this.store.mutate((data) => {
      for (const entry of Object.values(data.submissions ?? {})) {
        entry.state = "failed";
        const key = normalizeKey(entry.draft.key);
        if (!data.drafts[key]) data.drafts[key] = structuredClone(entry.draft);
      }
    });
    const keep = await this.referencedPaths();
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
    const key = normalizeKey(cwd);
    await this.store.mutate((data) => {
      data.promptHistory[key] = [value, ...(data.promptHistory[key] ?? []).filter((entry) => entry !== value)].slice(0, 50);
    });
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
    // Keep the reference read and deletion under the same store lock: a late
    // autosave must not delete a file after a new submission has protected it.
    await this.store.mutate(async (data) => {
      for (const draft of [...Object.values(data.drafts), ...Object.values(data.submissions ?? {}).map((entry) => entry.draft)]) {
        for (const attachment of draft.attachments ?? []) if (attachment.draftText && attachment.path) keep.add(resolve(attachment.path));
      }
      for (const path of this.protectedDraftFiles.get(normalizeKey(key))?.keys() ?? []) keep.add(path);
      for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
        const path = join(directory, entry.name);
        if (!entry.isFile() || !keep.has(resolve(path))) await rm(path, { recursive: true, force: true });
      }
    });
    await rmdir(directory).catch(() => undefined); // Never recursively delete a directory that just gained a new attachment.
  }
}

function normalizeKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}
