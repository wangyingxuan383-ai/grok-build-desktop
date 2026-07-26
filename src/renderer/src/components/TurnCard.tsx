import { memo, useEffect, useMemo, useState } from "react";
import type { NavigationIntent, TurnFailure, TurnOutcome } from "../../../shared/types";
import type { UiChatTurn, UiMessage } from "../store";
import { LazyMarkdownView } from "./LazyMarkdownView";
import { MessageCard } from "./MessageCard";

export const TurnCard = memo(function TurnCard({ turn, sessionId, navigationRoot, showThinking, expandTools, onResolved, onDiagnose, onRetry, onNavigate, onOpenReview, onFork }: {
  turn: UiChatTurn;
  sessionId: string;
  navigationRoot?: string;
  showThinking: boolean;
  expandTools: boolean;
  onResolved(id: string): void;
  onDiagnose?(failure: TurnFailure): void;
  onRetry(message: Extract<UiMessage, { kind: "user" }>): void;
  onNavigate?(intent: NavigationIntent): void;
  onOpenReview?(): void;
  onFork?(): void;
}): React.JSX.Element {
  const storageKey = `grok:turn-process:${sessionId}:${turn.presentation?.turnId || turn.id}`;
  const [open, setOpen] = useState(() => turn.running || localStorage.getItem(storageKey) === "open");
  const elapsed = useElapsed(turn.presentation?.startedAt, turn.presentation?.durationMs, turn.running);
  useEffect(() => {
    if (turn.running) setOpen(true);
    else if (turn.completed && localStorage.getItem(storageKey) == null) setOpen(false);
  }, [storageKey, turn.completed, turn.running]);
  const groups = useMemo(() => turn.groups.map((group) => ({ ...group, items: showThinking ? group.items : collapseHiddenThoughts(group.items) })).filter((group) => group.items.length), [showThinking, turn.groups]);
  const hasActivity = groups.length > 0;
  const processTitle = turn.legacySegments && turn.legacySegments > 1
    ? `历史执行记录（${turn.legacySegments} 段）`
    : turn.running ? `正在处理${elapsed ? ` · ${elapsed}` : ""}` : `已处理${elapsed ? ` ${elapsed}` : ""}`;

  return <article className={`chat-turn ${turn.completed ? "completed" : "active"}`}>
    {turn.user && <MessageCard message={turn.user} sessionId={sessionId} navigationRoot={navigationRoot} showThinking={showThinking} expandTools={expandTools} onRetry={onRetry} onNavigate={onNavigate} />}
    {hasActivity && <details className="execution-process" open={open} onToggle={(event) => { const next = event.currentTarget.open; setOpen(next); if (!turn.running) localStorage.setItem(storageKey, next ? "open" : "closed"); }}>
      <summary><span className={`process-dot ${turn.running ? "running" : ""}`} /><strong>{processTitle}</strong><span className="process-summary">{summaryText(turn)}</span></summary>
      <div className="activity-groups">{groups.map((group) => <details key={group.kind} className={`activity-group ${group.failed ? "has-failure" : ""}`} open={turn.running && group.kind === "progress"}>
        <summary><span>{group.kind === "files" ? `修改了 ${turn.summary.files} 个文件` : group.label}</span><span>{group.kind === "files" && onOpenReview && <button type="button" className="review-inline-action" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onOpenReview(); }}>在 Review 中查看</button>}{group.kind !== "files" && <>{group.count} 项{group.failed ? ` · ${group.failed} 失败` : ""}</>}</span></summary>
        <div className="activity-items">{group.items.map((message) => <MessageCard key={message.id} message={message} sessionId={sessionId} navigationRoot={navigationRoot} showThinking={showThinking} expandTools={expandTools} onResolved={onResolved} onDiagnose={onDiagnose} onNavigate={onNavigate} />)}</div>
      </details>)}</div>
    </details>}
    {turn.pending.map((message) => <MessageCard key={message.id} message={message} sessionId={sessionId} navigationRoot={navigationRoot} showThinking={showThinking} expandTools={expandTools} onResolved={onResolved} onDiagnose={onDiagnose} onNavigate={onNavigate} />)}
    {turn.final && <div className="final-answer"><div className="final-answer-toolbar"><span>最终回答</span><div><button title="复制最终回答" onClick={() => void navigator.clipboard.writeText(turn.final!.text)}>复制</button>{onFork && <button title="从当前任务末尾创建真实分叉" onClick={onFork}>从这里分叉</button>}</div></div><LazyMarkdownView text={turn.final.text} />{turn.presentation && <TurnMetrics presentation={turn.presentation}/>}</div>}
    {turn.trailing.map((message) => <MessageCard key={message.id} message={message} sessionId={sessionId} navigationRoot={navigationRoot} showThinking={showThinking} expandTools={expandTools} onDiagnose={onDiagnose} onNavigate={onNavigate} />)}
    {/* A turn that failed or was cancelled has no final answer, and those are
        exactly the turns where the time and tokens already spent matter most. */}
    {!turn.final && turn.presentation && <TurnMetrics presentation={turn.presentation}/>}
  </article>;
});

function TurnMetrics({ presentation }: { presentation: NonNullable<UiChatTurn["presentation"]> }): React.JSX.Element {
  const usage = presentation.usage;
  const parts: string[] = [];
  if (usage?.inputTokens !== undefined) parts.push(`输入 ${formatTokenCount(usage.inputTokens)}`);
  if (usage?.outputTokens !== undefined) parts.push(`输出 ${formatTokenCount(usage.outputTokens)}`);
  if (usage?.cachedReadTokens !== undefined) parts.push(`缓存 ${formatTokenCount(usage.cachedReadTokens)}`);
  if (usage?.reasoningTokens !== undefined) parts.push(`推理 ${formatTokenCount(usage.reasoningTokens)}`);
  if (!parts.length && usage?.totalTokens !== undefined) parts.push(`总计 ${formatTokenCount(usage.totalTokens)}（明细不可用）`);
  const duration = presentation.durationMs === undefined ? "历史耗时未知" : `处理 ${formatDuration(presentation.durationMs)}`;
  const outcome = outcomeLabel(presentation.outcome);
  return <footer className={`turn-metrics ${presentation.outcome && presentation.outcome !== "completed" ? presentation.outcome : ""}`}>
    {outcome && <span className="turn-outcome">{outcome}</span>}
    <span>{duration}</span>
    {parts.length > 0 && <span>{parts.join(" · ")}</span>}
    {!parts.length && <span>本回合未返回 Token 用量</span>}
    {usage?.modelId && <span>{usage.modelId}</span>}
  </footer>;
}

/** Only non-completed outcomes are labelled; a normal turn needs no badge. */
function outcomeLabel(outcome?: TurnOutcome): string {
  return outcome === "failed" ? "已失败" : outcome === "cancelled" ? "已取消" : "";
}

function collapseHiddenThoughts(items: UiMessage[]): UiMessage[] {
  const nonThoughts = items.filter((message) => message.kind !== "thought");
  const thoughts = items.filter((message) => message.kind === "thought");
  if (!thoughts.length) return items;
  return [{ id: `thought-summary-${thoughts[0]!.id}`, kind: "thought", text: "" }, ...nonThoughts];
}

function useElapsed(startedAt: string | undefined, durationMs: number | undefined, running: boolean): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running || !startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running, startedAt]);
  const measured = durationMs ?? (running && startedAt ? Math.max(0, now - Date.parse(startedAt)) : undefined);
  return measured === undefined ? "" : formatDuration(measured);
}

function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}分${remainder ? `${remainder}秒` : ""}`;
}

function formatTokenCount(value: number): string {
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)}M` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}K` : String(value);
}

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
