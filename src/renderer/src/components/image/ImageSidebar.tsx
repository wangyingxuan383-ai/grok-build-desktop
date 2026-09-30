import type { ImageConversation } from "../../../../shared/image-workspace";
import { UiIcon } from "../../ui-icons";
import { ActionMenu, ActionContextMenu, type UiAction } from "../ui/ActionMenu";
import { IconButton } from "../ui/Button";
import { ModeSwitch, type AppMode } from "../ModeSwitch";
import { newestFirst, sessionStats, whenLabel } from "./image-model";

export type ImageView = "session" | "gallery";

/** Sidebar for image mode: same frame, mode switch and footer as the coding sidebar, with image sessions in place of projects. */
export function ImageSidebar(props: {
  conversations: ImageConversation[];
  activeId: string;
  view: ImageView;
  outputRoot?: string;
  workCount: number;
  onMode(mode: AppMode): void;
  onNew(): void;
  onGallery(): void;
  onSelect(id: string): void;
  onRename(conversation: ImageConversation): void;
  onDelete(conversation: ImageConversation): void;
  onPickRoot(): void;
  onSettings?(): void;
  onAccounts?(): void;
  onDiagnostics?(): void;
}): React.JSX.Element {
  const rows = newestFirst(props.conversations);
  const actionsFor = (conversation: ImageConversation): UiAction[] => [
    { id: "rename", label: "重命名", icon: <UiIcon name="edit" />, run: () => props.onRename(conversation) },
    { id: "delete", label: "删除会话…", icon: <UiIcon name="trash" />, danger: true, separatorBefore: true, run: () => props.onDelete(conversation) },
  ];
  return (
    <aside className="sidebar image-sidebar">
      <ModeSwitch mode="image" onMode={props.onMode} />
      <nav className="sb-nav" aria-label="图像入口">
        <button type="button" className={`sb-nav-row is-primary${props.view === "session" && !props.activeId ? " current" : ""}`} onClick={props.onNew}><UiIcon name="new-chat" /><span>新建图像会话</span></button>
        <button type="button" className={`sb-nav-row${props.view === "gallery" ? " current" : ""}`} onClick={props.onGallery} aria-current={props.view === "gallery" ? "page" : undefined}><UiIcon name="images" /><span>图库</span><span className="sb-nav-tail">{props.workCount || ""}</span></button>
      </nav>
      <div className="sb-section-head"><span>图像会话</span></div>
      <div className="sb-scroll">
        {!rows.length && <div className="sb-hint">还没有图像会话。在右侧描述想要的画面，生成后会出现在这里。</div>}
        {rows.map((conversation) => {
          const stats = sessionStats(conversation);
          const active = props.view === "session" && props.activeId === conversation.id;
          return (
            <ActionContextMenu key={conversation.id} actions={actionsFor(conversation)}>
              <div className={`sb-session${active ? " active" : ""}`}>
                <button type="button" className="session-open" onClick={() => props.onSelect(conversation.id)} aria-current={active ? "page" : undefined} title={conversation.title}>
                  {stats.running ? <span className="status-dot working" aria-label="生成中" /> : <UiIcon name="image" size={14} />}
                  <span className="sb-session-title">{conversation.title}</span>
                  <span className={`sb-session-meta${stats.running ? " running" : stats.failed && !stats.works ? " failed" : ""}`}>{stats.running ? "生成中" : stats.works ? `${stats.works} 张` : whenLabel(conversation.updatedAt)}</span>
                </button>
                <ActionMenu
                  actions={actionsFor(conversation)}
                  trigger={<button type="button" className="sb-session-more" aria-label={`${conversation.title}的更多操作`}><UiIcon name="more" size={15} /></button>}
                />
              </div>
            </ActionContextMenu>
          );
        })}
      </div>
      <div className="sb-foot">
        <button type="button" className="sb-account" onClick={props.onPickRoot} title={props.outputRoot ? `图片保存在 ${props.outputRoot}` : "选择图片保存位置"}>
          <UiIcon name="folder" size={16} />
          <span className="sb-account-name">{props.outputRoot ? props.outputRoot.split(/[\\/]/).filter(Boolean).at(-1) : "图片保存位置"}</span>
        </button>
        {props.onAccounts && <IconButton icon="account" label="账号与用量" onClick={props.onAccounts} />}
        {props.onDiagnostics && <IconButton icon="alert" label="诊断" onClick={props.onDiagnostics} />}
        {props.onSettings && <IconButton icon="settings" label="设置" onClick={props.onSettings} />}
      </div>
    </aside>
  );
}
