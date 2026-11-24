import { memo, useEffect, useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { BellOff, Check, CircleAlert, Columns2, LoaderCircle, ShieldAlert, X } from "lucide-react";
import type {
  ComputerAppPermissionRequest,
  ComputerRiskConfirmation,
  PermissionOption,
  PermissionRequest,
  SessionSummary,
} from "../../../shared/types";
import { useAppStore, type SessionView, type UiMessage } from "../store";
import {
  clearSessionTelemetrySnooze,
  computeSessionTelemetry,
  formatTelemetryElapsed,
  getSessionTiming,
  isSessionTelemetrySnoozed,
  snoozeSessionTelemetry,
  useLiveTelemetryClock,
} from "../hooks/use-live-telemetry";
import { isExpiredInteractionError } from "./interaction-utils";
import { protectedActionScript, protectedActionSummary } from "./MessageCard";

export interface TurnCapsuleProps {
  splitSessionIds?: string[];
  computerPermissions?: Record<string, ComputerAppPermissionRequest>;
  computerRisks?: Record<string, ComputerRiskConfirmation>;
  onSelectSession?(target: { cwd: string; sessionId: string }): void;
  onError?(message: string): void;
}

function normalizePathKey(value: string): string {
  return value.replace(/[\\/]+$/, "").toLocaleLowerCase();
}

function folderBasename(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).at(-1) || value;
}

function isDenyOption(option: PermissionOption): boolean {
  return /^(?:no|deny|reject)/i.test(option.name ?? "") || /reject|deny/.test(option.kind ?? "");
}

function isComputerUsePermission(request: PermissionRequest): boolean {
  if (!request.toolCall || typeof request.toolCall !== "object") return false;
  const raw = request.toolCall as Record<string, unknown>;
  const ident = `${String(raw.serverName ?? "")} ${String(raw.name ?? "")} ${String(raw.toolName ?? "")}`.toLowerCase();
  return ident.includes("grok_desktop_computer");
}

function findSafePermissionActions(view: SessionView | undefined): {
  messageId: string;
  request: PermissionRequest;
  allowOnce?: PermissionOption;
  deny?: PermissionOption;
  summary: string;
  script: string;
} | null {
  if (!view) return null;
  const pendingMsg = [...view.messages]
    .reverse()
    .find(
      (msg): msg is Extract<UiMessage, { kind: "permission" }> =>
        msg.kind === "permission" && !msg.resolved,
    );
  if (!pendingMsg || isComputerUsePermission(pendingMsg.request)) return null;
  const options = pendingMsg.request.options;
  const allowOnce =
    options.find((opt) => opt.kind === "allow_once") ??
    options.find((opt) => !isDenyOption(opt) && opt.kind !== "allow_always");
  const deny = options.find((opt) => isDenyOption(opt));
  return {
    messageId: pendingMsg.id,
    request: pendingMsg.request,
    allowOnce,
    deny,
    summary: protectedActionSummary(pendingMsg.request.toolCall) || "受保护工具调用",
    script: protectedActionScript(pendingMsg.request.toolCall),
  };
}

export const TurnCapsule = memo(function TurnCapsule({
  splitSessionIds = [],
  computerPermissions = {},
  computerRisks = {},
  onSelectSession,
  onError,
}: TurnCapsuleProps): React.JSX.Element | null {
  const tickNow = useLiveTelemetryClock();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const workspaces = useAppStore((s) => s.workspaces);
  const views = useAppStore((s) => s.views);
  const resolveMessage = useAppStore((s) => s.resolveMessage);

  const [open, setOpen] = useState(false);
  const [remoteSessions, setRemoteSessions] = useState<SessionSummary[]>([]);
  const [submittingKey, setSubmittingKey] = useState("");

  useEffect(() => {
    if (typeof window === "undefined" || !window.grokDesktop?.listSessions) return;
    const localCwds = new Set(sessions.map((s) => normalizePathKey(s.cwd)));
    const targets = workspaces.filter(
      (ws) => ws.exists && !ws.hidden && ws.activeSessions > 0 && !localCwds.has(normalizePathKey(ws.cwd)),
    );
    if (targets.length === 0) {
      setRemoteSessions((prev) => (prev.length ? [] : prev));
      return;
    }
    let cancelled = false;
    void Promise.all(
      targets.map((ws) => window.grokDesktop.listSessions(ws.cwd).catch(() => [] as SessionSummary[])),
    ).then((lists) => {
      if (!cancelled) setRemoteSessions(lists.flat());
    });
    return () => {
      cancelled = true;
    };
  }, [sessions, workspaces]);

  const workspaceNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const ws of workspaces) {
      map.set(normalizePathKey(ws.cwd), ws.name);
      map.set(normalizePathKey(ws.canonicalPath), ws.name);
    }
    return map;
  }, [workspaces]);

  const entries = useMemo(() => {
    const now = tickNow || Date.now();
    const byId = new Map<string, SessionSummary>();
    for (const s of [...sessions, ...remoteSessions]) {
      if (!s.archived) byId.set(s.id, s);
    }
    for (const [id, view] of Object.entries(views)) {
      if (!byId.has(id) && (view.status === "working" || view.status === "needs-user" || view.compacting)) {
        byId.set(id, {
          id,
          cwd: useAppStore.getState().settings?.activeWorkspace || "",
          title: `会话 ${id.slice(0, 8)}`,
          createdAt: "",
          updatedAt: new Date(now).toISOString(),
          messageCount: view.messages.length,
          status: view.status === "needs-user" ? "needs-user" : "working",
        });
      }
    }

    const splitSet = new Set(splitSessionIds);
    const items: Array<{
      session: SessionSummary;
      projectName: string;
      paneState: "primary" | "split" | "background";
      effectiveStatus: "needs-user" | "working" | "queued";
      hasComputerRisk: boolean;
      hasComputerAppPerm: boolean;
      safePermission: ReturnType<typeof findSafePermissionActions>;
      pendingKindLabel: string;
      telemetry: ReturnType<typeof computeSessionTelemetry>;
    }> = [];

    for (const session of byId.values()) {
      const view = views[session.id];
      const hasComputerRisk = Boolean(computerRisks[session.id]);
      const hasComputerAppPerm = Boolean(computerPermissions[session.id]);
      const rawStatus =
        hasComputerRisk || hasComputerAppPerm
          ? "needs-user"
          : view?.status && view.status !== "idle"
            ? view.status
            : session.status;

      if (rawStatus !== "working" && rawStatus !== "needs-user" && rawStatus !== "queued" && !view?.compacting) {
        continue;
      }

      const effectiveStatus: "needs-user" | "working" | "queued" =
        rawStatus === "needs-user" ? "needs-user" : rawStatus === "queued" ? "queued" : "working";

      const safePermission = effectiveStatus === "needs-user" && !hasComputerRisk ? findSafePermissionActions(view) : null;
      let pendingKindLabel = "";
      if (hasComputerRisk) {
        pendingKindLabel = "高风险桌面操作 · 需打开弹窗核对确认";
      } else if (hasComputerAppPerm) {
        pendingKindLabel = `待授权控制应用：${computerPermissions[session.id]?.app.name || "Windows 应用"}`;
      } else if (safePermission) {
        pendingKindLabel = safePermission.summary;
      } else if (effectiveStatus === "needs-user" && view) {
        const lastPending = [...view.messages].reverse().find(
          (m) => (m.kind === "plan" && m.interactive && !m.resolved) || (m.kind === "question" && !m.resolved) || (m.kind === "mcp-elicitation" && !m.resolved),
        );
        pendingKindLabel =
          lastPending?.kind === "plan"
            ? "等待审批实施计划"
            : lastPending?.kind === "question"
              ? "等待回答澄清问题"
              : lastPending?.kind === "mcp-elicitation"
                ? "等待填写 MCP 表单"
                : "等待你的确认操作";
      }

      const snoozed = isSessionTelemetrySnoozed(session.id, now);
      const trackedTiming = getSessionTiming(session.id);
      const fallbackStartMs = Date.parse(view?.turnPresentations.at(-1)?.startedAt || session.updatedAt);
      const timing = trackedTiming
        ?? (Number.isFinite(fallbackStartMs) ? { startedAtMs: fallbackStartMs, lastEventAtMs: fallbackStartMs } : undefined);
      const telemetry = computeSessionTelemetry(
        session.id,
        view,
        session,
        timing,
        now,
        snoozed ? now + 60_000 : undefined,
      );

      items.push({
        session,
        projectName: workspaceNames.get(normalizePathKey(session.cwd)) || folderBasename(session.cwd) || "工作区",
        paneState: session.id === activeSessionId ? "primary" : splitSet.has(session.id) ? "split" : "background",
        effectiveStatus,
        hasComputerRisk,
        hasComputerAppPerm,
        safePermission,
        pendingKindLabel,
        telemetry,
      });
    }

    items.sort((a, b) => {
      const rank = (x: typeof a): number =>
        x.effectiveStatus === "needs-user" ? 0 : x.telemetry.isStalled ? 1 : x.effectiveStatus === "working" ? 2 : 3;
      return rank(a) - rank(b);
    });
    return items;
  }, [activeSessionId, computerPermissions, computerRisks, remoteSessions, sessions, splitSessionIds, tickNow, views, workspaceNames]);

  if (entries.length === 0) return null;

  const workingCount = entries.filter((e) => e.effectiveStatus === "working" || e.effectiveStatus === "queued").length;
  const needsUserCount = entries.filter((e) => e.effectiveStatus === "needs-user").length;
  const stalledCount = entries.filter((e) => e.telemetry.isStalled).length;

  const respondSafePermission = async (
    sessionId: string,
    messageId: string,
    requestId: string | number,
    optionId: string,
  ): Promise<void> => {
    const key = `${sessionId}:${String(requestId)}`;
    if (submittingKey) return;
    setSubmittingKey(key);
    try {
      await window.grokDesktop.respondPermission(sessionId, requestId, optionId);
      resolveMessage(sessionId, messageId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (isExpiredInteractionError(detail)) {
        resolveMessage(sessionId, messageId);
      } else {
        onError?.(detail);
      }
    } finally {
      setSubmittingKey("");
    }
  };

  const jumpToSession = (session: SessionSummary): void => {
    setOpen(false);
    if (onSelectSession && session.cwd) {
      onSelectSession({ cwd: session.cwd, sessionId: session.id });
    } else {
      useAppStore.getState().setActiveSession(session.id);
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`app-no-drag turn-capsule-trigger${needsUserCount > 0 ? " has-waiting" : ""}${stalledCount > 0 ? " has-stalled" : ""}`}
          aria-label={`全局回合状态：${workingCount} 运行中，${needsUserCount} 待确认`}
          title="查看所有工作区与分屏中的活跃回合及快捷权限审批"
        >
          {needsUserCount > 0 || stalledCount > 0 ? (
            <CircleAlert size={13} className="turn-capsule-warn-icon" />
          ) : (
            <LoaderCircle size={13} className="ui-spin turn-capsule-spin-icon" />
          )}
          {workingCount > 0 && <span className="turn-capsule-count">{workingCount} 运行</span>}
          {stalledCount > 0 && <span className="turn-capsule-stalled">· {stalledCount} 停滞</span>}
          {needsUserCount > 0 && (
            <span className="ui-badge ui-badge-warning turn-capsule-badge">
              {needsUserCount} 待确认
            </span>
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content className="ui-popover turn-capsule-popover" align="end" sideOffset={7} collisionPadding={10}>
          <header className="turn-capsule-head">
            <strong>全局回合动态 ({entries.length})</strong>
            <span>跨工作区 · 分屏感知</span>
          </header>

          <div className="turn-capsule-list">
            {entries.map((item) => {
              const { session, safePermission, hasComputerRisk, telemetry } = item;
              const permKey = safePermission ? `${session.id}:${String(safePermission.request.requestId)}` : "";
              const isSubmitting = permKey !== "" && submittingKey === permKey;

              return (
                <div
                  key={session.id}
                  className={`turn-capsule-row${item.effectiveStatus === "needs-user" ? " waiting" : ""}${telemetry.isStalled ? " stalled" : ""}`}
                >
                  <div className="turn-capsule-row-top">
                    <button
                      type="button"
                      className="turn-capsule-jump"
                      onClick={() => jumpToSession(session)}
                    >
                      <span>{session.title}</span>
                    </button>
                    <span className="ui-badge turn-capsule-tag">{item.projectName}</span>
                    <span className="ui-badge turn-capsule-tag">
                      {item.paneState === "primary" ? "当前" : item.paneState === "split" ? "分屏" : "后台"}
                    </span>
                    {item.paneState === "background" && session.cwd && (
                      <button
                        type="button"
                        className="ui-icon-btn ui-icon-btn-sm"
                        title="在副窗格并排打开"
                        aria-label={`分屏查看 ${session.title}`}
                        onClick={() => {
                          setOpen(false);
                          window.dispatchEvent(
                            new CustomEvent("grok:open-in-split", {
                              detail: { kind: "session", workspace: session.cwd, id: session.id, title: session.title },
                            }),
                          );
                        }}
                      >
                        <Columns2 size={11} />
                      </button>
                    )}
                    <button
                      type="button"
                      className={`ui-icon-btn ui-icon-btn-sm${telemetry.isSnoozed ? " is-active" : ""}`}
                      title={telemetry.isSnoozed ? "取消此会话静音" : "静音此会话提示音 15 分钟"}
                      aria-label={telemetry.isSnoozed ? `取消 ${session.title} 静音` : `静音 ${session.title} 15 分钟`}
                      onClick={() =>
                        telemetry.isSnoozed
                          ? clearSessionTelemetrySnooze(session.id)
                          : snoozeSessionTelemetry(session.id, 15 * 60_000)
                      }
                    >
                      <BellOff size={11} />
                    </button>
                  </div>

                  {telemetry.isStalled ? (
                    <div className="turn-capsule-stalled-text">{telemetry.stalledReason}</div>
                  ) : telemetry.summary ? (
                    <div className="turn-capsule-summary">
                      <span>{telemetry.summary}</span>
                      {telemetry.elapsedMs > 0 && <span>{formatTelemetryElapsed(telemetry.elapsedMs)}</span>}
                    </div>
                  ) : null}

                  {item.effectiveStatus === "needs-user" && (
                    <div className="turn-capsule-approval">
                      <div className={`turn-capsule-approval-title${hasComputerRisk ? " danger" : ""}`}>
                        {hasComputerRisk && <ShieldAlert size={13} />}
                        <span>{item.pendingKindLabel}</span>
                      </div>

                      {safePermission?.script && (
                        <code className="turn-capsule-script">
                          {safePermission.script.slice(0, 120)}
                        </code>
                      )}

                      <div className="turn-capsule-actions">
                        {safePermission && !hasComputerRisk && (safePermission.allowOnce || safePermission.deny) ? (
                          <>
                            <button
                              type="button"
                              className="ui-btn ui-btn-ghost ui-btn-sm"
                              onClick={() => jumpToSession(session)}
                            >
                              查看详情
                            </button>
                            {safePermission.deny && (
                              <button
                                type="button"
                                className="ui-btn ui-btn-danger ui-btn-sm"
                                disabled={isSubmitting}
                                onClick={() =>
                                  void respondSafePermission(
                                    session.id,
                                    safePermission.messageId,
                                    safePermission.request.requestId,
                                    safePermission.deny!.optionId,
                                  )
                                }
                              >
                                <X size={11} /> 拒绝
                              </button>
                            )}
                            {safePermission.allowOnce && (
                              <button
                                type="button"
                                className="ui-btn ui-btn-primary ui-btn-sm"
                                disabled={isSubmitting}
                                onClick={() =>
                                  void respondSafePermission(
                                    session.id,
                                    safePermission.messageId,
                                    safePermission.request.requestId,
                                    safePermission.allowOnce!.optionId,
                                  )
                                }
                              >
                                <Check size={11} /> 仅本次允许
                              </button>
                            )}
                          </>
                        ) : (
                          <button
                            type="button"
                            className="ui-btn ui-btn-primary ui-btn-sm"
                            onClick={() => jumpToSession(session)}
                          >
                            {hasComputerRisk ? "前往弹窗核对" : "前往处理"}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
});
