import { useState } from "react";
import { CheckCircle2, FolderGit2, Trophy, X } from "lucide-react";
import { buildChatTurns, useAppStore } from "../store";
import { useWorkbenchStore } from "../workbench-store";
import { useWorktreeStore } from "../worktree-store";
import type { CompareRunMeta, CompareVariantMeta } from "../workspace-layout";

export interface CompareScoreBarProps {
  compareMeta: CompareRunMeta;
  onFocusVariant(variant: CompareVariantMeta): void;
  onPickWinner(winner: CompareVariantMeta): Promise<void>;
  onDismiss(): void;
  onError(message: string): void;
}

function formatShortDuration(ms?: number): string {
  if (ms === undefined || !Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
}

function formatShortTokens(tokens?: number): string {
  if (tokens === undefined || !Number.isFinite(tokens)) return "—";
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}K` : String(tokens);
}

export function CompareScoreBar({
  compareMeta,
  onFocusVariant,
  onPickWinner,
  onDismiss,
  onError,
}: CompareScoreBarProps): React.JSX.Element {
  const [settlingId, setSettlingId] = useState("");
  const views = useAppStore((s) => s.views);
  const sessions = useAppStore((s) => s.sessions);

  const handleChooseWinner = async (variant: CompareVariantMeta): Promise<void> => {
    if (settlingId) return;
    setSettlingId(variant.sessionId);
    try {
      await onPickWinner(variant);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSettlingId("");
    }
  };

  const openWorktreeApply = (worktreeId: string): void => {
    useWorktreeStore.getState().setSelected(worktreeId);
    useWorkbenchStore.getState().setActiveView("worktrees");
  };

  return (
    <section className="compare-score-bar" aria-label="A/B 对比评分与采纳栏">
      <div className="compare-score-head">
        <span className="ui-badge ui-badge-accent">A/B 对比</span>
        <span className="compare-score-prompt" title={compareMeta.prompt}>
          {compareMeta.prompt}
        </span>
        <button
          type="button"
          className="ui-icon-btn ui-icon-btn-sm"
          aria-label="关闭对比评分栏"
          title="关闭对比评分栏（保留当前窗格）"
          onClick={onDismiss}
        >
          <X size={13} />
        </button>
      </div>

      <div className="compare-score-cards">
        {compareMeta.variants.map((variant) => {
          const view = views[variant.sessionId];
          const summary = sessions.find((item) => item.id === variant.sessionId);
          const status = view?.status || summary?.status || "idle";
          const turns = view ? buildChatTurns(view.messages, view.status, view.turnPresentations) : [];
          const lastPresentation = turns.at(-1)?.presentation;
          const totalAdd = turns.reduce((acc, t) => acc + t.summary.additions, 0);
          const totalDel = turns.reduce((acc, t) => acc + t.summary.deletions, 0);
          const totalFiles = turns.reduce((acc, t) => acc + t.summary.files, 0);
          const tokens = lastPresentation?.usage?.totalTokens ?? view?.meta.totalTokens;
          const isWinner = compareMeta.winnerSessionId === variant.sessionId;

          return (
            <div
              key={variant.sessionId}
              className={`compare-score-card${isWinner ? " winner" : ""}`}
            >
              <button
                type="button"
                className="compare-score-select"
                onClick={() => onFocusVariant(variant)}
                title={`聚焦到 ${variant.label}`}
              >
                <span className={`status-dot ${status}`} aria-hidden="true" />
                <strong>{variant.label}</strong>
                {variant.modelId && <small>{variant.modelId}</small>}
                {variant.effort && <small>· {variant.effort}</small>}
              </button>

              <div className="compare-score-metrics">
                <span title="耗时">{formatShortDuration(lastPresentation?.durationMs)}</span>
                <span title="Token 用量">{formatShortTokens(tokens)} tok</span>
                <span title="文件变更">
                  {totalFiles} 文件{" "}
                  {(totalAdd > 0 || totalDel > 0) && (
                    <em className="compare-diff-stat">
                      <b>+{totalAdd}</b> <i>−{totalDel}</i>
                    </em>
                  )}
                </span>
              </div>

              <div className="compare-score-actions">
                {variant.worktreeId && (
                  <button
                    type="button"
                    className="ui-btn ui-btn-ghost ui-btn-sm"
                    style={{ height: 22, padding: "0 6px", fontSize: 11 }}
                    title="打开 Worktree 预览并安全合入主分支"
                    onClick={() => openWorktreeApply(variant.worktreeId!)}
                  >
                    <FolderGit2 size={11} />
                    <span>合入</span>
                  </button>
                )}

                {isWinner ? (
                  <span className="ui-badge ui-badge-success" style={{ height: 22 }}>
                    <CheckCircle2 size={11} /> 已采纳
                  </span>
                ) : !compareMeta.winnerSessionId ? (
                  <button
                    type="button"
                    className="ui-btn ui-btn-secondary ui-btn-sm"
                    style={{ height: 22, padding: "0 7px", fontSize: 11 }}
                    disabled={Boolean(settlingId)}
                    title="采纳此方案，停止并自动归档其余对比分支"
                    onClick={() => void handleChooseWinner(variant)}
                  >
                    <Trophy size={11} />
                    <span>采纳</span>
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
