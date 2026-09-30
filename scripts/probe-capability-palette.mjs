// Isolated UI regression: no live CLI/model, provider credentials or application data.
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require=createRequire(import.meta.url), output=resolve("out/capability-palette");
await mkdir(output,{recursive:true});
await build({configFile:false,define:{"process.env.NODE_ENV":JSON.stringify("production")},plugins:[react()],build:{emptyOutDir:false,outDir:output,lib:{entry:resolve("scripts/fixtures/capability-palette.tsx"),name:"PaletteFixture",formats:["es"],fileName:()=>"fixture.js"}}});
await writeFile(resolve(output,"index.html"),'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="grok-build-desktop.css"><div id="root"></div><script type="module" src="fixture.js"></script>');
await writeFile(resolve(output,"main.cjs"),String.raw`
const {app,BrowserWindow}=require("electron");const path=require("node:path");
app.setPath("userData",path.join(__dirname,"profile"));
const wait=()=>new Promise(r=>setTimeout(r,120));const assert=(value,message)=>{if(!value)throw Error(message)};
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1366,height:768,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 const run=source=>win.webContents.executeJavaScript(source,true);
 try{
  await win.loadFile(path.join(__dirname,"index.html"));win.webContents.debugger.attach("1.3");
  const key=async(key,code)=>{for(const type of ["keyDown","keyUp"])await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent",{type,key,code,windowsVirtualKeyCode:({Backspace:8,Enter:13,Escape:27,ArrowDown:40,ArrowUp:38})[key]});await wait()};
  if(process.argv.includes("--project-output")) {
   const click=async(selector)=>{const position=await run('(()=>{const el=document.querySelector('+JSON.stringify(selector)+');el.scrollIntoView({block:"center"});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');for(const type of ["mousePressed","mouseReleased"])await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent",{type,...position,button:"left",clickCount:1});await wait()};
   await run("fixture.media()");await wait();
   assert(await run('document.querySelector("[aria-label=项目内输出目录]").value==="generated/images"'),"missing image output default");
   await click('[aria-label="项目内输出目录"]');
   await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent",{type:"keyDown",key:"a",code:"KeyA",modifiers:2,windowsVirtualKeyCode:65});
   await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent",{type:"keyUp",key:"a",code:"KeyA",modifiers:2,windowsVirtualKeyCode:65});
   await key("Backspace","Backspace");
   assert(await run('document.querySelector(".media-actions .primary").disabled'),"empty directory allowed submission: "+await run('JSON.stringify({value:document.querySelector("[aria-label=项目内输出目录]").value,active:document.activeElement.outerHTML})'));
   await win.webContents.debugger.sendCommand("Input.insertText",{text:"assets/插画"});await wait();
   await click(".media-actions .primary");
   assert(await run('fixture.state().submissions[0].projectOutputDirectory==="assets/插画" && document.querySelector("[aria-label=项目内输出目录]").disabled'),"directory omitted or remained editable after submit");
   await run('fixture.finish({outputWarning:"项目副本保存失败，请另存，无需重新生成",savedProjectFiles:["C:/project/assets/插画/saved.png"]})');await wait();
   assert(await run('document.body.textContent.includes("无需重新生成") && document.body.textContent.includes("saved.png") && document.querySelector(".media-actions .primary").textContent.includes("新请求")'),"partial save/re-generation feedback missing");
   await click('input[type="checkbox"]');await click(".media-actions .primary");
   assert(await run('fixture.state().submissions[1].projectOutputDirectory===undefined'),"unchecked project copy still sent a directory");
   console.log("PROJECT_MEDIA_UI_PASSED default/custom directory, empty guard, in-flight lock, partial-save warning, new-request label, cache-only option");app.exit(0);return;
  }
  await run("fixture.palette()");await wait();
  assert(await run('document.activeElement.matches(".capability-search")'),"search not initially focused");
  assert(await run('document.body.textContent.includes("参数：scope")'),"CLI input hint missing");
  await win.webContents.debugger.sendCommand("Input.insertText",{text:"review"});await wait();
  await key("ArrowDown","ArrowDown");await key("Enter","Enter");
  assert(await run('fixture.state().selected==="review"'),"search keyboard selection failed");
  await run("fixture.media()");await wait();
  assert(await run('document.querySelector(".media-studio textarea").value==="为当前项目设计图标" && document.querySelector(".media-studio select").value==="cli"'),"prompt/default CLI route incorrect");
  await run('document.querySelector(".media-actions .primary").click();document.querySelector(".media-actions .primary")?.click()');await wait();
  assert(await run('fixture.state().submissions.length===1 && fixture.state().submissions[0].route==="cli"'),"duplicate submit or silent route change");
  await key("Escape","Escape");
  assert(await run('fixture.state().closed===0 && document.querySelector(".media-studio [role=status]")'),"pending receipt allowed close");
  await run("fixture.finish()");await wait();
  assert(await run('document.querySelector(".media-job-state.completed")!==null'),"early terminal progress was lost");
  await run("fixture.switchSession()");await wait();
  assert(await run('document.querySelector(".media-actions .primary").disabled && document.body.textContent.includes("当前会话已切换")'),"form silently rebound to another session");
  await run("fixture.media(true)");await wait();
  await run('document.querySelector(".media-actions .primary").click()');await wait();
  await run("fixture.finish()");await wait();
  assert(await run('!document.querySelector(".media-actions .primary").disabled'),"own session creation was mistaken for target switch");
  await run("fixture.switchSession()");await wait();
  assert(await run('document.querySelector(".media-actions .primary").disabled'),"newly created target was not retained");
  console.log("CAPABILITY_PALETTE_PASSED command search/keyboard/hints, media draft/CLI, duplicate guard, pending close, early progress, target change");
  app.exit(0);
 }catch(error){console.error(error.stack);app.exit(1)}
});
`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require("electron"),[resolve(output,"main.cjs"),...process.argv.slice(2)],{windowsHide:true,stdio:"inherit",env});
const timer=setTimeout(()=>child.kill(),60000);child.on("exit",code=>{clearTimeout(timer);process.exitCode=code??1});
