// Isolated DOM fixture: never opens Grok, a model, or a user's session profile.
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const output = resolve("out/subagent-view");
await mkdir(output, {recursive:true});
await build({configFile:false,define:{"process.env.NODE_ENV":JSON.stringify("production")},plugins:[react()],build:{emptyOutDir:false,outDir:output,lib:{entry:resolve("scripts/fixtures/subagent-view.tsx"),name:"ChildFixture",formats:["es"],fileName:()=>"fixture.js"}}});
await writeFile(resolve(output,"index.html"),'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="grok-build-desktop.css"><div id="root"></div><script type="module" src="fixture.js"></script>');
await writeFile(resolve(output,"main.cjs"),String.raw`
const {app,BrowserWindow}=require("electron");
const path=require("node:path");
app.setPath("userData",path.join(__dirname,"profile"));
const wait=()=>new Promise(resolve=>setTimeout(resolve,150));
const assert=(value,message)=>{if(!value)throw Error(message)};
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1366,height:768,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 const run=source=>win.webContents.executeJavaScript(source,true);
 try {
  await win.loadFile(path.join(__dirname,"index.html"));await wait();
  win.webContents.debugger.attach("1.3");
  const click=async selector=>{
   const point=await run('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
   for(const type of ["mousePressed","mouseReleased"])await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent",{type,...point,button:"left",clickCount:1});
   await wait();
  };
  await click("#child-two");
  await run('fixture.deliver("two","CHILD_TWO_RESULT")');await wait();
  await run('fixture.deliver("one","STALE_CHILD_ONE")');await wait();
  assert(await run('document.body.textContent.includes("CHILD_TWO_RESULT") && !document.body.textContent.includes("STALE_CHILD_ONE")'),"late child response replaced active child");
  assert(await run('fixture.shared().sessionId==="parent" && fixture.shared().views.length===0'),"child viewing mutated parent runtime");
  assert(await run('!document.querySelector("textarea") && document.body.textContent.includes("read_file") && document.body.textContent.includes("READ_ONLY_PLAN") && !document.body.textContent.includes("批准计划")'),"read-only transcript or tool record missing");
  await click(".tool-card summary");
  assert(await run('document.querySelector(".tool-locations button").disabled'),"unverified child path could use parent workspace");
  await run('Array.from(document.querySelectorAll(".subagent-conversation button")).find(x=>x.textContent==="返回父会话").click()');await wait();
  assert(await run('document.querySelector("#parent").textContent==="parent"'),"wrong parent target");
  await click('[aria-label="关闭标签 two"]');
  await click("#child-two");
  assert(await run('Array.from(document.querySelectorAll("[role=tab]")).some(x=>x.textContent==="two" && x.getAttribute("aria-selected")==="true")'),"closed child could not be reopened");
  console.log("SUBAGENT_VIEW_PASSED identity, stale response, read-only tools, parent return, reopen");
  app.exit(0);
 } catch(error){console.error(error.stack);app.exit(1)}
});
`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require("electron"),[resolve(output,"main.cjs")],{windowsHide:true,stdio:"inherit",env});
const timeout=setTimeout(()=>child.kill(),60000);
child.on("exit",code=>{clearTimeout(timeout);process.exitCode=code??1});
