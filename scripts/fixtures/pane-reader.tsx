import React from "react";
import { createRoot } from "react-dom/client";
import { readPaneScroll } from "../../src/renderer/src/pane-scroll-state";
import { PaneReader } from "../../src/renderer/src/components/PaneReader";
import { useWorkbenchStore } from "../../src/renderer/src/workbench-store";
import { useAppStore } from "../../src/renderer/src/store";
import "../../src/renderer/src/styles.css";
const root=createRoot(document.getElementById("root")!);
const pending=new Map<string,(value:unknown)=>void>();let activations=0;
const histories=new Map<string,(value:unknown)=>void>();
const historyFailures=new Map<string,(reason:Error)=>void>();let historyReads=0;
Object.assign(window,{grokDesktop:{getGitDiff:(cwd:string)=>new Promise(resolve=>pending.set(cwd,resolve)),inspectSession:(cwd:string,id:string)=>new Promise((resolve,reject)=>{historyReads++;histories.set(id,resolve);historyFailures.set(id,reject)})}});
const review=(workspace:string)=>({kind:"review" as const,id:JSON.stringify({path:"same.ts",staged:false}),workspace,title:"same.ts"});
function show(workspaces:string[]){root.render(<div style={{height:600,display:"flex"}}>{workspaces.map((workspace,index)=><PaneReader key={index} target={review(workspace)} onActivate={()=>activations++}/>)}</div>)}
Object.assign(window,{fixture:{
 historyReads:()=>historyReads,
 failHistory:(id:string)=>historyFailures.get(id)?.(new Error("读取失败示例")),
 finishLongHistory:(id:string,count=100)=>histories.get(id)?.({version:2,sessionId:id,updatedAt:"",events:Array.from({length:count},(_,i)=>({type:"user-message",sessionId:id,clientMessageId:`${id}-${i}`,text:`阅读定位 ${i} `+"内容 ".repeat(30)}))}),
 nativeHistory:()=>histories.get("native")?.({version:2,sessionId:"native",updatedAt:"",events:[{type:"history-recovery",sessionId:"native",status:"recovered",message:"只读 CLI 原生历史；仅显示可识别的消息与工具记录。已达到前 8 MiB / 2000 个事件的显示上限。"},{type:"user-message",sessionId:"native",text:"原生用户消息"},{type:"message-chunk",sessionId:"native",text:"原生回答正文"},{type:"tool-call",sessionId:"native",tool:{toolCallId:"native-tool",title:"原生工具结果",status:"completed",output:"原生结果内容"}}]}),
 cold:(id="cold")=>{useAppStore.setState({activeSessionId:"focused",views:{}});root.render(<div style={{height:600,display:"flex"}}><PaneReader paneId="cold-pane" target={{kind:"session",id,workspace:"C:/one",title:id}} onActivate={()=>activations++}/></div>)},
 finishHistory:(id:string,text:string,foreign=false)=>histories.get(id)?.({version:2,sessionId:foreign?"foreign":id,updatedAt:"",events:[{type:"message-chunk",sessionId:id,text}]}),
 scrollFile:()=>{useWorkbenchStore.setState({tabs:[{key:"scroll",buffer:Array.from({length:500},(_,i)=>"line "+i).join("\n"),dirty:false,document:{workspacePath:"C:/one",relativePath:"scroll.txt"}} as any]});root.render(<div style={{height:600,display:"flex"}}><PaneReader paneId="scroll-pane" target={{kind:"file",id:"scroll",workspace:"C:/one",title:"scroll.txt"}} onActivate={()=>activations++}/></div>)},
 show,resolve:(workspace:string,patch:string)=>pending.get(workspace)?.({repositoryRoot:workspace,path:"same.ts",staged:false,patch,binary:false}),
 state:()=>({scroll:readPaneScroll("scroll-pane:file:c:/one:scroll"),activations,activeSession:useAppStore.getState().activeSessionId}),
 file:()=>{useWorkbenchStore.setState({tabs:[{key:"file",buffer:"X".repeat(170000)+"完整文件结尾",dirty:true,document:{workspacePath:"C:/one",relativePath:"long.txt"}} as any]});root.render(<div style={{height:600,display:"flex"}}><PaneReader target={{kind:"file",id:"file",workspace:"C:/one",title:"long.txt"}} onActivate={()=>activations++}/></div>)},
 history:()=>{useAppStore.setState({activeSessionId:"focused",views:{background:{messages:[{id:"0",kind:"plan",text:"完整只读计划",interactive:true},...Array.from({length:100},(_,index)=>({id:String(index+1),kind:"assistant",text:index===0?"首条历史不再丢失":"消息 "+index}))]}} as any});root.render(<div style={{height:600,display:"flex"}}><PaneReader target={{kind:"session",id:"background",workspace:"C:/one",title:"history"}} onActivate={()=>activations++}/></div>)}
}});
show(["C:/one","C:/two"]);
