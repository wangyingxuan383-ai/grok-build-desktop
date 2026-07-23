import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentDashboardNode, AgentDashboardSnapshot, AgentDashboardStatus } from "../../../shared/types";

export function AgentDashboardWorkbench({ workspace, onOpenSession, onOpenWorktree, onOpenDefinition, setError }: {
  workspace: string;
  onOpenSession(sessionId: string): void;
  onOpenWorktree(worktreeId: string): void;
  onOpenDefinition(agentId?: string, personaId?: string): void;
  setError(message: string): void;
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<AgentDashboardSnapshot>();
  const [status, setStatus] = useState<AgentDashboardStatus | "all">("all");
  const [agentId, setAgentId] = useState("");
  const [period, setPeriod] = useState("all");
  const [expanded, setExpanded] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const since = useMemo(() => period === "all" ? undefined : new Date(Date.now() - Number(period) * 60 * 60_000).toISOString(), [period]);
  const load = useCallback(async () => {
    if (!workspace) return setSnapshot(undefined);
    try { setSnapshot(await window.grokDesktop.getAgentDashboard({ workspacePath: workspace, status, agentId: agentId || undefined, since })); }
    catch (error) { setError(message(error)); }
  }, [agentId, setError, since, status, workspace]);

  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 3_000); return () => window.clearInterval(timer); }, [load]);
  const agentIds = useMemo(() => [...new Set((snapshot?.roots ?? []).flatMap((root) => [root.agentId, ...root.children.map((child) => child.agentId)]).filter((value): value is string => Boolean(value)))].sort(), [snapshot]);
  const toggle = (id: string): void => setExpanded((values) => values.includes(id) ? values.filter((value) => value !== id) : [...values, id]);
  const stop = async (node: AgentDashboardNode): Promise<void> => { setBusy(node.id); try { await window.grokDesktop.stopAgentDashboardNode(node.id); await load(); } catch (error) { setError(message(error)); } finally { setBusy(""); } };
  const clear = async (node?: AgentDashboardNode): Promise<void> => { setBusy(node?.id || "all"); try { await window.grokDesktop.clearAgentDashboardRecord(node?.id); await load(); } catch (error) { setError(message(error)); } finally { setBusy(""); } };

  return <section className="agent-dashboard-workbench">
    <header className="workbench-header"><div><h2>Agent Dashboard</h2><p>桌面原生父子生命周期视图；不会启动 Grok TUI Dashboard。</p></div><div className="button-row"><button onClick={() => void load()}>刷新</button><button disabled={Boolean(busy)} onClick={() => void clear()}>清理 UI 记录</button></div></header>
    <div className="dashboard-filters"><label>状态<select value={status} onChange={(event) => setStatus(event.target.value as AgentDashboardStatus | "all")}><option value="all">全部</option>{["running", "waiting", "queued", "completed", "failed", "stopped", "unknown"].map((value) => <option key={value} value={value}>{statusText(value as AgentDashboardStatus)}</option>)}</select></label><label>Agent<select value={agentId} onChange={(event) => setAgentId(event.target.value)}><option value="">全部</option>{agentIds.map((value) => <option key={value}>{value}</option>)}</select></label><label>时间<select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="all">全部</option><option value="1">最近 1 小时</option><option value="24">最近 24 小时</option><option value="168">最近 7 天</option></select></label><span className={`dashboard-mode ${snapshot?.mode ?? "history"}`}>{snapshot?.mode === "live" ? "实时" : snapshot?.mode === "mixed" ? "实时 + 历史" : "只读历史"}</span></div>
    {snapshot?.diagnostic && <p className="inline-note">{snapshot.diagnostic}</p>}
    <div className="dashboard-tree">{snapshot?.roots.map((root) => <DashboardRow key={root.id} node={root} depth={0} expanded={expanded.includes(root.id)} onToggle={() => toggle(root.id)} onOpen={() => onOpenSession(root.sessionId)} onStop={() => void stop(root)} onClear={() => void clear(root)} onWorktree={() => root.worktreeId && onOpenWorktree(root.worktreeId)} onDefinition={() => onOpenDefinition(root.agentId, root.personaId)} busy={busy === root.id}>{expanded.includes(root.id) && root.children.map((child) => <DashboardRow key={child.id} node={child} depth={1} expanded={false} onToggle={() => undefined} onOpen={() => onOpenSession(child.sessionId)} onStop={() => void stop(child)} onClear={() => void clear(child)} onWorktree={() => child.worktreeId && onOpenWorktree(child.worktreeId)} onDefinition={() => onOpenDefinition(child.agentId, child.personaId)} busy={busy === child.id} />)}</DashboardRow>)}</div>
    {!snapshot?.roots.length && <p className="empty-copy">当前筛选下没有主会话或子 Agent 记录。</p>}
    {snapshot && <footer className="dashboard-footer">更新于 {new Date(snapshot.updatedAt).toLocaleTimeString()} · 实时能力 {snapshot.liveCapability}</footer>}
  </section>;
}

function DashboardRow({ node, depth, expanded, onToggle, onOpen, onStop, onClear, onWorktree, onDefinition, busy, children }: {
  node: AgentDashboardNode; depth: number; expanded: boolean; onToggle(): void; onOpen(): void; onStop(): void; onClear(): void; onWorktree(): void; onDefinition(): void; busy: boolean; children?: React.ReactNode;
}): React.JSX.Element {
  const running = node.status === "running" || node.status === "waiting" || node.status === "queued";
  return <div className={`dashboard-branch depth-${depth}`}><article className={`dashboard-node ${node.status}`}>
    <button className="dashboard-expand" disabled={!node.children.length || depth > 0} onClick={onToggle}>{node.children.length ? expanded ? "⌄" : "›" : "·"}</button>
    <span className={`dashboard-status ${node.status}`} />
    <div className="dashboard-node-copy"><strong>{node.title}</strong><span>{[node.agentId && `Agent ${node.agentId}`, node.personaId && `Persona ${node.personaId}`, node.modelId, node.effort, statusText(node.status)].filter(Boolean).join(" · ")}</span><small>{node.latestAction || "无最近动作"}{node.waitingReason ? ` · ${node.waitingReason}` : ""}{node.failureReason ? ` · ${node.failureReason}` : ""}</small><small>{formatDuration(node.durationMs)} · {node.toolCount} 次工具{node.contextUsed !== undefined ? ` · 上下文 ${node.contextUsed.toLocaleString()}${node.contextLimit ? ` / ${node.contextLimit.toLocaleString()}` : ""}` : ""} · {node.isolation === "worktree" ? `Worktree ${node.worktreeId || "隔离"}` : "普通工作区"}{node.summary ? ` · ${node.summary}` : ""}</small></div>
    <div className="provider-actions"><button onClick={onOpen}>打开会话</button>{node.worktreeId && <button onClick={onWorktree}>跳转 Worktree</button>}{(node.agentId || node.personaId) && <button onClick={onDefinition}>打开定义</button>}{running && node.live && <button disabled={busy} onClick={onStop}>停止</button>}<button disabled={busy} onClick={onClear}>清理记录</button></div>
  </article>{children}</div>;
}

export function statusText(status: AgentDashboardStatus): string { return ({ queued: "排队", running: "运行中", waiting: "等待", completed: "已完成", failed: "失败", stopped: "已停止", unknown: "历史/未知" })[status]; }
function formatDuration(value?: number): string { if (value === undefined) return "时长未知"; const seconds = Math.max(0, Math.round(value / 1_000)); return seconds < 60 ? `${seconds} 秒` : seconds < 3_600 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${Math.floor(seconds / 3_600)} 时 ${Math.floor(seconds % 3_600 / 60)} 分`; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
