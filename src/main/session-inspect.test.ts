import { describe, expect, it, vi } from "vitest";
vi.mock("electron",()=>({app:{},clipboard:{},desktopCapturer:{},dialog:{},Menu:{},nativeImage:{},nativeTheme:{},Notification:class{},session:{},shell:{},safeStorage:{}}));
import { AppController } from "./app-controller";
import { validateIpcInvocation } from "./ipc-schema";

function fixture(){return {focusedSessionId:"active",deletingSessions:new Set<string>(),sessionRuntime:{get:vi.fn(async()=>({cwd:"C:/one"}))},processes:{snapshot:vi.fn(()=>undefined),open:vi.fn()},catalog:{has:vi.fn(async()=>true),markRead:vi.fn()},conversationProjections:{inspect:vi.fn(async()=>({version:2,sessionId:"old",updatedAt:"",events:[]})),restore:vi.fn()}}}
describe("read-only session inspection",()=>{
 it("falls back only when the Desktop projection is absent, then rechecks ownership",async()=>{
  const controller=fixture();
  const inspectNative=vi.fn(async()=>({version:2,sessionId:"old",updatedAt:"",events:[]}));
  Object.assign(controller.conversationProjections,{inspectNative});
  await AppController.prototype.inspectSession.call(controller as any,"C:/one","old");
  expect(inspectNative).not.toHaveBeenCalled();
  controller.conversationProjections.inspect.mockResolvedValue(undefined as any);
  expect(await AppController.prototype.inspectSession.call(controller as any,"C:/one","old")).toMatchObject({sessionId:"old"});
  expect(inspectNative).toHaveBeenCalledWith("old","C:/one");
  inspectNative.mockImplementation(async()=>{controller.deletingSessions.add("old");return {version:2,sessionId:"old",updatedAt:"",events:[]}});
  await expect(AppController.prototype.inspectSession.call(controller as any,"C:/one","old")).rejects.toThrow("删除");
 });
 it("reads without restoring a CLI, moving focus, marking read or reconciling history",async()=>{
  const controller=fixture();expect(await AppController.prototype.inspectSession.call(controller as any,"C:/one","old")).toMatchObject({sessionId:"old"});
  expect(controller.conversationProjections.restore).not.toHaveBeenCalled();expect(controller.processes.open).not.toHaveBeenCalled();expect(controller.catalog.markRead).not.toHaveBeenCalled();expect(controller.focusedSessionId).toBe("active");
  expect(()=>validateIpcInvocation("session:inspect",["C:/one","old"],2)).not.toThrow();
 });
 it("rejects old workspace copies and deletion before reading",async()=>{
  const controller=fixture();await expect(AppController.prototype.inspectSession.call(controller as any,"C:/two","old")).rejects.toThrow("不属于");
  controller.deletingSessions.add("old");await expect(AppController.prototype.inspectSession.call(controller as any,"C:/one","old")).rejects.toThrow("删除");expect(controller.conversationProjections.inspect).not.toHaveBeenCalled();
 });
 it("rejects migration during an in-flight read and mismatched projection identities",async()=>{
  const controller=fixture();controller.conversationProjections.inspect.mockImplementation(async()=>{controller.sessionRuntime.get.mockResolvedValue({cwd:"C:/two"});return {version:2,sessionId:"old",updatedAt:"",events:[]}});
  await expect(AppController.prototype.inspectSession.call(controller as any,"C:/one","old")).rejects.toThrow("迁移");
  controller.conversationProjections.inspect.mockResolvedValue({version:2,sessionId:"foreign",updatedAt:"",events:[]});
  await expect(AppController.prototype.inspectSession.call(controller as any,"C:/two","old")).rejects.toThrow("身份不匹配");
 });
});
