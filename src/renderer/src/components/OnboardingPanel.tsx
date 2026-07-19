import { useEffect, useState } from "react";
import type { OnboardingState, SystemCompatibilityReport } from "../../../shared/types";

const STEPS = ["系统检查", "Grok CLI", "账号登录", "选择工作区", "Computer Use", "完成"];
const INSTALL_COMMAND = "irm https://x.ai/cli/install.ps1 | iex";

export function OnboardingPanel({ state, onState, onClose, onAccounts, onWorkspace }: {
  state: OnboardingState;
  onState(value: OnboardingState): void;
  onClose(): void;
  onAccounts(): void;
  onWorkspace(): void;
}): React.JSX.Element {
  const [step, setStep] = useState(Math.min(STEPS.length - 1, state.currentStep));
  const [report, setReport] = useState<SystemCompatibilityReport>();
  const [busy, setBusy] = useState(false);

  const run = async (): Promise<void> => { setBusy(true); try { setReport(await window.grokDesktop.runDiagnostics()); } finally { setBusy(false); } };
  useEffect(() => { void run(); }, []);
  const persist = async (patch: Partial<OnboardingState>): Promise<void> => onState(await window.grokDesktop.updateOnboarding(patch));
  const move = async (next: number): Promise<void> => { setStep(next); await persist({ currentStep: next, lastCheckedAt: new Date().toISOString() }); };
  const complete = async (): Promise<void> => { await persist({ completed: true, skipped: false, currentStep: 0 }); onClose(); };
  const skip = async (): Promise<void> => { await persist({ skipped: true, currentStep: step }); onClose(); };
  const cli = report?.items.find((item) => item.id === "cli");
  const computer = report?.items.find((item) => item.id === "computer");

  return <div className="modal-backdrop onboarding-backdrop"><section className="control-panel onboarding-panel" role="dialog" aria-modal="true">
    <header><div><h2>首次设置</h2><p>稍后可在“帮助 → 重新运行首次设置”中再次打开。</p></div><button className="icon-button" onClick={skip}>×</button></header>
    <nav className="onboarding-steps">{STEPS.map((name, index) => <button key={name} className={index === step ? "active" : index < step ? "done" : ""} onClick={() => void move(index)}><span>{index + 1}</span>{name}</button>)}</nav>
    <div className="panel-scroll onboarding-content">
      {step === 0 && <><h3>系统与安全能力</h3><p>检查 Windows x64、应用数据目录和 DPAPI。不会读取真实会话或调用付费模型。</p><DiagnosticSummary report={report}/><button onClick={run} disabled={busy}>{busy ? "检查中…" : "重新检查"}</button></>}
      {step === 1 && <><h3>安装或检测 Grok CLI</h3><p className={cli?.status === "ok" ? "success-text" : "warning-text"}>{cli?.summary || "正在检测…"}</p><code className="command-box">{INSTALL_COMMAND}</code><div className="button-row"><button onClick={() => navigator.clipboard.writeText(INSTALL_COMMAND)}>复制安装命令</button><button onClick={() => window.grokDesktop.openExternal("https://docs.x.ai/build/overview")}>打开官方文档</button><button onClick={run}>重新检测</button></div></>}
      {step === 2 && <><h3>登录 Grok Build</h3><p>支持浏览器 OAuth 和 xAI API Key 配置档；凭据通过 Windows DPAPI 加密。</p><button className="primary" onClick={onAccounts}>打开账号面板</button></>}
      {step === 3 && <><h3>选择项目工作区</h3><p>应用也会从现有 Grok 与 Codex 会话中自动发现项目。</p><button className="primary" onClick={onWorkspace}>选择文件夹</button></>}
      {step === 4 && <><h3>Computer Use</h3><p>{computer?.summary || "正在检测 Windows Harness…"}</p><p>启用时窗口边缘会显示蓝色提示；随时按 <kbd>Ctrl+Alt+Esc</kbd> 紧急停止。UAC 与安全桌面必须由用户手动处理。</p></>}
      {step === 5 && <><h3>准备完成</h3><p>核心会话、扩展和 Computer Use 会按实际 CLI 能力逐项启用。未知版本不会仅因版本号被拒绝。</p><DiagnosticSummary report={report}/></>}
    </div>
    <footer className="button-row"><button onClick={skip}>暂时跳过</button><span className="spacer"/><button disabled={step === 0} onClick={() => void move(step - 1)}>上一步</button>{step < STEPS.length - 1 ? <button className="primary" onClick={() => void move(step + 1)}>下一步</button> : <button className="primary" onClick={complete}>完成设置</button>}</footer>
  </section></div>;
}

function DiagnosticSummary({ report }: { report?: SystemCompatibilityReport }): React.JSX.Element {
  if (!report) return <p>正在检查…</p>;
  return <div className="onboarding-summary">{report.items.slice(0, 5).map((item) => <div key={item.id} className={item.status}><span>{item.status === "ok" ? "✓" : item.status === "error" ? "×" : "!"}</span><strong>{item.label}</strong><small>{item.summary}</small></div>)}</div>;
}
