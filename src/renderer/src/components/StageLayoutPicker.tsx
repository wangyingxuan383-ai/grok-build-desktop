import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  Columns2,
  Grid2x2,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  Radio,
  Rows2,
  Square,
  SquareTerminal,
  X,
} from "lucide-react";
import {
  MAX_LAYOUT_GROUPS,
  type GridPreset,
  type LayoutGroup,
  type PaneSurfaceMode,
} from "../workspace-layout";

export interface StageLayoutPickerProps {
  currentPreset: GridPreset | "custom";
  paneCount: number;
  zoomed: boolean;
  focusedSurfaceMode: PaneSurfaceMode;
  groups: LayoutGroup[];
  activeGroupId: string;
  broadcastOpen: boolean;
  attentionGroupIds?: ReadonlySet<string>;
  onApplyPreset(preset: GridPreset): void;
  onToggleZoom(): void;
  onToggleSurfaceMode(): void;
  onSelectGroup(groupId: string): void;
  onCreateGroup(): void;
  onCloseGroup(groupId: string): void;
  onRenameGroup(groupId: string, name: string): void;
  onToggleBroadcast(): void;
}

const PRESETS: ReadonlyArray<{ id: GridPreset; label: string; hint: string }> = [
  { id: "1x1", label: "单栏 1×1", hint: "专注单会话视图" },
  { id: "1x2", label: "左右 1×2", hint: "双会话并排对照" },
  { id: "2x1", label: "上下 2×1", hint: "上下分屏联动" },
  { id: "2x2", label: "四宫格 2×2", hint: "四路 Agent 空间舞台" },
];

function PresetGlyph({ preset }: { preset: GridPreset }): React.JSX.Element {
  if (preset === "1x1") return <Square size={13} />;
  if (preset === "1x2") return <Columns2 size={13} />;
  if (preset === "2x1") return <Rows2 size={13} />;
  return <Grid2x2 size={13} />;
}

export function StageLayoutPicker({
  currentPreset,
  paneCount,
  zoomed,
  focusedSurfaceMode,
  groups,
  activeGroupId,
  broadcastOpen,
  attentionGroupIds,
  onApplyPreset,
  onToggleZoom,
  onToggleSurfaceMode,
  onSelectGroup,
  onCreateGroup,
  onCloseGroup,
  onRenameGroup,
  onToggleBroadcast,
}: StageLayoutPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string>("");
  const [draftName, setDraftName] = useState("");

  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? groups[0];
  const hasBackgroundAttention = groups.some((g) => g.id !== activeGroupId && attentionGroupIds?.has(g.id));

  const commitRename = (groupId: string): void => {
    if (draftName.trim()) onRenameGroup(groupId, draftName.trim());
    setEditingGroupId("");
    setDraftName("");
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`ui-btn ui-btn-ghost ui-btn-sm stage-picker-trigger${paneCount > 1 || groups.length > 1 ? " is-active" : ""}${hasBackgroundAttention ? " has-attention" : ""}`}
          title="空间舞台布局与工作组 (Alt+1..4 切窗格 · Ctrl+Alt+[/] 切组)"
          aria-label="空间舞台布局与工作组"
        >
          <Grid2x2 size={13} />
          <span className="stage-picker-name">{activeGroup?.name || "舞台"}</span>
          <small className="stage-picker-badge">{currentPreset === "custom" ? `${paneCount}格` : currentPreset}</small>
          {hasBackgroundAttention && <span className="stage-attention-dot" aria-hidden="true" />}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          className="ui-popover stage-layout-popover"
          align="end"
          sideOffset={6}
          collisionPadding={10}
        >
          <section className="stage-popover-section">
            <div className="stage-popover-head">
              <strong>空间网格预设</strong>
              <span className="ui-kbd">Alt+1..4 聚焦</span>
            </div>
            <div className="stage-preset-grid">
              {PRESETS.map((preset) => {
                const active = currentPreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`stage-preset-card${active ? " active" : ""}`}
                    aria-pressed={active}
                    title={preset.hint}
                    onClick={() => {
                      onApplyPreset(preset.id);
                      setOpen(false);
                    }}
                  >
                    <PresetGlyph preset={preset.id} />
                    <div>
                      <strong>{preset.label}</strong>
                      <small>{preset.hint}</small>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="stage-popover-section bordered">
            <div className="stage-popover-head">
              <strong>当前窗格快捷操作</strong>
            </div>
            <div className="stage-quick-actions">
              <button
                type="button"
                className={`ui-btn ui-btn-secondary ui-btn-sm${focusedSurfaceMode === "pty" ? " is-active" : ""}`}
                onClick={() => {
                  onToggleSurfaceMode();
                  setOpen(false);
                }}
                title="在当前窗格翻转对话与交互终端 (Ctrl+`)"
              >
                <SquareTerminal size={12} />
                <span>{focusedSurfaceMode === "pty" ? "切回对话" : "翻转终端"}</span>
                <kbd className="ui-kbd">Ctrl+`</kbd>
              </button>

              <button
                type="button"
                className="ui-btn ui-btn-secondary ui-btn-sm"
                disabled={paneCount <= 1 && !zoomed}
                onClick={() => {
                  onToggleZoom();
                  setOpen(false);
                }}
                title="临时最大化或还原当前焦点窗格 (Ctrl+Shift+Enter)"
              >
                {zoomed ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                <span>{zoomed ? "还原分屏" : "放大窗格"}</span>
              </button>

              <button
                type="button"
                className={`ui-btn ui-btn-secondary ui-btn-sm${broadcastOpen ? " is-active" : ""}`}
                disabled={paneCount <= 1 && !broadcastOpen}
                onClick={() => {
                  onToggleBroadcast();
                  setOpen(false);
                }}
                title="向当前舞台所有打开的会话同时广播指令 (Ctrl+Alt+B)"
              >
                <Radio size={12} />
                <span>舞台广播</span>
              </button>
            </div>
          </section>

          <section className="stage-popover-section bordered">
            <div className="stage-popover-head">
              <strong>
                布局场景组 ({groups.length}/{MAX_LAYOUT_GROUPS})
              </strong>
              <button
                type="button"
                className="ui-btn ui-btn-ghost ui-btn-sm"
                disabled={groups.length >= MAX_LAYOUT_GROUPS}
                onClick={onCreateGroup}
                title="新建独立并行场景组（最多 8 组，Ctrl+Alt+[ / ] 切换）"
              >
                <Plus size={12} />
                <span>新建组</span>
              </button>
            </div>

            <div className="stage-group-list">
              {groups.map((group, idx) => {
                const isCurrent = group.id === activeGroupId;
                const isEditing = editingGroupId === group.id;
                const needsAttention = attentionGroupIds?.has(group.id);
                return (
                  <div
                    key={group.id}
                    className={`stage-group-row${isCurrent ? " active" : ""}`}
                  >
                    {isEditing ? (
                      <input
                        className="ui-input stage-group-input"
                        autoFocus
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onBlur={() => commitRename(group.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename(group.id);
                          else if (e.key === "Escape") setEditingGroupId("");
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="stage-group-select"
                        onClick={() => {
                          onSelectGroup(group.id);
                          setOpen(false);
                        }}
                      >
                        <span className="stage-group-index">{idx + 1}</span>
                        <span className="stage-group-name">{group.name}</span>
                        {needsAttention && <span className="stage-attention-dot" title="此场景组存在待确认会话" />}
                      </button>
                    )}

                    <div className="stage-group-actions">
                      <button
                        type="button"
                        className="ui-icon-btn ui-icon-btn-sm"
                        aria-label={`重命名 ${group.name}`}
                        title="重命名场景组"
                        onClick={() => {
                          setEditingGroupId(group.id);
                          setDraftName(group.name);
                        }}
                      >
                        <Pencil size={11} />
                      </button>
                      {groups.length > 1 && (
                        <button
                          type="button"
                          className="ui-icon-btn ui-icon-btn-sm"
                          aria-label={`关闭 ${group.name}`}
                          title="关闭此场景组（不会删除后台会话）"
                          onClick={() => onCloseGroup(group.id)}
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <small className="stage-popover-hint">
              快捷键：Ctrl+Alt+[ / ] 切换场景组 · 双击分隔条恢复 50% 比例
            </small>
          </section>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
