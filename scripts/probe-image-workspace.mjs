import {build} from "vite";
import react from "@vitejs/plugin-react";
import {mkdir,writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {resolve} from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url),output=resolve("out/image-workspace-probe");await mkdir(output,{recursive:true});
await build({configFile:false,define:{"process.env.NODE_ENV":JSON.stringify("production")},plugins:[react()],build:{emptyOutDir:false,outDir:output,lib:{entry:resolve("scripts/fixtures/image-workspace.tsx"),name:"ImagesFixture",formats:["es"],fileName:()=>"fixture.js"}}});
await writeFile(resolve(output,"index.html"),'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="grok-build-desktop.css"><div id="root"></div><script type="module" src="fixture.js"></script>');
await writeFile(resolve(output,"main.cjs"),String.raw`
const {app,BrowserWindow}=require("electron"),path=require("node:path");app.setPath("userData",path.join(__dirname,"profile"));
const wait=()=>new Promise(r=>setTimeout(r,100)),assert=(v,m)=>{if(!v)throw Error(m)};
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:1366,height:768,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}}),run=s=>win.webContents.executeJavaScript(s,true);try{
 await win.loadFile(path.join(__dirname,"index.html"));win.webContents.debugger.attach("1.3");await wait();
 const until=async(s)=>{for(let i=0;i<50;i++){if(await run(s))return;await wait()}throw Error("timeout: "+s)};
 const click=async(label)=>{const point=await run('(()=>{const b=Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==='+JSON.stringify(label)+');if(!b)throw Error("missing button");b.scrollIntoView();const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');for(const type of ["mousePressed","mouseReleased"])await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent",{type,...point,button:"left",clickCount:1});await wait()};
 const type=async(text)=>{await run('document.querySelector("textarea").focus()');await win.webContents.debugger.sendCommand("Input.insertText",{text});await wait()};
 await until('document.body.textContent.includes("无需选择代码项目")');await type("中文图像测试");await click("生成图片");await until('fixture.state().calls===1');
 assert(await run('fixture.state().state.conversations.length===1 && document.querySelector("textarea").disabled'),"standalone generation not bound or duplicate prevention missing");
 await click("编程");await click("返回图像");await until('document.body.textContent.includes("中文图像测试")');await click("中文图像测试");
 assert(await run('fixture.state().calls===1 && document.querySelector("textarea").disabled'),"switching modes with an empty draft restarted or lost the running job");
 await click("取消生成");await until('!document.querySelector("textarea").disabled');
 await type("继续编辑草稿");await click("编程");await click("返回图像");await until('document.body.textContent.includes("中文图像测试")');await click("中文图像测试");
 assert(await run('document.querySelector("textarea").value==="继续编辑草稿" && fixture.state().calls===1'),"draft lost or remount submitted twice");
 await click("从代码产物选择参考图");await until('document.body.textContent.includes("代码项目图片")');await click("用作本次参考图");
 assert(await run('document.body.textContent.includes("已选择历史作品") && fixture.state().calls===1 && !fixture.state().state.conversations.some(row=>row.id==="code-session")'),"cross-mode selection generated or reclassified a code session");
 await run("fixture.finishWithOriginal()");await until('document.body.textContent.includes("用原图继续修改")');await click("用原图继续修改");await until('document.body.textContent.includes("已选择历史作品")');
 assert(await run('fixture.state().calls===1'),"restoring an original repeated generation");
 await click("更改图片保存目录");await until('document.body.textContent.includes("D:/Images")');
 await click("删除会话记录");await click("取消");assert(await run('fixture.state().state.conversations.length===1'),"cancel deletion changed history");await click("删除会话记录");await click("删除记录");await until('fixture.state().state.conversations.length===0');
 for(const zoom of [1,1.5]){win.webContents.setZoomFactor(zoom);await wait();assert(await run('document.querySelector("textarea").getBoundingClientRect().width>150'),"composer collapsed at zoom")}
 console.log("IMAGE_WORKSPACE_PASSED independent creation, cancellation, draft/mode restore, no duplicate submit, root change, delete confirmation, zoom");app.exit(0);
 }catch(error){console.error(error.stack);app.exit(1)}});
`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(require("electron"),[resolve(output,"main.cjs")],{windowsHide:true,stdio:"inherit",env});const timer=setTimeout(()=>child.kill(),60000);child.on("exit",code=>{clearTimeout(timer);process.exitCode=code??1});
