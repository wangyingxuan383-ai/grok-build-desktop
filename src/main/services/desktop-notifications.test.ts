import {expect,it,vi} from "vitest";
vi.mock("electron",()=>({Notification:class{}}));
import {parseNotificationUrl,shouldShowNotice} from "./desktop-notifications";
it("uses actual visibility, preserves sound-independent policy and scopes activation identities",()=>{
 expect(shouldShowNotice(undefined,"completion",true)).toBe(false);
 expect(shouldShowNotice(undefined,"completion",false)).toBe(true);
 expect(shouldShowNotice({completion:"always",failure:true,confirmation:true,sound:false},"completion",true)).toBe(true);
 expect(shouldShowNotice({completion:"off",failure:false,confirmation:false,sound:true},"failure",false)).toBe(false);
 expect(parseNotificationUrl("grok-desktop://notice/image/image-123")).toEqual({kind:"image",id:"image-123"});
 for(const url of ["https://notice/image/image-123","grok-desktop://notice/session/%2e%2e%2fsecret","grok-desktop://notice/automation/id?cmd=delete","grok-desktop://notice/shell/exec"])expect(parseNotificationUrl(url)).toBeUndefined();
});
