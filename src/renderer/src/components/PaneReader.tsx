import { lazy, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MediaPreviewContext } from "../artifact-preview";
import { Virtuoso } from "react-virtuoso";
import type { GitDiffResult } from "../../../shared/types";
import { reduceEvent, useAppStore, type UiMessage } from "../store";
import { useWorkbenchStore } from "../workbench-store";
import { targetKey, workspaceKey, type ContentTarget } from "../workspace-layout";
import { MessageCard } from "./MessageCard";
import { readonlyMessage } from "../readonly-message";
import "../styles/pane-reader.css";
import { readPaneScroll, writePaneScroll } from "../pane-scroll-state";
const SubagentPane=lazy(()=>import("./SubagentConversation").then(module=>({default:module.SubagentConversation})));
const ArtifactPane=lazy(()=>import("./ArtifactWorkbench").then(module=>({default:module.ArtifactWorkbench})));
const TerminalPane=lazy(()=>import("./TerminalWorkbench").then(module=>({default:module.TerminalSurface})));

function ScrollableText({scrollKey,label,value}:{scrollKey:string;label:string;value:string}) {
  const ref=useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(()=>{
    const element=ref.current;
    if(!element)return;
    element.scrollTop=readPaneScroll(scrollKey).top;
    return ()=>writePaneScroll(scrollKey,{top:element.scrollTop});
  },[scrollKey]);
  return <textarea ref={ref} className="pane-reader-text" readOnly aria-label={label} value={value} onScroll={event=>writePaneScroll(scrollKey,{top:event.currentTarget.scrollTop})}/>;
}

function ScrollableMessages({scrollKey,messages,sessionId,onActivate}:{scrollKey:string;messages:UiMessage[];sessionId:string;onActivate():void}) {
  const [initialTop]=useState(()=>readPaneScroll(scrollKey).top);
  const scroller=useRef<HTMLElement|null>(null);
  const restoring=useRef(initialTop>0);
  const restoreTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const restorePosition=useCallback(()=>{
    clearTimeout(restoreTimer.current);
    restoreTimer.current=setTimeout(()=>{
      const element=scroller.current;
      if(!restoring.current || !element || element.scrollHeight-element.clientHeight<initialTop)return;
      element.scrollTop=initialTop;
      restoring.current=false;
    },0);
  },[initialTop]);
  useEffect(()=>()=>clearTimeout(restoreTimer.current),[]);
  const cleanup=useRef<(()=>void)|undefined>(undefined);
  const attachScroller=useCallback((element:HTMLElement|Window|null)=>{
    cleanup.current?.();cleanup.current=undefined;
    scroller.current=element instanceof HTMLElement?element:null;
    if(!(element instanceof HTMLElement))return;
    const remember=()=>{if(!restoring.current)writePaneScroll(scrollKey,{top:element.scrollTop})};
    const userScroll=()=>{restoring.current=false};
    element.addEventListener("scroll",remember);
    for(const type of ["wheel","touchstart","pointerdown","keydown"])element.addEventListener(type,userScroll);
    cleanup.current=()=>{element.removeEventListener("scroll",remember);for(const type of ["wheel","touchstart","pointerdown","keydown"])element.removeEventListener(type,userScroll)};
  },[scrollKey]);
  return <Virtuoso initialItemCount={Math.min(10,messages.length)} initialScrollTop={initialTop} totalListHeightChanged={restorePosition} scrollerRef={attachScroller} className="pane-reader-messages" data={messages} computeItemKey={(_,message)=>message.id} itemContent={(_,message)=><MessageCard message={readonlyMessage(message)} sessionId={sessionId} allowFileNavigation={false} showThinking={true} expandTools={false}/>} />;
}

/** Reading another view never resumes a CLI, changes global Git selection or answers a prompt. */
export function PaneReader({target,onActivate,paneId="reader"}:{target?:ContentTarget;onActivate():void;paneId?:string}) {
  const preview=useContext(MediaPreviewContext);
  const view=useAppStore(state=>{
    if(target?.kind!=="session")return undefined;
    const summary=state.sessions.find(session=>session.id===target.id);
    return summary && workspaceKey(summary.cwd)!==workspaceKey(target.workspace)?undefined:state.views[target.id];
  });
  const file=useWorkbenchStore(state=>target?.kind==="file"?state.tabs.find(tab=>tab.key===target.id && workspaceKey(tab.document.workspacePath)===workspaceKey(target.workspace)):undefined);
  const [diff,setDiff]=useState<{key:string;value:GitDiffResult}>();
  const [error,setError]=useState("");
  const [revision,setRevision]=useState(0);
  const key=target?targetKey(target):"";
  const scrollKey = `${paneId}:${key}`;
  const [history,setHistory] = useState<{key:string;messages:UiMessage[]}>();
  const [historyError,setHistoryError] = useState("");
  const [historyLoading,setHistoryLoading] = useState(false);
  const liveMessages = view?.messages;
  const needsHistory = target?.kind === "session" && !liveMessages?.length;
  useEffect(()=>{
    let cancelled=false;setHistoryError("");
    if (!needsHistory || !target) { setHistoryLoading(false); return; }
    setHistoryLoading(true);
    void window.grokDesktop.inspectSession(target.workspace,target.id).then(projection=>{
      if(cancelled)return;
      if(projection && projection.sessionId!==target.id)throw Error("历史记录身份不匹配");
      const messages=projection ? reduceEvent({...useAppStore.getState(),views:{}},{type:"conversation-projection-restore",sessionId:target.id,projection}).views?.[target.id]?.messages ?? [] : [];
      setHistory({key,messages});
    }).catch(reason=>{if(!cancelled)setHistoryError(reason instanceof Error?reason.message:String(reason))})
      .finally(()=>{if(!cancelled)setHistoryLoading(false)});
    return ()=>{cancelled=true};
  },[key,needsHistory,revision]);
  const messages = liveMessages?.length ? liveMessages : history?.key===key ? history.messages : undefined;
  useEffect(()=>{
    let cancelled=false;setDiff(undefined);setError("");
    if(target?.kind!=="review")return;
    try {
      const selection=JSON.parse(target.id) as {path?:unknown;staged?:unknown};
      if(typeof selection.path!=="string" || typeof selection.staged!=="boolean")throw Error("差异标签的目标无效");
      void window.grokDesktop.getGitDiff(target.workspace,selection.staged,selection.path)
        .then(value=>{if(!cancelled)setDiff({key,value})})
        .catch(reason=>{if(!cancelled)setError(String(reason))});
    }catch(reason){setError(String(reason))}
    return ()=>{cancelled=true};
  },[key,revision]);
  return <MediaPreviewContext.Provider value={value=>preview?.({...value,workspace:target?.workspace})??false}><section className="pane-reader" aria-label="窗格只读内容">
    <header><button className="pane-activate" onClick={onActivate}>在此窗格继续操作</button><small>{target?.workspace}</small><span>{target?.kind==="artifact"?"产物查看":target?.kind==="terminal"?"终端输出 · 激活后输入":"只读同步视图"}</span></header>
    {needsHistory && <div><button disabled={historyLoading} onClick={()=>setRevision(value=>value+1)}>{historyLoading?"正在读取历史…":"刷新只读历史"}</button>{historyError && messages?.length ? <p role="alert">刷新失败，仍显示上次读取内容：{historyError}</p>:null}</div>}
    {target?.kind==="subagent"&&<Suspense fallback={<p>正在读取子会话…</p>}><SubagentPane nodeId={target.id}/></Suspense>}
    {target?.kind==="artifact"&&<Suspense fallback={<p>正在读取产物…</p>}><ArtifactPane workspace={target.workspace} initialPath={target.id} onError={setError}/></Suspense>}
    {target?.kind==="terminal"&&<Suspense fallback={<p>正在连接终端视图…</p>}><TerminalPane id={target.id} workspace={target.workspace} onError={setError} readOnly/></Suspense>}
    {error&&target?.kind!=="review"&&<p role="alert">{error}</p>}
    {target?.kind==="file" ? file ? <><p>{file.dirty?"● 未保存修改":"文件内容"} · {file.document.relativePath}</p><ScrollableText key={scrollKey} scrollKey={scrollKey} label="完整文件内容" value={file.buffer}/></> : <p>此文件尚未加载或已关闭，请激活窗格读取。</p>
    : target?.kind==="review" ? <><button onClick={()=>setRevision(value=>value+1)}>刷新此窗格差异</button>{error?<p role="alert">{error}</p>:diff?.key===key ? diff.value.binary?<p>二进制差异，请激活窗格查看详情。</p>:<ScrollableText key={scrollKey} scrollKey={scrollKey} label="当前项目完整差异" value={diff.value.patch||"没有差异"}/> : <p role="status">正在读取此项目差异…</p>}</>
    : target?.kind==="session" && messages?.length ? <ScrollableMessages key={scrollKey} scrollKey={scrollKey} messages={messages} sessionId={target.id} onActivate={onActivate}/>
    : target?.kind==="session" ? <div><p role={historyError?"alert":"status"}>{historyError || (messages ? "没有可读取的本机历史副本；可激活会话通过 CLI 检查。" : "正在只读加载本机历史…")}</p></div> : target && ["subagent","artifact","terminal"].includes(target.kind) ? null : <p>{target?.title||"暂无内容"}{target?.kind==="browser"?" · 请激活此窗格使用浏览器；同一网页仅有一个交互视图。":""}</p>}
  </section></MediaPreviewContext.Provider>;
}
