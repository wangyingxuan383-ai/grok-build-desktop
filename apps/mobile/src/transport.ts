import { requireNativeModule } from "expo-modules-core";
import {readableConnectionError} from "./connection-errors";
export interface HostConnection {host:string;fingerprint:string;token:string;name:string;id:string}
interface Signal {streamId:string;kind:"data"|"error";text:string;code?:string}
type NativeTransport={request(host:string,fingerprint:string,token:string,path:string,method:string,body:string):Promise<{status:number;text:string}>;download(host:string,fingerprint:string,token:string,path:string,destination:string):Promise<string>;setMonitoring(host:string,fingerprint:string,token:string,name:string,enabled:boolean):Promise<void>;notify(title:string,detail:string,sessionId:string,computer:string):Promise<void>;startEvents(host:string,fingerprint:string,token:string,path:string,id:string):Promise<void>;stopEvents(id:string):Promise<void>;addListener(name:string,callback:(event:Signal)=>void):{remove():void}};
const native=requireNativeModule<NativeTransport>("GrokRemote");
export interface MobileUpdateState { phase: "idle" | "downloading" | "ready" | "error"; received: number; total?: number; version?: string; error?: string }
type UpdateTransport = NativeTransport & {
  publicRelease(): Promise<string>; mobileUpdateStatus(): Promise<MobileUpdateState>;
  downloadMobileUpdate(url: string, sha256: string, size: number, version: string): Promise<MobileUpdateState>;
  installMobileUpdate(): Promise<string>; cancelMobileUpdate(): Promise<void>;
};
export const checkPublicRelease = () => (native as UpdateTransport).publicRelease();
export const mobileUpdateStatus = () => (native as UpdateTransport).mobileUpdateStatus();
export const downloadMobileUpdate = (asset: { downloadUrl: string; sha256: string; size: number; version: string }) => (native as UpdateTransport).downloadMobileUpdate(asset.downloadUrl, asset.sha256, asset.size, asset.version);
export const installMobileUpdate = () => (native as UpdateTransport).installMobileUpdate();
export const cancelMobileUpdate = () => (native as UpdateTransport).cancelMobileUpdate();
export const watchMobileUpdate = (callback: (state: MobileUpdateState) => void) => (native as unknown as { addListener(name: string, callback: (state: MobileUpdateState) => void): { remove(): void } }).addListener("mobileUpdate", callback);
export const discoverComputers=()=> (native as NativeTransport&{discover():Promise<Array<{host:string;fingerprint:string;name:string}>>}).discover();
export const monitoringStatus=()=> (native as NativeTransport&{monitoringStatus():Promise<boolean>}).monitoringStatus();
export interface IncomingShare{text:string;files:Array<{uri:string;name:string;size:number;mimeType:string}>}
export const sharedItems=()=> (native as NativeTransport&{sharedItems():Promise<IncomingShare>}).sharedItems();
export const pdfPages=(path:string,start:number)=> (native as NativeTransport&{pdfPages(path:string,start:number):Promise<{total:number;pages:Array<{index:number;uri:string;width:number;height:number}>}>}).pdfPages(path,start);
export const saveDownload=(path:string,name:string,mimeType:string)=> (native as NativeTransport&{saveDownload(path:string,name:string,mimeType:string):Promise<string>}).saveDownload(path,name,mimeType);
export const pushToken=(config:Record<string,string>)=> (native as NativeTransport&{pushToken(options:Record<string,string>):Promise<string>}).pushToken(config);
export const noticePolicy=(computer:string,completed:boolean,failed:boolean,attention:boolean,muted:string[])=> (native as NativeTransport&{noticePolicy(computer:string,completed:boolean,failed:boolean,attention:boolean,muted:string[]):Promise<void>}).noticePolicy(computer,completed,failed,attention,muted);
export const cachePin=(path:string,active:boolean)=> (native as NativeTransport&{cachePin(path:string,active:boolean):Promise<void>}).cachePin(path,active);
export const cacheUsage=(clear=false)=> (native as NativeTransport&{cacheUsage(clear:boolean):Promise<number>}).cacheUsage(clear);
export const normalizeImage=(uri:string,name:string)=> (native as NativeTransport&{normalizeImage(uri:string,name:string):Promise<{uri:string;name:string;size:number;mimeType:string}>}).normalizeImage(uri,name);
export const downloadAsset=(connection:HostConnection,path:string,destination:string)=>native.download(connection.host,connection.fingerprint,connection.token,path,destination);
export const setMonitoring=(connection:HostConnection,enabled:boolean)=>native.setMonitoring(connection.host,connection.fingerprint,connection.token,connection.name,enabled);
export const notify=(connection:HostConnection,title:string,detail:string,sessionId:string)=>native.notify(title,detail,sessionId,connection.fingerprint);
export async function api<T>(connection:Pick<HostConnection,"host"|"fingerprint"|"token">,path:string,body?:unknown):Promise<T>{const response=await native.request(connection.host,connection.fingerprint,connection.token,path,body===undefined?"GET":"POST",body===undefined?"":JSON.stringify(body)).catch(error=>{throw readableConnectionError(error,connection.host)});let parsed:{error?:string}&T;try{parsed=JSON.parse(response.text)}catch{throw Error("电脑返回了无法读取的数据")}if(response.status>=400)throw Object.assign(Error(parsed.error||`请求失败 (${response.status})`),{status:response.status});return parsed}
export function listen(connection:HostConnection,cursor:number,epoch:string,onData:(data:{cursor:number;epoch:string;type:string;sessionId?:string})=>void,onError:(error:Error)=>void):()=>void{
  const id=`stream-${Date.now()}-${Math.random()}`;let stopped=false;const subscription=native.addListener("remoteEvent",event=>{if(stopped||event.streamId!==id)return;if(event.kind==="error")onError(Object.assign(new Error(event.text),{code:event.code}));else{try{onData(JSON.parse(event.text))}catch{onError(new Error("事件数据格式错误"))}}});
  void native.startEvents(connection.host,connection.fingerprint,connection.token,`/v1/events?cursor=${cursor}&epoch=${encodeURIComponent(epoch)}`,id).catch(error=>{if(!stopped)onError(readableConnectionError(error,connection.host))});
  return()=>{stopped=true;subscription.remove();void native.stopEvents(id).catch(()=>undefined)};
}
