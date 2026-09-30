import { DatabaseSync } from "node:sqlite";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import type { TokenActivityQuery, TurnPresentation } from "../../shared/types";
import { withCrossProcessFileLock } from "./json-store";
import { addTurnToRollup, buildTokenReport, emptyRollup, localDateKey, migrate, prune, validTimeZone, type ActivityData, type DayRollup, type TurnRecord } from "./token-activity-service";

/** Used only inside the statistics Worker in production. */
export class TokenActivitySqlite {
 private db!:DatabaseSync;
 constructor(private readonly root:string){}
 async open(){
  await mkdir(this.root,{recursive:true});this.db=new DatabaseSync(join(this.root,"token-activity.sqlite"));
  this.db.exec("PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS turns(session TEXT NOT NULL,turn TEXT NOT NULL,at TEXT NOT NULL,model TEXT,provider TEXT,workspace TEXT,json TEXT NOT NULL,PRIMARY KEY(session,turn)); CREATE INDEX IF NOT EXISTS turns_at ON turns(at); CREATE INDEX IF NOT EXISTS turns_workspace ON turns(workspace,at); CREATE INDEX IF NOT EXISTS turns_model ON turns(model,at); CREATE INDEX IF NOT EXISTS turns_provider ON turns(provider,at); CREATE TABLE IF NOT EXISTS buckets(kind TEXT NOT NULL,day TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(kind,day));");
  const path=join(this.root,"token-activity.json");
  await withCrossProcessFileLock(`${path}.lock`,async()=>{
   if(this.db.prepare("SELECT value FROM meta WHERE key='migration'").get())return;
   let data:ActivityData={turns:[],days:{}};
   try{const raw=await readFile(path,"utf8");data=migrate(JSON.parse(raw));await copyFile(path,`${path}.pre-sqlite-backup`,constants.COPYFILE_EXCL).catch(error=>{if(error.code!=="EEXIST")throw error})}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error}
   this.transaction(()=>{for(const row of data.turns)this.put(row);for(const [kind,rows]of Object.entries({anonymous:data.anonymousDays??{},legacy:data.legacyUtcDays??{}}))for(const row of Object.values(rows))this.bucket(kind,row);this.db.prepare("INSERT INTO meta VALUES('migration','1')").run()});
  });
 }
 close(){this.db?.close()}
 private transaction<T>(run:()=>T):T{this.db.exec("BEGIN IMMEDIATE");try{const result=run();this.db.exec("COMMIT");return result}catch(error){this.db.exec("ROLLBACK");throw error}}
 private put(row:TurnRecord){this.db.prepare("INSERT INTO turns VALUES(?,?,?,?,?,?,?) ON CONFLICT(session,turn) DO UPDATE SET at=excluded.at,model=excluded.model,provider=excluded.provider,workspace=excluded.workspace,json=excluded.json").run(row.sessionId,row.turnId,row.at,row.modelId??null,row.providerId??null,row.workspace??null,JSON.stringify(row))}
 private bucket(kind:string,row:DayRollup){this.db.prepare("INSERT INTO buckets VALUES(?,?,?) ON CONFLICT(kind,day) DO UPDATE SET json=excluded.json").run(kind,row.day,JSON.stringify(row))}
 private prune(now:Date){const cutoff=new Date(now.getTime()-400*86400000).toISOString();this.db.prepare("DELETE FROM turns WHERE at < ?").run(cutoff);this.db.prepare("DELETE FROM buckets WHERE day < ?").run(cutoff.slice(0,10))}
 record(sessionId:string,presentation:TurnPresentation,context:{workspace?:string},now:Date){return this.transaction(()=>{
  const existing=this.db.prepare("SELECT json FROM turns WHERE session=? AND turn=?").get(sessionId,presentation.turnId);
  if(existing&&!presentation.usage)return;
  const usage=presentation.usage;const row:TurnRecord={at:presentation.completedAt??now.toISOString(),sessionId,turnId:presentation.turnId,hasUsage:Boolean(usage),workspace:context.workspace};
  if(usage)for(const key of ["source","modelId","providerId","inputTokens","outputTokens","cachedReadTokens","reasoningTokens","totalTokens"] as const)if(usage[key]!==undefined)(row as any)[key]=usage[key];
  this.put(row);this.prune(now);
 })}
 forgetSessions(ids:string[],now:Date,timeZone:string){return this.transaction(()=>{for(const id of new Set(ids)){
  const rows=this.db.prepare("SELECT json FROM turns WHERE session=?").all(id);
  for(const value of rows){const row=JSON.parse(String(value.json)) as TurnRecord,day=localDateKey(row.at,validTimeZone(timeZone));const previous=this.db.prepare("SELECT json FROM buckets WHERE kind='anonymous' AND day=?").get(day);const bucket=previous?JSON.parse(String(previous.json)) as DayRollup:emptyRollup(day);addTurnToRollup(bucket,row);this.bucket("anonymous",bucket)}
  this.db.prepare("DELETE FROM turns WHERE session=?").run(id);
 }this.prune(now)})}
 rebindSession(source:string,target:string,workspace:string){if(source===target){this.transaction(()=>{for(const value of this.db.prepare("SELECT json FROM turns WHERE session=?").all(source)){const row=JSON.parse(String(value.json));this.put({...row,workspace})}});return}
  return this.transaction(()=>{const rows=this.db.prepare("SELECT json FROM turns WHERE session=?").all(source);for(const value of rows){const row=JSON.parse(String(value.json)) as TurnRecord;const conflict=this.db.prepare("SELECT json FROM turns WHERE session=? AND turn=?").get(target,row.turnId);if(conflict)throw Error("Token 记录目标身份冲突，未迁移任何记录");this.put({...row,sessionId:target,workspace})}this.db.prepare("DELETE FROM turns WHERE session=?").run(source)})
 }
 report(query:TokenActivityQuery,now:Date,timeZone:string){
  return this.transaction(()=>{this.prune(now);const clauses:string[]=[],values:string[]=[];for(const [key,column]of [["modelId","model"],["providerId","provider"],["workspace","workspace"]] as const)if(query[key]){clauses.push(`${column}=?`);values.push(query[key]!)}
   const turns=this.db.prepare(`SELECT json FROM turns${clauses.length?" WHERE "+clauses.join(" AND "):""}`).all(...values).map(row=>JSON.parse(String(row.json)) as TurnRecord);
   const data:ActivityData={schemaVersion:2,turns,days:{},anonymousDays:{},legacyUtcDays:{}};
   for(const row of this.db.prepare("SELECT kind,day,json FROM buckets").all())(row.kind==="legacy"?data.legacyUtcDays!:data.anonymousDays!)[String(row.day)]=JSON.parse(String(row.json));
   const result=buildTokenReport(data,query,now,validTimeZone(timeZone));
   const distinct=(column:string)=>this.db.prepare(`SELECT DISTINCT ${column} AS value FROM turns WHERE ${column} IS NOT NULL ORDER BY ${column}`).all().map(row=>String(row.value));
   result.models=distinct("model");result.providers=distinct("provider");result.workspaces=distinct("workspace");return result;
  });
 }
}
