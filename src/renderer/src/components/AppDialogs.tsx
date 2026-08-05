import { useEffect, useRef, useState } from "react";
import type { ComputerAppPermissionRequest, ComputerRiskConfirmation } from "../../../shared/types";

export interface DialogState {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  input?: { value: string; placeholder?: string };
  resolve(value: string | boolean | null): void;
}

export function ComputerPermissionDialog({ request, onRespond }: { request: ComputerAppPermissionRequest; onRespond(decision: "once" | "always" | "deny"): void }): React.JSX.Element {
  return <div className="modal-backdrop computer-approval-backdrop"><section className="action-dialog computer-approval" role="dialog" aria-modal="true"><h2>允许 Grok 控制此应用？</h2><div className="computer-app-summary"><strong>{request.app.name}</strong><span>{request.window?.title}</span><small>{request.window ? `${request.window.bounds.width}×${request.window.bounds.height} · ${request.window.dpi} DPI` : ""}</small></div><p>授权只适用于这个应用。高影响操作仍会在执行前单独确认；按 <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Esc</kbd> 可随时紧急停止。</p><div className="button-row three"><button className="danger" onClick={() => onRespond("deny")}>拒绝</button><button onClick={() => onRespond("once")}>仅本次允许</button><button className="primary" onClick={() => onRespond("always")}>始终允许</button></div></section></div>;
}

export function ComputerRiskDialog({ request, onRespond }: { request: ComputerRiskConfirmation; onRespond(approved: boolean): void }): React.JSX.Element {
  const labels: Record<ComputerRiskConfirmation["category"], string> = { delete: "删除数据", "external-communication": "外部发送或提交", financial: "金融或订阅", install: "安装或执行", "account-access": "账号权限或密钥", "security-settings": "安全/隐私设置", "sensitive-transfer": "敏感数据传输" };
  return <div className="modal-backdrop computer-approval-backdrop"><section className="action-dialog computer-approval risk" role="alertdialog" aria-modal="true"><h2>高影响操作确认</h2><span className="risk-label">{labels[request.category]}</span><p><strong>{request.appName}</strong> 将执行：{request.summary}</p><p>此确认只允许当前这一个动作，不会改变应用授权。</p><div className="button-row"><button onClick={() => onRespond(false)}>取消并停止</button><button className="danger" onClick={() => onRespond(true)}>确认执行一次</button></div></section></div>;
}

export function ActionDialog({ dialog, onClose }: { dialog: DialogState; onClose(value: string | boolean | null): void }): React.JSX.Element {
  const [value, setValue] = useState(dialog.input?.value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { (dialog.input ? inputRef.current : confirmRef.current)?.focus(); }, []);
  const confirm = (): void => onClose(dialog.input ? value : true);
  return <div className="modal-backdrop action-dialog-backdrop" role="presentation" onMouseDown={() => onClose(dialog.input ? null : false)}><section className="action-dialog" role="dialog" aria-modal="true" aria-labelledby="action-dialog-title" onMouseDown={(event) => event.stopPropagation()}><h2 id="action-dialog-title">{dialog.title}</h2><p>{dialog.message}</p>{dialog.input && <input ref={inputRef} value={value} placeholder={dialog.input.placeholder} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && value.trim()) confirm(); }} />}<div className="button-row"><button onClick={() => onClose(dialog.input ? null : false)}>取消</button><button ref={confirmRef} className={dialog.danger ? "danger" : "primary"} disabled={!!dialog.input && !value.trim()} onClick={confirm}>{dialog.confirmLabel || "确定"}</button></div></section></div>;
}
