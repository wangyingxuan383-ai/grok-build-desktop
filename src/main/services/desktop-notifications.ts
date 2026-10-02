import {Notification, type BrowserWindow} from "electron";
import type {AppSettings} from "../../shared/types";
export type NotificationTarget={kind:"session"|"image"|"automation";id:string};
export type DesktopNoticeKind="completion"|"failure"|"confirmation";
export function shouldShowNotice(settings:AppSettings["notifications"],kind:DesktopNoticeKind,viewing:boolean){
 const policy=settings??{completion:"background",failure:true,confirmation:true,sound:true};
 return kind==="completion"?policy.completion==="always"||(policy.completion!=="off"&&!viewing):kind==="failure"?policy.failure&&!viewing:policy.confirmation&&!viewing;
}
const xml=(value:string)=>value.replace(/[<>&"']/g,character=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&apos;"}[character]!));
export class DesktopNotifications {
 private readonly active=new Set<Notification>();
 private readonly recent=new Map<string,number>();
 constructor(private readonly settings:()=>Promise<AppSettings>,private readonly window:()=>BrowserWindow|undefined,private readonly visible:()=>string,private readonly navigate:(target:NotificationTarget)=>void){}
 async show(key:string,kind:DesktopNoticeKind,title:string,body:string,target:NotificationTarget,force=false){
  if(!Notification.isSupported())return;
  const now=Date.now();for(const [key,at]of this.recent)if(now-at>60_000)this.recent.delete(key);
  if(this.recent.has(key))return;
  const settings=await this.settings(),window=this.window();
  const viewing=Boolean(window&&!window.isDestroyed()&&window.isFocused()&&!window.isMinimized()&&this.visible()===target.id);
  if(!force&&!shouldShowNotice(settings.notifications,kind,viewing))return;
  this.recent.set(key,now);
  const launch=`grok-desktop://notice/${target.kind}/${encodeURIComponent(target.id)}`;
  const notice=new Notification({title,body,silent:settings.notifications?.sound===false,...(process.platform==="win32"?{toastXml:`<toast activationType="protocol" launch="${xml(launch)}"><visual><binding template="ToastGeneric"><text>${xml(title)}</text><text>${xml(body)}</text></binding></visual>${settings.notifications?.sound===false?'<audio silent="true"/>':""}</toast>`}:{})});
  this.active.add(notice);if(this.active.size>100)this.active.delete(this.active.values().next().value!);
  notice.once("click",()=>{this.active.delete(notice);this.navigate(target)});notice.once("close",()=>this.active.delete(notice));notice.show();
 }
}
export function parseNotificationUrl(value:string):NotificationTarget|undefined{
 try{const url=new URL(value);if(url.protocol!=="grok-desktop:"||url.hostname!=="notice"||url.search||url.hash)return;const [kind,id,...extra]=url.pathname.slice(1).split("/");if(extra.length||!["session","image","automation"].includes(kind!))return;const decoded=decodeURIComponent(id!);if(!/^[A-Za-z0-9._:-]{1,512}$/.test(decoded))return;return {kind:kind as NotificationTarget["kind"],id:decoded}}catch{return}
}
