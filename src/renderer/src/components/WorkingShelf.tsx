import { memo, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Clock, Columns2, LoaderCircle } from "lucide-react";
import type { LiveStatus, SessionSummary, WorkspaceSummary } from "../../../shared/types";
import { snoozeSessionTelemetry } from "../hooks/use-live-telemetry";
import { useAppStore } from "../store";

export interface WorkingShelfProps {
  sessions: SessionSummary[];
  workspaces: WorkspaceSummary[];
  activeSessionId: string;
  splitSessionIds?: string[];
  crossProjectSessions?: SessionSummary[];
  onSelectSession(session: SessionSummary): void;
  onOpenInSplit(session: SessionSummary): void;
  onSettleSession(session: SessionSummary): void | Promise<void>;
}

function attentionPriority(session: SessionSummary): number | null {
  if (session.archived) return null;
  if (session.status === "needs-user") return 0;
  if (session.status === "working" || session.status === "queued") return 1;
  if (session.status === "error") return 2;
  if (session.status === "unread" && !session.settled) return 2;
  return null;
}

function statusMeta(status: LiveStatus): { label: string; color: string; pulse: boolean; spin: boolean } {
  switch (status) {
    case "needs-user":
      return { label: "待确认", color: "var(--color-warning)", pulse: true, spin: false };
    case "working":
      return { label: "运行中", color: "var(--color-accent)", pulse: false, spin: true };
    case "queued":
      return { label: "排队中", color: "var(--color-accent)", pulse: true, spin: false };
    case "error":
      return { label: "异常", color: "var(--color-danger)", pulse: false, spin: false };
    case "unread":
      return { label: "已完成", color: "var(--color-success)", pulse: false, spin: false };
    default:
      return { label: "", color: "var(--color-fg-subtlest)", pulse: false, spin: false };
  }
}

function normalizePathKey(value: string): string {
  return value.replace(/[\\/]+$/, "").toLocaleLowerCase();
}

function folderBasename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}

export const WorkingShelf = memo(function WorkingShelf({
  sessions,
  workspaces,
  activeSessionId,
  splitSessionIds = [],
  crossProjectSessions,
  onSelectSession,
  onOpenInSplit,
  onSettleSession,
}: WorkingShelfProps): React.JSX.Element | null {
  const [collapsed, setCollapsed] = useState(false);
  const [discoveredRemote, setDiscoveredRemote] = useState<SessionSummary[]>([]);
  const [optimisticSettled, setOptimisticSettled] = useState<Record<string, LiveStatus>>({});
  const [optimisticSnoozed, setOptimisticSnoozed] = useState<Record<string, number>>({});

  useEffect(() => {
    if (typeof window === "undefined" || !window.grokDesktop?.listSessions) {
      return;
    }
    const providedCwds = new Set(
      [...sessions, ...(crossProjectSessions ?? [])].map((s) => normalizePathKey(s.cwd)),
    );
    const activeWorkspaces = workspaces.filter(
      (ws) => ws.exists && !ws.hidden && ws.activeSessions > 0 && !providedCwds.has(normalizePathKey(ws.cwd)),
    );
    if (!activeWorkspaces.length) {
      setDiscoveredRemote((prev) => (prev.length ? [] : prev));
      return;
    }
    let cancelled = false;
    void Promise.all(
      activeWorkspaces.map((ws) => window.grokDesktop.listSessions(ws.cwd).catch(() => [] as SessionSummary[])),
    ).then((groups) => {
      if (!cancelled) setDiscoveredRemote(groups.flat());
    });
    return () => {
      cancelled = true;
    };
  }, [crossProjectSessions, sessions, workspaces]);

  const workspaceNameByCwd = useMemo(() => {
    const map = new Map<string, string>();
    for (const ws of workspaces) {
      map.set(normalizePathKey(ws.cwd), ws.name);
      map.set(normalizePathKey(ws.canonicalPath), ws.name);
    }
    return map;
  }, [workspaces]);

  const attentionItems = useMemo(() => {
    const merged = new Map<string, SessionSummary>();
    for (const item of [...sessions, ...(crossProjectSessions ?? []), ...discoveredRemote]) {
      merged.set(item.id, item);
    }
    const now = Date.now();
    const candidates: Array<{ session: SessionSummary; priority: number; updatedMs: number }> = [];
    for (const session of merged.values()) {
      const settledStatus = optimisticSettled[session.id];
      if (settledStatus && settledStatus === session.status && session.status !== "needs-user" && session.status !== "working") {
        continue;
      }
      if (session.status !== "needs-user") {
        const persistedSnooze = session.snoozedUntil ? Date.parse(session.snoozedUntil) : NaN;
        const optSnooze = optimisticSnoozed[session.id] ?? 0;
        if ((Number.isFinite(persistedSnooze) && persistedSnooze > now) || optSnooze > now) {
          continue;
        }
      }
      const priority = attentionPriority(session);
      if (priority === null) continue;
      const parsed = Date.parse(session.updatedAt);
      candidates.push({
        session,
        priority,
        updatedMs: Number.isFinite(parsed) ? parsed : 0,
      });
    }
    candidates.sort((left, right) => left.priority - right.priority || right.updatedMs - left.updatedMs);
    return candidates.map((entry) => entry.session);
  }, [crossProjectSessions, discoveredRemote, optimisticSettled, optimisticSnoozed, sessions]);

  if (attentionItems.length === 0) {
    return null;
  }

  const splitSet = new Set(splitSessionIds);
  const needsUserCount = attentionItems.filter((item) => item.status === "needs-user").length;

  const handleSettle = (event: React.MouseEvent, session: SessionSummary): void => {
    event.stopPropagation();
    setOptimisticSettled((current) => ({ ...current, [session.id]: session.status }));
    void Promise.resolve(onSettleSession(session)).catch(() => {
      setOptimisticSettled((current) => {
        const copy = { ...current };
        delete copy[session.id];
        return copy;
      });
    });
  };

  const handleSnooze = (event: React.MouseEvent, session: SessionSummary): void => {
    event.stopPropagation();
    const untilMs = Date.now() + 3_600_000;
    setOptimisticSnoozed((current) => ({ ...current, [session.id]: untilMs }));
    snoozeSessionTelemetry(session.id, 3_600_000);
    if (typeof window !== "undefined" && typeof window.grokDesktop?.snoozeSession === "function") {
      void window.grokDesktop.snoozeSession(session.id, new Date(untilMs).toISOString())
        .then(async () => {
          const activeCwd = useAppStore.getState().settings?.activeWorkspace;
          if (activeCwd && typeof window.grokDesktop.listSessions === "function") {
            const next = await window.grokDesktop.listSessions(activeCwd);
            if (useAppStore.getState().settings?.activeWorkspace === activeCwd) {
              useAppStore.getState().setSessions(next);
            }
          }
        })
        .catch(() => {
          setOptimisticSnoozed((current) => {
            const copy = { ...current };
            delete copy[session.id];
            return copy;
          });
        });
    }
  };

  return (
    <section
      className="working-shelf"
      aria-label="跨项目待处理与运行中会话"
      style={{
        display: "grid",
        gap: 3,
        margin: "2px 2px 8px",
        padding: 6,
        borderRadius: "var(--radius-xl)",
        border: needsUserCount > 0
          ? "1px solid color-mix(in srgb, var(--color-warning) 45%, var(--color-border))"
          : "1px solid var(--color-border)",
        background: "var(--color-card)",
      }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((prev) => !prev)}
        aria-expanded={!collapsed}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          height: 22,
          padding: "0 4px",
          border: 0,
          borderRadius: "var(--radius-md)",
          background: "transparent",
          color: "var(--color-fg-subtle)",
          fontSize: "var(--text-xs)",
          fontWeight: 600,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <span>注意力台</span>
        {needsUserCount > 0 && (
          <span className="ui-badge ui-badge-warning" style={{ height: 16, padding: "0 5px", fontSize: 10 }}>
            {needsUserCount} 待确认
          </span>
        )}
        <span style={{ marginLeft: "auto", color: "var(--color-fg-subtlest)", fontWeight: 500 }}>
          {attentionItems.length}
        </span>
      </button>

      {!collapsed && (
        <div style={{ display: "grid", gap: 2, maxHeight: 196, overflowY: "auto" }}>
          {attentionItems.map((session) => {
            const meta = statusMeta(session.status);
            const isActive = session.id === activeSessionId;
            const isSplit = splitSet.has(session.id);
            const projectName = workspaceNameByCwd.get(normalizePathKey(session.cwd)) || folderBasename(session.cwd);
            const canSettle = session.status === "unread" || session.status === "error";

            return (
              <div
                key={session.id}
                className={`working-shelf-row${isActive ? " is-active" : ""}${isSplit ? " is-split" : ""}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto",
                  alignItems: "center",
                  gap: 4,
                  minHeight: 28,
                  padding: "0 4px 0 6px",
                  borderRadius: "var(--radius-md)",
                  background: isActive ? "var(--color-selected)" : "transparent",
                }}
              >
                <button
                  type="button"
                  onClick={() => onSelectSession(session)}
                  title={`${session.title} · ${projectName} (${meta.label})`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    minWidth: 0,
                    height: 28,
                    padding: 0,
                    border: 0,
                    background: "transparent",
                    color: "var(--color-fg)",
                    fontSize: "var(--text-caption)",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  {meta.spin ? (
                    <LoaderCircle size={12} className="ui-spin" style={{ color: meta.color, flex: "none" }} />
                  ) : (
                    <span
                      aria-hidden="true"
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: meta.color,
                        boxShadow: meta.pulse ? `0 0 0 3px color-mix(in srgb, ${meta.color} 25%, transparent)` : undefined,
                        flex: "none",
                      }}
                    />
                  )}
                  <span style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {session.title}
                  </span>
                  <span
                    className="working-shelf-project-badge"
                    style={{
                      flex: "0 1 auto",
                      maxWidth: 76,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      padding: "0 5px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--color-border)",
                      color: "var(--color-fg-subtlest)",
                      fontSize: 10,
                    }}
                  >
                    {projectName}
                  </span>
                </button>

                <div style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                  {session.status !== "needs-user" && (
                    <button
                      type="button"
                      className="ui-icon-btn ui-icon-btn-sm"
                      style={{ width: 22, height: 22 }}
                      title="稍后提醒 (1 小时)"
                      aria-label={`稍后提醒 ${session.title}`}
                      onClick={(event) => handleSnooze(event, session)}
                    >
                      <Clock size={11} />
                    </button>
                  )}
                  <button
                    type="button"
                    className={`ui-icon-btn ui-icon-btn-sm${isSplit ? " is-active" : ""}`}
                    style={{ width: 22, height: 22 }}
                    title="分屏查看"
                    aria-label={`分屏查看 ${session.title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenInSplit(session);
                    }}
                  >
                    <Columns2 size={12} />
                  </button>
                  <button
                    type="button"
                    className="ui-icon-btn ui-icon-btn-sm"
                    style={{ width: 22, height: 22, opacity: canSettle ? 1 : 0.45 }}
                    title={canSettle ? "已阅收起 (Settle)" : `${meta.label} · 点击标记已阅`}
                    aria-label={`已阅收起 ${session.title}`}
                    onClick={(event) => handleSettle(event, session)}
                  >
                    <Check size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
});
