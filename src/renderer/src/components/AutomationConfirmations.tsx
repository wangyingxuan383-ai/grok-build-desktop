import { useEffect, useState } from "react";
import type { NotificationInboxItem } from "../../../shared/types";

/** The conversation and task center resolve the same persistent request IDs. */
export function AutomationConfirmations({ sessionId, onError }: { sessionId: string; onError(message: string): void }): React.JSX.Element | null {
  const [items, setItems] = useState<NotificationInboxItem[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false;
    const refresh = () => void window.grokDesktop.listInbox().then(rows => {
      if (!disposed) setItems(rows.filter(row => row.kind === "confirmation" && row.sessionId === sessionId));
    }).catch(() => undefined);
    setItems([]); refresh();
    const remove = window.grokDesktop.onAutomationEvent(refresh);
    const timer = window.setInterval(refresh, 15_000);
    return () => { disposed = true; remove(); window.clearInterval(timer); };
  }, [sessionId]);
  if (!items.length) return null;
  const respond = async (id: string, approved: boolean) => {
    setBusy(true);
    try { await window.grokDesktop.respondAutomationPending(id, approved); setItems(rows => rows.filter(row => row.id !== id)); }
    catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <section aria-label="定时任务确认">{items.map(item => <div className="tab-note" key={item.id}>
    <strong>{item.title}</strong><p>{item.detail}</p>
    <div className="button-row"><button disabled={busy} onClick={() => void respond(item.id, false)}>拒绝</button><button disabled={busy} onClick={() => void respond(item.id, true)}>允许本次</button></div>
  </div>)}</section>;
}
