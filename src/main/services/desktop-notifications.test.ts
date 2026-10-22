import {expect,it,vi,beforeEach} from "vitest";
const host=vi.hoisted(()=>({notices:[] as any[]}));
vi.mock("electron",async()=>{const {EventEmitter}=await import("node:events");return {Notification:class extends EventEmitter {
 static isSupported(){return true}
 show=vi.fn();close=vi.fn();constructor(readonly options:unknown){super();host.notices.push(this)}
}}});
import {DesktopNotifications,notificationContent,notificationText,parseNotificationUrl,shouldShowNotice} from "./desktop-notifications";
import type {AppSettings} from "../../shared/types";
beforeEach(()=>{host.notices.length=0});
it("redacts secrets and private paths before bounding useful request/result text",()=>{
 const content=notificationContent("confirmation","部署前检查","C:/Users/private/project","允许写入设置？ api_key=xai-secret-value-123456789");
 expect(content.title).toContain("部署前检查");expect(content.body).toContain("project");expect(content.body).toContain("允许写入设置");
 expect(content.body).not.toContain("private");expect(content.body).not.toContain("xai-secret");
 expect(notificationText("处理 C:/Users/private/source.txt")).not.toContain("Users");
 expect(Array.from(notificationText("😀".repeat(500)))).toHaveLength(220);
 expect(notificationText("hello\u202eworld\nnext")).toBe("hello world next");
});
it("reserves concurrent toast identities before awaiting settings and disposes click listeners",async()=>{
 let resolve!:(settings:AppSettings)=>void;
 const settings=vi.fn(()=>new Promise<AppSettings>(done=>{resolve=done})),navigate=vi.fn();
 const service=new DesktopNotifications(settings,()=>undefined,()=>"",navigate);
 const target={kind:"session" as const,id:"s"};
 const first=service.show("same","completion","title","body",target);
 await service.show("same","completion","title","body",target);
 expect(settings).toHaveBeenCalledOnce();resolve({} as AppSettings);await first;
 expect(host.notices).toHaveLength(1);expect(host.notices[0].show).toHaveBeenCalledOnce();
 service.dispose();host.notices[0].emit("click");expect(navigate).not.toHaveBeenCalled();
 expect(host.notices[0].eventNames()).toEqual([]);
});
it("suppresses late toast work and honors quiet hours except for explicit tests",async()=>{
 let resolve!:(settings:AppSettings)=>void;
 const service=new DesktopNotifications(()=>new Promise(done=>{resolve=done}),()=>undefined,()=>"",vi.fn());
 const pending=service.show("late","failure","title","body",{kind:"session",id:"s"});service.dispose();resolve({} as AppSettings);await pending;
 expect(host.notices).toHaveLength(0);
 const quiet=new DesktopNotifications(async()=>({productivity:{quietUntil:new Date(Date.now()+60000).toISOString()}} as AppSettings),()=>undefined,()=>"",vi.fn());
 await quiet.show("quiet","failure","title","body",{kind:"session",id:"s"});expect(host.notices).toHaveLength(0);
 await quiet.show("test","completion","title","body",{kind:"automation",id:"test"},true);expect(host.notices).toHaveLength(1);quiet.dispose();
});
it("uses actual visibility, preserves sound-independent policy and scopes activation identities",()=>{
 expect(shouldShowNotice(undefined,"completion",true)).toBe(false);
 expect(shouldShowNotice(undefined,"completion",false)).toBe(true);
 expect(shouldShowNotice({completion:"always",failure:true,confirmation:true,sound:false},"completion",true)).toBe(true);
 expect(shouldShowNotice({completion:"off",failure:false,confirmation:false,sound:true},"failure",false)).toBe(false);
 expect(parseNotificationUrl("grok-desktop://notice/image/image-123")).toEqual({kind:"image",id:"image-123"});
 for(const url of ["https://notice/image/image-123","grok-desktop://notice/session/%2e%2e%2fsecret","grok-desktop://notice/automation/id?cmd=delete","grok-desktop://notice/shell/exec"])expect(parseNotificationUrl(url)).toBeUndefined();
});
