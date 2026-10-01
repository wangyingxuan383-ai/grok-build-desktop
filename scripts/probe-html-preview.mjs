import {build} from "vite";
import react from "@vitejs/plugin-react";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {resolve} from "node:path";
import ts from "typescript";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url),root=resolve("out/html-preview-probe");await mkdir(root,{recursive:true});
await build({configFile:false,logLevel:"error",define:{"process.env.NODE_ENV":JSON.stringify("production")},plugins:[react()],build:{outDir:root,emptyOutDir:false,lib:{entry:resolve("scripts/fixtures/interactive-preview.tsx"),formats:["es"],fileName:()=>"fixture.js"}}});
const csp=(await readFile("src/renderer/index.html","utf8")).match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0];
await writeFile(resolve(root,"index.html"),`<!doctype html>${csp}<meta charset="utf-8"><div id="root"></div><script type="module" src="fixture.js"></script>`);
await writeFile(resolve(root,"html-preview-service.cjs"),ts.transpileModule(await readFile("src/main/services/html-preview-service.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);
await writeFile(resolve(root,"probe.cjs"),String.raw`
const {app,BrowserWindow,protocol}=require('electron');const {HtmlPreviewService}=require('./html-preview-service.cjs');const previews=new HtmlPreviewService();protocol.registerSchemesAsPrivileged([{scheme:'grok-html',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);const path=require('node:path');const http=require('node:http');let requests=0;const server=http.createServer((req,res)=>{requests++;res.end('ok')});
app.setPath('userData',path.join(__dirname,'profile'));
app.whenReady().then(async()=>{let win;try{await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/leak';protocol.handle('grok-html',request=>previews.response(request.url));const html=previews.register("<button id='counter' onclick=\"this.textContent='clicked'\">test</button><img src='"+url+"'><script>const button=document.getElementById('counter');button.click();let blocked=false;try{blocked=typeof parent.grokDesktop==='undefined'}catch{blocked=true}fetch('"+url+"').then(()=>parent.postMessage({clicked:button.textContent,blocked,networkBlocked:false},'*')).catch(()=>parent.postMessage({clicked:button.textContent,blocked,networkBlocked:true},'*'));</script>");win=new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});await win.loadFile(path.join(__dirname,'index.html'),{query:{html}});let result;for(let i=0;i<80;i++){result=await win.webContents.executeJavaScript('window.previewResult');if(result)break;await new Promise(r=>setTimeout(r,50));}
if(!result||result.clicked!=='clicked'||!result.blocked||!result.networkBlocked||requests!==0)throw Error(JSON.stringify({result,requests}));console.log('HTML_PREVIEW_PASSED interactive script, opaque origin, production CSP, blocked fetch/image egress');}catch(error){console.error(error);process.exitCode=1;}finally{win?.destroy();server.close();app.exit(process.exitCode||0);}});
`);
const child=spawn(require("electron"),[resolve(root,"probe.cjs")],{env:{...process.env,ELECTRON_RUN_AS_NODE:undefined},stdio:["ignore","pipe","pipe"],windowsHide:true});let out="";for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{out+=chunk;});const code=await new Promise(r=>child.on('exit',r));if(code!==0){process.stderr.write(out);process.exitCode=code||1;}else console.log(out.split(/\r?\n/).find(line=>line.includes('HTML_PREVIEW_PASSED')));
