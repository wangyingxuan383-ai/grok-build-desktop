import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button, Card, ui, type Theme } from "./ui";
import { confirm } from "./forms";
import { activeNativeRuns, nativeRunPhaseLabel, nativeRunKey, nativeRunStatusLabels, nativeRunActionLabels, nativeRunStopDescription, type NativeRunSnapshot, type NativeRunAction } from "../../../src/shared/native-runs";
import type { useRemote } from "./use-remote";

export function NativeRunCards({ rows, client, theme, disabled, refresh, open }: {
  rows: NativeRunSnapshot[]; client: ReturnType<typeof useRemote>; theme: Theme; disabled: boolean;
  refresh(): Promise<void>; open(id:string):void;
}) {
  const [expanded,setExpanded] = useState<string>(), [busy,setBusy] = useState(false), [notice,setNotice] = useState("");
  const submitting = useRef(false);
  const visibleRows=activeNativeRuns(rows);
  if (!visibleRows.length) return null;
  const control = async (row:NativeRunSnapshot, action:NativeRunAction) => {
    if (submitting.current || disabled || row.stale) return; submitting.current=true;setBusy(true); setNotice("");
    try { const receipt=await client.mutate("native-run.control",row.id,{sessionId:row.sessionId,kind:row.kind,revision:row.revision,action}); if(receipt?.message)setNotice(receipt.message); await refresh(); }
    catch(error) { setNotice(error instanceof Error ? error.message : String(error)); } finally { submitting.current=false;setBusy(false); }
  };
  return <View style={{gap:8}}><Text style={[ui.section,{color:theme.muted}]}>原生目标与工作流</Text>{visibleRows.map(row=> {
    const key=nativeRunKey(row), isOpen=expanded===key;
    return <Card key={key} theme={theme}><Pressable accessibilityRole="button" accessibilityState={{expanded:isOpen}} onPress={()=>setExpanded(isOpen?undefined:key)}><Text numberOfLines={2} style={[ui.title,{color:theme.text}]}>{row.title}</Text><Text style={[ui.hint,{color:theme.muted}]}>{row.kind === "goal" ? "Goal" : "Workflow"} · {row.stale ? "待同步" : nativeRunStatusLabels[row.status]} · {client.sessions.find(s=>s.id===row.sessionId)?.title || `会话 ${row.sessionId.slice(0,8)}`} · {isOpen?"收起":"展开"}</Text></Pressable>
    {isOpen && <><Text style={[ui.hint,{color:theme.muted}]}>{client.sessions.find(s=>s.id===row.sessionId)?.title || `会话 ${row.sessionId.slice(0,8)}`}{row.phase?` · ${nativeRunPhaseLabel(row.phase)}`:""}</Text>{row.reason?<Text style={[ui.hint,{color:theme.muted}]}>{row.reason}</Text>:null}{row.budget?<Text style={[ui.hint,{color:theme.muted}]}>{row.budget.unit==="tokens"?"Token":"Agent"}：{row.budget.used?.toLocaleString()??"未上报"}{row.budget.limit!==undefined?` / ${row.budget.limit.toLocaleString()}`:" · 上限未上报"}</Text>:null}{row.unavailableReason?<Text style={[ui.hint,{color:theme.muted}]}>{row.unavailableReason}</Text>:null}<View style={[ui.row,{flexWrap:"wrap"}]}><Button compact theme={theme} title="查看会话" onPress={()=>open(row.sessionId)}/>{row.actions.map(action=><Button compact key={action} theme={theme} title={busy?"确认中…":nativeRunActionLabels[action]} disabled={disabled||busy} danger={action==="stop"} onPress={()=>action==="stop"?confirm("结束原生任务？",nativeRunStopDescription(row.kind),()=>void control(row,action)):void control(row,action)}/>)}</View></>}
    </Card>;
  })}{notice?<Text accessibilityRole="alert" style={[ui.hint,{color:theme.muted}]}>{notice}</Text>:null}</View>;
}
