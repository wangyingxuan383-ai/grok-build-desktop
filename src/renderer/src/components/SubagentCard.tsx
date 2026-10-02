import { memo, useContext, useState } from "react";
import type { ToolCallState } from "../../../shared/types";
import { SubagentOpenContext, subagentNodeId } from "../subagent-context";
import { UiIcon } from "../ui-icons";
import { Badge, type BadgeTone } from "./ui/Display";
import { Button } from "./ui/Button";
import { LazyMarkdownView } from "./LazyMarkdownView";

interface Facts {
  title: string;
  kind?: string;
  model?: string;
  mode?: string;
  tools?: number;
  turns?: number;
  tokens?: number;
  durationMs?: number;
  result?: string;
}

/**
 * A sub-agent as it appears in the conversation: what was delegated, whether it is still running,
 * what it returned, and a way into its session. It replaces the two raw tool cards (spawn call and
 * lifecycle update) that used to be buried in the folded process list.
 */
export const SubagentCard = memo(function SubagentCard({ tool, sessionId }: { tool: ToolCallState; sessionId: string }): React.JSX.Element {
  const open = useContext(SubagentOpenContext);
  const [expanded, setExpanded] = useState(false);
  const facts = readFacts(tool);
  const settled = tool.status === "completed" && !finishedByEvent(tool);
  const state = cardState(tool, settled);
  const raw = tool.rawInput && typeof tool.rawInput === "object" ? tool.rawInput as Record<string,unknown> : {};
  const identity = text(raw.subagent_id) ?? text(raw.subagentId) ?? text(raw.child_session_id) ?? text(raw.childSessionId);
  const metrics = [
    facts.model,
    facts.tools !== undefined ? `CLI 上报 ${facts.tools} 次工具` : undefined,
    facts.turns !== undefined ? `${facts.turns} 回合` : undefined,
    facts.durationMs !== undefined ? formatDuration(facts.durationMs) : undefined,
    facts.tokens !== undefined ? `${facts.tokens.toLocaleString()} Token` : undefined,
  ].filter(Boolean);
  const body = state.tone === "danger" ? tool.error || facts.result : facts.result;
  const canExpand = Boolean(body && (body.length > 220 || body.includes("\n\n")));
  return (
    <section className={`sa-card ${state.key}`} aria-label={`子 Agent：${facts.title}`}>
      <header>
        <span className="sa-mark" aria-hidden="true"><UiIcon name="bot" size={15} /></span>
        <div className="sa-head">
          <strong title={facts.title}>{facts.title}</strong>
          <div className="sa-badges">
            {facts.kind && <Badge>{facts.kind}</Badge>}
            {facts.mode === "read-only" && <Badge>只读</Badge>}
            <Badge tone={state.tone}>{state.running && <UiIcon name="loader" size={11} className="ui-spin" />}{state.label}</Badge>
          </div>
        </div>
        <div className="sa-actions">
          {open && identity && <Button size="sm" variant="secondary" iconEnd="chevron-right" onClick={() => open(subagentNodeId(sessionId, identity))}>查看会话</Button>}
        </div>
      </header>
      {metrics.length > 0 && <div className="sa-metrics">{metrics.map((value, index) => <span key={index}>{value}</span>)}</div>}
      {body ? (
        <div className={`sa-result${expanded ? " expanded" : ""}`}>
          {expanded ? <LazyMarkdownView text={body} /> : <p>{preview(body)}</p>}
          {canExpand && <button type="button" className="sa-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "收起" : "展开结果"}</button>}
        </div>
      ) : state.running ? <p className="sa-waiting">正在执行委派的任务…</p> : settled ? <p className="sa-waiting">回合已结束，没有收到这个子 Agent 的结果回报；点“查看会话”读取它留下的记录。</p> : null}
    </section>
  );
});

function readFacts(tool: ToolCallState): Facts {
  const raw = tool.rawInput && typeof tool.rawInput === "object" ? tool.rawInput as Record<string, unknown> : {};
  return {
    title: text(raw.description) ?? tool.title ?? "子 Agent",
    kind: text(raw.subagent_type) ?? text(raw.role),
    model: text(raw.model) ?? text(raw.model_id),
    mode: text(raw.capability_mode),
    tools: num(raw.tool_calls ?? raw.tool_call_count),
    turns: num(raw.turns ?? raw.turn_count),
    tokens: num(raw.tokens_used),
    durationMs: num(raw.duration_ms),
    result: text(raw.output) ?? text(raw.summary) ?? text(raw.message),
  };
}

/** The turn ended without the CLI reporting this sub-agent's result (it may still be running in the background). */
function finishedByEvent(tool: ToolCallState): boolean {
  const raw = tool.rawInput && typeof tool.rawInput === "object" ? tool.rawInput as Record<string, unknown> : {};
  return raw.sessionUpdate === "subagent_finished";
}

function cardState(tool: ToolCallState, settled: boolean): { key: string; label: string; tone: BadgeTone; running: boolean } {
  if (settled) return { key: "done", label: "已结束", tone: "neutral", running: false };
  if (tool.status === "failed") return { key: "failed", label: "失败", tone: "danger", running: false };
  if (tool.status === "completed") return { key: "done", label: "已完成", tone: "success", running: false };
  return { key: "running", label: "运行中", tone: "accent", running: true };
}

/** First few non-empty lines, markdown markers stripped, for the collapsed state. */
function preview(value: string): string {
  const lines = value.split(/\r?\n/).map((line) => line.replace(/^[#>*\-\s`]+/, "").trim()).filter(Boolean);
  return lines.slice(0, 3).join(" ");
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} 分${seconds % 60 ? ` ${seconds % 60} 秒` : ""}`;
}

const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;
const num = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
