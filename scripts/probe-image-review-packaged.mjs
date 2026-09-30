// Scope: isolated real IPC and mouse navigation; no login, CLI launch, generation or user data.
const endpoint=process.argv[2];
const target=(await fetch(endpoint+'/json/list').then(r=>r.json())).find(row=>row.type==='page');
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
let seq=0;const pending=new Map(),errors=[];
socket.onmessage=({data})=>{const message=JSON.parse(data);if(message.method==='Runtime.exceptionThrown')errors.push(message.params);const item=pending.get(message.id);if(item){clearTimeout(item.timer);pending.delete(message.id);message.error?item.reject(Error(JSON.stringify(message.error))):item.resolve(message.result)}};
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>reject(Error(method+' timed out')),20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))});
const run=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result?.value};
const wait=async expression=>{for(let i=0;i<100;i++){if(await run(expression))return;await new Promise(resolve=>setTimeout(resolve,100))}throw Error('Wait failed: '+expression+' '+await run('document.body.innerText.slice(-1500)'))};
const click=async selector=>{await wait(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);await run(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`);await wait(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`);const point=await run(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...point})};
const chooseText=async text=>{await wait(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()===${JSON.stringify(text)})`);await run(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});e.dataset.reviewTarget='1'})()`);await click('[data-review-target="1"]');await run(`document.querySelector('[data-review-target="1"]')?.removeAttribute('data-review-target')`)};
try {
 await send('Runtime.enable');await wait('Boolean(document.querySelector(".app-shell"))');
 const settings=await run('window.grokDesktop.getSettings()');if(!settings.activeWorkspace.includes('Grok-Build-Desktop-smoke-'))throw Error('Not isolated');
 await run('localStorage.setItem("grok.app-mode.v1","image")');await send('Page.reload');await wait('Boolean(document.querySelector(".image-shell"))');
 await click('button[aria-label="账号与用量"]');await wait('document.body.innerText.includes("账号管理") || Boolean(document.querySelector(".account-list")) || document.body.innerText.includes("设备码登录")');
 await click('.control-panel > header button');await wait('!document.querySelector(".control-panel")');
 await click('button[aria-label="设置"]');await wait('document.body.innerText.includes("保存设置")');await chooseText('取消');
 await chooseText('图库');await wait('document.querySelectorAll(".im-tile.work").length===3');
 await click('.im-tile.work .im-tile-del');await chooseText('同时删除图片文件');
 await wait('document.querySelectorAll(".im-tile.work").length===2');
 const after=await run('window.grokDesktop.listImageWorkspace()');if(after.conversations[0].jobs.find(r=>r.job.jobId==='batch').job.artifacts.length!==1)throw Error('Sibling lost');
 await click('.im-tile.miss .im-tile-x');await chooseText('同时删除图片文件');await wait('document.body.innerText.includes("对应记录已保留")');
 if(!(await run('window.grokDesktop.listImageWorkspace()')).conversations[0].jobs.some(r=>r.job.jobId==='blocked'))throw Error('Failed cleanup lost record');
 await click('.image-sidebar .session-open');await wait('Boolean(document.querySelector(".im-composer textarea"))');await click('.im-composer textarea');await send('Input.insertText',{text:'RECOVERY_DRAFT'});
 // Remove the isolated main-process row to force a genuine draft IPC rejection during navigation.
 await run('window.grokDesktop.deleteImageConversation("image-review",false)');
 await click('.sb-mode button');await wait('Boolean(document.querySelector(".sidebar:not(.image-sidebar)"))');
 await wait('document.body.innerText.includes("图像草稿保存失败")');
 if(!await run('localStorage.getItem("grok.image-drafts.v1").includes("RECOVERY_DRAFT")'))throw Error('Draft recovery lost');
 if(errors.length)throw Error(JSON.stringify(errors));
 console.log('IMAGE_REVIEW_PACKAGED_PASSED accounts/settings, partial-gallery, per-picture deletion, failed-cleanup retry, rejected-draft mode exit');
} finally {socket.close()}
