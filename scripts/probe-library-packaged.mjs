// Runs only through smoke-app.ps1 with its isolated user-data directory.
import {readFile} from "node:fs/promises";
import {join} from "node:path";
let workspace;
const endpoint=process.argv[2];if(!endpoint)throw Error("CDP endpoint required");
const targets=await fetch(endpoint+"/json/list").then(r=>r.json());
const target=targets.find(t=>t.type==="page");const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
let sequence=0;const pending=new Map();
socket.onmessage=({data})=>{const message=JSON.parse(data);if(message.method==="Runtime.exceptionThrown"||message.method==="Log.entryAdded")console.error(JSON.stringify(message.params));const call=pending.get(message.id);if(call){pending.delete(message.id);message.error?call.reject(Error(JSON.stringify(message.error))):call.resolve(message.result)}};
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))});
const run=async expression=>{const r=await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value};
const until=async expression=>{for(let i=0;i<80;i++){if(await run(expression))return;await new Promise(r=>setTimeout(r,100))}throw Error("Timeout: "+expression+"; "+await run('JSON.stringify({url:location.href,text:document.body.innerText.slice(0,3000),api:typeof window.grokDesktop})'))};
const click=async label=>{const point=await run(`(()=>{const b=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error("Button missing");b.scrollIntoView();const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await send("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,...point});await send("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,...point})};
const assert=(value,message)=>{if(!value)throw Error(message)};
const clickSelector=async(selector,button="left")=>{
 await until('(()=>{const b=document.querySelector('+JSON.stringify(selector)+');if(!b)return false;const r=b.getBoundingClientRect();return r.width>0&&r.height>0})()');
 const point=await run('(()=>{const b=document.querySelector('+JSON.stringify(selector)+');if(!b)throw Error("Missing "+'+JSON.stringify(selector)+');b.scrollIntoView();const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
 await send("Input.dispatchMouseEvent",{type:"mouseMoved",...point});
 for(const type of ["mousePressed","mouseReleased"])await send("Input.dispatchMouseEvent",{type,button,clickCount:1,...point});
};
const item=async(label)=>{await until('Array.from(document.querySelectorAll("[role=menuitem]")).some(e=>e.textContent.trim()==='+JSON.stringify(label)+')');await run('Array.from(document.querySelectorAll("[role=menuitem]")).find(e=>e.textContent.trim()==='+JSON.stringify(label)+').setAttribute("data-probe-item","selected")');await clickSelector('[data-probe-item="selected"]')};
try{
 await send("Runtime.enable");await until('Boolean(document.querySelector(".sb-session-more[data-session-id=library-one]"))');
 workspace=(await run("window.grokDesktop.getSettings()")).activeWorkspace;
 if(!workspace.includes("Grok-Build-Desktop-smoke-"))throw Error("Expected isolated smoke profile");
 assert(await run('document.querySelector(".sb-archived .sb-subhead").getAttribute("aria-expanded")==="false"&&!document.querySelector(".sb-session-more[data-session-id=library-two]")'),"archive group not initially folded");
 await clickSelector('.sb-session-more[data-session-id="library-one"]');
 const before=await run('(()=>{const r=document.querySelector("[role=menu]").getBoundingClientRect();return {x:r.x,y:r.y}})()');
 await send("Input.dispatchMouseEvent",{type:"mouseMoved",x:before.x+30,y:before.y+30});
 assert(await run('(()=>{const r=document.querySelector("[role=menu]").getBoundingClientRect();return Math.abs(r.x-'+before.x+')<2&&Math.abs(r.y-'+before.y+')<2})()'),"menu moved on pointer entry");
 await item("归档");await until('!document.querySelector(".sb-session-more[data-session-id=library-one]")');
 await clickSelector(".sb-archived .sb-subhead");await until('Boolean(document.querySelector(".sb-archived .sb-session-more[data-session-id=library-one]"))');
 await send("Page.reload");await until('Boolean(document.querySelector(".sb-archived .sb-subhead"))');await clickSelector(".sb-archived .sb-subhead");await until('Boolean(document.querySelector(".sb-archived .sb-session-more[data-session-id=library-one]"))');
 await clickSelector('.sb-session-more[data-session-id="library-one"]');await item("取消归档");
 await until('Boolean(document.querySelector(".sb-session-more[data-session-id=library-one]"))&&!document.querySelector(".sb-archived .sb-session-more[data-session-id=library-one]")');
 await clickSelector('.sb-session-more[data-session-id="library-one"]');await item("删除");await click("取消");
 assert(await run('Boolean(document.querySelector(".sb-session-more[data-session-id=library-one]"))'),"cancel deleted session");
 await clickSelector('.sb-session-more[data-session-id="library-one"]');await item("删除");await click("永久删除");
 await until('document.body.textContent.includes("CLI 会话删除失败")');await click("仅清理 Desktop 数据");
 await until('!document.querySelector(".sb-session-more[data-session-id=library-one]")');
 const raw=await readFile(join(workspace,"offline-cli","sessions",encodeURIComponent(workspace),"library-one","summary.json"),"utf8");
 assert(JSON.parse(raw).generated_title==="library-one","Desktop cleanup removed native source");
 await send("Page.reload");await until('Boolean(document.querySelector(".app-shell"))');
 assert(await run('!document.querySelector(".sb-session-more[data-session-id=library-one]")'),"dismissed record reappeared after reload");
 // A restored inactive history tab must close from its own context menu without opening a CLI.
 await run('localStorage.setItem("grok.workbench-layout.v1",JSON.stringify({version:1,focusedPane:"main",root:{kind:"leaf",id:"main",tabs:[{kind:"session",workspace:'+JSON.stringify(workspace)+',id:"library-one",title:"已清理旧标签"}]}}));location.reload()');
 await until('Array.from(document.querySelectorAll("[role=tab]")).some(e=>e.textContent==="已清理旧标签")');
 await run('Array.from(document.querySelectorAll("[role=tab]")).find(e=>e.textContent==="已清理旧标签").setAttribute("data-probe-tab","stale")');
 await clickSelector('[data-probe-tab="stale"]',"right");await item("关闭标签");
 await until('!Array.from(document.querySelectorAll("[role=tab]")).some(e=>e.textContent==="已清理旧标签")');
 console.log("LIBRARY_PACKAGED_PASSED stable menu pointer entry, archive fold/restore/reload, cancel deletion, explicit Desktop cleanup/native retention, stale tab context close; real CLI disabled");
}finally{socket.close()}
