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
    if (process.env.REGRESSION_SCOPE !== 'automation') {
    if (process.env.REGRESSION_SCOPE !== 'draft') {
    await run('fixture.menus()'); await wait();
    await run('document.querySelectorAll(".sb-session-more")[0].focus()'); await key('ArrowDown','ArrowDown');
    assert(await run('document.activeElement.getAttribute("role")==="menuitem"'),'menu arrow focus');
    await key('Escape','Escape');assert(await run('document.activeElement.classList.contains("sb-session-more") && !document.querySelector("[role=menu]")'),'menu Escape restore');
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
    }
    await run('fixture.draft("a")');await wait();await run('fixture.draft("b")');await wait();
    await run('fixture.edit("new b");fixture.resolve("a","stale a")');await wait();
    await run('fixture.resolve("b","older b")');await wait();
    assert(await run('document.querySelector("#draft").value==="new b"'),'late hydration overwrote input');
    await run('fixture.draft("c")');await wait();await run('fixture.resolve("c","stored c")');await wait();
    assert(await run('document.querySelector("#draft").value==="stored c"'),'draft hydration missing');
    await run('fixture.edit("unsaved c")');await wait();await run('fixture.reload()');await wait();
    assert(await run('document.querySelector("#draft").value==="unsaved c"'),'same-target reload lost edits');

    await run('fixture.draft("claim-a")');await wait();await run('fixture.resolve("claim-a","A prompt")');await wait();
    const claimA=await run('fixture.claimDraft()');await wait();
    await run('fixture.draft("claim-b")');await wait();
    assert(await run('fixture.pending().includes("claim-b")'),'A claim suppressed B hydration');
    await run('fixture.resolve("claim-b","B saved draft",[{id:"b-file",name:"B",kind:"file",path:"fixture/B"}])');await wait();
    const claimB=await run('fixture.claimDraft()');await wait();
    await run('fixture.clearClaim('+claimA+');fixture.endClaim('+claimA+')');await wait();
    assert(await run('fixture.draftState().text==="B saved draft" && fixture.draftState().attachments[0].id==="b-file" && !fixture.canRestoreClaim('+claimA+')'),'late A completion changed B or retained restore ownership');
    await run('fixture.endClaim('+claimB+')');await new Promise(r=>setTimeout(r,300));
    assert(await run('fixture.draftState().writes.filter(row=>row.key==="claim-b").every(row=>row.text==="B saved draft")'),'B persisted draft was overwritten');
    await run('fixture.draft("claim-a")');await wait();await run('fixture.resolve("claim-a","A reloaded draft")');await wait();
    assert(await run('fixture.draftState().text==="A reloaded draft" && !fixture.canRestoreClaim('+claimA+')'),'returning to A revived an old claim');

    await run('fixture.draft("","fixture","new:claim-project")');await wait();
    await run('fixture.resolve("new:claim-project","first prompt",[{id:"first-file",name:"first",kind:"file",path:"fixture/first"}])');await wait();
    const firstClaim=await run('fixture.claimDraft()');await wait();
    assert(await run('fixture.migrateDraft('+firstClaim+',"created-session")'),'explicit new-task migration was denied');
    assert(await run('!fixture.migrateDraft('+firstClaim+',"other-created-session")'),'one claim accepted two migration targets');
    await run('fixture.draft("created-session")');await wait();
    assert(await run('!fixture.pending().includes("created-session") && fixture.draftState().text==="first prompt" && fixture.draftState().attachments.length===1'),'legal migration hydrated a duplicate prompt or lost its attachment');
    await run('fixture.clearClaim('+firstClaim+')');await wait();
    assert(await run('fixture.draftState().text==="" && fixture.draftState().attachments.length===0 && fixture.canRestoreClaim('+firstClaim+')'),'legal migration did not consume its exact snapshot');
    assert(await run('fixture.restoreClaim('+firstClaim+',"first prompt",[{id:"first-file",name:"first",kind:"file",path:"fixture/first"}])'),'owned failed submission was not restored');await wait();
    assert(await run('fixture.draftState().text==="first prompt" && fixture.draftState().attachments.length===1 && !fixture.restoreClaim('+firstClaim+',"duplicate",[])'),'failure recovery duplicated content or attachments');
    await run('fixture.endClaim('+firstClaim+')');

    await run('fixture.draft("","fixture","new:fast-migration")');await wait();await run('fixture.resolve("new:fast-migration","fast first prompt")');await wait();
    const fastClaim=await run('fixture.claimDraft()');await wait();
    await run('fixture.migrateDraft('+fastClaim+',"fast-created");fixture.clearClaim('+fastClaim+');fixture.draft("fast-created")');await wait();
    assert(await run('fixture.draftState().text==="" && !fixture.pending().includes("fast-created") && fixture.canRestoreClaim('+fastClaim+')'),'a fast submission rehydrated consumed text or lost valid failure recovery during migration');
    await run('fixture.draft("","fixture","new:fast-migration")');await wait();
    assert(await run('fixture.pending().includes("new:fast-migration")'),'returning to the new-task slot reused an already migrated claim');
    await run('fixture.resolve("new:fast-migration","another new task");fixture.clearClaim('+fastClaim+');fixture.endClaim('+fastClaim+')');await wait();
    assert(await run('fixture.draftState().text==="another new task"'),'old migrated submission consumed a newly opened task');
    await run('fixture.draft("","")');await wait();await run('fixture.edit("unassigned first prompt");fixture.addDraftAttachment("unassigned-file")');await wait();
    const unassignedClaim=await run('fixture.claimDraft()');await wait();
    assert(await run('fixture.migrateDraft('+unassignedClaim+',"picked-session","picked-workspace")'),'explicit first workspace selection was denied');
    await run('fixture.draft("picked-session","picked-workspace")');await wait();
    assert(await run('fixture.draftState().text==="unassigned first prompt" && fixture.draftState().attachments.length===1 && !fixture.pending().includes("picked-session")'),'first workspace selection lost its submitted draft');
    await run('fixture.clearClaim('+unassignedClaim+')');await wait();
    assert(await run('fixture.draftState().text==="" && fixture.draftState().attachments.length===0 && fixture.canRestoreClaim('+unassignedClaim+')'),'first workspace migration cannot clear or recover its own snapshot');
    await run('fixture.endClaim('+unassignedClaim+');fixture.draft("created-session")');await wait();await run('fixture.resolve("created-session","first prompt",[{id:"first-file",name:"first",kind:"file",path:"fixture/first"}])');await wait();

    const attachmentClaim=await run('fixture.claimDraft()');await wait();await run('fixture.addDraftAttachment("extra-before-clear")');await wait();
    await run('fixture.clearClaim('+attachmentClaim+')');await wait();
    assert(await run('fixture.draftState().text==="first prompt" && fixture.draftState().attachments.length===2 && !fixture.canRestoreClaim('+attachmentClaim+')'),'attachment edits before send were cleared or made restorable');
    await run('fixture.endClaim('+attachmentClaim+')');
    const followupClaim=await run('fixture.claimDraft()');await wait();await run('fixture.clearClaim('+followupClaim+')');await wait();
    await run('fixture.addDraftAttachment("followup-only")');await wait();
    assert(await run('!fixture.canRestoreClaim('+followupClaim+') && !fixture.restoreClaim('+followupClaim+',"stale prompt",[])'),'attachment-only follow-up was overwritten by failure');
    await run('fixture.endClaim('+followupClaim+');fixture.edit("next prompt")');await wait();
    const textClaim=await run('fixture.claimDraft()');await wait();await run('fixture.clearClaim('+textClaim+')');await wait();await run('fixture.edit("typed follow-up")');await wait();
    assert(await run('!fixture.restoreClaim('+textClaim+',"stale",[]) && fixture.draftState().text==="typed follow-up"'),'typed follow-up was overwritten by failure');
    await run('fixture.endClaim('+textClaim+')');

    await run('fixture.draft("","project-one","new:project-one")');await wait();await run('fixture.resolve("new:project-one","project A")');await wait();
    const projectClaim=await run('fixture.claimDraft()');await wait();await run('fixture.draft("","project-two","new:project-two")');await wait();
    await run('fixture.resolve("new:project-two","project B")');await wait();
    assert(await run('!fixture.migrateDraft('+projectClaim+',"late-created-session")'),'late creation stole another project');
    await run('fixture.clearClaim('+projectClaim+');fixture.endClaim('+projectClaim+')');await wait();
    assert(await run('fixture.draftState().text==="project B"'),'a project change retained the previous claim');

    await run('fixture.convertDraft()');await wait();await run('fixture.draft("conversion-b","project-two")');await wait();await run('fixture.resolve("conversion-b","B text")');await wait();
    await run('fixture.resolveTextDraft("late-from-project-A")');await wait();
    assert(await run('fixture.draftState().text==="B text" && fixture.draftState().attachments.length===0 && fixture.textDraftState().deleted.includes("fixture/late-from-project-A.txt")'),'late text attachment changed B or leaked its unused file');
    await run('fixture.convertDraft();fixture.edit("newer B text")');await wait();await run('fixture.resolveTextDraft("stale-text-version")');await wait();
    assert(await run('fixture.draftState().text==="newer B text" && fixture.draftState().attachments.length===0 && fixture.textDraftState().deleted.includes("fixture/stale-text-version.txt")'),'text conversion erased a newer edit');
    await run('fixture.convertDraft();fixture.addDraftAttachment("newer-B-attachment")');await wait();await run('fixture.resolveTextDraft("stale-attachment-version")');await wait();
    assert(await run('fixture.draftState().text==="newer B text" && fixture.draftState().attachments.length===1 && fixture.textDraftState().deleted.includes("fixture/stale-attachment-version.txt")'),'text conversion ignored attachment-only edits');
    await run('fixture.convertDraft()');await wait();await run('fixture.rejectTextDraft()');await wait();
    assert(await run('fixture.draftState().text==="newer B text" && fixture.textDraftState().results.at(-1)==="fixture write failed"'),'failed conversion lost the source text');
    await run('fixture.convertDraft();fixture.convertDraft()');await wait();await run('fixture.resolveTextDraft("converted-once");fixture.resolveTextDraft("duplicate-conversion")');await wait();
    assert(await run('fixture.draftState().text==="" && fixture.draftState().attachments.filter(row=>row.draftText).length===1 && fixture.textDraftState().deleted.includes("fixture/duplicate-conversion.txt") && !fixture.textDraftState().deleted.includes("fixture/converted-once.txt")'),'double conversion duplicated attachment or deleted a used file');
    await run('fixture.edit("unmount source")');await wait();await run('fixture.convertDraft()');await wait();await run('fixture.unmountDraft()');await wait();await run('fixture.resolveTextDraft("after-unmount")');await wait();
    assert(await run('fixture.textDraftState().deleted.includes("fixture/after-unmount.txt") && fixture.textDraftState().results.at(-1)===false'),'unmounted composer accepted a late conversion');
    }
    if(process.env.REGRESSION_SCOPE==='draft'){console.log('REGRESSION_DOM_PASSED draft claims, explicit migration, attachment/text edits, failure restoration and asynchronous text conversion');app.exit(0);return;}
    await run('fixture.taskCenter()');await wait();
    await run('Array.from(document.querySelectorAll(".automation-row button")).find(b=>b.textContent==="编辑").click()');await wait();
    assert(await run('document.body.textContent.includes("保留此前的会话和运行记录")'),'fresh context deletes history in UI copy');
    assert(await run('(()=>{const d=new Date("2030-01-01T01:30:00Z");return document.querySelector("input[type=datetime-local]").value===new Date(+d-d.getTimezoneOffset()*60000).toISOString().slice(0,16)})()'),'one-off schedule timezone shifted');
    await run('Array.from(document.querySelectorAll(".automation-editor button")).find(b=>b.textContent==="保存并注册").click()');await wait();
    assert(await run('(()=>{const p=fixture.automationPayload();return p && p.timeZone==="Asia/Shanghai" && !["revision","sessionRevision","frozenExecutionProfile","scheduleAnchor"].some(k=>k in p)})()'),'runtime-only task fields leaked into strict IPC');
    await run('fixture.taskCenter(true)');await wait();
    await run('Array.from(document.querySelectorAll(".automation-row button")).find(b=>b.textContent==="编辑").click()');await wait();
    assert(await run('(()=>{const labels=Array.from(document.querySelectorAll(".automation-editor label"));const input=labels.find(l=>l.textContent.startsWith("工作区")).querySelector("input");return !input.disabled && labels.find(l=>l.textContent.startsWith("会话上下文")).querySelector("select").disabled && labels.find(l=>l.textContent.startsWith("会话模式")).querySelector("select").disabled})()'),'bound workspace must remain editable while fixed execution fields are clear');
    await run('(()=>{const el=Array.from(document.querySelectorAll(".automation-editor label")).find(l=>l.textContent.startsWith("工作区")).querySelector("input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,"moved-workspace");el.dispatchEvent(new Event("input",{bubbles:true}))})()');await wait();
    await run('Array.from(document.querySelectorAll(".automation-editor button")).find(b=>b.textContent==="保存并注册").click()');await wait();
    assert(await run('fixture.automationPayload().workspace==="moved-workspace" && fixture.automationPayload().targetSessionId==="parent"'),'workspace edit lost the bound session');
    await run('fixture.taskCenter(false)');await wait();
    await run('Array.from(document.querySelectorAll(".automation-row button")).find(b=>b.textContent==="编辑").click()');await wait();
    await run('(()=>{const el=document.querySelector("input[list=automation-timezones]");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,"Europe/London");el.dispatchEvent(new Event("input",{bubbles:true}))})()');await wait();
    await run('Array.from(document.querySelectorAll(".automation-editor button")).find(b=>b.textContent==="保存并注册").click()');await wait();
    assert(await run('fixture.automationPayload().timeZone==="Europe/London"'),'time zone editor did not persist selection');
    await run('fixture.confirmations()');await wait();
    assert(await run('document.body.textContent.includes("Computer 操作等待确认") && !document.body.textContent.includes("Other secret")'),'confirmation leaked across conversations');
    await run('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="允许本次").click()');await wait();
    assert(await run('fixture.confirmationCalls()[0].id==="pending:mine" && fixture.confirmationCalls()[0].approved && !document.body.textContent.includes("Delete fixture")'),'confirmation response did not resolve shared inbox ID');
    await run('fixture.nativeTasks()');await wait();
    await run('Array.from(document.querySelectorAll(".task-tabs button")).find(b=>b.textContent==="队列与后台").click()');await wait();
    const nativeRow = (title) => 'Array.from(document.querySelectorAll(".native-run-row")).find(r=>r.textContent.includes("' + title + '"))';
    await run(nativeRow("Live native goal") + '.querySelector("summary").click()');await wait();
    await run('Array.from(' + nativeRow("Live native goal") + '.querySelectorAll("button")).find(b=>b.textContent==="查看会话").click()');await wait();
    assert(await run('fixture.nativeOpen().sessionId==="native-session" && fixture.nativeOpen().previewOnly===false'),'a live native task must open its conversation normally');
    await run(nativeRow("Restored native workflow") + '.querySelector("summary").click()');await wait();
    assert(await run(nativeRow("Restored native workflow") + '.textContent.includes("上次记录")'),'a restored summary must keep its last-known status');
    await run('Array.from(' + nativeRow("Restored native workflow") + '.querySelectorAll("button")).find(b=>b.textContent==="查看会话").click()');await wait();
    assert(await run('fixture.nativeOpen().sessionId==="restored-session" && fixture.nativeOpen().previewOnly===true'),'a restored native summary must request history-only navigation');
    await run('fixture.modelGate()');await wait();
    assert(await run('document.querySelector("button.send-button").disabled && document.querySelector("select[aria-label=模型]").value==="" && !document.querySelector("select[aria-label=模型]").disabled && document.body.textContent.includes("请重新选择模型")'),'missing-model gate or usable explicit picker');
    await run('document.querySelector("textarea").focus()');
    for (const modifiers of [0,2]) {
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',modifiers});
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',modifiers});
    }
    assert(await run('fixture.modelGateResult().sent===0 && document.querySelector("textarea").value==="Important unsent draft"'),'keyboard bypassed gate or changed draft');
    await run('(()=>{const e=document.querySelector("select[aria-label=模型]");e.value="current";e.dispatchEvent(new Event("change",{bubbles:true}))})()');await wait();
    assert(await run('fixture.modelGateResult().choices.join()==="current" && !document.querySelector("button.send-button").disabled'),'reported model cannot be explicitly chosen');
    await run('document.querySelector("button.send-button").click()');
    assert(await run('fixture.modelGateResult().sent===1'),'explicit selection did not restore single send');
    console.log(process.env.REGRESSION_SCOPE === 'automation' ? 'REGRESSION_DOM_PASSED automation, native navigation and missing-model selection' : 'REGRESSION_DOM_PASSED all fixture groups including native navigation and missing-model selection');
    app.exit(0);
  }catch(error){console.error(error.stack);app.exit(1)}
});`;
await writeFile(resolve(output, "main.cjs"), source);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require("electron"), [resolve(output, "main.cjs")], { windowsHide: true, stdio: "inherit", env });
const timer = setTimeout(() => child.kill(), 60_000);
child.on("exit", (code) => { clearTimeout(timer); process.exitCode = code ?? 1; });
