import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SubagentConversationSnapshot } from "../../../shared/types";
import { buildChatTurns, reduceEvent, useAppStore } from "../store";
import { readonlyMessage } from "../readonly-message";
import { statusText } from "../agent-status";
import { UiIcon } from "../ui-icons";
import { Badge, type BadgeTone } from "./ui/Display";
import { Button, IconButton } from "./ui/Button";
import { TurnCard } from "./TurnCard";
import "../styles/subagent.css";

const POLL_MS = 2500;

/**
 * A sub-agent's session, laid out like any other conversation: the delegated task as the user's
 * message, the sub-agent's work and answer as the turn. It is read-only and never resumes anything.
 * `pane` renders inside the right-hand frame; `page` fills the content area.
 */
export function SubagentConversation({ nodeId, variant = "page", onParent, onClose }: {
  nodeId: string;
  variant?: "pane" | "page";
  onParent?(sessionId: string): void;
  onClose?(): void;
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<SubagentConversationSnapshot>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [stopping, setStopping] = useState(false);
  const setAppError = useAppStore((state) => state.setError);
  // Tracks which child the current snapshot belongs to, so a poll of the same child keeps the text
  // on screen instead of blanking it, and a late reply for a previous child is discarded.
  const shownNode = useRef<string | undefined>(undefined);

  const running = snapshot?.status === "running" || snapshot?.status === "queued" || snapshot?.status === "waiting";
  useEffect(() => {
    let cancelled = false;
    const changedNode = shownNode.current !== nodeId;
    if (changedNode) { setSnapshot(undefined); setError(""); shownNode.current = nodeId; }
    void window.grokDesktop.getSubagentConversation(nodeId)
      .then((value) => { if (!cancelled && shownNode.current === nodeId) { setSnapshot(value); setError(""); } })
      // A failed refresh keeps the last good text and explains itself; polling continues, so a
      // transient read error no longer leaves the pane frozen on a stale view.
      .catch((reason: unknown) => { if (!cancelled && shownNode.current === nodeId) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { cancelled = true; };
  }, [nodeId, revision]);
  // Only a running child changes on disk; poll for its result, stop once it has settled.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setRevision((value) => value + 1), POLL_MS);
    return () => window.clearInterval(timer);
  }, [running]);

  const turns = useMemo(() => {
    const projection = snapshot?.projection;
    if (!projection) return [];
    // Local projection only: no writes to the shared active-session store, no runtime requests.
    const stableProjection = { ...projection, events: projection.events.map((event, index) => event.type === "user-message" && !event.id && !event.clientMessageId ? { ...event, id: `${projection.sessionId}:readonly-user:${index}` } : event) };
    const view = reduceEvent({ ...useAppStore.getState(), views: {} }, { type: "conversation-projection-restore", sessionId: projection.sessionId, projection: stableProjection }).views?.[projection.sessionId];
    const messages = view?.messages.map((message) => readonlyMessage(message, "父会话")) ?? [];
    return buildChatTurns(messages, running ? "working" : "idle");
  }, [snapshot, running]);

  const stop = useCallback(async () => {
    setStopping(true);
    try { await window.grokDesktop.stopAgentDashboardNode(nodeId); setRevision((value) => value + 1); }
    catch (reason) { setAppError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setStopping(false); }
  }, [nodeId, setAppError]);

  const details = snapshot?.details;
  const facts = [
    details?.type,
    details?.model,
    details?.toolCalls !== undefined ? `${details.toolCalls} 次工具` : undefined,
    details?.turns !== undefined ? `${details.turns} 回合` : undefined,
    details?.durationMs !== undefined ? formatDuration(details.durationMs) : undefined,
  ].filter(Boolean);

  return (
    <section className={`subagent-conversation sa-session ${variant}`} aria-label="子 Agent 会话">
      <header className="sa-session-head">
        {onParent && snapshot && <IconButton icon="chevron-left" label="返回父会话" size="sm" onClick={() => onParent(snapshot.parentSessionId)} />}
        <div className="sa-session-title">
          <strong title={snapshot?.title}>{snapshot?.title || "子 Agent"}</strong>
          <span>子 Agent 会话 · 只读</span>
        </div>
        {snapshot && <Badge tone={statusTone(snapshot.status)}>{running && <UiIcon name="loader" size={11} className="ui-spin" />}{statusText(snapshot.status)}</Badge>}
        <div className="sa-session-tools">
          {running && <Button size="sm" variant="danger" loading={stopping} onClick={() => void stop()}>停止</Button>}
          <IconButton icon="refresh" label="刷新" size="sm" onClick={() => setRevision((value) => value + 1)} />
          {onClose && <IconButton icon="close" label="关闭子会话" size="sm" onClick={onClose} />}
        </div>
      </header>
      {facts.length > 0 && <div className="sa-session-facts">{facts.map((value, index) => <span key={index}>{value}</span>)}</div>}
      <div className="sa-session-body">
        {!snapshot && error ? <p role="alert" className="sa-session-note danger">{error}</p>
          : !snapshot ? <p role="status" className="sa-session-note">正在读取子会话…</p>
          : <>
            {error && <p role="alert" className="sa-session-note danger">{error}</p>}
            {snapshot.notice && <p className="sa-session-note">{snapshot.notice}</p>}
            {turns.length
              ? turns.map((turn) => <TurnCard key={turn.id} turn={turn} sessionId={snapshot.childSessionId ?? snapshot.nodeId} showThinking expandTools={false} onResolved={() => undefined} onRetry={() => undefined} />)
              : <p className="sa-session-note">{snapshot.summary || "暂无可展示的子会话正文。"}</p>}
          </>}
      </div>
      <footer className="sa-session-foot">这是主 Agent 委派出去的独立任务，此处只读；要调整方向，请在主会话里告诉主 Agent。</footer>
    </section>
  );
}

function statusTone(status: SubagentConversationSnapshot["status"]): BadgeTone {
  return status === "completed" ? "success" : status === "failed" ? "danger" : status === "running" || status === "queued" ? "accent" : status === "waiting" ? "warning" : "neutral";
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} 分${seconds % 60 ? ` ${seconds % 60} 秒` : ""}`;
}
