import { useEffect, useRef, useState } from "react";
import type { CliUpdateAction, CliUpdatePolicy, CliUpdateState } from "../../../shared/types";
import { useAppStore } from "../store";

const phases: Record<CliUpdateState["phase"], string> = {
  idle: "空闲", preparing: "保存会话", downloading: "下载固定版本", verifying: "验证 ACP",
  "rolling-back": "回滚版本", restoring: "恢复会话",
};

/** Both About and Settings use the same confirmation and recovery flow. */
export function CliUpdateControls(): React.JSX.Element {
  const [policy, setPolicy] = useState<CliUpdatePolicy>("standard");
  const [state, setState] = useState<CliUpdateState>({ phase: "idle" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    let disposed = false;
    const refresh = () => void window.grokDesktop.getCliUpdateState().then((value) => { if (!disposed) setState(value); }).catch(() => undefined);
    refresh(); const timer = window.setInterval(refresh, 1_000);
    return () => { disposed = true; generation.current++; window.clearInterval(timer); };
  }, []);
  const run = async (action: CliUpdateAction): Promise<void> => {
    if (busy || state.phase !== "idle") return;
    const request = ++generation.current;
    setBusy(true);
    try {
      const selected = action === "rollback" ? "standard" : policy;
      const preview = await window.grokDesktop.previewCliUpdate(selected, action);
      if (action === "update" && selected === "standard" && preview.compatibilityGate?.status === "failed") throw new Error("标准升级兼容名单未通过；可选择高级策略后重新预览。");
      const detail = preview.compatibilityGate?.checks.map((check) => `${check.label}：${check.status}`).join("\n") || "将执行核心 ACP 验证";
      if (!window.confirm(`${action === "rollback" ? "回滚" : action === "verify" ? "重新验证" : "更新"} CLI ${preview.fromVersion} → ${preview.targetVersion}\n\n${detail}\n\n策略：${selected === "standard" ? "标准升级" : selected === "try-new" ? "尝试新版，验证失败回滚" : "强制保留：验证失败不自动回滚，实时会话将暂停"}`)) return;
      if (selected === "retain-unverified" && !window.confirm(`再次确认：若 ${preview.targetVersion} 的 ACP 验证失败，仍保留新版，不恢复实时会话、不重发消息。你可以稍后重新验证或回滚。`)) return;
      setMessage("开始更新事务…");
      const receipt = await window.grokDesktop.applyCliUpdate({ targetVersion: preview.targetVersion, expectedCurrentVersion: preview.fromVersion, confirmationToken: preview.confirmationToken, policy: selected, action, allowMajorUpgrade: preview.majorUpgrade });
      setMessage(receipt.message);
    } catch (error) { setMessage(`操作未完成：${error instanceof Error ? error.message : String(error)}`); }
    finally {
      setPolicy("standard");
      const nextState = await window.grokDesktop.getCliUpdateState().catch(() => ({ phase: "idle" as const }));
      if (request === generation.current) { setState(nextState); setBusy(false); }
      // The transaction has ended. A slow/proxied stable check must not keep
      // strategy selection or offline recovery locked, or overwrite a later run.
      void Promise.all([
        window.grokDesktop.checkCliUpdate().catch(() => undefined),
        window.grokDesktop.getCliUpdateHistory().catch(() => undefined),
      ]).then(([cli, history]) => {
        if (request !== generation.current) return;
        if (cli) useAppStore.getState().setCli(cli);
        if (history) useAppStore.getState().setUpdateHistory(history);
      });
    }
  };
  const locked = busy || state.phase !== "idle";
  return <section className="cli-update-controls">
    <label>本次升级策略 <select aria-label="CLI 升级策略" value={policy} disabled={locked} onChange={(event) => setPolicy(event.target.value as CliUpdatePolicy)}>
      <option value="standard">标准升级（默认）</option><option value="try-new">尝试新版：忽略兼容名单</option><option value="retain-unverified">高级：验证失败仍保留新版</option>
    </select></label>
    <div className="button-row">
      <button disabled={locked} onClick={() => void run("update")}>{state.recovery ? "重新预览并升级 CLI" : "预览并更新 CLI"}</button>
      {state.recovery && <>
      <button disabled={locked} onClick={() => void run("verify")}>重新验证当前 CLI</button>
      <button disabled={locked} onClick={() => void run("rollback")}>回滚到 {state.recovery.previousVersion}</button>
    </>}</div>
    {state.recovery && <p>上次目标 {state.recovery.targetVersion}；回滚点 {state.recovery.previousVersion} 为本次连续升级前版本，不是固定版本。</p>}
    <p role="status" aria-live="polite">{state.phase !== "idle" ? phases[state.phase] : message || (state.recovery?.retained ? "上次更新尚未完成兼容验证，实时会话暂停；可验证当前 CLI、回滚或重新选择策略升级。本地记录仍可查看。" : "更新前展示固定目标并确认；不会静默安装。")}</p>
  </section>;
}
