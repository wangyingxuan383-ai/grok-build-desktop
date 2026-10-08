import type { ChatEvent, LiveStatus, ModelInfo, ReasoningEffort, SessionMode, McpToolSelection } from "./types";

export const REMOTE_PROTOCOL = 1;
export interface RemoteTurn { index:number; ordinal:number; prompt:string; preview:string }
export interface RemoteOutline { sessionId:string; totalTurns:number; entries:RemoteTurn[]; before?:number }
export interface RemoteDevice { id: string; name: string; pairedAt: string }
export interface RemotePairRequest { id: string; name: string; requestedAt: string; expiresAt: string }
export interface RemoteGatewayState {
  enabled: boolean; port: number; hostName: string; addresses: string[]; fingerprint?: string;
  addressOptions?:Array<{url:string;interfaceName:string;kind:"lan"|"vpn"|"other";recommended:boolean}>;
  connectionDiagnostics?:{tcp:number;tls:number;requests:number;lastPeer?:string;lastSeen?:string;lastTlsError?:string};
  pairing?: { uri: string; code: string; expiresAt: string }; pending: RemotePairRequest[]; devices: RemoteDevice[]; error?: string;
}
export interface RemoteSession {
  id: string; cwd: string; title: string; projectName: string; updatedAt: string; archived?: boolean;
  status: LiveStatus | "cold"; modelId?: string; mode?: string; canSend: boolean;
  parentSessionId?:string;
  preview?:string;
  /** The project folder no longer exists on the computer; the session can be read or hidden, not continued. */
  projectMissing?:boolean;
}
export interface RemoteOptions {
  notices?:string[];
  modelCatalog?:{refreshing:boolean;checkedAt?:number;reason?:string};
  capabilities:string[];
  models?:ModelInfo[];
  defaults?:{modelId?:string;effort:ReasoningEffort;mode:SessionMode};
  imageModels?:Array<{modelId:string;providerId:string;name:string;image:boolean;video:boolean}>;
  workspaces:Array<{id:string;name:string;path?:string;profiles:Array<{id:string;name:string;mode:string;worktree:boolean;modelId?:string;providerId?:string;effort?:ReasoningEffort;computerEnabled?:boolean}>}>;
}
export interface RemoteSnapshot {
  session: RemoteSession; events: ChatEvent[]; totalEvents: number; before?: number; truncated: boolean;
  cursor: number; epoch: string; pending: ChatEvent[];
  runtime?:RemoteRuntime;
}
export interface RemoteRuntime { revision:string; modelId?:string; providerId?:string;effort:ReasoningEffort;mode:SessionMode;models:ModelInfo[];mutable:boolean;reason?:string;interjectSupported?:boolean;commands:Array<{name:string;description?:string}> }
export const REMOTE_MUTATIONS=["image.create","image.rename","image.submit","code.image.submit","image.cancel","image.delete","image.record.delete","automation.create","automation.update","automation.pause","automation.delete","automation.run","automation.cancel","automation.confirm","inbox.read","computer.permission","computer.risk","task.cancel","account.switch","notification.register","notification.unregister","session.compaction"] as const;
export type RemoteMutationKind=typeof REMOTE_MUTATIONS[number];
export interface RemoteMutation {kind:RemoteMutationKind;target?:string;data?:Record<string,unknown>}
export type RemoteAction = "send" | "cancel" | "permission" | "question" | "plan" | "create" | "rename" | "archive" | "queue-remove" | "queue-edit" | "queue-move" | "queue-clear" | "interject" | "configure" | "compact" | "fork" | "delete" | "workbench";
export interface RemoteCommand {
  operationId: string; sessionId: string; action: RemoteAction; text?: string;
  requestId?: string | number; optionId?: string; answers?: Record<string,string>; verdict?: "approved" | "rejected" | "cancelled";
  workspaceId?:string;profileId?:string;title?:string;archived?:boolean;queueId?:string;
  modelId?:string;providerId?:string;effort?:ReasoningEffort;mode?:SessionMode;revision?:string;position?:number;
  attachmentIds?:string[];toolSelection?:McpToolSelection;mutation?:RemoteMutation;pointId?:string;
  references?:Array<{workspaceId:string;path:string;kind:"file"|"folder"}>;
}
export interface RemoteReceipt {
  operationId: string; sessionId: string; action: RemoteAction; state: "accepted" | "queued" | "running" | "completed" | "failed" | "cancelled" | "unknown";
  createdAt: string; updatedAt: string; message?: string;
  resultSessionId?:string;
}
export interface RemoteSignal { cursor: number; epoch: string; sessionId?: string; type: string }
