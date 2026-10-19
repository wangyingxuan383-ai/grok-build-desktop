import { memo } from "react";
import type { TurnPresentation } from "../../../shared/types";
import { useGitStore } from "../git-store";
import "../styles/session-status-strip.css";

/** The existing composer owns model selection and the context ring. No reads or timers here. */
export const SessionStatusStrip = memo(function SessionStatusStrip({ turn, workspace }: { turn?: TurnPresentation; workspace: string }): React.JSX.Element | null {
  const git = useGitStore(state => sameWorkspace(state.workspace, workspace) ? state.status : undefined);
  const parts = reportedTurnStatus(turn);
  if (git?.branch?.name) parts.push({ label: git.branch.name, title: `Git 分支 · ${git.clean ? "工作区干净" : `${git.changes.length} 个变更`}` });
  if (!parts.length) return null;
  return <div className="session-status-strip" aria-label="会话状态">{parts.map((part, index) => <span key={index} title={part.title}>{part.label}</span>)}</div>;
});

export function reportedTurnStatus(turn?: TurnPresentation): Array<{ label: string; title: string }> {
  if (!turn || turn.origin === "native-control") return [];
  const parts: Array<{ label: string; title: string }> = [];
  if (turn.durationMs !== undefined && Number.isFinite(turn.durationMs) && turn.durationMs >= 0) {
    parts.push({ label: `${(turn.durationMs / 1000).toFixed(1)}s`, title: "最近回合上报耗时" });
  }
  const usage = turn.usage;
  if (usage?.totalTokens !== undefined && Number.isFinite(usage.totalTokens) && usage.totalTokens >= 0) {
    parts.push({ label: `${usage.totalTokens.toLocaleString()} Token${usage.usageIsIncomplete ? " · 部分" : ""}`, title: "最近回合上报用量，与当前上下文占用分别统计" });
  } else if (usage) {
    for (const [key, name] of [["inputTokens", "输入"], ["outputTokens", "输出"]] as const) {
      const value = usage[key];
      if (value !== undefined && Number.isFinite(value) && value >= 0) parts.push({ label: `${name} ${value.toLocaleString()}`, title: "最近回合上报 Token，未推算总量" });
    }
  }
  return parts;
}

function sameWorkspace(left: string, right: string): boolean {
  return !!left && !!right && left.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() === right.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
