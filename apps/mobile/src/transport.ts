import { requireNativeModule } from "expo-modules-core";
import {readableConnectionError} from "./connection-errors";
import { trackTransfer } from "./transfers";
export interface HostConnection {host:string;fingerprint:string;token:string;name:string;id:string}
interface Signal {streamId:string;kind:"data"|"error";text:string;code?:string}
type NativeTransport={request(host:string,fingerprint:string,token:string,path:string,method:string,body:string):Promise<{status:number;text:string}>;download(host:string,fingerprint:string,token:string,path:string,destination:string):Promise<string>;setMonitoring(host:string,fingerprint:string,token:string,name:string,enabled:boolean):Promise<void>;notify(title:string,detail:string,sessionId:string,computer:string):Promise<void>;startEvents(host:string,fingerprint:string,token:string,path:string,id:string):Promise<void>;stopEvents(id:string):Promise<void>;addListener(name:string,callback:(event:Signal)=>void):{remove():void}};
const native=requireNativeModule<NativeTransport>("GrokRemote");
export interface MobileUpdateState { phase: "idle" | "downloading" | "ready" | "error"; received: number; total?: number; version?: string; error?: string; /** Increases with every native change; older snapshots are ignored. */ revision?: number; redownload?: boolean }
type UpdateTransport = NativeTransport & {
  publicRelease(): Promise<string>; mobileUpdateStatus(): Promise<MobileUpdateState>;
  downloadMobileUpdate(url: string, sha256: string, size: number, version: string): Promise<MobileUpdateState>;
  installMobileUpdate(): Promise<string>; cancelMobileUpdate(): Promise<void>;
};
export const checkPublicRelease = () => (native as UpdateTransport).publicRelease();
export const mobileUpdateStatus = () => (native as UpdateTransport).mobileUpdateStatus();
export const downloadMobileUpdate = async (asset: { downloadUrl: string; sha256: string; size: number; version: string }): Promise<MobileUpdateState> => {
  const retry = () => { void downloadMobileUpdate(asset).catch(() => undefined); };
  try { const state = await (native as UpdateTransport).downloadMobileUpdate(asset.downloadUrl, asset.sha256, asset.size, asset.version); recordUpdate(state, retry); return state; }
  catch (error) { trackTransfer("mobile-update", "update", `手机客户端 ${asset.version}`, "failed", String(error), retry); throw error; }
};
export const installMobileUpdate = () => (native as UpdateTransport).installMobileUpdate();
export const cancelMobileUpdate = () => (native as UpdateTransport).cancelMobileUpdate();
function recordUpdate(state: MobileUpdateState, retry?: () => void) {
  if (state.phase === "idle") return;
  trackTransfer("mobile-update", "update", `手机客户端 ${state.version || "更新"}`, state.phase === "downloading" ? "running" : state.phase === "ready" ? "done" : "failed", state.error, retry,
    { received: state.received, total: state.total }, state.phase === "downloading" ? () => { void cancelMobileUpdate(); } : undefined);
}
export const watchMobileUpdate = (callback: (state: MobileUpdateState) => void) => (native as unknown as { addListener(name: string, callback: (state: MobileUpdateState) => void): { remove(): void } }).addListener("mobileUpdate", state => { recordUpdate(state); callback(state); });
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
export interface CacheSummary { thumbnails: number; originals: number; previews: number; updates: number; largest: Array<{ name: string; size: number }> }
export const cacheSummary = () => (native as unknown as { cacheSummary(): Promise<CacheSummary> }).cacheSummary();
export const wifiAvailable = () => (native as unknown as { wifiAvailable(): Promise<boolean> }).wifiAvailable();
export const normalizeImage=(uri:string,name:string)=> (native as NativeTransport&{normalizeImage(uri:string,name:string):Promise<{uri:string;name:string;size:number;mimeType:string}>}).normalizeImage(uri,name);
export async function downloadAsset(connection: HostConnection, path: string, destination: string) {
  const kind = destination.includes("grok-thumb-") ? "thumbnail" : "original";
  let cancelled = false;
  const cancel = () => { cancelled = true; void (native as unknown as { cancelDownload(id: string): Promise<void> }).cancelDownload(destination).catch(() => undefined); };
  const label = `${connection.name} · ${kind === "thumbnail" ? "缩略图" : "文件下载"}`;
  trackTransfer(destination, kind, label, "running", undefined, undefined, undefined, cancel);
  const subscription = (native as unknown as { addListener(name: string, callback: (value: { id: string; received: number; total: number }) => void): { remove(): void } }).addListener("remoteTransfer", value => {
    if (value.id === destination) trackTransfer(destination, kind, label, "running", undefined, undefined, { received: value.received, total: value.total > 0 ? value.total : undefined }, cancel);
  });
  try { const uri = await native.download(connection.host, connection.fingerprint, connection.token, path, destination); trackTransfer(destination, kind, label, "done"); return uri; }
  catch (error) { trackTransfer(destination, kind, label, cancelled ? "cancelled" : "failed", cancelled ? undefined : String(error)); throw error; }
  finally { subscription.remove(); }
}
export const setMonitoring=(connection:HostConnection,enabled:boolean)=>native.setMonitoring(connection.host,connection.fingerprint,connection.token,connection.name,enabled);
export const notify=(connection:HostConnection,title:string,detail:string,sessionId:string)=>native.notify(title,detail,sessionId,connection.fingerprint);
export async function api<T>(connection:Pick<HostConnection,"host"|"fingerprint"|"token">,path:string,body?:unknown):Promise<T>{const response=await native.request(connection.host,connection.fingerprint,connection.token,path,body===undefined?"GET":"POST",body===undefined?"":JSON.stringify(body)).catch(error=>{throw readableConnectionError(error,connection.host)});let parsed:{error?:string}&T;try{parsed=JSON.parse(response.text)}catch{throw Error("电脑返回了无法读取的数据")}if(response.status>=400)throw Object.assign(Error(parsed.error||`请求失败 (${response.status})`),{status:response.status});return parsed}
export function listen(connection:HostConnection,cursor:number,epoch:string,onData:(data:{cursor:number;epoch:string;type:string;sessionId?:string})=>void,onError:(error:Error)=>void):()=>void{
  const id=`stream-${Date.now()}-${Math.random()}`;let stopped=false;const subscription=native.addListener("remoteEvent",event=>{if(stopped||event.streamId!==id)return;if(event.kind==="error")onError(Object.assign(new Error(event.text),{code:event.code}));else{try{onData(JSON.parse(event.text))}catch{onError(new Error("事件数据格式错误"))}}});
  void native.startEvents(connection.host,connection.fingerprint,connection.token,`/v1/events?cursor=${cursor}&epoch=${encodeURIComponent(epoch)}`,id).catch(error=>{if(!stopped)onError(readableConnectionError(error,connection.host))});
  return()=>{stopped=true;subscription.remove();void native.stopEvents(id).catch(()=>undefined)};
}

/** Real background-follow state, not just the on/off preference. */
export interface MonitorDetail { following: boolean; phase: "stopped" | "connecting" | "online" | "retrying" | "paused"; attempts: number; lastSync: number; computer: string; stopReason: string }
export interface NotificationHealth { enabled: boolean; channels: Array<{ id: string; name: string; enabled: boolean }>; batteryExempt: boolean; mode: "always" | "wifi" | "screen" }
type HealthTransport = {
  claimNotices(computer: string, ids: string[]): Promise<string[]>;
  baselineNotices(computer: string, ids: string[]): Promise<boolean>;
  monitoringDetail(): Promise<MonitorDetail>; monitorMode(mode: string): Promise<void>;
  quietHours(enabled: boolean, start: number, end: number, allowAttention: boolean): Promise<void>;
  noticesSeen(computer: string): Promise<string[]>; markNoticesSeen(computer: string, ids: string[]): Promise<void>;
  notificationHealth(): Promise<NotificationHealth>; openNotificationSettings(channel: string): Promise<void>;
  requestBatteryExemption(): Promise<void>; testNotice(computer: string): Promise<void>; setSecureWindow(enabled: boolean): Promise<void>;
};
const health = native as unknown as HealthTransport;
export const claimNotices = (computer: string, ids: string[]) => health.claimNotices(computer, ids);
export const baselineNotices = (computer: string, ids: string[]) => health.baselineNotices(computer, ids);
export const monitoringDetail = () => health.monitoringDetail();
export const setMonitorMode = (mode: NotificationHealth["mode"]) => health.monitorMode(mode);
export const setQuietHours = (enabled: boolean, start: number, end: number, allowAttention: boolean) => health.quietHours(enabled, start, end, allowAttention);
export const noticesSeen = (computer: string) => health.noticesSeen(computer);
export const markNoticesSeen = (computer: string, ids: string[]) => health.markNoticesSeen(computer, ids);
export const notificationHealth = () => health.notificationHealth();
export const openNotificationSettings = (channel = "") => health.openNotificationSettings(channel);
export const requestBatteryExemption = () => health.requestBatteryExemption();
export const testNotice = (computer: string) => health.testNotice(computer);
export const setSecureWindow = (enabled: boolean) => health.setSecureWindow(enabled);
export const configurePrivacy = (enabled: boolean, secure: boolean) => (native as unknown as { configurePrivacy(enabled: boolean, secure: boolean): Promise<void> }).configurePrivacy(enabled, secure);
export const foregroundComputer = (computer: string) => (native as unknown as { foregroundComputer(computer: string): Promise<void> }).foregroundComputer(computer);
type NativeExtras = { watchReceipt(host: string, pin: string, token: string, operation: string, session: string): Promise<void>; cancelReceiptWatch(): Promise<void>; pickDate(value: string): Promise<string | null>; pickTime(value: string): Promise<string | null> };
export const watchReceipt = (host: HostConnection, operation: string, session: string) => (native as unknown as NativeExtras).watchReceipt(host.host, host.fingerprint, host.token, operation, session);
export const cancelReceiptWatch = () => (native as unknown as NativeExtras).cancelReceiptWatch();
export const pickDate = (value: string) => (native as unknown as NativeExtras).pickDate(value);
export const pickTime = (value: string) => (native as unknown as NativeExtras).pickTime(value);
