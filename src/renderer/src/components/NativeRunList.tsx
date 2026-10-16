import { useRef, useState } from "react";
import { activeNativeRuns, nativeRunPhaseLabel, nativeRunActionLabels, nativeRunKey, nativeRunStatusLabels, nativeRunStopDescription, type NativeRunAction, type NativeRunSnapshot } from "../../../shared/native-runs";
import { useAppStore } from "../store";

export function NativeRunList({ rows, onRefresh, onOpen, confirm }: {
  rows: NativeRunSnapshot[]; onRefresh(): Promise<void>; onOpen(id: string): Promise<void>;
  confirm(message: string, options?: { title?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>;
}): React.JSX.Element | null {
  const sessions = useAppStore(state => state.sessions);
  const [busy,setBusy] = useState<string>(), [notice,setNotice] = useState("");
  const submitting = useRef(false);
  const visibleRows=activeNativeRuns(rows);
  if (!visibleRows.length) return null;
  const control = async (row: NativeRunSnapshot, action: NativeRunAction): Promise<void> => {
    if (submitting.current || row.stale) return;
    submitting.current = true;
    const key = nativeRunKey(row); setBusy(key); setNotice("");
    try {
      if (action === "stop" && !await confirm(nativeRunStopDescription(row.kind),{title:"结束原生任务",confirmLabel:"结束",danger:true})) return;
      const receipt = await window.grokDesktop.controlNativeRun({sessionId:row.sessionId,kind:row.kind,runId:row.id,revision:row.revision,action,operationId:crypto.randomUUID()});
      setNotice(receipt.message); await onRefresh();
    } catch(error) {setNotice(error instanceof Error?error.message:String(error));}
    finally {submitting.current=false;setBusy(undefined);}
  };
  return <section className="native-run-list" aria-label="原生目标与工作流"><h3>原生目标与工作流</h3>{visibleRows.map(row => {
    const key = nativeRunKey(row), session = sessions.find(s=>s.id===row.sessionId);
    return <details className="native-run-item" key={key}><summary><div className="native-run-title"><strong>{row.title}</strong><small>{row.kind === "goal" ? "Goal" : "Workflow"} · {session?.title || `会话 ${row.sessionId.slice(0,8)}`}</small></div><span>{row.stale ? "待同步" : nativeRunStatusLabels[row.status]}</span></summary>
      {row.phase && <p className="native-run-note">阶段：{nativeRunPhaseLabel(row.phase)}</p>}
      {row.reason && <p className="native-run-note">{row.reason}</p>}{row.budget && <p className="native-run-note">{row.budget.unit === "tokens" ? "Token" : "Agent"}：{row.budget.used?.toLocaleString() ?? "未上报"}{row.budget.limit !== undefined ? ` / ${row.budget.limit.toLocaleString()}` : " · 上限未上报"}</p>}
      {row.unavailableReason && <p className="native-run-note">{row.unavailableReason}</p>}
      <div className="button-row"><button onClick={()=>void onOpen(row.sessionId)}>查看会话</button>{row.actions.map(action=><button disabled={Boolean(busy)} key={action} onClick={()=>void control(row,action)}>{busy===key ? "确认中…" : nativeRunActionLabels[action]}</button>)}</div>
    </details>;
  })}{notice && <p className="native-run-note" role="status">{notice}</p>}</section>;
}
