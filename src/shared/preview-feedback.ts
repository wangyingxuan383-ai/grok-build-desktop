import type { Attachment } from "./types";
import type { WorkspaceBrowserTab } from "./workspace-tools";

/** Data-only contract for a single user pick in an isolated browser preview. */
export interface PreviewElementPick {
  x: number;
  y: number;
  url: string;
  revision: number;
  sessionId: string;
  workspace: string;
}

export interface PreviewElementContext {
  selector: string;
  text: string;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface PreviewFeedbackCapture {
  tab: WorkspaceBrowserTab;
  previewUrl: string;
  attachment: Attachment;
  /** Navigation generation, echoed in a subsequent explicit element pick. */
  revision: number;
  element?: PreviewElementContext;
}

export interface PreviewFeedbackApi {
  /** Existing capture-browser-feedback IPC: [id, optional pick]. No script input. */
  captureBrowserFeedback(id: string, pick?: PreviewElementPick): Promise<PreviewFeedbackCapture>;
}
