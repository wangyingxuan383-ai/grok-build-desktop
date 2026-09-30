import React from "react";
import {createRoot} from "react-dom/client";
import {FileWorkbench} from "../../src/renderer/src/components/FileWorkbench";
import {useWorkbenchStore} from "../../src/renderer/src/workbench-store";
import "../../src/renderer/src/styles.css";
const store=useWorkbenchStore.getState(),docs=new Map(),saves:any[]=[];
for(const name of ["a","b"]){
 const doc={workspacePath:"C:/fixture",path:`C:/fixture/${name}.txt`,relativePath:`${name}.txt`,content:name,hash:name,modifiedAt:"2026-09-28",editable:true,encoding:"utf8",lineEnding:"lf",languageId:"plaintext",byteLength:1};
 docs.set(doc.path,doc);store.openDocument(doc as any);
}
Object.assign(window,{grokDesktop:{
 openEditorDocument:async(_:string,path:string)=>({document:docs.get(path)}),
 saveEditorDocument:async(request:any)=>{saves.push(request);return {document:{...docs.get(request.path),content:request.content,hash:request.content}}},
}});
const dialogs={askConfirm:async()=>false,askText:async()=>null,setError:(message:string)=>{throw Error(message)}};
const tabs=useWorkbenchStore.getState().tabs;
const root=createRoot(document.getElementById("root")!);
const render=(rows= tabs)=>root.render(<div style={{height:"100vh",display:"flex"}}>{rows.map((tab,index)=><div key={index} style={{width:"50%",display:"flex",minWidth:0}}><FileWorkbench workspace="C:/fixture" boundTabKey={tab.key} dialogs={dialogs}/></div>)}</div>);
Object.assign(window,{fixture:{duplicates:()=>render([tabs[0]!,tabs[0]!]),closeDuplicate:()=>render([tabs[0]!]),state:()=>({saves,active:useWorkbenchStore.getState().activeTabKey,tabs:useWorkbenchStore.getState().tabs})}});
render();
