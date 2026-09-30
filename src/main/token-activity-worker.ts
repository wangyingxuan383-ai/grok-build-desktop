import { parentPort, workerData } from "node:worker_threads";
import { TokenActivitySqlite } from "./services/token-activity-sqlite";
const database=new TokenActivitySqlite(workerData.root);
const ready=database.open();let queue=Promise.resolve();
void ready.catch(()=>undefined); // Requests receive the initialization error; do not abandon it as an unhandled rejection.
parentPort!.on("message",({id,method,args,now,timeZone})=>{queue=queue.then(async()=>{try{await ready;let result;switch(method){case "record":result=database.record(args[0],args[1],args[2],new Date(now));break;case "forgetSessions":result=database.forgetSessions(args[0],new Date(now),timeZone);break;case "rebindSession":result=database.rebindSession(args[0],args[1],args[2]);break;case "report":result=database.report(args[0],new Date(now),timeZone);break;default:throw Error("未知统计操作")}parentPort!.postMessage({id,result})}catch(error){parentPort!.postMessage({id,error:error instanceof Error?error.message:String(error)})}})});
parentPort!.on("close",()=>database.close());
