import{sign}from"node:crypto";
import{readFile}from"node:fs/promises";
import{join}from"node:path";
import{JsonStore}from"./json-store";
import type{NotificationInboxItem}from"../../shared/types";
interface PublicFirebase{projectId:string;appId:string;apiKey:string;senderId:string}
interface PrivateFirebase{project_id:string;client_email:string;private_key:string}
interface PushStore{credential?:string;publicConfig?:PublicFirebase;devices:Record<string,string>;seen:string[];initialized?:boolean}
type Requester=(url:string,init:RequestInit)=>Promise<Response>;
/** Optional user-configured FCM; only event identifiers leave the computer. */
export class RemotePushService{
 private readonly store:JsonStore<PushStore>;private token?:{value:string;expires:number};private polling=false;private lastError?:string;
 constructor(root:string,private readonly secrets:{encrypt(s:string):string;decrypt(s:string):string},private readonly request:Requester){this.store=new JsonStore(join(root,"remote","push.json"),{devices:{},seen:[]})}
 async status(deviceId?:string){const state=await this.store.get();return {configured:Boolean(state.credential&&state.publicConfig),publicConfig:state.publicConfig,registered:Boolean(deviceId&&state.devices[deviceId]),lastError:this.lastError}}
 async configure(credentialPath:string,androidPath:string){
  const credential=JSON.parse(await readFile(credentialPath,"utf8"))as PrivateFirebase;const android=JSON.parse(await readFile(androidPath,"utf8"));
  if(!/^[a-z0-9-]{4,80}$/.test(credential.project_id)||typeof credential.client_email!=="string"||!credential.private_key?.includes("PRIVATE KEY"))throw Error("请选择 Firebase 服务账号凭据 JSON");
  const client=android.client?.find((row:{client_info?:{android_client_info?:{package_name?:string}}})=>row.client_info?.android_client_info?.package_name==="io.github.grokbuilddesktop.companion");
  if(!client||android.project_info?.project_id!==credential.project_id)throw Error("Android 配置必须属于同一项目，包名为 io.github.grokbuilddesktop.companion");
  const publicConfig:PublicFirebase={projectId:credential.project_id,appId:client.client_info.mobilesdk_app_id,apiKey:client.api_key?.[0]?.current_key,senderId:String(android.project_info.project_number)};
  if(Object.values(publicConfig).some(value=>typeof value!=="string"||!value))throw Error("Firebase Android 配置不完整");
  await this.store.mutate(state=>{state.credential=this.secrets.encrypt(JSON.stringify(credential));state.publicConfig=publicConfig;state.devices={};state.seen=[];state.initialized=false});this.token=undefined;this.lastError=undefined;return this.status();
 }
 async register(deviceId:string,token:string){if(!(await this.status()).configured)throw Error("电脑尚未配置云端推送；可以使用本地持续跟进");if(!token||token.length>4096)throw Error("推送令牌无效");await this.store.mutate(state=>{state.devices[deviceId]=this.secrets.encrypt(token)})}
 async unregister(deviceId:string){await this.store.mutate(state=>{delete state.devices[deviceId]})}
 private async accessToken(credential:PrivateFirebase){if(this.token&&this.token.expires>Date.now()+60000)return this.token.value;const now=Math.floor(Date.now()/1000);const part=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString("base64url");const unsigned=part({alg:"RS256",typ:"JWT"})+"."+part({iss:credential.client_email,scope:"https://www.googleapis.com/auth/firebase.messaging",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600});const assertion=unsigned+"."+sign("RSA-SHA256",Buffer.from(unsigned),credential.private_key).toString("base64url");const response=await this.request("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion}).toString(),signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error(`推送认证失败 (${response.status})`);const token=await response.json()as {access_token:string;expires_in:number};if(!token.access_token)throw Error("推送服务未返回认证令牌");this.token={value:token.access_token,expires:Date.now()+Math.min(token.expires_in,3600)*1000};return token.access_token}
 async poll(read:()=>Promise<NotificationInboxItem[]>,computer:string,activeDevices:string[]){if(this.polling)return;this.polling=true;try{
  const state=await this.store.get();const devices=Object.entries(state.devices).filter(([id])=>activeDevices.includes(id));if(!state.credential||!state.publicConfig||!devices.length)return;
  const items=(await read()).slice(0,100);if(!state.initialized){await this.store.mutate(current=>{current.seen=items.map(i=>i.id);current.initialized=true});return}
  const seen=new Set(state.seen);const pending=items.filter(item=>!seen.has(item.id)&&!item.read).reverse();if(!pending.length)return;
  const credential=JSON.parse(this.secrets.decrypt(state.credential))as PrivateFirebase;const authorization="Bearer "+await this.accessToken(credential);
  for(const item of pending){let complete=true;for(const [deviceId,encrypted]of devices){const token=this.secrets.decrypt(encrypted);const response=await this.request(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(credential.project_id)}/messages:send`,{method:"POST",headers:{Authorization:authorization,"Content-Type":"application/json"},body:JSON.stringify({message:{token,notification:{title:item.kind==="confirmation"?"Grok 任务需要回应":item.kind==="failure"?"Grok 任务执行失败":"Grok 任务结果已更新",body:"打开应用查看对应任务。"},data:{computer,sessionId:item.sessionId??"",kind:item.kind},android:{priority:item.kind==="confirmation"?"HIGH":"NORMAL",notification:{channel_id:item.kind==="confirmation"?"grok-attention":item.kind==="failure"?"grok-failed":"grok-completed",tag:item.id}}}}),signal:AbortSignal.timeout(15000)});
   if(response.status===404){await this.unregister(deviceId);continue}if(!response.ok){complete=false;this.lastError=`推送发送失败 (${response.status})`}
  }if(complete)await this.store.mutate(current=>{current.seen=[...new Set([...current.seen,item.id])].slice(-300)})}
 }catch(error){this.lastError=error instanceof Error?error.message:"推送暂不可用"}finally{this.polling=false}}
}
