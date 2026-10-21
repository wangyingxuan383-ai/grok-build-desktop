import { app, BrowserWindow, screen, systemPreferences, protocol } from "electron";
import { mkdir, writeFile, readFile,rm } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { DesktopPetController } from "../../src/main/services/desktop-pet-controller";
import { desktopPetSettings } from "../../src/shared/desktop-pet";
import type { AppSettings, NotificationInboxItem } from "../../src/shared/types";
import type { AppController } from "../../src/main/app-controller";
import { EMPTY_DESKTOP_ACTIVITY } from "../../src/main/services/desktop-shell-state";
import { zipSync,strToU8 } from "fflate";
const root=process.env.PET_PROBE_ROOT!,appRoot=process.env.PET_PROBE_APP_ROOT??root,resources=process.env.PET_PROBE_RESOURCES??join(root,"resources"),output=process.env.PET_PROBE_OUTPUT??join(root,"out/pet-native-probe");
const systemInput=process.env.PET_PROBE_SYSTEM_INPUT==="1";
app.setPath("userData",join(output,"profile"));
protocol.registerSchemesAsPrivileged([{scheme:"grok-pet",privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
app.commandLine.appendSwitch("disable-features","CalculateNativeWinOcclusion");
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const checks:string[]=[];
const assert=(value:unknown,name:string)=>{if(!value)throw Error(name);checks.push(name);};
const until=async(test:()=>unknown,name:string)=>{for(let i=0;i<100;i++){if(test())return;await sleep(100);}throw Error("Timed out: "+name);};
app.whenReady().then(async()=>{
 let pet:DesktopPetController|undefined,back:BrowserWindow|undefined;
 try{
  await mkdir(output,{recursive:true});
  await rm(join(output,"failure.txt"),{force:true});
  await rm(join(output,"profile/pets"),{recursive:true,force:true});
  let inbox:NotificationInboxItem[]=[],notify:(items:NotificationInboxItem[])=>void=()=>undefined;
  let settings={theme:{mode:"dark"},productivity:{},desktopPet:desktopPetSettings()} as AppSettings;
  const destinations:unknown[]=[];
  const controller={desktopContextHelperPath:join(resources,"native/win-x64/GrokComputerHost.exe"),observeDesktopInbox:(fn:typeof notify)=>{notify=fn;return()=>undefined;},listInbox:async()=>inbox,
   updateSettings:async(patch:Partial<AppSettings>)=>{settings={...settings,...patch};pet!.applySettings(settings);return settings;},updateDesktopPetSettings:async(patch:Partial<AppSettings["desktopPet"]>)=>{settings={...settings,desktopPet:{...desktopPetSettings(settings.desktopPet),...patch}};pet!.applySettings(settings);return settings;},isDesktopTargetVisible:()=>false,navigateDesktopPetTarget:async(t:unknown)=>{destinations.push(t);}};
  pet=new DesktopPetController(controller as unknown as AppController,{rendererEntry:join(appRoot,"out/renderer/pet/index.html"),preloadEntry:join(appRoot,"out/preload/pet.cjs"),builtins:join(resources,"pets"),userRoot:join(output,"profile/pets"),showMain:()=>destinations.push("main"),command:c=>destinations.push(c),quickEntry:i=>destinations.push(i),changed:()=>undefined});
  pet.applySettings(settings);pet.rendererReady();
  const p=pet as unknown as {window?:BrowserWindow;clip:string;visibility:string;transition:number;environment:{start():void;stop():void;snapshot?:unknown};snapshot():unknown;context(v:unknown):void};
  await until(()=>p.environment.snapshot,"initial native context");
  const nativeInitial=p.environment.snapshot;
  if(!systemInput){
   p.environment.stop();
   const baseline={locked:false,presentation:false,fullScreen:false,foregroundRect:null,doubleClickTime:500,leftButtonDown:false};
   p.environment.start=()=>queueMicrotask(()=>p.context(baseline));
   p.environment.start();
  }
  await until(()=>p.window?.isVisible(),"default visible");await sleep(1600);
  let window=p.window!;
  console.log("WINDOW_FLAGS",JSON.stringify({focusable:window.isFocusable(),focused:window.isFocused(),alwaysOnTop:window.isAlwaysOnTop(),bounds:window.getBounds()}));
  const hostBlocked=(nativeInitial as {locked:boolean;presentation:boolean;fullScreen:boolean}).locked||(nativeInitial as {presentation:boolean}).presentation||(nativeInitial as {fullScreen:boolean}).fullScreen;
  const nativeTopmost=hostBlocked?"deferred: host is locked/presenting/fullscreen":window.isAlwaysOnTop();
  assert(!window.isFocusable()&&!window.isFocused(),"sandbox companion is non-focusable and reports no focus");
  if(!hostBlocked)assert(window.isAlwaysOnTop(),"native window reports always-on-top on an unblocked desktop");
  assert(p.visibility==="visible"&&p.clip==="idle","entry settles into idle");
  assert(await window.webContents.executeJavaScript("document.querySelector('#pet').getContext('2d').getImageData(0,0,innerWidth,innerHeight).data.some((v,i)=>i%4===3&&v>0)"),"real alpha image decoded and drawn");
  await writeFile(join(output,"b-idle.png"),(await window.webContents.capturePage()).toPNG());
  const owned=window.getBounds();
  back=new BrowserWindow({x:owned.x,y:owned.y,width:owned.width,height:owned.height,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await back.loadURL('data:text/html,<body style="margin:0;background:%23dfe5ec"><button style="width:100vw;height:100vh;border:0;background:transparent" onclick="document.body.dataset.clicks=String(Number(document.body.dataset.clicks||0)+1)">Native pet verification surface</button>');
  await back.webContents.executeJavaScript("window.probeEvents=[];for(const type of ['mousemove','mousedown','mouseup','click'])document.addEventListener(type,e=>probeEvents.push([e.type,e.clientX,e.clientY]));document.querySelector('button').click();document.body.dataset.clicks='0'");
  back.setAlwaysOnTop(true,"floating");back.showInactive();if(systemInput)back.focus();window.moveTop();await sleep(350);assert(!window.isFocused(),"companion stays unfocused beside another sandbox window");
  window.setIgnoreMouseEvents(true,{forward:true});
  if(process.env.PET_PROBE_SYSTEM_INPUT==="1"){
  const click=(x:number,y:number)=>new Promise<void>((resolve,reject)=>{const pt=screen.dipToScreenPoint({x,y});execFile(join(process.env.SystemRoot!,"System32/WindowsPowerShell/v1.0/powershell.exe"),["-NoProfile","-ExecutionPolicy","Bypass","-File",join(root,"scripts/probe-pet-pointer.ps1"),"-X",String(pt.x),"-Y",String(pt.y),"-VerifyWindow",back!.getNativeWindowHandle().readBigUInt64LE().toString()],{windowsHide:true,timeout:10000},(error,stdout)=>{console.log("POINTER_ROOT",stdout.trim(),"BACK",back!.getNativeWindowHandle().readBigUInt64LE().toString(),"PET",window.getNativeWindowHandle().readBigUInt64LE().toString());error?reject(error):resolve();});});
  await click(owned.x+24,owned.y+70);await sleep(200);
  const clicks=await back.webContents.executeJavaScript("Number(document.body.dataset.clicks||0)");console.log("NATIVE_POINTER",JSON.stringify({clicks,events:await back.webContents.executeJavaScript("probeEvents"),backFocused:back.isFocused(),petFocused:window.isFocused(),bounds:owned,backBounds:back.getBounds(),displays:screen.getAllDisplays().map(d=>({bounds:d.bounds,scale:d.scaleFactor}))}));assert(clicks===1,"real OS click passes through transparent pixels");
  await click(owned.x+180,owned.y+owned.height-130);await sleep(650);
  assert(await back.webContents.executeJavaScript("Number(document.body.dataset.clicks||0)")===clicks,"real OS click on opaque character is intercepted");
  assert(!window.isFocused()&&back.isFocused(),"real OS pet click does not steal input focus");
  }
  // Electron input exercises the actual sandbox preload and renderer gesture path.
  window.webContents.sendInputEvent({type:"mouseMove",x:180,y:owned.height-100});await sleep(450);
  assert(await window.webContents.executeJavaScript("!document.querySelector('#toolbar').hidden"),"hover reveals toolbar");
  if(process.env.PET_PROBE_SYSTEM_INPUT==="1"){back.setFullScreen(true);await until(()=>!p.window,"real native fullscreen suppression");assert(!p.window,"foreground fullscreen actually hides pet");back.setFullScreen(false);await until(()=>p.window?.isVisible(),"fullscreen restoration");window=p.window!;}
  pet.applyActivity({...EMPTY_DESKTOP_ACTIVITY,sessions:[{sessionId:"session-one",title:"会话一",projectName:"",status:"awaiting"},{sessionId:"session-two",title:"会话二",projectName:"",status:"running"}],runningCount:1,awaitingCount:1});await sleep(100);
  assert(p.clip==="waiting","awaiting preempts running");
  await writeFile(join(output,"b-awaiting.png"),(await window.webContents.capturePage()).toPNG());
  pet.applyActivity(EMPTY_DESKTOP_ACTIVITY);await sleep(100);
  const before=p.transition;pet.applyActivity({...EMPTY_DESKTOP_ACTIVITY,livePhoneCount:1});await sleep(100);assert(p.transition===before,"unchanged task state does not restart animation");
  inbox=[{id:"real-result",kind:"completion",title:"真实结果",sessionId:"session-one",read:false,createdAt:new Date().toISOString()}];notify(inbox);await sleep(100);
  assert(p.clip==="success","live result triggers celebration");const once=p.transition;notify(inbox);await sleep(50);assert(p.transition===once,"duplicate receipt stays silent");
  await pet.command("hide");assert(!p.window&&pet.hidden,"temporary hide releases window");
  notify([{...inbox[0]!,id:"hidden-result"}]);await sleep(100);assert(!p.window,"hidden completion does not resurrect pet");
  await pet.command("show");await until(()=>p.window?.isVisible(),"show after hide");
  pet.setSuppressed("computer",true);assert(!p.window,"computer use immediately hides");await pet.command("hide");pet.setSuppressed("computer",false);await sleep(300);assert(!p.window,"ending computer use cannot override manual hide");
  settings={...settings,desktopPet:desktopPetSettings({enabled:false})};pet.applySettings(settings);await sleep(100);assert(!p.window&&!pet.enabled,"saved disable remains disabled");
  await pet.command("show");await until(()=>p.window?.isVisible(),"explicit enable");
  assert(p.visibility==="entering"&&p.clip==="enter","explicit re-enable plays entrance after environment confirmation");
  const hiding=pet.command("hide");await sleep(80);await pet.command("show");await hiding;await until(()=>p.window?.isVisible(),"last intent wins");assert(p.window?.isVisible(),"late exit cannot destroy reopened window");
  // Simulate power/visibility causes through the same controller reducer; this is not a real lock.
  pet.setSuppressed("lock-test",true);pet.setSuppressed("screen-test",true);pet.setSuppressed("lock-test",false);assert(!p.window,"independent hide reasons compose");pet.setSuppressed("screen-test",false);await until(()=>p.window?.isVisible(),"auto restore");
  settings={...settings,desktopPet:{...desktopPetSettings(settings.desktopPet),skinId:"a"}};pet.applySettings(settings);await until(()=>p.window?.isVisible(),"A skin");await sleep(1300);await writeFile(join(output,"a-idle.png"),(await p.window!.webContents.capturePage()).toPNG());
  assert((await pet.assets.list()).length===2,"two packaged skins selectable");
  const raster=join(output,"import-test.png");await writeFile(raster,(await p.window!.webContents.capturePage()).toPNG());
  const windowCount=BrowserWindow.getAllWindows().length,imported=await pet.assets.import(raster);
  assert(imported.id.startsWith("custom-")&&imported.clips.idle!.frames[0]!.height<imported.clips.idle!.height,"single image normalized by sandbox alpha bounds");
  assert(BrowserWindow.getAllWindows().length===windowCount,"import decoder window is released");
  assert((await pet.assets.list()).length===3,"imported image joins local library without activation");
  const pack=join(output,"pack.zip"),manifest=JSON.parse(await readFile(join(resources,"pets/b/skin.json"),"utf8"));manifest.clips={idle:manifest.clips.idle};
  await writeFile(pack,zipSync({"skin.json":strToU8(JSON.stringify(manifest)),"idle.webp":await readFile(join(resources,"pets/b/idle.webp"))}));
  assert((await pet.assets.import(pack)).clips.idle!.frames.length===4,"data-only animation ZIP imported in worker");
  const unsafe=join(output,"unsafe.zip");await writeFile(unsafe,zipSync({"../escape.png":new Uint8Array([1])}));
  let refused=false;try{await pet.assets.import(unsafe);}catch{refused=true;}assert(refused,"ZIP traversal rejected without installing a skin");
  const rendererPid=p.window!.webContents.getOSProcessId();await sleep(4000);const metric=app.getAppMetrics().find(row=>row.pid===rendererPid);
  const rejected=await p.window!.webContents.executeJavaScript("window.grokPet.action({type:'execute',command:'test'}).then(()=>false,()=>true)");assert(rejected,"pet transport rejects execution capability");
  await pet.prepareQuit();assert(!p.window,"normal quit releases companion window");pet.dispose();
  assert(!p.window,"disposed window remains absent");
  await writeFile(join(output,"verification.json"),JSON.stringify({passed:true,entry:process.env.PET_PROBE_APP_ROOT?"packaged ASAR":"development output",checks,nativeInitial,nativeTopmost,environmentMode:systemInput?"native":"synthetic unblocked baseline for window/IPC; no OS input",idleRenderer:metric?{cpu:metric.cpu,memory:metric.memory}:undefined,systemAnimations:systemPreferences.getAnimationSettings(),systemInput:systemInput?"passed":"not verified: system input did not reach the isolated fixture window (Progman was the native foreground)", note:"Electron sandbox/native window integration; simulated lock reasons are not physical lock/DPI/monitor acceptance."},null,2));
  console.log("DESKTOP_PET_WINDOW_PASSED "+checks.length);app.exit(0);
 }catch(error){console.error(error);await writeFile(join(output,"failure.txt"),String(error));pet?.dispose();back?.destroy();app.exit(1);}
});
