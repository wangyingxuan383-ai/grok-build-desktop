// Native Windows popup and keyboard acceptance, isolated profile; no model/account calls.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
const endpoint=process.argv[2];
const target=(await fetch(endpoint+"/json/list").then(response=>response.json())).find(row=>row.type==="page");
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
let sequence=0;const pending=new Map();
socket.onmessage=({data})=>{const row=JSON.parse(data),item=pending.get(row.id);if(!item)return;pending.delete(row.id);clearTimeout(item.timer);row.error?item.reject(Error(JSON.stringify(row.error))):item.resolve(row.result)};
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+" timeout"))},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))});
const run=async expression=>{const row=await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});if(row.exceptionDetails)throw Error(JSON.stringify(row.exceptionDetails));return row.result?.value};
const wait=async expression=>{for(let count=0;count<100;count++){if(await run(expression))return;await new Promise(resolve=>setTimeout(resolve,100))}throw Error("Wait failed: "+expression)};
const key=async(name,value)=>{for(const type of ["keyDown","keyUp"])await send("Input.dispatchKeyEvent",{type,key:name,code:name,windowsVirtualKeyCode:value,nativeVirtualKeyCode:value})};
const luminance=value=>{const rgb=value.match(/[\d.]+/g).slice(0,3).map(Number).map(channel=>{const c=channel/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722};
const captures=[];
try{
 await wait('Boolean(document.querySelector(".app-shell"))');
 const settings=await run("window.grokDesktop.getSettings()");
 if(!settings.activeWorkspace.includes("Grok-Build-Desktop-smoke-"))throw Error("Not isolated");
 const build=await run("window.grokDesktop.bootstrap()");
 if(build.buildInfo?.version!==process.env.GROK_EXPECTED_APP_VERSION)throw Error("Build/version mismatch");
 await run('localStorage.setItem("grok.app-mode.v1","image")');
 for(const mode of ["dark","light"]){
  await run(`window.grokDesktop.updateSettings({theme:{...${JSON.stringify(settings.theme)},mode:${JSON.stringify(mode)}}})`);
  await send("Page.reload");
  await wait(`document.documentElement?.dataset.themeResolved===${JSON.stringify(mode)}&&Boolean(document.querySelector('select[aria-label="图片比例"]'))`);
  const geometry=await run(`(()=>{const e=document.querySelector('select[aria-label="图片比例"]'),r=e.getBoundingClientRect(),s=getComputedStyle(e.options[0]),top=Math.max(0,Math.round((screenY+(outerHeight-innerHeight)+r.y-240)*devicePixelRatio));return {x:r.x+r.width/2,y:r.y+r.height/2,left:Math.max(0,Math.round((screenX+r.x-30)*devicePixelRatio)),top,width:Math.round(420*devicePixelRatio),height:Math.min(Math.round(520*devicePixelRatio),Math.round(screen.height*devicePixelRatio)-top),foreground:s.color,background:s.backgroundColor,next:e.options[Math.min(e.options.length-1,e.selectedIndex+1)].value}})()`);
  const fg=luminance(geometry.foreground),bg=luminance(geometry.background),contrast=(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);
  if(contrast<4.5)throw Error(`${mode} option contrast too low: ${contrast}`);
  await send("Input.dispatchMouseEvent",{type:"mouseMoved",x:geometry.x,y:geometry.y});
  for(const type of ["mousePressed","mouseReleased"])await send("Input.dispatchMouseEvent",{type,button:"left",clickCount:1,x:geometry.x,y:geometry.y});
  await new Promise(resolve=>setTimeout(resolve,300));
  const path=join(tmpdir(),`grok-image-options-${mode}-${Date.now()}.png`);
  execFileSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",join(homedir(),".codex","skills","screenshot","scripts","take_screenshot.ps1"),"-Path",path,"-Region",`${geometry.left},${geometry.top},${geometry.width},${geometry.height}`],{windowsHide:true});
  await key("ArrowDown",40);await key("Enter",13);
  await wait(`document.querySelector('select[aria-label="图片比例"]').value===${JSON.stringify(geometry.next)}`);
  captures.push({mode,path,contrast:Number(contrast.toFixed(2)),foreground:geometry.foreground,background:geometry.background});
 }
 console.log(JSON.stringify({status:"IMAGE_OPTIONS_PASSED",version:build.buildInfo.version,captures}));
}finally{socket.close()}
