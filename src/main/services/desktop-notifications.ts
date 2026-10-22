import {Notification, type BrowserWindow} from "electron";
import type {AppSettings} from "../../shared/types";
import { redactLogText } from "./log-service";
import { notificationsQuiet } from "../../shared/productivity";
export type NotificationTarget={kind:"session"|"image"|"automation";id:string};
export type DesktopNoticeKind="completion"|"failure"|"confirmation";
export function shouldShowNotice(settings:AppSettings["notifications"],kind:DesktopNoticeKind,viewing:boolean){
 const policy=settings??{completion:"background",failure:true,confirmation:true,sound:true};
 return kind==="completion"?policy.completion==="always"||(policy.completion!=="off"&&!viewing):kind==="failure"?policy.failure&&!viewing:policy.confirmation&&!viewing;
}
const xml=(value:string)=>value.replace(/[<>&"']/g,character=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&apos;"}[character]!));
/** Redact before truncating so a boundary cannot expose half a credential. */
export function notificationText(value: string | undefined, limit = 220): string {
 const clean = redactLogText(value ?? "").replace(/(?:^|\s)\/(?:Users|home|var|tmp|mnt)\/[^\r\n]*/g," [REDACTED_PATH]").replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g," ").replace(/\s+/g," ").trim();
 const characters=Array.from(clean);return characters.length>limit?characters.slice(0,limit-1).join("")+"…":clean;
}
export function notificationProject(cwd: string | undefined): string { return notificationText(cwd?.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1), 60); }
export function notificationContent(kind: DesktopNoticeKind, name: string | undefined, cwd: string | undefined, detail?: string) {
 const label=notificationText(name,72)||"Grok 会话",project=notificationProject(cwd);
 return {title:notificationText(`${label} · ${kind==="completion"?"已完成":kind==="failure"?"执行失败":"等待确认"}`,100),body:notificationText([project,detail|| (kind==="completion"?"回复已保存，打开查看结果。":kind==="failure"?"打开会话查看错误原因。":"打开会话处理待确认的请求。")].filter(Boolean).join(" · "))};
}
export class DesktopNotifications {
 private readonly active=new Set<Notification>();
 private readonly recent=new Map<string,number>();
 private readonly pending=new Set<string>();
 private disposed=false;
 constructor(private readonly settings:()=>Promise<AppSettings>,private readonly window:()=>BrowserWindow|undefined,private readonly visible:()=>string,private readonly navigate:(target:NotificationTarget)=>void){}
 async show(key:string,kind:DesktopNoticeKind,title:string,body:string,target:NotificationTarget,force=false){
  if(this.disposed||!Notification.isSupported())return;
  const now=Date.now();for(const [key,at]of this.recent)if(now-at>60_000)this.recent.delete(key);
  if(this.recent.has(key)||this.pending.has(key))return;
  this.pending.add(key);
  try{
  const settings=await this.settings(),window=this.window();
  if(this.disposed)return;
  if(!force&&notificationsQuiet(settings.productivity))return;
  const viewing=Boolean(window&&!window.isDestroyed()&&window.isFocused()&&!window.isMinimized()&&this.visible()===target.id);
  if(!force&&!shouldShowNotice(settings.notifications,kind,viewing))return;
  this.recent.set(key,now);
  title=notificationText(title,100);body=notificationText(body);
  const launch=`grok-desktop://notice/${target.kind}/${encodeURIComponent(target.id)}`;
  const notice=new Notification({title,body,silent:settings.notifications?.sound===false,...(process.platform==="win32"?{toastXml:`<toast activationType="protocol" launch="${xml(launch)}"><visual><binding template="ToastGeneric"><text>${xml(title)}</text><text>${xml(body)}</text></binding></visual>${settings.notifications?.sound===false?'<audio silent="true"/>':""}</toast>`}:{})});
  this.active.add(notice);if(this.active.size>100)this.release(this.active.values().next().value!);
  notice.once("click",()=>{this.release(notice);if(!this.disposed)this.navigate(target)});notice.once("close",()=>this.release(notice));notice.once("failed",()=>this.release(notice));notice.show();
  }finally{this.pending.delete(key)}
 }
 private release(notice:Notification){this.active.delete(notice);notice.removeAllListeners();notice.close()}
 dispose(){this.disposed=true;this.pending.clear();this.recent.clear();for(const notice of this.active)this.release(notice)}
}
export function parseNotificationUrl(value:string):NotificationTarget|undefined{
 try{const url=new URL(value);if(url.protocol!=="grok-desktop:"||url.hostname!=="notice"||url.search||url.hash)return;const [kind,id,...extra]=url.pathname.slice(1).split("/");if(extra.length||!["session","image","automation"].includes(kind!))return;const decoded=decodeURIComponent(id!);if(!/^[A-Za-z0-9._:-]{1,512}$/.test(decoded))return;return {kind:kind as NotificationTarget["kind"],id:decoded}}catch{return}
}
