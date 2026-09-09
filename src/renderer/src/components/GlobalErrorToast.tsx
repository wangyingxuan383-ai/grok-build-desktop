import { useEffect, useRef, useState } from "react";

/** App-level failures only. Conversation-owned errors stay in their turn or queue. */
export function GlobalErrorToast({ message, onReload, onDiagnostics, onDismiss }: {
  message: string;
  onReload(): void;
  onDiagnostics(): void;
  onDismiss(): void;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const latestMessage = useRef(message);
  latestMessage.current = message;
  useEffect(() => { setCopied(false); setCopyError(false); }, [message]);
  return <aside className="toast error-toast" role="alert" aria-live="assertive">
    <div className="toast-message"><strong>应用操作失败</strong><span>{message}</span></div>
    <div className="toast-actions">
      <button onClick={() => void navigator.clipboard.writeText(message).then(() => { if (latestMessage.current === message) { setCopied(true); setCopyError(false); } }).catch(() => { if (latestMessage.current === message) setCopyError(true); })}>{copyError ? "复制失败，重试" : copied ? "已复制" : "复制诊断"}</button>
      <button onClick={onReload}>重新加载界面</button>
      <button onClick={onDiagnostics}>诊断</button>
      <button aria-label="关闭错误提示" title="关闭" onClick={onDismiss}>×</button>
    </div>
  </aside>;
}
