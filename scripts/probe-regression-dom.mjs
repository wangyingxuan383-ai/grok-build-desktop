// Hidden Electron renderer: actual DOM, React hooks and CDP keyboard events.
// No production profile, Grok process, network request or model session.
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const output = resolve("out/regression-dom");
await mkdir(output, { recursive: true });
await build({ configFile: false, define: { "process.env.NODE_ENV": JSON.stringify("production") }, plugins: [react()], build: { emptyOutDir: false, outDir: output, lib: { entry: resolve("scripts/fixtures/regression-dom.tsx"), name: "RegressionFixture", formats: ["iife"], fileName: () => "fixture.js" } } });
await writeFile(resolve(output, "index.html"), '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="fixture.js"></script>');
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
    await run('fixture.menus()'); await wait();
    await run('document.querySelectorAll("summary")[0].click();document.querySelectorAll("summary")[1].click()');await wait();
    assert(await run('document.querySelectorAll("details[open]").length===1 && document.querySelectorAll("details")[1].open'),'menu switch race');
    await run('document.querySelectorAll("summary")[1].focus()');await key('ArrowDown','ArrowDown');
    assert(await run('document.activeElement.getAttribute("role")==="menuitem"'),'menu arrow focus');
    await key('Escape','Escape');assert(await run('document.activeElement.tagName==="SUMMARY" && !document.querySelector("details[open]")'),'menu Escape restore');
    await key('Tab','Tab');assert(await run('document.activeElement.getAttribute("role")!=="menuitem"'),'Tab entered closed menu');
    await run('Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:()=>Promise.reject(Error("denied"))}});fixture.toast("first")');await wait();
    await run('document.querySelector(".toast-actions button").click()');await wait();
    assert(await run('document.querySelector(".toast-actions button").textContent.includes("复制失败")'),'copy failure feedback');
    await run('fixture.toast("second")');await wait();assert(await run('document.querySelector(".toast-actions button").textContent==="复制诊断"'),'copy status reset');
    await run('fixture.controls()');await wait();
    assert(await run('document.querySelector("select").options.length===3 && document.body.textContent.includes("实时会话暂停") && document.body.textContent.includes("回滚到 1.0.3")'),'recovery UI');
    for (const [phase,label] of [['downloading','下载固定版本'],['verifying','验证 ACP'],['rolling-back','回滚版本'],['restoring','恢复会话']]) {
      await run('fixture.phase('+JSON.stringify(phase)+')'); await new Promise(r=>setTimeout(r,1100));
      assert(await run('document.body.textContent.includes('+JSON.stringify(label)+') && Array.from(document.querySelectorAll("button")).every(b=>b.disabled)'),'update phase '+phase);
    }
    await run('fixture.phase("idle");window.confirm=()=>true;void 0');await new Promise(r=>setTimeout(r,1100));
    await run('document.querySelector("select").value="try-new";document.querySelector("select").dispatchEvent(new Event("change",{bubbles:true}))');await wait();
    await run('document.querySelector(".button-row button").click()');await wait();
    assert(await run('fixture.updateCalls()[0].policy==="try-new" && fixture.updateCalls()[0].action==="update"'),'recovery retry changed strategy');
    assert(await run('document.body.textContent.includes("fixture update failed") && !document.querySelector("select").disabled && Array.from(document.querySelectorAll("button")).every(b=>!b.disabled)'),'network refresh kept strategy/recovery locked');
    await run('document.querySelectorAll(".button-row button")[1].click()');await wait();
    assert(await run('fixture.updateCalls()[1].action==="verify" && fixture.updateCalls()[1].targetVersion==="1.0.3"'),'verify current after failed update');
    await run('fixture.mcp()');await wait();
    await run('document.querySelector("button.primary").click()');await wait();assert(await run('fixture.mcpCalls()===0 && document.body.textContent.includes("请先填写")'),'MCP required validation');
    await run('Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(document.querySelector("input"),"1");document.querySelector("input").dispatchEvent(new Event("input",{bubbles:true}))');await wait();
    await run('document.querySelector("button.primary").click()');await wait();assert(await run('document.body.textContent.includes("数值范围") && !document.querySelector("button.primary").disabled'),'MCP host rejection and retry');
    await run('Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(document.querySelector("input"),"3");document.querySelector("input").dispatchEvent(new Event("input",{bubbles:true}))');await wait();
    await run('document.querySelector("button.primary").click()');await wait();assert(await run('Array.from(document.querySelectorAll("button")).every(b=>b.disabled)'),'MCP pending lock');
    await run('fixture.mcpResolve()');await wait();assert(await run('document.body.textContent.includes("mcp resolved")'),'MCP resolved card removal');
    await run('fixture.draft("a")');await wait();await run('fixture.draft("b")');await wait();
    await run('fixture.edit("new b");fixture.resolve("a","stale a")');await wait();
    await run('fixture.resolve("b","older b")');await wait();
    assert(await run('document.querySelector("#draft").value==="new b"'),'late hydration overwrote input');
    await run('fixture.draft("c")');await wait();await run('fixture.resolve("c","stored c")');await wait();
    assert(await run('document.querySelector("#draft").value==="stored c"'),'draft hydration missing');
    await run('fixture.edit("unsaved c")');await wait();await run('fixture.reload()');await wait();
    assert(await run('document.querySelector("#draft").value==="unsaved c"'),'same-target reload lost edits');
    console.log('REGRESSION_DOM_PASSED menu switch/arrows/Esc/Tab, toast failure/reset, recovery controls/phases, MCP validation/retry/pending/removal, late hydration, unsaved reload');
    app.exit(0);
  }catch(error){console.error(error.stack);app.exit(1)}
});`;
await writeFile(resolve(output, "main.cjs"), source);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require("electron"), [resolve(output, "main.cjs")], { windowsHide: true, stdio: "inherit", env });
const timer = setTimeout(() => child.kill(), 60_000);
child.on("exit", (code) => { clearTimeout(timer); process.exitCode = code ?? 1; });
