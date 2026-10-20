import React from "react";
import { createRoot } from "react-dom/client";
import { ImageWorkspacePage } from "../../src/renderer/src/components/ImageWorkspacePage";
import { observeAttachmentDrops, type AttachmentDropTarget } from "../../src/renderer/src/attachment-drop";
import type { AttachmentDropEvent } from "../../src/shared/attachment-drop";
import type { ImageWorkspace } from "../../src/shared/image-workspace";
import "../../src/renderer/src/styles.css";

const workspace: ImageWorkspace = { version: 1, outputRoot: "D:/fixture", conversations: ["a", "b"].map(id => ({
  id, cwd: `D:/fixture/${id}`, title: `图像 ${id}`, createdAt: "", updatedAt: "", draft: "", jobs: [],
})) };
Object.assign(window, { grokDesktop: {
  listModelCatalog: async () => [], listProviders: async () => [],
  listImageWorkspace: async () => structuredClone(workspace),
  setVisibleConversation: async () => undefined, onMediaGenerationProgress: () => () => undefined,
  saveImageComposerDraft: async () => undefined,
} });
let capture: (() => AttachmentDropTarget) | null = null;
let emit!: (event: AttachmentDropEvent) => void;
const errors: string[] = [];
observeAttachmentDrops(listener => { emit = listener; return () => undefined; }, () => capture?.(), message => errors.push(message));
const register = (next: typeof capture) => { capture = next; };
const root = createRoot(document.getElementById("root")!);
const render = () => root.render(<ImageWorkspacePage registerDrop={register} onCode={() => root.render(<button onClick={render}>返回图像</button>)}/>);
Object.assign(window, { dropFixture: {
  start: (id: string) => emit({ phase: "started", id }),
  finish: (id: string) => emit({ phase: "completed", id, attachments: [{ id, name: `${id}.png`, path: `D:/fixture/${id}.png`, kind: "image", mimeType: "image/png" }] }),
  open: (id: string) => window.dispatchEvent(new CustomEvent("grok:open-image-conversation", { detail: { id } })),
  errors: () => errors,
} });
render();
