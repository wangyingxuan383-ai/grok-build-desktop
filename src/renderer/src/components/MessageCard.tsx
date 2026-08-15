import { lazy, memo, Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { EditorDocument, EditorOpenResult, NavigationIntent, TurnFailure } from "../../../shared/types";
import type { UiMessage } from "../store";
import { summarizeTurnFailure } from "../../../shared/turn-failure";
import { LazyMarkdownView } from "./LazyMarkdownView";
import { useWorkbenchStore } from "../workbench-store";

const DiffEditor = lazy(async () => {
  (await import("../monaco")).configureMonaco();
  const module = await import("@monaco-editor/react");
  return { default: module.DiffEditor };
});

export const MessageCard = memo(function MessageCard({ message, sessionId, navigationRoot, showThinking, expandTools, onResolved, onRetry, onNavigate, onDiagnose }: { message: UiMessage; sessionId: string; navigationRoot?: string; showThinking: boolean; expandTools: boolean; onResolved?: (id: string) => void; onDiagnose?: (failure: TurnFailure) => void; onRetry?: (message: Extract<UiMessage, { kind: "user" }>) => void; onNavigate?: (intent: NavigationIntent) => void }): React.JSX.Element | null {
  // Resolved interactions remain in the durable conversation projection as an
  // audit event, but their full decision surface must disappear immediately.
  // Keeping a disabled Plan/permission/question card on screen made a
  // successful response look pending and invited duplicate clicks.
  if (isResolvedInteraction(message)) return null;
  if (message.kind === "thought" && !showThinking) return <div className="thinking-placeholder"><span /> 思考过程</div>;
  if (message.kind === "user") return <UserMessageCard message={message} onRetry={onRetry} />;
  if (message.kind === "assistant") return <div className="message-row assistant"><div className="assistant-body"><LazyMarkdownView text={message.text} /></div></div>;
  if (message.kind === "thought") return <div className="thought-card"><LazyMarkdownView text={message.text} /></div>;
  if (message.kind === "retry") {
    const count = message.attempt ? `第 ${message.attempt}${message.maxAttempts ? `/${message.maxAttempts}` : ""} 次` : "";
    const wait = message.delayMs !== undefined ? `${Math.max(0, Math.round(message.delayMs / 1000))} 秒后` : "";
    return <div className="retry-state-card"><span className="process-dot running" /><strong>上游请求正在重试</strong><span>{[count, wait, message.reason].filter(Boolean).join(" · ")}</span></div>;
  }
  if (message.kind === "error") return <ErrorCard text={message.text} failure={message.failure} onDiagnose={onDiagnose} />;
  if (message.kind === "media") return <GeneratedMediaGallery messages={[message]} />;
  if (message.kind === "recovery") return <div className={`history-recovery-card ${message.status}`}><strong>{message.status === "recovered" ? "历史内容已恢复" : "历史内容无法可靠恢复"}</strong><span>{message.text}</span></div>;
  if (message.kind === "recap") return <details className="session-recap-card"><summary>会话回顾</summary><LazyMarkdownView text={message.text}/></details>;
  if (message.kind === "compact") return <div className={`compact-status-card ${message.status}`}><strong>{message.status === "started" ? "正在压缩上下文" : message.status === "completed" ? "上下文压缩完成" : message.status === "cancelled" ? "上下文压缩已取消" : "上下文压缩失败"}</strong>{message.text && <span>{message.text}</span>}</div>;
  if (message.kind === "tool") return <ToolCard message={message} open={expandTools} sessionId={sessionId} navigationRoot={navigationRoot} onNavigate={onNavigate} />;
  if (message.kind === "permission") return <PermissionCard message={message} sessionId={sessionId} onResolved={onResolved} />;
  if (message.kind === "question") return <QuestionCard message={message} sessionId={sessionId} onResolved={onResolved} />;
  if (message.kind === "plan") return <PlanCard message={message} sessionId={sessionId} onResolved={onResolved} />;
  return null;
});

export function isResolvedInteraction(message: UiMessage): boolean {
  return (message.kind === "permission" || message.kind === "question" || message.kind === "plan")
    && message.resolved === true;
}

export function GeneratedMediaGallery({ messages }: { messages: Array<Extract<UiMessage, { kind: "media" }>> }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? messages : messages.slice(0, 4);
  const images = messages.filter((message) => message.media === "image").length;
  const videos = messages.length - images;
  const label = [images ? `${images} 张图片` : "", videos ? `${videos} 个视频` : ""].filter(Boolean).join("、");
  return <div className={`media-card result-media media-gallery ${messages.length === 1 ? "single" : "multiple"}`}>
    <header><strong>{messages.length === 1 ? messages[0]?.media === "image" ? "生成图片" : "生成视频" : `媒体结果 · ${label}`}</strong><span>最终结果</span></header>
    <div className="media-result-grid">{visible.map((message) => <GeneratedMediaItem key={message.id} message={message} />)}</div>
    {messages.length > 4 && <button type="button" className="media-gallery-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "收起媒体结果" : `再显示 ${messages.length - 4} 项`}</button>}
  </div>;
}

function GeneratedMediaItem({ message }: { message: Extract<UiMessage, { kind: "media" }> }): React.JSX.Element {
  const [preview, setPreview] = useState(false);
  const src = message.isData ? `data:${message.mimeType || "image/png"};base64,${message.source}` : toFileUrl(message.source);
  const [unavailable, setUnavailable] = useState(!src);
  useEffect(() => { setUnavailable(!src); setPreview(false); }, [src]);
  const pathActions = !message.isData && <button onClick={() => void window.grokDesktop.openMedia(message.source)}>打开原文件</button>;
  return <div className="media-result-item">
    {unavailable
      ? <div className="media-unavailable"><strong>{message.media === "image" ? "图片文件不可用" : "视频文件不可用"}</strong><span>历史缓存可能已被清理或原文件已移动。不会再显示损坏的图片占位。</span></div>
      : message.media === "image"
        ? <button className="generated-image-button" onClick={() => setPreview(true)}><img src={src} alt="Grok 生成图片" onLoad={() => setUnavailable(false)} onError={() => setUnavailable(true)} /></button>
        : <video src={src} controls onError={() => setUnavailable(true)} />}
    <div className="media-inline-actions">
      {!unavailable && message.media === "image" && <><button onClick={() => void window.grokDesktop.copyImage(src)}>复制图片</button><button onClick={() => void window.grokDesktop.saveImage(src)}>另存为</button></>}
      {pathActions}
    </div>
    {preview && !unavailable && createPortal(<div className="image-lightbox" role="dialog" aria-modal="true" aria-label="生成图片预览" onClick={() => setPreview(false)}><button aria-label="关闭大图" onClick={() => setPreview(false)}>×</button><img src={src} alt="Grok 生成图片" onError={() => { setUnavailable(true); setPreview(false); }} onClick={(event) => event.stopPropagation()}/><div className="image-lightbox-actions" onClick={(event) => event.stopPropagation()}><button onClick={() => void window.grokDesktop.copyImage(src)}>复制图片</button><button onClick={() => void window.grokDesktop.saveImage(src)}>另存为</button>{!message.isData && <button onClick={() => void window.grokDesktop.openMedia(message.source)}>打开原文件</button>}</div><span>生成图片</span></div>, document.body)}
  </div>;
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
        return <UserImageAttachmentPreview key={attachment.id} attachment={attachment} src={src} onPreview={() => setPreview({ src, name: attachment.name })}/>;
      })}</div>}
      {files.length > 0 && <div className="user-file-previews">{files.map((attachment) => <div className="user-file-preview" key={attachment.id}><span aria-hidden="true">{attachment.kind === "folder" ? "▣" : "▤"}</span><span><strong>{attachment.name}</strong><small>{attachment.availability === "missing" ? "源文件不可用" : formatBytes(attachment.size)}</small></span></div>)}</div>}
      {message.text && <LazyMarkdownView text={message.text} />}
      <div className="user-message-actions">
        {message.delivery && message.delivery !== "sent" && <span className={`delivery-state ${message.delivery}`}>{message.delivery === "failed" ? "发送失败" : message.delivery === "queued" ? "已排队" : "发送中"}</span>}
        {message.delivery === "failed" && onRetry && <button type="button" className="retry-message" onClick={() => onRetry(message)}>恢复到输入框</button>}
        {message.text && <button type="button" title="复制消息" aria-label="复制消息" onClick={() => void navigator.clipboard.writeText(message.text)}>复制</button>}
      </div>
    </div>
    {preview && createPortal(<div className="image-lightbox" role="dialog" aria-modal="true" aria-label={preview.name} onClick={() => setPreview(undefined)}><button type="button" aria-label="关闭大图" onClick={() => setPreview(undefined)}>×</button><img src={preview.src} alt={preview.name} onClick={(event) => event.stopPropagation()} /><div className="image-lightbox-actions" onClick={(event) => event.stopPropagation()}><button onClick={() => void window.grokDesktop.copyImage(preview.src)}>复制图片</button><button onClick={() => void window.grokDesktop.saveImage(preview.src)}>另存为</button></div><span>{preview.name}</span></div>, document.body)}
  </div>;
}

function UserImageAttachmentPreview({ attachment, src, onPreview }: {
  attachment: NonNullable<Extract<UiMessage, { kind: "user" }>["attachments"]>[number];
  src: string;
  onPreview(): void;
}): React.JSX.Element {
  const [unavailable, setUnavailable] = useState(attachment.availability === "missing" || !src);
  useEffect(() => setUnavailable(attachment.availability === "missing" || !src), [attachment.availability, src]);
  return <div className="image-action-surface">
    <button type="button" className={`user-image-preview ${unavailable ? "missing" : ""}`} disabled={unavailable} title={attachment.name} onClick={onPreview}>
      {unavailable ? <span><strong>{attachment.name}</strong><small>源文件不可用</small></span> : <img src={src} alt={attachment.name} onLoad={() => setUnavailable(false)} onError={() => setUnavailable(true)} />}
    </button>
    {!unavailable && <div className="media-inline-actions compact"><button onClick={() => void window.grokDesktop.copyImage(src)}>复制</button><button onClick={() => void window.grokDesktop.saveImage(src)}>另存</button></div>}
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
    <summary><span className="tool-icon">{tool.kind === "computer_use" ? "◉" : "›_"}</span><span>{tool.title}</span>{typeof tool.readOnly === "boolean" && <span className="tool-access" title="由 Grok Build CLI 声明的工具访问性质">{tool.readOnly ? "只读" : "可写"}</span>}<span className="tool-status">{statusLabel(tool.status)}</span></summary>
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
  const [state, setState] = useState<{ value: "idle" | "submitting" | "failed"; message?: string; optionId?: string }>({ value: "idle" });
  const respond = async (id: string): Promise<void> => {
    if (state.value === "submitting") return;
    setState({ value: "submitting", message: "正在提交决定…", optionId: id });
    try {
      await window.grokDesktop.respondPermission(sessionId, message.request.requestId, id);
      onResolved?.(message.id);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (isExpiredInteractionError(detail)) { onResolved?.(message.id); return; }
      setState({ value: "failed", message: detail });
    }
  };
  const detail = protectedActionSummary(message.request.toolCall);
  const script = protectedActionScript(message.request.toolCall);
  const denyOptions = message.request.options.filter((option) => isDenyPermission(option.name, option.kind));
  const allowOptions = message.request.options.filter((option) => !isDenyPermission(option.name, option.kind));
  const primaryOption = allowOptions.find((option) => option.kind === "allow_once") ?? allowOptions.at(-1);
  const scopedOptions = allowOptions.filter((option) => option.optionId !== primaryOption?.optionId);
  const optionButton = (option: typeof message.request.options[number], className = "") => <button
    key={option.optionId}
    type="button"
    className={className}
    disabled={state.value === "submitting"}
    onClick={() => void respond(option.optionId)}
  >{state.value === "submitting" && state.optionId === option.optionId ? "提交中…" : localizedPermissionName(option.name, option.kind)}</button>;
  return <section className="action-card decision-card codex-request-card" aria-label="权限确认">
    <div className="request-card-body"><span className="request-card-eyebrow">需要批准</span><strong>{detail || "Grok 准备执行一项受保护操作"}</strong><p>允许后将继续当前回合；拒绝不会创建新的用户消息。</p>{script && <details className="permission-script"><summary>查看完整命令</summary><pre>{script}</pre><button type="button" onClick={() => void navigator.clipboard.writeText(script)}>复制命令</button></details>}</div>
    {state.message && <div className={`decision-status ${state.value}`}>{state.message}</div>}
    <footer className="request-card-actions">
      <div className="request-leading-actions">{scopedOptions.map((option) => optionButton(option))}</div>
      <div className="request-primary-actions">{denyOptions.map((option) => optionButton(option))}{primaryOption ? optionButton(primaryOption, "primary") : null}</div>
    </footer>
  </section>;
}

function QuestionCard({ message, sessionId, onResolved }: { message: Extract<UiMessage, { kind: "question" }>; sessionId: string; onResolved?: (id: string) => void }): React.JSX.Element {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [state, setState] = useState<{ value: "idle" | "submitting" | "failed"; message?: string }>({ value: "idle" });
  const submit = async (): Promise<void> => {
    if (state.value === "submitting") return;
    setState({ value: "submitting", message: "正在提交回答…" });
    try { await window.grokDesktop.respondQuestion(sessionId, message.requestId, answers); onResolved?.(message.id); }
    catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (isExpiredInteractionError(detail)) { onResolved?.(message.id); return; }
      setState({ value: "failed", message: detail });
    }
  };
  return <section className="action-card decision-card"><header><span className="decision-icon" aria-hidden="true">?</span><div><strong>Grok 需要你的回答</strong><p>回答后原回合会继续，不会额外发送一条用户消息。</p></div></header>{message.questions.map((question) => <label key={question.question}><span>{question.question}</span>{question.options?.length ? <select disabled={state.value === "submitting"} value={answers[question.question] || ""} onChange={(event) => setAnswers({ ...answers, [question.question]: event.target.value })}><option value="">请选择</option>{question.options.map((option) => <option key={option.label}>{option.label}</option>)}</select> : <input disabled={state.value === "submitting"} value={answers[question.question] || ""} onChange={(event) => setAnswers({ ...answers, [question.question]: event.target.value })} />}</label>)}{state.message && <div className={`decision-status ${state.value}`}>{state.message}</div>}<button disabled={state.value === "submitting"} onClick={() => void submit()}>{state.value === "submitting" ? "提交中…" : "提交回答"}</button></section>;
}

function PlanCard({ message, sessionId, onResolved }: { message: Extract<UiMessage, { kind: "plan" }>; sessionId: string; onResolved?: (id: string) => void }): React.JSX.Element {
  const [comment, setComment] = useState("");
  const [showComment, setShowComment] = useState(false);
  const [decision, setDecision] = useState<{ state: "idle" | "submitting" | "accepted" | "failed"; message?: string }>({ state: message.resolved ? "accepted" : "idle" });
  if (!message.interactive || message.requestId === undefined || message.requestId === "") {
    return <details className="plan-card plan-document" open><summary>实施计划</summary><LazyMarkdownView text={message.text || "计划正在生成。"} /></details>;
  }
  const answer = async (verdict: "approved" | "rejected" | "cancelled"): Promise<void> => {
    if (decision.state !== "idle" && decision.state !== "failed") return;
    setDecision({ state: "submitting", message: "正在提交计划决策…" });
    try {
      const receipt = await window.grokDesktop.respondPlan(sessionId, message.requestId, verdict, comment);
      setDecision({ state: "accepted", message: receipt.message });
      onResolved?.(message.id);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (isExpiredInteractionError(detail)) { onResolved?.(message.id); return; }
      setDecision({ state: "failed", message: detail });
    }
  };
  const locked = decision.state === "submitting" || decision.state === "accepted";
  return <section className="plan-card decision-card codex-request-card codex-plan-request">
    <div className="request-card-body"><span className="request-card-eyebrow">计划</span><strong>准备实施以下计划</strong><p>实施、继续规划或取消只会响应当前计划请求一次。</p></div>
    <div className="plan-content"><LazyMarkdownView text={message.text || "计划已生成，请选择下一步。"} /></div>
    {showComment && <div className="plan-feedback"><textarea autoFocus disabled={locked} placeholder="补充要求（可选，随本次决定提交）" value={comment} onChange={(event) => setComment(event.target.value)} /></div>}
    {decision.message && <div className={`plan-decision-status ${decision.state}`}>{decision.message}</div>}
    <footer className="request-card-actions">
      <div className="request-leading-actions"><button type="button" disabled={locked} aria-expanded={showComment} onClick={() => setShowComment((value) => !value)}>{showComment ? "收起说明" : "添加说明"}</button></div>
      <div className="request-primary-actions"><button type="button" disabled={locked} onClick={() => void answer("rejected")}>继续规划</button><button type="button" disabled={locked} onClick={() => void answer("cancelled")}>取消</button><button type="button" disabled={locked} className="primary" onClick={() => void answer("approved")}>{decision.state === "submitting" ? "提交中…" : "实施计划"}</button></div>
    </footer>
  </section>;
}

function ErrorCard({ text, failure, onDiagnose }: { text: string; failure?: TurnFailure; onDiagnose?(failure: TurnFailure): void }): React.JSX.Element {
  const safe = redactErrorText(text);
  // A classified failure carries its own summary. summarizeError only ever
  // matched the offline fixture's format, so it stays as the fallback.
  const summary = failure ? summarizeTurnFailure(failure) : summarizeError(safe);
  const facts: Array<[string, string]> = failure ? ([
    ["状态", failure.httpStatus === undefined ? "" : String(failure.httpStatus)],
    ["Provider", failure.providerId ?? ""],
    ["模型", failure.modelId ?? ""],
    ["Trace", failure.traceId ?? ""],
    ["重试于", failure.retryAfter ?? ""],
    ["网关阶段", failure.gatewayPhase ?? ""],
    ["断开来源", failure.gatewayReason ?? ""],
    ["网络路由", failure.gatewayProxyMode === "direct" ? "直连" : failure.gatewayProxyMode === "inherit" ? "继承应用代理" : ""],
    ["网关请求", failure.gatewayRequestId ?? ""],
    ["网关耗时", failure.gatewayElapsedMs === undefined ? "" : `${failure.gatewayElapsedMs} ms`],
    ["Schema 清理", failure.sanitizedCount ? `${failure.sanitizedCount} 处` : ""],
  ].filter(([, value]) => value) as Array<[string, string]>) : [];
  return <details className={`error-card structured-error ${failure ? failure.classification : ""}`}>
    <summary><span>请求失败</span><strong>{summary}</strong></summary>
    <div className="error-detail">
      {failure?.nextActions?.length ? <div className="failure-actions"><strong>可以这样处理</strong><ul>{failure.nextActions.map((action: string) => <li key={action}>{action}</li>)}</ul></div> : null}
      {facts.length > 0 && <dl className="failure-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
      <pre>{safe}</pre>
      <div className="button-row">
        <button type="button" onClick={() => void navigator.clipboard.writeText(failure ? `${summary}

${safe}` : safe)}>复制脱敏诊断</button>
        {failure && onDiagnose && <button type="button" onClick={() => onDiagnose(failure)}>诊断此错误</button>}
      </div>
    </div>
  </details>;
}

export function summarizeError(value: string): string {
  const http = /HTTP\s+(\d{3})/i.exec(value)?.[1];
  const provider = /Provider:\s*([^\r\n]+)/i.exec(value)?.[1]?.trim();
  const first = value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "未知错误";
  return [http ? `HTTP ${http}` : "", provider ? `Provider ${provider}` : "", first.replace(/^HTTP\s+\d{3}\s*/i, "").slice(0, 120)].filter(Boolean).join(" · ");
}

export function redactErrorText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+\/=-]+/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:key|token|api_key|access_token)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(\"(?:api[_-]?key|x-api-key|access[_-]?token|authorization|cookie|password)\"\s*:\s*(?:\[\s*)?\")[^\"]+/gi, "$1[REDACTED]")
    .replace(/\b[A-Z]:\\Users\\[^\\\r\n]+/gi, "C:\\Users\\[USER]")
    .slice(0, 32_000);
}

function statusLabel(status: string): string { return status === "completed" ? "完成" : status === "failed" ? "失败" : status === "in_progress" ? "运行中" : "等待"; }
function permissionLabel(kind?: string): string { return kind === "allow_always" ? "始终允许" : kind === "allow_once" ? "仅本次允许" : /reject|deny/.test(kind || "") ? "拒绝" : "确认"; }
function localizedPermissionName(name?: string, kind?: string): string {
  if (/^(?:yes|allow|proceed)/i.test(name || "") || /allow/.test(kind || "")) return permissionLabel(kind || "allow_once");
  if (/^(?:no|deny|reject)/i.test(name || "") || /reject|deny/.test(kind || "")) return "拒绝并说明原因";
  return name?.trim() || permissionLabel(kind);
}
function isDenyPermission(name?: string, kind?: string): boolean { return /^(?:no|deny|reject)/i.test(name || "") || /reject|deny/.test(kind || ""); }
function isExpiredInteractionError(value: string): boolean {
  return /已经结束|已被响应|已被回答|没有可响应|request.*(?:ended|closed|expired|not found)|invalid request/i.test(value);
}
export function protectedActionSummary(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const tool = value as Record<string, unknown>;
  const title = [tool.title, tool.name, tool.description].find((item): item is string => typeof item === "string" && Boolean(item.trim()));
  return title?.trim().slice(0, 240) ?? "";
}
export function protectedActionScript(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const tool = value as Record<string, unknown>;
  const input = tool.rawInput && typeof tool.rawInput === "object" ? tool.rawInput as Record<string, unknown>
    : tool.input && typeof tool.input === "object" ? tool.input as Record<string, unknown>
      : tool.arguments && typeof tool.arguments === "object" ? tool.arguments as Record<string, unknown>
        : tool;
  const direct = [input.command, input.script, input.cmd, input.code, input.shell_command, input.shellCommand]
    .find((item): item is string => typeof item === "string" && Boolean(item.trim()));
  if (direct) return direct.trim().slice(0, 64_000);
  const commands = input.commands;
  if (Array.isArray(commands)) {
    return commands.flatMap((item) => typeof item === "string" ? [item] : item && typeof item === "object"
      ? [String((item as Record<string, unknown>).command ?? (item as Record<string, unknown>).script ?? "")]
      : []).filter(Boolean).join("\n").slice(0, 64_000);
  }
  return "";
}
function toFileUrl(path: string): string {
  // Durable conversation media is exposed only through an opaque handle. A
  // raw path here means an old/corrupt projection escaped main-process
  // normalization; render it as unavailable instead of minting a path URL in
  // the sandboxed Renderer.
  return path.startsWith("grok-media://access/") ? path : "";
}
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
