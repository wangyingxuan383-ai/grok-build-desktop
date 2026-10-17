import { describe, expect, it, vi } from "vitest";
import type { ChatEvent } from "../../shared/types";
import { normalizeNativeRunWire, type NativeRunControlInput, type NativeRunSnapshot } from "../../shared/native-runs";
import { bindNativeRunEventOwner, nativeRunControlSupported, NativeRunService, type NativeRunConnection } from "./native-run-service";

function setup(saved: NativeRunSnapshot[] = [], timeoutMs = 100) {
  const state = { owner: {}, controllable: true, commands: ["goal", "workflow"], working: false, needsUser: false, queued: false, activeTurnId: "turn-a", controlBusy: false };
  let service: NativeRunService;
  const record = (kind: "goal"|"workflow", id: string, status: string, revision = 1, replaying = false) => {
    const nativeRun = normalizeNativeRunWire(kind,{goal_id:id,run_id:id,status,objective:"Same title",revision,token_budget:1000,tokens_used:0,agent_budget:3,agents_used:1})!;
    service.record({type:"runtime-update",sessionId:"session-a",update:{kind,name:kind+"_updated",at:new Date().toISOString(),data:{nativeRun}}},replaying);
  };
  const finished = vi.fn();
  const save = vi.fn(async(_id: string, _rows: NativeRunSnapshot[]) => {});
  const prompt = vi.fn(async(text: string) => {
    const parts = text.split(" "), kind = parts[0] === "/goal" ? "goal" : "workflow";
    record(kind,kind === "goal" ? "goal-a" : parts[2]!,parts[1] === "pause" ? "user_paused" : parts[1] === "resume" ? "active" : "cancelled",10);
  });
  const cancel = vi.fn(() => { state.working=false; record("goal","goal-a","user_paused",5); });
  const reserve = vi.fn(() => { if(state.controlBusy)throw Error("busy");state.controlBusy=true;return()=>{state.controlBusy=false;}; });
  service = new NativeRunService({ connection: id => id === "session-a" ? {...state,prompt,cancel,reserve} as NativeRunConnection : undefined, saved: async()=>saved,save,onWorkflowFinished:finished,timeoutMs });
  const row = async(id:string) => (await service.list()).find(r=>r.id===id)!;
  const input = (r: NativeRunSnapshot, action: NativeRunControlInput["action"], operationId = "operation-a"): NativeRunControlInput => ({sessionId:r.sessionId,kind:r.kind,runId:r.id,revision:r.revision,action,operationId});
  return {service,state,record,prompt,cancel,reserve,row,input,finished,save};
}
describe("native run control gate",()=>{
  it("follows the protocol baseline instead of one binary, and parses CLI version banners",()=>{
    for(const version of ["1.0.60","1.0.62","grok 1.0.62 (01a8e1c591c0) [stable]","1.1.0","2.0.0"])expect(nativeRunControlSupported(version)).toBe(true);
    for(const version of ["1.0.59","0.9.99",undefined,"","dev-build"])expect(nativeRunControlSupported(version)).toBe(false);
  });
});
describe("native run controls",()=>{
  it("uses exact workflow ids, preserves unrelated runs and coalesces duplicate submissions",async()=>{
    const f=setup();f.record("workflow","wf-one","active");f.record("workflow","wf-two","active");
    const request=f.input(await f.row("wf-one"),"pause");const first=f.service.control(request);
    expect(f.service.control(request)).toBe(first);
    expect(await first).toMatchObject({state:"completed"});
    expect(f.prompt).toHaveBeenCalledTimes(1);expect(f.prompt).toHaveBeenCalledWith("/workflow pause wf-one",false);
    expect((await f.row("wf-two")).status).toBe("running");
    await expect(f.service.control({...request,runId:"wf-two"})).rejects.toThrow("操作标识");
  });
  it("rejects stale revisions, foreign ids and unverified connections without executing",async()=>{
    const f=setup();f.record("workflow","wf-one","active");const old=f.input(await f.row("wf-one"),"pause");
    f.record("workflow","wf-one","user_paused",2);
    await expect(f.service.control(old)).rejects.toThrow("状态已变化");
    await expect(f.service.control({...old,operationId:"other",sessionId:"session-b"})).rejects.toThrow("已不存在");
    f.state.controllable=false;expect((await f.row("wf-one")).actions).toEqual([]);expect(f.prompt).not.toHaveBeenCalled();
  });
  it("never inserts workflow commands into busy, waiting or queued sessions",async()=>{
    const f=setup();f.record("workflow","wf-one","active");
    for(const key of ["working","needsUser","queued"] as const){f.state[key]=true;expect((await f.row("wf-one")).actions).toEqual([]);f.state[key]=false;}
    expect(f.prompt).not.toHaveBeenCalled();expect(f.cancel).not.toHaveBeenCalled();
  });
  it("cancels a running goal only after tying the current turn to that goal",async()=>{
    const f=setup();f.record("goal","goal-a","active");expect((await f.row("goal-a")).actions).toEqual([]);
    f.state.working=true;expect((await f.row("goal-a")).actions).toEqual([]);
    f.service.record({type:"user-message",sessionId:"session-a",text:"/goal Work on this objective"});f.record("goal","goal-a","active",2);
    const request=f.input(await f.row("goal-a"),"pause");expect(await f.service.control(request)).toMatchObject({state:"completed"});expect(f.cancel).toHaveBeenCalledTimes(1);
    expect(f.prompt).not.toHaveBeenCalled();
  });
  it("restores summaries read-only and disables an old connection's state after replacement",async()=>{
    const seed=setup();seed.record("workflow","wf-one","active");const saved=await seed.service.list();const restored=setup(saved);
    expect((await restored.service.list())[0]).toMatchObject({stale:true,actions:[]});expect(restored.prompt).not.toHaveBeenCalled();
    restored.record("workflow","wf-one","active",2);expect((await restored.row("wf-one")).actions).toContain("pause");
    restored.state.owner={};expect((await restored.row("wf-one")).stale).toBe(true);
  });
  it("returns unknown on missing native confirmation and never automatically repeats the request",async()=>{
    const f=setup([],20);f.record("workflow","wf-one","active");f.prompt.mockImplementation(async()=>{});
    const request=f.input(await f.row("wf-one"),"pause");expect(await f.service.control(request)).toMatchObject({state:"unknown"});
    expect(await f.service.control(request)).toMatchObject({state:"unknown"});expect(f.prompt).toHaveBeenCalledTimes(1);
    expect((await f.row("wf-one")).actions).toEqual([]);f.record("workflow","wf-one","user_paused",2);
    expect((await f.row("wf-one")).actions).toEqual(["resume","stop"]);
  });
  it("retains the goal identity and title when the native clear frame omits its id",async()=>{
    const previous=normalizeNativeRunWire("goal",{goal_id:"goal-a",status:"active",objective:"Keep this title"})!;
    const cleared=normalizeNativeRunWire("goal",{goal_id:"",status:"cleared"},previous.id)!;
    expect(cleared).toMatchObject({id:"goal-a",status:"stopped"});
    expect(normalizeNativeRunWire("goal",{goal_id:"",status:"cleared"})).toBeUndefined();
  });
  it("drops payloads and treats budget and unknown state literally",()=>{
    const row=normalizeNativeRunWire("workflow",{run_id:"wf-a",status:"future_state",objective:"Title",agent_budget:3,agents_used:0,secret:"not retained",prompt:"not retained"})!;
    expect(row.status).toBe("unknown");expect(row.budget).toEqual({unit:"agents",limit:3,used:0});expect(JSON.stringify(row)).not.toContain("not retained");
    expect(normalizeNativeRunWire("workflow",{run_id:"wf-a; stop other",status:"active"})).toBeUndefined();
  });
  it("serializes competing controls in one session and rejects a stale native revision",async()=>{
    const f=setup([],20);f.record("workflow","wf-one","active",4);const request=f.input(await f.row("wf-one"),"pause");
    f.record("workflow","wf-one","cancelled",3);expect((await f.row("wf-one")).status).toBe("running");
    f.prompt.mockImplementation(async()=>{});const first=f.service.control(request);
    await Promise.resolve();await Promise.resolve();
    const concurrent=f.service.control({...request,operationId:"operation-b"});await expect(concurrent).rejects.toThrow();
    await first;expect(f.prompt).toHaveBeenCalledTimes(1);
  });
  it("invalidates an unchanged status after its native revision advances, and forgets deleted sessions",async()=>{
    const f=setup();f.record("workflow","wf-one","active",1);
    const old=f.input(await f.row("wf-one"),"pause");f.record("workflow","wf-one","active",2);
    await expect(f.service.control(old)).rejects.toThrow("状态已变化");expect(f.prompt).not.toHaveBeenCalled();
    await f.service.forget("session-a");expect(await f.service.list()).toEqual([]);
  });
  it("ignores a native update queued by the previous connection",async()=>{
    const f=setup();f.record("workflow","wf-one","active",1);
    const event:ChatEvent={type:"runtime-update",sessionId:"session-a",update:{kind:"workflow",name:"workflow_updated",at:new Date().toISOString(),data:{nativeRun:normalizeNativeRunWire("workflow",{run_id:"wf-one",status:"user_paused",revision:2})!}}};
    bindNativeRunEventOwner(event,f.state.owner);f.state.owner={};f.service.record(event);
    expect(await f.row("wf-one")).toMatchObject({status:"running",stale:true,actions:[]});
  });
  it("lets any newer live state end an unconfirmed outcome, even when the request did not take effect",async()=>{
    const f=setup([],20);f.record("workflow","wf-one","active");f.prompt.mockImplementation(async()=>{});
    expect(await f.service.control(f.input(await f.row("wf-one"),"pause"))).toMatchObject({state:"unknown"});
    expect((await f.row("wf-one")).unavailableReason).toContain("未收到 CLI 确认");
    f.record("workflow","wf-one","active",2);
    expect(await f.row("wf-one")).toMatchObject({status:"running",actions:["pause","stop"]});
  });
  it("keeps last-known state for restored rows and only explains what can still change",async()=>{
    const seed=setup();seed.record("workflow","wf-run","active");seed.record("workflow","wf-failed","failed");
    const restored=setup(await seed.service.list());
    const running=await restored.row("wf-run"),failed=await restored.row("wf-failed");
    expect(running).toMatchObject({status:"running",stale:true,actions:[]});expect(running.unavailableReason).toContain("上次记录");
    expect(failed).toMatchObject({status:"failed",stale:true});expect(failed.unavailableReason).toBeUndefined();
  });
  it("removes only finished or restored summaries and persists the removal",async()=>{
    const f=setup();f.record("workflow","wf-live","active");f.record("workflow","wf-failed","failed");
    await expect(f.service.dismiss({sessionId:"session-a",kind:"workflow",runId:"wf-live"})).rejects.toThrow("不能移除");
    await f.service.dismiss({sessionId:"session-a",kind:"workflow",runId:"wf-failed"});
    expect((await f.service.list()).map(r=>r.id)).toEqual(["wf-live"]);
    expect(f.save).toHaveBeenLastCalledWith("session-a",[expect.objectContaining({id:"wf-live"})]);
    const restored=setup([{...(await f.row("wf-live")),stale:true}]);
    await restored.service.dismiss({sessionId:"session-a",kind:"workflow",runId:"wf-live"});
    expect(await restored.service.list()).toEqual([]);
  });
  it("announces a background workflow's final state once, never for goals, replays or user stops",async()=>{
    const f=setup();f.record("workflow","wf-done","active");f.record("workflow","wf-done","complete",2);f.record("workflow","wf-done","complete",3);
    expect(f.finished).toHaveBeenCalledTimes(1);expect(f.finished.mock.calls[0]![0]).toMatchObject({id:"wf-done",status:"completed"});
    f.record("workflow","wf-limit","active");f.record("workflow","wf-limit","budget_limited",2);
    f.record("workflow","wf-stop","active");f.record("workflow","wf-stop","cancelled",2);
    f.record("workflow","wf-replay","active",1,true);f.record("workflow","wf-replay","failed",2,true);
    f.record("workflow","wf-fresh","failed");f.record("goal","goal-done","active");f.record("goal","goal-done","complete",2);
    expect(f.finished.mock.calls.map(([row])=>row.id)).toEqual(["wf-done","wf-limit"]);
  });
});
