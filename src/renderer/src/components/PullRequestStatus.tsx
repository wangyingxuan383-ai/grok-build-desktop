import {useEffect,useState} from "react";
import {useAppStore} from "../store";
import type {PullRequestStatus as Status} from "../../../shared/workspace-tools";
export function PullRequestStatus({workspace,onError}:{workspace:string;onError(message:string):void}){
 const [value,setValue]=useState<Status>(),[busy,setBusy]=useState(false),[watch,setWatch]=useState(false);
 const sessionId=useAppStore(state=>state.activeSessionId);
 const refresh=async()=>{setBusy(true);try{const next=await window.grokDesktop.getPullRequestStatus(workspace);setValue(next);setWatch(Boolean(next.watching))}catch(error){onError(String(error))}finally{setBusy(false)}};
 useEffect(()=>{setValue(undefined);setWatch(false)},[workspace]);
 return <details><summary>Pull Request 与 CI</summary><button disabled={busy||!workspace} onClick={()=>void refresh()}>{busy?"正在读取…":"读取当前分支 PR"}</button>{value?.url&&<button onClick={()=>void window.grokDesktop.openExternal(value.url!)}>在 GitHub 打开</button>}{value?.available&&sessionId&&<label><input type="checkbox" checked={watch} onChange={event=>{const enabled=event.target.checked;void window.grokDesktop.watchPullRequest(workspace,sessionId,enabled).then(()=>setWatch(enabled)).catch(error=>onError(String(error)))}}/>CI 完成后提醒（应用运行期间）</label>}{value&&!value.available&&<p>{value.reason}</p>}{value?.available&&<div><strong>#{value.number} {value.title}</strong><small>{value.state}</small>{value.checks.map(check=><p key={check.name}>{check.name} · {check.state}</p>)}{!value.checks.length&&<p>当前没有检查结果。</p>}</div>}</details>;
}
