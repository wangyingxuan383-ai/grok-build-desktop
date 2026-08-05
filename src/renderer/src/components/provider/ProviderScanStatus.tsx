import type { ProviderProtocol, ProviderScanJob } from "../../../../shared/types";

export function ProviderScanStatus({ providerName, job, reasoning, tools, media, onReasoning, onTools, onMedia }: {
  providerName: string;
  job?: ProviderScanJob;
  reasoning: boolean;
  tools: boolean;
  media: boolean;
  onReasoning(value: boolean): void;
  onTools(value: boolean): void;
  onMedia(value: boolean): void;
}): React.JSX.Element {
  return <>
    <div className="provider-scan-options">
      <div className="provider-scan-feature-row">
        <label className="check"><input type="checkbox" checked={reasoning} onChange={(event) => onReasoning(event.target.checked)}/>思考档位</label>
        <label className="check"><input type="checkbox" checked={tools} onChange={(event) => onTools(event.target.checked)}/>工具与续写</label>
        <label className="check"><input type="checkbox" checked={media} onChange={(event) => onMedia(event.target.checked)}/>媒体能力</label>
      </div>
      <span>批量扫描范围始终是当前 Provider“{providerName}”，不会扫描其他 Provider。上下文窗口使用模型元数据或手工值，不发送费用不确定的自动极限探测。</span>
    </div>
    {job && <div className={`provider-scan-banner ${job.status}`} role="status" aria-live="polite"><span className={job.status === "running" || job.status === "cancelling" ? "provider-scan-spinner" : ""}/><div><strong>{scanStatusLabel(job.status)}</strong><span>{job.message}</span><small>{job.completed}/{job.total} 子步骤 · 成功 {job.succeeded} · 失败 {job.failed}{job.modelId ? ` · ${job.modelId}` : ""}{job.protocol ? ` · ${protocolLabel(job.protocol)}` : ""}{job.effort ? ` · ${job.effort}` : ""}</small><progress value={job.completed} max={Math.max(1, job.total)}/></div></div>}
  </>;
}

function protocolLabel(protocol: ProviderProtocol): string {
  return ({ chat_completions: "Chat Completions", responses: "Responses", messages: "Anthropic Messages" })[protocol];
}

function scanStatusLabel(status: ProviderScanJob["status"]): string {
  return ({ queued: "等待扫描", running: "正在扫描", cancelling: "正在取消", completed: "扫描完成", cancelled: "扫描已取消", failed: "扫描失败" })[status];
}
