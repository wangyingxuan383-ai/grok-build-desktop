import { memo } from "react";
import type { SessionSummary } from "../../../shared/types";
import {
  clearSessionTelemetrySnooze,
  formatTelemetryElapsed,
  snoozeSessionTelemetry,
  useSessionLiveTelemetry,
} from "../hooks/use-live-telemetry";
import { sessionSourceLabel } from "../session-groups";
import { ActionMenu, ActionContextMenu, type UiAction } from "./ui/ActionMenu";
import { useAppStore } from "../store";
import { UiIcon } from "../ui-icons";

/**
 * One session in the sidebar tree. The row is a single open target; the "more"
 * button shares the meta slot (meta fades out while it is shown) so hovering
 * never changes the row height or moves the trigger the menu is anchored to.
 */
export const SessionListRow = memo(function SessionListRow(props: {
  session: SessionSummary;
  active: boolean;
  menuOpen: boolean;
  /** Nested under a parent session (fork / worktree / sub-agent). */
  child?: boolean;
  onOpen(): void;
  onOpenInSplit?(): void;
  onSettle?(): void;
  onMenu(open: boolean): void;
  onPin(): void;
  onArchive(): void;
  onExport(): void;
  onRename(): void;
  onDelete(): void;
}): React.JSX.Element {
  const { session } = props;
  const sourceLabel = sessionSourceLabel(session);
  const status = sessionStatusPresentation(session.status);
  const snoozedUntilMs = session.snoozedUntil ? Date.parse(session.snoozedUntil) : NaN;
  const isSnoozed = Number.isFinite(snoozedUntilMs) && snoozedUntilMs > Date.now();
  const telemetry = useSessionLiveTelemetry(session.status === "working" || isSnoozed ? session.id : undefined);
  const canSettle = (session.status === "unread" || session.status === "error") && !session.settled;

  const refreshAfterOrganize = async (operation: () => Promise<unknown>): Promise<void> => {
    await operation();
    const state = useAppStore.getState();
    const cwd = state.settings?.activeWorkspace || session.cwd;
    if (cwd && typeof window !== "undefined" && typeof window.grokDesktop?.listSessions === "function") {
      const next = await window.grokDesktop.listSessions(cwd);
      if (useAppStore.getState().settings?.activeWorkspace === cwd) {
        useAppStore.getState().setSessions(next);
      }
    }
  };

  const api = typeof window !== "undefined" ? window.grokDesktop : undefined;
  const actions: UiAction[] = [
    ...(props.onOpenInSplit ? [{ id: "split", label: "分屏并排查看", icon: <UiIcon name="panel" />, run: props.onOpenInSplit }] : []),
    ...(props.onSettle && canSettle ? [{ id: "settle", label: "标记已阅收起", icon: <UiIcon name="check" />, run: props.onSettle }] : []),
    ...(typeof api?.setSessionUnread === "function" && session.status !== "working" && session.status !== "needs-user"
      ? [{
          id: "unread",
          label: session.status === "unread" ? "标记为已读" : "标记为未读",
          icon: <UiIcon name="sparkles" />,
          run: () => refreshAfterOrganize(() => api.setSessionUnread(session.id, session.status !== "unread")),
        }]
      : []),
    ...(typeof api?.snoozeSession === "function" && session.status !== "needs-user"
      ? [{
          id: "snooze",
          label: isSnoozed ? "取消稍后提醒" : "稍后提醒 (1 小时)",
          icon: <UiIcon name="clock" />,
          run: () =>
            refreshAfterOrganize(async () => {
              if (isSnoozed) {
                clearSessionTelemetrySnooze(session.id);
                await api.snoozeSession(session.id, null);
              } else {
                snoozeSessionTelemetry(session.id, 3_600_000);
                await api.snoozeSession(session.id, new Date(Date.now() + 3_600_000).toISOString());
              }
            }),
        }]
      : []),
    ...(typeof api?.setSessionSettleOnTurnEnd === "function" && session.status === "working"
      ? [{
          id: "settle-on-end",
          label: session.settleOnTurnEnd ? "取消本轮完成后自动收起" : "本轮完成后自动收起",
          icon: <UiIcon name="check" />,
          run: () => refreshAfterOrganize(() => api.setSessionSettleOnTurnEnd(session.id, !session.settleOnTurnEnd)),
        }]
      : []),
    { id: "pin", label: session.pinned ? "取消置顶" : "置顶", icon: <UiIcon name="pin" />, run: props.onPin },
    { id: "rename", label: "重命名", icon: <UiIcon name="edit" />, run: props.onRename },
    { id: "archive", label: session.archived ? "取消归档" : "归档", icon: <UiIcon name="archive" />, run: props.onArchive },
    { id: "export", label: "导出 Markdown", icon: <UiIcon name="download" />, run: props.onExport },
    { id: "delete", label: "删除", icon: <UiIcon name="trash" />, danger: true, run: props.onDelete },
  ];
  const onError = useAppStore((state) => state.setError);

  let meta = status.label || relativeTime(session.updatedAt);
  let metaTone = status.tone;
  if (telemetry?.isWorking) {
    if (telemetry.isStalled) {
      meta = `静默 ${Math.max(25, Math.floor(telemetry.quietMs / 1000))}s`;
      metaTone = "waiting";
    } else if (telemetry.summary) {
      meta = telemetry.elapsedMs >= 1000
        ? `${telemetry.summary} · ${formatTelemetryElapsed(telemetry.elapsedMs)}`
        : telemetry.summary;
    }
  } else if (isSnoozed && session.status !== "needs-user") {
    meta = "稍后提醒";
  }

  return (
    <ActionContextMenu actions={actions} onError={onError}>
      <div className={`sb-session${props.active ? " active" : ""}${session.archived ? " archived" : ""}${props.child ? " child" : ""}`} data-menu-open={props.menuOpen || undefined}>
        <button
          className="session-open"
          type="button"
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData("application/x-grok-session", JSON.stringify({ id: session.id, cwd: session.cwd, title: session.title }));
            event.dataTransfer.setData("text/plain", `@thread:${session.id}`);
          }}
          onClick={props.onOpen}
          aria-current={props.active ? "page" : undefined}
          aria-label={`${session.title}，${status.label || "空闲"}`}
        >
          {props.child ? <UiIcon name="bot" size={13} /> : <span className={`status-dot ${session.status}`} aria-hidden="true" />}
          <span className="sb-session-title" title={session.preview && session.preview !== session.title ? `${session.title}\n${session.preview}` : session.title}>{session.title}</span>
          {session.pinned && <UiIcon name="pin" size={11} className="sb-pin" aria-label="已置顶" />}
          {session.linkedIssue && (
            <em className="sb-session-source normal" title={session.linkedIssue.title || `Issue #${session.linkedIssue.number}`}>
              #{session.linkedIssue.number}
            </em>
          )}
          {sourceLabel && <em className={`sb-session-source ${session.originKind}`}>{sourceLabel}</em>}
          <span className={`sb-session-meta ${metaTone}`}>{meta}</span>
        </button>
        <ActionMenu
          actions={actions}
          open={props.menuOpen}
          onOpenChange={props.onMenu}
          onError={onError}
          trigger={<button type="button" className="sb-session-more" data-session-id={session.id} aria-label={`${session.title}的更多操作`}><UiIcon name="more" size={15} /></button>}
        />
      </div>
    </ActionContextMenu>
  );
});

export function sessionStatusPresentation(status: SessionSummary["status"]): { label: string; tone: string } {
  if (status === "working") return { label: "运行中", tone: "running" };
  if (status === "needs-user") return { label: "等待操作", tone: "waiting" };
  if (status === "queued") return { label: "等待处理", tone: "queued" };
  if (status === "unread") return { label: "后台已完成", tone: "complete" };
  if (status === "error") return { label: "运行失败", tone: "failed" };
  return { label: "", tone: "idle" };
}

/** Compact age for a dense list ("刚刚", "5 分", "2 小时", "3 天"). */
export function relativeTime(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "";
  const delta = Date.now() - time;
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时`;
  if (delta < 30 * 86_400_000) return `${Math.floor(delta / 86_400_000)} 天`;
  return `${Math.floor(delta / (30 * 86_400_000))} 月`;
}
