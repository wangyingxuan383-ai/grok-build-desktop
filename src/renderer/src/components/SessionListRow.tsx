import { memo, useLayoutEffect, useRef } from "react";
import type { SessionSummary } from "../../../shared/types";
import { sessionSourceLabel } from "../session-groups";
import { UiIcon } from "../ui-icons";

export const SessionListRow = memo(function SessionListRow(props: {
  session: SessionSummary;
  active: boolean;
  menuOpen: boolean;
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
  const menuRef = useRef<HTMLDetailsElement>(null);
  const pendingFocus = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (props.menuOpen && pendingFocus.current !== null) {
      menuRef.current?.querySelectorAll<HTMLButtonElement>(".session-action-menu button:not(:disabled)")[pendingFocus.current]?.focus();
      pendingFocus.current = null;
    }
  }, [props.menuOpen]);
  const run = (event: React.MouseEvent<HTMLButtonElement>, action: () => void): void => {
    event.stopPropagation();
    props.onMenu(false);
    action();
  };
  const navigateMenu = (event: React.KeyboardEvent<HTMLElement>): void => {
    const details = event.currentTarget.closest("details") ?? (event.currentTarget instanceof HTMLDetailsElement ? event.currentTarget : null);
    if (event.key === "Escape") {
      event.preventDefault();
      props.onMenu(false);
      details?.querySelector<HTMLElement>("summary")?.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(details?.querySelectorAll<HTMLButtonElement>(".session-action-menu button:not(:disabled)") ?? []);
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : event.key === "ArrowDown" ? (current + 1 + buttons.length) % buttons.length : current < 0 ? buttons.length - 1 : (current - 1 + buttons.length) % buttons.length;
    if (props.menuOpen) buttons[index]?.focus();
    else { pendingFocus.current = index; props.onMenu(true); }
  };
  return <div className={`session-row ${session.archived ? "archived" : ""} ${props.active ? "active" : ""}`}>
    <button className="session-open" type="button" onClick={props.onOpen} aria-current={props.active ? "page" : undefined} aria-label={`${session.title}，${status.label || "空闲"}`}>
      <span className={`status-dot ${session.status}`} aria-hidden="true" />
      {session.pinned && <span className="pin-mark" aria-label="已置顶"><UiIcon name="pin" size={11}/></span>}
      <span className="session-copy">
        <strong>{session.title}{sourceLabel && <em className={`session-source-badge ${session.originKind}`}>{sourceLabel}</em>}</strong>
        {session.preview && session.preview !== session.title && <small className="session-preview" title={session.preview}>{session.preview}</small>}
        <span>{status.label && <><i className={`session-status-label ${status.tone}`}>{status.label}</i> · </>}{relativeTime(session.updatedAt)} · {session.messageCount} 条消息{session.archived ? " · 已归档" : ""}</span>
      </span>
    </button>
    <details ref={menuRef} className="session-actions" data-session-id={session.id} open={props.menuOpen} onKeyDown={navigateMenu}>
      <summary title="更多操作" aria-label={`${session.title}的更多操作`} aria-expanded={props.menuOpen} onClick={(event) => { event.preventDefault(); props.onMenu(!props.menuOpen); }}><UiIcon name="more" size={15}/></summary>
      <div className="session-action-menu" role="menu">
        <button role="menuitem" onClick={(event) => run(event, props.onPin)}><UiIcon name="pin"/>{session.pinned ? "取消置顶" : "置顶"}</button>
        <button role="menuitem" onClick={(event) => run(event, props.onArchive)}><UiIcon name="archive"/>{session.archived ? "取消归档" : "归档"}</button>
        <button role="menuitem" onClick={(event) => run(event, props.onExport)}><UiIcon name="download"/>导出 Markdown</button>
        <button role="menuitem" onClick={(event) => run(event, props.onRename)}><UiIcon name="edit"/>重命名</button>
        <button role="menuitem" className="danger-link" onClick={(event) => run(event, props.onDelete)}><UiIcon name="trash"/>删除</button>
      </div>
    </details>
  </div>;
});

export function sessionStatusPresentation(status: SessionSummary["status"]): { label: string; tone: string } {
  if (status === "working") return { label: "运行中", tone: "running" };
  if (status === "needs-user") return { label: "等待操作", tone: "waiting" };
  if (status === "queued") return { label: "等待处理", tone: "queued" };
  if (status === "unread") return { label: "后台已完成", tone: "complete" };
  if (status === "error") return { label: "运行失败", tone: "failed" };
  return { label: "", tone: "idle" };
}

function relativeTime(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "未知时间";
  const delta = Date.now() - time;
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  return `${Math.floor(delta / 86_400_000)} 天前`;
}
