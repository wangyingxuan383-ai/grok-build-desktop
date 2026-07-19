import { useEffect, useState } from "react";
import type { SupportBundlePreview, SystemCompatibilityReport } from "../../../shared/types";

export function DiagnosticsPanel({ onClose }: { onClose(): void }): React.JSX.Element {
  const [report, setReport] = useState<SystemCompatibilityReport>();
  const [preview, setPreview] = useState<SupportBundlePreview>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const run = async (): Promise<void> => {
    setBusy(true); setMessage("");
    try { setReport(await window.grokDesktop.runDiagnostics()); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  useEffect(() => { void run(); void window.grokDesktop.previewSupportBundle().then(setPreview); }, []);

  const copy = async (): Promise<void> => {
    if (!report) return;
    const lines = [`Grok Build Desktop 兼容诊断（${report.overall}）`, `检查时间：${report.checkedAt}`, ...report.items.map((item) => `${item.status.toUpperCase()} ${item.label}：${item.summary}`)];
    await navigator.clipboard.writeText(lines.join("\n")); setMessage("诊断摘要已复制");
  };
  const exportBundle = async (): Promise<void> => {
    setBusy(true);
    try { const path = await window.grokDesktop.exportSupportBundle(); if (path) setMessage(`支持包已保存：${path}`); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  return <div className="modal-backdrop"><section className="control-panel diagnostics-panel" role="dialog" aria-modal="true">
    <header><div><h2>兼容诊断中心</h2><p>只执行无模型消耗的能力探测；额度与真实会话不会被读取。</p></div><button className="icon-button" onClick={onClose}>×</button></header>
    <div className="panel-scroll">
      <div className={`diagnostic-overall ${report?.overall || "checking"}`}>{busy ? "正在检查…" : report ? ({ ready: "可以使用", limited: "部分能力受限", blocked: "核心能力不可用" }[report.overall]) : "等待检查"}</div>
      <div className="diagnostic-list">{report?.items.map((item) => <article className={`diagnostic-item ${item.status}`} key={item.id}><span className="diagnostic-dot"/><div><strong>{item.label}</strong><p>{item.summary}</p>{item.details?.map((line) => <code key={line}>{line}</code>)}</div></article>)}</div>
      {preview && <section className="support-preview"><h3>脱敏支持包</h3><p>将包含：{preview.fields.join("、")}</p><p>明确排除：{preview.excluded.join("、")}</p>{preview.files.map((file) => <div key={file.name}><code>{file.name}</code> — {file.description}</div>)}</section>}
      {message && <p className="panel-message">{message}</p>}
    </div>
    <footer className="button-row"><button onClick={run} disabled={busy}>重新检查</button><button onClick={copy} disabled={!report}>复制摘要</button><button className="primary" onClick={exportBundle} disabled={busy}>导出支持包</button></footer>
  </section></div>;
}
