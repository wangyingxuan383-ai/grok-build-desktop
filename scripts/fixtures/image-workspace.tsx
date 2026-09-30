import React from "react";
import {createRoot} from "react-dom/client";
import {ImageWorkspacePage} from "../../src/renderer/src/components/ImageWorkspacePage";
import type {ImageWorkspace,ImageSubmit} from "../../src/shared/image-workspace";
import type {MediaGenerationJob} from "../../src/shared/types";
import "../../src/renderer/src/styles.css";
const state:ImageWorkspace={version:1,outputRoot:"C:/Pictures/Grok Images",conversations:[]};let calls=0,code=0;let progress:(job:MediaGenerationJob)=>void=()=>{};
const clone=<T,>(value:T):T=>structuredClone(value);
Object.assign(window,{grokDesktop:{
 previewImageOriginal:async()=>({id:"original-restored",source:"grok-media://access/restored-original",media:"image",mimeType:"image/png"}),
 listCodeImages:async()=>[{id:"code-picture",sessionId:"code-session",url:"grok-media://access/fixture-code",media:"image",mimeType:"image/png",name:"代码项目图片"}],
 listImageWorkspace:async()=>clone(state),listProviders:async()=>[],onMediaGenerationProgress:(callback:typeof progress)=>{progress=callback;return()=>{progress=()=>{}}},
 createImageConversation:async()=>{const row={id:`image-${state.conversations.length+1}`,title:"新图像会话",cwd:"C:/Pictures/Grok Images/session",createdAt:"",updatedAt:"",draft:"",jobs:[]};state.conversations.push(row);return clone(row)},
 saveImageDraft:async(id:string,draft:string)=>{state.conversations.find(row=>row.id===id)!.draft=draft},
 pickImageOutputRoot:async()=>{state.outputRoot="D:/Images";return state.outputRoot},
 submitImage:async(input:ImageSubmit)=>{calls++;const row=state.conversations.find(row=>row.id===input.conversationId)!;row.title=input.request.prompt;row.draft="";const job:MediaGenerationJob={jobId:`job-${calls}`,sessionId:row.id,kind:"image",route:"cli",status:"running",message:"隔离夹具正在生成",artifacts:[],startedAt:"",updatedAt:""};row.jobs.push({requestId:input.requestId,prompt:input.request.prompt,job});return clone(job)},
 cancelMediaGeneration:async(id:string)=>{const record=state.conversations.flatMap(row=>row.jobs).find(row=>row.job.jobId===id)!;record.job.status="cancelled";record.job.message="已取消";progress(clone(record.job));return clone(record.job)},
 deleteImageConversation:async(id:string)=>{state.conversations=state.conversations.filter(row=>row.id!==id)},pickAttachments:async()=>[],
 }});
const root=createRoot(document.getElementById("root")!);const render=()=>root.render(<ImageWorkspacePage onCode={()=>{code++;root.render(<button onClick={render}>返回图像</button>)}}/>);
Object.assign(window,{fixture:{state:()=>clone({state,calls,code}),render,finishWithOriginal:()=>{const record=state.conversations[0]!.jobs[0]!;record.job.status="completed";record.job.savedProjectFiles=["C:/Pictures/old-original.png"];progress(clone(record.job))}}});render();
