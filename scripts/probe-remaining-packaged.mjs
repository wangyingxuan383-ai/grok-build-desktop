// Runs only through smoke-app.ps1 with its isolated user-data directory.
import {writeFile,mkdir} from "node:fs/promises";
let workspace;
let terminalId;
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
try{
 await send("Runtime.enable");await send("Log.enable");await send("Page.reload");
 await until('Boolean(window.grokDesktop&&document.querySelector(".app-shell"))');
 workspace=(await run("window.grokDesktop.getSettings()")).activeWorkspace;
 if(!workspace.includes("Grok-Build-Desktop-smoke-"))throw Error("Expected isolated smoke profile");
 const terminal=await run(`window.grokDesktop.createWorkspaceTerminal(${JSON.stringify(workspace)})`);terminalId=terminal.id;
 await run(`window.grokDesktop.writeWorkspaceTerminal(${JSON.stringify(terminalId)},${JSON.stringify("Write-Output ('ISOLATED_'+'PTY_OK')\r")})`);
 await until(`window.grokDesktop.listWorkspaceTerminals(${JSON.stringify(workspace)}).then(rows=>rows.some(row=>row.id===${JSON.stringify(terminalId)}&&row.output.includes("ISOLATED_PTY_OK")))`);
 await run(`window.grokDesktop.resizeWorkspaceTerminal(${JSON.stringify(terminalId)},90,25)`);
 await run(`window.grokDesktop.writeWorkspaceTerminal(${JSON.stringify(terminalId)},"exit\\r")`);
 await until(`window.grokDesktop.listWorkspaceTerminals(${JSON.stringify(workspace)}).then(rows=>rows.some(row=>row.id===${JSON.stringify(terminalId)}&&row.status==="exited"))`);
 await run(`window.grokDesktop.closeWorkspaceTerminal(${JSON.stringify(terminalId)})`);terminalId=undefined;
 const report=await run('window.grokDesktop.getTokenActivity({})');
 assert(report.windows.today.totalTokens===0,"isolated ASAR SQLite Worker failed or contains unexpected usage");
 // Image draft/index APIs have no CLI or generation side effect. No directories or model jobs are created.
 const index=await run('window.grokDesktop.listImageWorkspace()');
 assert(index.conversations.length===0&&/Grok Images/.test(index.outputRoot),"image store bootstrap failed");
 await run('localStorage.setItem("grok.app-mode.v1","image");location.reload()');
 await until('Boolean(document.querySelector(".im-composer textarea"))');
 await run('document.querySelector("textarea").focus()');await send("Input.insertText",{text:"隔离图像草稿 · 不提交"});
 await click("编程");await until('Boolean(document.querySelector(".app-shell"))');
 await run('localStorage.setItem("grok.app-mode.v1","image");location.reload()');
 await until('Boolean(document.querySelector(".im-composer textarea"))');
 assert(await run('document.querySelector("textarea").value==="隔离图像草稿 · 不提交"'),"mode/restart draft lost");
 for(const theme of ["light","dark"]){
  await run(`window.grokDesktop.getSettings().then(settings=>window.grokDesktop.updateSettings({theme:{...settings.theme,mode:${JSON.stringify(theme)}}}))`);
  await send("Page.reload");await until(`Boolean(document.querySelector(".im-composer textarea"))&&document.documentElement.dataset.themeResolved===${JSON.stringify(theme)}`);
  for(const width of [1366,1920])for(const scale of [1,1.5]){
  await send("Emulation.setDeviceMetricsOverride",{width:Math.round(width/scale),height:Math.round((width===1366?768:1080)/scale),deviceScaleFactor:scale,mobile:false});

  assert(await run('document.querySelector("textarea").getBoundingClientRect().width>150 && document.documentElement.scrollWidth<=innerWidth+2'),"image layout overflow");
  }
  await mkdir("out/remaining-visuals",{recursive:true});
  const shot=await send("Page.captureScreenshot",{format:"png"});await writeFile(`out/remaining-visuals/image-${theme}.png`,Buffer.from(shot.data,"base64"));
 }
 assert((await run('window.grokDesktop.listImageWorkspace()')).conversations.length===0,"draft test unexpectedly created image job");
 console.log("REMAINING_PACKAGED_PASSED ASAR SQLite Worker, native PTY output/resize/exit, independent image store, draft/mode/restart, two viewport sizes/scales/themes; no model calls");
}finally{if(terminalId)await run(`window.grokDesktop.closeWorkspaceTerminal(${JSON.stringify(terminalId)})`).catch(()=>{});socket.close()}
