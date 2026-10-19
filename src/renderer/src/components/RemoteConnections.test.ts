import { expect, it, vi } from "vitest";
import { observeRemoteConnectionState } from "./RemoteConnections";

it("reads event invalidations without a payload, coalesces them and ignores stale snapshots", async () => {
 let event!:()=>void, finish!:(value:any)=>void;
 const pending={pending:[{name:"paired phone"}]} as any, publish=vi.fn(), fail=vi.fn(), off=vi.fn();
 const getRemoteState=vi.fn<()=>Promise<any>>().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve})).mockResolvedValue(pending);
 const observer=observeRemoteConnectionState({getRemoteState,onRemoteStateChanged:listener=>{event=listener;return off}},publish,fail);
 event();event();finish({pending:[]});
 await vi.waitFor(()=>expect(publish).toHaveBeenCalledExactlyOnceWith(pending));
 expect(getRemoteState).toHaveBeenCalledTimes(2);expect(fail).not.toHaveBeenCalled();
 observer.dispose();event();expect(off).toHaveBeenCalledOnce();expect(getRemoteState).toHaveBeenCalledTimes(2);
});

it("does not report a late read error after leaving phone settings", async () => {
 let reject!:(error:unknown)=>void;
 const publish=vi.fn(),fail=vi.fn();
 const observer=observeRemoteConnectionState({getRemoteState:()=>new Promise((_resolve,fail)=>{reject=fail}),onRemoteStateChanged:()=>()=>{}},publish,fail);
 observer.dispose();reject(Error("late"));await Promise.resolve();await Promise.resolve();
 expect(publish).not.toHaveBeenCalled();expect(fail).not.toHaveBeenCalled();
});
