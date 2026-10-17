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
export interface NativeRunDismissInput { sessionId: string; kind: NativeRunKind; runId: string }
export const nativeRunStatusLabels: Record<NativeRunStatus, string> = {
  running: "执行中", paused: "已暂停", blocked: "需处理", completed: "已完成", stopped: "已结束", failed: "失败", "budget-limited": "预算已用完", unknown: "状态未知",
};
export const nativeRunKindLabels: Record<NativeRunKind, string> = { goal: "目标", workflow: "工作流" };
export const nativeRunActionLabels: Record<NativeRunAction, string> = { pause: "暂停", resume: "恢复", stop: "结束" };
export const activeNativeRuns = (rows: NativeRunSnapshot[]): NativeRunSnapshot[] => rows.filter(row => !["completed", "stopped"].includes(row.status));
/** Only live, confirmed execution counts as running; restored summaries are last-known state. */
export const nativeRunIsRunning = (row: NativeRunSnapshot): boolean => row.status === "running" && !row.stale;
export const nativeRunNeedsAttention = (row: NativeRunSnapshot): boolean => ["blocked", "budget-limited", "failed"].includes(row.status);
/** Live running/paused rows reflect real work; only finished or restored summaries can be removed locally. */
export const nativeRunDismissible = (row: Pick<NativeRunSnapshot, "status" | "stale">): boolean => row.stale || ["completed", "stopped", "failed", "budget-limited", "unknown"].includes(row.status);
export type NativeRunTone = "running" | "paused" | "attention" | "failed" | "stale";
export const nativeRunTone = (row: NativeRunSnapshot): NativeRunTone => row.stale ? "stale" : row.status === "running" ? "running" : row.status === "failed" ? "failed" : nativeRunNeedsAttention(row) ? "attention" : "paused";
export const nativeRunStatusText = (row: NativeRunSnapshot): string => row.stale ? `上次记录 · ${nativeRunStatusLabels[row.status]}` : nativeRunStatusLabels[row.status];
export type NativeRunFilter = "progress" | "attention" | "all";
export const nativeRunMatchesFilter = (row: NativeRunSnapshot, filter: NativeRunFilter): boolean =>
  filter === "all" || (filter === "attention" ? nativeRunNeedsAttention(row) : !nativeRunNeedsAttention(row) && row.status !== "unknown");
export const nativeRunShortId = (id: string): string => `#${id.slice(-4)}`;
/** Keys of rows whose title repeats inside one session; only those need a visible short ID. */
export function nativeRunDuplicateKeys(rows: NativeRunSnapshot[]): Set<string> {
  const seen = new Map<string, number>();
  for (const row of rows) seen.set(`${row.sessionId}\u0000${row.title}`, (seen.get(`${row.sessionId}\u0000${row.title}`) ?? 0) + 1);
  return new Set(rows.filter(row => (seen.get(`${row.sessionId}\u0000${row.title}`) ?? 0) > 1).map(nativeRunKey));
}
export const compactCount = (value: number): string => value >= 1_000_000 ? `${+(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${+(value / 1_000).toFixed(1)}K` : String(value);
export function nativeRunBudgetText(budget: NonNullable<NativeRunWire["budget"]>): string {
  const unit = budget.unit === "tokens" ? "Token" : "Agent", format = budget.unit === "tokens" ? compactCount : String;
  const used = budget.used === undefined ? "未上报" : format(budget.used);
  return budget.limit === undefined ? `${unit} ${used} · 上限未上报` : `${unit} ${used} / ${format(budget.limit)}`;
}
export const nativeRunBudgetRatio = (budget?: NativeRunWire["budget"]): number | undefined =>
  budget?.limit && budget.used !== undefined ? Math.min(1, budget.used / budget.limit) : undefined;
export function nativeRunUpdatedLabel(observedAt: string, now = Date.now()): string {
  const time = Date.parse(observedAt);
  if (!Number.isFinite(time)) return "";
  const delta = Math.max(0, now - time);
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  const date = new Date(time);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
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
  return { id, kind, title: text(raw.objective, 240) ?? text(raw.name, 240) ?? (kind === "goal" ? "未命名目标" : "未命名工作流"), status, nativeStatus,
    nativeRevision: count(raw.revision), phase: text(raw.phase ?? raw.current_phase, 160), reason: text(raw.pause_message ?? raw.last_event_detail, 800),
    ...(limit !== undefined || used !== undefined ? { budget: { unit: kind === "goal" ? "tokens" : "agents", limit, used } } : {}),
  };
}

export function nativeRunStopDescription(kind: NativeRunKind): string {
  return kind === "goal" ? "停止当前目标的执行并清除目标，之后不能恢复此目标。会话和已有产出保留。" : "停止这一项工作流，保留会话和已有产出。";
}
