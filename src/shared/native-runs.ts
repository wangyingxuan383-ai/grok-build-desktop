export type NativeRunKind = "goal" | "workflow";
export type NativeRunAction = "pause" | "resume" | "stop";
export type NativeRunStatus = "running" | "paused" | "blocked" | "completed" | "stopped" | "failed" | "budget-limited" | "unknown";
export interface NativeRunWire {
  id: string; kind: NativeRunKind; title: string; status: NativeRunStatus;
  nativeStatus: string; nativeRevision?: number; phase?: string; reason?: string;
  budget?: { unit: "tokens" | "agents"; limit?: number; used?: number };
}
export interface NativeRunSnapshot extends NativeRunWire {
  sessionId: string; revision: string; observedAt: string; stale: boolean;
  actions: NativeRunAction[]; unavailableReason?: string;
}
export interface NativeRunControlInput {
  sessionId: string; kind: NativeRunKind; runId: string; revision: string;
  action: NativeRunAction; operationId: string;
}
export interface NativeRunControlReceipt {
  operationId: string; state: "completed" | "failed" | "unknown"; message: string;
}
export const nativeRunStatusLabels: Record<NativeRunStatus, string> = {
  running: "执行中", paused: "已暂停", blocked: "需处理", completed: "已完成", stopped: "已结束", failed: "失败", "budget-limited": "预算已用完", unknown: "状态未知",
};
export const nativeRunActionLabels: Record<NativeRunAction, string> = { pause: "暂停", resume: "恢复", stop: "结束" };
export const activeNativeRuns = (rows: NativeRunSnapshot[]): NativeRunSnapshot[] => rows.filter(row => !["completed", "stopped"].includes(row.status));
export const nativeRunPhaseLabel = (phase: string): string => ({ planning:"规划", plan:"规划", executing:"执行", verifying:"验证", idle:"空闲" }[phase.toLowerCase()] ?? phase);
export const nativeRunKey = (row: Pick<NativeRunSnapshot, "sessionId" | "kind" | "id">): string => `${row.sessionId}:${row.kind}:${row.id}`;
export const nativeRunIdValid = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(id);
const text = (value: unknown, max: number): string | undefined => typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, max) || undefined : undefined;
const count = (value: unknown): number | undefined => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

/** Whitelist only display/control fields, never retain raw tool inputs or config. */
export function normalizeNativeRunWire(kind: NativeRunKind, raw: Record<string, unknown>, previousGoalId?: string): NativeRunWire | undefined {
  const nativeStatus = text(raw.status, 64) ?? "unknown";
  const id = kind === "goal" && nativeStatus === "cleared" ? previousGoalId : kind === "goal" ? raw.goal_id : raw.run_id;
  if (!nativeRunIdValid(id)) return undefined;
  const status: NativeRunStatus = nativeStatus === "active" || nativeStatus === "running" ? "running"
    : /^(user_paused|back_off_paused|no_progress_paused|infra_paused|paused)$/.test(nativeStatus) ? "paused"
      : nativeStatus === "complete" || nativeStatus === "completed" ? "completed"
        : nativeStatus === "cleared" || nativeStatus === "cancelled" || nativeStatus === "stopped" ? "stopped"
          : nativeStatus === "budget_limited" ? "budget-limited" : nativeStatus === "blocked" ? "blocked"
            : nativeStatus === "failed" || nativeStatus === "interrupted" ? "failed" : "unknown";
  const limit = count(kind === "goal" ? raw.token_budget : raw.agent_budget);
  const used = count(kind === "goal" ? raw.tokens_used : raw.agents_used);
  return { id, kind, title: text(raw.objective, 240) ?? text(raw.name, 240) ?? (kind === "goal" ? "原生目标" : "原生工作流"), status, nativeStatus,
    nativeRevision: count(raw.revision), phase: text(raw.phase ?? raw.current_phase, 160), reason: text(raw.pause_message ?? raw.last_event_detail, 800),
    ...(limit !== undefined || used !== undefined ? { budget: { unit: kind === "goal" ? "tokens" : "agents", limit, used } } : {}),
  };
}

export function nativeRunStopDescription(kind: NativeRunKind): string {
  return kind === "goal" ? "停止当前目标的执行并清除目标，之后不能恢复此目标。会话和已有产出保留。" : "停止这一项原生工作流，保留会话和已有产出。";
}
