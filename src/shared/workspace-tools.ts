export interface WorkspaceTerminal { id:string; workspace:string; title:string; status:"running"|"exited"; exitCode?:number; output:string; sequence:number }
export interface WorkspaceTerminalEvent { id:string; data:string; sequence:number; exitCode?:number }
export interface WorkspaceBrowserTab { id:string; url:string; title:string; loading:boolean; error?:string; downloadStatus?:string; canGoBack:boolean; canGoForward:boolean;sessionId?:string;workspace?:string }
export interface PreviewServer {terminalId:string;workspace:string;script:string;status:"running"|"exited";url?:string}
export interface WorkspaceViewBounds { x:number;y:number;width:number;height:number;visible:boolean }
export interface WorkspaceArtifact { path:string; name:string; kind:"text"|"image"|"pdf"|"audio"|"video"|"html"|"office"; mimeType:string; data:string; previewUrl?:string }

export interface PullRequestStatus {available:boolean;reason?:string;number?:number;title?:string;url?:string;state?:string;checks:Array<{name:string;state:string}>;pending:boolean;watching?:boolean}
