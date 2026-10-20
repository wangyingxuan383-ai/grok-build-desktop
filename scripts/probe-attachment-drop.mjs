// Actual image composer and drop observer, isolated synthetic data; no CLI or model.
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), output = resolve("out/attachment-drop-probe");
await mkdir(output, { recursive: true });
await build({ configFile: false, define: { "process.env.NODE_ENV": JSON.stringify("production") }, plugins: [react()], build: { emptyOutDir: false, outDir: output, lib: { entry: resolve("scripts/fixtures/attachment-drop.tsx"), name: "AttachmentDropFixture", formats: ["iife"], fileName: () => "fixture.js" } } });
await writeFile(resolve(output, "index.html"), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="grok-build-desktop.css"><div id="root"></div><script src="fixture.js"></script>');
await writeFile(resolve(output, "main.cjs"), String.raw`
const {app,BrowserWindow}=require('electron'),path=require('node:path');
app.setPath('userData',path.join(__dirname,'profile-'+Date.now()));
const assert=(value,message)=>{if(!value)throw Error(message)},pause=()=>new Promise(r=>setTimeout(r,50));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
 const run=source=>win.webContents.executeJavaScript(source,true);
 const until=async source=>{for(let i=0;i<100;i++){if(await run(source))return;await pause()}throw Error('Timeout: '+source)};
 try{
  await win.loadFile(path.join(__dirname,'index.html'));await until('typeof dropFixture!=="undefined" && document.body.textContent.includes("图像 a")');
  await run('dropFixture.open("a")');await until('document.querySelector(".tb-title-text")?.textContent==="图像 a"');
  await run('dropFixture.start("first");dropFixture.start("second");dropFixture.finish("second");dropFixture.finish("first")');
  await until('document.querySelectorAll(".im-refs .im-chip").length===2');
  await run('dropFixture.start("stale");dropFixture.open("b")');
  await until('document.querySelector(".tb-title-text")?.textContent==="图像 b" && !document.querySelector(".im-refs")');
  await run('dropFixture.finish("stale")');
  assert(await run('dropFixture.errors().length===1 && !document.querySelector(".im-refs")'),'late image attachment crossed conversations');
  await run('dropFixture.start("unmounted");Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="编程").click()');await until('document.body.textContent.includes("返回图像")');
  await run('document.querySelector("button").click()');await until('document.body.textContent.includes("图像 b")');
  await run('dropFixture.finish("unmounted")');
  assert(await run('dropFixture.errors().length===2 && !document.querySelector(".im-refs")'),'old image instance accepted a late drop');
  console.log('ATTACHMENT_DROP_DOM_PASSED consecutive drops merge; changed image conversation and unmounted composer reject late results');app.exit(0);
 }catch(error){console.error(error.stack);app.exit(1)}
});`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require("electron"), [resolve(output, "main.cjs")], { windowsHide: true, stdio: "inherit", env });
const timer = setTimeout(() => child.kill(), 30000);
child.on("exit", code => { clearTimeout(timer); process.exitCode = code ?? 1; });
