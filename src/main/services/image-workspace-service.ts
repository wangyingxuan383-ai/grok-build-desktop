import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import type { ImageConversation, ImageSubmit, ImageWorkspace } from "../../shared/image-workspace";
import type { MediaGenerationJob } from "../../shared/types";
import { JsonStore } from "./json-store";

const busy=(job:MediaGenerationJob)=>["queued","running","cancelling"].includes(job.status);
export class ImageWorkspaceService {
 private readonly store:JsonStore<ImageWorkspace>;
 private readonly ready:Promise<unknown>;
 constructor(userData:string,defaultRoot:string,recover=false){
  this.store=new JsonStore(join(userData,"image-workspace.json"),{version:1,outputRoot:defaultRoot,conversations:[]});
  // Worker readers must never alter GUI-owned rows. Removing the last artwork is
  // also not deletion of its conversation or native multi-turn context.
  this.ready=recover?this.store.mutate(state=>{
  for(const conversation of state.conversations)for(const record of conversation.jobs)if(busy(record.job)){record.job.status="failed";record.job.error="上次应用退出时任务未完成；请检查已有产物后手动重试。";record.job.message=record.job.error;record.job.updatedAt=new Date().toISOString()}}):Promise.resolve();
 }
 async list(){await this.ready;return this.store.get()}
 async get(id:string){return (await this.list()).conversations.find(row=>row.id===id)}
 async create(){await this.ready;const state=await this.store.get(),id=`image-${randomUUID()}`,now=new Date().toISOString();const cwd=join(state.outputRoot,id);await mkdir(cwd,{recursive:true});const row:ImageConversation={id,title:"新图像会话",cwd:await realpath(cwd),createdAt:now,updatedAt:now,draft:"",jobs:[]};await this.store.mutate(value=>{value.conversations.push(row)});return row}
 async draft(id:string,draft:string){await this.ready;await this.store.mutate(state=>{const row=state.conversations.find(row=>row.id===id);if(!row)throw Error("图像会话已不存在");row.draft=draft})}
 async root(path:string){if(!isAbsolute(path))throw Error("输出目录必须是绝对路径");await mkdir(path,{recursive:true});const canonical=await realpath(path);await this.ready;await this.store.mutate(state=>{state.outputRoot=canonical});return canonical}
 async remove(id:string){await this.ready;await this.store.mutate(state=>{const row=state.conversations.find(row=>row.id===id);if(row?.jobs.some(record=>busy(record.job)))throw Error("请先取消此会话的图像任务");state.conversations=state.conversations.filter(row=>row.id!==id)})}
 /** The CLI session that carries this conversation's context between generations. */
 async setCliSession(id:string,cliSessionId:string|undefined){await this.ready;await this.store.mutate(state=>{const row=state.conversations.find(row=>row.id===id);if(row)row.cliSessionId=cliSessionId})}
 /**
  * Removes one picture from a generation. A completed record with no pictures left is dropped,
  * so the gallery never keeps an empty "success" that shows up as a failure.
  */
 async removeArtifact(conversationId:string,jobId:string,artifactId:string):Promise<{cwd:string;savedPath?:string;recordRemoved:boolean}>{
  await this.ready;
  let removed!:{cwd:string;savedPath?:string;recordRemoved:boolean};
  await this.store.mutate(state=>{
   const row=state.conversations.find(value=>value.id===conversationId);
   if(!row)throw Error("图像会话已不存在");
   const index=row.jobs.findIndex(record=>record.job.jobId===jobId);
   if(index<0)throw Error("这条生成记录已不存在");
   const record=row.jobs[index]!;
   if(busy(record.job))throw Error("请先取消正在运行的图像任务");
   const at=record.job.artifacts.findIndex(artifact=>artifact.id===artifactId);
   if(at<0)throw Error("这张图片已不存在");
   const [artifact]=record.job.artifacts.splice(at,1);
   record.job.savedProjectFiles=record.job.savedProjectFiles?.filter(path=>path!==artifact!.savedPath);
   if(!record.job.savedProjectFiles?.length)delete record.job.savedProjectFiles;
   const recordRemoved=record.job.status==="completed"&&!record.job.artifacts.length;
   if(recordRemoved)row.jobs.splice(index,1);
   row.updatedAt=new Date().toISOString();
   removed={cwd:row.cwd,savedPath:artifact!.savedPath,recordRemoved};
  });
  return removed;
 }
 async rename(id:string,title:string){
  const value=title.trim().slice(0,80);if(!value)throw Error("会话名称不能为空");
  await this.ready;await this.store.mutate(state=>{const row=state.conversations.find(row=>row.id===id);if(!row)throw Error("图像会话已不存在");row.title=value;row.titleLocked=true});
 }
 /** Removes one generation record (finished, failed or cancelled). A running job must be cancelled first. */
 async removeJob(conversationId:string,jobId:string):Promise<{cwd:string;job:MediaGenerationJob}>{
  await this.ready;
  let removed!:{cwd:string;job:MediaGenerationJob};
  await this.store.mutate(state=>{
   const row=state.conversations.find(value=>value.id===conversationId);
   if(!row)throw Error("图像会话已不存在");
   const index=row.jobs.findIndex(record=>record.job.jobId===jobId);
   if(index<0)throw Error("这条生成记录已不存在");
   const record=row.jobs[index]!;
   if(busy(record.job))throw Error("请先取消正在运行的图像任务");
   removed={cwd:row.cwd,job:structuredClone(record.job)};
   row.jobs.splice(index,1);
   row.updatedAt=new Date().toISOString();
  });
  return removed;
 }
 async reserve(input:ImageSubmit):Promise<{created:boolean;job:MediaGenerationJob}>{
  await this.ready;let result!:{created:boolean;job:MediaGenerationJob};
  // Create the destination before the transaction; publish its identity only with the reserved request.
  const snapshot=await this.store.get();const existing=snapshot.conversations.find(row=>row.id===input.conversationId);if(!existing)throw Error("图像会话已不存在");
  // A conversation keeps the folder it was created in. The CLI session's history lives per folder, so
  // moving it after an output-root change made --resume fail and silently dropped the context.
  const directory=existing.cwd||join(snapshot.outputRoot,input.conversationId);
  await mkdir(directory,{recursive:true});const cwd=await realpath(directory);
  const destination=join(snapshot.outputRoot,input.conversationId);await mkdir(destination,{recursive:true});const outputRoot=await realpath(destination);
  await this.store.mutate(state=>{
   const row=state.conversations.find(row=>row.id===input.conversationId);if(!row)throw Error("图像会话已不存在");
   const existing=row.jobs.find(record=>record.requestId===input.requestId);if(existing){result={created:false,job:existing.job};return}
   if(row.jobs.some(record=>busy(record.job)))throw Error("此图像会话已有任务在运行");
   if(state.outputRoot!==snapshot.outputRoot)throw Error("输出目录刚刚改变，请重试提交");
   const now=new Date().toISOString(),job:MediaGenerationJob={jobId:randomUUID(),sessionId:row.id,kind:"image",route:input.request.route==="provider"?"provider":"cli",status:"queued",message:"正在提交图像任务",artifacts:[],outputRoot,startedAt:now,updatedAt:now};
   row.cwd=cwd;row.updatedAt=now;if(!row.titleLocked&&!row.firstRequestAt&&row.jobs.length===0&&row.title==="新图像会话")row.title=input.request.prompt.trim().slice(0,60);row.firstRequestAt??=row.jobs[0]?.job.startedAt??now;row.draft="";row.jobs.push({requestId:input.requestId,prompt:input.request.prompt,aspectRatio:input.request.aspectRatio,references:{names:(input.request.referencePaths??[]).map(path=>basename(path)),sources:[...(input.referenceSources??[])]},job});result={created:true,job};
  });return result;
 }
 async update(job:MediaGenerationJob){if(!job.sessionId.startsWith("image-"))return;await this.ready;const copy=structuredClone(job);await this.store.mutate(state=>{const row=state.conversations.find(row=>row.id===copy.sessionId);const record=row?.jobs.find(record=>record.job.jobId===copy.jobId);if(record && Date.parse(copy.updatedAt)>=Date.parse(record.job.updatedAt)){record.job=copy;row!.updatedAt=copy.updatedAt}})}
}
