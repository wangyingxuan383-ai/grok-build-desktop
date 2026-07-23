import { join } from "node:path";
import type {
  AgentDashboardNode,
  AgentDashboardQuery,
  AgentDashboardSnapshot,
  BackgroundTaskSummary,
  ChatEvent,
  CliCapabilityState,
  ReasoningEffort,
  SessionExecutionAssignment,
  SessionSummary,
} from "../../shared/types";
import { JsonStore } from "./json-store";

interface DashboardRecord extends Omit<AgentDashboardNode, "children" | "live"> {
  toolIds?: string[];
}

interface DashboardState {
  records: Record<string, DashboardRecord>;
}

export interface DashboardLiveSession {
  sessionId: string;
  cwd: string;
  modelId?: string;
  effort?: ReasoningEffort;
}

export interface DashboardSnapshotInput {
  query: AgentDashboardQuery;
  sessions: SessionSummary[];
  liveSessions: DashboardLiveSession[];
  tasks: BackgroundTaskSummary[];
  assignments: SessionExecutionAssignment[];
  liveCapability: CliCapabilityState;
}

/** UI-only lifecycle projection. It never starts or connects to the Grok TUI Dashboard. */
export class AgentDashboardService {
  private readonly store: JsonStore<DashboardState>;

  constructor(userDataPath: string) {
    this.store = new JsonStore(join(userDataPath, "agent-dashboard.json"), { records: {} });
  }

  async record(event: ChatEvent): Promise<void> {
    if (!event.sessionId) return;
    if (!["status", "tool-call", "turn-completed", "permission", "question", "error", "subagent", "meta"].includes(event.type)) return;
    const state = await this.store.get();
    const now = new Date().toISOString();
    const rootId = rootNodeId(event.sessionId);
    const root = state.records[rootId] ?? createRecord(rootId, event.sessionId, "主会话", now);

    if (event.type === "status") {
      root.status = event.status === "working" ? "running" : event.status === "needs-user" ? "waiting" : event.status === "error" ? "failed" : event.status === "idle" && root.status === "running" ? "completed" : root.status;
      root.latestAction = event.text || statusLabel(root.status);
      if (root.status === "running" && !root.startedAt) root.startedAt = now;
      if (["completed", "failed", "stopped"].includes(root.status)) root.completedAt = now;
      if (root.status === "waiting") root.waitingReason = event.text || "等待用户操作";
      if (root.status === "failed") root.failureReason = event.text || "会话运行失败";
    } else if (event.type === "tool-call") {
      const tools = new Set(root.toolIds ?? []); tools.add(event.tool.toolCallId); root.toolIds = [...tools]; root.toolCount = tools.size;
      root.latestAction = event.tool.title || event.tool.kind || "工具调用";
      if (event.tool.status === "failed") root.failureReason = event.tool.error || "工具调用失败";
    } else if (event.type === "turn-completed") {
      if (root.status === "running") root.status = "completed";
      root.completedAt = now; root.latestAction = "本轮已完成";
    } else if (event.type === "permission" || event.type === "question") {
      root.status = "waiting"; root.waitingReason = event.type === "permission" ? "等待工具权限确认" : "等待问题答复"; root.latestAction = root.waitingReason;
    } else if (event.type === "error") {
      root.status = "failed"; root.failureReason = event.message; root.latestAction = event.message; root.completedAt = now;
    } else if (event.type === "meta") {
      root.contextUsed = event.meta.totalTokens; root.modelId = event.meta.modelId || root.modelId;
    } else if (event.type === "subagent") {
      updateSubagent(state.records, root, event.update, now);
    }
    root.updatedAt = now;
    state.records[rootId] = root;
    await this.store.set(state);
  }

  async snapshot(input: DashboardSnapshotInput): Promise<AgentDashboardSnapshot> {
    const state = await this.store.get();
    const now = new Date().toISOString();
    const liveById = new Map(input.liveSessions.map((value) => [value.sessionId, value]));
    const assignments = new Map(input.assignments.map((value) => [value.sessionId, value]));
    const sessions = new Map(input.sessions.map((value) => [value.id, value]));
    for (const live of input.liveSessions) if (sameWorkspace(live.cwd, input.query.workspacePath) && !sessions.has(live.sessionId)) {
      sessions.set(live.sessionId, { id: live.sessionId, cwd: live.cwd, title: "已加载会话", createdAt: now, updatedAt: now, messageCount: 0, modelId: live.modelId, effort: live.effort, status: "cold" });
    }

    const roots: AgentDashboardNode[] = [];
    for (const session of sessions.values()) {
      const live = liveById.get(session.id);
      const assignment = assignments.get(session.id);
      const record = state.records[rootNodeId(session.id)];
      const children = Object.values(state.records)
        .filter((value) => value.parentId === rootNodeId(session.id))
        .map((value) => materialize(value, Boolean(live)))
        .concat(taskChildren(input.tasks.filter((value) => value.sessionId === session.id), session.id, now));
      const dedupedChildren = dedupe(children).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const root: AgentDashboardNode = {
        id: rootNodeId(session.id), sessionId: session.id, children: dedupedChildren,
        title: session.title, agentId: assignment?.profile.agentId, modelId: live?.modelId || session.modelId || assignment?.profile.modelId,
        effort: live?.effort || normalizeEffort(session.effort) || assignment?.profile.effort,
        status: live ? record?.status ?? sessionStatus(session.status) : terminalHistoricalStatus(record?.status),
        startedAt: record?.startedAt || session.createdAt, completedAt: live ? record?.completedAt : record?.completedAt || session.updatedAt,
        durationMs: duration(record?.startedAt || session.createdAt, live ? undefined : record?.completedAt || session.updatedAt),
        toolCount: Math.max(record?.toolCount ?? 0, dedupedChildren.reduce((sum, child) => sum + child.toolCount, 0)),
        isolation: assignment?.worktreeId ? "worktree" : "workspace", worktreeId: assignment?.worktreeId,
        latestAction: record?.latestAction || (live ? "会话已加载" : "只读历史"), waitingReason: record?.waitingReason,
        failureReason: record?.failureReason, summary: record?.summary, live: Boolean(live), updatedAt: record?.updatedAt || session.updatedAt || now,
      };
      if (matches(root, input.query)) roots.push(root);
    }
    roots.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const liveCount = roots.filter((value) => value.live).length;
    return {
      workspacePath: input.query.workspacePath,
      roots,
      mode: liveCount === 0 ? "history" : liveCount === roots.length ? "live" : "mixed",
      updatedAt: now,
      liveCapability: input.liveCapability,
      diagnostic: input.liveCapability === "supported" ? undefined : "实时扩展不可用时显示 ACP 已知状态与只读会话历史；历史节点不会标记为运行中。",
    };
  }

  async clear(nodeId?: string): Promise<void> {
    const state = await this.store.get();
    if (!nodeId) state.records = {};
    else {
      delete state.records[nodeId];
      for (const [id, value] of Object.entries(state.records)) if (value.parentId === nodeId) delete state.records[id];
    }
    await this.store.set(state);
  }
}

function updateSubagent(records: Record<string, DashboardRecord>, root: DashboardRecord, update: Record<string, unknown>, now: string): void {
  const subagentId = String(update.subagent_id ?? update.subagentId ?? update.id ?? "").trim();
  if (!subagentId) return;
  const id = subagentNodeId(root.sessionId, subagentId);
  const current = records[id] ?? createRecord(id, root.sessionId, String(update.description ?? update.subagent_type ?? update.agent ?? "子 Agent"), now);
  current.parentId = root.id;
  current.agentId = textValue(update.agent_id ?? update.agent ?? update.subagent_type);
  current.personaId = textValue(update.persona_id ?? update.persona);
  current.modelId = textValue(update.model_id ?? update.model);
  current.effort = normalizeEffort(update.effort);
  const eventName = String(update.sessionUpdate ?? update.type ?? "").toLowerCase();
  const failed = eventName.includes("fail") || update.success === false;
  const finished = eventName.includes("finish") || eventName.includes("complete") || typeof update.duration_ms === "number";
  current.status = failed ? "failed" : finished ? "completed" : eventName.includes("wait") ? "waiting" : "running";
  if (!current.startedAt) current.startedAt = now;
  if (finished || failed) current.completedAt = now;
  current.durationMs = numberValue(update.duration_ms) ?? duration(current.startedAt, current.completedAt);
  current.toolCount = numberValue(update.tool_call_count ?? update.toolCallCount) ?? current.toolCount;
  current.contextUsed = numberValue(update.context_used ?? update.contextTokensUsed) ?? current.contextUsed;
  current.contextLimit = numberValue(update.context_limit ?? update.contextWindow) ?? current.contextLimit;
  current.latestAction = textValue(update.latest_action ?? update.action) || (finished ? "子 Agent 已完成" : "子 Agent 运行中");
  current.waitingReason = textValue(update.waiting_reason);
  current.failureReason = failed ? textValue(update.error ?? update.output) || "子 Agent 失败" : undefined;
  current.summary = finished && !failed ? textValue(update.output ?? update.summary) : current.summary;
  current.isolation = String(update.isolation ?? "").toLowerCase().includes("worktree") ? "worktree" : current.isolation;
  current.worktreeId = textValue(update.worktree_id ?? update.worktreeId) || current.worktreeId;
  current.updatedAt = now;
  records[id] = current;
}

function createRecord(id: string, sessionId: string, title: string, now: string): DashboardRecord {
  return { id, sessionId, title, status: "unknown", toolCount: 0, isolation: "workspace", updatedAt: now };
}

function materialize(record: DashboardRecord, parentLive: boolean): AgentDashboardNode {
  return { ...record, children: [], status: parentLive ? record.status : terminalHistoricalStatus(record.status), live: parentLive && ["queued", "running", "waiting"].includes(record.status) };
}

function taskChildren(tasks: BackgroundTaskSummary[], sessionId: string, now: string): AgentDashboardNode[] {
  return tasks.filter((task) => task.kind === "subagent").map((task) => ({
    id: `task:${task.id}`, sessionId, parentId: rootNodeId(sessionId), children: [], title: task.title,
    status: task.status === "running" ? "running" : task.status === "queued" ? "queued" : task.status === "completed" ? "completed" : task.status === "failed" ? "failed" : "stopped",
    toolCount: toolCountFromDetail(task.detail), isolation: "workspace", latestAction: task.detail, live: ["running", "queued"].includes(task.status), updatedAt: task.updatedAt || now,
  }));
}

function dedupe(nodes: AgentDashboardNode[]): AgentDashboardNode[] {
  const byIdentity = new Map<string, AgentDashboardNode>();
  for (const node of nodes) {
    const key = node.id.replace(/^task:/, "").replace(/^[^:]+:subagent:/, "subagent:");
    const previous = byIdentity.get(key);
    if (!previous || node.live || node.updatedAt > previous.updatedAt) byIdentity.set(key, node);
  }
  return [...byIdentity.values()];
}

function matches(root: AgentDashboardNode, query: AgentDashboardQuery): boolean {
  const nodes = [root, ...root.children];
  if (query.status && query.status !== "all" && !nodes.some((value) => value.status === query.status)) return false;
  if (query.agentId && !nodes.some((value) => value.agentId === query.agentId)) return false;
  if (query.since && !nodes.some((value) => value.updatedAt >= query.since!)) return false;
  return true;
}

function terminalHistoricalStatus(status: AgentDashboardNode["status"] | undefined): AgentDashboardNode["status"] {
  return status && !["queued", "running", "waiting"].includes(status) ? status : "unknown";
}

function sessionStatus(status: SessionSummary["status"]): AgentDashboardNode["status"] {
  return status === "working" ? "running" : status === "needs-user" ? "waiting" : status === "error" ? "failed" : "unknown";
}

function statusLabel(status: AgentDashboardNode["status"]): string { return ({ queued: "等待运行", running: "运行中", waiting: "等待用户", completed: "已完成", failed: "失败", stopped: "已停止", unknown: "状态未知" })[status]; }
function rootNodeId(sessionId: string): string { return `session:${sessionId}`; }
function subagentNodeId(sessionId: string, subagentId: string): string { return `session:${sessionId}:subagent:${subagentId}`; }
function sameWorkspace(left: string, right: string): boolean { return left.replace(/[\\/]+$/, "").toLocaleLowerCase() === right.replace(/[\\/]+$/, "").toLocaleLowerCase(); }
function normalizeEffort(value: unknown): ReasoningEffort | undefined { const item = String(value ?? ""); return ["", "none", "minimal", "low", "medium", "high", "xhigh"].includes(item) ? item as ReasoningEffort : undefined; }
function textValue(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function numberValue(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function duration(start?: string, end?: string): number | undefined { if (!start || !end) return undefined; const value = new Date(end).getTime() - new Date(start).getTime(); return Number.isFinite(value) && value >= 0 ? value : undefined; }
function toolCountFromDetail(detail?: string): number { const match = detail?.match(/(\d+)\s*次工具/u); return match ? Number(match[1]) : 0; }
