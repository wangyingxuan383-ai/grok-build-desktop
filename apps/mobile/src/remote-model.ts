export interface PairingOffer {host:string;fingerprint:string;code:string;hosts?:string[]}
export function parsePairingOffer(raw:string):PairingOffer {
  const offer=new URL(raw.trim());if(offer.protocol!=="grokremote:"||offer.hostname!=="pair"||offer.searchParams.get("v")!=="1")throw Error("请使用电脑“手机连接”页面生成的完整配对链接");
  const host=new URL(offer.searchParams.get("host")||"");const fingerprint=(offer.searchParams.get("fp")||"").toLowerCase();const code=offer.searchParams.get("code")||"";
  if(host.protocol!=="https:"||host.username||host.password||host.search||host.hash||host.pathname!=="/"||!/^([a-f0-9]{64})$/.test(fingerprint)||!/^[A-Za-z0-9_-]{32,128}$/.test(code))throw Error("配对链接无效，请在电脑重新生成");
  let hosts:string[]|undefined;if(offer.searchParams.has("hosts")){const values=JSON.parse(offer.searchParams.get("hosts")!);if(!Array.isArray(values)||values.length>8)throw Error("配对地址列表无效");hosts=[...new Set([host.origin,...values.map((value:unknown)=>{const candidate=new URL(String(value));if(candidate.protocol!=="https:"||candidate.username||candidate.password||candidate.search||candidate.hash||candidate.pathname!=="/")throw Error("配对地址无效");return candidate.origin})])]}
  return {host:host.origin,fingerprint,code,...(hosts?{hosts}:{})};
}
// Adapted from Paseo's PairingTargetTracker (Apache-2.0), see THIRD_PARTY_NOTICES.md.
export class PairingTargetTracker {
  private target:string|null=null;
  changeUrl(value:string):boolean {let next:string;try{const offer=parsePairingOffer(value);next=offer.fingerprint}catch{return false}const changed=this.target!==null&&next!==this.target;this.target=next;return changed;}
}
export interface MobileMessage {id:string;role:"user"|"assistant"|"thought"|"tool"|"agent"|"error"|"plan"|"status"|"media";text:string;title?:string;status?:string;childSessionId?:string;childTokens?:number;remoteIndex?:number;source?:string;requestId?:string|number;remoteEnd?:number}
export type WireEvent={type:string;sessionId?:string;remoteIndex?:number;text?:string;message?:string;id?:string;clientMessageId?:string;delivery?:string;failure?:{turnId?:string};tool?:{toolCallId:string;title:string;status:string;output?:string};update?:Record<string,unknown>};
export function readableToolText(value:string):string{return value.replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g,"").replace(/\u001b\[[0-?]*[ -/]*[@-~]/g,"").replace(/\r(?!\n)/g,"\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001a]/g,"");}
export function mergeEventWindows(...windows:WireEvent[][]):WireEvent[]{
 const indexed=new Map<number,WireEvent>(),unindexed:WireEvent[]=[],ranges:Array<[number,number]>=[];
 for(const window of windows){
   let start:number|undefined,end:number|undefined;
   const finish=()=>{if(start!==undefined&&end!==undefined)ranges.push([start,end]);start=end=undefined};
   for(const event of window){
     if(event.type==="history-gap"){finish();continue}
     if(event.remoteIndex===undefined){unindexed.push(event);continue}
     indexed.set(event.remoteIndex,event);start=Math.min(start??event.remoteIndex,event.remoteIndex);end=Math.max(end??event.remoteIndex,event.remoteIndex);
   }finish();
 }
 // Gaps in one response may just be deliberately omitted internal events.
 // Only disjoint *page ranges* represent a hole in loaded history.
 const covered:Array<[number,number]>=[];
 for(const range of ranges.sort((a,b)=>a[0]-b[0])){const last=covered.at(-1);if(last&&range[0]<=last[1]+1)last[1]=Math.max(last[1],range[1]);else covered.push([...range])}
 const markers=new Map(covered.slice(1).map((range,index)=>[range[0],covered[index]![1]+1]));
 const result=[...unindexed];
 for(const[index,event]of [...indexed.entries()].sort(([a],[b])=>a-b)){const gap=markers.get(index);if(gap!==undefined)result.push({type:"history-gap",remoteIndex:gap,text:"中间还有未加载的记录，以下是另一个历史片段。"});result.push(event)}return result;
}
export function messagesFromEvents(events:WireEvent[]):MobileMessage[] {
  const messages:MobileMessage[]=[];const tools=new Map<string,number>();const users=new Map<string,number>();let assistantIndex:number|undefined,thoughtIndex:number|undefined,turnActive=false;
  for(let i=0;i<events.length;i++){
    const event=events[i]!;
    if(event.type==="user-message"||event.type==="interjection"){const id=event.clientMessageId||event.id||`user:${event.remoteIndex??i}`;const old=users.get(id);const row:MobileMessage={id,role:"user",text:event.text||"",...(event.remoteIndex!==undefined?{remoteIndex:event.remoteIndex,remoteEnd:event.remoteIndex}:{})};if(old===undefined){assistantIndex=undefined;thoughtIndex=undefined;users.set(id,messages.length);messages.push(row)}else messages[old]=row;}
    else if(event.type==="user-message-status"){const index=users.get(event.clientMessageId||"");if(index!==undefined)messages[index]!.status=event.delivery;}
    else if(event.type==="history-gap"){assistantIndex=undefined;thoughtIndex=undefined;messages.push({id:`gap:${event.remoteIndex??i}`,role:"status",title:"未加载的历史",text:event.text||"中间还有未加载的记录。",remoteIndex:event.remoteIndex});}
    else if(event.type==="turn-started"||event.type==="turn-completed"||event.type==="session-reset"){assistantIndex=undefined;thoughtIndex=undefined;turnActive=event.type==="turn-started";}
    else if(event.type==="message-chunk"||event.type==="thought-chunk"){const role=event.type==="message-chunk"?"assistant":"thought";const existing=role==="assistant"?assistantIndex:thoughtIndex;if(existing!==undefined){messages[existing]!.text+=event.text||"";if(event.remoteIndex!==undefined)messages[existing]!.remoteEnd=event.remoteIndex;}else {const index=messages.length;messages.push({id:`${role}:${event.remoteIndex??i}`,role,text:event.text||"",...(event.remoteIndex!==undefined?{remoteIndex:event.remoteIndex,remoteEnd:event.remoteIndex}:{})});if(role==="assistant")assistantIndex=index;else thoughtIndex=index;}}
    else if(event.type==="tool-call"&&event.tool){const tool=event.tool;const old=tools.get(tool.toolCallId);const row:MobileMessage={id:`tool:${tool.toolCallId}`,role:"tool",text:tool.output||"",title:tool.title,status:tool.status,...(event.remoteIndex!==undefined?{remoteIndex:old!==undefined?messages[old]?.remoteIndex??event.remoteIndex:event.remoteIndex,remoteEnd:event.remoteIndex}:{})};if(old===undefined){tools.set(tool.toolCallId,messages.length);messages.push(row)}else messages[old]=row;}
    else if(event.type==="subagent"&&event.update){const update=event.update;const candidate=update.childSessionId||update.child_session_id||update.session_id;const child=typeof candidate==="string"&&candidate!==event.sessionId?candidate:undefined;const identity=String(update.subagent_id||child||i);const index=messages.findIndex(row=>row.id===`agent:${identity}`);const previous=index>=0?messages[index]:undefined;const title=String(update.description||update.task||update.title||previous?.title||"子智能体");const text=String(update.output||update.last_tool||update.lastTool||previous?.text||"");const row:MobileMessage={id:`agent:${identity}`,role:"agent",title,text,status:String(update.status||update.sessionUpdate||previous?.status||"更新"),...((typeof update.tokens_used==="number"||previous?.childTokens!==undefined)?{childTokens:typeof update.tokens_used==="number"?update.tokens_used:previous?.childTokens}:{}),childSessionId:typeof child==="string"?child:previous?.childSessionId};if(index>=0)messages[index]={...messages[index],...row};else messages.push(row);}
    else if(event.type==="computer-state"){const state=(event as WireEvent&{state?:Record<string,unknown>}).state;if(state){const id="computer:"+(event.sessionId||"current"),old=messages.findIndex(row=>row.id===id);const count=(key:string)=>typeof state[key]==="number"?String(state[key]):"未知";const row:MobileMessage={id,role:"status",title:"Computer 执行状态",status:String(state.status||"未知"),text:`${String(state.message||state.headline||state.status||"状态已更新")}\n观察 ${count("observationCount")} · 窗口控制 ${count("controlCount")} · 应用操作 ${count("operationCount")}${state.appName?"\n应用 "+state.appName:""}`,remoteIndex:event.remoteIndex};if(old>=0)messages[old]=row;else messages.push(row);}}
    else if(event.type==="error"){
      const connectionEnd=/^Grok 进程已退出（代码 [^)]+）$/.test(event.message||"")&&!turnActive&&!event.failure?.turnId;
      messages.push({id:`error:${event.remoteIndex??i}`,role:connectionEnd?"status":"error",title:connectionEnd?"连接记录":undefined,text:connectionEnd?"当时的 CLI 连接已结束。查看会话不会启动执行；发送消息时会重新连接。":event.message||"执行失败",remoteIndex:event.remoteIndex});turnActive=false;
    }
    else if(event.type==="status"&&event.text)messages.push({id:`status:${event.remoteIndex??i}`,role:"status",title:"连接记录",text:event.text,remoteIndex:event.remoteIndex});
    else if(event.type==="plan"){assistantIndex=undefined;thoughtIndex=undefined;const request=(event as WireEvent&{requestId?:string|number;remoteEnd?:number}).requestId;messages.push({id:`plan:${event.remoteIndex??i}`,role:"plan",text:event.text||"",title:"执行计划",requestId:request,remoteIndex:event.remoteIndex});}
    else if(event.type==="interaction-resolved"){const resolved=event as WireEvent&{requestId?:string|number;interaction?:string;outcome?:string};if(resolved.interaction==="plan")for(const row of messages)if(row.role==="plan"&&row.requestId===resolved.requestId)row.status=resolved.outcome||"已处理";}
    else if(["compact-status","session-recap","turn-retry","command-output"].includes(event.type)){const value=event as WireEvent&{output?:string;status?:string;reason?:string;command?:string};messages.push({id:`status:${event.remoteIndex??i}`,role:"status",title:({"compact-status":"上下文压缩","session-recap":"会话摘要","turn-retry":"重试等待","command-output":"命令输出"}as Record<string,string>)[event.type],text:value.output||value.text||value.reason||value.status||"",remoteIndex:event.remoteIndex});}
    else if(event.type==="media"){const value=event as WireEvent&{source?:string};messages.push({id:`media:${event.remoteIndex??i}`,role:"media",text:"点击查看实际产物",source:value.source,remoteIndex:event.remoteIndex});}
  }
  // Delivery evidence can precede a slow user echo in older desktop journals.
  const deliveries=new Map(events.filter(event=>event.type==="user-message-status").map(event=>[event.clientMessageId,event.delivery]));
  return messages.map(message=>({...message,...(message.role==="user"&&deliveries.has(message.id)?{status:deliveries.get(message.id)}:{}),...(["tool","status"].includes(message.role)?{text:readableToolText(message.text)}:{})}));
}
export interface ConversationRow {id:string;message?:MobileMessage;activity?:MobileMessage[]}
export function conversationRows(messages:MobileMessage[]):ConversationRow[]{
 const result:ConversationRow[]=[];let turn:MobileMessage[]=[];
 const flush=()=>{if(!turn.length)return;const activity=turn.filter(m=>["tool","agent","thought","status"].includes(m.role)&&!m.id.startsWith("gap:"));if(activity.length)result.push({id:`activity:${activity[0]!.id}`,activity});for(const row of turn)if(!activity.includes(row))result.push({id:row.id,message:row});turn=[];};
 for(const row of messages){if(row.role==="user"){flush();result.push({id:row.id,message:row})}else turn.push(row);}flush();return result;
}
export function sessionStatusLabel(status:string,canSend=true){if(!canSend&&["idle","cold"].includes(status))return "只读";return ({working:"执行中","needs-user":"待确认",queued:"已排队",error:"上次未完成"} as Record<string,string>)[status]||"";}
export function operationStateLabel(state:string):string {return ({accepted:"电脑已接收",queued:"已排队",running:"执行中",completed:"已完成",failed:"执行失败",cancelled:"本轮已停止",unknown:"结果待确认"} as Record<string,string>)[state]||state;}
