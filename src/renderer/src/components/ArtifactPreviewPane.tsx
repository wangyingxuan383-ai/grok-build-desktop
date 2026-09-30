import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { WorkspaceArtifact } from "../../../shared/workspace-tools";
import { mediaPreviewUrl, type ArtifactPreviewTarget } from "../artifact-preview";
import { ArtifactContent } from "./ArtifactWorkbench";
import "../styles/artifact-preview.css";

export function ArtifactPreviewPane({target,onClose,onPin,onReturn,onError,onPinMedia}:{
  target:ArtifactPreviewTarget; onPinMedia?(target:Extract<ArtifactPreviewTarget,{kind:"media"}>):void; onClose():void; onPin(workspace:string,path:string):void;
  onReturn(sessionId:string,workspace:string):void; onError(message:string):void;
}) {
  const [expanded,setExpanded]=useState(false);
  const [artifact,setArtifact]=useState<WorkspaceArtifact>();
  const [error,setError]=useState("");
  const [failedMedia,setFailedMedia]=useState(false);
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    let cancelled=false;setArtifact(undefined);setError("");setFailedMedia(false);
    if(target.kind==="file") void window.grokDesktop.readWorkspaceArtifact(target.workspace,target.path)
      .then(value=>{if(!cancelled)setArtifact(value)})
      .catch(reason=>{if(!cancelled)setError(reason instanceof Error?reason.message:String(reason))});
    return ()=>{cancelled=true};
  },[target,revision]);
  const title=target.kind==="file" ? artifact?.name || target.path.split(/[\\/]/).at(-1) || "文件" : target.media==="image" ? "生成图片" : "生成视频";
  const src=target.kind==="media"?mediaPreviewUrl(target):"";
  const action=(promise:Promise<unknown>)=>void promise.catch(reason=>onError(reason instanceof Error?reason.message:String(reason)));
  const content=()=>{
    if(error)return <div role="alert"><p>{error}</p><button onClick={()=>setRevision(v=>v+1)}>重新读取</button></div>;
    if(target.kind==="file")return artifact?<ArtifactContent artifact={artifact} onMediaError={()=>setError("无法解码此媒体文件；可以另存原文件后使用外部应用检查。")}/>:<p role="status">正在读取产物…</p>;
    if(!src||failedMedia)return <p role="alert">原文件已不可用或媒体身份未验证。请返回来源会话检查，不会重新生成。</p>;
    return target.media==="image"?<img src={src} alt={title} onError={()=>setFailedMedia(true)}/>:<video src={src} controls onError={()=>setFailedMedia(true)}/>;
  };
  const actions=<div className="artifact-preview-actions">
    {target.sessionId&&<button onClick={()=>onReturn(target.sessionId!,target.workspace)}>返回来源会话</button>}
    {target.kind==="file"&&artifact&&<><button onClick={()=>onPin(target.workspace,artifact.path)}>固定为标签</button><button onClick={()=>action(window.grokDesktop.saveWorkspaceArtifact(target.workspace,artifact.path))}>另存原文件</button></>}
    {target.kind==="media"&&src&&!failedMedia&&<>{onPinMedia&&!target.isData&&<button onClick={()=>onPinMedia(target)}>固定为标签</button>}{target.media==="image"&&<><button onClick={()=>action(window.grokDesktop.copyImage(src))}>复制图片</button><button onClick={()=>action(window.grokDesktop.saveImage(src))}>另存原图</button></>}{!target.isData&&<button onClick={()=>action(window.grokDesktop.openMedia(src))}>打开原文件</button>}</>}
  </div>;
  return <Dialog.Root open={expanded} onOpenChange={setExpanded}><aside className="right-utility-pane artifact-preview-pane" aria-label="产物预览">
    <header><div><strong>{title}</strong><span>{target.kind==="file"?"工作区文件":"会话媒体原件"}</span></div><div><Dialog.Trigger asChild><button>扩大</button></Dialog.Trigger><button aria-label="关闭产物预览" onClick={onClose}>×</button></div></header>
    {actions}
    <div className="artifact-preview-body">{!expanded&&content()}</div>
    <Dialog.Portal><Dialog.Overlay className="ui-dialog-overlay"/><Dialog.Content className="ui-dialog artifact-expanded"><Dialog.Title>{title}</Dialog.Title><Dialog.Description>只读原始产物；关闭扩大视图返回侧栏。</Dialog.Description><Dialog.Close>返回侧栏</Dialog.Close>{actions}<div className="artifact-preview-body">{expanded&&content()}</div></Dialog.Content></Dialog.Portal>
  </aside></Dialog.Root>;
}
