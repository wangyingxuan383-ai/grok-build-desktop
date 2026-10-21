import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { TaskCenterPanel } from "../../src/renderer/src/components/TaskCenterPanel";
import { useDiffAnnotations } from "../../src/renderer/src/components/DiffAnnotations";
import { SnippetLibrary } from "../../src/renderer/src/components/SnippetLibrary";
import { ExportSessionPanel } from "../../src/renderer/src/components/ExportSessionPanel";
import { ProductivitySettings } from "../../src/renderer/src/components/ProductivitySettings";
import { DesktopPetSettings } from "../../src/renderer/src/components/DesktopPetSettings";
import { useAppStore } from "../../src/renderer/src/store";
import { buildSessionExport } from "../../src/shared/conversation-export";
import { applyThemeToDocument, DARK_COLORS } from "../../src/renderer/src/theme";
import "../../src/renderer/src/styles.css";

const root = createRoot(document.getElementById("root")!);
const noop = () => undefined;
let release: (() => void) | undefined;
let assignmentReads = 0, appended = 0, inserted = "", error = "";
const snippet = { id: "fixture", title: "核对变更与验证", body: "核对 {{文件}}，重点检查 {{关注点}}。", updatedAt: "2026-10-19T00:00:00Z" };
const api = {
  listPetSkins:async()=>(window as any).petFixtureSkins??[],
  updateSettings:async(patch:any)=>{(window as any).petFixtureWrites=((window as any).petFixtureWrites??0)+1;return patch;},
  petCommand:async(command:string)=>{(window as any).petFixtureCommand=command;},
  createImageConversation:async()=>({id:"image-fixture"}),saveImageComposerDraft:async(_id:string,draft:any)=>{(window as any).petFixtureDraft=draft;},
  listAutomations: async () => [], listAutomationRuns: async () => [], getAutomationGlobalPolicy: async () => null,
  listBackgroundTasks: async () => [], listInbox: async () => [{ id: "done", kind: "completion", title: "测试会话 · 已完成", detail: "本地测试结果", read: false, createdAt: "2026-10-19T00:00:00Z" }],
  listProviders: async () => [], listExecutionProfiles: async () => [], listNativeRuns: async () => [],
  onAutomationEvent: () => noop, onInboxChanged: () => noop, onEvent: () => noop,
  markAllInboxRead: async () => [],
  listPromptSnippets: async () => [snippet],
  getSessionExecutionAssignment: async () => { assignmentReads++; await new Promise<void>(done => { release = done; }); return { cwd: "D:/fixture" }; },
};
Object.assign(window, { grokDesktop: api });
window.addEventListener("grok:compose-feedback", () => appended++);
function DiffFixture() {
  const annotations = useDiffAnnotations(message => { error = message; });
  return <><button id="annotate" onClick={() => annotations.begin({ path: "src/example.ts", startLine: 12, endLine: 14, side: "new" }, "one", "D:/fixture", async () => true)}>选择行添加批注</button>{annotations.panel}</>;
}
function SettingsFixture() {
  const [value, setValue] = useState<any>();
  return <section className="settings-section" style={{ margin: "24px auto", width: "min(700px,calc(100% - 48px))", padding: 20, maxHeight:"calc(100vh - 48px)",overflow:"auto" }}><header><h3>随手使用与后台</h3><p>按需开启快捷入口，保持现有会话和权限设置。</p></header><div className="settings-section-body"><ProductivitySettings value={value} onChange={setValue}/></div></section>;
}
function PetSettingsFixture(){const [value,setValue]=useState<any>();return <section className="settings-section" style={{margin:"24px auto",width:"min(700px,calc(100% - 48px))",padding:20,maxHeight:"calc(100vh - 48px)",overflow:"auto"}}><div className="settings-section-body"><DesktopPetSettings value={value} onChanged={settings=>setValue(settings.desktopPet)}/></div></section>;}
const exports = {
  previewSessionExport: async (sessionId: string, options: any) => buildSessionExport({ sessionId, title: "审核记录", projection:{sessionId,events:[{type:"user-message",id:"u",text:"核对变更"}, {type:"message-chunk",text:"验证结果与后续建议"}]} }, options, text => ({content:text,redactionCount:0})),
  saveSessionExport: async () => undefined,
};
Object.assign(window, { productivityFixture: {
  theme: (dark: boolean) => applyThemeToDocument({mode:dark?"dark":"light",customBase:"dark",colors:DARK_COLORS,background:{enabled:false,scope:"window",fit:"cover",position:"center",opacity:0,blur:0,dim:0}},dark),
  inbox: (requested: boolean) => {
    root.render(<div/>);
    if (requested) localStorage.setItem("grok.task-center-tab.v1", "inbox");
    else localStorage.removeItem("grok.task-center-tab.v1");
    root.render(<TaskCenterPanel key={String(requested)} workspace="D:/fixture" accounts={[]} onClose={noop} onOpenSession={noop} setError={message=>{error=message}} confirmAction={async()=>true}/>);
  },
  diff: () => {
    assignmentReads = appended = 0; error = "";
    useAppStore.setState({activeSessionId:"one",sessions:[{id:"one",cwd:"D:/fixture"}] as any,settings:{activeWorkspace:"D:/fixture"} as any});
    root.render(<DiffFixture key={crypto.randomUUID()}/>);
  },
  release: () => { release?.(); },
  switchSession: () => { useAppStore.setState({activeSessionId:"two"}); },
  state: () => ({assignmentReads,appended,inserted,error}),
  snippets: () => { inserted="";root.render(<SnippetLibrary seed="" onInsert={text=>{inserted=text;}} onClose={()=>root.render(<button id="restored-focus">已关闭</button>)}/>); },
  settings: () => root.render(<SettingsFixture/>),
  petSettings:()=>root.render(<PetSettingsFixture/>),
  export: () => root.render(<ExportSessionPanel sessionId="one" title="审核记录" api={exports} onClose={()=>root.render(<div/>)} />),
} });
