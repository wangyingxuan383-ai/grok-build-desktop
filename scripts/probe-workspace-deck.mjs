// Hidden Electron renderer: actual DOM, React hooks and CDP keyboard events.
// No production profile, Grok process, network request or model session.
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const output = resolve("out/workspace-deck");
await mkdir(output, { recursive: true });
await build({ configFile: false, define: { "process.env.NODE_ENV": JSON.stringify("production") }, plugins: [react()], build: { emptyOutDir: false, outDir: output, lib: { entry: resolve("scripts/fixtures/regression-dom.tsx"), name: "RegressionFixture", formats: ["es"], fileName: () => "fixture.js" } } });
await writeFile(resolve(output, "index.html"), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="grok-build-desktop.css"><div id="root"></div><script type="module" src="fixture.js"></script>');
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
    await run('fixture.deck()');await wait();
    for(let i=1;i<4;i++){
      await run('Array.from(document.querySelectorAll(".workbench-pane.focused [aria-label=窗格操作]"))[0].focus()');await key('ArrowDown','ArrowDown');
      await run('Array.from(document.querySelectorAll("[role=menuitem]")).find(e=>e.textContent==="向右分屏").click()');await wait();
    }
    assert(await run('document.querySelectorAll(".workbench-pane").length===4'),'four pane layout missing');
    assert(await run('document.querySelectorAll("#deck-draft").length===1 && document.querySelector("#deck-draft").value==="保留草稿"'),'composer duplicated or draft lost');
    await run('document.querySelector(".workbench-pane.focused [aria-label=窗格操作]").focus()');await key('ArrowDown','ArrowDown');
    assert(await run('Array.from(document.querySelectorAll("[role=menuitem]")).find(e=>e.textContent==="向右分屏").hasAttribute("data-disabled")'),'fifth pane not disabled');
    await run('Array.from(document.querySelectorAll("[role=menuitem]")).find(e=>e.textContent==="关闭窗格").click()');await wait();
    assert(await run('document.querySelectorAll(".workbench-pane").length===3 && document.querySelector("#deck-draft").value==="保留草稿"'),'close pane lost shared content');
    await run('document.querySelector(".pane-activate").click()');await wait();
    assert(await run('document.querySelectorAll("#deck-draft").length===1'),'activation duplicated composer');
    const click = async (selector, button='left') => {
      const point=await run('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',...point,button,clickCount:1});
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button,clickCount:1});await wait();
    };
    await click('#deck-second');
    assert(await run('document.querySelector("#deck-session").textContent==="two"'),'second session not active');
    await click('.workbench-pane.focused [role=tab]', 'right');
    assert(await run('document.querySelector("#deck-session").textContent==="two"'),'right click activated the wrong session');
    await run('Array.from(document.querySelectorAll("[role=menuitem]")).find(e=>e.textContent==="关闭标签").click()');await wait();
    assert(await run('document.querySelector("#deck-session").textContent==="two"'),'closing background tab changed active session');
    await click('.workbench-pane.focused [aria-label="窗格操作"]');
    await run('Array.from(document.querySelectorAll("[role=menuitem]")).find(e=>e.textContent==="关闭所有窗格的全部标签").click()');await wait();
    assert(await run('document.querySelectorAll("[role=tab]").length===0'),'close all left tabs or reopened the last tab');
    await click('.workbench-pane.focused [aria-label="窗格操作"]');
    await run('Array.from(document.querySelectorAll("[role=menuitem]")).find(e=>e.textContent==="重新打开最近关闭的标签").click()');await wait();
    assert(await run('document.querySelectorAll("[role=tab]").length===1'),'recent tab did not reopen');
    await run('fixture.menus()');await wait();
    await click('.session-open');await click('.session-actions');
    const before=await run('(()=>{const r=document.querySelector("[role=menu]").getBoundingClientRect();return {x:r.x,y:r.y}})()');
    const inside=await run('(()=>{const r=document.querySelector("[role=menuitem]").getBoundingClientRect();return {x:r.x+10,y:r.y+10}})()');
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...inside});await wait();
    const after=await run('(()=>{const r=document.querySelector("[role=menu]").getBoundingClientRect();return {x:r.x,y:r.y}})()');
    assert(Math.abs(before.x-after.x)<1&&Math.abs(before.y-after.y)<1,'session menu moved after pointer entered portal');
    await run('fixture.dirtyDeck()');await wait();await click('#dirty-second');
    await click('.workbench-pane.focused [aria-label="窗格操作"]');
    await run('Array.from(document.querySelectorAll("[role=menuitem]")).find(e=>e.textContent==="关闭此窗格全部标签").click()');await wait();
    assert(await run('document.querySelectorAll(".close-file-choice").length===2'),'batch close did not collect both dirty files');
    await key('Escape','Escape');
    assert(await run('document.querySelectorAll("[role=tab]").length===2 && fixture.fileState().saved.length===0 && fixture.fileState().tabs.every(t=>t.dirty)'),'cancel partially closed or saved files');
    await click('.workbench-pane.focused [aria-label="窗格操作"]');
    await run('Array.from(document.querySelectorAll("[role=menuitem]")).find(e=>e.textContent==="关闭此窗格全部标签").click()');await wait();
    await run('(()=>{const select=document.querySelectorAll(".close-file-choice select")[1];select.value="discard";select.dispatchEvent(new Event("change",{bubbles:true}))})()');await wait();
    await run('Array.from(document.querySelectorAll(".ui-dialog button")).find(e=>e.textContent==="确认并关闭").click()');await wait();
    assert(await run('document.querySelectorAll("[role=tab]").length===0 && fixture.fileState().tabs.length===0 && fixture.fileState().saved.length===1'),'save/discard batch close did not finish atomically');
    await run('window.dispatchEvent(new Event("grok:reset-layout"))');await wait();
    assert(await run('document.querySelectorAll(".workbench-pane").length===1 && document.querySelectorAll("[role=tab]").length===0'),'empty layout reset failed');
    await run('fixture.archives()');await wait();
    assert(await run('document.querySelectorAll(".session-row:not(.external)").length===1 && document.querySelector(".archived-sessions button").getAttribute("aria-expanded")==="false"'),'archive is not separate/collapsed by default');
    await click('.archived-sessions .session-group-heading');
    assert(await run('document.querySelectorAll(".session-row:not(.external)").length===2 && localStorage.getItem("grok.archives-expanded.v1")==="true"'),'archive expansion not persisted');
    await click('.archived-sessions .session-open');await click('.archived-sessions .session-actions');
    await run('Array.from(document.querySelectorAll("[role=menuitem]")).find(e=>e.textContent.includes("取消归档")).click()');await wait();
    assert(await run('document.querySelectorAll(".session-row:not(.external)").length===2 && !document.querySelector(".archived-sessions")'),'restored archive did not return to ordinary list');
    console.log('WORKSPACE_DECK_PASSED split/focus/draft, pointer context target, close all/last, reopen, portal anchor, dirty cancel/save/discard, reset, archive collapse/restore');


    app.exit(0);
  }catch(error){console.error(error.stack);app.exit(1)}
});`;
await writeFile(resolve(output, "main.cjs"), source);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require("electron"), [resolve(output, "main.cjs")], { windowsHide: true, stdio: "inherit", env });
const timer = setTimeout(() => child.kill(), 60_000);
child.on("exit", (code) => { clearTimeout(timer); process.exitCode = code ?? 1; });
