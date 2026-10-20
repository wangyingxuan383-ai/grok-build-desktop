import type { Attachment } from "./types";

/** The start arrives before filesystem work, so the renderer can bind the draft owner. */
export type AttachmentDropEvent =
  | { phase: "started"; id: string }
  | { phase: "completed"; id: string; attachments: Attachment[] }
  | { phase: "failed"; id: string; message: string };
