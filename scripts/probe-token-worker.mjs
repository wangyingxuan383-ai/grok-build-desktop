import {Worker} from "node:worker_threads";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
const root=await mkdtemp(join(tmpdir(),"grok-token-worker-probe-"));
const worker=new Worker(pathToFileURL(resolve("out/main/token-activity-worker.js")),{workerData:{root}});let id=0;
const call=(method,args)=>new Promise((resolve,reject)=>{const own=++id;const timeout=setTimeout(()=>{cleanup();reject(Error("worker timeout"))},10000);const error=value=>{cleanup();reject(value)};const message=value=>{if(value.id!==own)return;cleanup();value.error?reject(Error(value.error)):resolve(value.result)};const cleanup=()=>{clearTimeout(timeout);worker.off("message",message);worker.off("error",error)};worker.on("error",error);worker.on("message",message);worker.postMessage({id:own,method,args,now:"2026-09-28T17:00:00Z",timeZone:"Asia/Shanghai"})});
try{await call("record",["isolated",{turnId:"one",completedAt:"2026-09-28T17:00:00Z",usage:{totalTokens:10,inputTokens:8,outputTokens:2,source:"acp-turn"}},{}]);const result=await call("report",[{}]);if(result.windows.today.totalTokens!==10)throw Error("worker totals mismatch");console.log("TOKEN_WORKER_PASSED built worker migration, write, report, timezone")}finally{await worker.terminate();await rm(root,{recursive:true,force:true})}
