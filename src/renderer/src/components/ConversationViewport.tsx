import { memo, useMemo, useState, type RefObject } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { Attachment, NavigationIntent, TurnFailure } from "../../../shared/types";
import type { UiChatTurn, UiMessage } from "../store";
import { TurnCard } from "./TurnCard";

interface ConversationViewportProps {
  turns: UiChatTurn[];
  sessionId: string;
  navigationRoot: string;
  showThinking: boolean;
  expandTools: boolean;
  matchIndex?: number;
  atBottom: boolean;
  virtuosoRef: RefObject<VirtuosoHandle | null>;
  onAtBottom(value: boolean): void;
  shouldFollow(isAtBottom: boolean): boolean;
  onWheelUp(): void;
  onScrollBottom(): void;
  onNavigate(intent: NavigationIntent): void;
  onOpenReview(): void;
  onFork(index: number): void;
  onResolved(id: string): void;
  onDiagnose(failure: TurnFailure): void;
  onRetry(message: Extract<UiMessage, { kind: "user" }>, attachments: Attachment[]): void;
}

/**
 * Session-scoped virtualized conversation surface. Keeping this component
 * outside App Shell prevents background workspace/dialog changes from
 * rebuilding every visible message card.
 */
export const ConversationViewport = memo(function ConversationViewport(props: ConversationViewportProps): React.JSX.Element {
  const [visibleTurn, setVisibleTurn] = useState(0);
  const markers = useMemo(() => buildTurnNavigationMarkers(props.turns), [props.turns]);
  return <div className="conversation-wrap" onWheelCapture={(event) => { if (event.deltaY < 0) props.onWheelUp(); }}>
    <Virtuoso
      ref={props.virtuosoRef}
      className="conversation"
      data={props.turns}
      computeItemKey={(_index, turn) => turn.id}
      followOutput={(isAtBottom) => props.shouldFollow(isAtBottom) ? "auto" : false}
      atBottomStateChange={props.onAtBottom}
      rangeChanged={(range) => setVisibleTurn(range.startIndex)}
      itemContent={(index, turn) => <div className={props.matchIndex === index ? "conversation-match-active" : ""}>
        <TurnCard
          turn={turn}
          sessionId={props.sessionId}
          navigationRoot={props.navigationRoot}
          showThinking={props.showThinking}
          expandTools={props.expandTools}
          onNavigate={props.onNavigate}
          onOpenReview={props.onOpenReview}
          onFork={index === props.turns.length - 1 ? () => props.onFork(index) : undefined}
          onResolved={props.onResolved}
          onDiagnose={props.onDiagnose}
          onRetry={(message) => props.onRetry(message, (message.attachments ?? []).filter((attachment) => attachment.availability === "ready" && Boolean(attachment.source)).map((attachment) => ({ id: attachment.id, name: attachment.name, kind: attachment.kind, mimeType: attachment.mimeType, size: attachment.size, ...(attachment.isData ? { data: attachment.source } : { path: attachment.source }) })))}
        />
      </div>}
    />
    {markers.length > 1 && <nav className="turn-navigation-rail" aria-label="回合导航">
      <header><span>{visibleTurn + 1}/{props.turns.length}</span><button title="折叠全部已完成过程" aria-label="折叠全部已完成过程" onClick={() => window.dispatchEvent(new CustomEvent("grok:collapse-processes", { detail: { sessionId: props.sessionId } }))}>−</button></header>
      <div>{markers.map((marker) => <button key={marker.id} data-turn-index={marker.index} className={`${marker.kind} ${marker.index === visibleTurn ? "active" : ""}`} title={marker.title} aria-label={marker.title} onClick={() => props.virtuosoRef.current?.scrollToIndex({ index: marker.index, align: "start", behavior: "smooth" })}><i>{markerGlyph(marker.kind)}</i></button>)}</div>
    </nav>}
    {!props.atBottom && !!props.turns.length && <button className="scroll-to-bottom" onClick={props.onScrollBottom}>↓ 回到底部</button>}
  </div>;
});

export type TurnNavigationKind = "request" | "plan" | "permission" | "error" | "answer" | "process";

export interface TurnNavigationMarker {
  id: string;
  index: number;
  kind: TurnNavigationKind;
  title: string;
}

/** Preserve the reader's anchor unless they are already at the tail or have
 * explicitly requested follow mode (send/current-turn/bottom button). */
export function shouldFollowConversation(isAtBottom: boolean, forced: boolean): boolean {
  return isAtBottom || forced;
}

export function buildTurnNavigationMarkers(turns: UiChatTurn[]): TurnNavigationMarker[] {
  return turns.map((turn, index) => {
    const pendingKinds = turn.pending.map((message) => message.kind);
    const hasError = turn.trailing.some((message) => message.kind === "error");
    const kind: TurnNavigationKind = hasError ? "error"
      : pendingKinds.includes("permission") || pendingKinds.includes("question") ? "permission"
        : pendingKinds.includes("plan") || turn.groups.some((group) => group.items.some((item) => item.kind === "plan")) ? "plan"
          : turn.final ? "answer" : turn.user ? "request" : "process";
    const request = turn.user?.text.trim().replace(/\s+/g, " ").slice(0, 64);
    const title = `${index + 1}. ${kindLabel(kind)}${request ? `：${request}` : ""}`;
    return { id: turn.id, index, kind, title };
  });
}

function kindLabel(kind: TurnNavigationKind): string {
  return ({ request: "用户请求", plan: "计划", permission: "等待操作", error: "错误", answer: "最终回答", process: "执行过程" })[kind];
}

function markerGlyph(kind: TurnNavigationKind): string {
  return ({ request: "↑", plan: "◇", permission: "!", error: "×", answer: "✓", process: "·" })[kind];
}
