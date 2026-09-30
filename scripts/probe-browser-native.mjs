import {build} from "vite";
import {mkdir,writeFile,rm} from "node:fs/promises";
import {resolve,sep} from "node:path";
import {createRequire} from "node:module";
import {spawn} from "node:child_process";
const require=createRequire(import.meta.url),output=resolve("out/browser-native-probe");
const profile=resolve(output,"profile-"+Date.now());
await mkdir(output,{recursive:true});
await build({configFile:false,build:{emptyOutDir:false,outDir:output,lib:{entry:resolve("src/main/services/workspace-browser-service.ts"),formats:["es"],fileName:()=>"service.mjs"},rolldownOptions:{external:["electron","node:path","node:crypto"]}}});
await writeFile(resolve(output,"main.cjs"),String.raw`
const {app,BrowserWindow,session,dialog}=require("electron"),path=require("node:path"),fs=require("node:fs/promises"),http=require("node:http");
app.setPath("userData",process.env.GROK_NATIVE_BROWSER_PROBE_PROFILE);
const assert=(value,message)=>{if(!value)throw Error(message)},pause=()=>new Promise(r=>setTimeout(r,50));
const until=async(check)=>{for(let i=0;i<100;i++){if(await check())return;await pause()}throw Error("native browser probe timeout")};
app.whenReady().then(async()=>{
 const server=http.createServer((req,res)=>{if(req.url==="/download"){res.writeHead(200,{"Content-Type":"application/octet-stream","Content-Disposition":'attachment; filename="fixture.txt"'});res.end("isolated browser download");return}res.writeHead(200,{"Content-Type":"text/html"});res.end(req.url==="/empty"?'<title>Empty</title>':'<title>Isolated browser</title><script>localStorage.setItem("fixture","kept")</script>')});
 let service,win;try{
 await new Promise(resolve=>server.listen(0,resolve));const port=server.address().port;
 const one="http://127.0.0.1:"+port,two="http://localhost:"+port;
 const {WorkspaceBrowserService}=await import("./service.mjs");
 win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
 service=new WorkspaceBrowserService(win,()=>{});
 const partition=session.fromPartition("persist:grok-workspace-browser");await partition.setProxy({mode:"direct"});
 const first=await service.create(one),second=await service.create(two);
 await until(()=>service.list().every(tab=>!tab.loading&&tab.title==="Isolated browser"));
 const contents=win.contentView.children.map(view=>view.webContents),firstContents=contents.find(c=>c.getURL().startsWith(one)),secondContents=contents.find(c=>c.getURL().startsWith(two));
 assert(await firstContents.executeJavaScript('typeof window.grokDesktop==="undefined"&&typeof require==="undefined"'),"browser exposed application bridge");
 await partition.cookies.set({url:one,name:"first",value:"first"});await partition.cookies.set({url:two,name:"other",value:"other"});
 const destination=path.join(app.getPath("userData"),"fixture.txt");
 partition.on("will-download",(_event,item)=>item.setSavePath(destination));firstContents.downloadURL(one+"/download");
 await until(()=>service.list().find(tab=>tab.id===first.id).downloadStatus?.includes("下载完成"));
 assert(await fs.readFile(destination,"utf8")==="isolated browser download","download file mismatch");
 // Only the confirmation answer is stubbed. Cookies, storage, views and downloads are real Electron.
 let question;dialog.showMessageBox=async(_window,options)=>{question=options;return {response:1,checkboxChecked:false}};
 await service.clearSite(first.id);
 assert(question.cancelId===0&&question.defaultId===0,"destructive dialog did not default to cancel");
 assert(firstContents.getURL()==="about:blank","cleared target was not blanked");
 assert(secondContents.getURL().startsWith(two)&&await secondContents.executeJavaScript('localStorage.getItem("fixture")==="kept"'),"unrelated origin storage or view changed");
 const cookies=await partition.cookies.get({});
 assert(!cookies.some(cookie=>cookie.name==="first")&&cookies.some(cookie=>cookie.name==="other"),"site cleanup changed unrelated cookies: "+JSON.stringify(cookies.map(c=>c.name)));
 await service.navigate(first.id,one+"/empty");
 await until(()=>!service.list().find(tab=>tab.id===first.id).loading);
 assert(await firstContents.executeJavaScript('localStorage.getItem("fixture")===null'),"target localStorage was not cleared");
 console.log("BROWSER_NATIVE_PASSED isolated WebContents, real download, target clear, unrelated cookies/storage kept; dialog answer simulated");
 service.dispose();win.destroy();server.close();app.exit(0);
 }catch(error){console.error(error.stack);service?.dispose();win?.destroy();server.close();app.exit(1)}
});
`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
env.GROK_NATIVE_BROWSER_PROBE_PROFILE=profile;
const child=spawn(require("electron"),[resolve(output,"main.cjs")],{windowsHide:true,stdio:"inherit",env});
const timer=setTimeout(()=>child.kill(),45000);child.on("exit",async code=>{clearTimeout(timer);process.exitCode=code??1;if(!profile.startsWith(output+sep))throw Error("Unsafe probe cleanup");await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200})});
