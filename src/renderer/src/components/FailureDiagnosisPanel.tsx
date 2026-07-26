import { useEffect, useState } from "react";
import type { FailureDiagnosisReport, TurnFailure } from "../../../shared/types";
import { summarizeTurnFailure } from "../../../shared/turn-failure";

/**
 * Diagnoses one specific failed turn. Distinct from the compatibility centre on
 * purpose: that one answers "is my install healthy" and reports all-green while
 * a request is failing, because none of its probes touch the request at all.
 */
export function FailureDiagnosisPanel({ failure, onClose }: { failure: TurnFailure; onClose(): void }): React.JSX.Element {
  const [report, setReport] = useState<FailureDiagnosisReport>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    void window.grokDesktop.diagnoseFailure(failure)
      .then((value) => { if (!cancelled) setReport(value); })
      .catch((value: unknown) => { if (!cancelled) setError(value instanceof Error ? value.message : String(value)); });
    return () => { cancelled = true; };
  }, [failure]);

  const copy = async (): Promise<void> => {
    if (!report) return;
    const lines = [
      `Grok Build Desktop 失败诊断：${report.headline}`,
      `时间：${report.generatedAt}`,
      ...report.items.map((item) => `${item.status.toUpperCase()} ${item.label}：${item.summary}${item.details?.length ? `\n    ${item.details.join("\n    ")}` : ""}`),
      report.actions.length ? `\n建议：\n${report.actions.map((action) => `- ${action}`).join("\n")}` : "",
    ].filter(Boolean);
    await navigator.clipboard.writeText(lines.join("\n"));
    setMessage("诊断结果已复制");
  };

  return <div className="modal-backdrop" onMouseDown={onClose}><section className="control-panel diagnostics-panel failure-diagnosis" role="dialog" aria-modal="true" aria-label="失败诊断" onMouseDown={(event) => event.stopPropagation()}>
    <header><div><h2>诊断这次失败</h2><p>只检查与本次失败相关的项，不重复执行整机兼容体检。</p></div><button className="icon-button" aria-label="关闭失败诊断" onClick={onClose}>×</button></header>
    <div className="panel-scroll">
      <div className={`diagnostic-overall ${report ? "limited" : "checking"}`}>{report ? report.headline : error ? "诊断失败" : "正在检查…"}</div>
      <p className="failure-subject">{summarizeTurnFailure(failure)}</p>
      {error && <p className="panel-message">{error}</p>}
      <div className="diagnostic-list">{report?.items.map((item) => <article className={`diagnostic-item ${item.status}`} key={item.id}>
        <span className="diagnostic-dot"/>
        <div><strong>{item.label}</strong><p>{item.summary}</p>{item.details?.map((line) => <code key={line}>{line}</code>)}</div>
      </article>)}</div>
      {report?.actions.length ? <section className="failure-actions"><strong>可以这样处理</strong><ul>{report.actions.map((action) => <li key={action}>{action}</li>)}</ul></section> : null}
      {message && <p className="panel-message">{message}</p>}
    </div>
    <footer className="button-row"><button onClick={onClose}>关闭</button><button className="primary" onClick={() => void copy()} disabled={!report}>复制诊断</button></footer>
  </section></div>;
}
