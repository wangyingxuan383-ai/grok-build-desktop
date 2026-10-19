import { useEffect, useState } from "react";
import type { CliConfigState, CliConfigStatusApi } from "../../../shared/cli-config-state";
import "./CliConfigStatus.css";

const notices: Record<NonNullable<CliConfigState["notice"]>, string> = {
  "config-unavailable": "暂时无法读取 CLI 配置，保留上次可用模型列表。",
  "config-invalid": "CLI 配置尚未写入完整，保留上次可用模型列表。",
  "config-too-large": "CLI 配置超出读取范围，保留上次可用模型列表。",
  "watch-unavailable": "CLI 配置变更监听暂不可用。",
};

/** Parent may supply state directly, or later expose the optional preload contract. */
export function CliConfigStatus({ state, api }: { state?: CliConfigState; api?: Partial<CliConfigStatusApi> }): React.JSX.Element | null {
  const [observed, setObserved] = useState<CliConfigState>();
  useEffect(() => {
    if (state) return;
    const bridge = api ?? (window.grokDesktop as typeof window.grokDesktop & Partial<CliConfigStatusApi>);
    if (!bridge?.getCliConfigState || !bridge.onCliConfigChanged) return;
    let active = true;
    setObserved(undefined);
    const accept = (next: CliConfigState) => {
      if (active) setObserved((previous) => !previous || next.revision > previous.revision ? next : previous);
    };
    const unsubscribe = bridge.onCliConfigChanged(accept);
    void bridge.getCliConfigState().then(accept).catch(() => undefined);
    return () => { active = false; unsubscribe(); };
  }, [state, api]);

  const value = state ?? observed;
  if (!value || value.revision === 0) return null;
  return <div className="cli-config-status" role="status" aria-live="polite">
    <span>CLI 配置{value.defaultModelId ? ` · 默认模型 ${value.defaultModelId}` : ""}</span>
    {value.externalRouting && <span className="cli-config-status-route">默认模型配置了本地端点</span>}
    {value.notice && <span className="cli-config-status-notice">{notices[value.notice]}</span>}
    <small>配置变更用于后续启动，当前会话保持原有连接。</small>
  </div>;
}
