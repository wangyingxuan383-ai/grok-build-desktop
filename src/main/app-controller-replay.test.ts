import {expect,it,vi} from "vitest";
vi.mock("electron",()=>({app:{},clipboard:{},desktopCapturer:{},dialog:{},Menu:{},nativeImage:{},nativeTheme:{},Notification:class{},session:{},shell:{},safeStorage:{}}));
import {AppController} from "./app-controller";
it("replayed tools and turns do not mutate statistics, Computer state or change snapshots",async()=>{
 const record=vi.fn(),settle=vi.fn(),observe=vi.fn();
 const controller:any={projectionReplaying:new Set(["s"]),projectionReplayBuffers:new Map([["s",[]]]),nativeAgentCapabilities:{record:vi.fn()},prepareVisibleEvent:async(event:unknown)=>event,turnFileChanges:{observe},dashboard:{record},tokenActivity:{record},computer:{settleSession:settle},conversationProjections:{record},turnPresentations:{recordForSession:record}};
 await (AppController.prototype as any).handleEvent.call(controller,{type:"tool-call",sessionId:"s",tool:{toolCallId:"old",status:"completed",title:"old write"}});
 await (AppController.prototype as any).handleEvent.call(controller,{type:"turn-completed",sessionId:"s",presentation:{turnId:"old",ordinal:0,startedAt:"now"}});
 expect(record).not.toHaveBeenCalled();expect(observe).not.toHaveBeenCalled();expect(settle).not.toHaveBeenCalled();
 expect(controller.nativeAgentCapabilities.record).toHaveBeenCalledWith(expect.anything(),{replaying:true});
});
