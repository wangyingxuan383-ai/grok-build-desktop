import {build} from "vite";
import react from "@vitejs/plugin-react";
import {mkdir,writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {resolve} from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url),output=resolve("out/pane-reader");
await mkdir(output,{recursive:true});
await build({configFile:false,define:{"process.env.NODE_ENV":JSON.stringify("production")},plugins:[react()],build:{emptyOutDir:false,outDir:output,lib:{entry:resolve("scripts/fixtures/pane-reader.tsx"),name:"PaneFixture",formats:["es"],fileName:()=>"fixture.js"}}});
await writeFile(resolve(output,"index.html"),'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="grok-build-desktop.css"><div id="root"></div><script type="module" src="fixture.js"></script>');
await writeFile(resolve(output,"main.cjs"),String.raw`
const {app,BrowserWindow}=require("electron"),path=require("node:path");
app.setPath("userData",path.join(__dirname,"profile"));const wait=()=>new Promise(r=>setTimeout(r,150)),assert=(v,m)=>{if(!v)throw Error(m)};
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:1366,height:768,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});win.webContents.on("console-message",event=>console.log("Renderer:",event.message));const run=s=>win.webContents.executeJavaScript(s,true);
try{
 await win.loadFile(path.join(__dirname,"index.html"));win.webContents.debugger.attach("1.3");await wait();
 if(process.argv.includes("--history-refresh")) {
   const until=async(expression)=>{for(let i=0;i<50;i++){if(await run(expression))return;await wait()}throw Error("timed out: "+expression)};
   const clickRefresh=async()=>{const point=await run('(()=>{const b=Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="刷新只读历史");const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');for(const type of ["mousePressed","mouseReleased"])await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent",{type,...point,button:"left",clickCount:1});await wait()};
   await run('fixture.cold("scroll-history")');await wait();await run('fixture.finishLongHistory("scroll-history")');
   await until('(document.querySelector("[data-virtuoso-scroller]")?.scrollHeight ?? 0)>5000');
   await run('(()=>{const e=document.querySelector("[data-virtuoso-scroller]");e.scrollTo({top:2500});e.dispatchEvent(new Event("scroll"))})()');await wait();await wait();
   const before=await run('document.querySelector("[data-virtuoso-scroller]").scrollTop');assert(before>1000,"history did not scroll");
   await run('fixture.cold("elsewhere")');await wait();await run('fixture.finishLongHistory("elsewhere",2)');await wait();
   await run('fixture.cold("scroll-history")');await wait();await run('fixture.finishLongHistory("scroll-history")');await until('!!document.querySelector("[data-virtuoso-scroller]")');await wait();await wait();
   await until('Math.abs((document.querySelector("[data-virtuoso-scroller]")?.scrollTop ?? 0)-'+before+')<250');
   const restored=await run('document.querySelector("[data-virtuoso-scroller]").scrollTop');assert(Math.abs(restored-before)<250,"history scroll restoration drift: "+before+" -> "+restored);
   await win.reload();await wait();await wait();
   await run('fixture.cold("scroll-history")');await wait();await run('fixture.finishLongHistory("scroll-history")');
   await until('Math.abs((document.querySelector("[data-virtuoso-scroller]")?.scrollTop ?? 0)-'+before+')<250');
   const reads=await run('fixture.historyReads()');await clickRefresh();
   assert(await run('!!document.querySelector("[data-virtuoso-scroller]") && Array.from(document.querySelectorAll("button")).some(b=>b.disabled && b.textContent==="正在读取历史…")'),"refresh cleared old content or allowed duplicate request");
   await run('fixture.failHistory("scroll-history")');await until('document.body.textContent.includes("刷新失败")');
   assert(await run('!!document.querySelector("[data-virtuoso-scroller]") && fixture.historyReads()')===reads+1,"failed refresh lost history or duplicated request");
   await clickRefresh();await run('fixture.finishLongHistory("scroll-history",101)');await until('!document.body.textContent.includes("刷新失败") && Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="刷新只读历史" && !b.disabled)');
   assert(await run('fixture.state().activeSession==="focused" && fixture.state().activations===0'),"refresh changed active session");
   console.log("HISTORY_REFRESH_PASSED session viewport restoration, mouse refresh, pending content, failure/retry, unchanged focus");app.exit(0);return;
 }
 if(process.argv.includes("--native-history")) {
   await run('fixture.cold("native")');await wait();await run('fixture.nativeHistory()');
   for(let i=0;i<40;i++){await wait();if(await run('document.body.textContent.includes("原生回答正文")'))break}
   assert(await run('document.body.textContent.includes("只读 CLI 原生历史") && document.body.textContent.includes("显示上限") && document.body.textContent.includes("原生用户消息") && document.body.textContent.includes("原生工具结果") && fixture.state().activeSession==="focused" && fixture.state().activations===0'),"native history notice/content missing or focus changed: "+await run('document.body.textContent.slice(0,1500)'));
   console.log("NATIVE_PANE_PASSED native history notice, truncation, user/assistant/tool rendering, unchanged focus");app.exit(0);return;
 }
 if(process.argv.includes("--cold-history")) {
   await run('fixture.cold("old")');await wait();await run('fixture.cold("new")');await wait();
   await run('fixture.finishHistory("new","只读离线正文");fixture.finishHistory("old","错误旧正文")');
   for(let i=0;i<40;i++){await wait();if(await run('document.body.textContent.includes("只读离线正文")'))break}
   assert(await run('document.body.textContent.includes("只读离线正文") && !document.body.textContent.includes("错误旧正文") && fixture.state().activeSession==="focused"'),"cold history failed or stole focus: "+await run('document.body.textContent.slice(0,1000)'));
   await run('fixture.cold("bad")');await wait();await run('fixture.finishHistory("bad","foreign",true)');await wait();
   assert(await run('document.body.textContent.includes("身份不匹配")'),"foreign history was accepted");
   await run('fixture.scrollFile()');await wait();
   const point=await run('(()=>{const r=document.querySelector("textarea").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
   await run('document.querySelector("textarea").scrollTo({top:600})');await wait();
   const top=await run('document.querySelector("textarea").scrollTop');assert(top>0,"file did not scroll: "+await run('JSON.stringify({height:document.querySelector("textarea").clientHeight,scroll:document.querySelector("textarea").scrollHeight,value:document.querySelector("textarea").value.slice(0,60),box:document.querySelector("textarea").getBoundingClientRect()})'));
   await run('fixture.show(["C:/elsewhere"])');await wait();await run('fixture.scrollFile()');await wait();
   assert(await run('document.querySelector("textarea").scrollTop')===top,"pane viewport was not restored: "+await run('JSON.stringify({state:fixture.state(),top:document.querySelector("textarea").scrollTop})')+" expected "+top);
   console.log("COLD_PANE_PASSED readonly history, late response, owner mismatch, no focus change, file viewport restoration");app.exit(0);return;
 }
 await run('fixture.resolve("C:/one","ONE");fixture.resolve("C:/two","TWO")');await wait();
 assert(await run('Array.from(document.querySelectorAll("textarea")).map(e=>e.value).join(",")==="ONE,TWO"'),"same-name diffs crossed projects");
 await run('fixture.show(["C:/old","C:/two"])');await wait();await run('fixture.show(["C:/new","C:/two"])');await wait();
 await run('fixture.resolve("C:/new","NEW")');await wait();await run('fixture.resolve("C:/old","STALE")');await wait();
 assert(await run('document.querySelector("textarea").value==="NEW"'),"late result overwrote target");
 await run('fixture.file()');await wait();
 assert(await run('document.querySelector("textarea").value.endsWith("完整文件结尾") && document.querySelector("textarea").value.length>160000'),"file remained truncated");
 await run('document.querySelector("textarea").focus()');await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent",{type:"keyDown",key:"a",code:"KeyA",modifiers:2,windowsVirtualKeyCode:65});await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent",{type:"keyUp",key:"a",code:"KeyA",modifiers:2,windowsVirtualKeyCode:65});await wait();
 assert(await run('document.querySelector("textarea").selectionEnd===document.querySelector("textarea").value.length'),"full file keyboard navigation failed");
 await run('fixture.history()');for(let attempt=0;attempt<40;attempt++){await wait();if(await run('document.body.textContent.includes("首条历史不再丢失")'))break;}
 assert(await run('document.body.textContent.includes("首条历史不再丢失") && document.body.textContent.includes("计划（只读）")'),"history or read-only plan missing: "+await run('document.body.textContent.slice(0,800)+document.querySelector(".pane-reader-messages").outerHTML.slice(0,1500)'));
 assert(await run('fixture.state().activeSession==="focused" && fixture.state().activations===0'),"reading stole active session");
 console.log("PANE_READER_PASSED project-bound diffs, late response, full file/keyboard, untrimmed history, read-only decisions, unchanged focus");app.exit(0);
}catch(error){console.error(error.stack);app.exit(1)}});
`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(require("electron"),[resolve(output,"main.cjs"),...process.argv.slice(2)],{windowsHide:true,stdio:"inherit",env});const timer=setTimeout(()=>child.kill(),60000);child.on("exit",code=>{clearTimeout(timer);process.exitCode=code??1});
