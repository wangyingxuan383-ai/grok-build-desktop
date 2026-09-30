// Hidden Electron renderer: actual DOM, React hooks and CDP keyboard events.
// No production profile, Grok process, network request or model session.
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const output = resolve("out/ui-foundation");
await mkdir(output, { recursive: true });
await build({ configFile: false, define: { "process.env.NODE_ENV": JSON.stringify("production") }, plugins: [react()], build: { emptyOutDir: false, outDir: output, lib: { entry: resolve("scripts/fixtures/regression-dom.tsx"), name: "RegressionFixture", formats: ["iife"], fileName: () => "fixture.js" } } });
await writeFile(resolve(output, "index.html"), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="grok-build-desktop.css"><div id="root"></div><script src="fixture.js"></script>');
const source = String.raw`
const {app,BrowserWindow}=require('electron');
const path=require('node:path');
app.setPath('userData',path.join(__dirname,'profile'));
const wait=()=>new Promise(r=>setTimeout(r,80));
function assert(value,message){if(!value)throw Error(message)}
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  win.webContents.on('console-message',(event)=>console.log('Renderer:',event.message));
  const run=async(source)=>{try{return await win.webContents.executeJavaScript(source,true)}catch(error){throw Error(source+'\n'+error.message)}};
  try{
    await win.loadFile(path.join(__dirname,'index.html'));
    win.webContents.debugger.attach('1.3');
    const key=async(key,code)=>{await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key,code});await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key,code});await wait()};
    await run('fixture.uiMenus()'); await wait();
    await run('document.querySelector("#nested-trigger").focus()'); await key('ArrowDown','ArrowDown');
    assert(await run('document.querySelectorAll("[role=menu]").length===1'),'root menu did not open');
    await key('ArrowRight','ArrowRight'); await key('ArrowRight','ArrowRight');
    assert(await run('document.querySelectorAll("[role=menu]").length===3'),'three-level keyboard navigation');
    assert(await run('Array.from(document.querySelectorAll("[role=menu]")).every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})'),'nested menu escaped viewport');
    await key('Escape','Escape');
    assert(await run('document.querySelectorAll("[role=menu]").length===2'),'Escape did not close only deepest submenu');
    await key('ArrowRight','ArrowRight'); await key('Enter','Enter');
    assert(await run('fixture.chosen()==="editor" && !document.querySelector("[role=menu]")'),'nested action failed');
    assert(await run('document.activeElement.id==="nested-trigger"'),'menu focus not restored');
    await run('fixture.commands()'); await wait(); await run('window.dispatchEvent(new Event("grok:command-search"))'); await wait();
    assert(await run('document.activeElement.getAttribute("role")==="combobox"'),'command search autofocus');
    await key('Enter','Enter'); assert(await run('fixture.chosen()==="tasks"'),'command not executed');
    await run('fixture.pageTaskCenter()');await wait();
    assert(await run('Boolean(document.querySelector(".workbench-page-surface [role=region]"))&&!document.querySelector("[aria-modal=true]")'),'page retained blocking dialog semantics');
    console.log('UI_FOUNDATION_PASSED nested keyboard/viewport/Escape/action/focus, commands, page semantics');

    app.exit(0);
  }catch(error){console.error(error.stack);app.exit(1)}
});`;
await writeFile(resolve(output, "main.cjs"), source);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require("electron"), [resolve(output, "main.cjs")], { windowsHide: true, stdio: "inherit", env });
const timer = setTimeout(() => child.kill(), 60_000);
child.on("exit", (code) => { clearTimeout(timer); process.exitCode = code ?? 1; });
