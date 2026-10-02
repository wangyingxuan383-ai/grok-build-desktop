import {useEffect,useRef,useState} from "react";
import {Terminal} from "@xterm/xterm";
import {FitAddon} from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type {WorkspaceTerminal,WorkspaceTerminalEvent} from "../../../shared/workspace-tools";
import {useWorkbenchStore} from "../workbench-store";
export function TerminalWorkbench({workspace,onError}:{workspace:string;onError(message:string):void}) {
 const generation=useRef(0);
 const selectedId=useWorkbenchStore(state=>state.activeTerminalWorkspace===workspace?state.activeTerminalId:"");
 const [tabs,setTabs]=useState<WorkspaceTerminal[]>([]);const [active,setActive]=useState(()=>readActiveTerminal(workspace));const [busy,setBusy]=useState(false);
 const select=(id:string)=>{setActive(id);useWorkbenchStore.getState().setActiveTerminal(id,workspace);try{if(id)localStorage.setItem(terminalStorageKey(workspace),id)}catch{}};
 useEffect(()=>{generation.current++;setTabs([]);setActive(readActiveTerminal(workspace));setBusy(false);let disposed=false;void window.grokDesktop.listWorkspaceTerminals(workspace).then(rows=>{if(!disposed){setTabs(rows);const store=useWorkbenchStore.getState();const preferred=store.activeTerminalWorkspace===workspace?store.activeTerminalId:readActiveTerminal(workspace);select(rows.some(row=>row.id===preferred)?preferred:rows[0]?.id||"")}}).catch(error=>{if(!disposed)onError(String(error))});return()=>{disposed=true;generation.current++}},[workspace]);
 useEffect(()=>{if(selectedId&&tabs.some(tab=>tab.id===selectedId))setActive(selectedId)},[selectedId,tabs]);
 useEffect(()=>window.grokDesktop.onWorkspaceTerminal(event=>{if(event.exitCode!==undefined)setTabs(rows=>rows.map(tab=>tab.id===event.id?{...tab,status:"exited",exitCode:event.exitCode}:tab))}),[]);
 const create=async()=>{const request=generation.current;setBusy(true);try{const tab=await window.grokDesktop.createWorkspaceTerminal(workspace);if(request===generation.current){setTabs(rows=>[...rows,tab]);select(tab.id)}}catch(error){onError(error instanceof Error?error.message:String(error))}finally{if(request===generation.current)setBusy(false)}};
 const close=async(id:string)=>{const request=generation.current;try{await window.grokDesktop.closeWorkspaceTerminal(id);if(request!==generation.current)return;const rows=tabs.filter(tab=>tab.id!==id);setTabs(rows);if(active===id)select(rows[0]?.id||"")}catch(error){onError(String(error))}};
 return <section className="terminal-workbench"><header><div><h2>终端</h2><small title={workspace}>{workspace}</small></div><button disabled={busy||!workspace} onClick={()=>void create()}>{busy?"正在启动…":"新建终端"}</button></header><nav aria-label="终端标签">{tabs.map((tab,index)=><div key={tab.id}><button className={active===tab.id?"active":""} onClick={()=>select(tab.id)}>{tab.title} {index+1}{tab.status==="exited"?" · 已退出":""}</button><button title={tab.status==="running"?"结束终端进程；工作台标签只关闭视图":"移除已退出终端"} aria-label={`结束终端进程 ${index+1}`} onClick={()=>{if(tab.status!=="running"||window.confirm("结束这个终端进程？正在执行的命令也会停止。关闭工作台标签只会关闭视图。"))void close(tab.id)}}>结束</button></div>)}</nav>{active?<TerminalSurface key={active} id={active} workspace={workspace} onError={onError}/>:<div className="empty-copy"><h3>在当前工作区打开终端</h3><p>切换页面保留终端进程，使用“结束终端进程”会结束对应进程；关闭工作台视图不会结束进程。</p><p>这是可交互终端；模型仍使用已有 CLI 工具执行命令。</p></div>}</section>;
}
function terminalStorageKey(workspace:string){return `grok.active-terminal.v1:${workspace.toLocaleLowerCase()}`}
function readActiveTerminal(workspace:string){try{return localStorage.getItem(terminalStorageKey(workspace))||""}catch{return ""}}
export function TerminalSurface({id,workspace,onError,readOnly=false}:{id:string;workspace:string;onError(message:string):void;readOnly?:boolean}) {
 const host=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!host.current)return;let disposed=false,ready=false,sequence=0;const pending:WorkspaceTerminalEvent[]=[];const terminal=new Terminal({cursorBlink:!readOnly,disableStdin:readOnly,convertEol:false,fontFamily:'Consolas,"Microsoft YaHei UI",monospace',fontSize:13,scrollback:5000,theme:{background:getComputedStyle(document.documentElement).getPropertyValue("--color-window").trim()||"#101216",foreground:getComputedStyle(document.documentElement).getPropertyValue("--color-fg").trim()||"#dce1e8"}});const fit=new FitAddon();terminal.loadAddon(fit);terminal.open(host.current);
 const themeObserver=new MutationObserver(()=>{const style=getComputedStyle(document.documentElement);terminal.options.theme={background:style.getPropertyValue("--color-window").trim()||"#101216",foreground:style.getPropertyValue("--color-fg").trim()||"#dce1e8"}});themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:["class","style","data-theme"]});
 const apply=(event:WorkspaceTerminalEvent)=>{if(event.id!==id||disposed)return;if(!ready){pending.push(event);return}if(event.sequence<=sequence)return;sequence=event.sequence;if(event.exitCode!==undefined)terminal.options.disableStdin=true;terminal.write(event.data)};
 const unsubscribe=window.grokDesktop.onWorkspaceTerminal(apply);
 void window.grokDesktop.listWorkspaceTerminals(workspace).then(rows=>{if(disposed)return;const snapshot=rows.find(row=>row.id===id);if(!snapshot)throw Error("终端已关闭");terminal.options.disableStdin=readOnly||snapshot.status==="exited";terminal.write(snapshot.output);sequence=snapshot.sequence;ready=true;pending.splice(0).forEach(apply);resize()}).catch(error=>{if(!disposed)onError(String(error))});
 const input=terminal.onData(data=>{if(readOnly)return;void window.grokDesktop.writeWorkspaceTerminal(id,data).catch(error=>onError(String(error)))});
 const resize=()=>{if(disposed||!host.current||host.current.clientWidth<10||host.current.clientHeight<10)return;fit.fit();if(ready&&!readOnly)void window.grokDesktop.resizeWorkspaceTerminal(id,Math.max(2,Math.min(500,terminal.cols)),Math.max(2,Math.min(300,terminal.rows))).catch(()=>undefined)};
 const observer=new ResizeObserver(resize);observer.observe(host.current);resize();
 return()=>{disposed=true;unsubscribe();input.dispose();observer.disconnect();themeObserver.disconnect();terminal.dispose()};
 },[id,workspace,readOnly]);
 return <div className="terminal-surface" ref={host}/>;
}
