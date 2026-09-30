import { createContext } from "react";
import { scopedMediaUrl } from "../../shared/media-scope";

export type MediaPreview = {
  workspace?: string;
  kind: "media"; sessionId: string; messageId: string; source: string;
  media: "image" | "video"; isData?: boolean; mimeType?: string;
};
export type ArtifactPreviewTarget = (MediaPreview & { workspace: string })
  | { kind: "file"; workspace: string; path: string; sessionId?: string };
/** Returning false keeps standalone/read-only viewers on their local preview path. */
export const MediaPreviewContext = createContext<((target: MediaPreview) => boolean) | null>(null);
export function mediaPreviewUrl(target: Pick<MediaPreview, "source" | "isData" | "mimeType" | "media"> & {sessionId?:string}): string {
  if (target.isData) {
    const mime = target.mimeType || (target.media === "image" ? "image/png" : "video/mp4");
    return /^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm))$/.test(mime) ? `data:${mime};base64,${target.source}` : "";
  }
  return target.source.startsWith("grok-media://access/") ? scopedMediaUrl(target.source,target.sessionId) : "";
}
