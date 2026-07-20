import { lazy, memo, Suspense, useEffect, useState } from "react";
import type { UiMessage } from "../store";
import { LazyMarkdownView } from "./LazyMarkdownView";

const DiffEditor = lazy(async () => {
  const module = await import("@monaco-editor/react");
  return { default: module.DiffEditor };
});

export const MessageCard = memo(function MessageCard({ message, sessionId, showThinking, expandTools, onResolved }: { message: UiMessage; sessionId: string; showThinking: boolean; expandTools: boolean; onResolved?: (id: string) => void }): React.JSX.Element | null {
  if (message.kind === "thought" && !showThinking) return <div className="thinking-placeholder"><span /> 思考过程</div>;
  if (message.kind === "user") return <div className="message-row user"><div className="bubble user-bubble"><LazyMarkdownView text={message.text} /></div></div>;
  if (message.kind === "assistant") return <div className="message-row assistant"><div className="assistant-body"><LazyMarkdownView text={message.text} /></div></div>;
  if (message.kind === "thought") return <div className="thought-card"><LazyMarkdownView text={message.text} /></div>;
  if (message.kind === "error") return <div className="error-card">{message.text}</div>;
  if (message.kind === "media") {
    const src = message.isData ? `data:${message.mimeType || "image/png"};base64,${message.source}` : toFileUrl(message.source);
    return <div className="media-card">{message.media === "image" ? <img src={src} alt="Grok 生成图片" /> : <video src={src} controls />}{!message.isData && <div className="button-row"><button onClick={() => void window.grokDesktop.openPath(message.source)}>打开原文件</button><button onClick={() => void navigator.clipboard.writeText(message.source)}>复制路径</button></div>}</div>;
  }
  if (message.kind === "tool") return <ToolCard message={message} open={expandTools} />;
  if (message.kind === "permission") return <PermissionCard message={message} sessionId={sessionId} onResolved={onResolved} />;
  if (message.kind === "question") return <QuestionCard message={message} sessionId={sessionId} onResolved={onResolved} />;
  if (message.kind === "plan") return <PlanCard message={message} sessionId={sessionId} onResolved={onResolved} />;
  return null;
});

function ToolCard({ message, open }: { message: Extract<UiMessage, { kind: "tool" }>; open: boolean }): React.JSX.Element {
  const tool = message.tool;
  const hasDiff = typeof tool.oldText === "string" && typeof tool.newText === "string";
  const [expanded, setExpanded] = useState(open);
  const [light, setLight] = useState(() => document.documentElement.dataset.themeResolved === "light");
  useEffect(() => { if (open) setExpanded(true); }, [open]);
  useEffect(() => { const update = (): void => setLight(document.documentElement.dataset.themeResolved === "light"); document.documentElement.addEventListener("grok-theme-change", update); return () => document.documentElement.removeEventListener("grok-theme-change", update); }, []);
  const images = (tool.content ?? []).flatMap((value) => { const item = value && typeof value === "object" ? value as Record<string, unknown> : {}; return item.type === "image" && typeof item.data === "string" ? [{ data: item.data, mimeType: typeof item.mimeType === "string" ? item.mimeType : "image/png" }] : []; });
  return <details className={`tool-card ${tool.status}`} open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}><summary><span className="tool-icon">{tool.kind === "computer_use" ? "◉" : "›_"}</span><span>{tool.title}</span><span className="tool-status">{statusLabel(tool.status)}</span></summary>{expanded && <div className="tool-detail">{tool.command && <pre className="command">{tool.command}</pre>}{tool.output && <pre className="output">{tool.output}</pre>}{tool.error && <div className="error-text">{tool.error}</div>}{images.map((image, index) => <img className="computer-screenshot" key={index} src={`data:${image.mimeType};base64,${image.data}`} alt="Computer Use 窗口截图" />)}{tool.truncated && <div className="output-truncated">输出过长，界面中已截断。</div>}{hasDiff && <Suspense fallback={<div className="diff-loading">正在加载 Diff…</div>}><DiffEditor height="300px" original={tool.oldText} modified={tool.newText} theme={light ? "vs" : "vs-dark"} options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, automaticLayout: true }} /></Suspense>}{!hasDiff && tool.rawInput != null && <pre>{JSON.stringify(tool.rawInput, null, 2)}</pre>}</div>}</details>;
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
