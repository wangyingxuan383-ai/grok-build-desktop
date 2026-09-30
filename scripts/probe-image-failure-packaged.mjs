// Navigation/layout acceptance only. No generation, login, install, task creation or model request.
import {mkdir,writeFile} from "node:fs/promises";
const endpoint=process.argv[2];
if(!endpoint)throw Error("CDP endpoint required");
const target=(await fetch(endpoint+"/json/list").then(r=>r.json())).find(t=>t.type==="page");
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
let seq=0;const pending=new Map(),exceptions=[];
ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.method==="Runtime.exceptionThrown")exceptions.push(m.params);const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}};
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error(method+" timeout"))},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))});
const run=async expression=>{const r=await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value};
const wait=async expression=>{for(let i=0;i<100;i++){if(await run(expression))return;await new Promise(r=>setTimeout(r,100))}throw Error("Timeout "+expression+" "+await run("document.body.innerText.slice(-3500)"))};
const click=async selector=>{const point=await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error("Missing element");e.scrollIntoView({block:"nearest"});const r=e.getBoundingClientRect();if(!r.width||!r.height)throw Error("Invisible element");return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);for(const type of ["mousePressed","mouseReleased"])await send("Input.dispatchMouseEvent",{type,button:"left",clickCount:1,...point})};
const command=async label=>{
 await click('button[aria-label="搜索命令和会话"]');
 await wait('Boolean(document.querySelector(".command-search-input"))');
 await send("Input.insertText",{text:label});
 await wait(`Array.from(document.querySelectorAll("#command-results [role=option]")).some(e=>e.innerText.trim()===${JSON.stringify(label)})`);
 await run(`Array.from(document.querySelectorAll("#command-results [role=option]")).find(e=>e.innerText.trim()===${JSON.stringify(label)}).dataset.probeCommand="selected"`);
 await click('[data-probe-command="selected"]');
 await wait('!document.querySelector(".command-search-input")');
};
try {
 await send("Runtime.enable"); await wait('Boolean(document.querySelector(".app-shell"))');
 const settings=await run('window.grokDesktop.getSettings()');
 if(!settings.activeWorkspace.includes('Grok-Build-Desktop-smoke-'))throw Error('Not isolated');
 const outside=settings.activeWorkspace.replace(/[\\/]workspace$/, '/outside.log');
 const opened=await run(`window.grokDesktop.openEditorDocument(${JSON.stringify(settings.activeWorkspace)},${JSON.stringify(outside)})`);
 if(opened.kind!=='document'||opened.document.editable||opened.document.content!=='external read probe')throw Error('External readonly IPC failed');
 await run('window.grokDesktop.saveImageDraft("image-failure-probe", "")');
 await run('localStorage.setItem("grok.app-mode.v1","image")');
 await send('Page.reload'); await wait('Boolean(document.querySelector(".image-shell"))');
 await click('.image-sidebar .sb-session .session-open');
 await wait('Boolean(document.querySelector(".im-composer textarea"))');
 await click('.im-composer textarea'); await send('Input.insertText',{text:'x'});
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
 await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
 if(await run('document.querySelector("textarea").value')!=='')throw Error('Draft not empty');
 await click('.image-sidebar .sb-mode button'); await wait('Boolean(document.querySelector(".app-shell"))');
 const state=await run('window.grokDesktop.listImageWorkspace()');
 if(state.conversations[0].draft!=='' || state.conversations[0].jobs.length!==1 || state.conversations[0].jobs[0].job.status!=='failed')throw Error('Draft/recovery mismatch');
 if(exceptions.length)throw Error(JSON.stringify(exceptions));
 console.log('IMAGE_FAILURE_PACKAGED_PASSED real external readonly IPC, empty-draft IPC, mouse/keyboard mode exit, recovered failed job retained, no model request');
}finally{ws.close()}
