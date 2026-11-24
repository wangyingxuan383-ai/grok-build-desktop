import { ActionMenu } from "./ui/ActionMenu";
import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Attachment, CommandInfo, McpToolSelection, SessionMcpToolSnapshot, ComposerCapabilitySelection, ComputerTaskState, ModelInfo, NewTaskDraft, ReasoningEffort, SessionExecutionAssignment, SessionForkResult, SessionMode, SessionSummary, SkillSummary, WorkspaceFileCandidate } from "../../../shared/types";
import { normalizeSkillCommand } from "../../../shared/composer-capability";
import { effortControlState } from "../model-capabilities";
import { SESSION_MODE_OPTIONS } from "../session-mode-labels";
import type { ReviewCommentDraft } from "../review-comments";
import { useAppStore } from "../store";
import { UiIcon } from "../ui-icons";
import { useSessionContext } from "../hooks/use-session-context";
import { sessionContextDisplay } from "../../../shared/session-context";
import { PromptQueueStack } from "./PromptQueueStack";
import { detectSecrets, redactDetectedSecrets, SecretGuardBar } from "./SecretGuardBar";

const LazyWorktreeModePicker = lazy(() =>
  import("./WorktreeModePicker").then((module) => ({ default: module.WorktreeModePicker })),
);

export const AUTO_ATTACHMENT_PASTE_BYTES = 32 * 1024;
const BUSY_DEFAULT_ACTION_KEY = "grok.composer-busy-default.v1";

export function Composer(props: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  text: string;
  setText(value: string): void;
  busy: boolean;
  controlsDisabled: boolean;
  /** Plan approval is an ACP waiting state, but official Grok permits model
   * changes before the decision is submitted. Keep other waiting states locked. */
  modelControlsDisabled?: boolean;
  sessionId: string;
  attachments: ReturnType<typeof useAppStore.getState>["attachments"];
  reviewComments: ReviewCommentDraft[];
  notice?: string;
  onDismissNotice(): void;
  commandMatches: Array<{ name: string; description?: string }>;
  fileMatches: WorkspaceFileCandidate[];
  onMentionTerminal?(): void;
  view: ReturnType<typeof useAppStore.getState>["views"][string] | undefined;
  draft?: NewTaskDraft;
  draftModels?: ModelInfo[];
  draftModelsLoading?: boolean;
  onRefreshDraftModels?(): void;
  onDraftChange?(patch: Partial<NewTaskDraft>): void;
  workspacePath?: string;
  session?: SessionSummary;
  assignment?: SessionExecutionAssignment;
  onForked?(result: SessionForkResult): void;
  onError?(message: string): void;
  onSend(): void;
  onInterject(): void;
  onSendBackgroundNewDraft?(): void;
  /** Non-blocking x.ai/btw side question advertised by the current CLI. */
  btwAvailable?: boolean;
  onBtw?(): void;
  onBlockedSubmit(): void;
  onStop(): void;
  onAdd(): void;
  onAddFolders(): void;
  onPaste(files: File[]): void;
  onPasteText(text: string): void;
  onConvertText(): void;
  onSnippets?(): void;
  onRestoreText(attachment: Attachment): void;
  onRemove(id: string): void;
  onRemoveReviewComment(id: string): void;
  onCommand(name: string): void;
  onFile(file: WorkspaceFileCandidate): void;
  onFileMenu(): void;
  capability?: ComposerCapabilitySelection;
  computerTask: ComputerTaskState | null;
  onCapability(value: ComposerCapabilitySelection): void;
  onComputer(): void;
  onImage?(): void;
  onClearCapability(): void;
  onManageExtensions(): void;
  onHistory(direction: -1 | 1): void;
  onControlSettled(): void;
}): React.JSX.Element {
  const [addOpen, setAddOpen] = useState(false);
  const [busyPrimary, setBusyPrimary] = useState<"queue" | "steer">(() => {
    try {
      return localStorage.getItem(BUSY_DEFAULT_ACTION_KEY) === "steer" ? "steer" : "queue";
    } catch {
      return "queue";
    }
  });
  const [pendingLargeSecretPaste, setPendingLargeSecretPaste] = useState<string | null>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [menuDismissedForText, setMenuDismissedForText] = useState("");

  useEffect(() => {
    setAddOpen(false);
    setPendingLargeSecretPaste(null);
    setMenuIndex(0);
    setMenuDismissedForText("");
  }, [props.sessionId, props.draft?.projectId]);

  useEffect(() => {
    setMenuIndex(0);
  }, [props.commandMatches.length, props.fileMatches.length, props.text]);

  const toggleBusyPrimary = (next: "queue" | "steer"): void => {
    setBusyPrimary(next);
    try {
      localStorage.setItem(BUSY_DEFAULT_ACTION_KEY, next);
    } catch {
      // Ignore storage error
    }
  };

  const composingRef = useRef(false);
  const { info: contextInfo } = useSessionContext(props.view ? props.sessionId : undefined);
  const context = sessionContextDisplay(contextInfo);
  const percent = context.percent ?? 0;
  const tokenLabel = context.used !== undefined && context.total !== undefined
    ? `${formatTokens(context.used)} / ${formatTokens(context.total)}`
    : context.percent !== undefined ? `上下文 ${context.percent.toFixed(1)}%` : "";

  const showTerminalMention = useMemo(() => {
    if (!props.onMentionTerminal) return false;
    const match = props.text.match(/(?:^|\s)@([^\s@]{0,80})$/u);
    if (!match) return false;
    const q = (match[1] ?? "").toLowerCase();
    return q === "" || "terminal".startsWith(q) || "终端".includes(q);
  }, [props.onMentionTerminal, props.text]);

  const showSlashMenu = props.commandMatches.length > 0 && menuDismissedForText !== props.text;
  const mentionItems = useMemo(() => {
    if (menuDismissedForText === props.text) return [];
    const items: Array<{ key: string; kind: "terminal" | "file"; file?: WorkspaceFileCandidate }> = [];
    if (showTerminalMention && props.onMentionTerminal) {
      items.push({ key: "@terminal", kind: "terminal" });
    }
    for (const file of props.fileMatches) {
      items.push({ key: file.path, kind: "file", file });
    }
    return items;
  }, [menuDismissedForText, props.fileMatches, props.onMentionTerminal, props.text, showTerminalMention]);

  const triggerBusyDefault = (): void => {
    if (busyPrimary === "steer") props.onInterject();
    else props.onSend();
  };
  const triggerBusyInverted = (): void => {
    if (busyPrimary === "steer") props.onSend();
    else props.onInterject();
  };

  return (
    <div className="composer-zone">
      {props.notice && (
        <div className="composer-operation-notice" role="status">
          <span>{props.notice}</span>
          <button type="button" aria-label="关闭提示" title="关闭提示" onClick={props.onDismissNotice}>×</button>
        </div>
      )}
      {props.view?.modelSelectionRequired && (
        <div className="composer-operation-notice waiting" role="status">{props.view.modelSelectionRequired}</div>
      )}
      {props.view?.status === "needs-user" && (
        <div className="composer-operation-notice waiting" role="status">请先处理当前计划、权限或问题卡片，然后再发送消息。</div>
      )}
      {props.view?.queue.length ? <PromptQueueStack sessionId={props.sessionId} entries={props.view.queue} /> : null}

      <SecretGuardBar
        text={props.text}
        onRedact={(redacted) => props.setText(redacted)}
        pendingLargePaste={
          pendingLargeSecretPaste !== null
            ? {
                text: pendingLargeSecretPaste,
                onConfirmRedacted: () => {
                  const { text: clean } = redactDetectedSecrets(pendingLargeSecretPaste);
                  setPendingLargeSecretPaste(null);
                  props.onPasteText(clean);
                },
                onConfirmRaw: () => {
                  const raw = pendingLargeSecretPaste;
                  setPendingLargeSecretPaste(null);
                  props.onPasteText(raw);
                },
                onCancel: () => setPendingLargeSecretPaste(null),
              }
            : undefined
        }
      />

      {props.reviewComments.length > 0 && (
        <div className="review-comment-drafts">
          <span>审核批注草稿</span>
          {props.reviewComments.map((comment) => (
            <button key={comment.id} title={comment.body} onClick={() => props.onRemoveReviewComment(comment.id)}>
              <code>{comment.path}:L{comment.line}</code><span>{comment.body}</span><b>×</b>
            </button>
          ))}
        </div>
      )}

      {showSlashMenu && (
        <div className="slash-menu" role="listbox" aria-label="斜杠命令补全">
          {props.commandMatches.map((command, idx) => (
            <button
              key={command.name}
              type="button"
              role="option"
              aria-selected={idx === menuIndex}
              className={idx === menuIndex ? "active" : undefined}
              onMouseEnter={() => setMenuIndex(idx)}
              onClick={() => props.onCommand(command.name)}
            >
              <strong>/{command.name.replace(/^\//, "")}</strong><span>{command.description}</span>
            </button>
          ))}
        </div>
      )}

      {!showSlashMenu && mentionItems.length > 0 && (
        <div className="slash-menu file-menu" role="listbox" aria-label="工作区引用补全">
          {mentionItems.map((item, idx) =>
            item.kind === "terminal" && props.onMentionTerminal ? (
              <button
                key="@terminal"
                type="button"
                role="option"
                aria-selected={idx === menuIndex}
                className={idx === menuIndex ? "active" : undefined}
                onMouseEnter={() => setMenuIndex(idx)}
                onClick={props.onMentionTerminal}
              >
                <strong>@terminal</strong>
                <span>附加当前工作区终端最近输出作为上下文</span>
              </button>
            ) : item.file ? (
              <button
                key={item.file.path}
                type="button"
                role="option"
                aria-selected={idx === menuIndex}
                className={idx === menuIndex ? "active" : undefined}
                onMouseEnter={() => setMenuIndex(idx)}
                onClick={() => props.onFile(item.file!)}
              >
                <strong>@{item.file.name}</strong><span>{item.file.relativePath}</span>
              </button>
            ) : null,
          )}
        </div>
      )}

      {addOpen && createPortal(
        <AddPalette
          sessionId={props.sessionId}
          onMcp={(selection) => {
            setAddOpen(false);
            props.onCapability({ kind: "mcp", label: `${selection.serverName} / ${selection.toolName}`, command: "", selection, source: selection.serverName });
            props.onControlSettled();
          }}
          commands={props.view?.commands ?? []}
          onCommand={(name) => { setAddOpen(false); props.onCommand(name); }}
          onImage={props.onImage ? () => { setAddOpen(false); props.onImage?.(); } : undefined}
          onClose={() => { setAddOpen(false); props.onControlSettled(); }}
          onFiles={() => { setAddOpen(false); props.onAdd(); }}
          onFolders={() => { setAddOpen(false); props.onAddFolders(); }}
          onWorkspaceFile={() => { setAddOpen(false); props.onFileMenu(); }}
          onComputer={() => { setAddOpen(false); props.onComputer(); }}
          onSkill={(skill) => {
            setAddOpen(false);
            props.onCapability({ kind: "skill", label: skill.name, command: normalizeSkillCommand(skill.command), source: skill.source });
            props.onControlSettled();
          }}
          onManageExtensions={() => { setAddOpen(false); props.onManageExtensions(); }}
        />,
        document.getElementById("overlay-root")!,
      )}

      <div className="composer">
        {(props.attachments.length > 0 || props.capability) && (
          <div className="attachment-row">
            {props.capability && (
              <span className={`capability-chip ${props.capability.kind}`}>
                {props.capability.kind === "computer" ? "◉" : "✦"} {props.capability.kind === "mcp" ? "MCP · " : "@"}{props.capability.label}
                <small>仅本次消息</small>
                <button title="移除能力" aria-label="移除能力" onClick={props.onClearCapability}>×</button>
              </span>
            )}
            {props.attachments.map((attachment) => {
              const textDraft = attachment.kind === "file" && attachment.mimeType?.startsWith("text/plain") && Boolean(attachment.draftText || attachment.data);
              const preview = attachment.previewText || (attachment.data ? textAttachmentPreview(attachment.data) : "本地文本草稿");
              return (
                <span className={attachment.kind === "image" ? "composer-image-chip" : textDraft ? "composer-text-chip" : ""} key={attachment.id}>
                  {attachment.kind === "image" ? (
                    <img src={attachment.data ? `data:${attachment.mimeType || "image/png"};base64,${attachment.data}` : attachment.path ? localFileUrl(attachment.path) : ""} alt="" />
                  ) : attachment.kind === "folder" ? "▰" : "▤"}
                  <span>{attachment.name}{textDraft && <small>{attachment.size?.toLocaleString()} 字节 · {preview}</small>}</span>
                  {textDraft && <button title="恢复为输入框正文" aria-label="恢复为输入框正文" onClick={() => props.onRestoreText(attachment)}>恢复正文</button>}
                  <button title={`移除 ${attachment.name}`} aria-label={`移除 ${attachment.name}`} onClick={() => props.onRemove(attachment.id)}>×</button>
                </span>
              );
            })}
          </div>
        )}

        <textarea
          ref={props.inputRef}
          value={props.text}
          aria-keyshortcuts="Enter Control+Enter Control+Alt+Enter"
          onChange={(event) => props.setText(event.target.value)}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-grok-session")) event.preventDefault(); }}
          onDrop={(event) => {
            if (!event.dataTransfer.types.includes("application/x-grok-session")) return;
            event.preventDefault();
            event.stopPropagation();
            try {
              const raw = JSON.parse(event.dataTransfer.getData("application/x-grok-session")) as { id?: string };
              if (raw?.id) props.setText(`${props.text}${props.text && !/\s$/.test(props.text) ? " " : ""}@thread:${raw.id} `);
            } catch { /* ignore invalid drag payload */ }
          }}
          onPaste={(event) => {
            const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
            if (images.length) {
              event.preventDefault();
              props.onPaste(images);
              return;
            }
            const text = event.clipboardData.getData("text/plain");
            const byteLength = text ? new TextEncoder().encode(text).byteLength : 0;
            if (byteLength > AUTO_ATTACHMENT_PASTE_BYTES) {
              event.preventDefault();
              if (detectSecrets(text).length > 0) {
                setPendingLargeSecretPaste(text);
              } else {
                props.onPasteText(text);
              }
            }
          }}
          onKeyDown={(event) => {
            if (event.altKey && !event.ctrlKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
              event.preventDefault();
              props.onHistory(event.key === "ArrowUp" ? -1 : 1);
              return;
            }
            const activeCount = showSlashMenu ? props.commandMatches.length : mentionItems.length;
            if (activeCount > 0 && !event.nativeEvent.isComposing && !composingRef.current) {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const delta = event.key === "ArrowDown" ? 1 : -1;
                setMenuIndex((cur) => (cur + delta + activeCount) % activeCount);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setMenuDismissedForText(props.text);
                return;
              }
              if ((event.key === "Tab" || (event.key === "Enter" && !event.ctrlKey && !event.altKey && !event.shiftKey)) && activeCount > 0) {
                if (showSlashMenu) {
                  const chosen = props.commandMatches[Math.min(menuIndex, props.commandMatches.length - 1)];
                  const normalizedCmd = chosen ? `/${chosen.name.replace(/^\//, "")}` : "";
                  if (chosen && (event.key === "Tab" || props.text.trim().toLowerCase() !== normalizedCmd.toLowerCase())) {
                    event.preventDefault();
                    props.onCommand(chosen.name);
                    return;
                  }
                } else {
                  const chosen = mentionItems[Math.min(menuIndex, mentionItems.length - 1)];
                  if (chosen) {
                    event.preventDefault();
                    if (chosen.kind === "terminal") props.onMentionTerminal?.();
                    else if (chosen.file) props.onFile(chosen.file);
                    return;
                  }
                }
              }
            }
            if (event.key !== "Enter" || event.nativeEvent.isComposing || composingRef.current || event.nativeEvent.keyCode === 229) {
              return;
            }
            if (pendingLargeSecretPaste !== null) {
              event.preventDefault();
              return;
            }
            if (event.ctrlKey && event.altKey && !event.shiftKey) {
              event.preventDefault();
              if (props.view?.modelSelectionRequired) return;
              if (props.controlsDisabled) props.onBlockedSubmit();
              else if (props.onSendBackgroundNewDraft) props.onSendBackgroundNewDraft();
              else props.onSend();
              return;
            }
            if (event.ctrlKey && !event.altKey && !event.shiftKey) {
              event.preventDefault();
              if (props.view?.modelSelectionRequired) return;
              if (props.controlsDisabled) props.onBlockedSubmit();
              else if (props.busy) triggerBusyInverted();
              else props.onSend();
              return;
            }
            if (!event.shiftKey && !event.altKey) {
              event.preventDefault();
              if (props.view?.modelSelectionRequired) return;
              if (props.controlsDisabled) props.onBlockedSubmit();
              else if (props.busy) triggerBusyDefault();
              else props.onSend();
            }
          }}
          placeholder={
            props.controlsDisabled
              ? "可以继续输入；请先处理当前计划、权限或问题再发送…"
              : props.busy
                ? busyPrimary === "queue"
                  ? "继续输入；Enter 排队，Ctrl+Enter 立即转向当前回合，Ctrl+Alt+Enter 后台发送并新建草稿…"
                  : "继续输入；Enter 立即转向当前回合，Ctrl+Enter 改为排队，Ctrl+Alt+Enter 后台发送并新建草稿…"
                : "给 Grok 发送消息…（支持 @terminal、/clear、Ctrl+Alt+Enter 后台发送）"
          }
        />

        <div className="composer-toolbar">
          <div className="toolbar-left">
            {props.onSnippets && <button className="icon-button" type="button" title="提示词片段" aria-label="提示词片段" onClick={props.onSnippets}><UiIcon name="file"/></button>}
            <button className="icon-button add-button" title="添加文件或能力" aria-label="添加文件或能力" aria-expanded={addOpen} aria-haspopup="dialog" disabled={props.controlsDisabled} onClick={() => setAddOpen(!addOpen)}><UiIcon name="plus"/></button>
            {props.text.length > 0 && <button className="composer-text-convert" title="将当前正文转换为 .txt 附件" aria-label="将当前正文转换为 .txt 附件" onClick={props.onConvertText}>转为附件</button>}
            <TokenDonut percent={percent} label={tokenLabel} title={context.percent === undefined ? "上下文占用未知：会话连接 CLI 并完成一轮后显示" : "当前上下文占用，与累计用量分别统计"} />
            {props.workspacePath && <Suspense fallback={null}><LazyWorktreeModePicker workspacePath={props.workspacePath} sessionId={props.sessionId || undefined} session={props.session} assignment={props.assignment} draft={props.draft} disabled={props.controlsDisabled} onDraftChange={props.onDraftChange} onForked={props.onForked} onError={props.onError} /></Suspense>}
            {props.view ? <ModelControls sessionId={props.sessionId} view={props.view} disabled={props.modelControlsDisabled ?? (props.controlsDisabled || props.busy)} onSettled={props.onControlSettled} /> : props.draft && props.onDraftChange ? <DraftModelControls draft={props.draft} models={props.draftModels ?? []} loading={props.draftModelsLoading === true} disabled={props.modelControlsDisabled ?? props.controlsDisabled} onRefresh={props.onRefreshDraftModels} onChange={props.onDraftChange} /> : null}
          </div>
          {props.busy ? (
            <ComposerRunActions
              canSubmit={pendingLargeSecretPaste === null && !props.view?.modelSelectionRequired && !props.controlsDisabled && Boolean(props.text.trim() || props.attachments.length || props.reviewComments.length)}
              canAskAside={pendingLargeSecretPaste === null && !props.view?.modelSelectionRequired && !props.controlsDisabled && !props.capability && Boolean(props.text.trim())}
              btwAvailable={Boolean(props.btwAvailable && props.onBtw)}
              busyPrimary={busyPrimary}
              onChangeBusyPrimary={toggleBusyPrimary}
              onQueue={props.onSend}
              onInterject={props.onInterject}
              onSendBackgroundNewDraft={props.onSendBackgroundNewDraft}
              onBtw={props.onBtw}
              onStop={props.onStop}
            />
          ) : (
            <button className="send-button" title="发送 (Enter · Ctrl+Alt+Enter 后台发送并新建草稿)" aria-label="发送" disabled={pendingLargeSecretPaste !== null || Boolean(props.view?.modelSelectionRequired) || props.controlsDisabled || (!props.text.trim() && !props.attachments.length && !props.reviewComments.length)} onClick={props.onSend}><UiIcon name="send"/></button>
          )}
        </div>
      </div>
    </div>
  );
}

export const ComposerRunActions = memo(function ComposerRunActions(props: {
  canSubmit: boolean;
  canAskAside: boolean;
  btwAvailable: boolean;
  busyPrimary?: "queue" | "steer";
  onChangeBusyPrimary?(mode: "queue" | "steer"): void;
  onQueue(): void;
  onInterject(): void;
  onSendBackgroundNewDraft?(): void;
  onBtw?(): void;
  onStop(): void;
}): React.JSX.Element {
  const primaryIsSteer = props.busyPrimary === "steer";
  return (
    <div className="busy-send-actions" aria-label="当前回合操作">
      <button
        className="queue-send primary-action"
        disabled={!props.canSubmit}
        onClick={primaryIsSteer ? props.onInterject : props.onQueue}
      >
        {primaryIsSteer ? "⚡ 立即转向" : "加入队列"}
      </button>
      <ActionMenu
        trigger={<button className="icon-button" aria-label="更多发送方式"><UiIcon name="chevron-down" size={13}/></button>}
        actions={[
          primaryIsSteer
            ? { id: "queue", label: "加入队列（不打断当前回合）", shortcut: "Ctrl+Enter", disabled: !props.canSubmit, run: props.onQueue }
            : { id: "interject", label: "⚡ 立即转向当前回合", shortcut: "Ctrl+Enter", disabled: !props.canSubmit, run: props.onInterject },
          ...(props.onSendBackgroundNewDraft ? [{ id: "bg-new", label: "后台发送并开启新草稿", shortcut: "Ctrl+Alt+Enter", disabled: !props.canSubmit, run: props.onSendBackgroundNewDraft }] : []),
          ...(props.btwAvailable && props.onBtw ? [{ id: "aside", label: "旁路提问 (/btw)", disabled: !props.canAskAside, run: props.onBtw }] : []),
          ...(props.onChangeBusyPrimary ? [{ id: "toggle-default", label: primaryIsSteer ? "恢复 Enter 默认排队" : "设 Enter 默认立即转向", separatorBefore: true, run: () => props.onChangeBusyPrimary!(primaryIsSteer ? "queue" : "steer") }] : []),
        ]}
      />
      <button className="send-button stop" title="停止当前回合" aria-label="停止当前回合" onClick={props.onStop}><UiIcon name="stop"/></button>
    </div>
  );
});

function DraftModelControls({ draft, models, loading, disabled, onRefresh, onChange }: { draft: NewTaskDraft; models: ModelInfo[]; loading: boolean; disabled: boolean; onRefresh?(): void; onChange(patch: Partial<NewTaskDraft>): void }): React.JSX.Element {
  const values = Array.from(new Map([...models, ...(draft.modelId && !models.some((model) => model.modelId === draft.modelId) ? [{ modelId: draft.modelId, name: draft.modelId }] : [])].map((model) => [model.modelId, model])).values());
  const effort = effortControlState(values, draft.modelId || values[0]?.modelId, draft.effort ?? "");
  return <div className="model-controls draft-model-controls" aria-label="新任务草稿配置">
    <select aria-label="草稿模型" className="model-select" disabled={disabled || (loading && !values.length)} value={draft.modelId ?? ""} onChange={(event) => {
      const modelId = event.target.value || undefined;
      const selected = values.find((model) => model.modelId === modelId);
      const nextEffort = effortControlState(values, modelId || values[0]?.modelId, "");
      onChange({ modelId, providerId: selected?.providerId, effort: draft.effort && nextEffort.options.some((item) => item.value === draft.effort) ? draft.effort : undefined });
    }}><option value="">{loading && !values.length ? "正在读取模型目录…" : "桌面默认模型"}</option>{values.map((model) => <option key={model.modelId} value={model.modelId}>{model.name}</option>)}</select>
    <select aria-label="草稿推理强度" className="effort-select" disabled={disabled || !effort.supported} title={effort.reason} value={draft.effort ?? ""} onChange={(event) => onChange({ effort: event.target.value as ReasoningEffort })}><option value="">CLI 默认</option>{effort.options.map((item) => <option key={item.value} value={item.value} title={item.description}>{item.label}</option>)}</select>
    <select aria-label="草稿执行模式" className={`mode-select ${draft.mode ?? "agent"}`} disabled={disabled} value={draft.mode ?? "agent"} onChange={(event) => onChange({ mode: event.target.value as SessionMode })}>{SESSION_MODE_OPTIONS.map(option => <option key={option.value} value={option.value} title={option.description}>{option.label}</option>)}</select>
    {onRefresh && <button type="button" className="icon-button" title={loading ? "正在刷新模型目录" : "刷新模型目录"} aria-label={loading ? "正在刷新模型目录" : "刷新模型目录"} disabled={loading || disabled} onClick={onRefresh}><UiIcon name="refresh" size={13}/></button>}
  </div>;
}

export function AddPalette({ sessionId, onMcp, commands, onCommand, onImage, onClose, onFiles, onFolders, onWorkspaceFile, onComputer, onSkill, onManageExtensions }: { sessionId?: string; onMcp?(selection: McpToolSelection): void; commands: CommandInfo[]; onCommand(name: string): void; onImage?(): void; onClose(): void; onFiles(): void; onFolders(): void; onWorkspaceFile(): void; onComputer(): void; onSkill(skill: SkillSummary): void; onManageExtensions(): void }): React.JSX.Element {
  const [query,setQuery]=useState("");
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [mcp, setMcp] = useState<SessionMcpToolSnapshot>();
  const [mcpError, setMcpError] = useState("");
  const [mcpRefresh, setMcpRefresh] = useState(0);
  useEffect(() => {
    setMcp(undefined); setMcpError("");
    if (!sessionId || !onMcp) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async (): Promise<void> => {
      try {
        const value = await window.grokDesktop.getSessionMcpTools(sessionId);
        if (value.sessionId !== sessionId) throw Error("工具列表的会话身份不匹配");
        if (!cancelled) { setMcp(value); setMcpError(""); }
      } catch (error) {
        if (!cancelled) { setMcp(undefined); setMcpError(errorMessage(error)); }
      } finally {
        if (!cancelled) timer = setTimeout(() => void refresh(), 3000);
      }
    };
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [sessionId, Boolean(onMcp), mcpRefresh]);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    let cancelled = false;
    void window.grokDesktop.listSkills().then(value=>{if(!cancelled)setSkills(value)}).catch(value=>{if(!cancelled)setError(errorMessage(value))}).finally(()=>{if(!cancelled)setLoading(false)});
    const focusTimer = window.setTimeout(() => panelRef.current?.querySelector<HTMLInputElement>("input")?.focus(), 0);
    const key = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); return; }
      // The global overlay trap keys off `hasBlockingOverlay`, which does not
      // include this palette, so Tab containment has to live here or the
      // aria-modal claim is not true.
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'))
        .filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (!panel.contains(document.activeElement)) { event.preventDefault(); first.focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", key);
    return () => { cancelled = true; clearTimeout(focusTimer); window.removeEventListener("keydown", key); document.body.style.overflow = previousOverflow; window.setTimeout(() => previousFocus?.focus(), 0); };
  }, []);
  const move = (event: React.KeyboardEvent, direction: -1 | 1): void => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>("button[data-palette-item]:not([disabled])") ?? []);
    if (!buttons.length) return;
    const focusedIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = ((focusedIndex >= 0 ? focusedIndex : direction === 1 ? -1 : 0) + direction + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };
  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.target instanceof HTMLInputElement && !["ArrowDown","ArrowUp"].includes(event.key)) return;
    if (event.key === "Enter") {
      const target = event.target instanceof HTMLElement ? event.target.closest<HTMLButtonElement>("button[data-palette-item]") : null;
      if (target) { event.preventDefault(); target.click(); }
      return;
    }
    move(event, event.key === "ArrowUp" ? -1 : 1);
  };
  const item = (icon: string, title: string, description: string, action: () => void, badge?: string, disabled = false): React.JSX.Element | null => !`${title} ${description}`.toLowerCase().includes(query.trim().toLowerCase()) ? null : <button data-palette-item key={title} disabled={disabled} onClick={action}><i>{icon}</i><span><strong>{title}</strong><small>{description}</small></span>{badge && <em>{badge}</em>}</button>;
  return <div className="add-palette-backdrop" onMouseDown={onClose}><section ref={panelRef} className="add-palette" role="dialog" aria-modal="true" aria-label="添加文件、能力或 Skill" onMouseDown={(event) => event.stopPropagation()} onKeyDown={handleKeyDown}><header><strong>命令与能力</strong><button onClick={onClose}>×</button></header><div className="add-palette-scroll"><input className="capability-search" aria-label="搜索命令、附件、能力和 Skills" placeholder="搜索命令、文件、能力或 Skill…" value={query} onChange={event=>setQuery(event.target.value)}/><h3>添加</h3>{item("▤", "文件和图片", "选择一个或多个文件，支持常见图片格式", onFiles)}{item("▰", "文件夹", "仅引用文件夹路径，不会预先递归读取", onFolders)}{item("@", "工作区文件", "按文件名搜索并引用当前项目中的文件", onWorkspaceFile)}<h3>能力</h3>{item("◉", "控制电脑", "本次请求使用 Computer Use，仍受当前会话权限限制", onComputer, "实验性")}{item("▧", "生成图片", onImage ? "打开参数设置；结果附回当前代码会话，可另存至项目" : "请先打开一个 Grok 会话，再为该会话生成图片", onImage ?? (()=>undefined), "媒体任务", !onImage)}<h3>当前 CLI 命令</h3>{commands.length ? commands.map(command=>item("/", normalizeSkillCommand(command.name), [command.description,command.inputHint && "参数："+command.inputHint].filter(Boolean).join(" · ") || "填入草稿，确认后发送", ()=>onCommand(command.name), "CLI")) : <p className="palette-status">当前会话尚未上报命令；不会使用其他会话的列表。</p>}<h3>当前会话 MCP 工具</h3>{!sessionId || !onMcp ? <p className="palette-status">打开已连接的 Grok 会话后，可查看它实际上报的工具。</p> : <><button aria-label="刷新 MCP 工具" onClick={()=>setMcpRefresh(value=>value+1)}>刷新工具</button>{mcpError ? <p className="palette-status warning-text" role="status">MCP 工具暂不可用：{mcpError}</p> : !mcp || mcp.sessionId !== sessionId ? <p className="palette-status">正在读取当前连接…</p> : <>{mcp.tools.map(({selection,description})=>item("◇", selection.serverName+" / "+selection.toolName, description || "请求模型使用此工具；仍受当前权限限制", ()=>onMcp(selection), "MCP"))}<p className="palette-status">{mcp.notice}</p></>}</>}<h3>插件 Skills</h3>{loading ? <p className="palette-status">正在加载已启用 Skills…</p> : error ? <p className="palette-status warning-text">Skills 暂不可用：{error}</p> : skills.length ? skills.filter(skill=>`${skill.name} ${skill.description} ${skill.command}`.toLowerCase().includes(query.trim().toLowerCase())).map((skill) => <button data-palette-item key={`${skill.source}-${skill.command}`} onClick={() => onSkill(skill)}><i>✦</i><span><strong>{skill.name}</strong><small>{skill.description || skill.command}</small></span><em>{skill.source || "插件"}</em></button>) : <p className="palette-status">当前没有已启用的插件 Skill。</p>}</div><footer><button onClick={onManageExtensions}>管理扩展和 Skills</button><span>CLI 命令填入草稿；能力选择仅本次生效，不代表已调用 · Esc 关闭</span></footer></section></div>;
}

function ModelControls({ sessionId, view, disabled, onSettled }: { sessionId: string; view: NonNullable<ReturnType<typeof useAppStore.getState>["views"][string]>; disabled: boolean; onSettled(): void }): React.JSX.Element {
  const setError = useAppStore((state) => state.setError);
  const setSettings = useAppStore((state) => state.setSettings);
  const [switching, setSwitching] = useState<"model" | "effort" | "mode" | null>(null);
  const locked = disabled || switching !== null;
  const effortControl = effortControlState(view.models, view.currentModelId, view.effort);
  const run = async (kind: "model" | "effort" | "mode", action: () => Promise<void>): Promise<void> => {
    if (locked) return;
    setSwitching(kind);
    try { await action(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setSwitching(null); onSettled(); }
  };
  return <div className="model-controls" aria-busy={switching !== null}>
    <select aria-label="模型" title={switching === "model" ? "正在切换模型…" : "模型"} className="model-select" disabled={locked} value={view.modelSelectionRequired ? "" : view.currentModelId} onChange={(event) => void run("model", () => window.grokDesktop.setModel(sessionId, event.target.value))}>{view.modelSelectionRequired && <option value="" disabled>请选择可用模型</option>}{view.models.map((model) => <option value={model.modelId} key={model.modelId}>{model.name}</option>)}</select>
    <select aria-label="推理强度" title={switching === "effort" ? "正在应用推理强度…" : effortControl.reason} className="effort-select" disabled={locked || Boolean(view.modelSelectionRequired) || !effortControl.supported} value={view.effort || ""} onChange={(event) => { const effort = event.target.value as ReasoningEffort; void run("effort", async () => { await window.grokDesktop.setEffort(sessionId, effort); setSettings(await window.grokDesktop.getSettings()); }); }}><option value="" disabled={view.effort !== ""}>CLI 默认</option>{effortControl.options.map((item) => <option key={item.value} value={item.value} title={item.description}>{item.label}</option>)}</select>
    <select aria-label="执行模式" title={switching === "mode" ? "正在切换模式…" : "执行模式"} className={`mode-select ${view.mode}`} disabled={locked} value={view.mode} onChange={(event) => { const mode = event.target.value as SessionMode; void run("mode", () => window.grokDesktop.setMode(sessionId, mode)); }}>{SESSION_MODE_OPTIONS.map(option => <option key={option.value} value={option.value} title={option.description}>{option.label}</option>)}</select>
    {switching && <span className="control-progress">应用中…</span>}
  </div>;
}

function TokenDonut({ percent, label, title }: { percent: number; label: string; title?: string }): React.JSX.Element {
  // The track used to be a literal #343940, which stayed dark grey on the light
  // theme's white composer. Derive it from the current foreground instead.
  return <span className="token-meter" role="img" aria-label={label || title} title={label && title ? `${label} · ${title}` : label || title}><span style={{ background: `conic-gradient(var(--accent) ${percent}%, color-mix(in srgb, var(--text) 22%, transparent) ${percent}% 100%)` }}><i /></span>{label}</span>;
}


import { errorMessage } from "../error-message";
function formatTokens(value: number): string { return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${Math.round(value / 1_000)}K` : String(value); }
function localFileUrl(path: string): string { return `grok-media://local/?path=${encodeURIComponent(path.replace(/^\\\\\?\\/, ""))}`; }
function decodeTextAttachment(data: string): string {
  const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function textAttachmentPreview(data: string): string {
  const value = decodeTextAttachment(data).replace(/\s+/g, " ").trim();
  return value.length > 72 ? `${value.slice(0, 72)}…` : value || "空文本";
}
