// Actual sandboxed Electron DOM, synthetic local data; never starts Grok.
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const output = resolve("out/productivity-dom");
await mkdir(output, {recursive:true});
await build({configFile:false,define:{"process.env.NODE_ENV":JSON.stringify("production")},plugins:[react()],build:{emptyOutDir:false,outDir:output,lib:{entry:resolve("scripts/fixtures/productivity-dom.tsx"),name:"ProductivityFixture",formats:["iife"],fileName:()=>"fixture.js"}}});
await writeFile(resolve(output,"index.html"),'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="grok-build-desktop.css"><div id="root"></div><div id="overlay-root"></div><script src="fixture.js"></script>');
const source = String.raw`
const {app,BrowserWindow,protocol}=require('electron');
const path=require('node:path'),fs=require('node:fs');
app.setPath('userData',path.join(__dirname,'profile'));
protocol.registerSchemesAsPrivileged([{scheme:'grok-pet',privileges:{standard:true,secure:true,corsEnabled:true}}]);
const wait=()=>new Promise(r=>setTimeout(r,100));
function assert(value,message){if(!value)throw Error(message)}
app.whenReady().then(async()=>{
 protocol.handle('grok-pet',async req=>{const u=new URL(req.url),parts=u.pathname.split('/').filter(Boolean);if(!['a','b'].includes(parts[0])||!/^[a-z-]+\.webp$/.test(parts[1]||''))return new Response(null,{status:404});return new Response(fs.readFileSync(path.join(process.cwd(),'resources/pets',parts[0],parts[1])),{headers:{'Content-Type':'image/webp','Access-Control-Allow-Origin':'*'}})});
 const win=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
 const run=source=>win.webContents.executeJavaScript(source,true);
 const click=label=>run('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes('+JSON.stringify(label)+')).click()');
 const type=async(selector,value)=>{await run('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');Object.getOwnPropertyDescriptor(e.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event("input",{bubbles:true}))})()');await wait()};
 try{
  await win.loadFile(path.join(__dirname,'index.html'));
  const petSkins=['a','b'].map(id=>{const s=JSON.parse(fs.readFileSync(path.join(process.cwd(),'resources/pets',id,'skin.json'),'utf8'));for(const c of Object.values(s.clips))c.file='grok-pet://assets/'+id+'/'+c.file;return s});await run('window.petFixtureSkins='+JSON.stringify(petSkins));
  await run('productivityFixture.inbox(true)');await wait();
  assert(await run('document.querySelector(".task-inbox")!==null'),'first-mount inbox navigation');
  await run('productivityFixture.inbox(false)');await wait();
  assert(await run('document.querySelector(".task-inbox")===null'),'fresh task center retains default tab');
  await run('window.dispatchEvent(new Event("grok:open-inbox"))');await wait();
  assert(await run('document.querySelector(".task-inbox")!==null'),'already-mounted inbox navigation');
  const annotate=async()=>{await run('productivityFixture.diff()');await wait();await click('选择行');await wait();await type('textarea[aria-label="Diff 批注"]','请核对边界条件');await click('保存批注');await wait()};
  await annotate();
  await run('(()=>{const b=Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("加入当前会话草稿"));b.click();b.click()})()');await wait();
  assert(await run('productivityFixture.state().assignmentReads===1'),'duplicate clicks start only one validation');
  await run('productivityFixture.release()');await wait();
  assert(await run('productivityFixture.state().appended===1 && !document.querySelector(".diff-annotation-drafts")'),'annotations append exactly once');
  await annotate();await click('加入当前会话草稿');await wait();
  await run('productivityFixture.switchSession();productivityFixture.release()');await wait();
  assert(await run('productivityFixture.state().appended===0 && !!document.querySelector(".diff-annotation-drafts") && productivityFixture.state().error.includes("会话或工作区已切换")'),'late annotation retains draft after session switch');
  await run('productivityFixture.snippets()');await wait();await click('核对变更与验证');await wait();
  assert(await run('productivityFixture.state().inserted===""'),'snippet selection never inserts unfinished variables');
  await type('.snippet-variable-form input','src/example.ts');
  await type('.snippet-variable-form label:nth-of-type(2) input','{{文件}} 保持字面值');
  await click('插入草稿');await wait();
  assert(await run('productivityFixture.state().inserted==="核对 src/example.ts，重点检查 {{文件}} 保持字面值。"'),'variables are substituted once on explicit insert');
  await run('productivityFixture.export()');await wait();
  assert(await run('!document.querySelector("[role=switch]").checked && !!document.querySelector(".session-export-markdown")'),'export defaults to a redacted local preview');
  await run('(()=>{const s=document.querySelector(".session-export-options select");s.value="html";s.dispatchEvent(new Event("change",{bubbles:true}))})()');await wait();
  assert(await run('document.querySelector("iframe").getAttribute("sandbox")===""'),'HTML export stays sandboxed');
  await run('productivityFixture.petSettings()');await wait();
  assert(await run('Array.from(document.querySelectorAll("summary")).some(s=>s.textContent==="自定义形象与生图工坊 · 未完善功能"&&!s.parentElement.open)'),'unfinished label visible before expansion');
  assert(await run('document.querySelector("input[type=checkbox]").checked'),'pet enabled by default');
  await run('document.querySelector("input[type=checkbox]").click()');await wait();
  assert(await run('!document.querySelector("input[type=checkbox]").checked&&window.petFixtureWrites===1'),'pet disable saves immediately');
  await click('本次暂时隐藏');await wait();
  await click('显示桌宠');await wait();assert(await run('window.petFixtureCommand==="show"'),'pet show action wired');
  for(const [name,show] of [['snippets','snippets'],['settings','settings'],['pet','petSettings'],['export','export'],['inbox','inbox']]){
   for(const dark of [false,true]){
    await run('productivityFixture.theme('+dark+');productivityFixture.'+show+'('+ (show==='inbox'?'true':'') +')');await wait();
    for(const [width,zoom] of [[820,1.25],[820,1.5]]){
     win.setSize(width,900);win.webContents.setZoomFactor(zoom);await wait();
     if(name==='pet'){
      await run('(()=>{const s=Array.from(document.querySelectorAll("summary")).find(s=>s.textContent.includes("未完善功能"));s.parentElement.open=true;s.scrollIntoView({block:"start"})})()');await wait();
      assert(await run('document.body.textContent.includes("尚不提供一键生成完整桌宠")'),'workshop draft boundary visible');
      assert(await run('(()=>{const s=document.querySelector(".pet-unfinished");return s.getBoundingClientRect().right<=innerWidth})()'),'unfinished label stays inside viewport');
     }
     assert(await run('document.documentElement.scrollWidth<=window.innerWidth+1'),'horizontal page overflow: '+name);
     assert(await run('Array.from(document.querySelectorAll(".snippet-library")).every(e=>e.scrollWidth<=e.clientWidth+1)'),'snippet inner overflow');
     await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
     fs.writeFileSync(path.join(__dirname,name+'-'+(dark?'dark':'light')+'-'+width+'-'+zoom*100+'.png'),(await win.webContents.capturePage()).toPNG());
    }
   }
  }
  console.log('PRODUCTIVITY_DOM_PASSED inbox navigation, duplicate/stale annotations, variable insertion, sandboxed export, 820px 125/150% layouts');app.exit(0);
 }catch(error){console.error(error.stack);app.exit(1)}
});`;
await writeFile(resolve(output,"main.cjs"),source);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require("electron"),[resolve(output,"main.cjs")],{windowsHide:true,stdio:"inherit",env});
const timer=setTimeout(()=>child.kill(),60_000);
child.on("exit",code=>{clearTimeout(timer);process.exitCode=code??1});
