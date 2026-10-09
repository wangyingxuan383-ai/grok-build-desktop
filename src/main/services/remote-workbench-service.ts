import { randomUUID } from "node:crypto";
import { open,stat } from "node:fs/promises";
import { basename } from "node:path";
import { z } from "zod";
import type { AppController } from "../app-controller";
import type { RemoteMutation } from "../../shared/remote";
import {REASONING_EFFORTS} from "../../shared/types";
import type { AutomationTaskInput, MediaCreationRequest } from "../../shared/types";
import { RemoteFiles } from "./remote-files";

interface Asset {owner:string;path?:string;html?:string;mimeType:string;name:string;expires:number;sessionId:string}
const text=z.string().min(1).max(65536),id=z.string().min(1).max(256),flag=z.boolean();
const dataSchemas:Record<RemoteMutation["kind"],z.ZodType>={
 "image.create":z.object({}).strict(),"image.rename":z.object({title:z.string().min(1).max(80)}).strict(),
 "image.submit":z.object({request:z.object({kind:z.enum(["image","video"]),prompt:text,aspectRatio:z.enum(["auto","1:1","16:9","9:16","4:3","3:4"]),route:z.enum(["cli","provider"]).optional(),modelId:id.optional(),providerId:id.optional(),duration:z.number().optional(),resolution:z.enum(["480p","720p"]).optional()}).strict(),attachmentIds:z.array(id).max(12).optional(),referenceSources:z.array(z.string().max(4096)).max(12).optional()}).strict(),
 "code.image.submit":z.object({prompt:text,aspectRatio:z.enum(["auto","1:1","16:9","9:16","4:3","3:4"]),modelId:id.optional(),attachmentIds:z.array(id).max(12).optional()}).strict(),"image.cancel":z.object({}).strict(),"image.delete":z.object({deleteFiles:flag.optional()}).strict(),"image.record.delete":z.object({jobId:id,deleteFiles:flag.optional()}).strict(),
 "automation.create":z.object({workspaceId:id,input:z.record(z.string(),z.unknown()),configuration:z.object({modelId:id.optional(),providerId:id.optional(),effort:z.enum(REASONING_EFFORTS).optional(),mode:z.enum(["auto","agent","plan"]).optional()}).strict().optional()}).strict(),"automation.update":z.object({revision:z.number().int(),workspaceId:id.optional(),patch:z.record(z.string(),z.unknown())}).strict(),
 "automation.pause":z.object({paused:flag}).strict(),"automation.delete":z.object({}).strict(),"automation.run":z.object({}).strict(),"automation.cancel":z.object({}).strict(),"automation.confirm":z.object({approved:flag}).strict(),
 "inbox.read":z.object({read:flag}).strict(),"computer.permission":z.object({decision:z.enum(["once","always","deny"])}).strict(),"computer.risk":z.object({approved:flag}).strict(),"task.cancel":z.object({}).strict(),"account.switch":z.object({}).strict(),
 "notification.register":z.object({token:z.string().min(1).max(4096),deliveryVersion:z.literal(2).optional()}).strict(),"notification.unregister":z.object({}).strict(),
 "session.compaction":z.object({mode:z.enum(["inherit","custom"]),thresholdPercent:z.number().int().min(60).max(95).optional()}).strict(),
};
/** The remote surface delegates to the original services; it stores only transfer tickets. */
export class RemoteWorkbenchService {
 readonly files:RemoteFiles;
 private assets=new Map<string,Asset>();
 constructor(private readonly controller:AppController,root:string){this.files=new RemoteFiles(root)}
 async known(id:string){if((await this.controller.remoteSessions()).some(s=>s.id===id)||(await this.controller.listImageWorkspace()).conversations.some(s=>s.id===id))return;throw Error("会话已不存在，请刷新后选择")}
 private async session(id:string){const row=(await this.controller.remoteSessions()).find(s=>s.id===id);if(!row)throw Error("会话已不存在");return row}
 private ticket(asset:Omit<Asset,"expires">){for(const [key,value]of this.assets)if(value.expires<Date.now())this.assets.delete(key);if(this.assets.size>256)this.assets.delete(this.assets.keys().next().value!);const ticket=randomUUID();this.assets.set(ticket,{...asset,expires:Date.now()+3600000});return {ticket,name:asset.name,mimeType:asset.mimeType,sessionId:asset.sessionId}}
 async query(params:URLSearchParams,owner:string):Promise<unknown>{
  const kind=params.get("kind")??"overview",sessionId=params.get("sessionId")??"";
  if(kind==="notifications")return {serverTime:Date.now(),items:(await this.controller.listInbox()).filter(item=>!item.read).slice(0,50)};
  if(kind==="push-status")return this.controller.remotePushStatus(owner);
  if(kind==="overview"){
   const keys=["tasks","automations","runs","inbox","images","accounts"];
   const results=await Promise.allSettled([this.controller.listBackgroundTasks(),this.controller.listAutomations(),this.controller.listAutomationRuns(),this.controller.listInbox(),this.controller.listImageWorkspace(),this.controller.listAccounts()]);
   const output:Record<string,unknown>={serverTime:Date.now(),errors:[]};results.forEach((result,index)=>{if(result.status==="fulfilled")output[keys[index]!]=result.value;else(output.errors as string[]).push(`${keys[index]}: ${result.reason instanceof Error?result.reason.message:String(result.reason)}`)});return output;
  }
  if(kind==="automation"){const target=params.get("target")??"";const row=(await this.controller.listAutomations()).find(t=>t.id===target);if(!row)throw Error("定时任务已不存在");return {task:row,prompt:await this.controller.readAutomationInstructions(target),runs:await this.controller.listAutomationRuns(target)}}
  if(kind==="image-models")return this.controller.getMediaCapabilities(sessionId);
  if(kind==="image"){const row=(await this.controller.listImageWorkspace()).conversations.find(s=>s.id===sessionId);if(!row)throw Error("图像会话已不存在");return row}
  if(kind==="code-images")return (await this.controller.listCodeImages()).map(artifact=>({...artifact,source:artifact.url}));
  if(kind==="quota")return this.controller.getQuota(params.get("refresh")==="1");
  if(kind==="mobile-update")return this.controller.checkAppUpdate(false);
  if(kind==="updates")return this.controller.checkUpdatesAutomatically();
  if(kind==="usage")return {history:await this.controller.getTokenActivity(),process:sessionId?await this.controller.getCliSessionUsage(sessionId).catch(error=>({unavailable:true,reason:String(error)})):undefined};
  if(kind==="asset-chunk"){
   const asset=this.assets.get(params.get("ticket")??"");if(!asset||asset.owner!==owner||asset.expires<Date.now()||!asset.path)throw Error("文件预览已过期，请重新打开");
   const offset=Number(params.get("offset")??0);if(!Number.isSafeInteger(offset)||offset<0)throw Error("文件位置无效");const info=await stat(asset.path);if(offset>info.size)throw Error("文件位置超过大小");const file=await open(asset.path,"r");try{const buffer=Buffer.alloc(Math.min(256*1024,info.size-offset));const {bytesRead}=await file.read(buffer,0,buffer.length,offset);return {data:buffer.subarray(0,bytesRead).toString("base64"),offset,next:offset+bytesRead,size:info.size,name:asset.name,mimeType:asset.mimeType}}finally{await file.close()}
  }
  if(kind==="media"){
   const source=params.get("source")??"";if(!source.startsWith("grok-media://access/"))throw Error("请从实际生成作品打开文件");const value=await this.controller.resolveRemoteMediaRequest(source);await this.known(value.sessionId);return {...this.ticket({owner,path:value.path,mimeType:value.mimeType,name:basename(value.path),sessionId:value.sessionId}),size:value.size};
  }
  const session=await this.session(sessionId);
  if(["files","artifact","review"].includes(kind))await this.controller.trustRemoteWorkspace(sessionId);
  if(kind==="child")return this.controller.inspectRemoteChild(sessionId,params.get("childId")??"");
  if(kind==="context")return {...await this.controller.getCliSessionInfo(sessionId),compaction:(await this.controller.getSessionRuntimePreferences(sessionId))?.compaction};
  if(kind==="files")return this.controller.listWorkspaceTree(session.cwd,params.get("path")??"",{showHidden:false});
  if(kind==="artifact"){
   const artifact=await this.controller.readWorkspaceArtifact(session.cwd,params.get("path")??"");
   return {...this.ticket({owner,path:artifact.path,html:artifact.kind==="html"?artifact.previewUrl:undefined,mimeType:artifact.mimeType??"text/plain",name:basename(artifact.path),sessionId}),kind:artifact.kind,size:(await stat(artifact.path)).size,content:["text","office"].includes(artifact.kind)?artifact.data.slice(0,512*1024):undefined};
  }
  if(kind==="review")return {status:await this.controller.getGitStatus(session.cwd),diff:await this.controller.getGitDiff(session.cwd,params.get("staged")==="1",params.get("path")??undefined)};
  if(kind==="tools")return {tools:await this.controller.getSessionMcpTools(sessionId).catch(error=>({tools:[],notice:String(error)})),skills:await this.controller.listSkills(),plugins:await this.controller.listPlugins(),computer:await this.controller.getComputerCapability(sessionId)};
  if(kind==="rewind")return this.controller.listRewindPoints(sessionId);
  if(kind==="search"){
   const query=(params.get("q")??"").trim().toLocaleLowerCase();if(!query||query.length>200)throw Error("请输入 1–200 字符搜索内容");const projection=await this.controller.inspectSession(session.cwd,sessionId);
   return {sessionId,matches:(projection?.events??[]).flatMap((event,index)=>{const value="text"in event?event.text:"message"in event?event.message:event.type==="tool-call"?(event as {tool?:{output?:unknown}}).tool?.output:undefined;return typeof value==="string"&&value.toLocaleLowerCase().includes(query)?[{index,type:event.type,text:value.slice(Math.max(0,value.toLocaleLowerCase().indexOf(query)-100),value.toLocaleLowerCase().indexOf(query)+600)}]:[]}).slice(0,100)};
  }
  if(kind==="outline"){
   const before=params.has("before")?Number(params.get("before")):undefined;
   if(before!==undefined&&(!Number.isSafeInteger(before)||before<0))throw Error("分页位置无效");
   const query=(params.get("q")??"").trim();if(query.length>200)throw Error("查找内容最多 200 字符");
   const projection=await this.controller.inspectSession(session.cwd,sessionId);
   return remoteConversationOutline(sessionId,projection?.events??[],before,query);
  }
  throw Error("此版本未开放该查询");
 }
 async resource(ticket:string,suffix:string,owner:string):Promise<{body:Uint8Array;mimeType:string;headers?:Record<string,string>;status?:number}>{
  const asset=this.assets.get(ticket);if(!asset||asset.owner!==owner||asset.expires<Date.now())throw Error("预览已过期，请重新打开");
  if(asset.html&&suffix!=="file"){const original=new URL(asset.html);if(suffix&&suffix!=="index.html")original.pathname+="/assets/"+suffix.replace(/^assets\//,"");const response=await this.controller.htmlPreviewResponse(original.href);const mimeType=response.headers.get("content-type")??"text/html";const body=mimeType.startsWith("text/html")?Buffer.from((await response.text()).replaceAll(new URL(asset.html).href+"/assets/",`/v1/preview/${ticket}/assets/`)):new Uint8Array(await response.arrayBuffer());return {body,mimeType,status:response.status,headers:{"Content-Security-Policy":"sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; form-action 'none'; object-src 'none'"}}}
  if(!asset.path)throw Error("文件已不可用");const info=await stat(asset.path);if(info.size>50*1024*1024)throw Error("此文件超过手机预览上限，可在电脑查看");const {readFile}=await import("node:fs/promises");return {body:await readFile(asset.path),mimeType:asset.mimeType};
 }
 async mutate(mutation:RemoteMutation,owner:string,operationId:string):Promise<{state:"completed";resultSessionId?:string;message?:string}>{
  const parsed=dataSchemas[mutation.kind].safeParse(mutation.data??{});if(!parsed.success)throw Error("操作参数无效："+parsed.error.issues.map(i=>i.path.join(".")+" "+i.message).join("；"));
  const data=parsed.data as Record<string,unknown>,target=mutation.target??"",c=this.controller;let resultSessionId:string|undefined;
  switch(mutation.kind){
   case "session.compaction":{const session=await this.session(target);const runtime=(await c.remoteSnapshot(target)).runtime;if(!session.canSend||!runtime?.mutable)throw Error(runtime?.reason||"当前会话不可修改配置");await c.setSessionCompactionPolicy(target,{mode:data.mode as "inherit"|"custom",...(data.mode==="custom"?{thresholdPercent:Number(data.thresholdPercent??80)}:{})});break}
   case "image.create":resultSessionId=(await c.createImageConversation()).id;break;
   case "image.rename":await c.renameImageConversation(target,String(data.title));break;
   case "image.submit":{await this.known(target);const attachments=await this.files.attachments((data.attachmentIds??[])as string[],owner,target);await c.trustRemoteAttachments(attachments);const request={...(data.request as MediaCreationRequest),referencePaths:attachments.map(a=>a.path!).filter(Boolean)};const result=await c.submitImage({conversationId:target,requestId:operationId,request,referenceSources:data.referenceSources as string[]|undefined});if(result.status==="failed")throw Error(result.error??"生成提交失败");break}
   case "code.image.submit":{const session=await this.session(target);if(!session.canSend)throw Error("请选择可写主会话");const attachments=await this.files.attachments((data.attachmentIds??[])as string[],owner,target);await c.trustRemoteAttachments(attachments);await c.startMediaGeneration({sessionId:target,kind:"image",prompt:String(data.prompt),aspectRatio:data.aspectRatio as MediaCreationRequest["aspectRatio"],route:"cli",modelId:data.modelId as string|undefined,referencePaths:attachments.map(a=>a.path!).filter(Boolean),projectOutputDirectory:"generated"});break} case "image.cancel":c.cancelMediaGeneration(target);break;
   case "image.delete":await c.deleteImageConversation(target,data.deleteFiles===true);break;
   case "image.record.delete":await c.deleteImageJob(target,String(data.jobId),data.deleteFiles===true);break;
   case "automation.create":{const options=await c.remoteOptions();const workspace=options.workspaces.find(w=>w.id===data.workspaceId);if(!workspace?.path)throw Error("请选择已有项目");const input=data.input as Record<string,unknown>;const created=await c.createRemoteAutomation({...input,workspace:workspace.path}as unknown as AutomationTaskInput,data.configuration as Partial<AutomationTaskInput["profile"]>|undefined);resultSessionId=created.id;if(created.registrationStatus!=="registered")throw Object.assign(Error("任务定义已保存，但调度尚未注册："+(created.registrationError||created.registrationStatus)),{resultSessionId:created.id});break}
   case "automation.update":{const current=(await c.listAutomations()).find(t=>t.id===target);if(!current||(current.revision??0)!==data.revision)throw Error("任务已被其他端修改，请刷新后再保存");const patch=data.patch as Record<string,unknown>;if(Object.keys(patch).some(k=>["id","revision","sessionId","workspace","frozenExecutionProfile"].includes(k)))throw Error("不能直接改写任务内部身份，请选择已知项目");if(data.workspaceId){const workspace=(await c.remoteOptions()).workspaces.find(w=>w.id===data.workspaceId);if(!workspace?.path)throw Error("所选项目已不可用");patch.workspace=workspace.path}const updated=await c.updateAutomation(target,patch as Partial<AutomationTaskInput>,Number(data.revision));const saved=updated.find(t=>t.id===target);if(saved&&saved.registrationStatus!=="registered")throw Object.assign(Error("任务修改已保存，但调度尚未注册："+(saved.registrationError||saved.registrationStatus)),{resultSessionId:target});break}
   case "automation.pause":await c.pauseAutomation(target,data.paused===true);break;
   case "automation.delete":await c.deleteAutomation(target);break;
   case "automation.run":await c.runAutomationNow(target);break;
   case "automation.cancel":await c.cancelAutomationRun(target);break;
   case "automation.confirm":await c.respondAutomationPending(target,data.approved===true);break;
   case "inbox.read":await c.markInboxRead(target,data.read===true);break;
   case "computer.permission":await c.respondComputerAppPermission(target,data.decision as "once"|"always"|"deny");break;
   case "computer.risk":await c.respondComputerRisk(target,data.approved===true);break;
   case "task.cancel":await c.killBackgroundTask(target);break;
   case "account.switch":await c.switchAccount(target);break;
   case "notification.register":await c.registerRemotePush(owner,String(data.token),data.deliveryVersion===2?2:1);break;
   case "notification.unregister":await c.unregisterRemotePush(owner);break;
  }
  return {state:"completed",resultSessionId};
 }
}
import { remoteConversationOutline } from "./remote-conversation-outline";
