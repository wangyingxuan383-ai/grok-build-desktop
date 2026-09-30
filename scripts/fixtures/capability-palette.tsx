import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AddPalette } from "../../src/renderer/src/components/Composer";
import { MediaStudioPanel } from "../../src/renderer/src/components/MediaStudioPanel";
import type { MediaGenerationJob, MediaCreationRequest } from "../../src/shared/types";
import "../../src/renderer/src/styles.css";

const root = createRoot(document.getElementById("root")!);
let selected = "", images = 0, closed = 0;
const submissions: MediaCreationRequest[] = [];
let resolveCreate: (job: MediaGenerationJob) => void;
let progress: (job: MediaGenerationJob) => void = () => undefined;
let switchSession: () => void = () => undefined;
Object.assign(window, {grokDesktop:{
  listSkills:async()=>[{name:"文档",command:"documents",description:"生成文档",source:"fixture"}],
  listProviders:async()=>[],
  onMediaGenerationProgress:(listener:typeof progress)=>{progress=listener;return ()=>{progress=()=>undefined}},
}});
const noop = () => undefined;
function Media({initialSession}: {initialSession?:string}) {
  const [sessionId,setSessionId]=useState(initialSession);
  switchSession=()=>setSessionId("other-session");
  return <MediaStudioPanel sessionId={sessionId} initialPrompt="为当前项目设计图标" hasGrokConversation commands={[]} onClose={()=>{closed++}} onCreate={request=>{if(!sessionId)setSessionId("code-session");submissions.push(request);return new Promise(resolve=>{resolveCreate=resolve})}}/>;
}
Object.assign(window,{fixture:{
  palette:()=>root.render(<AddPalette commands={[{name:"review",description:"审查当前改动",inputHint:"scope"}]} onCommand={name=>{selected=name}} onImage={()=>{images++}} onClose={noop} onFiles={noop} onFolders={noop} onWorkspaceFile={noop} onComputer={noop} onSkill={skill=>{selected=skill.command}} onManageExtensions={noop}/>),
  media:(empty=false)=>root.render(<Media key={String(empty)} initialSession={empty?undefined:"code-session"}/>),
  state:()=>({selected,images,closed,submissions}),
  switchSession:()=>switchSession(),
  finish:(output={})=>{const job={jobId:"fixture-job",sessionId:"code-session",status:"completed",message:"完成",artifacts:[],...output} as unknown as MediaGenerationJob;progress(job);resolveCreate({...job,status:"running"});},
}});
