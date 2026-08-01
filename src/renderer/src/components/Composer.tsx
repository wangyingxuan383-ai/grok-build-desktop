import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Attachment, ComposerCapabilitySelection, ComputerTaskState, PromptQueueEntry, ReasoningEffort, SessionMode, SkillSummary, WorkspaceFileCandidate } from "../../../shared/types";
import { normalizeSkillCommand } from "../../../shared/composer-capability";
import { effortControlState } from "../model-capabilities";
import type { ReviewCommentDraft } from "../review-comments";
import { useAppStore } from "../store";
import { UiIcon } from "../ui-icons";

export function Composer(props: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  text: string;
  setText(value: string): void;
  busy: boolean;
  controlsDisabled: boolean;
  sessionId: string;
  attachments: ReturnType<typeof useAppStore.getState>["attachments"];
  reviewComments: ReviewCommentDraft[];
  notice?: string;
  onDismissNotice(): void;
  commandMatches: Array<{ name: string; description?: string }>;
  fileMatches: WorkspaceFileCandidate[];
  view: ReturnType<typeof useAppStore.getState>["views"][string] | undefined;
  onSend(): void;
  onInterject(): void;
  onBlockedSubmit(): void;
  onStop(): void;
  onAdd(): void;
  onAddFolders(): void;
  onPaste(files: File[]): void;
  onPasteText(text: string): void;
  onConvertText(): void;
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
  onClearCapability(): void;
  onManageExtensions(): void;
  onHistory(direction: -1 | 1): void;
  onControlSettled(): void;
}): React.JSX.Element {
  const [addOpen, setAddOpen] = useState(false);
  const composingRef = useRef(false);
  const tokenTotal = props.view?.meta.totalTokens ?? 0;
  const selectedModel = props.view?.models.find((value) => value.modelId === props.view?.currentModelId);
  const declaredWindow = selectedModel?.totalContextTokens;
  const percent = declaredWindow ? Math.min(100, Math.round(tokenTotal / declaredWindow * 100)) : 0;
  const tokenLabel = declaredWindow
    ? `${formatTokens(tokenTotal)} / ${formatTokens(declaredWindow)}`
    : `${formatTokens(tokenTotal)} / ?`;
  return <div className="composer-zone">{props.notice && <div className="composer-operation-notice" role="status"><span>{props.notice}</span><button type="button" aria-label="关闭提示" title="关闭提示" onClick={props.onDismissNotice}>×</button></div>}{props.view?.status === "needs-user" && <div className="composer-operation-notice waiting" role="status">请先处理当前计划、权限或问题卡片，然后再发送消息。</div>}{props.view?.queue.length ? <PromptQueueBar sessionId={props.sessionId} entries={props.view.queue} /> : null}{props.reviewComments.length > 0 && <div className="review-comment-drafts"><span>审核批注草稿</span>{props.reviewComments.map((comment) => <button key={comment.id} title={comment.body} onClick={() => props.onRemoveReviewComment(comment.id)}><code>{comment.path}:L{comment.line}</code><span>{comment.body}</span><b>×</b></button>)}</div>}{props.commandMatches.length > 0 && <div className="slash-menu">{props.commandMatches.map((command) => <button key={command.name} onClick={() => props.onCommand(command.name)}><strong>/{command.name.replace(/^\//, "")}</strong><span>{command.description}</span></button>)}</div>}{props.fileMatches.length > 0 && <div className="slash-menu file-menu">{props.fileMatches.map((file) => <button key={file.path} onClick={() => props.onFile(file)}><strong>@{file.name}</strong><span>{file.relativePath}</span></button>)}</div>}
    {addOpen && createPortal(<AddPalette onClose={() => { setAddOpen(false); props.onControlSettled(); }} onFiles={() => { setAddOpen(false); props.onAdd(); }} onFolders={() => { setAddOpen(false); props.onAddFolders(); }} onWorkspaceFile={() => { setAddOpen(false); props.onFileMenu(); }} onComputer={() => { setAddOpen(false); props.onComputer(); }} onSkill={(skill) => { setAddOpen(false); props.onCapability({ kind: "skill", label: skill.name, command: normalizeSkillCommand(skill.command), source: skill.source }); props.onControlSettled(); }} onManageExtensions={() => { setAddOpen(false); props.onManageExtensions(); }} />, document.getElementById("overlay-root")!)}
    <div className="composer">{(props.attachments.length > 0 || props.capability) && <div className="attachment-row">{props.capability && <span className={`capability-chip ${props.capability.kind}`}>{props.capability.kind === "computer" ? "◉" : "✦"} @{props.capability.label}<small>仅本次消息</small><button title="移除能力" onClick={props.onClearCapability}>×</button></span>}{props.attachments.map((attachment) => {
      const textDraft = attachment.kind === "file" && attachment.mimeType?.startsWith("text/plain") && Boolean(attachment.draftText || attachment.data);
      const preview = attachment.previewText || (attachment.data ? textAttachmentPreview(attachment.data) : "本地文本草稿");
      return <span className={attachment.kind === "image" ? "composer-image-chip" : textDraft ? "composer-text-chip" : ""} key={attachment.id}>{attachment.kind === "image" ? <img src={attachment.data ? `data:${attachment.mimeType || "image/png"};base64,${attachment.data}` : attachment.path ? localFileUrl(attachment.path) : ""} alt="" /> : attachment.kind === "folder" ? "▰" : "▤"}<span>{attachment.name}{textDraft && <small>{attachment.size?.toLocaleString()} 字节 · {preview}</small>}</span>{textDraft && <button title="恢复为输入框正文" onClick={() => props.onRestoreText(attachment)}>恢复正文</button>}<button title={`移除 ${attachment.name}`} onClick={() => props.onRemove(attachment.id)}>×</button></span>;
    })}</div>}
      {/* Never disabled: disabling mid-IME-composition can swallow
          compositionend and strand composingRef, killing Enter for good. Typing
          and drafting stay available; only submission is gated, and it says so. */}
      <textarea ref={props.inputRef} value={props.text} aria-keyshortcuts="Enter Control+Enter" onChange={(event) => props.setText(event.target.value)} onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; }} onPaste={(event) => { const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/")); if (images.length) { event.preventDefault(); props.onPaste(images); return; } const text = event.clipboardData.getData("text/plain"); if (text.length > 12_000) { event.preventDefault(); props.onPasteText(text); } }} onKeyDown={(event) => { if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) { event.preventDefault(); props.onHistory(event.key === "ArrowUp" ? -1 : 1); } else if (event.key === "Enter" && event.ctrlKey && !event.nativeEvent.isComposing && !composingRef.current) { event.preventDefault(); if (props.controlsDisabled) props.onBlockedSubmit(); else if (props.busy) props.onInterject(); else props.onSend(); } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !composingRef.current && event.nativeEvent.keyCode !== 229) { event.preventDefault(); if (props.controlsDisabled) props.onBlockedSubmit(); else props.onSend(); } }} placeholder={props.controlsDisabled ? "可以继续输入；请先处理当前计划、权限或问题再发送…" : props.busy ? "继续输入；Enter 排队，Ctrl+Enter 置顶跟进…" : "给 Grok 发送消息…"} />
      <div className="composer-toolbar"><div className="toolbar-left"><button className="icon-button add-button" title="添加文件或能力" aria-expanded={addOpen} aria-haspopup="dialog" disabled={props.controlsDisabled} onClick={() => setAddOpen(!addOpen)}><UiIcon name="plus"/></button>{props.text.length > 0 && <button className="composer-text-convert" title="将当前正文转换为 .txt 附件" onClick={props.onConvertText}>转为附件</button>}<TokenDonut percent={percent} label={tokenLabel} title={declaredWindow ? undefined : "该模型未上报上下文上限；应用不会伪造 512K 上限"} />{props.view && <ModelControls sessionId={props.sessionId} view={props.view} disabled={props.controlsDisabled || props.busy} onSettled={props.onControlSettled} />}</div>{props.busy ? <div className="busy-send-actions"><button className="queue-send" disabled={props.controlsDisabled || (!props.text.trim() && !props.attachments.length && !props.reviewComments.length)} onClick={props.onSend}>加入队列</button><button className="interject-send" title="置顶为同一会话的下一回合（Ctrl+Enter）；提交后不可撤回" disabled={props.controlsDisabled || (!props.text.trim() && !props.attachments.length && !props.reviewComments.length)} onClick={props.onInterject}>置顶跟进</button><button className="send-button stop" title="停止" onClick={props.onStop}><UiIcon name="stop"/></button></div> : <button className="send-button" title="发送" disabled={props.controlsDisabled || (!props.text.trim() && !props.attachments.length && !props.reviewComments.length)} onClick={props.onSend}><UiIcon name="send"/></button>}</div>
    </div>
  </div>;
}

function PromptQueueBar({ sessionId, entries }: { sessionId: string; entries: PromptQueueEntry[] }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false); const [editing, setEditing] = useState<string>(); const [text, setText] = useState(""); const [notice, setNotice] = useState(""); const setError = useAppStore((state) => state.setError);
  const queuedCount = entries.filter((entry) => entry.state === "queued").length;
  const submittedCount = entries.length - queuedCount;
  const run = async (action: () => Promise<{ message?: string } | void>): Promise<void> => { try { const receipt = await action(); if (receipt?.message) { setNotice(receipt.message); window.setTimeout(() => setNotice(""), 4_000); } } catch (error) { setError(errorMessage(error)); } };
  return <div className="prompt-queue"><button className="prompt-queue-summary" onClick={() => setExpanded(!expanded)}><span>≡</span><strong>{queuedCount ? `${queuedCount} 条等待发送` : `${submittedCount} 条已提交插话`}</strong>{queuedCount > 0 && submittedCount > 0 && <small>另有 {submittedCount} 条已提交</small>}<small>{expanded ? "收起" : "展开管理"}</small></button>{notice && <p className="queue-operation-notice" role="status">{notice}</p>}{expanded && <div className="prompt-queue-list">{entries.map((entry, index) => { const editable = entry.state === "queued"; return <div key={entry.id} className={editable ? "queued" : "committed"}>{editing === entry.id ? <input autoFocus value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setEditing(undefined); if (event.key === "Enter" && text.trim()) void run(async () => { const receipt = await window.grokDesktop.editQueuedPrompt(sessionId, entry.id, text.trim()); setEditing(undefined); return receipt; }); }} /> : <span><b>{index + 1}</b>{entry.text}<small>{entry.state === "interjected" ? "已提交 · 等待当前步骤收束 · 不可撤回" : entry.state === "sending" ? "发送中 · 不可撤回" : "已排队 · 可编辑或撤回"}</small></span>}<button disabled={!editable || index === 0} title="上移" onClick={() => void run(() => window.grokDesktop.reorderQueuedPrompt(sessionId, entry.id, index - 1))}>↑</button><button disabled={!editable || index === entries.length - 1} title="下移" onClick={() => void run(() => window.grokDesktop.reorderQueuedPrompt(sessionId, entry.id, index + 1))}>↓</button><button disabled={!editable} title={editable ? "置顶为下一回合" : "该消息已经提交，不能重复插话"} onClick={() => void run(() => window.grokDesktop.interjectQueuedPrompt(sessionId, entry.id))}>置顶</button><button disabled={!editable} title={editable ? "编辑" : "已提交消息不能编辑"} onClick={() => { setEditing(entry.id); setText(entry.text); }}>✎</button>{editable ? <button title="撤回尚未提交的消息" onClick={() => void run(() => window.grokDesktop.removeQueuedPrompt(sessionId, entry.id))}>×</button> : <span className="queue-committed-lock" title="已提交，不能撤回">已提交</span>}</div>; })}{queuedCount > 0 && <button className="clear-queue" onClick={() => void run(() => window.grokDesktop.clearPromptQueue(sessionId))}>撤回全部未提交消息</button>}</div>}</div>;
}

function AddPalette({ onClose, onFiles, onFolders, onWorkspaceFile, onComputer, onSkill, onManageExtensions }: { onClose(): void; onFiles(): void; onFolders(): void; onWorkspaceFile(): void; onComputer(): void; onSkill(skill: SkillSummary): void; onManageExtensions(): void }): React.JSX.Element {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    void window.grokDesktop.listSkills().then(setSkills).catch((value) => setError(errorMessage(value))).finally(() => setLoading(false));
    window.setTimeout(() => panelRef.current?.querySelector<HTMLButtonElement>("button[data-palette-item]")?.focus(), 0);
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
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = previousOverflow; window.setTimeout(() => previousFocus?.focus(), 0); };
  }, []);
  const move = (event: React.KeyboardEvent, direction: -1 | 1): void => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>("button[data-palette-item]") ?? []);
    if (!buttons.length) return;
    const focusedIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = ((focusedIndex >= 0 ? focusedIndex : activeIndex) + direction + buttons.length) % buttons.length;
    setActiveIndex(next); buttons[next]?.focus();
  };
  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "Enter") {
      const target = event.target instanceof HTMLElement ? event.target.closest<HTMLButtonElement>("button[data-palette-item]") : null;
      if (target) { event.preventDefault(); target.click(); }
      return;
    }
    move(event, event.key === "ArrowUp" ? -1 : 1);
  };
  const item = (icon: string, title: string, description: string, action: () => void, badge?: string): React.JSX.Element => <button data-palette-item onFocus={(event) => { const rows = Array.from(panelRef.current?.querySelectorAll("button[data-palette-item]") ?? []); setActiveIndex(rows.indexOf(event.currentTarget)); }} onClick={action}><i>{icon}</i><span><strong>{title}</strong><small>{description}</small></span>{badge && <em>{badge}</em>}</button>;
  return <div className="add-palette-backdrop" onMouseDown={onClose}><section ref={panelRef} className="add-palette" role="dialog" aria-modal="true" aria-label="添加文件、能力或 Skill" onMouseDown={(event) => event.stopPropagation()} onKeyDown={handleKeyDown}><header><strong>添加</strong><button onClick={onClose}>×</button></header><div className="add-palette-scroll"><h3>添加</h3>{item("▤", "文件和图片", "选择一个或多个文件，支持常见图片格式", onFiles)}{item("▰", "文件夹", "仅引用文件夹路径，不会预先递归读取", onFolders)}{item("@", "工作区文件", "按文件名搜索并引用当前项目中的文件", onWorkspaceFile)}<h3>能力</h3>{item("◉", "控制电脑", "为本次消息启用 Computer Use，执行时再选择目标", onComputer, "实验性")}<h3>插件 Skills</h3>{loading ? <p className="palette-status">正在加载已启用 Skills…</p> : error ? <p className="palette-status warning-text">Skills 暂不可用：{error}</p> : skills.length ? skills.map((skill) => <button data-palette-item key={`${skill.source}-${skill.command}`} onClick={() => onSkill(skill)}><i>✦</i><span><strong>{skill.name}</strong><small>{skill.description || skill.command}</small></span><em>{skill.source || "插件"}</em></button>) : <p className="palette-status">当前没有已启用的插件 Skill。</p>}</div><footer><button onClick={onManageExtensions}>管理扩展和 Skills</button><span>↑↓ 选择 · Enter 使用 · Esc 关闭</span></footer></section></div>;
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
    <select aria-label="模型" title={switching === "model" ? "正在切换模型…" : "模型"} className="model-select" disabled={locked} value={view.currentModelId} onChange={(event) => void run("model", () => window.grokDesktop.setModel(sessionId, event.target.value))}>{view.models.map((model) => <option value={model.modelId} key={model.modelId}>{model.name}</option>)}</select>
    <select aria-label="推理强度" title={switching === "effort" ? "正在应用推理强度…" : effortControl.reason} className="effort-select" disabled={locked || !effortControl.supported} value={view.effort || ""} onChange={(event) => { const effort = event.target.value as ReasoningEffort; void run("effort", async () => { await window.grokDesktop.setEffort(sessionId, effort); setSettings(await window.grokDesktop.getSettings()); }); }}><option value="" disabled={view.effort !== ""}>CLI 默认</option>{effortControl.options.map((item) => <option key={item.value} value={item.value} title={item.description}>{item.label}</option>)}</select>
    <select aria-label="执行模式" title={switching === "mode" ? "正在切换模式…" : "执行模式"} className={`mode-select ${view.mode}`} disabled={locked} value={view.mode} onChange={(event) => { const mode = event.target.value as SessionMode; void run("mode", () => window.grokDesktop.setMode(sessionId, mode)); }}><option value="agent">Agent</option><option value="plan">Plan</option><option value="auto">自动批准</option></select>
    {switching && <span className="control-progress">应用中…</span>}
  </div>;
}

function TokenDonut({ percent, label, title }: { percent: number; label: string; title?: string }): React.JSX.Element {
  return <span className="token-meter" title={title ? `${label} · ${title}` : label}><span style={{ background: `conic-gradient(var(--accent) ${percent}%, #343940 ${percent}% 100%)` }}><i /></span>{label}</span>;
}


function errorMessage(value: unknown): string { return value instanceof Error ? value.message : String(value); }
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
