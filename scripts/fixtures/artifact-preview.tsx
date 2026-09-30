import React, {useState} from "react";
import {createRoot} from "react-dom/client";
import {ArtifactWorkbench} from "../../src/renderer/src/components/ArtifactWorkbench";
import {encodeMediaArtifact} from "../../src/renderer/src/media-artifact-target";
import {ArtifactPreviewPane} from "../../src/renderer/src/components/ArtifactPreviewPane";
import {MediaPreviewContext, type ArtifactPreviewTarget} from "../../src/renderer/src/artifact-preview";
import {GeneratedMediaGallery} from "../../src/renderer/src/components/MessageCard";
import type {WorkspaceArtifact} from "../../src/shared/workspace-tools";
import "../../src/renderer/src/styles.css";
const tiny="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV9sAAAAASUVORK5CYII=";
const pending=new Map<string,{resolve(value:WorkspaceArtifact):void;reject(error:Error):void}>();
let targetSetter:(target:ArtifactPreviewTarget|undefined)=>void=()=>undefined;
const pins:string[]=[],parents:string[]=[],errors:string[]=[];
Object.assign(window,{grokDesktop:{readWorkspaceArtifact:(_workspace:string,path:string)=>new Promise((resolve,reject)=>pending.set(path,{resolve,reject})),saveWorkspaceArtifact:async()=>undefined}});
function Fixture(){
 const [target,setTarget]=useState<ArtifactPreviewTarget>();targetSetter=setTarget;
 const [pinned,setPinned]=useState("");
 return <MediaPreviewContext.Provider value={media=>{setTarget({...media,workspace:"D:/fixture"});return true}}>
  <div style={{display:"flex",height:"100vh"}}><main style={{flex:1}}>{pinned?<ArtifactWorkbench workspace="D:/fixture" initialPath={pinned} onError={message=>errors.push(message)}/>:<h1>来源会话</h1>}<GeneratedMediaGallery sessionId="parent" messages={[{id:"picture",kind:"media",media:"image",source:tiny,isData:true,mimeType:"image/png"}]}/></main>
  {target&&<ArtifactPreviewPane key={target.kind==="file"?target.path:target.messageId} target={target} onPinMedia={target=>{const id=encodeMediaArtifact(target);pins.push(id);setPinned(id);setTarget(undefined)}} onClose={()=>setTarget(undefined)} onPin={(workspace,path)=>pins.push(workspace+"|"+path)} onReturn={(id,workspace)=>parents.push(id+"|"+workspace)} onError={error=>errors.push(error)}/>}</div>
 </MediaPreviewContext.Provider>;
}
Object.assign(window,{fixture:{
 media:()=>targetSetter({kind:"media",workspace:"D:/fixture",sessionId:"parent",messageId:"opaque",media:"image",source:"grok-media://access/owned"}),
 file:(path:string)=>targetSetter({kind:"file",workspace:"D:/fixture",path}),
 resolve:(path:string,text:string)=>pending.get(path)?.resolve({path,name:path,kind:"text",mimeType:"text/plain",data:text}),
 fail:(path:string)=>pending.get(path)?.reject(Error("文件不存在")),
 state:()=>({pins,parents,errors}),
}});
createRoot(document.getElementById("root")!).render(<Fixture/>);
