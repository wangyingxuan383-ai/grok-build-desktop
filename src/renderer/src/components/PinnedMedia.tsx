import {useState} from "react";
import {mediaPreviewUrl,type MediaPreview} from "../artifact-preview";
export function PinnedMedia({target,workspace,onError}:{target:MediaPreview;workspace:string;onError(message:string):void}){
 const [failed,setFailed]=useState(false),source=mediaPreviewUrl(target);
 const action=(promise:Promise<unknown>)=>void promise.catch(error=>onError(String(error)));
 return <section className="artifact-workbench pinned-media"><header><h2>{target.media==="image"?"生成图片":"生成视频"}</h2><p>来自会话 {target.sessionId} · 只读原件</p><div className="button-row"><button onClick={()=>window.dispatchEvent(new CustomEvent("grok:artifact-source",{detail:{sessionId:target.sessionId,cwd:workspace}}))}>返回来源会话</button>{!failed&&<>{target.media==="image"&&<><button onClick={()=>action(window.grokDesktop.copyImage(source))}>复制图片</button><button onClick={()=>action(window.grokDesktop.saveImage(source))}>另存原图</button></>}<button onClick={()=>action(window.grokDesktop.openMedia(source))}>打开原文件</button></>}</div></header>{failed||!source?<p role="alert">原件不可用或来源会话已删除。关闭此视图不会重新生成图片。</p>:<div className="artifact-preview-body">{target.media==="image"?<img src={source} alt="生成图片" onError={()=>setFailed(true)}/>:<video src={source} controls onError={()=>setFailed(true)}/>}</div>}</section>;
}
