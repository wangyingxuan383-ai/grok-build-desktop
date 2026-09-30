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
const click=async selector=>{const point=await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error("Missing element");e.scrollIntoView({block:"nearest"});const r=e.getBoundingClientRect();if(!r.width||!r.height)throw Error("Invisible element "+${JSON.stringify(selector)});return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);for(const type of ["mousePressed","mouseReleased"])await send("Input.dispatchMouseEvent",{type,button:"left",clickCount:1,...point})};
const command=async label=>{
 await run("window.dispatchEvent(new Event('grok:command-search'))");
 await wait('Boolean(document.querySelector(".command-search-input"))');
 await send("Input.insertText",{text:label});
 await wait(`Array.from(document.querySelectorAll("#command-results [role=option]")).some(e=>e.innerText.trim()===${JSON.stringify(label)})`);
 await run(`Array.from(document.querySelectorAll("#command-results [role=option]")).find(e=>e.innerText.trim()===${JSON.stringify(label)}).dataset.probeCommand="selected"`);
 await click('[data-probe-command="selected"]');
 await wait('!document.querySelector(".command-search-input")');
};
const pages=[
 ["文件",".file-workbench"],["源代码管理",".git-workbench, .git-workbench-empty"],["Worktree",".worktree-workbench, .worktree-empty"],
 ["Memory",".memory-workbench"],["Agent 与 Persona",".definition-workbench"],["执行配置档",".profile-workbench"],
 ["子智能体看板",".agent-dashboard-workbench"],["终端",".terminal-workbench"],["浏览器",".browser-workbench"],
 ["产物预览",".artifact-workbench"],
 ...["任务中心","扩展与 Skills","设置","账号","模型提供商","诊断","关于与更新","使用引导","创作"].map(name=>[name,".workbench-page-host"])
];
const results=[];
const onlyPage=process.argv[3];
const output=onlyPage?"out/page-matrix-focused":"out/page-matrix";
try{
 await send("Runtime.enable");await wait('Boolean(document.querySelector(".app-shell"))');
 const settings=await run("window.grokDesktop.getSettings()");
 if(!settings.activeWorkspace.includes("Grok-Build-Desktop-smoke-"))throw Error("Not an isolated profile");
 const workspaces=await run("window.grokDesktop.discoverWorkspaces(true)");
 if(workspaces.some(w=>w.cwd!==settings.activeWorkspace))throw Error("Offline workspace discovery leaked external history");
 await mkdir(output,{recursive:true});
 for(const theme of ["dark","light","custom"]){
  await run(`window.grokDesktop.updateSettings({theme:{... ${JSON.stringify(settings.theme)},mode:${JSON.stringify(theme)},customBase:"dark"}})`);
  await send("Page.reload");
  await wait('Boolean(document.querySelector(".app-shell"))');
 for(const [label,selector] of pages){
  if(onlyPage && label!==onlyPage)continue;
  await command(label);
  await wait(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  await new Promise(r=>setTimeout(r,350));
  const error=await run('document.querySelector(".error-toast")?.innerText || ""');
  if(error)throw Error(label+" unexpected application error: "+error);
  const baseline=exceptions.length;
  for(const [width,height] of [[1920,1080],[1366,768],[1280,720],[911,512]]){
   await send("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:false});
   const state=await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return{width:r.width,height:r.height,text:e.innerText.slice(0,1400),overflow:document.documentElement.scrollWidth-innerWidth}})()`);
   if(state.width<120||state.height<60||state.overflow>2||!state.text.trim())throw Error(label+" unusable "+JSON.stringify(state));
   results.push({page:label,theme,viewport:[width,height],...state});
  }
  if(exceptions.length!==baseline)throw Error(label+" runtime exception");
  if(onlyPage==="Memory"){
   await wait('document.querySelector(".memory-editor .monaco-editor")?.getBoundingClientRect().height>80');
   await click(".memory-editor .monaco-editor .view-lines");
   const text="isolated-memory-"+theme;
   await send("Input.insertText",{text});
   await wait('!document.querySelector(".memory-toolbar .primary").disabled');
   await click(".memory-toolbar .primary");
   await wait('document.querySelector(".memory-notice")?.textContent.includes("已原子保存")');
   const entries=await run(`window.grokDesktop.listMemory(${JSON.stringify(settings.activeWorkspace)},"")`);
   if(!entries.some(entry=>entry.scope==="workspace"&&entry.content.includes(text)))throw Error("Memory save did not persist to workspace scope");
  }
  const shot=await send("Page.captureScreenshot",{format:"png"});
  await writeFile(output+"/"+results.length+".png",Buffer.from(shot.data,"base64"));
  console.log("PAGE_OK "+theme+" "+label);
 }
 }
 await command("会话");
 if(exceptions.length)throw Error("Runtime exceptions: "+JSON.stringify(exceptions));
 await writeFile(output+"/results.json",JSON.stringify(results,null,2));
 console.log("PAGES_PASSED "+(onlyPage?1:pages.length)+" entries; dark/light/custom; 1920/1366/150%-equivalent; "+(onlyPage==="Memory"?"real editor input/save/re-read; ":"navigation/empty/error layout only; ")+"no model calls");
}finally{ws.close()}
