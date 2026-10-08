import { createServer, type Server } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, randomBytes, randomUUID, timingSafeEqual, X509Certificate } from "node:crypto";
import { hostname, networkInterfaces } from "node:os";
import { join } from "node:path";
import { generate } from "selfsigned";
import { JsonStore } from "./json-store";
import { remoteAddressOptions } from "./remote-addresses";
import { extendedRemoteFields } from "./remote-contract";
import Bonjour from "bonjour-service";
import { REMOTE_PROTOCOL, type RemoteCommand, type RemoteGatewayState, type RemoteReceipt, type RemoteSession, type RemoteSnapshot, type RemoteSignal, type RemoteOptions } from "../../shared/remote";
import type { ChatEvent } from "../../shared/types";

interface StoredDevice { id:string;name:string;pairedAt:string;tokenHash:string }
interface Operation extends RemoteReceipt { deviceId:string; digest:string }
interface Persisted { version:1; enabled:boolean;port:number;certificate?:string;privateKey?:string;devices:StoredDevice[];operations:Operation[];operationFloor?:number }
interface PendingPair { id:string;name:string;requestedAt:string;expiresAt:string;bootstrapHash:string;status:"pending"|"approved"|"denied";deviceToken?:string;deviceId?:string }
export interface RemoteBackend {
  sessions():Promise<RemoteSession[]>;
  snapshot(id:string,before?:number,around?:number):Promise<Omit<RemoteSnapshot,"cursor"|"epoch">>;
  options?(refreshModels?:boolean,modelsOnly?:boolean):Promise<RemoteOptions>;
  query?(params:URLSearchParams,deviceId:string):Promise<unknown>;
  upload?(body:Record<string,unknown>,deviceId:string):Promise<unknown>;
  resource?(ticket:string,suffix:string,deviceId:string):Promise<{body:Uint8Array;mimeType:string;headers?:Record<string,string>;status?:number}>;
  tick?(computer:string,devices:string[]):Promise<void>;
  perform(command:RemoteCommand,deviceId?:string):Promise<{state?:RemoteReceipt["state"];message?:string;resultSessionId?:string}|void>;
}
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const sameSecret=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const TERMINAL=new Set(["completed","failed","cancelled","unknown"]);
const idPattern=/^[a-zA-Z0-9_-]{1,160}$/;
const limits={body:96*1024,signals:2048,operations:512,devices:16};

/** Paired devices operate the existing Desktop owner; no independent CLI daemon. */
export class RemoteGatewayService {
  get enabled(){return Boolean(this.server)}
  private readonly store:JsonStore<Persisted>;
  private persisted!:Persisted;
  private initFlight?:Promise<void>; private mutations:Promise<void>=Promise.resolve();
  private server?:Server; private fingerprint?:string; private port=0; private startup?:Promise<void>;
  private pairing?:{token:string;expiresAt:string;address?:string}; private pairs=new Map<string,PendingPair>();
  private subscribers=new Map<ServerResponse,string>(); private signals:RemoteSignal[]=[];
  private cursor=0; private epoch=randomUUID(); private lastError?:string;
  private disposing=false;
  private connectionDiagnostics:{tcp:number;tls:number;requests:number;lastPeer?:string;lastSeen?:string;lastTlsError?:string}={tcp:0,tls:0,requests:0};
  private snapshotFlights=new Map<string,Promise<Omit<RemoteSnapshot,"cursor"|"epoch">>>();
  private timer?:NodeJS.Timeout;
  private discovery?:Bonjour;
  constructor(root:string,private readonly backend:RemoteBackend,private readonly secrets:{encrypt(value:string):string;decrypt(value:string):string},private readonly changed:()=>void=()=>{}) {
    this.store=new JsonStore(join(root,"remote","gateway.json"),{version:1,enabled:false,port:48975,devices:[],operations:[]});
  }
  private initialize():Promise<void>{return this.initFlight??=this.store.get().then(async value=>{this.persisted=value;for(const op of value.operations){if(!TERMINAL.has(op.state)){op.state="unknown";op.message="桌面已重新启动；请查看会话结果后再决定是否重试";op.updatedAt=new Date().toISOString()}}await this.store.set(value)})}
  private mutate(action:()=>void):Promise<void>{const next=this.mutations.then(async()=>{await this.initialize();action();const active=this.persisted.operations.filter(op=>!TERMINAL.has(op.state));const terminal=this.persisted.operations.filter(op=>TERMINAL.has(op.state)&&Date.parse(op.updatedAt)>Date.now()-7*86400000);const kept=[...active,...terminal.slice(-(limits.operations-active.length))].sort((a,b)=>a.createdAt.localeCompare(b.createdAt));const ids=new Set(kept.map(op=>op.operationId));for(const op of this.persisted.operations)if(!ids.has(op.operationId))this.persisted.operationFloor=Math.max(this.persisted.operationFloor??0,Number(op.operationId.slice(0,13))+1);this.persisted.operations=kept;await this.store.set(this.persisted)});this.mutations=next.catch(()=>undefined);return next}
  async startIfEnabled():Promise<void>{await this.initialize();if(this.persisted.enabled)await this.setEnabled(true).catch(error=>{this.lastError=String(error);this.changed()})}
  async setEnabled(enabled:boolean,port?:number):Promise<RemoteGatewayState>{
    await this.initialize();if(port!==undefined&&(!Number.isInteger(port)||port<1024||port>65535))throw Error("端口须为 1024–65535");
    if(!enabled){await this.stop();await this.mutate(()=>{this.persisted.enabled=false});this.changed();return this.state()}
    if(this.server&&port!==undefined&&port!==this.port)throw Error("请先关闭手机连接再修改端口");
    if(!this.server)await(this.startup??=this.listen(port??this.persisted.port).catch(async error=>{if(port===undefined&&String(error).includes("EADDRINUSE"))return this.listen(0);throw error}).finally(()=>{this.startup=undefined}));
    await this.mutate(()=>{this.persisted.enabled=true;this.persisted.port=this.port});this.lastError=undefined;this.changed();return this.state();
  }
  private async listen(port:number):Promise<void>{
    if(!this.persisted.certificate||!this.persisted.privateKey){
      const expires=new Date();expires.setFullYear(expires.getFullYear()+3);
      const keys=await generate([{name:"commonName",value:"Grok Desktop Remote"}],{keyType:"ec",curve:"P-256",algorithm:"sha256",notAfterDate:expires,extensions:[{name:"basicConstraints",cA:false},{name:"keyUsage",digitalSignature:true},{name:"extKeyUsage",serverAuth:true}]});
      await this.mutate(()=>{this.persisted.certificate=keys.cert;this.persisted.privateKey=this.secrets.encrypt(keys.private)});
    }
    const certificate=this.persisted.certificate!;this.fingerprint=new X509Certificate(certificate).fingerprint256.replaceAll(":","").toLowerCase();
    const server=createServer({cert:certificate,key:this.secrets.decrypt(this.persisted.privateKey!),minVersion:"TLSv1.2"},(request,response)=>{void this.route(request,response).catch(error=>this.reply(response,400,{error:error instanceof Error?error.message:"连接请求失败"}))});
    server.on("connection",socket=>{this.connectionDiagnostics.tcp++;this.connectionDiagnostics.lastPeer=socket.remoteAddress;this.connectionDiagnostics.lastSeen=new Date().toISOString()});
    server.on("secureConnection",()=>{this.connectionDiagnostics.tls++;this.connectionDiagnostics.lastSeen=new Date().toISOString()});
    server.on("tlsClientError",(error,socket)=>{this.connectionDiagnostics.lastPeer=socket.remoteAddress;this.connectionDiagnostics.lastSeen=new Date().toISOString();this.connectionDiagnostics.lastTlsError=(error as NodeJS.ErrnoException).code||error.name;this.changed()});
    server.requestTimeout=30000;server.headersTimeout=10000;server.keepAliveTimeout=30000;
    try{await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(port,"0.0.0.0",resolve)});this.port=(server.address() as {port:number}).port;this.server=server}
    catch(error){server.close();throw Error(`手机连接启动失败：${error instanceof Error?error.message:String(error)}`)}
    if(process.env.GROK_DESKTOP_OFFLINE_SMOKE!=="1"&&process.env.VITEST!=="true")try{this.discovery=new Bonjour({},()=>{});this.discovery.publish({name:`Grok ${hostname()}`,type:"grokremote",port:this.port,disableIPv6:true,txt:{fingerprint:this.fingerprint!,protocol:"1"}})}catch{this.discovery?.destroy();this.discovery=undefined}
    this.timer=setInterval(()=>{for(const [id,pair]of this.pairs)if(Date.parse(pair.expiresAt)<=Date.now())this.pairs.delete(id);for(const [response]of this.subscribers)response.write(`data: ${JSON.stringify({type:"heartbeat",cursor:this.cursor,epoch:this.epoch})}\n\n`);void this.backend.tick?.(this.fingerprint!,this.persisted.devices.map(d=>d.id)).catch(()=>undefined);this.changed()},15000);this.timer.unref?.();
  }
  async state():Promise<RemoteGatewayState>{
    await this.initialize();const addressOptions=this.server?remoteAddressOptions(networkInterfaces(),this.port):[];const addresses=addressOptions.map(option=>option.url);
    const base=addresses[0];
    const pairing=this.pairing&&base&&Date.parse(this.pairing.expiresAt)>Date.now()?{code:this.pairing.token,expiresAt:this.pairing.expiresAt,uri:`grokremote://pair?v=1&host=${encodeURIComponent(this.pairing.address??base)}&hosts=${encodeURIComponent(JSON.stringify(addresses.slice(0,3)))}&fp=${this.fingerprint}&code=${this.pairing.token}`}:undefined;
    return{enabled:Boolean(this.server),port:this.server?this.port:this.persisted.port,hostName:hostname(),addresses,addressOptions,connectionDiagnostics:{...this.connectionDiagnostics},fingerprint:this.fingerprint,pairing,pending:[...this.pairs.values()].filter(p=>p.status==="pending"&&Date.parse(p.expiresAt)>Date.now()).map(({id,name,requestedAt,expiresAt})=>({id,name,requestedAt,expiresAt})),devices:this.persisted.devices.map(({id,name,pairedAt})=>({id,name,pairedAt})),error:this.lastError};
  }
  async beginPairing(address?:string):Promise<RemoteGatewayState>{if(!this.server)throw Error("请先开启手机连接");const state=await this.state();if(!state.addresses.length)throw Error("未发现可供手机连接的网络，请连接 Wi-Fi 或有线网络后重试");if(address&&!state.addresses.includes(address))throw Error("请选择当前电脑的连接地址");this.pairing={token:randomBytes(32).toString("base64url"),expiresAt:new Date(Date.now()+5*60000).toISOString(),address};this.pairs.clear();this.changed();return this.state()}
  async decidePair(id:string,approve:boolean):Promise<RemoteGatewayState>{
    const pair=this.pairs.get(id);if(!pair||pair.status!=="pending"||Date.parse(pair.expiresAt)<=Date.now())throw Error("配对申请已过期或已处理");
    if(approve){if(this.persisted.devices.length>=limits.devices)throw Error("最多配对 16 台设备，请先撤销旧设备");const deviceId=randomUUID();const secret=randomBytes(32).toString("base64url");await this.mutate(()=>{this.persisted.devices.push({id:deviceId,name:pair.name,pairedAt:new Date().toISOString(),tokenHash:hash(secret)})});pair.deviceId=deviceId;pair.deviceToken=`${deviceId}.${secret}`;pair.status="approved";this.pairing=undefined}else pair.status="denied";
    this.changed();return this.state();
  }
  async revoke(id:string):Promise<RemoteGatewayState>{await this.mutate(()=>{this.persisted.devices=this.persisted.devices.filter(d=>d.id!==id)});for(const [response,device]of this.subscribers)if(device===id){response.end();this.subscribers.delete(response)}this.changed();return this.state()}
  observe(event:ChatEvent):void{
    if(this.disposing||!this.server||!event.sessionId)return;
    this.signal(event.type,event.sessionId);
    if((event.type==="turn-started"||event.type==="turn-completed")&&event.presentation?.clientMessageId){const op=this.persisted?.operations.find(o=>o.operationId.slice(14)===event.presentation?.clientMessageId&&!TERMINAL.has(o.state));if(op){const outcome=event.presentation.outcome;void this.updateOperation(op,event.type==="turn-started"?"running":outcome==="failed"?"failed":outcome==="cancelled"||outcome==="interrupted"?"cancelled":"completed",outcome==="failed"?"本轮执行失败，请查看会话原因":outcome==="cancelled"||outcome==="interrupted"?"本轮已停止，历史保留":undefined).catch(()=>undefined)}}
    if(event.type==="prompt-queue")for(const entry of event.entries){const op=this.persisted.operations.find(o=>o.operationId.slice(14)===entry.clientMessageId&&!TERMINAL.has(o.state));if(op&&["cancelled","failed"].includes(entry.state))void this.updateOperation(op,"failed",entry.state==="cancelled"?"排队消息已在电脑取消":"排队消息执行失败").catch(()=>undefined)}
  }
  private signal(type:string,sessionId?:string):void{const signal={cursor:++this.cursor,epoch:this.epoch,type,sessionId};this.signals.push(signal);if(this.signals.length>limits.signals)this.signals.shift();for(const [response]of this.subscribers){if(response.writableLength>256*1024){response.end();this.subscribers.delete(response)}else response.write(`id: ${signal.cursor}\ndata: ${JSON.stringify(signal)}\n\n`)}}
  private reply(response:ServerResponse,status:number,body:unknown):void{if(response.headersSent)return;if(response.destroyed)return;response.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}).end(JSON.stringify(body))}
  private async body(request:IncomingMessage,limit=limits.body):Promise<Record<string,unknown>>{let bytes=0;const chunks:Buffer[]=[];for await(const chunk of request){bytes+=chunk.length;if(bytes>limit)throw Error("请求过大");chunks.push(chunk)}const value=JSON.parse(Buffer.concat(chunks).toString("utf8"));if(!value||typeof value!=="object"||Array.isArray(value))throw Error("请求参数无效");return value}
  private authorize(request:IncomingMessage):StoredDevice|undefined{const match=/^Bearer ([a-zA-Z0-9-]+)\.([a-zA-Z0-9_-]+)$/.exec(request.headers.authorization??"");if(!match)return;const device=this.persisted.devices.find(d=>d.id===match[1]);return device&&sameSecret(device.tokenHash,hash(match[2]!))?device:undefined}
  private async route(request:IncomingMessage,response:ServerResponse):Promise<void>{
    this.connectionDiagnostics.requests++;
    const url=new URL(request.url??"/","https://grok.invalid");const path=url.pathname;
    if(request.method==="GET"&&path==="/v1/info"){this.reply(response,200,{protocol:REMOTE_PROTOCOL,hostName:hostname(),epoch:this.epoch,serverTime:Date.now()});return}
    if(request.method==="POST"&&path==="/v1/pair"){
      const body=await this.body(request);const token=typeof body.code==="string"?body.code:"";
      if(!this.pairing||Date.parse(this.pairing.expiresAt)<=Date.now()||!sameSecret(hash(token),hash(this.pairing.token))){this.reply(response,403,{error:"配对码无效或已过期"});return}
      if(this.pairs.size>=8)throw Error("配对申请过多，请在电脑刷新配对码");const name=typeof body.name==="string"?body.name.trim().slice(0,64):"Android 手机";const id=randomUUID();this.pairs.set(id,{id,name:name||"Android 手机",bootstrapHash:hash(token),status:"pending",requestedAt:new Date().toISOString(),expiresAt:this.pairing.expiresAt});this.changed();this.reply(response,202,{requestId:id,status:"pending"});return;
    }
    if(request.method==="POST"&&path==="/v1/pair/status"){const body=await this.body(request);const pair=this.pairs.get(String(body.requestId));if(!pair||Date.parse(pair.expiresAt)<=Date.now()||typeof body.code!=="string"||!sameSecret(pair.bootstrapHash,hash(body.code))){this.reply(response,403,{error:"配对申请无效或已过期"});return}this.reply(response,200,{status:pair.status,deviceToken:pair.deviceToken,deviceId:pair.deviceId,hostName:hostname(),protocol:REMOTE_PROTOCOL});return}
    const device=this.authorize(request);if(!device){this.reply(response,401,{error:"设备未授权或已撤销，请重新配对"});return}
    const asset=/^\/v1\/preview\/([a-f0-9-]{36})\/(.*)$/.exec(path);if(request.method==="GET"&&asset&&this.backend.resource){const result=await this.backend.resource(asset[1]!,decodeURIComponent(asset[2]!),device.id);response.writeHead(result.status ?? 200,{"Content-Type":result.mimeType,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff",...result.headers}).end(result.body);return}
    if(request.method==="GET"&&path==="/v1/workbench"&&this.backend.query){this.reply(response,200,await this.backend.query(url.searchParams,device.id));return}
    if(request.method==="POST"&&path==="/v1/uploads"&&this.backend.upload){this.reply(response,200,await this.backend.upload(await this.body(request,768*1024),device.id));return}
    if(request.method==="GET"&&path==="/v1/options"){this.reply(response,200,this.backend.options?await this.backend.options(url.searchParams.get("models")==="refresh",url.searchParams.get("scope")==="models"):{capabilities:[],workspaces:[]});return}
    if(request.method==="GET"&&path==="/v1/sessions"){this.reply(response,200,{sessions:(await this.backend.sessions()).slice(0,500),cursor:this.cursor,epoch:this.epoch,serverTime:Date.now()});return}
    const session=/^\/v1\/sessions\/([^/]+)$/.exec(path);
    if(request.method==="GET"&&session){const id=decodeURIComponent(session[1]!);if(!idPattern.test(id))throw Error("会话 ID 无效");const before=url.searchParams.has("before")?Number(url.searchParams.get("before")):undefined;if(before!==undefined&&(!Number.isSafeInteger(before)||before<0))throw Error("分页游标无效");const around=url.searchParams.has("around")?Number(url.searchParams.get("around")):undefined;if(around!==undefined&&(!Number.isSafeInteger(around)||around<0))throw Error("跳转位置无效");if(around!==undefined&&before!==undefined)throw Error("不能同时使用分页与跳转");const key=`${id}:${before??"latest"}:${around??""}`;let flight=this.snapshotFlights.get(key);if(!flight){flight=this.backend.snapshot(id,before,around);this.snapshotFlights.set(key,flight);void flight.finally(()=>setTimeout(()=>this.snapshotFlights.delete(key),250)).catch(()=>undefined)}this.reply(response,200,{...await flight,cursor:this.cursor,epoch:this.epoch});return}
    if(request.method==="GET"&&path==="/v1/events"){
      request.socket.setTimeout(0);response.writeHead(200,{"Content-Type":"text/event-stream","Cache-Control":"no-store","Connection":"keep-alive"});const cursor=Number(url.searchParams.get("cursor")??0);
      if(url.searchParams.get("epoch")!==this.epoch||!Number.isSafeInteger(cursor)||cursor<0||cursor>this.cursor||cursor<(this.signals[0]?.cursor??this.cursor)-1)response.write(`data: ${JSON.stringify({type:"reset",cursor:this.cursor,epoch:this.epoch})}\n\n`);else for(const signal of this.signals)if(signal.cursor>cursor)response.write(`id: ${signal.cursor}\ndata: ${JSON.stringify(signal)}\n\n`);
      response.write(`data: ${JSON.stringify({type:"connected",cursor:this.cursor,epoch:this.epoch})}\n\n`);this.subscribers.set(response,device.id);response.on("close",()=>this.subscribers.delete(response));return;
    }
    if(request.method==="POST"&&path==="/v1/operations"){const command=parseRemoteCommand(await this.body(request));const receipt=await this.accept(device.id,command);this.reply(response,202,receipt);return}
    const operation=/^\/v1\/operations\/([^/]+)$/.exec(path);if(request.method==="GET"&&operation){const op=this.persisted.operations.find(o=>o.operationId===operation[1]&&o.deviceId===device.id);if(!op){this.reply(response,404,{error:"操作回执不存在"});return}this.reply(response,200,publicReceipt(op));return}
    this.reply(response,404,{error:"不支持的远程操作"});
  }
  private async accept(deviceId:string,command:RemoteCommand):Promise<RemoteReceipt>{
    if(this.disposing)throw Error("桌面正在退出，请稍后重新连接");
    const digest=hash(JSON.stringify(command));let fresh=false;let operation:Operation|undefined;
    await this.mutate(()=>{operation=this.persisted.operations.find(o=>o.operationId===command.operationId);if(operation){if(operation.deviceId!==deviceId||operation.digest!==digest)throw Error("操作 ID 已用于不同请求");return}const submitted=Number(command.operationId.slice(0,13));if(submitted<(this.persisted.operationFloor??0)||submitted<Date.now()-86400000||submitted>Date.now()+300000)throw Error("操作已过期或设备时间异常，请核对会话后重新发送");if(this.persisted.operations.filter(o=>!TERMINAL.has(o.state)).length>=64)throw Error("待处理操作过多，请稍后再试");const now=new Date().toISOString();operation={operationId:command.operationId,sessionId:command.sessionId,action:command.action,deviceId,digest,state:"accepted",createdAt:now,updatedAt:now};this.persisted.operations.push(operation);fresh=true});
    if(fresh){const op=operation!;void Promise.resolve().then(()=>this.backend.perform(command,deviceId)).then(result=>this.updateOperation(op,result?.state??"completed",result?.message,result?.resultSessionId)).catch(error=>this.updateOperation(op,"failed",error instanceof Error?error.message:String(error),typeof error?.resultSessionId==="string"?error.resultSessionId:undefined)).catch(()=>undefined)}
    return publicReceipt(operation!);
  }
  private async updateOperation(op:Operation,state:RemoteReceipt["state"],message?:string,resultSessionId?:string):Promise<void>{if(this.disposing)return;await this.mutate(()=>{if(TERMINAL.has(op.state))return;op.state=state;op.message=message;if(resultSessionId)op.resultSessionId=resultSessionId;op.updatedAt=new Date().toISOString()});this.signal("operation",resultSessionId||op.sessionId)}
  /** Phones currently holding the live event stream (polling phones are not counted). */
  liveDevices():number{return new Set(this.subscribers.values()).size}
  async stop():Promise<void>{this.discovery?.destroy();this.discovery=undefined;this.pairing=undefined;this.pairs.clear();if(this.timer)clearInterval(this.timer);for(const [response]of this.subscribers)response.end();this.subscribers.clear();const server=this.server;this.server=undefined;server?.closeAllConnections();if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));this.epoch=randomUUID();this.cursor=0;this.signals=[];this.snapshotFlights.clear()}
  async dispose():Promise<void>{this.discovery?.destroy();this.discovery=undefined;this.disposing=true;await this.stop();await this.mutations}
}
const publicReceipt=({operationId,sessionId,action,state,createdAt,updatedAt,message,resultSessionId}:Operation):RemoteReceipt=>({operationId,sessionId,action,state,createdAt,updatedAt,message,resultSessionId});
export function parseRemoteCommand(body:Record<string,unknown>):RemoteCommand{
  if(typeof body.operationId!=="string"||!/^\d{13}_[a-zA-Z0-9_-]{1,100}$/.test(body.operationId)||typeof body.sessionId!=="string"||!idPattern.test(body.sessionId))throw Error("操作或会话 ID 无效");
  const fields:Record<string,string[]>={send:["text","attachmentIds","toolSelection","references"],cancel:[],permission:["requestId","optionId"],question:["requestId","answers"],plan:["requestId","verdict"],create:["workspaceId","profileId","modelId","providerId","effort","mode"],rename:["title"],archive:["archived"],"queue-remove":["queueId"],"queue-edit":["queueId","text"],"queue-move":["queueId","position"],"queue-clear":[],interject:["text","attachmentIds","toolSelection","references"],configure:["modelId","providerId","effort","mode","revision"],compact:[],fork:["pointId","profileId","modelId","providerId","effort","mode"],delete:[],workbench:["mutation"]};
  const action=String(body.action);if(!Object.hasOwn(fields,action))throw Error("不支持的远程操作");
  const allowed=["operationId","sessionId","action",...fields[action]!];if(Object.keys(body).some(k=>!allowed.includes(k)))throw Error("未知的操作字段");
  const command:RemoteCommand={operationId:body.operationId,sessionId:body.sessionId,action:action as RemoteCommand["action"]};
  if(action==="send"){if(typeof body.text!=="string"||!body.text.trim()||Buffer.byteLength(body.text)>65536)throw Error("消息不能为空且不得超过 64 KiB");command.text=body.text}
  if(["permission","question","plan"].includes(String(action))){if((typeof body.requestId!=="string"&&typeof body.requestId!=="number")||String(body.requestId).length>256)throw Error("请求 ID 无效");command.requestId=body.requestId as string|number}
  if(action==="permission"){if(typeof body.optionId!=="string"||body.optionId.length>256)throw Error("权限选项无效");command.optionId=body.optionId}
  if(action==="question"){if(!body.answers||typeof body.answers!=="object"||Array.isArray(body.answers)||Object.keys(body.answers).length>32||Object.entries(body.answers).some(([k,v])=>k.length>256||typeof v!=="string"||v.length>8192||["__proto__","constructor","prototype"].includes(k)))throw Error("回答参数无效");command.answers=body.answers as Record<string,string>}
  if(action==="plan"){if(!["approved","rejected","cancelled"].includes(String(body.verdict)))throw Error("计划选择无效");command.verdict=body.verdict as RemoteCommand["verdict"]}
  if(action==="create"){if(typeof body.workspaceId!=="string"||!idPattern.test(body.workspaceId))throw Error("请选择已知项目");command.workspaceId=body.workspaceId;if(body.profileId!==undefined){if(typeof body.profileId!=="string"||body.profileId.length>160)throw Error("配置档无效");command.profileId=body.profileId}}
  if(action==="rename"){if(typeof body.title!=="string"||!body.title.trim()||[...body.title.trim()].length>100)throw Error("会话名称须为 1–100 个字符");command.title=body.title.trim()}
  if(action==="archive"){if(typeof body.archived!=="boolean")throw Error("归档状态无效");command.archived=body.archived}
  if(action==="queue-remove"){if(typeof body.queueId!=="string"||!body.queueId||body.queueId.length>256||/[\u0000-\u001f]/.test(body.queueId))throw Error("队列消息 ID 无效");command.queueId=body.queueId}
  return {...command,...extendedRemoteFields(action,body)};
}
