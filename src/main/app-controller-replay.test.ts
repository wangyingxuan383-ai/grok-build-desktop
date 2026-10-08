import {expect,it,vi} from "vitest";
vi.mock("electron",()=>({app:{},clipboard:{},desktopCapturer:{},dialog:{},Menu:{},nativeImage:{},nativeTheme:{},Notification:class{},session:{},shell:{},safeStorage:{}}));
import {AppController} from "./app-controller";
it("replayed tools and turns do not mutate statistics, Computer state or change snapshots",async()=>{
 const record=vi.fn(),settle=vi.fn(),observe=vi.fn();
 const controller:any={projectionReplaying:new Set(["s"]),projectionReplayBuffers:new Map([["s",[]]]),nativeAgentCapabilities:{record:vi.fn()},prepareVisibleEvent:async(event:unknown)=>event,turnFileChanges:{observe},dashboard:{record},tokenActivity:{record},computer:{settleSession:settle},conversationProjections:{record},turnPresentations:{recordForSession:record}};
 Object.setPrototypeOf(controller,AppController.prototype);
 await (AppController.prototype as any).handleEvent.call(controller,{type:"tool-call",sessionId:"s",tool:{toolCallId:"old",status:"completed",title:"old write"}});
 await (AppController.prototype as any).handleEvent.call(controller,{type:"turn-completed",sessionId:"s",presentation:{turnId:"old",ordinal:0,startedAt:"now"}});
 expect(record).not.toHaveBeenCalled();expect(observe).not.toHaveBeenCalled();expect(settle).not.toHaveBeenCalled();
 expect(controller.nativeAgentCapabilities.record).toHaveBeenCalledWith(expect.anything(),{replaying:true});
});
it("configuration switches do not raise completion notices; only live turns do",async()=>{
 const show=vi.fn(async()=>undefined),add=vi.fn(async()=>undefined),markUnread=vi.fn(async()=>undefined);
 const controller:any={projectionReplaying:new Set(),projectionReplayBuffers:new Map(),runningSessions:new Set(),nativeAgentCapabilities:{record:vi.fn(async()=>undefined)},prepareVisibleEvent:async(event:unknown)=>event,turnFileChanges:{observe:vi.fn(async()=>undefined)},dashboard:{record:vi.fn(async()=>undefined)},tokenActivity:{record:vi.fn(async()=>undefined)},computer:{settleSession:vi.fn(async()=>undefined)},conversationProjections:{record:vi.fn(async()=>undefined)},turnPresentations:{recordForSession:vi.fn(async()=>undefined)},agentChanges:{beginTurn:vi.fn(async()=>undefined)},processes:{snapshot:()=>({cwd:"C:/p"})},inbox:{add},catalog:{markUnread},notices:()=>({show}),log:{log:vi.fn(async()=>undefined)},captureQuotaSignal:vi.fn(async()=>undefined)};
 Object.setPrototypeOf(controller,AppController.prototype);
 const emit=(event:unknown)=>(AppController.prototype as any).handleEvent.call(controller,event);
 await emit({type:"status",sessionId:"s",status:"working",text:"正在切换推理强度…"});
 await emit({type:"status",sessionId:"s",status:"idle",text:"推理强度已更新"});
 expect(show).not.toHaveBeenCalled();expect(add).not.toHaveBeenCalled();expect(markUnread).not.toHaveBeenCalled();
 await emit({type:"turn-started",sessionId:"s",presentation:{turnId:"t",ordinal:0,startedAt:"now"}});
 await emit({type:"status",sessionId:"s",status:"working"});
 await emit({type:"status",sessionId:"s",status:"idle"});
 expect(show).toHaveBeenCalledTimes(1);expect(add).toHaveBeenCalledTimes(1);
});
