import type { ThemeSettings, LiveStatus } from "../../shared/types";

export type QuickEntryIntent = "ask" | "screenshot";
export interface QuickEntryAttachment { id: string; name: string; kind: "file" | "image" | "folder"; size?: number; previewUrl?: string; }
export interface QuickEntryContext {
  draftId: string;
  intent: QuickEntryIntent;
  workspaces: Array<{ cwd: string; name: string }>;
  workspace: string;
  sessions: Array<{ id: string; cwd: string; title: string; status: LiveStatus }>;
  attachments: QuickEntryAttachment[];
  theme: ThemeSettings;
  warnings: string[];
  recovery?: { text: string; sessionId: string; message: string };
}
export interface QuickEntrySubmission { draftId: string; cwd: string; sessionId: string; text: string; attachmentIds: string[]; }
export interface QuickEntryApi {
  context(cwd?: string): Promise<QuickEntryContext>;
  files(draftId: string): Promise<QuickEntryAttachment[]>;
  clipboard(draftId: string): Promise<{ text: string; attachments: QuickEntryAttachment[] }>;
  snip(draftId: string): Promise<void>;
  remove(draftId: string, attachmentId: string): Promise<void>;
  send(input: QuickEntrySubmission): Promise<void>;
  cancel(): Promise<void>;
}
