import type { ImageConversation, ImageRecord } from "../../../../shared/image-workspace";
import type { MediaArtifact, MediaGenerationJob } from "../../../../shared/types";
import { mediaPreviewUrl } from "../../artifact-preview";

export const isRunning = (job: MediaGenerationJob): boolean => ["queued", "running", "cancelling"].includes(job.status);

/** A finished picture, with the session and request that produced it. */
export interface Work {
  key: string;
  conversation: ImageConversation;
  record: ImageRecord;
  artifact: MediaArtifact;
  at: string;
}

/** A generation that produced no picture (failed or cancelled); the gallery lets it be cleared. */
export interface Miss {
  key: string;
  conversation: ImageConversation;
  record: ImageRecord;
  at: string;
}

export const recordKey = (conversation: ImageConversation, record: ImageRecord): string => `${conversation.id}:${record.job.jobId}`;

const stamp = (record: ImageRecord): string => record.job.completedAt ?? record.job.updatedAt;

export function collectWorks(conversations: readonly ImageConversation[]): Work[] {
  return conversations
    .flatMap((conversation) => conversation.jobs.flatMap((record) => !isRunning(record.job)
      ? record.job.artifacts.filter((artifact) => artifact.media === "image").map((artifact) => ({ key: `${recordKey(conversation, record)}:${artifact.id}`, conversation, record, artifact, at: stamp(record) }))
      : []))
    .sort((left, right) => right.at.localeCompare(left.at));
}

export function collectMisses(conversations: readonly ImageConversation[]): Miss[] {
  return conversations
    .flatMap((conversation) => conversation.jobs.filter((record) => !record.job.artifacts.length && !isRunning(record.job))
      .map((record) => ({ key: recordKey(conversation, record), conversation, record, at: stamp(record) })))
    .sort((left, right) => right.at.localeCompare(left.at));
}

/** Generated pictures come back as opaque grok-media handles; inline data is only produced by test fixtures. */
export function artworkSrc(artifact: MediaArtifact, sessionId: string, thumbnail: boolean): string {
  if (artifact.isData) return mediaPreviewUrl({ source: artifact.source, isData: true, mimeType: artifact.mimeType, media: "image" });
  const url = mediaPreviewUrl({ source: artifact.source, sessionId, media: "image" });
  if (!url || !thumbnail) return url;
  const next = new URL(url);
  next.searchParams.set("variant", "thumbnail");
  return next.href;
}

export function sessionStats(conversation: ImageConversation): { works: number; running: boolean; failed: number } {
  let works = 0, failed = 0, running = false;
  for (const record of conversation.jobs) {
    if (isRunning(record.job)) running = true;
    else { if (record.job.status === "failed") failed++; works += record.job.artifacts.length; }
  }
  return { works, running, failed };
}

export function newestFirst(conversations: readonly ImageConversation[]): ImageConversation[] {
  return [...conversations].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function whenLabel(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "";
  const delta = Date.now() - time;
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  if (delta < 30 * 86_400_000) return `${Math.floor(delta / 86_400_000)} 天前`;
  return new Date(time).toLocaleDateString("zh-CN");
}

export const ASPECT_OPTIONS = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4"] as const;
