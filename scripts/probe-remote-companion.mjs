import{readFile,writeFile}from"node:fs/promises";
import{join}from"node:path";
import{request}from"node:https";
import{createServer}from"node:net";
import{X509Certificate}from"node:crypto";
const endpoint=process.argv[2];const targets=await(await fetch(endpoint+"/json/list")).json();const socket=new WebSocket(targets.find(t=>t.type==="page").webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j});
let seq=0,global;const pending=new Map();socket.onmessage=({data})=>{const msg=JSON.parse(data);const callback=pending.get(msg.id);if(callback){clearTimeout(callback.timer);pending.delete(msg.id);msg.error?callback.reject(Error(msg.error.message)):callback.resolve(msg.result)}};
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error(method+" timed out"))},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))});
const run=async expression=>{const r=await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value};
const call=async(functionDeclaration,...args)=>{const r=await send("Runtime.callFunctionOn",{objectId:global,functionDeclaration,arguments:args.map(value=>({value})),awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value};
const wait=async expression=>{for(let i=0;i<120;i++){if(await run(expression))return;await new Promise(r=>setTimeout(r,70))}throw Error("Not ready: "+expression)};
const click=async selector=>{const point=await call("function(selector){const e=document.querySelector(selector);if(!e)throw Error('Missing '+selector);e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}}",selector);await send("Input.dispatchMouseEvent",{type:"mouseMoved",...point});for(const type of ["mousePressed","mouseReleased"])await send("Input.dispatchMouseEvent",{type,button:"left",clickCount:1,...point})};
const choose=async text=>{await call("function(text){document.querySelector('[data-remote-target]')?.removeAttribute('data-remote-target');const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===text);if(!e)throw Error('Missing '+text);e.dataset.remoteTarget='1'}",text);await click('[data-remote-target="1"]')};
try{
 await send("Runtime.enable");await wait('Boolean(document.querySelector(".app-shell"))');global=(await send("Runtime.evaluate",{expression:"globalThis"})).result.objectId;
 const settings=await run("window.grokDesktop.getSettings()");if(!settings.activeWorkspace.includes("Grok-Build-Desktop-smoke-"))throw Error("Not isolated");
 await click('button[aria-label="设置"]');await wait('document.body.innerText.includes("手机连接")');await choose("手机连接");await wait('Boolean(document.querySelector(".remote-settings"))');
 const reserve=createServer();await new Promise(r=>reserve.listen(0,"127.0.0.1",r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 await click('.remote-settings details > summary');
 await call("function(value){const e=document.querySelector('.remote-settings input[type=number]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(e,String(value));e.dispatchEvent(new Event('input',{bubbles:true}))}",port);
 await choose("开启手机连接");await wait('Boolean(document.querySelector(".remote-status.online"))');await choose("配对新手机");await wait('Boolean(document.querySelector(".remote-pairing img"))');
 let state=await run("window.grokDesktop.getRemoteState()");
 const displayed=await run("document.querySelector('.remote-addresses code').textContent");
 if(displayed!==state.addresses[0]||new URL(state.pairing.uri).searchParams.get('host')!==displayed)throw Error('Default pairing address disagrees with visible selection');
 if(state.addressOptions.some(o=>o.kind==='lan')&&state.addressOptions[0].kind==='vpn')throw Error('Virtual adapter incorrectly preferred');
 if(state.addresses.length>1){
  const originalCode=state.pairing.code;await run("document.querySelector('.remote-addresses select').focus()");
  for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
  await wait("Boolean(document.querySelector('.remote-pairing img')) && document.querySelector('.remote-addresses code').textContent !== "+JSON.stringify(displayed));
  state=await run('window.grokDesktop.getRemoteState()');
  if(state.pairing.code===originalCode||new URL(state.pairing.uri).searchParams.get('host')!==state.addresses[1])throw Error('Address switch did not regenerate pairing offer');
  if(await run("document.querySelector('.remote-addresses code').textContent")!==state.addresses[1])throw Error('Connection selection displays a stale address');
  await run("document.querySelector('.remote-addresses select').focus()");
  for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38});
  await wait("Boolean(document.querySelector('.remote-pairing img')) && document.querySelector('.remote-addresses code').textContent === "+JSON.stringify(displayed));
  state=await run('window.grokDesktop.getRemoteState()');
 }
 const root=settings.activeWorkspace.replace(/[\\/]Remote Demo$/,"");const stored=JSON.parse(await readFile(join(root,"remote","gateway.json"),"utf8"));
 const api=(path,body,token="",binary=false)=>new Promise((resolve,reject)=>{const req=request({hostname:"127.0.0.1",port:state.port,path,method:body===undefined?"GET":"POST",ca:stored.certificate,checkServerIdentity:(_,cert)=>new X509Certificate(cert.raw).fingerprint256.replaceAll(":","").toLowerCase()===state.fingerprint?undefined:Error("Pinned identity mismatch"),headers:token?{Authorization:`Bearer ${token}`} : {}},response=>{const chunks=[];response.on("data",d=>chunks.push(d));response.on("end",()=>{try{const raw=Buffer.concat(chunks);resolve({status:response.statusCode,body:binary?raw:JSON.parse(raw.toString("utf8")),mimeType:response.headers["content-type"]})}catch(error){reject(error)}})});req.on("error",reject);req.end(body===undefined?undefined:JSON.stringify(body))});
 const pendingPair=await api("/v1/pair",{code:state.pairing.code,name:"验收安卓手机"});if(pendingPair.status!==202)throw Error("Pair failed");await wait('document.body.innerText.includes("验收安卓手机")');await choose("允许配对");
 const approved=await api("/v1/pair/status",{code:state.pairing.code,requestId:pendingPair.body.requestId});if(!approved.body.deviceToken)throw Error("Consent was not applied");
 const sessions=await api("/v1/sessions",undefined,approved.body.deviceToken);if(!sessions.body.sessions.some(s=>s.id==="remote-smoke-session"))throw Error("Known Desktop session missing");
 const options=await api('/v1/options',undefined,approved.body.deviceToken);if(options.status!==200)throw Error('Options query failed: '+options.body.error);if(!options.body.capabilities.includes('session.create')||!options.body.workspaces.length)throw Error('Native Desktop project/capability mapping missing');
 if(options.body.workspaces.some(row=>row.name==='Removed Project')||!options.body.notices?.some(value=>value.includes('部分项目')))throw Error('Stale project was not isolated from creation options');
 const modelOptions=await api('/v1/options?models=refresh&scope=models',undefined,approved.body.deviceToken);if(modelOptions.status!==200||modelOptions.body.workspaces.length)throw Error('Independent model-only request failed');
 const outline=await api('/v1/workbench?kind=outline&sessionId=remote-smoke-session',undefined,approved.body.deviceToken);if(outline.status!==200||outline.body.entries[0]?.index!==0||outline.body.entries[0]?.preview!=='这是隔离数据的历史回答。')throw Error('Actual projection outline missing');
 const target=await api('/v1/sessions/remote-smoke-session?around=0',undefined,approved.body.deviceToken);if(target.status!==200||!target.body.events.some(event=>event.text==='这是隔离数据的历史回答。'))throw Error('Target-turn read did not return its answer');
 const images=await api('/v1/workbench?kind=image&sessionId=image-remote-smoke',undefined,approved.body.deviceToken);
 const originalSource=images.body.jobs[0].job.artifacts[0].source;
 if(new URL(originalSource).search)throw Error('Fixture must exercise the original unscoped media handle');
 for(const thumbnail of [false,true]){
  const source=thumbnail?originalSource+'?variant=thumbnail':originalSource;
  const ticket=await api('/v1/workbench?kind=media&source='+encodeURIComponent(source),undefined,approved.body.deviceToken);
  if(ticket.status!==200||ticket.body.sessionId!=='image-remote-smoke')throw Error('Stored image owner failed: '+ticket.body.error);
  const file=await api('/v1/preview/'+ticket.body.ticket+'/file',undefined,approved.body.deviceToken,true);
  if(file.status!==200||!file.body.length||!String(file.mimeType).startsWith(thumbnail?'image/jpeg':'image/png'))throw Error('Native thumbnail/original bytes unavailable');
 }
 const metadata=async(action,extra)=>{const operationId=`${Date.now()}_metadata-${action}`;await api('/v1/operations',{operationId,sessionId:'remote-smoke-session',action,...extra},approved.body.deviceToken);for(let i=0;i<60;i++){const response=await api(`/v1/operations/${operationId}`,undefined,approved.body.deviceToken);if(response.body.state==='failed')throw Error(response.body.message);if(response.body.state==='completed')return;await new Promise(r=>setTimeout(r,50))}throw Error('Metadata receipt did not complete')};
 await metadata('rename',{title:'手机管理验收'});await metadata('archive',{archived:true});const changed=await api('/v1/sessions',undefined,approved.body.deviceToken);if(!changed.body.sessions.some(s=>s.id==='remote-smoke-session'&&s.title==='手机管理验收'&&s.archived))throw Error('Metadata operation was not applied to its actual session');
 const history=await api("/v1/sessions/remote-smoke-session",undefined,approved.body.deviceToken);if(!history.body.events.some(e=>e.text==="这是隔离数据的历史回答。"))throw Error("Read-only history missing");
 const diagnostics=(await run('window.grokDesktop.getRemoteState()')).connectionDiagnostics;if(!diagnostics||diagnostics.tcp<1||diagnostics.tls<1||diagnostics.requests<1)throw Error('Connection evidence not recorded');
 if(await run('document.querySelector(".topbar")?.textContent.includes("远程连接验收")'))throw Error("Remote read changed Desktop focus");
 await choose("撤销访问");const denied=await api("/v1/sessions",undefined,approved.body.deviceToken);if(denied.status!==401)throw Error("Revocation was not immediate");
 await choose("关闭手机连接");await wait('!document.querySelector(".remote-status.online")');
 const png=await send("Page.captureScreenshot",{format:"png"});await writeFile(new URL("../out/remote-desktop-smoke.png",import.meta.url),Buffer.from(png.data,"base64"));
 console.log("REMOTE_DESKTOP_UI_PASSED real settings, TLS identity, explicit pairing consent, known session history without activation, device revocation and stop; no model requests");
}finally{try{await run("window.grokDesktop.setRemoteEnabled(false)")}catch{}socket.close()}
