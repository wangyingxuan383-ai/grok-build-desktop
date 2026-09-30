import {WebContentsView,type BrowserWindow,session,app,dialog,type DownloadItem,type WebContents} from "electron";
import {basename,join} from "node:path";
import {randomUUID} from "node:crypto";
import type {WorkspaceBrowserTab,WorkspaceViewBounds} from "../../shared/workspace-tools";
export function browserNavigationUrl(raw:string):string {if(raw==="about:blank")return raw;const url=new URL(raw);if(!["http:","https:"].includes(url.protocol)||url.username||url.password)throw Error("浏览器只接受 HTTP 或 HTTPS 地址");return url.href}
export class WorkspaceBrowserService {
 private entries=new Map<string,{view:WebContentsView;state:WorkspaceBrowserTab}>();
 private readonly browserSession=session.fromPartition("persist:grok-workspace-browser");
 private readonly download=(_event:Electron.Event,item:DownloadItem,contents:WebContents)=>{
  const entry=[...this.entries.values()].find(value=>value.view.webContents===contents);
  if(!entry){item.cancel();return;}
  item.setSaveDialogOptions({title:"保存浏览器下载",defaultPath:join(app.getPath("downloads"),basename(item.getFilename())||"download")});
  const update=(message:string)=>{if(!this.entries.has(entry.state.id))return;entry.state.downloadStatus=message;this.emit(this.list())};
  update("等待选择下载保存位置");
  item.on("updated",(_event,state)=>update(state==="interrupted"?"下载中断，可重新下载":`正在下载：${item.getFilename()}（${Math.round(item.getReceivedBytes()/1024)} KiB）`));
  item.once("done",(_event,state)=>update(state==="completed"?`下载完成：${item.getFilename()}`:state==="cancelled"?"下载已取消":"下载失败，请重新下载"));
 };
 async clearSite(id:string){
  const entry=this.require(id);const url=new URL(browserNavigationUrl(entry.view.webContents.getURL()));
  if(!["http:","https:"].includes(url.protocol))throw Error("当前页面没有可清理的网站数据");
  const response=await dialog.showMessageBox(this.window,{type:"question",title:"清理网站数据",message:`清理 ${url.origin} 的网站数据？`,detail:"将退出此网站登录，并将该站点的已打开标签转为空白页。其他网站登录保留。",buttons:["取消","清理"],defaultId:0,cancelId:0});
  if(response.response!==1)return false;
  for(const value of this.entries.values()){
   let same=false;try{same=new URL(value.view.webContents.getURL()).origin===url.origin}catch{}
   if(same){value.view.webContents.stop();await value.view.webContents.loadURL("about:blank");}
  }
  await this.browserSession.clearStorageData({origin:url.origin});return true;
 }
 constructor(private readonly window:BrowserWindow,private readonly emit:(tabs:WorkspaceBrowserTab[])=>void){window.webContents.on("did-start-navigation",()=>this.hideAll());const browserSession=session.fromPartition("persist:grok-workspace-browser");browserSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));browserSession.setPermissionCheckHandler(()=>false);this.browserSession.on("will-download",this.download)}
 list(){return [...this.entries.values()].map(entry=>({...entry.state}))}
 async create(url="about:blank"){if(this.entries.size>=12)throw Error("最多打开 12 个浏览器标签");url=browserNavigationUrl(url);const id=randomUUID();const view=new WebContentsView({webPreferences:{partition:"persist:grok-workspace-browser",nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});const state:WorkspaceBrowserTab={id,url,title:"新标签",loading:false,canGoBack:false,canGoForward:false};this.entries.set(id,{view,state});this.window.contentView.addChildView(view);view.setVisible(false);
 const refresh=()=>{if(view.webContents.isDestroyed())return;state.url=view.webContents.getURL()||url;state.title=view.webContents.getTitle()||"新标签";state.loading=view.webContents.isLoading();state.canGoBack=view.webContents.navigationHistory.canGoBack();state.canGoForward=view.webContents.navigationHistory.canGoForward();this.emit(this.list())};
 view.webContents.on("did-start-loading",()=>{state.error=undefined;refresh()});view.webContents.on("did-stop-loading",refresh);view.webContents.on("page-title-updated",refresh);view.webContents.on("did-navigate",refresh);view.webContents.on("did-fail-load",(_event,code,description,_url,mainFrame)=>{if(mainFrame&&code!==-3){state.error=description;refresh()}});
 const guard=(event:{preventDefault():void},target:string)=>{try{browserNavigationUrl(target)}catch{event.preventDefault();state.error="该地址类型不能在内置浏览器打开";this.emit(this.list())}};
 view.webContents.on("will-navigate",guard);view.webContents.on("will-redirect",guard);view.webContents.setWindowOpenHandler(({url:target})=>{void this.create(target).catch(error=>{state.error=String(error);this.emit(this.list())});return {action:"deny"}});
 void view.webContents.loadURL(url).catch(error=>{state.error=String(error);this.emit(this.list())});this.emit(this.list());return {...state};
 }
 navigate(id:string,url:string){const entry=this.require(id);return entry.view.webContents.loadURL(browserNavigationUrl(url))}
 command(id:string,action:"back"|"forward"|"reload"|"stop"){const contents=this.require(id).view.webContents;if(action==="back"&&contents.navigationHistory.canGoBack())contents.navigationHistory.goBack();else if(action==="forward"&&contents.navigationHistory.canGoForward())contents.navigationHistory.goForward();else if(action==="reload")contents.reload();else if(action==="stop")contents.stop()}
 bounds(id:string,bounds:WorkspaceViewBounds){const entry=this.require(id);const zoom=this.window.webContents.getZoomFactor();const [width=0,height=0]=this.window.getContentSize();const x=Math.max(0,Math.min(width,Math.round(bounds.x*zoom))),y=Math.max(0,Math.min(height,Math.round(bounds.y*zoom)));entry.view.setBounds({x,y,width:Math.max(0,Math.min(width-x,Math.round(bounds.width*zoom))),height:Math.max(0,Math.min(height-y,Math.round(bounds.height*zoom)))});entry.view.setVisible(bounds.visible&&bounds.width>0&&bounds.height>0)}
 hideAll(){for(const entry of this.entries.values())entry.view.setVisible(false)}
 close(id:string){const entry=this.require(id);this.entries.delete(id);this.window.contentView.removeChildView(entry.view);entry.view.webContents.close();this.emit(this.list())}
 dispose(){this.browserSession.removeListener("will-download",this.download);for(const id of [...this.entries.keys()]){try{this.close(id)}catch{}}}
 private require(id:string){const entry=this.entries.get(id);if(!entry)throw Error("浏览器标签已关闭");return entry}
}
