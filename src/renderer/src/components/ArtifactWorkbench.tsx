import {trustedHtmlPreviewUrl} from "../../../shared/html-preview-url";
import {useEffect,useRef,useState} from "react";
import type {WorkspaceArtifact} from "../../../shared/workspace-tools";
import {LazyMarkdownView} from "./LazyMarkdownView";
import {decodeMediaArtifact,mediaArtifactPrefix} from "../media-artifact-target";
import {PinnedMedia} from "./PinnedMedia";
export function ArtifactWorkbench(props:{workspace:string;initialPath?:string;onError(message:string):void}){
 if(props.initialPath?.startsWith(mediaArtifactPrefix)){
  const target=decodeMediaArtifact(props.initialPath);
  return target?<PinnedMedia key={props.initialPath} target={target} workspace={props.workspace} onError={props.onError}/>:<p role="alert">媒体标签引用无效，可以关闭此标签。</p>;
 }
 return <FileArtifactWorkbench {...props}/>;
}
function FileArtifactWorkbench({workspace,initialPath,onError}:{workspace:string;initialPath?:string;onError(message:string):void}){
 const [path,setPath]=useState("");const [artifact,setArtifact]=useState<WorkspaceArtifact>();const [busy,setBusy]=useState(false);const generation=useRef(0);
 useEffect(()=>{generation.current++;setArtifact(undefined);setPath("");setBusy(false);return()=>{generation.current++}},[workspace]);
 useEffect(()=>{if(!initialPath)return;setPath(initialPath);const request=++generation.current;setArtifact(undefined);setBusy(true);void window.grokDesktop.readWorkspaceArtifact(workspace,initialPath).then(result=>{if(request===generation.current)setArtifact(result)}).catch(error=>{if(request===generation.current)onError(String(error))}).finally(()=>{if(request===generation.current)setBusy(false)})},[initialPath,workspace,onError]);
 const preview=async(pick=false)=>{const request=++generation.current;if(!pick)setArtifact(undefined);setBusy(true);try{const result=await (pick?window.grokDesktop.pickWorkspaceArtifact(workspace):window.grokDesktop.readWorkspaceArtifact(workspace,path.trim()));if(request===generation.current&&result){setArtifact(result);setPath(result.path)}}catch(error){if(request===generation.current)onError(String(error))}finally{if(request===generation.current)setBusy(false)}};
 return <section className="artifact-workbench"><header><h2>产物预览</h2><p>查看当前工作区中的文档、图片、音视频与网页产物。</p></header><form onSubmit={event=>{event.preventDefault();void preview()}}><button type="button" disabled={busy||!workspace} onClick={()=>void preview(true)}>选择文件</button><input aria-label="产物文件路径" placeholder="输入当前工作区内的完整文件路径" value={path} onChange={event=>setPath(event.target.value)}/><button disabled={busy||!workspace||!path.trim()}>{busy?"正在读取…":"预览"}</button></form>{artifact?<><div className="artifact-source"><strong>{artifact.name}</strong><span title={artifact.path}>{artifact.path}</span><button onClick={()=>void window.grokDesktop.saveWorkspaceArtifact(workspace,artifact.path).catch(error=>onError(String(error)))}>另存原文件</button></div><ArtifactContent artifact={artifact}/></>:<p className="empty-copy">支持 Markdown、代码、图片、PDF、音视频和交互 HTML。Office 提取内容供只读查看。文本上限 2 MB，HTML 与媒体上限 20 MB。</p>}</section>
}
function URLFor(artifact:WorkspaceArtifact){return ["image","audio","video","pdf"].includes(artifact.kind)?`data:${artifact.mimeType};base64,${artifact.data}`:`data:text/plain;charset=utf-8,${encodeURIComponent(artifact.data)}`}
export function ArtifactContent({artifact:a,onMediaError}:{artifact:WorkspaceArtifact;onMediaError?():void}){
 const url=URLFor(a);
 if(a.kind==="image")return <img className="artifact-media" src={url} alt={a.name} onError={onMediaError}/>;
 if(a.kind==="audio")return <audio controls src={url} onError={onMediaError}/>;
 if(a.kind==="video")return <video className="artifact-media" controls src={url} onError={onMediaError}/>;
 if(a.kind==="pdf")return <iframe className="artifact-frame" title={a.name} src={url}/>;
 if(a.kind==="html")return <><p className="inline-note">本地预览：支持脚本及同目录 CSS、JS、图片和 JSON；外部网络与表单禁用。需要接口或热更新的项目请打开开发服务器预览。</p><iframe className="artifact-frame" title={a.name} sandbox="allow-scripts" referrerPolicy="no-referrer" src={trustedHtmlPreviewUrl(a.previewUrl)}/></>;
 if(a.kind==="text"&&/\.md$/i.test(a.name))return <div className="artifact-document"><LazyMarkdownView text={a.data}/></div>;
 return <>{a.kind==="office"&&<p className="inline-note">Office 内容提取：不保留原排版；表格可能显示共享字符串索引，公式及嵌入对象不执行。</p>}<pre className="artifact-document">{a.data}</pre></>;
}
