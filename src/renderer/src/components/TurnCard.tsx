import { memo, useEffect, useState } from "react";
import type { UiChatTurn } from "../store";
import { LazyMarkdownView } from "./LazyMarkdownView";
import { MessageCard } from "./MessageCard";

export const TurnCard = memo(function TurnCard({ turn, sessionId, showThinking, expandTools, onResolved }: {
  turn: UiChatTurn;
  sessionId: string;
  showThinking: boolean;
  expandTools: boolean;
  onResolved(id: string): void;
}): React.JSX.Element {
  const [open, setOpen] = useState(turn.running);
  useEffect(() => { setOpen(turn.running); }, [turn.completed, turn.running]);
  const hasActivity = turn.groups.length > 0;
  return <article className={`chat-turn ${turn.completed ? "completed" : "active"}`}>
    {turn.user && <MessageCard message={turn.user} sessionId={sessionId} showThinking={showThinking} expandTools={expandTools} />}
    {hasActivity && <details className="execution-process" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary><span className={`process-dot ${turn.running ? "running" : ""}`} /><strong>{turn.running ? "正在执行" : "执行过程"}</strong><span className="process-summary">{summaryText(turn)}</span></summary>
      <div className="activity-groups">{turn.groups.map((group) => <details key={group.kind} className={`activity-group ${group.failed ? "has-failure" : ""}`} open={turn.running && group.kind === "progress"}>
        <summary><span>{group.label}</span><span>{group.count} 项{group.failed ? ` · ${group.failed} 失败` : ""}</span></summary>
        <div className="activity-items">{group.items.map((message) => <MessageCard key={message.id} message={message} sessionId={sessionId} showThinking={showThinking} expandTools={expandTools} onResolved={onResolved} />)}</div>
      </details>)}</div>
    </details>}
    {turn.pending.map((message) => <MessageCard key={message.id} message={message} sessionId={sessionId} showThinking={showThinking} expandTools={expandTools} onResolved={onResolved} />)}
    {turn.final && <div className="final-answer"><div className="final-answer-toolbar"><span>最终回复</span><button title="复制最终回复" onClick={() => void navigator.clipboard.writeText(turn.final!.text)}>复制</button></div><LazyMarkdownView text={turn.final.text} /></div>}
    {turn.trailing.map((message) => <MessageCard key={message.id} message={message} sessionId={sessionId} showThinking={showThinking} expandTools={expandTools} />)}
  </article>;
});

function summaryText(turn: UiChatTurn): string {
  const parts: string[] = [];
  if (turn.summary.files) parts.push(`${turn.summary.files} 文件`);
  if (turn.summary.commands) parts.push(`${turn.summary.commands} 命令`);
  const computer = turn.groups.find((group) => group.kind === "computer")?.count ?? 0;
  if (computer) parts.push(`${computer} Computer Use`);
  const other = Math.max(0, turn.summary.tools - turn.summary.files - turn.summary.commands - turn.summary.subagents - computer);
  if (other) parts.push(`${other} 工具`);
  if (turn.summary.subagents) parts.push(`${turn.summary.subagents} 子 Agent`);
  if (turn.summary.failed) parts.push(`${turn.summary.failed} 失败`);
  return parts.join(" · ") || "过程说明";
}
