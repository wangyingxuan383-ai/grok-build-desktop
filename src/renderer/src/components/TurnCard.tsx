import { memo, useEffect, useMemo, useState } from "react";
import type { NavigationIntent, TurnFailure, TurnOutcome } from "../../../shared/types";
import type { UiChatTurn, UiMessage } from "../store";
import { LazyMarkdownView } from "./LazyMarkdownView";
import { GeneratedMediaGallery, MessageCard } from "./MessageCard";

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
  useEffect(() => {
    const collapse = (event: Event): void => {
      if ((event as CustomEvent<{ sessionId: string }>).detail?.sessionId !== sessionId || turn.running) return;
      setOpen(false);
      localStorage.setItem(storageKey, "closed");
    };
    window.addEventListener("grok:collapse-processes", collapse);
    return () => window.removeEventListener("grok:collapse-processes", collapse);
  }, [sessionId, storageKey, turn.running]);
  const groups = useMemo(() => turn.groups.map((group) => ({ ...group, items: showThinking ? group.items : collapseHiddenThoughts(group.items) })).filter((group) => group.items.length), [showThinking, turn.groups]);
  const hasActivity = groups.length > 0;
  const mediaResults = turn.trailing.filter((message): message is Extract<UiMessage, { kind: "media" }> => message.kind === "media");
  const nonMediaTrailing = turn.trailing.filter((message) => message.kind !== "media");
  const processTitle = turn.legacySegments && turn.legacySegments > 1
    ? `历史执行记录（${turn.legacySegments} 段）`
    : turn.running ? `正在处理${elapsed ? ` · ${elapsed}` : ""}` : `已处理${elapsed ? ` ${elapsed}` : ""}`;

  return <article className={`chat-turn ${turn.completed ? "completed" : "active"}`}>
    {turn.user && <MessageCard message={turn.user} sessionId={sessionId} navigationRoot={navigationRoot} showThinking={showThinking} expandTools={expandTools} onRetry={onRetry} onNavigate={onNavigate} />}
    {hasActivity && <details className="execution-process" open={open} onToggle={(event) => { const next = event.currentTarget.open; setOpen(next); if (!turn.running) localStorage.setItem(storageKey, next ? "open" : "closed"); }}>
      <summary><span className={`process-dot ${turn.running ? "running" : ""}`} /><strong>{processTitle}</strong><span className="process-summary">{summaryText(turn)}</span></summary>
      <div className="activity-groups">{groups.map((group) => <details key={group.kind} className={`activity-group ${group.failed ? "has-failure" : ""}`} open={turn.running && group.kind === "progress"}>
        <summary><span>{group.kind === "files" ? turn.summary.files ? <>{`修改了 ${turn.summary.files} 个文件`}<FileLineStats additions={turn.summary.additions} deletions={turn.summary.deletions}/></> : "文件读取与搜索" : group.label}</span><span>{group.kind === "files" && turn.summary.files > 0 && onOpenReview && <button type="button" className="review-inline-action" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onOpenReview(); }}>查看改动</button>}{group.kind === "files" && turn.summary.files === 0 && <>{group.count} 项</>}{group.kind !== "files" && <>{group.count} 项{group.failed ? ` · ${group.failed} 失败` : ""}</>}</span></summary>
        <div className="activity-items">{group.items.map((message) => <MessageCard key={message.id} message={message} sessionId={sessionId} navigationRoot={navigationRoot} showThinking={showThinking} expandTools={expandTools} onResolved={onResolved} onDiagnose={onDiagnose} onNavigate={onNavigate} />)}</div>
      </details>)}</div>
    </details>}
    {turn.pending.map((message) => <MessageCard key={message.id} message={message} sessionId={sessionId} navigationRoot={navigationRoot} showThinking={showThinking} expandTools={expandTools} onResolved={onResolved} onDiagnose={onDiagnose} onNavigate={onNavigate} />)}
    {turn.final && <div className="final-answer"><div className="final-answer-toolbar"><span>{turn.running ? "正在生成" : "最终回答"}</span><div><button title="复制最终回答" onClick={() => void navigator.clipboard.writeText(turn.final!.text)}>复制</button>{onFork && <button title="从当前任务末尾创建真实分叉" onClick={onFork}>从这里分叉</button>}</div></div>{turn.running ? <pre className="streaming-answer">{turn.final.text}</pre> : <LazyMarkdownView text={turn.final.text} />}{turn.presentation && <TurnMetrics presentation={turn.presentation}/>}</div>}
    {mediaResults.length > 0 && <GeneratedMediaGallery messages={mediaResults} />}
    {nonMediaTrailing.map((message) => <MessageCard key={message.id} message={message} sessionId={sessionId} navigationRoot={navigationRoot} showThinking={showThinking} expandTools={expandTools} onDiagnose={onDiagnose} onNavigate={onNavigate} />)}
    {/* Never leave timing/token metrics floating without a visible result.
        Partial/failed historical turns explicitly explain why no body exists. */}
    {!turn.final && turn.presentation && <div className={`turn-without-answer ${turn.running ? turn.pending.length ? "waiting" : "running" : turn.presentation.outcome ?? "unknown"}`}>
      <strong>{turn.running
        ? turn.pending.length ? "等待你的操作" : "正在生成回答"
        : turn.presentation.outcome === "cancelled" ? "回答已取消" : turn.presentation.outcome === "failed" ? "回答未完成" : "此回合没有可见回答正文"}</strong>
      <span>{turn.running
        ? turn.pending.length ? "处理当前计划、权限或问题后，此回合会继续。" : "回答尚未结束；正文将在模型返回可见内容时显示。"
        : turn.presentation.outcome === "failed" || turn.presentation.outcome === "cancelled"
          ? "已保留能恢复的过程、错误与用量；若历史正文缺失，应用不会伪造内容。"
          : "正在尝试从本地投影或历史更新流恢复；无法可靠关联的内容会明确标记。"}</span>
      {turn.running ? <footer className="turn-live-status"><span className="process-dot running" />处理进行中 · Token 将在回合结算后更新</footer> : <TurnMetrics presentation={turn.presentation}/>}
    </div>}
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

function FileLineStats({ additions, deletions }: { additions: number; deletions: number }): React.JSX.Element | null {
  if (!additions && !deletions) return null;
  return <span className="file-line-stats" aria-label={`增加 ${additions} 行，删除 ${deletions} 行`}><i>+{additions}</i><b>-{deletions}</b></span>;
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
  if (turn.summary.additions || turn.summary.deletions) parts.push(`+${turn.summary.additions} -${turn.summary.deletions}`);
  if (turn.summary.commands) parts.push(`${turn.summary.commands} 命令`);
  const computer = turn.groups.find((group) => group.kind === "computer")?.count ?? 0;
  if (computer) parts.push(`${computer} Computer Use`);
  const other = Math.max(0, turn.summary.tools - turn.summary.files - turn.summary.commands - turn.summary.subagents - computer);
  if (other) parts.push(`${other} 工具`);
  if (turn.summary.subagents) parts.push(`${turn.summary.subagents} 子 Agent`);
  if (turn.summary.failed) parts.push(`${turn.summary.failed} 失败`);
  return parts.join(" · ") || "过程说明";
}
