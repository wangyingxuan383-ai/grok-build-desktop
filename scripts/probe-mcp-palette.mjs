// Isolated Electron renderer fixture: no production data, CLI or provider calls.
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require=createRequire(import.meta.url), output=resolve("out/mcp-palette");
await mkdir(output,{recursive:true});
await build({configFile:false,define:{"process.env.NODE_ENV":JSON.stringify("production")},plugins:[react()],build:{emptyOutDir:false,outDir:output,lib:{entry:resolve("scripts/fixtures/mcp-palette.tsx"),name:"McpFixture",formats:["es"],fileName:()=>"fixture.js"}}});
await writeFile(resolve(output,"index.html"),'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="grok-build-desktop.css"><div id="root"></div><script type="module" src="fixture.js"></script>');
await writeFile(resolve(output,"main.cjs"),String.raw`
const {app,BrowserWindow}=require("electron"),path=require("node:path");
app.setPath("userData",path.join(__dirname,"profile"));
const wait=()=>new Promise(r=>setTimeout(r,120));const assert=(v,m)=>{if(!v)throw Error(m)};
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1366,height:768,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 const run=s=>win.webContents.executeJavaScript(s,true);
 try{
  await win.loadFile(path.join(__dirname,"index.html"));win.webContents.debugger.attach("1.3");await wait();
  const key=async(key,code)=>{for(const type of ["keyDown","keyUp"])await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent",{type,key,code});await wait()};
  const click=async(selector)=>{const pos=await run('(()=>{const el=document.querySelector('+JSON.stringify(selector)+');el.scrollIntoView({block:"center"});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');for(const type of ["mousePressed","mouseReleased"])await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent",{type,...pos,button:"left",clickCount:1});await wait()};
  await win.webContents.debugger.sendCommand("Input.insertText",{text:"lookup"});await wait();
  assert(await run('document.querySelectorAll("button[data-palette-item]").length===1'),"search did not isolate live MCP identity");
  await key("ArrowDown","ArrowDown");await key("Enter","Enter");
  assert(await run('fixture.state()?.sessionId==="parent" && fixture.state()?.toolName==="lookup"'),"keyboard selection lost identity");
  await run('fixture.hold()');await click('[aria-label="刷新 MCP 工具"]');
  await run('fixture.show("child")');await wait();
  assert(await run('!document.body.textContent.includes("文档服务 / lookup")'),"old-session tools remained selectable");
  await run('fixture.release()');await wait();
  await click('button[data-palette-item]');
  assert(await run('fixture.state()?.sessionId==="child"'),"late response rebound selection to old session");
  await run('fixture.disconnect()');await click('[aria-label="刷新 MCP 工具"]');
  assert(await run('!document.querySelector("button[data-palette-item]")'),"disconnected tools remained selectable");
  await run('fixture.wrongOwner()');await click('[aria-label="刷新 MCP 工具"]');
  assert(await run('document.body.textContent.includes("会话身份不匹配")'),"mismatched owner was silently accepted");
  console.log("MCP_PALETTE_PASSED search/keyboard/mouse, exact identity, stale response, disconnect, owner mismatch");app.exit(0);
 }catch(error){console.error(error.stack);app.exit(1)}
});
`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require("electron"),[resolve(output,"main.cjs")],{windowsHide:true,stdio:"inherit",env});
const timer=setTimeout(()=>child.kill(),60000);child.on("exit",code=>{clearTimeout(timer);process.exitCode=code??1});
