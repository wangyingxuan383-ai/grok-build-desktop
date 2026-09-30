import type { MediaCreationRequest, MediaGenerationJob } from "./types";
/** What a generation was asked to start from, kept so the session can show it next to the prompt. */
export interface ImageReferences { names:string[]; sources:string[] }
export interface ImageRecord { requestId:string; prompt:string; aspectRatio?:string; references?:ImageReferences; job:MediaGenerationJob }
export interface ImageConversation { id:string; title:string; /** Set once the user renames it; the first prompt no longer names the session. */ titleLocked?:boolean; /** Grok CLI session id used for every generation in this conversation (multi-turn context). */ cliSessionId?:string; cwd:string; createdAt:string; updatedAt:string; draft:string; jobs:ImageRecord[] }
export interface ImageWorkspace { version:1; outputRoot:string; conversations:ImageConversation[] }
export interface ImageSubmit { conversationId:string; requestId:string; request:MediaCreationRequest; referenceSources?:string[] }
