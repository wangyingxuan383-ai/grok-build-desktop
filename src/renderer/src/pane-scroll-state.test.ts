import {afterEach,expect,it,vi} from "vitest";
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.resetModules()});
it("restores only bounded valid coordinates and debounces persistence",async()=>{
 vi.useFakeTimers();let raw=JSON.stringify({version:1,entries:[["valid",{top:420,index:3}],["negative",{top:-1,index:0}],["text",{top:"secret",index:0}]]});
 const setItem=vi.fn((_key:string,value:string)=>{raw=value});
 vi.stubGlobal("localStorage",{getItem:()=>raw,setItem});
 const first=await import("./pane-scroll-state");
 expect(first.readPaneScroll("valid")).toEqual({top:420,index:3});
 expect(first.readPaneScroll("negative").top).toBe(0);
 for(let i=0;i<205;i++)first.writePaneScroll("pane-"+i,{top:i});
 expect(setItem).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(300);
 expect(setItem).toHaveBeenCalledTimes(1);expect(JSON.parse(raw).entries).toHaveLength(200);
 vi.resetModules();const restored=await import("./pane-scroll-state");
 expect(restored.readPaneScroll("pane-204").top).toBe(204);expect(restored.readPaneScroll("pane-0").top).toBe(0);
});
it("ignores corrupt or oversized saved state and remains usable without storage",async()=>{
 vi.stubGlobal("localStorage",{getItem:()=>"{broken",setItem:()=>{throw Error("quota")}});
 const state=await import("./pane-scroll-state");vi.useFakeTimers();
 state.writePaneScroll("pane",{top:90});await vi.advanceTimersByTimeAsync(300);
 expect(state.readPaneScroll("pane").top).toBe(90);
});
