import { describe, expect, it, vi } from "vitest";
vi.mock("electron",()=>({app:{},clipboard:{},desktopCapturer:{},dialog:{},Menu:{},nativeImage:{},nativeTheme:{},Notification:class{},session:{},shell:{},safeStorage:{}}));
import { AppController, mediaToolPrompt } from "./app-controller";

describe("media lifecycle and account coordination",()=>{
 it("counts image-only work and waits for cancelled CLI tasks without aborting independent Providers",async()=>{
  const cli={abort:new AbortController(),child:{kill:vi.fn()}},provider={abort:new AbortController(),child:{kill:vi.fn()}};
  let settle!:()=>void;const flight=new Promise<void>(resolve=>{settle=resolve});
  const controller:any={processes:{hasWorking:()=>false},updater:{isActive:()=>false},mediaJobs:new Map([["cli",{route:"cli"}],["provider",{route:"provider"}]]),mediaJobControls:new Map([["cli",cli],["provider",provider]]),mediaJobFlights:new Map([["cli",flight]])};
  expect(AppController.prototype.hasWorking.call(controller)).toBe(true);
  let finished=false;const stopping=(AppController.prototype as any).stopMediaJobs.call(controller,"账号变更",true).then(()=>{finished=true});
  await Promise.resolve();expect(cli.abort.signal.aborted).toBe(true);expect(provider.abort.signal.aborted).toBe(false);expect(finished).toBe(false);
  settle();await stopping;expect(cli.child.kill).toHaveBeenCalledOnce();expect(provider.child.kill).not.toHaveBeenCalled();
 });
 it("keeps the media launch barrier until the full credential operation settles, including failures",async()=>{
  const controller:any={mediaCredentialChanges:0,processes:{hasWorking:()=>false},mediaJobControls:new Map(),mediaJobs:new Map(),updater:{isActive:()=>false},quota:{clear:vi.fn()}};
  await expect((AppController.prototype as any).withMediaCredentialChange.call(controller,async()=>{expect(controller.mediaCredentialChanges).toBe(1);throw Error("login failed")})).rejects.toThrow("login failed");
  expect(controller.mediaCredentialChanges).toBe(0);
 });
 it("uses edit-aware instructions only for continuing image conversations",()=>{
  const request={kind:"image" as const,prompt:"make it warmer",aspectRatio:"auto" as const};
  expect(mediaToolPrompt(request)).toContain("使用 image_gen 生成图片");
  expect(mediaToolPrompt(request,true)).toContain("选择 image_edit 修改上轮图片");
  expect(mediaToolPrompt({...request,referencePaths:["ref.png"]},true)).toContain("使用 image_edit 编辑参考图片");
 });
});

it("rejects an account mutation before touching running coding or CLI image work",async()=>{
 const operation=vi.fn(async()=>true);const controller:any={mediaCredentialChanges:0,updater:{isActive:()=>false},processes:{hasWorking:()=>true},mediaJobControls:new Map(),mediaJobs:new Map()};
 await expect((AppController.prototype as any).withMediaCredentialChange.call(controller,operation)).rejects.toThrow("先完成或停止");expect(operation).not.toHaveBeenCalled();
 controller.processes.hasWorking=()=>false;controller.mediaJobControls.set("image",{});controller.mediaJobs.set("image",{route:"cli"});
 await expect((AppController.prototype as any).withMediaCredentialChange.call(controller,operation)).rejects.toThrow("先完成或停止");expect(operation).not.toHaveBeenCalled();
});
