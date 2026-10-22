import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  DEFAULT_SESSION_EXPORT_OPTIONS,
  type ConversationExportOptions, type SessionExportApi, type SessionExportPreview,
} from "../../../shared/conversation-export";
import "../styles/session-export.css";

export interface ExportSessionPanelProps {
  sessionId: string;
  title?: string;
  api: SessionExportApi;
  onClose(): void;
}

/** Mount from the existing export-session action. No store, global bridge or conversation renderer. */
export function ExportSessionPanel(props: ExportSessionPanelProps): React.JSX.Element {
  // A different conversation starts with redaction enabled, even when this panel stays mounted.
  return <ExportSessionDialog key={props.sessionId} {...props} />;
}

/** Markdown stays source text; HTML has an opaque sandbox origin and its own restrictive CSP. */
export function ExportSessionPreview({ preview }: { preview: SessionExportPreview }): React.JSX.Element {
  return preview.format === "html"
    ? <iframe className="session-export-html" title="HTML 导出预览" sandbox="" referrerPolicy="no-referrer" srcDoc={preview.content} />
    : <pre className="session-export-markdown" aria-label="Markdown 导出预览" tabIndex={0}>{preview.content}</pre>;
}

function ExportSessionDialog({ sessionId, title, api, onClose }: ExportSessionPanelProps): React.JSX.Element {
  const [options, setOptions] = useState<Required<ConversationExportOptions>>(() => ({ ...DEFAULT_SESSION_EXPORT_OPTIONS }));
  const [result, setResult] = useState<{ key: string; preview?: SessionExportPreview; error?: string }>();
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const mounted = useRef(false);
  const savePending = useRef(false);
  const requestKey = JSON.stringify([sessionId, options, retry]);
  const preview = result?.key === requestKey ? result.preview : undefined;
  const error = result?.key === requestKey ? result.error : undefined;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setResult(undefined);
    void api.previewSessionExport(sessionId, options).then(value => {
      if (cancelled) return;
      if (value.format !== options.format || value.redacted !== (options.redaction === "redacted")) {
        setResult({ key: requestKey, error: "导出设置与预览不一致，请重试。" });
      } else setResult({ key: requestKey, preview: value });
    }).catch(() => {
      if (!cancelled) setResult({ key: requestKey, error: "无法生成导出预览，请重试。" });
    });
    return () => { cancelled = true; };
  }, [api, sessionId, options, requestKey]);

  const change = (patch: ConversationExportOptions): void => {
    setMessage("");
    setOptions(previous => ({ ...previous, ...patch }));
  };
  const save = async (): Promise<void> => {
    if (!preview || savePending.current) return;
    savePending.current = true;
    setSaving(true);
    setMessage("");
    try {
      const path = await api.saveSessionExport(sessionId, { ...options });
      if (mounted.current) setMessage(path ? `已保存：${path}` : "已取消保存");
    } catch {
      if (mounted.current) setMessage("保存失败，请重试。");
    } finally {
      savePending.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return <Dialog.Root open onOpenChange={open => { if (!open && !savePending.current) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="session-export-overlay" />
      <Dialog.Content className="session-export-panel">
        <header>
          <div><Dialog.Title>导出会话</Dialog.Title><Dialog.Description>{title || "当前会话"} · 本地预览</Dialog.Description></div>
          <Dialog.Close className="session-export-close" aria-label="关闭导出" disabled={saving}>×</Dialog.Close>
        </header>
        <fieldset className="session-export-options" disabled={saving}>
          <legend className="session-export-sr-only">导出设置</legend>
          <label>文件格式<select value={options.format} onChange={event => change({ format: event.target.value as "markdown" | "html" })}>
            <option value="markdown">Markdown (.md)</option><option value="html">静态 HTML (.html)</option>
          </select></label>
          <label><input type="checkbox" checked={options.includeTools} onChange={event => change({ includeTools: event.target.checked })} />包含工具详情</label>
          <label><input type="checkbox" checked={options.includeThinking} onChange={event => change({ includeThinking: event.target.checked })} />包含思考内容</label>
          <label><input type="checkbox" checked={options.includeTurnSummary} onChange={event => change({ includeTurnSummary: event.target.checked })} />每轮附带工具、文件与失败摘要</label>
          <label className="session-export-original"><input type="checkbox" role="switch" checked={options.redaction === "original"} aria-describedby="session-export-privacy-note" onChange={event => change({ redaction: event.target.checked ? "original" : "redacted" })} />导出原文（关闭脱敏）</label>
        </fieldset>
        <p id="session-export-privacy-note" className={`session-export-privacy ${options.redaction === "original" ? "original" : ""}`}>
          {options.redaction === "original" ? "原文可能包含密钥、令牌和私有路径，请确认预览后保存。" : "默认隐藏可识别的密钥、令牌和私有路径；保存前请检查预览。"}
        </p>
        <div className="session-export-status" role="status" aria-live="polite">
          {preview ? `${preview.fileName} · ${preview.redacted ? `脱敏替换 ${preview.redactionCount} 处` : "导出原文"}` : error || "正在生成预览…"}
          {error && <button type="button" onClick={() => setRetry(value => value + 1)}>重试预览</button>}
        </div>
        <div className="session-export-preview" aria-busy={!preview && !error}>
          {preview && <ExportSessionPreview preview={preview} />}
        </div>
        <footer><p role="status" aria-live="polite">{message}</p><Dialog.Close disabled={saving}>取消</Dialog.Close><button type="button" className="session-export-save" disabled={!preview || saving} onClick={() => void save()}>{saving ? "保存中…" : "保存导出文件"}</button></footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

export default ExportSessionPanel;
