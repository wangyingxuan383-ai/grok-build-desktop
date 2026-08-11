import { lazy, Suspense } from "react";
import type { CliRuntimeUpdate, NavigationIntent, PromptQueueEntry } from "../../../shared/types";
import type { ReviewCommentDraft } from "../review-comments";
import { sessionScopedPaneKey } from "../session-ui-guards";
import type { UiChatTurn } from "../store";
import type { RightTool } from "./RightUtilityPane";

const AgentChangePane = lazy(() => import("./AgentChangePane").then((module) => ({ default: module.AgentChangePane })));
const ReviewPane = lazy(() => import("./ReviewPane").then((module) => ({ default: module.ReviewPane })));
const RightUtilityPane = lazy(() => import("./RightUtilityPane").then((module) => ({ default: module.RightUtilityPane })));

/**
 * The right dock is a session-scoped surface. Keeping its routing outside the
 * app shell prevents a background conversation from reusing the foreground
 * Review, queue, or result props during a rapid session switch.
 */
export function RightDock({ tool, active, sessionId, cwd, lastTurnPaths, reviewInitialScope, turn, queue, runtimeUpdates, sessionStatus, onTool, onClose, onNavigate, onAddComment, onExpandResult, onError }: {
  tool: RightTool | null;
  active: boolean;
  sessionId: string;
  cwd: string;
  lastTurnPaths: string[];
  reviewInitialScope: "unstaged" | "last-turn";
  turn?: UiChatTurn;
  queue: PromptQueueEntry[];
  runtimeUpdates: CliRuntimeUpdate[];
  sessionStatus?: string;
  onTool(tool: RightTool): void;
  onClose(): void;
  onNavigate(intent: NavigationIntent): void;
  onAddComment(comment: ReviewCommentDraft): void;
  onExpandResult(): void;
  onError(message: string): void;
}): React.JSX.Element | null {
  if (!tool || !active) return null;
  const paneKey = sessionScopedPaneKey(sessionId, cwd, tool);
  return <Suspense fallback={<aside className="right-utility-pane workbench-loading" role="status"><div className="spinner"/><span>正在加载侧栏…</span></aside>}>
    {tool === "agent-changes" ? <AgentChangePane key={paneKey} sessionId={sessionId} onClose={onClose} onNavigate={onNavigate} onError={onError}/>
      : tool === "review" ? <ReviewPane key={paneKey} cwd={cwd} sessionId={sessionId} lastTurnPaths={lastTurnPaths} initialKind={reviewInitialScope} onClose={onClose} onNavigate={onNavigate} onAddComment={onAddComment} onError={onError}/>
        : <RightUtilityPane key={paneKey} tool={tool} turn={turn} cwd={cwd} sessionId={sessionId} paths={lastTurnPaths} queue={queue} runtimeUpdates={runtimeUpdates} sessionStatus={sessionStatus} onTool={onTool} onClose={onClose} onNavigate={onNavigate} onExpandResult={onExpandResult} onError={onError}/>}
  </Suspense>;
}
