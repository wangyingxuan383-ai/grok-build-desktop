import type { Attachment, MediaCreationRequest, MediaGenerationJob, MediaAspectRatio } from "./types";
export interface ImageComposerDraft { draft:string; ratio:MediaAspectRatio; route:"cli"|"provider"; model:string; cliModel:string; references:Attachment[]; sources:Array<{source:string;label:string}> }
export interface ImageExecution { modelId:string; providerId?:string; accountId?:string }
/** What a generation was asked to start from, kept so the session can show it next to the prompt. */
export interface ImageReferences { names:string[]; sources:string[] }
export interface ImageRecord { requestId:string; prompt:string; aspectRatio?:string; references?:ImageReferences; request?:MediaCreationRequest; job:MediaGenerationJob }
export interface ImageConversation { id:string; title:string; /** Set once the user renames it; the first prompt no longer names the session. */ titleLocked?:boolean; firstRequestAt?:string; /** Grok CLI session id used for every generation in this conversation (multi-turn context). */ cliSessionId?:string; execution?:ImageExecution; composerDraft?:ImageComposerDraft; cwd:string; createdAt:string; updatedAt:string; draft:string; jobs:ImageRecord[] }
export interface ImageWorkspace { version:1; outputRoot:string; conversations:ImageConversation[] }
export interface ImageSubmit { conversationId:string; requestId:string; request:MediaCreationRequest; referenceSources?:string[] }
