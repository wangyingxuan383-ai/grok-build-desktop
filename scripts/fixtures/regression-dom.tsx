import { WorkspaceDeck } from "../../src/renderer/src/components/WorkspaceDeck";
import { Sidebar } from "../../src/renderer/src/components/Sidebar";
import { useWorkbenchStore } from "../../src/renderer/src/workbench-store";
import type { ContentTarget } from "../../src/renderer/src/workspace-layout";
import type { EditorDocument } from "../../src/shared/types";
import { ActionMenu } from "../../src/renderer/src/components/ui/ActionMenu";
import { PagePresentation } from "../../src/renderer/src/components/ui/PanelSurface";
import { CommandSearch } from "../../src/renderer/src/components/CommandSearch";
import "../../src/renderer/src/styles.css";
import { AutomationConfirmations } from "../../src/renderer/src/components/AutomationConfirmations";
import { TaskCenterPanel } from "../../src/renderer/src/components/TaskCenterPanel";
import React, { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { SessionListRow } from "../../src/renderer/src/components/SessionListRow";
import { GlobalErrorToast } from "../../src/renderer/src/components/GlobalErrorToast";
import { CliUpdateControls } from "../../src/renderer/src/components/CliUpdateControls";
import { McpElicitationCard } from "../../src/renderer/src/components/McpElicitationCard";
import { useSessionDraft } from "../../src/renderer/src/hooks/use-session-draft";
import type { Attachment, ComposerDraftState, SessionSummary } from "../../src/shared/types";

const root = createRoot(document.getElementById("root")!);
const noop = () => undefined;
const waiting: Array<{ key: string; resolve(value: ComposerDraftState | null): void }> = [];
let updateState: any = { phase: "idle", recovery: { previousVersion: "1.0.3", targetVersion: "2.0.0", retained: true } };
const updateCalls: any[] = [];
let mcpCalls = 0;
let mcpResolve: (() => void) | undefined;
let savedAutomation: any;
let confirmationCalls: unknown[] = [];
const automation: any = { id: "task", name: "Fixture schedule", workspace: "fixture", schedule: { kind: "once", at: "2030-01-01T01:30:00.000Z" }, profile: { modelId: "fixture-model", effort: "low", mode: "agent", permissionPolicy: "agent", computerEnabled: false }, enabled: true, wakeToRun: false, notify: false, missedRunPolicy: "run-once", contextPolicy: "fresh", timeZone: "Asia/Shanghai", revision: 3, sessionRevision: 2, frozenExecutionProfile: { id: "private-runtime-profile" }, scheduleAnchor: "2026-09-18T00:00:00Z", registrationStatus: "registered", promptPresent: true, createdAt: "now", updatedAt: "now" };
const api = {
  listAutomations: async () => [automation], listAutomationRuns: async () => [],
  getAutomationGlobalPolicy: async () => ({ defaultProfile: automation.profile, maxConcurrentRuns: 2, confirmationTimeoutMinutes: 30, inactivityTimeoutMinutes: 0, notifyOnSuccess: true, notifyOnFailure: true }),
  listBackgroundTasks: async () => [], listInbox: async () => [], listProviders: async () => [], listExecutionProfiles: async () => [],
  onAutomationEvent: () => noop,
  updateAutomation: async (_id: string, input: unknown) => { savedAutomation = input; return [automation]; },
  getDraft: (key: string) => new Promise<ComposerDraftState | null>((resolve) => waiting.push({ key, resolve })),
  setDraft: async () => undefined,
  getCliUpdateState: async () => updateState,
  previewCliUpdate: async (policy: string, action: string) => ({ fromVersion: "1.0.3", targetVersion: action === "verify" ? "1.0.3" : "2.0.0", policy, confirmationToken: "fixture-token", majorUpgrade: true }),
  applyCliUpdate: async (input: unknown) => { updateCalls.push(input); throw Error("fixture update failed"); },
  // Deliberately unresolved network metadata request: controls must unlock anyway.
  checkCliUpdate: () => new Promise(() => undefined),
  getCliUpdateHistory: async () => [],
  respondMcpElicitation: async (_s: string, _r: string, _outcome: string, values: any) => {
    mcpCalls++;
    if (values.count < 2) throw Error("MCP 表单字段超出数值范围：count");
    await new Promise<void>((resolve) => { mcpResolve = resolve; });
  },
};
Object.assign(window, { grokDesktop: api });
function Menus() {
  const [open, setOpen] = useState("");
  return <>{["a", "b"].map((id) => <SessionListRow key={id} session={{ id, cwd: "fixture", title: id, messageCount: 0, status: "cold", updatedAt: new Date().toISOString() } as SessionSummary}
    active={false} menuOpen={open === id} onOpen={noop} onMenu={(value) => setOpen((current) => value ? id : current === id ? "" : current)} onPin={noop} onArchive={noop} onExport={noop} onRename={noop} onDelete={noop} />)}</>;
}
let edit: (value: string) => void = noop;
let reload: () => void = noop;
function Draft({ sessionId }: { sessionId: string }) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const clear = useCallback(() => setAttachments([]), []);
  const add = useCallback((values: Attachment[]) => setAttachments((old) => [...old, ...values]), []);
  const draft = useSessionDraft({ activeSessionId: sessionId, workspace: "fixture", foreignSessionOpen: false, sendingSessionIds: new Set(), attachments, clearAttachments: clear, addAttachments: add, onSessionChange: noop, onError: noop });
  edit = draft.setComposer; reload = draft.reloadDraft;
  return <input id="draft" value={draft.composer} onChange={(event) => draft.setComposer(event.target.value)} />;
}
function DeckFixture(){const [target,setTarget]=useState({kind:"session" as const,workspace:"D:/fixture",id:"one",title:"一号会话"});const [draft,setDraft]=useState("保留草稿");return <div style={{height:"100vh",display:"flex",flexDirection:"column"}}><button id="deck-second" onClick={()=>setTarget({kind:"session",workspace:"D:/fixture",id:"two",title:"二号会话"})}>打开二号会话</button><WorkspaceDeck target={target} onActivate={async next=>{setTarget(next as typeof target)}} onError={message=>{throw Error(message)}}><input id="deck-draft" aria-label="草稿" value={draft} onChange={event=>setDraft(event.target.value)}/><span id="deck-session">{target.id}</span></WorkspaceDeck></div>}
let chosen = "";
const savedFiles: string[] = [];
function ArchiveFixture() {
  const [sessions,setSessions]=useState<SessionSummary[]>(["普通会话","归档会话"].map((title,index)=>({id:String(index),cwd:"D:/fixture",title,messageCount:1,status:"cold",updatedAt:"2026-09-27",archived:index===1})));
  const [search,setSearch]=useState("");
  const props:any={version:"fixture",sessions:search?sessions.filter(row=>row.title.includes(search)):sessions,codexSessions:[],claudeSessions:[],workspaces:[],activeSessionId:"",activeCodexId:"",activeClaudeId:"",search,busy:false,activeView:"chat",dialogs:{askConfirm:async()=>false,askText:async()=>null,setError:noop},onSearch:setSearch,onOpen:noop,onPin:noop,onRename:noop,onDelete:noop,onExport:noop,onArchive:(session:SessionSummary)=>setSessions(rows=>rows.map(row=>row.id===session.id?{...row,archived:!row.archived}:row))};
  return <Sidebar {...props}/>;
}
function DirtyDeckFixture() {
  const [target,setTarget]=useState<ContentTarget>(()=>{
    const file=useWorkbenchStore.getState().tabs[0];
    return {kind:"file",workspace:file.document.workspacePath,id:file.key,title:file.document.relativePath};
  });
  return <><button id="dirty-second" onClick={()=>{const file=useWorkbenchStore.getState().tabs[1];setTarget({kind:"file",workspace:file.document.workspacePath,id:file.key,title:file.document.relativePath})}}>第二个文件</button><WorkspaceDeck target={target} onActivate={async next=>setTarget(next)} onError={message=>{throw Error(message)}}><span>隔离的文件编辑夹具</span></WorkspaceDeck></>;
}
Object.assign(window, { fixture: {
  archives:()=>{localStorage.removeItem("grok.archives-expanded.v1");root.render(<ArchiveFixture/>);},
  dirtyDeck:()=>{
    localStorage.removeItem("grok.workbench-layout.v1");savedFiles.length=0;
    useWorkbenchStore.setState({tabs:[],activeTabKey:""});
    for(const name of ["a.txt","b.txt"]){
      const document:EditorDocument={workspacePath:"D:/fixture",path:`D:/fixture/${name}`,relativePath:name,content:"before",encoding:"utf8",lineEnding:"lf",byteLength:6,editable:true,hash:"fixture",modifiedAt:"now"};
      useWorkbenchStore.getState().openDocument(document);
      useWorkbenchStore.getState().updateBuffer(useWorkbenchStore.getState().activeTabKey,"after");
    }
    Object.assign(api,{saveEditorDocument:async(input:{path:string;content:string})=>{savedFiles.push(input.path);const file=useWorkbenchStore.getState().tabs.find(row=>row.document.path===input.path)!;return {saved:true,document:{...file.document,content:input.content}}}});
    root.render(<DirtyDeckFixture/>);
  },
  fileState:()=>({saved:savedFiles,tabs:useWorkbenchStore.getState().tabs.map(file=>({key:file.key,dirty:file.dirty}))}),
  chosen:()=>chosen,
  deck:()=>{localStorage.removeItem("grok.workbench-layout.v1");root.render(<DeckFixture/>);},
  uiMenus:()=>root.render(<div style={{display:"flex",justifyContent:"flex-end",padding:12}}><ActionMenu trigger={<button id="nested-trigger">嵌套菜单</button>} actions={[{id:"first",label:"文件",children:[{id:"second",label:"打开方式",children:[{id:"last",label:"编辑器",run:()=>{chosen="editor"}}]}]},{id:"disabled",label:"不可用动作",disabled:true,run:()=>{chosen="bad"}}]}/></div>),
  pageTaskCenter:()=>root.render(<PagePresentation.Provider value={true}><TaskCenterPanel workspace="fixture" accounts={[]} onClose={noop} onOpenSession={noop} setError={noop} confirmAction={async()=>true}/></PagePresentation.Provider>),
  commands:()=>root.render(<CommandSearch actions={[{id:"tasks",label:"任务中心",run:()=>{chosen="tasks"}},{id:"disabled",label:"不可用",disabled:true,run:()=>{chosen="bad"}}]} onError={noop}/>),
  taskCenter: (bound = false) => { automation.destination = bound ? "current-session" : "standalone"; automation.targetSessionId = bound ? "parent" : undefined; automation.contextPolicy = bound ? "reuse" : "fresh"; root.render(<TaskCenterPanel key={String(bound)} workspace="fixture" accounts={[]} onClose={noop} onOpenSession={noop} setError={message => { throw Error(message); }} confirmAction={async () => true} />); },
  automationPayload: () => savedAutomation,
  confirmations: () => {
    api.listInbox = async () => [{ id: "pending:mine", kind: "confirmation", sessionId: "parent", title: "Computer 操作等待确认", detail: "Delete fixture", createdAt: "now" }, { id: "pending:other", kind: "confirmation", sessionId: "other", title: "Other secret", createdAt: "now" }];
    api.respondAutomationPending = async (id: string, approved: boolean) => { confirmationCalls.push({ id, approved }); };
    root.render(<AutomationConfirmations sessionId="parent" onError={message => { throw Error(message); }} />);
  },
  confirmationCalls: () => confirmationCalls,
  menus: () => root.render(<Menus />),
  toast: (message: string) => root.render(<GlobalErrorToast message={message} onReload={noop} onDiagnostics={noop} onDismiss={noop} />),
  controls: () => root.render(<CliUpdateControls />),
  updateCalls: () => updateCalls,
  phase: (phase: string) => { updateState = { ...updateState, phase }; },
  mcp: () => root.render(<McpElicitationCard sessionId="s" message={{ id: "m", kind: "mcp-elicitation", request: { requestId: "r", sessionId: "s", serverName: "fixture", message: "Fixture constraints", mode: "form", schemaSupported: true, requestedSchema: { type: "object", required: ["count"], properties: { count: { type: "integer", minimum: 2, maximum: 4 } } } } }} onResolved={() => root.render(<div>mcp resolved</div>)} />),
  mcpCalls: () => mcpCalls, mcpResolve: () => mcpResolve?.(),
  draft: (sessionId: string) => root.render(<Draft sessionId={sessionId} />),
  edit: (value: string) => edit(value), reload: () => reload(),
  pending: () => waiting.map((item) => item.key),
  resolve: (key: string, text: string) => { const index = waiting.findIndex((item) => item.key === key); if (index < 0) throw new Error(`No draft request ${key}`); waiting.splice(index, 1)[0].resolve({ key, text, updatedAt: new Date().toISOString() }); },
} });
