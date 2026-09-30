import { memo } from "react";
import type { SessionSummary } from "../../../shared/types";
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
  const actions: UiAction[] = [
    { id: "pin", label: session.pinned ? "取消置顶" : "置顶", icon: <UiIcon name="pin" />, run: props.onPin },
    { id: "rename", label: "重命名", icon: <UiIcon name="edit" />, run: props.onRename },
    { id: "archive", label: session.archived ? "取消归档" : "归档", icon: <UiIcon name="archive" />, run: props.onArchive },
    { id: "export", label: "导出 Markdown", icon: <UiIcon name="download" />, run: props.onExport },
    { id: "delete", label: "删除", icon: <UiIcon name="trash" />, danger: true, run: props.onDelete },
  ];
  const onError = useAppStore((state) => state.setError);
  const meta = status.label || relativeTime(session.updatedAt);
  return (
    <ActionContextMenu actions={actions} onError={onError}>
      <div className={`sb-session${props.active ? " active" : ""}${session.archived ? " archived" : ""}${props.child ? " child" : ""}`} data-menu-open={props.menuOpen || undefined}>
        <button className="session-open" type="button" onClick={props.onOpen} aria-current={props.active ? "page" : undefined} aria-label={`${session.title}，${status.label || "空闲"}`}>
          {props.child ? <UiIcon name="bot" size={13} /> : <span className={`status-dot ${session.status}`} aria-hidden="true" />}
          <span className="sb-session-title" title={session.preview && session.preview !== session.title ? `${session.title}\n${session.preview}` : session.title}>{session.title}</span>
          {session.pinned && <UiIcon name="pin" size={11} className="sb-pin" aria-label="已置顶" />}
          {sourceLabel && <em className={`sb-session-source ${session.originKind}`}>{sourceLabel}</em>}
          <span className={`sb-session-meta ${status.tone}`}>{meta}</span>
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
