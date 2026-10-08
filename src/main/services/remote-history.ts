import type { ChatEvent } from "../../shared/types";
const bounded=(value:string,limit=32768)=>value.length>limit?value.slice(0,limit)+"\n…内容较长，请在电脑查看完整结果":value;
export function sanitizeRemoteEvent(event:ChatEvent):ChatEvent {
  if(event.type==="tool-call")return {type:event.type,sessionId:event.sessionId,tool:{toolCallId:event.tool.toolCallId,title:bounded(event.tool.title,1024),status:event.tool.status,kind:event.tool.kind,output:typeof event.tool.output==="string"?bounded(event.tool.output):undefined}};
  if(event.type==="user-message")return {...event,text:bounded(event.text),attachments:undefined};
  if(event.type==="message-chunk"||event.type==="thought-chunk"||event.type==="plan")return {...event,text:bounded(event.text)};
  if(event.type==="error")return {type:"error",sessionId:event.sessionId,message:bounded(event.message,8192),...(event.failure?{failure:{failureId:event.failure.failureId,at:event.failure.at,classification:event.failure.classification,message:bounded(event.failure.message,8192),turnId:event.failure.turnId,processExitCode:event.failure.processExitCode,cancelled:event.failure.cancelled}}:{})};
  if(event.type==="subagent"){const update:typeof event.update={};for(const [key,value] of Object.entries(event.update))if(typeof value==="string")update[key]=bounded(value,key==="output"?16384:2048);else if(typeof value==="number"||typeof value==="boolean")update[key]=value;return {...event,update};}
  if(event.type==="prompt-queue")return {...event,entries:event.entries.map(({id,sessionId,text,position,createdAt,state,clientMessageId})=>({id,sessionId,text:bounded(text,4096),position,createdAt,state,clientMessageId}))};
  if(event.type==="permission"){
    const value=event.request.toolCall&&typeof event.request.toolCall==="object"?event.request.toolCall as Record<string,unknown>:{};
    const input=value.rawInput??value.input??value.arguments;const data=input&&typeof input==="object"?input as Record<string,unknown>:{};
    const detail=data.command??data.cmd??data.path??data.file_path??input;
    return {...event,request:{...event.request,toolCall:{title:typeof value.title==="string"?bounded(value.title,512):typeof value.description==="string"?bounded(value.description,512):"电脑请求执行操作",rawInput:bounded(typeof detail==="string"?detail:JSON.stringify(detail??value,null,2),4096),summary:bounded(JSON.stringify(value),4096)}}};
  }
  return structuredClone(event);
}
export function remotePendingInteractions(events:ChatEvent[]):ChatEvent[] {
  const pending=new Map<string,ChatEvent>();
  for(const event of events){
    if(event.type==="permission")pending.set(`permission:${event.request.requestId}`,sanitizeRemoteEvent(event));
    if(event.type==="question")pending.set(`question:${event.requestId}`,event);
    if(event.type==="plan"&&event.requestId!==undefined)pending.set(`plan:${event.requestId}`,event);
    if(event.type==="interaction-resolved")pending.delete(`${event.interaction}:${event.requestId}`);
    if(event.type==="session-reset"||event.type==="turn-completed"||event.type==="error")pending.clear();
  }
  return [...pending.values()];
}
