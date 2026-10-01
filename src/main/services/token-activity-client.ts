import type {TokenRecordContext} from "./token-activity-service";
import { Worker } from "node:worker_threads";
import type { TokenActivityQuery,TokenActivityReport,TurnPresentation } from "../../shared/types";
export class TokenActivityClient {
 private flights=new Set<Promise<any>>();private closed=false;
 private worker?:Worker;private sequence=0;private pending=new Map<number,{resolve(value:any):void;reject(error:Error):void}>();private idle?:ReturnType<typeof setTimeout>;
 constructor(private readonly root:string){}
 private call(method:string,args:unknown[]):Promise<any>{
  if(this.closed)return Promise.reject(Error("统计服务已关闭"));
  clearTimeout(this.idle);
  if(!this.worker){const entry="./token-activity-worker.js";const workerUrl=new URL(entry,import.meta.url);const worker=new Worker(workerUrl,{workerData:{root:this.root}});this.worker=worker;
   const fail=(error:Error)=>{if(this.worker!==worker)return;this.worker=undefined;for(const request of this.pending.values())request.reject(error);this.pending.clear()};
   worker.on("error",fail);worker.on("exit",code=>fail(Error(`统计 Worker 已退出（${code}）`)));
   worker.on("message",({id,result,error})=>{const request=this.pending.get(id);if(!request)return;this.pending.delete(id);if(error)request.reject(Error(error));else request.resolve(result);if(!this.pending.size)this.idle=setTimeout(()=>{if(this.worker===worker&&!this.pending.size){this.worker=undefined;void worker.terminate()}},5000)});
  }
  const flight=new Promise((resolve,reject)=>{const id=++this.sequence;this.pending.set(id,{resolve,reject});this.worker!.postMessage({id,method,args,now:new Date().toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC"})});
  this.flights.add(flight);void flight.then(()=>this.flights.delete(flight),()=>this.flights.delete(flight));return flight;
 }
 record(id:string,presentation:TurnPresentation,context:TokenRecordContext={}){return this.call("record",[id,presentation,context]) as Promise<void>}
 forgetSession(id:string){return this.forgetSessions([id])}
 forgetSessions(ids:Iterable<string>){return this.call("forgetSessions",[[...ids]]) as Promise<void>}
 rebindSession(source:string,target:string,workspace:string){return this.call("rebindSession",[source,target,workspace]) as Promise<void>}
 report(query:TokenActivityQuery={}){return this.call("report",[query]) as Promise<TokenActivityReport>}
 async dispose(){this.closed=true;await Promise.allSettled([...this.flights]);clearTimeout(this.idle);const worker=this.worker;this.worker=undefined;if(worker)await worker.terminate()}
}
