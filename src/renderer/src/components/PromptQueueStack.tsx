import { memo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Paperclip, Pencil, X } from "lucide-react";
import type { PromptQueueEntry } from "../../../shared/types";
import { errorMessage } from "../error-message";
import { useAppStore } from "../store";

export interface PromptQueueStackProps {
  sessionId: string;
  entries: PromptQueueEntry[];
  compact?: boolean;
}

export const PromptQueueStack = memo(function PromptQueueStack({
  sessionId,
  entries,
  compact = false,
}: PromptQueueStackProps): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [draftText, setDraftText] = useState("");
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState("");
  const setError = useAppStore((state) => state.setError);

  if (!entries.length) return null;

  const ordered = [...entries].sort((a, b) => a.position - b.position);
  const queuedEntries = ordered.filter((entry) => entry.state === "queued");
  const firstQueuedIndex = ordered.findIndex((entry) => entry.state === "queued");
  const topQueued = queuedEntries[0];
  const queuedCount = queuedEntries.length;
  const activeCount = ordered.length - queuedCount;
  const listId = `prompt-queue-list-${sessionId}`;

  const runAction = async (
    key: string,
    action: () => Promise<{ message?: string } | void>,
  ): Promise<void> => {
    if (busyId) return;
    setBusyId(key);
    try {
      const receipt = await action();
      if (receipt?.message) {
        setNotice(receipt.message);
        window.setTimeout(() => {
          setNotice((current) => (current === receipt.message ? "" : current));
        }, 4_000);
      }
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusyId("");
    }
  };

  const promoteToSteer = (entryId: string, overrideText?: string): Promise<void> =>
    runAction(`steer:${entryId}`, () =>
      window.grokDesktop.promoteQueuedPromptToSteer
        ? window.grokDesktop.promoteQueuedPromptToSteer(sessionId, entryId, overrideText)
        : window.grokDesktop.interjectQueuedPrompt(sessionId, entryId, overrideText),
    );

  const commitEdit = async (entry: PromptQueueEntry): Promise<void> => {
    const trimmed = draftText.trim();
    if (!trimmed) return;
    await runAction(`edit:${entry.id}`, async () => {
      const receipt = await window.grokDesktop.editQueuedPrompt(sessionId, entry.id, trimmed);
      setEditingId(undefined);
      return receipt;
    });
  };

  return (
    <section className={`prompt-queue prompt-queue-stack${compact ? " is-compact" : ""}`} role="region" aria-label="待发送消息队列">
      <div className="prompt-queue-bar-head">
        <button
          type="button"
          className="prompt-queue-toggle"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-label={
            queuedCount > 0
              ? `${queuedCount} 条等待发送消息，点击${expanded ? "收起" : "展开管理队列"}`
              : `${activeCount} 条正在发送消息`
          }
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <strong className="prompt-queue-count">
            {queuedCount > 0 ? `${queuedCount} 条排队中` : `${activeCount} 条发送中`}
          </strong>
          {!expanded && topQueued && (
            <span className="prompt-queue-preview">
              · {topQueued.text}
              {topQueued.attachmentPreviews?.length ? ` (${topQueued.attachmentPreviews.length} 个附件)` : ""}
            </span>
          )}
          {queuedCount > 0 && activeCount > 0 && (
            <small className="prompt-queue-sub">另有 {activeCount} 条发送中</small>
          )}
          <small className="prompt-queue-action-label">{expanded ? "收起" : "管理"}</small>
        </button>

        {!expanded && topQueued && (
          <button
            type="button"
            className="prompt-queue-steer-btn"
            disabled={Boolean(busyId)}
            aria-label={`立即转向队首消息：${topQueued.text.slice(0, 32)}`}
            title="立即将队首排队消息注入当前运行回合（若不支持回合内插话则立即中断重发且保留随附附件）"
            onClick={() => void promoteToSteer(topQueued.id)}
          >
            ⚡ 立即转向
          </button>
        )}
      </div>

      {notice && (
        <p className="queue-operation-notice" role="status" aria-live="polite">
          {notice}
        </p>
      )}

      {expanded && (
        <div id={listId} role="list" className="prompt-queue-list">
          {ordered.map((entry, index) => {
            const editable = entry.state === "queued";
            const isEditing = editingId === entry.id;
            const attachmentList = entry.attachmentPreviews ?? [];
            const stateLabel =
              entry.state === "interjecting"
                ? "正在请求转向当前回合"
                : entry.state === "send-now"
                  ? "正在切换回合立即发送"
                  : entry.state === "sending" || entry.state === "accepted"
                    ? "已提交 · 不可撤回"
                    : "排队中 · 可编辑/转向/撤回";

            return (
              <div
                key={entry.id}
                role="listitem"
                aria-label={`队列第 ${index + 1} 项：${entry.text.slice(0, 40)}`}
                className={`prompt-queue-item ${editable ? "queued" : "committed"}`}
              >
                {isEditing ? (
                  <div className="prompt-queue-edit">
                    <textarea
                      autoFocus
                      aria-label={`编辑第 ${index + 1} 条排队消息正文`}
                      className="ui-textarea prompt-queue-textarea"
                      rows={2}
                      value={draftText}
                      onChange={(event) => setDraftText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setEditingId(undefined);
                        } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          void commitEdit(entry);
                        }
                      }}
                    />
                    {attachmentList.length > 0 && (
                      <div className="prompt-queue-attachments">
                        <Paperclip size={11} />
                        <span>已保留 {attachmentList.length} 个随附文件：</span>
                        {attachmentList.map((att) => (
                          <span key={att.id} className="ui-badge">
                            {att.name}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="prompt-queue-edit-actions">
                      <button
                        type="button"
                        className="ui-btn ui-btn-ghost ui-btn-sm"
                        onClick={() => setEditingId(undefined)}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        className="prompt-queue-steer-btn"
                        disabled={(!draftText.trim() && !attachmentList.length) || Boolean(busyId)}
                        onClick={() => {
                          const nextVal = draftText.trim();
                          setEditingId(undefined);
                          void promoteToSteer(entry.id, nextVal);
                        }}
                      >
                        ⚡ 转向发送
                      </button>
                      <button
                        type="button"
                        className="ui-btn ui-btn-primary ui-btn-sm"
                        disabled={!draftText.trim() || Boolean(busyId)}
                        onClick={() => void commitEdit(entry)}
                      >
                        保存修改
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="prompt-queue-row-main">
                    <span className="prompt-queue-item-text">
                      <b>#{index + 1}</b>
                      {entry.text}
                      <small>{stateLabel}</small>
                    </span>

                    <div className="prompt-queue-item-actions">
                      <button
                        type="button"
                        className="prompt-queue-steer-btn"
                        disabled={!editable || Boolean(busyId)}
                        aria-label={`立即转向第 ${index + 1} 条排队消息`}
                        title={editable ? "立即转向注入当前运行回合" : "该消息已提交"}
                        onClick={() => void promoteToSteer(entry.id)}
                      >
                        ⚡ 立即转向
                      </button>
                      <button
                        type="button"
                        className="ui-icon-btn ui-icon-btn-sm"
                        disabled={!editable || index <= firstQueuedIndex || Boolean(busyId)}
                        aria-label={`上移第 ${index + 1} 条排队消息`}
                        title="上移"
                        onClick={() =>
                          void runAction(`up:${entry.id}`, () =>
                            window.grokDesktop.reorderQueuedPrompt(sessionId, entry.id, index - 1),
                          )
                        }
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        type="button"
                        className="ui-icon-btn ui-icon-btn-sm"
                        disabled={!editable || index === ordered.length - 1 || Boolean(busyId)}
                        aria-label={`下移第 ${index + 1} 条排队消息`}
                        title="下移"
                        onClick={() =>
                          void runAction(`down:${entry.id}`, () =>
                            window.grokDesktop.reorderQueuedPrompt(sessionId, entry.id, index + 1),
                          )
                        }
                      >
                        <ArrowDown size={13} />
                      </button>
                      <button
                        type="button"
                        className="ui-icon-btn ui-icon-btn-sm"
                        disabled={!editable || Boolean(busyId)}
                        aria-label={`编辑第 ${index + 1} 条排队消息`}
                        title={editable ? "编辑正文（保留随附附件）" : "已提交消息不可编辑"}
                        onClick={() => {
                          setEditingId(entry.id);
                          setDraftText(entry.text);
                        }}
                      >
                        <Pencil size={12} />
                      </button>
                      {editable ? (
                        <button
                          type="button"
                          className="ui-icon-btn ui-icon-btn-sm"
                          disabled={Boolean(busyId)}
                          aria-label={`撤回第 ${index + 1} 条排队消息`}
                          title="撤回此排队消息"
                          onClick={() =>
                            void runAction(`rm:${entry.id}`, () =>
                              window.grokDesktop.removeQueuedPrompt(sessionId, entry.id),
                            )
                          }
                        >
                          <X size={13} />
                        </button>
                      ) : (
                        <span className="queue-committed-lock" title="已提交，不能撤回">
                          已提交
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {!isEditing && attachmentList.length > 0 && (
                  <div className="prompt-queue-attachments">
                    {attachmentList.map((att) => (
                      <span key={att.id} className="ui-badge">
                        <Paperclip size={10} />
                        {att.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {queuedCount > 1 && (
            <div className="prompt-queue-footer">
              <button
                type="button"
                className="ui-btn ui-btn-danger ui-btn-sm"
                disabled={Boolean(busyId)}
                aria-label="撤回全部未提交的排队消息"
                onClick={() =>
                  void runAction("clear", () => window.grokDesktop.clearPromptQueue(sessionId))
                }
              >
                撤回全部未提交消息 ({queuedCount})
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
});
