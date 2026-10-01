import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {afterEach,expect,it} from "vitest";
import {TokenActivitySqlite} from "./token-activity-sqlite";
import {TokenActivityService} from "./token-activity-service";
import type {TurnPresentation} from "../../shared/types";
const roots:string[]=[],databases:TokenActivitySqlite[]=[];const now=new Date("2026-09-28T16:30:00.000Z"),zone="Asia/Shanghai";
afterEach(async()=>{databases.splice(0).forEach(value=>value.close());for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})});
async function root(){const value=await mkdtemp(join(tmpdir(),"grok-token-sqlite-"));roots.push(value);return value}
async function open(path:string){const value=new TokenActivitySqlite(path);await value.open();databases.push(value);return value}
const turn=(id:string,total?:number):TurnPresentation=>({turnId:id,ordinal:1,startedAt:now.toISOString(),completedAt:now.toISOString(),outcome:"completed",usage:{source:"acp-turn",exact:true,inputTokens:4,outputTokens:2,totalTokens:total,modelId:"model"}} as TurnPresentation);
it("merges partial authoritative usage without losing totals, identity or workspace, and accepts corrected decreases",async()=>{
 const db=await open(await root()),legacy=new TokenActivityService(await root(),()=>now,zone);
 const original={...turn("partial"),usage:{source:"prompt-result" as const,exact:true as const,inputTokens:80,outputTokens:20,totalTokens:100,modelId:"model",providerId:"p"}};
 const partial={...turn("partial"),usage:{source:"acp-turn" as const,exact:true as const,inputTokens:79}};
 const corrected={...partial,usage:{...partial.usage,totalTokens:90,outputTokens:11}};
 for(const [index,value]of [original,partial,corrected,original].entries()){
  const context=index===0?{workspace:"C:/one"}:{};db.record("s",value,context,now);await legacy.record("s",value,context);
  expect(db.report({},now,zone)).toEqual(await legacy.report());
  const report=db.report({workspace:"C:/one",modelId:"model",providerId:"p"},now,zone);
  expect(report.windows.today.turns).toBe(1);
  expect(report.windows.today.totalTokens).toBe(index<2?100:90);
  expect(report.windows.today.outputTokens).toBe(index<2?20:11);
 }
});
it("matches existing report semantics across duplicate usage, missing totals, local date and anonymous deletion",async()=>{
 const db=await open(await root()),legacy=new TokenActivityService(await root(),()=>now,zone);
 for(const value of [turn("a"),turn("b",6),turn("b",9)]){db.record("s",value,{workspace:"C:/one"},now);await legacy.record("s",value,{workspace:"C:/one"})}
 expect(db.report({},now,zone)).toEqual(await legacy.report());expect(db.report({workspace:"C:/one"},now,zone)).toEqual(await legacy.report({workspace:"C:/one"}));
 db.forgetSessions(["s"],now,zone);await legacy.forgetSession("s");expect(db.report({},now,zone)).toEqual(await legacy.report());
});
it("backs up and imports once, then both GUI/worker connections share upserts without writing legacy JSON",async()=>{
 const path=await root(),raw=JSON.stringify({schemaVersion:2,turns:[{at:now.toISOString(),sessionId:"old",turnId:"t",totalTokens:7,hasUsage:true}],days:{}});await writeFile(join(path,"token-activity.json"),raw);
 const first=await open(path),second=await open(path);expect(await readFile(join(path,"token-activity.json.pre-sqlite-backup"),"utf8")).toBe(raw);first.record("s",turn("new",6),{},now);second.record("s",turn("new",10),{},now);expect(first.report({},now,zone).windows.today.totalTokens).toBe(17);expect(await readFile(join(path,"token-activity.json"),"utf8")).toBe(raw);
});
it("keeps 400-day retention and atomically rejects rebind collisions",async()=>{const db=await open(await root());db.record("s",{...turn("old",5),completedAt:"2020-01-01T00:00:00Z"},{},now);expect(db.report({},now,zone).windows.today.turns).toBe(0);db.record("one",turn("same",6),{},now);db.record("two",turn("same",8),{},now);expect(()=>db.rebindSession("one","two","new")).toThrow("冲突");expect(db.report({},now,zone).windows.today.totalTokens).toBe(14)});

it("reconciles native and child-session identities without double counting cumulative usage",async()=>{
 const root=await mkdtemp(join(tmpdir(),"grok-child-alias-"));roots.push(root);const store=new TokenActivitySqlite(root);await store.open();
 const now=new Date("2026-10-01T04:00:00Z");
 try{
  for(const [turnId,totalTokens,relatedTurnIds]of [["subagent:child",300,[]],["subagent:native",500,["subagent:child","subagent:native"]]] as const){store.record("parent",{turnId,ordinal:0,startedAt:now.toISOString(),completedAt:now.toISOString(),usage:{source:"subagent",exact:true,totalTokens}},{relatedTurnIds:[...relatedTurnIds]},now);}
  expect(store.report({},now,"Asia/Shanghai").windows.today).toMatchObject({totalTokens:0,subagentTokens:500,subagentTurns:1});
 }finally{store.close();}
});
