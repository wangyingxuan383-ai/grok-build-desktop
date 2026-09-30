import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { SubagentConversation } from "../../src/renderer/src/components/SubagentConversation";
import { WorkspaceDeck } from "../../src/renderer/src/components/WorkspaceDeck";
import { useWorkbenchStore } from "../../src/renderer/src/workbench-store";
import { useAppStore } from "../../src/renderer/src/store";
import "../../src/renderer/src/styles.css";

const calls: string[] = [];
const pending = new Map<string, (value: unknown) => void>();
Object.assign(window, {grokDesktop: {
  getSubagentConversation: (id: string) => { calls.push(id); return new Promise(resolve => pending.set(id, resolve)); },
}});
function deliver(id: string, text: string) {
  pending.get(id)?.({nodeId:id,parentSessionId:"parent",childSessionId:id,title:id,status:"completed",source:"desktop-projection",projection:{version:2,sessionId:id,updatedAt:"",events:[
    {type:"user-message",sessionId:id,text:"inspect"},
    {type:"plan",sessionId:id,text:"READ_ONLY_PLAN",interactive:true},
    {type:"tool-call",sessionId:id,tool:{toolCallId:"tool",title:"read_file",status:"completed",output:"verified",rawInput:{path:"a.ts"}}},
    {type:"message-chunk",sessionId:id,text},
    {type:"turn-completed",sessionId:id},
  ]}});
}
function Fixture() {
  const id = useWorkbenchStore(state=>state.activeSubagentNodeId);
  const [parent, setParent] = useState("");
  const target = {kind:"subagent" as const, workspace:"D:/isolated-child-fixture",id,title:id};
  return <div style={{height:"100vh",display:"flex",flexDirection:"column"}}>
    <div><button id="child-one" onClick={()=>useWorkbenchStore.getState().setActiveSubagent("one")}>one</button><button id="child-two" onClick={()=>useWorkbenchStore.getState().setActiveSubagent("two")}>two</button><span id="parent">{parent}</span></div>
    <WorkspaceDeck target={target} onActivate={async next=>useWorkbenchStore.getState().setActiveSubagent(next.id)} onError={error=>{throw Error(error)}}>
      <SubagentConversation nodeId={id} onParent={setParent}/>
    </WorkspaceDeck>
  </div>;
}
localStorage.removeItem("grok.workbench-layout.v1");
useWorkbenchStore.setState({activeSubagentNodeId:"one",activeView:"subagent"});
useAppStore.setState({activeSessionId:"parent",views:{}});
Object.assign(window,{fixture:{deliver,calls,shared:()=>({sessionId:useAppStore.getState().activeSessionId,views:Object.keys(useAppStore.getState().views)})}});
createRoot(document.getElementById("root")!).render(<Fixture/>);
