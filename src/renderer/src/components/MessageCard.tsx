import { lazy, memo, Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { EditorDocument, EditorOpenResult, NavigationIntent } from "../../../shared/types";
import type { UiMessage } from "../store";
import { LazyMarkdownView } from "./LazyMarkdownView";
import { useWorkbenchStore } from "../workbench-store";

const DiffEditor = lazy(async () => {
  (await import("../monaco")).configureMonaco();
  const module = await import("@monaco-editor/react");
  return { default: module.DiffEditor };
});

export const MessageCard = memo(function MessageCard({ message, sessionId, navigationRoot, showThinking, expandTools, onResolved, onRetry, onNavigate }: { message: UiMessage; sessionId: string; navigationRoot?: string; showThinking: boolean; expandTools: boolean; onResolved?: (id: string) => void; onRetry?: (message: Extract<UiMessage, { kind: "user" }>) => void; onNavigate?: (intent: NavigationIntent) => void }): React.JSX.Element | null {
  if (message.kind === "thought" && !showThinking) return <div className="thinking-placeholder"><span /> 思考过程</div>;
  if (message.kind === "user") return <UserMessageCard message={message} onRetry={onRetry} />;
  if (message.kind === "assistant") return <div className="message-row assistant"><div className="assistant-body"><LazyMarkdownView text={message.text} /></div></div>;
  if (message.kind === "thought") return <div className="thought-card"><LazyMarkdownView text={message.text} /></div>;
  if (message.kind === "error") return <div className="error-card">{message.text}</div>;
  if (message.kind === "media") return <GeneratedMediaCard message={message} />;
  if (message.kind === "tool") return <ToolCard message={message} open={expandTools} sessionId={sessionId} navigationRoot={navigationRoot} onNavigate={onNavigate} />;
  if (message.kind === "permission") return <PermissionCard message={message} sessionId={sessionId} onResolved={onResolved} />;
  if (message.kind === "question") return <QuestionCard message={message} sessionId={sessionId} onResolved={onResolved} />;
  if (message.kind === "plan") return <PlanCard message={message} sessionId={sessionId} onResolved={onResolved} />;
  return null;
});

function GeneratedMediaCard({ message }: { message: Extract<UiMessage, { kind: "media" }> }): React.JSX.Element {
  const [preview, setPreview] = useState(false);
  const src = message.isData ? `data:${message.mimeType || "image/png"};base64,${message.source}` : toFileUrl(message.source);
  return <div className="media-card result-media"><header><strong>{message.media === "image" ? "生成图片" : "生成视频"}</strong><span>最终结果</span></header>{message.media === "image" ? <button className="generated-image-button" onClick={() => setPreview(true)}><img src={src} alt="Grok 生成图片" /></button> : <video src={src} controls />}{!message.isData && <div className="button-row"><button onClick={() => void window.grokDesktop.openPath(message.source)}>打开原文件</button><button onClick={() => void navigator.clipboard.writeText(message.source)}>复制路径</button></div>}{preview && createPortal(<div className="image-lightbox" role="dialog" aria-modal="true" aria-label="生成图片预览" onClick={() => setPreview(false)}><button aria-label="关闭大图" onClick={() => setPreview(false)}>×</button><img src={src} alt="Grok 生成图片" onClick={(event) => event.stopPropagation()}/><span>生成图片</span></div>, document.body)}</div>;
}

function UserMessageCard({ message, onRetry }: { message: Extract<UiMessage, { kind: "user" }>; onRetry?: (message: Extract<UiMessage, { kind: "user" }>) => void }): React.JSX.Element {
  const [preview, setPreview] = useState<{ src: string; name: string }>();
  const attachments = message.attachments ?? [];
  const images = attachments.filter((attachment) => attachment.kind === "image");
  const files = attachments.filter((attachment) => attachment.kind !== "image");
  return <div className="message-row user">
    <div className="bubble user-bubble">
      {images.length > 0 && <div className={`user-attachment-grid count-${Math.min(4, images.length)}`}>{images.map((attachment) => {
        const src = attachment.source ? (attachment.isData ? `data:${attachment.mimeType || "image/png"};base64,${attachment.source}` : toFileUrl(attachment.source)) : "";
        const missing = attachment.availability === "missing" || !src;
        return <button type="button" className={`user-image-preview ${missing ? "missing" : ""}`} key={attachment.id} disabled={missing} title={attachment.name} onClick={() => setPreview({ src, name: attachment.name })}>
          {missing ? <span><strong>{attachment.name}</strong><small>源文件不可用</small></span> : <img src={src} alt={attachment.name} onError={(event) => { event.currentTarget.hidden = true; event.currentTarget.parentElement?.classList.add("missing"); }} />}
        </button>;
      })}</div>}
      {files.length > 0 && <div className="user-file-previews">{files.map((attachment) => <div className="user-file-preview" key={attachment.id}><span aria-hidden="true">{attachment.kind === "folder" ? "▣" : "▤"}</span><span><strong>{attachment.name}</strong><small>{attachment.availability === "missing" ? "源文件不可用" : formatBytes(attachment.size)}</small></span></div>)}</div>}
      {message.text && <LazyMarkdownView text={message.text} />}
      <div className="user-message-actions">
        {message.delivery && message.delivery !== "sent" && <span className={`delivery-state ${message.delivery}`}>{message.delivery === "failed" ? "发送失败" : message.delivery === "queued" ? "已排队" : "发送中"}</span>}
        {message.delivery === "failed" && onRetry && <button type="button" className="retry-message" onClick={() => onRetry(message)}>恢复到输入框</button>}
        {message.text && <button type="button" title="复制消息" aria-label="复制消息" onClick={() => void navigator.clipboard.writeText(message.text)}>复制</button>}
      </div>
    </div>
    {preview && createPortal(<div className="image-lightbox" role="dialog" aria-modal="true" aria-label={preview.name} onClick={() => setPreview(undefined)}><button type="button" aria-label="关闭大图" onClick={() => setPreview(undefined)}>×</button><img src={preview.src} alt={preview.name} onClick={(event) => event.stopPropagation()} /><span>{preview.name}</span></div>, document.body)}
  </div>;
}

function ToolCard({ message, open, sessionId, navigationRoot, onNavigate }: { message: Extract<UiMessage, { kind: "tool" }>; open: boolean; sessionId: string; navigationRoot?: string; onNavigate?: (intent: NavigationIntent) => void }): React.JSX.Element {
  const tool = message.tool;
  const hasDiff = typeof tool.oldText === "string" && typeof tool.newText === "string";
  const [expanded, setExpanded] = useState(open);
  const [light, setLight] = useState(() => document.documentElement.dataset.themeResolved === "light");
  const [navigationError, setNavigationError] = useState("");
  useEffect(() => { if (open) setExpanded(true); }, [open]);
  useEffect(() => { const update = (): void => setLight(document.documentElement.dataset.themeResolved === "light"); document.documentElement.addEventListener("grok-theme-change", update); return () => document.documentElement.removeEventListener("grok-theme-change", update); }, []);
  const images = (tool.content ?? []).flatMap((value) => { const item = value && typeof value === "object" ? value as Record<string, unknown> : {}; return item.type === "image" && typeof item.data === "string" ? [{ data: item.data, mimeType: typeof item.mimeType === "string" ? item.mimeType : "image/png" }] : []; });
  const locations = toolLocationCandidates(tool);
  const openLocation = async (path: string, line = 1): Promise<void> => {
    setNavigationError("");
    try {
      if (navigationRoot && onNavigate) {
        onNavigate({ sessionId, executionRoot: navigationRoot, targetPath: path, line, surface: "editor" });
        return;
      }
      await navigateToolLocation(path, line, {
        resolveWorkspace: async () => (await window.grokDesktop.getSettings()).activeWorkspace,
        open: (workspace, target) => window.grokDesktop.openEditorDocument(workspace, target),
        openExternal: (target) => window.grokDesktop.openPath(target),
        openDocument: (document, targetLine) => {
          useWorkbenchStore.getState().openDocument(document);
          const key = useWorkbenchStore.getState().activeTabKey;
          if (key) useWorkbenchStore.getState().updateCursor(key, { lineNumber: targetLine, column: 1 });
        },
      });
    } catch (error) { setNavigationError(error instanceof Error ? error.message : String(error)); }
  };
  return <details className={`tool-card ${tool.status}`} open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary><span className="tool-icon">{tool.kind === "computer_use" ? "◉" : "›_"}</span><span>{tool.title}</span><span className="tool-status">{statusLabel(tool.status)}</span></summary>
    {expanded && <div className="tool-detail">
      {locations.length > 0 && <div className="tool-locations">{locations.map((location) => <button key={`${location.path}:${location.line ?? 1}`} title={location.path} onClick={() => void openLocation(location.path, location.line)}>在编辑器打开 {shortLocation(location.path, location.line)}</button>)}</div>}
      {navigationError && <div className="error-text">{navigationError}</div>}
      {tool.command && <pre className="command">{tool.command}</pre>}{tool.output && <pre className="output">{tool.output}</pre>}{tool.error && <div className="error-text">{tool.error}</div>}
      {images.map((image, index) => <img className="computer-screenshot" key={index} src={`data:${image.mimeType};base64,${image.data}`} alt="Computer Use 窗口截图" />)}
      {tool.truncated && <div className="output-truncated">输出过长，界面中已截断。</div>}
      {hasDiff && <Suspense fallback={<div className="diff-loading">正在加载 Diff…</div>}><DiffEditor height="300px" original={tool.oldText} modified={tool.newText} theme={light ? "vs" : "vs-dark"} options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, automaticLayout: true }} /></Suspense>}
      {!hasDiff && tool.rawInput != null && <pre>{JSON.stringify(tool.rawInput, null, 2)}</pre>}
    </div>}
  </details>;
}

function PermissionCard({ message, sessionId, onResolved }: { message: Extract<UiMessage, { kind: "permission" }>; sessionId: string; onResolved?: (id: string) => void }): React.JSX.Element {
  const [answered, setAnswered] = useState(false);
  const respond = async (id: string): Promise<void> => { await window.grokDesktop.respondPermission(sessionId, message.request.requestId, id); setAnswered(true); onResolved?.(message.id); };
  return <div className="action-card"><strong>需要权限</strong><p>Grok 请求执行一项受保护操作。</p><div className="button-row">{message.request.options.map((option) => <button key={option.optionId} className={/reject|deny/i.test(option.kind || "") ? "danger" : ""} disabled={answered} onClick={() => void respond(option.optionId)}>{option.name || permissionLabel(option.kind)}</button>)}</div></div>;
}

function QuestionCard({ message, sessionId, onResolved }: { message: Extract<UiMessage, { kind: "question" }>; sessionId: string; onResolved?: (id: string) => void }): React.JSX.Element {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const submit = async (): Promise<void> => { await window.grokDesktop.respondQuestion(sessionId, message.requestId, answers); onResolved?.(message.id); };
  return <div className="action-card"><strong>Grok 需要你的回答</strong>{message.questions.map((question) => <label key={question.question}><span>{question.question}</span>{question.options?.length ? <select value={answers[question.question] || ""} onChange={(event) => setAnswers({ ...answers, [question.question]: event.target.value })}><option value="">请选择</option>{question.options.map((option) => <option key={option.label}>{option.label}</option>)}</select> : <input value={answers[question.question] || ""} onChange={(event) => setAnswers({ ...answers, [question.question]: event.target.value })} />}</label>)}<button onClick={() => void submit()}>提交回答</button></div>;
}

function PlanCard({ message, sessionId, onResolved }: { message: Extract<UiMessage, { kind: "plan" }>; sessionId: string; onResolved?: (id: string) => void }): React.JSX.Element {
  const [comment, setComment] = useState("");
  const [answered, setAnswered] = useState(false);
  const answer = async (verdict: "approved" | "rejected" | "cancelled"): Promise<void> => { await window.grokDesktop.respondPlan(sessionId, message.requestId, verdict, comment); setAnswered(true); onResolved?.(message.id); };
  return <div className="plan-card"><header>实施计划</header><LazyMarkdownView text={message.text || "计划已生成，请选择下一步。"} /><textarea placeholder="可选备注" value={comment} onChange={(event) => setComment(event.target.value)} /><div className="button-row"><button disabled={answered} className="primary" onClick={() => void answer("approved")}>批准并执行</button><button disabled={answered} onClick={() => void answer("rejected")}>继续规划</button><button disabled={answered} className="danger" onClick={() => void answer("cancelled")}>取消</button></div></div>;
}

function statusLabel(status: string): string { return status === "completed" ? "完成" : status === "failed" ? "失败" : status === "in_progress" ? "运行中" : "等待"; }
function permissionLabel(kind?: string): string { return kind === "allow_always" ? "始终允许" : kind === "allow_once" ? "仅本次允许" : /reject|deny/.test(kind || "") ? "拒绝" : "确认"; }
function toFileUrl(path: string): string { return `file:///${path.replace(/^\\\\\?\\/, "").replace(/\\/g, "/")}`; }
function formatBytes(size?: number): string { return typeof size !== "number" ? "附件" : size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${Math.round(size / 1024)} KiB` : `${(size / 1024 / 1024).toFixed(1)} MiB`; }

export function toolLocationCandidates(tool: Extract<UiMessage, { kind: "tool" }>["tool"]): Array<{ path: string; line?: number }> {
  const candidates = (tool.locations ?? []).flatMap((location) => typeof location.path === "string" && location.path.trim() ? [{ path: location.path.trim(), line: validLine(location.line) }] : []);
  if (tool.rawInput && typeof tool.rawInput === "object") {
    const raw = tool.rawInput as Record<string, unknown>;
    const path = [raw.path, raw.filePath, raw.file_path].find((value): value is string => typeof value === "string" && Boolean(value.trim()));
    if (path) candidates.push({ path: path.trim(), line: validLine(raw.line) });
  }
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.path}\0${candidate.line ?? 1}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function navigateToolLocation(path: string, line: number | undefined, actions: {
  resolveWorkspace(): Promise<string>;
  open(workspace: string, path: string): Promise<EditorOpenResult>;
  openExternal(path: string): Promise<void>;
  openDocument(document: EditorDocument, line: number): void;
}): Promise<"document" | "external"> {
  const workspace = await actions.resolveWorkspace();
  if (!workspace) throw new Error("请先选择工作区");
  const result = await actions.open(workspace, path);
  if (result.kind === "external") { await actions.openExternal(result.path); return "external"; }
  if (!result.document) throw new Error("无法读取工具引用文件");
  actions.openDocument(result.document, Math.max(1, line ?? 1));
  return "document";
}

function validLine(value: unknown): number | undefined { return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined; }
function shortLocation(path: string, line?: number): string { const name = path.replace(/\\/g, "/").split("/").at(-1) || path; return `${name}${line ? `:${line}` : ""}`; }
