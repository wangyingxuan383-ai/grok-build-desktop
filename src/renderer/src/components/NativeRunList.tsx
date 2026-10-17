import { useEffect, useMemo, useState } from "react";
import {
  activeNativeRuns, nativeRunActionLabels, nativeRunBudgetRatio, nativeRunBudgetText, nativeRunDismissible, nativeRunDuplicateKeys, nativeRunKey,
  nativeRunKindLabels, nativeRunMatchesFilter, nativeRunPhaseLabel, nativeRunShortId, nativeRunStatusText, nativeRunStopDescription, nativeRunTone,
  nativeRunUpdatedLabel, type NativeRunAction, type NativeRunFilter, type NativeRunSnapshot,
} from "../../../shared/native-runs";
import { errorMessage } from "../error-message";
import { useAppStore } from "../store";
import { UiIcon } from "../ui-icons";

type Confirm = (message: string, options?: { title?: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
type Notice = { text: string; tone: "ok" | "warn" | "danger" };
const busyLabels: Record<NativeRunAction, string> = { pause: "正在暂停…", resume: "正在恢复…", stop: "正在结束…" };
const filterLabels: Record<NativeRunFilter, string> = { progress: "进行中", attention: "需处理", all: "全部" };

/**
 * Goals and workflows started with /goal and /workflow. `center` groups every session for the task
 * center; `pane` lists only the current session inside the right pane. Hidden when there is nothing.
 */
export function NativeRunList({ rows, variant, onRefresh, onOpen, confirm }: {
  rows: NativeRunSnapshot[]; variant: "center" | "pane"; onRefresh(): Promise<void>;
  onOpen?(sessionId: string, previewOnly: boolean): void; confirm: Confirm;
}): React.JSX.Element | null {
  const sessions = useAppStore((state) => state.sessions);
  const [busy, setBusy] = useState<{ key: string; action: NativeRunAction | "dismiss" }>();
  const [notices, setNotices] = useState<Record<string, Notice>>({});
  const visible = useMemo(() => activeNativeRuns(rows), [rows]);
  const duplicates = useMemo(() => nativeRunDuplicateKeys(visible), [visible]);
  const counts = useMemo(() => ({ progress: visible.filter((row) => nativeRunMatchesFilter(row, "progress")).length, attention: visible.filter((row) => nativeRunMatchesFilter(row, "attention")).length, all: visible.length }), [visible]);
  const [filter, setFilter] = useState<NativeRunFilter>();
  const activeFilter = filter ?? (counts.progress ? "progress" : "all");
  useEffect(() => {
    if (!Object.keys(notices).length) return;
    const timer = setTimeout(() => setNotices({}), 8000);
    return () => clearTimeout(timer);
  }, [notices]);
  if (!visible.length) return null;
  const title = (id: string): string => sessions.find((session) => session.id === id)?.title || `会话 ${id.slice(0, 8)}`;
  const note = (key: string, value: Notice): void => setNotices((current) => ({ ...current, [key]: value }));
  const control = async (row: NativeRunSnapshot, action: NativeRunAction): Promise<void> => {
    if (busy || row.stale) return;
    const key = nativeRunKey(row);
    if (action === "stop" && !await confirm(nativeRunStopDescription(row.kind), { title: `结束${nativeRunKindLabels[row.kind]}`, confirmLabel: "结束", danger: true })) return;
    setBusy({ key, action });
    try {
      const receipt = await window.grokDesktop.controlNativeRun({ sessionId: row.sessionId, kind: row.kind, runId: row.id, revision: row.revision, action, operationId: crypto.randomUUID() });
      note(key, receipt.state === "completed" ? { text: receipt.message, tone: "ok" } : receipt.state === "unknown" ? { text: "未收到 CLI 确认，结果待确认；收到新状态后会自动更新。", tone: "warn" } : { text: receipt.message, tone: "danger" });
    } catch (error) { note(key, { text: errorMessage(error), tone: "danger" }); }
    finally { setBusy(undefined); await onRefresh(); }
  };
  const dismiss = async (row: NativeRunSnapshot): Promise<void> => {
    if (busy) return;
    const key = nativeRunKey(row);
    setBusy({ key, action: "dismiss" });
    try { await window.grokDesktop.dismissNativeRun({ sessionId: row.sessionId, kind: row.kind, runId: row.id }); }
    catch (error) { note(key, { text: errorMessage(error), tone: "danger" }); }
    finally { setBusy(undefined); await onRefresh(); }
  };
  const body = (row: NativeRunSnapshot): React.JSX.Element => {
    const key = nativeRunKey(row), tone = nativeRunTone(row), ratio = nativeRunBudgetRatio(row.budget), notice = notices[key];
    const rowBusy = busy?.key === key;
    return <div className="native-run-body">
      <div className="native-run-meta">{nativeRunKindLabels[row.kind]}{row.phase ? ` · ${nativeRunPhaseLabel(row.phase)}阶段` : ""}{variant === "pane" ? ` · ${nativeRunUpdatedLabel(row.observedAt)}` : ""}{variant === "pane" && duplicates.has(key) ? <code>{nativeRunShortId(row.id)}</code> : null}</div>
      {row.budget && <div className="native-run-budget"><span>{nativeRunBudgetText(row.budget)}</span>{ratio !== undefined && <span className={`native-run-meter${ratio >= 1 ? " full" : ratio >= 0.9 ? " warn" : ""}`}><i style={{ width: `${Math.max(2, ratio * 100)}%` }} /></span>}</div>}
      {row.reason && <p className={`native-run-reason tone-${tone}`}>{row.reason}</p>}
      {!row.actions.length && row.unavailableReason && <p className="native-run-hint">{row.unavailableReason}</p>}
      {notice && <p className={`native-run-notice ${notice.tone}`} role="status">{notice.text}</p>}
      {(row.actions.length > 0 || (variant === "center" && onOpen) || nativeRunDismissible(row)) && <div className="native-run-actions">
        {row.actions.map((action) => <button key={action} className={action === "stop" ? "danger" : undefined} disabled={Boolean(busy)} onClick={() => void control(row, action)}>{rowBusy && busy?.action === action ? <><span className="native-run-spin" />{busyLabels[action]}</> : nativeRunActionLabels[action]}</button>)}
        {variant === "center" && onOpen && <button className="ghost" onClick={() => onOpen(row.sessionId, row.stale)}>查看会话</button>}
        {nativeRunDismissible(row) && <button className="ghost" disabled={Boolean(busy)} title="只移除这条本地记录，不影响会话和已有产出" onClick={() => void dismiss(row)}>{rowBusy && busy?.action === "dismiss" ? "正在移除…" : "移除记录"}</button>}
      </div>}
    </div>;
  };
  const status = (row: NativeRunSnapshot): React.JSX.Element => <span className={`native-run-status tone-${nativeRunTone(row)}`}><i />{nativeRunStatusText(row)}</span>;

  if (variant === "pane") return <section className="native-run-section" aria-label="目标与工作流">
    <header><strong>目标与工作流</strong><span>{visible.length}</span></header>
    {visible.map((row) => <div className="native-run-row pane" key={nativeRunKey(row)}>
      <div className="native-run-top">{status(row)}<span className="native-run-title" title={row.title}>{row.title}</span></div>
      {body(row)}
    </div>)}
  </section>;

  const shown = visible.filter((row) => nativeRunMatchesFilter(row, activeFilter));
  const groups = [...shown.reduce((map, row) => map.set(row.sessionId, [...(map.get(row.sessionId) ?? []), row]), new Map<string, NativeRunSnapshot[]>())];
  return <section className="native-runs" aria-label="目标与工作流">
    <header className="native-runs-head">
      <div><h3>目标与工作流</h3><p>由 /goal 与 /workflow 启动；状态以 CLI 回执为准</p></div>
      <div className="native-run-filters" role="tablist" aria-label="筛选目标与工作流">{(["progress", "attention", "all"] as const).map((id) => <button key={id} role="tab" aria-selected={activeFilter === id} onClick={() => setFilter(id)}>{filterLabels[id]} {counts[id]}</button>)}</div>
    </header>
    {groups.map(([sessionId, items]) => <div className="native-run-group" key={sessionId}>
      <div className="native-run-group-head"><strong>{title(sessionId)}</strong><span>· {items.length} 项</span>{onOpen && <button onClick={() => onOpen(sessionId, items.every((row) => row.stale))}>打开会话 ›</button>}</div>
      <div className="native-run-card">{items.map((row) => {
        const key = nativeRunKey(row);
        return <details className="native-run-row" key={key}>
          <summary><UiIcon name="chevron-right" size={14} className="native-run-chevron" />{status(row)}<span className="native-run-title" title={row.title}>{row.title}</span><span className="native-run-time">{duplicates.has(key) && <code>{nativeRunShortId(row.id)}</code>}{nativeRunUpdatedLabel(row.observedAt)}</span></summary>
          {body(row)}
        </details>;
      })}</div>
    </div>)}
    {!shown.length && <p className="empty-copy">这个筛选下没有项目。</p>}
  </section>;
}
