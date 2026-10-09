import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { savedRead, savedWrite } from "./cache";
import { haptic } from "./haptics";
import { api, baselineNotices, claimNotices, notify } from "./transport";
import { freshNotices, noticeDecision, noticeLabel, rememberIds, type InboxItem, type NoticePrefs } from "./notice-feed";
import type { useRemote } from "./use-remote";
type Client = ReturnType<typeof useRemote>;

/** One event source and one atomic native ledger shared with SSE monitoring and FCM. */
export function useNoticeFeed(client: Client, prefs: NoticePrefs, ready: boolean, systemPrefs?: NoticePrefs) {
    const latest = useRef({ client, prefs, ready, systemPrefs }); latest.current = { client, prefs, ready, systemPrefs };
    const host = client.host;
    const signature = client.sessions.map(s => s.id + ":" + s.status).join("|");
    const trigger = useRef<() => void>(() => undefined);
    useEffect(() => {
        if (!host || !ready || client.connection.phase !== "online") return;
        let alive = true, reading = false;
        const seen = new Set<string>();
        let baselined = false;
        const load = Platform.OS === "android" ? Promise.resolve() : savedRead<string[]>(host.fingerprint + ":notices-seen").then(ids => {
            if (ids) { rememberIds(seen, ids); baselined = true; }
        }).catch(() => undefined);
        const current = () => alive && latest.current.ready && AppState.currentState === "active"
            && latest.current.client.host?.fingerprint === host.fingerprint && latest.current.client.host?.host === host.host;
        const read = async () => {
            if (reading || !current()) return;
            reading = true;
            try {
                await load;
                const result = await api<{ items: InboxItem[] }>(host, "/v1/workbench?kind=notifications");
                if (!current()) return;
                const items = result.items || [], ids = items.map(item => item.id).filter(Boolean);
                let fresh: InboxItem[];
                if (Platform.OS === "android") {
                    const initial = await baselineNotices(host.fingerprint, ids);
                    if (!current()) return;
                    const claimed = initial ? [] : await claimNotices(host.fingerprint, ids);
                    fresh = items.filter(item => claimed.includes(item.id));
                } else {
                    fresh = freshNotices(items, seen, baselined).fresh;
                    baselined = true; rememberIds(seen, ids);
                    await savedWrite(host.fingerprint + ":notices-seen", [...seen]);
                }
                if (!current()) return;
                const c = latest.current.client;
                if (Platform.OS === "android") for (const item of fresh) {
                    if (noticeDecision(item, latest.current.prefs, { currentSessionId: c.sessionId, appActive: true, systemPrefs: latest.current.systemPrefs }).system) {
                        const title = item.kind === "failure" ? "任务执行失败" : item.kind === "confirmation" ? "任务需要回应" : "任务已完成";
                        await notify(host, title, "打开应用查看对应任务。", item.sessionId || "").catch(() => undefined);
                    }
                }
                const shown = fresh.filter(item => noticeDecision(item, latest.current.prefs, { currentSessionId: c.sessionId, appActive: true }).inApp)
                    .sort((a, b) => (Date.parse(a.createdAt || "") || 0) - (Date.parse(b.createdAt || "") || 0));
                const last = shown.at(-1);
                if (last) {
                    const session = c.sessions.find(row => row.id === last.sessionId);
                    const label = noticeLabel(session ? { ...last, title: session.title } : last);
                    haptic(last.kind === "failure" ? "error" : "success");
                    c.setNotice(shown.length > 1 ? `${label}（另有 ${shown.length - 1} 条）` : label, last.sessionId);
                }
            } catch { /* Normal polling retries; connection errors have their own banner. */ }
            finally { reading = false; }
        };
        trigger.current = () => { void read(); };
        void read();
        const timer = setInterval(() => void read(), 10_000);
        const sub = AppState.addEventListener("change", state => { if (state === "active") void read(); });
        return () => { alive = false; trigger.current = () => undefined; clearInterval(timer); sub.remove(); };
    }, [host?.fingerprint, host?.host, ready, client.connection.phase]);
    // Status changes only prompt an early inbox read. They never create a second notification.
    useEffect(() => { const timer = setTimeout(() => trigger.current(), 1500); return () => clearTimeout(timer); }, [signature]);
}
