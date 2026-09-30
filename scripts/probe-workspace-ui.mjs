// Isolated production shell; only navigation and screenshots, no prompts or scheduler writes.
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawn} from 'node:child_process';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const profile=await mkdtemp(join(tmpdir(),'grok-ui-redesign-'));const out=resolve('out/ui-redesign');await mkdir(out,{recursive:true});await writeFile(join(profile,'settings.json'),JSON.stringify({activeWorkspace:profile,theme:{mode:'dark',customBase:'dark',colors:{background:'#0d0f12',surface:'#171a1f',text:'#e7e9ec',muted:'#9299a3',accent:'#45a9df',border:'#292e35'},background:{enabled:false,scope:'conversation',fit:'cover',position:'center',opacity:0,blur:0,dim:0}}}));
await writeFile(join(profile,'preview.html'),'<h1>隔离产物预览</h1><script>parent.__artifactExecuted=true</script>');
const port=26000+Math.floor(Math.random()*3000);const env={...process.env,GROK_DESKTOP_OFFLINE_SMOKE:'1',GROK_DESKTOP_UI_FIXTURE:'1'};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(require('electron'),[resolve('.'),'--user-data-dir='+profile,'--remote-debugging-port='+port],{windowsHide:true,env,stdio:['ignore','pipe','pipe']});let logs='';child.stderr.on('data',chunk=>{logs=(logs+chunk).slice(-3000)});const wait=(ms=120)=>new Promise(r=>setTimeout(r,ms));let socket;let request;
try{let target;for(let i=0;i<160;i++){try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');if(target)break}catch{}await wait()}if(!target)throw Error('Renderer unavailable '+logs);socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((ok,no)=>{socket.onopen=ok;socket.onerror=no});let id=0;const pending=new Map();socket.onmessage=({data})=>{const msg=JSON.parse(data);const p=pending.get(msg.id);if(p){pending.delete(msg.id);msg.error?p.no(Error(JSON.stringify(msg.error))):p.ok(msg.result)}};request=(method,params={})=>new Promise((ok,no)=>{const current=++id;const timer=setTimeout(()=>{pending.delete(current);no(Error('timeout '+method))},15000);pending.set(current,{ok:v=>{clearTimeout(timer);ok(v)},no:e=>{clearTimeout(timer);no(e)}});socket.send(JSON.stringify({id:current,method,params}))});const run=async expression=>{const r=await request('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
for(let i=0;i<100;i++){if(await run('Boolean(document.querySelector(".sidebar"))'))break;await wait()}
await wait(500);const captures=[];const toolsOnly=process.argv.includes('--tools-only');const allPages=process.argv.includes('--all-pages');
for(const [width,height,scale,theme] of (toolsOnly?[[1366,768,1.5,'light']]:allPages?[[1366,768,1,'dark']]:[[1366,768,1,'dark'],[1366,768,1.5,'light'],[1920,1080,1,'dark'],[1920,1080,1.5,'light']])){
 await request('Emulation.setDeviceMetricsOverride',{width:Math.floor(width/scale),height:Math.floor(height/scale),deviceScaleFactor:scale,mobile:false});
 await run(`(async()=>{const settings=await window.grokDesktop.getSettings();await window.grokDesktop.updateSettings({theme:{...settings.theme,mode:${JSON.stringify(theme)}}})})()`);
 await request('Page.reload');for(let i=0;i<100;i++){try{if(await run('Boolean(document.querySelector(".sidebar"))'))break}catch{}await wait()}await wait(900);
 if(toolsOnly)await run("document.querySelector('.project-tools-heading')?.click()");
 for(const [label,key] of (toolsOnly?[['终端','terminal'],['浏览器','browser'],['产物预览','artifact']]:[['任务中心','tasks'],['扩展与 Skills','extensions'],['设置','settings'],['模型提供商','providers']])){
  if(toolsOnly){const found=await run(`(()=>{const b=Array.from(document.querySelectorAll('.project-tools nav button')).find(b=>b.textContent.trim()===${JSON.stringify(label)});b?.click();return Boolean(b)})()`);if(!found)throw Error('Missing sidebar tool '+label+' '+JSON.stringify(await run("({body:document.body.innerHTML.slice(-2000),sidebar:document.querySelector('.sidebar')?.outerHTML.slice(0,1600)})"))+' '+logs)}else{await run('window.dispatchEvent(new Event("grok:command-search"))');await wait();const found=await run(`(()=>{const b=Array.from(document.querySelectorAll('[role=option]')).find(b=>b.textContent.trim()===${JSON.stringify(label)});b?.click();return Boolean(b)})()`);if(!found)throw Error('Missing command '+label)}await wait(500);
  const state=await run(`({page:!!document.querySelector('.workbench-page-surface'),modal:!!document.querySelector('.workbench-page-surface [aria-modal=true]'),width:document.documentElement.scrollWidth,viewport:innerWidth,text:document.querySelector('.workbench-page-surface')?.textContent.slice(0,80)})`);
  if(toolsOnly){for(let retry=0;retry<30;retry++){if(await run(`Boolean(document.querySelector('.${key}-workbench'))`))break;await wait()}if(!await run(`Boolean(document.querySelector('.${key}-workbench'))`))throw Error(key+' workbench missing '+JSON.stringify(await run("({text:document.body.innerText.slice(-1000),tools:[...document.querySelectorAll('.project-tools nav button')].map(b=>[b.textContent.trim(),b.className]),deck:document.querySelector('.workspace-deck')?.getAttribute('hidden'),active:document.querySelector('.sidebar .active')?.textContent})")))}else if(!state.page||state.modal)throw Error(key+' did not become a nonmodal page');
  if(toolsOnly&&key==='artifact'){
    await run(`(()=>{const input=document.querySelector('[aria-label="产物文件路径"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(join(profile,'preview.html'))});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()`);await wait();await run("document.querySelector('.artifact-workbench form').requestSubmit()");
    let isolated=false;for(let retry=0;retry<30;retry++){isolated=await run("Boolean(document.querySelector('.artifact-frame[sandbox]'))");if(isolated)break;await wait()}
    if(!isolated||await run("Boolean(window.__artifactExecuted)"))throw Error('HTML isolated preview failed');
  }
  if(toolsOnly&&key==='browser'){
    await run("document.querySelector('.browser-workbench header button')?.click()");let opened=false;for(let retry=0;retry<40;retry++){opened=await run("document.querySelectorAll('.browser-workbench nav>div').length===1");if(opened)break;await wait()}
    if(!opened)throw Error('Browser tab was not created');await run("window.__probeBrowserId=localStorage.getItem('grok.active-browser.v1')");
  }
  const shot=await request('Page.captureScreenshot' ,{format:'png'});const name=`${key}-${width}x${height}-${scale}-${theme}.png`;await writeFile(join(out,name),Buffer.from(shot.data,'base64'));captures.push({name,...state});
 }
}
if(allPages){
 const pages=[['账号','accounts','panel'],['关于与更新','about','panel'],['诊断','diagnostics','panel'],['使用引导','onboarding','panel'],['创作','media','panel'],['子智能体看板','dashboard','view'],['Agent 与 Persona','agents','view'],['执行配置档','profiles','view'],['Memory','memory','view'],['Worktree','worktrees','view'],['文件','files','view'],['源代码管理','source-control','view'],['会话','chat','view']];
 for(const [label,key,kind] of pages){
  await run('window.dispatchEvent(new Event("grok:command-search"))');await wait(180);
  const found=await run(`(()=>{const b=Array.from(document.querySelectorAll('[role=option]')).find(b=>b.textContent.trim()===${JSON.stringify(label)});b?.click();return Boolean(b)})()`);if(!found)throw Error('Missing page action '+label);await wait(700);
  const state=await run(`({surface:${kind==='panel'?"Boolean(document.querySelector('.workbench-page-surface'))":"Boolean(document.querySelector('.workspace-deck:not([hidden])'))"},width:document.documentElement.scrollWidth,viewport:innerWidth,text:document.body.innerText.slice(-500)})`);
  if(!state.surface)throw Error(key+' page did not render '+state.text);
  const shot=await request('Page.captureScreenshot',{format:'png'});const name=`all-${key}-1366x768-dark.png`;await writeFile(join(out,name),Buffer.from(shot.data,'base64'));captures.push({name,...state});
 }
}
if(toolsOnly){
  await run("Array.from(document.querySelectorAll('.project-tools nav button')).find(b=>b.textContent.trim()==='文件')?.click()");
  for(let retry=0;retry<60;retry++){if(await run("Boolean(document.querySelector('.file-tree-row'))"))break;await wait()}
  await run("Array.from(document.querySelectorAll('.file-tree-row')).find(b=>b.textContent.includes('preview.html'))?.click()");
  await run("document.querySelector('[title=\"预览产物\"]')?.click()");
  let loaded=false;for(let retry=0;retry<60;retry++){loaded=await run("Boolean(document.querySelector('.artifact-source')?.textContent.includes('preview.html'))");if(loaded)break;await wait()}
  if(!loaded)throw Error('File tree to artifact preview route failed');
  await run("Array.from(document.querySelectorAll('.project-tools nav button')).find(b=>b.textContent.trim()==='浏览器')?.click()");
  let restored=false;for(let retry=0;retry<40;retry++){restored=await run("Boolean(document.querySelector('.browser-workbench nav button.active'))&&localStorage.getItem('grok.active-browser.v1')===window.__probeBrowserId");if(restored)break;await wait()}
  if(!restored)throw Error('Browser active tab did not restore after switching workbench');
}
await writeFile(join(out,toolsOnly?'tools-evidence.json':'evidence.json'),JSON.stringify(captures,null,2));console.log('WORKSPACE_UI_PASSED '+captures.length+' page/viewport captures');
}catch(error){console.error(error);process.exitCode=1}finally{socket?.close();child.kill();}
