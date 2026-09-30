import React from "react";
import { createRoot } from "react-dom/client";
import { AddPalette } from "../../src/renderer/src/components/Composer";
import type { McpToolSelection, SessionMcpToolSnapshot } from "../../src/shared/types";
import "../../src/renderer/src/styles.css";

const root=createRoot(document.getElementById("root")!);
let selection:McpToolSelection|undefined;
let connected=true, hold=false, wrongOwner=false;
const pending:Array<()=>void>=[];
const snapshot=(sessionId:string):SessionMcpToolSnapshot=>({sessionId:wrongOwner?"foreign":sessionId,tools:connected?[{selection:{sessionId,serverName:"文档服务",toolName:"lookup",generation:"connection-1"},description:"读取指定文档"}]:[],notice:"仅列出当前连接明确上报为就绪的 MCP 工具。"});
Object.assign(window,{grokDesktop:{listSkills:async()=>[],getSessionMcpTools:(id:string)=>new Promise(resolve=>{const value=snapshot(id);if(hold)pending.push(()=>resolve(value));else resolve(value)})}});
const noop=()=>undefined;
const show=(sessionId="parent")=>root.render(<AddPalette sessionId={sessionId} commands={[]} onCommand={noop} onClose={noop} onFiles={noop} onFolders={noop} onWorkspaceFile={noop} onComputer={noop} onSkill={noop} onManageExtensions={noop} onMcp={value=>{selection=value}}/>);
Object.assign(window,{fixture:{show,state:()=>selection,disconnect:()=>{connected=false},hold:()=>{hold=true},release:()=>{hold=false;pending.splice(0).forEach(resolve=>resolve())},wrongOwner:()=>{wrongOwner=true}}});
show();
