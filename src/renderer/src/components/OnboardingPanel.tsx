import { MobileDownloadCard } from "./MobileDownloadCard";
import { PanelSurface } from "./ui/PanelSurface";
import { useEffect, useState } from "react";
import type { OnboardingState, SystemCompatibilityReport } from "../../../shared/types";
import { useAppStore } from "../store";
import { CliUpdateControls } from "./CliUpdateControls";
import { AppUpdateInstaller } from "./AppUpdateInstaller";

const INSTALL_COMMAND = "irm https://x.ai/cli/install.ps1 | iex";
type StepId = "system" | "cli" | "account" | "workspace" | "mobile" | "notify" | "computer" | "done";
const STEPS: ReadonlyArray<readonly [StepId, string]> = [["system", "系统检查"], ["cli", "Grok CLI"], ["account", "账号登录"], ["workspace", "项目工作区"], ["mobile", "手机版"], ["notify", "提醒通知"], ["computer", "Computer Use"], ["done", "开始使用"]];
type Status = "ok" | "todo" | "optional" | "checking";

/**
 * First-run guide as a checklist: every step shows its live status, can be visited in any
 * order and finished later from Help. Nothing is installed or changed without a click.
 */
export function OnboardingPanel({ state, onState, onClose, onAccounts, onWorkspace, onRemote }: {
  state: OnboardingState;
  onState(value: OnboardingState): void;
  onClose(): void;
  onAccounts(): void;
  onWorkspace(): void;
  onRemote?(): void;
}): React.JSX.Element {
  const store = useAppStore();
  const [step, setStep] = useState(Math.min(STEPS.length - 1, state.currentStep));
  const [report, setReport] = useState<SystemCompatibilityReport>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [launched, setLaunched] = useState(false);

  const run = async (): Promise<void> => { setBusy(true); try { setReport(await window.grokDesktop.runDiagnostics()); } finally { setBusy(false); } };
  useEffect(() => { void run(); void window.grokDesktop.checkAppUpdate(false).then(store.setAppRelease).catch(() => undefined); }, []);
  const persist = async (patch: Partial<OnboardingState>): Promise<void> => onState(await window.grokDesktop.updateOnboarding(patch));
  const move = async (next: number): Promise<void> => { setStep(next); setNotice(""); await persist({ currentStep: next, lastCheckedAt: new Date().toISOString() }); };
  const complete = async (): Promise<void> => { await persist({ completed: true, skipped: false, currentStep: 0 }); onClose(); };
  const skip = async (): Promise<void> => { await persist({ skipped: true, currentStep: step }); onClose(); };
  const cli = report?.items.find((item) => item.id === "cli");
  const computer = report?.items.find((item) => item.id === "computer");
  const account = store.accounts.some((row) => row.active) || report?.items.find((item) => item.id === "models")?.status === "ok";
  const workspace = Boolean(store.settings?.activeWorkspace || store.settings?.recentWorkspaces?.length || store.sessions.length);
  const status: Record<StepId, Status> = {
    system: !report ? "checking" : report.items.some((item) => item.status === "error") ? "todo" : "ok",
    cli: !report ? "checking" : cli?.status === "ok" ? "ok" : "todo",
    account: account ? "ok" : "todo",
    workspace: workspace ? "ok" : "todo",
    mobile: "optional", notify: "optional",
    computer: computer?.status === "ok" ? "ok" : "optional",
    done: "optional",
  };
  const id = STEPS[step]![0];
  const pending = STEPS.filter(([key]) => status[key] === "todo").map(([, name]) => name);
  const icon = (value: Status) => value === "ok" ? "✓" : value === "todo" ? "!" : value === "checking" ? "…" : "·";

  return <PanelSurface className="modal-backdrop onboarding-backdrop"><section className="control-panel onboarding-panel" role="dialog" aria-modal="true" aria-label="首次设置">
    <header><div><h2>欢迎使用 Grok Build Desktop</h2><p>按需完成以下项目；随时可在“帮助 → 重新运行首次设置”回来。</p></div><button data-panel-close className="icon-button" aria-label="稍后再说" onClick={skip}>×</button></header>
    <nav className="onboarding-steps" aria-label="设置清单">{STEPS.map(([key, name], index) => <button key={key} className={[index === step ? "active" : "", status[key] === "ok" ? "done" : "", status[key] === "todo" ? "todo" : ""].filter(Boolean).join(" ")} aria-current={index === step ? "step" : undefined} onClick={() => void move(index)}><span aria-hidden="true">{icon(status[key])}</span>{name}{status[key] === "optional" && key !== "done" ? <small>可选</small> : null}</button>)}</nav>
    <div className="panel-scroll onboarding-content">
      {id === "system" && <><h3>系统与安全能力</h3><p>检查 Windows x64、应用数据目录和 DPAPI。不会读取真实会话或调用付费模型。</p><DiagnosticSummary report={report}/><div className="button-row"><button onClick={run} disabled={busy}>{busy ? "检查中…" : "重新检查"}</button></div>
        {store.appRelease?.updateAvailable ? <div className="onboarding-callout"><strong>桌面应用有新版本 {store.appRelease.latestVersion}</strong><AppUpdateInstaller release={store.appRelease} compact /></div> : null}</>}
      {id === "cli" && <><h3>Grok CLI</h3><p className={cli?.status === "ok" ? "success-text" : "warning-text"}>{cli?.summary || "正在检测…"}</p>
        {cli?.status === "ok" ? <><p>可在这里检查并更新到官方 stable 版本；更新前会显示目标版本，失败可回滚。</p><CliUpdateControls/></> : <>
          <p>应用使用你本机安装的官方 Grok CLI。点击下方按钮会打开一个 PowerShell 窗口运行 xAI 官方安装脚本，你可以看到完整过程。</p>
          <div className="button-row"><button className="primary" onClick={() => void window.grokDesktop.installCliInteractive().then(() => { setLaunched(true); setNotice("安装窗口已打开。完成后点击“重新检测”。"); }).catch((error) => setNotice(String(error)))}>一键安装官方 CLI</button><button onClick={run} disabled={busy}>{busy ? "检测中…" : launched ? "重新检测" : "已安装？重新检测"}</button></div>
          <details><summary>手动安装</summary><code className="command-box">{INSTALL_COMMAND}</code><div className="button-row"><button onClick={() => void navigator.clipboard.writeText(INSTALL_COMMAND).then(() => setNotice("安装命令已复制"))}>复制安装命令</button><button onClick={() => window.grokDesktop.openExternal("https://docs.x.ai/build/overview")}>打开官方文档</button></div></details>
        </>}</>}
      {id === "account" && <><h3>登录 Grok Build</h3><p className={account ? "success-text" : undefined}>{account ? "已检测到可用账号。" : "支持浏览器 OAuth 和 xAI API Key 配置档；凭据通过 Windows DPAPI 加密。"}</p><div className="button-row"><button className="primary" onClick={onAccounts}>{account ? "管理账号" : "打开账号面板"}</button></div></>}
      {id === "workspace" && <><h3>选择项目工作区</h3><p className={workspace ? "success-text" : undefined}>{workspace ? `当前项目：${store.settings?.activeWorkspace || "已有项目"}` : "选择一个代码文件夹作为第一个项目。应用也会从现有 Grok 与 Codex 会话中自动发现项目。"}</p><div className="button-row"><button className="primary" onClick={onWorkspace}>{workspace ? "选择其他文件夹" : "选择文件夹"}</button></div></>}
      {id === "mobile" && <><h3>在手机上继续工作</h3><p>安装 Grok Remote（Android）后，可以在同一 Wi-Fi 下查看会话、继续对话、处理确认和浏览作品。电脑负责执行，手机只做遥控。</p>
        <MobileDownloadCard />
        <ol><li>安装手机客户端。</li><li>开启电脑手机连接并生成配对二维码。</li><li>手机扫码后，在电脑允许配对。</li></ol>
        <div className="button-row">{onRemote ? <button className="primary" onClick={onRemote}>开启手机连接并配对</button> : null}</div></>}
      {id === "notify" && <><h3>提醒通知</h3><p>会话完成、失败或需要你确认时，Windows 右下角会弹出提醒；点击提醒直接打开对应会话。只有真正的回答结束才会提醒，切换模型或强度不会。</p><div className="button-row"><button className="primary" onClick={() => void window.grokDesktop.testDesktopNotification().then(() => setNotice("已发送测试提醒；如果没看到，请检查 Windows 设置 → 系统 → 通知。")).catch((error) => setNotice(String(error)))}>发送测试提醒</button></div><p className="muted-text">提醒方式（总是 / 仅在后台 / 关闭）与声音可在“设置 → 通知”中调整。</p></>}
      {id === "computer" && <><h3>Computer Use（可选）</h3><p>{computer?.summary || "正在检测 Windows Harness…"}</p><p>启用时窗口边缘会显示蓝色提示；随时按 <kbd>Ctrl+Alt+Esc</kbd> 紧急停止。UAC 与安全桌面必须由用户手动处理。</p></>}
      {id === "done" && <><h3>{pending.length ? "还差几步" : "准备完成"}</h3>{pending.length ? <p className="warning-text">尚未完成：{pending.join("、")}。也可以先开始，之后再补。</p> : <p className="success-text">必需项目都已就绪。</p>}
        <ul className="onboarding-tips">
          <li><kbd>Ctrl</kbd>+<kbd>K</kbd> 打开命令面板，搜索会话、项目和功能。</li>
          <li>在回答里用鼠标选中一段文字，点击浮出的“引用”即可带着上下文追问。</li>
          <li>左下角切换到图像模式，可以生成与编辑图片；作品在图库集中查看。</li>
          <li>执行模式：Agent 逐项询问，Plan 先规划，Auto 自动批准。可随时在输入框下方切换。</li>
        </ul></>}
      {notice ? <p className="update-status" role="status">{notice}</p> : null}
    </div>
    <footer className="button-row"><button onClick={skip}>稍后再说</button><span className="spacer"/><button disabled={step === 0} onClick={() => void move(step - 1)}>上一步</button>{step < STEPS.length - 1 ? <button className="primary" onClick={() => void move(step + 1)}>下一步</button> : <button className="primary" onClick={complete}>开始使用</button>}</footer>
  </section></PanelSurface>;
}

function DiagnosticSummary({ report }: { report?: SystemCompatibilityReport }): React.JSX.Element {
  if (!report) return <p>正在检查…</p>;
  return <div className="onboarding-summary">{report.items.slice(0, 5).map((item) => <div key={item.id} className={item.status}><span>{item.status === "ok" ? "✓" : item.status === "error" ? "×" : "!"}</span><strong>{item.label}</strong><small>{item.summary}</small></div>)}</div>;
}
