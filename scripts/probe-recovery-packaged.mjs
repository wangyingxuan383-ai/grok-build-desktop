import {writeFile,mkdir,readFile} from "node:fs/promises";
import {join} from "node:path";
const endpoint=process.argv[2];if(!endpoint)throw Error("CDP endpoint required");
const pages=await fetch(endpoint+"/json/list").then(response=>response.json());const target=pages.find(page=>page.type==="page"&&!page.url.startsWith("devtools:"));if(!target)throw Error("Renderer target missing");const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener("open",resolve,{once:true});socket.addEventListener("error",reject,{once:true})});let sequence=0;const pending=new Map();socket.onmessage=event=>{const row=JSON.parse(event.data);const request=pending.get(row.id);if(request){pending.delete(row.id);row.error?request.reject(Error(JSON.stringify(row.error))):request.resolve(row.result)}};
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))});
const run=async expression=>{const value=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(value.exceptionDetails)throw Error(JSON.stringify(value.exceptionDetails));return value.result?.value};
const wait=async expression=>{for(let i=0;i<100;i++){if(await run(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error("Timed out: "+expression)};
try{
 await send("Runtime.enable");await wait('Boolean(document.querySelector(".app-shell"))');
 const settings=await run('window.grokDesktop.getSettings()');const root=settings.activeWorkspace;if(!root.includes("Grok-Build-Desktop-smoke-"))throw Error("Not an isolated profile");
 const info=await run('window.grokDesktop.getBuildInfo()');const expected=JSON.parse(await readFile(new URL("../package.json",import.meta.url),"utf8")).version;if(info.version!==expected||!info.packaged)throw Error("Packaged version mismatch");
 const file=join(root,"preview.html");await writeFile(file,"<button onclick=\"this.textContent='clicked'\" id='counter'>click</button><script>const button=document.getElementById('counter');button.click();let isolated=false;try{isolated=typeof parent.grokDesktop==='undefined'}catch{isolated=true}parent.postMessage({recoveryPreview:true,clicked:button.textContent,isolated},'*');</script>");
 const artifact=await run(`window.grokDesktop.readWorkspaceArtifact(${JSON.stringify(root)},${JSON.stringify(file)})`);if(!artifact.previewUrl?.startsWith("grok-html://preview/"))throw Error("Main did not issue HTML preview");
 await run(`(()=>{window.addEventListener('message',event=>{if(event.data?.recoveryPreview)window.__recoveryPreview=event.data});const frame=document.createElement('iframe');frame.sandbox='allow-scripts';frame.src=${JSON.stringify(artifact.previewUrl)};document.body.append(frame)})()`);
 await wait('Boolean(window.__recoveryPreview)');const preview=await run('window.__recoveryPreview');if(preview.clicked!=="clicked"||!preview.isolated)throw Error("Packaged preview failed isolation");
 const runsRoot=join(root,"automations","runs");await mkdir(runsRoot,{recursive:true});const record={id:"recovery-warning",taskId:"test-task",status:"completed",scheduledAt:new Date().toISOString(),finishedAt:new Date().toISOString(),warning:"One operation was declined",deniedConfirmations:1,trigger:"manual"};await writeFile(join(runsRoot,record.id+".json"),JSON.stringify(record));
 await run('window.grokDesktop.clearAutomationRuns("test-task")');
 const remains=await readFile(join(runsRoot,record.id+".json"),"utf8").then(()=>true,error=>{if(error.code!=="ENOENT")throw error;return false;});if(remains)throw Error("History cleanup IPC did not remove the isolated record");
 console.log("RECOVERY_PACKAGE_PASSED build marker, real artifact IPC, interactive isolated HTML, scoped history cleanup");
}finally{socket.close()}
