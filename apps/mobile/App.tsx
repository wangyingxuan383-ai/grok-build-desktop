import { setPrefetchWifiOnly } from "./src/media-cache";
import { MOBILE_VERSION } from "./src/version";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, BackHandler, Keyboard, Platform, StyleSheet, View, useColorScheme } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { Linking } from "react-native";
import { AssetViewer, type RemoteAsset } from "./src/workbench";
import { TaskWorkspace } from "./src/task-workspace";
import { ImageWorkspaceScreen } from "./src/image-workspace";
import { notify, setMonitoring, noticePolicy, setMonitorMode, setQuietHours, watchReceipt, cancelReceiptWatch, watchMobileUpdate, foregroundComputer } from "./src/transport";
import { LockScreen, useAppLock } from "./src/app-lock";
import { ToastHost, showToast } from "./src/toast";
import { InlinePending } from "./src/inline-pending";
import { toggleBookmark } from "./src/library-model";
import type { Bookmark } from "./src/library";
import { ReadingScale, readingScales } from "./src/markdown";
import { haptic, setHapticsEnabled } from "./src/haptics";
import { ActionMenu } from "./src/gestures";
import { useNoticeFeed } from "./src/use-notice-feed";
import { sharedItems, type IncomingShare } from "./src/transport";
import { ShareInbox } from "./src/share-inbox";
import { savedRead, savedWrite } from "./src/cache";
import type { HostConnection } from "./src/transport";
import { messagesFromEvents, mergeEventWindows, conversationRows, sessionStatusLabel } from "./src/remote-model";
import { rememberSession, restoreFailedDraft, mobileVersionIsNewer } from "./src/experience-model";
import { backAction, nextStack, type Tab } from "./src/app-model";
import { backStack } from "./src/back-layers";
import { applyToggles } from "./src/gallery-model";
import { useRemote } from "./src/use-remote";
import { Button, palettes } from "./src/ui";
import { SessionList, defaultPrefs, type SessionListActions } from "./src/screens";
import { Conversation, Composer, ConversationFrame, useReadingDensity, type ConversationApi, type NavigatorSource } from "./src/conversation";
import { Pairing, confirm } from "./src/forms";
import { AppHeader, StatusBanners, TabBar, tabTitles, type HeaderAction } from "./src/app-chrome";
import { SheetHost, type Sheet } from "./src/session-sheets";
import { DeviceScreen } from "./src/device-screen";
const STORAGE = "grok.remote.host.v1", PREFS = "grok.remote.preferences.v2";
export default function App() {
    return (<GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <RemoteApp />
      </SafeAreaProvider>
    </GestureHandlerRootView>);
}
function RemoteApp() {
    const [host, setHost] = useState<HostConnection>(), [ready, setReady] = useState(false), [preferences, setPreferences] = useState(defaultPrefs);
    const [computers, setComputers] = useState<HostConnection[]>([]), [pairing, setPairing] = useState(false), [asset, setAsset] = useState<RemoteAsset>();
    const [activityFocus, setActivityFocus] = useState("active");
    const [imageFocus, setImageFocus] = useState<string>();
    const [dismissedSend, setDismissedSend] = useState("");
    const [incoming, setIncoming] = useState<IncomingShare>(), [showShare, setShowShare] = useState(true);
    const preferenceOwner = useRef(""), [scopedReady, setScopedReady] = useState(false);
    const scopedOps = useRef<Array<{ list: "favorites" | "muted"; source: string; add: boolean }>>([]);
    const [tab, setTab] = useState<Tab>("sessions"), [sheet, setSheet] = useState<Sheet>(null), [historyStack, setHistoryStack] = useState<string[]>([]);
    const [overlay, setOverlay] = useState<string>();
    const [computerMenu, setComputerMenu] = useState(false);
    const [density, setDensity] = useReadingDensity();
    const system = useColorScheme(), theme = palettes[preferences.theme === "system" ? (system === "light" ? "light" : "dark") : preferences.theme];
    const navigationRevision = useRef(0), createIntent = useRef<{ id: string; revision: number; source?: string; } | undefined>(undefined);
    const creationOrigin = navigationRevision.current;
    const viewIdentity = useRef({ fingerprint: host?.fingerprint, sessionId: "" });
    const appLock = useAppLock(preferences.lock, ready);
    const client = useRemote(host, async (next) => { await SecureStore.setItemAsync(STORAGE, JSON.stringify(next)); const known = [next, ...computers.filter(c => c.fingerprint !== next.fingerprint)]; await SecureStore.setItemAsync("grok.remote.computers.v1", JSON.stringify(known)); setComputers(known); setHost(next); }, ready && !appLock.locked && !pairing && !sheet && !asset && !overlay && !(incoming && showShare));
    viewIdentity.current = { fingerprint: host?.fingerprint, sessionId: client.sessionId };
    // The latest client for stable callbacks: lets the message list skip re-rendering while the draft changes.
    const latestClient = useRef(client); latestClient.current = client;
    const latestHints = useRef(preferences.hints); latestHints.current = preferences.hints;
    const latestRecent = useRef(preferences.recent); latestRecent.current = preferences.recent;
    const conversationApi = useMemo<ConversationApi>(() => ({
        refresh: () => latestClient.current.refresh(),
        loadEarlier: () => latestClient.current.loadEarlier(),
        loadAround: (index) => latestClient.current.loadAround(index),
        setNotice: (text) => latestClient.current.setNotice(text),
        setError: (text) => latestClient.current.setError(text),
        setDraft: (text) => latestClient.current.setDraft(text),
        getDraft: () => latestClient.current.draft,
        bookmark: (message) => {
            const c = latestClient.current, fp = c.host?.fingerprint, session = c.sessions.find(row => row.id === c.sessionId);
            if (!fp || message.remoteIndex === undefined) { showToast("这条消息还没有同步位置，稍后再试"); return; }
            const key = fp + ":bookmarks";
            void savedRead<Bookmark[]>(key).then(list => {
                const result = toggleBookmark(list || [], { sessionId: c.sessionId, sessionTitle: session?.title || "会话", messageId: message.id, remoteIndex: message.remoteIndex!, excerpt: message.text.replace(/\s+/g, " ").slice(0, 200) });
                void savedWrite(key, result.list);
                haptic(result.added ? "success" : "tap");
                showToast(result.added ? "已加入书签" : "已移除书签", { label: "撤销", onPress: () => void savedWrite(key, list || []) });
            });
        },
        // One-time teaching hints: shown once, never again after the gesture itself was used.
        hint: (id, text) => { const seen = latestHints.current; if (seen.includes(id) || seen.includes(id + "-done")) return; setPreferences(p => ({ ...p, hints: [...p.hints, id] })); if (text) showToast(text); },
    }), []);
    const navigatorSource = useMemo<NavigatorSource>(() => ({ host: client.host, query: client.query, sessionId: client.sessionId }), [client.host, client.query, client.sessionId]);
    useEffect(() => { let disposed = false; const read = async () => { if (Platform.OS !== "android") return; try {
        const shared = await sharedItems();
        if (shared.text || shared.files.length) {
            await savedWrite("incoming-share", shared);
            if (!disposed) { setIncoming(shared); setShowShare(true); }
        }
    } catch (error) { if (!disposed) client.setError(String(error)); } }; void savedRead<IncomingShare>("incoming-share").then(value => { if (!disposed && value && (value.text || value.files.length)) setIncoming(value); }); void read(); const sub = AppState.addEventListener("change", state => { if (state === "active") void read(); }); return () => { disposed = true; sub.remove(); }; }, []);
    const selected = client.snapshot?.session || client.sessions.find((s) => s.id === client.sessionId);
    const rows = useMemo(() => conversationRows(messagesFromEvents(mergeEventWindows(client.older, (client.snapshot?.events ?? []) as Parameters<typeof messagesFromEvents>[0]))), [client.older, client.snapshot?.events]);
    const queue = useMemo(() => {
        const last = [...(client.snapshot?.events ?? [])].reverse().find((e) => e.type === "prompt-queue");
        return last?.type === "prompt-queue" ? last.entries.filter((e) => !["completed", "failed", "cancelled"].includes(e.state)) : [];
    }, [client.snapshot?.events]);
    const children = useMemo(() => client.sessions.filter((s) => s.parentSessionId === client.sessionId), [client.sessions, client.sessionId]);
    const attention = useMemo(() => client.sessions.filter(s => s.status === "needs-user" && !s.archived).length, [client.sessions]);
    useEffect(() => {
        let disposed = false;
        void Promise.all([SecureStore.getItemAsync(STORAGE), AsyncStorage.getItem(PREFS), SecureStore.getItemAsync("grok.remote.computers.v1")])
            .then(([saved, prefs, known]) => {
                if (disposed) return;
                if (saved) setHost(JSON.parse(saved));
                if (prefs) { const stored = JSON.parse(prefs); setPreferences({ ...defaultPrefs, ...stored, lock: { ...defaultPrefs.lock, ...stored.lock }, quiet: { ...defaultPrefs.quiet, ...stored.quiet }, inApp: { ...defaultPrefs.inApp, ...stored.inApp } }); }
                if (known) setComputers(JSON.parse(known));
                else if (saved) setComputers([JSON.parse(saved)]);
                setReady(true);
            })
            .catch(() => { if (!disposed) setReady(true); });
        return () => { disposed = true; };
    }, []);
    useEffect(() => { if (ready) void AsyncStorage.setItem(PREFS, JSON.stringify(preferences)); }, [preferences, ready]);
    useEffect(() => { if (!host || !ready) return; let disposed = false; const previous = preferenceOwner.current; const ruleBaseline = previous && previous !== host.fingerprint ? defaultPrefs : preferences; preferenceOwner.current = host.fingerprint; setScopedReady(false); if (previous !== host.fingerprint) scopedOps.current = []; if (previous && previous !== host.fingerprint) setPreferences(p => ({ ...p, favorites: [], recent: [], mutedSessions: [], completion:defaultPrefs.completion, failure:defaultPrefs.failure, attention:defaultPrefs.attention, inApp:defaultPrefs.inApp })); void AsyncStorage.getItem(PREFS + "." + host.fingerprint).then(raw => { if (disposed) return; if (raw) {
        const values = JSON.parse(raw);
        // Changes made while this restore was in flight are replayed on top, never overwritten (R05).
        const ops = scopedOps.current; scopedOps.current = [];
        setPreferences(p => ({ ...p, ...Object.fromEntries((["completion","failure","attention","inApp"] as const).filter(key => JSON.stringify(p[key]) === JSON.stringify(ruleBaseline[key]) && values[key] !== undefined).map(key => [key,values[key]])), favorites: applyToggles(values.favorites || [], ops.filter(o => o.list === "favorites")).slice(0, 500), recent: [...new Set([...(p.recent || []), ...(values.recent || [])])].slice(0, 30), mutedSessions: applyToggles(values.mutedSessions || [], ops.filter(o => o.list === "muted")) }));
    } setScopedReady(true); }).catch(() => { if (!disposed) client.setError("电脑对应的阅读偏好恢复失败"); }); return () => { disposed = true; }; }, [host?.fingerprint, ready]);
    useEffect(() => { if (scopedReady && host && preferenceOwner.current === host.fingerprint) void AsyncStorage.setItem(PREFS + "." + host.fingerprint, JSON.stringify({ favorites: preferences.favorites, recent: preferences.recent, mutedSessions: preferences.mutedSessions, completion:preferences.completion, failure:preferences.failure, attention:preferences.attention, inApp:preferences.inApp })); }, [preferences.favorites, preferences.recent, preferences.mutedSessions, preferences.completion, preferences.failure, preferences.attention, preferences.inApp, scopedReady, host?.fingerprint]);
    // Reminders come only from the computer's notification record (stable ids, real outcomes),
    // never from a working → idle flip, which also happens when model or effort changes.
    useEffect(() => { if (Platform.OS === "android") void foregroundComputer(host?.fingerprint || "").catch(() => undefined); }, [host?.fingerprint]);
    useNoticeFeed(client, { completion: preferences.inApp.completion, failure: preferences.inApp.failure, attention: preferences.inApp.attention, muted: preferences.mutedSessions }, scopedReady && !appLock.locked, { completion: preferences.completion, failure: preferences.failure, attention: preferences.attention, muted: preferences.mutedSessions });
    // Background-send watchdog: a message still unconfirmed 30 s after leaving the app gets a
    // local reminder to check it. Nothing is resent automatically (unknown results never are).
    useEffect(() => {
        if (Platform.OS !== "android") return;
        const updates = watchMobileUpdate(() => undefined);
        const sub = AppState.addEventListener("change", state => {
            if (state === "active") { void cancelReceiptWatch().catch(() => undefined); return; }
            const c = latestClient.current, submitted = c.submitted;
            if (state === "background" && c.host && submitted?.command.action === "send" && (c.busy || c.unknown))
                void watchReceipt(c.host, submitted.command.operationId, submitted.command.sessionId).catch(() => undefined);
        });
        return () => { sub.remove(); updates.remove(); };
    }, []);
    useEffect(() => { setHapticsEnabled(preferences.haptics); }, [preferences.haptics]);
    useEffect(() => { setPrefetchWifiOnly(preferences.prefetchWifiOnly); }, [preferences.prefetchWifiOnly]);
    useEffect(() => { if (ready && Platform.OS === "android") void setMonitorMode(preferences.monitorMode).catch(() => undefined); }, [ready, preferences.monitorMode]);
    useEffect(() => { if (ready && Platform.OS === "android") void setQuietHours(preferences.quiet.enabled, preferences.quiet.start, preferences.quiet.end, preferences.quiet.allowAttention).catch(() => undefined); }, [ready, preferences.quiet.enabled, preferences.quiet.start, preferences.quiet.end, preferences.quiet.allowAttention]);
    useEffect(() => { if (host && scopedReady && Platform.OS === "android") void noticePolicy(host.fingerprint, preferences.completion, preferences.failure, preferences.attention, preferences.mutedSessions).catch(() => undefined); }, [host?.fingerprint, scopedReady, preferences.completion, preferences.failure, preferences.attention, preferences.mutedSessions]);
    useEffect(() => { if (!client.notice) return; const timer = setTimeout(() => client.setNotice(""), 5500); return () => clearTimeout(timer); }, [client.notice]);
    useEffect(() => { setOverlay(undefined); }, [client.sessionId]);
    const goBack = useCallback(() => {
        navigationRevision.current++;
        if (asset) { setAsset(undefined); return true; }
        if (incoming && showShare) { setShowShare(false); return true; }
        if (pairing && host) { setPairing(false); return true; }
        // Pages inside a tab (image editor, task editor, selection mode) close before the shell moves.
        if (!sheet && !overlay && backStack.handle()) return true;
        const action = backAction({ tab, sheet, sessionId: client.sessionId, stack: historyStack, overlay });
        switch (action.kind) {
            case "close-overlay": setOverlay(undefined); return true;
            case "close-sheet": setSheet(null); return true;
            case "open-parent": setHistoryStack((stack) => stack.slice(0, -1)); client.selectSession(action.sessionId); return true;
            case "close-session": client.selectSession(""); return true;
            case "home-tab": setTab("sessions"); return true;
            case "exit": return false;
        }
    }, [sheet, overlay, client.sessionId, historyStack, tab, client.selectSession, asset, incoming, showShare, pairing, host]);
    useEffect(() => {
        navigationRevision.current++;
        createIntent.current = undefined;
        setHistoryStack([]); setSheet(null); setOverlay(undefined);
        setImageFocus(undefined); setAsset(undefined);
    }, [host?.fingerprint]);
    useEffect(() => { if (Platform.OS !== "android") return; const sub = BackHandler.addEventListener("hardwareBackPress", goBack); return () => sub.remove(); }, [goBack]);
    const openSession = useCallback((id: string, child = false) => {
        navigationRevision.current++;
        if (id.startsWith("image-")) { client.selectSession(""); setImageFocus(id); setTab("gallery"); setSheet(null); return; }
        setPreferences((p) => ({ ...p, recent: rememberSession(p.recent || [], id) }));
        setHistoryStack((stack) => nextStack(stack, client.sessionId, child));
        client.selectSession(id);
        setTab("sessions");
        setSheet(null);
    }, [client.selectSession, client.sessionId]);
    const checkedMobile = useRef(new Set<string>()), [mobileUpdate, setMobileUpdate] = useState<string>();
    useEffect(() => { if (!host || !preferences.updates || client.connection.phase !== "online" || checkedMobile.current.has(host.fingerprint)) return; checkedMobile.current.add(host.fingerprint); void client.query<import("../../src/shared/types").AppReleaseStatus>("mobile-update").then(status => { if (host.fingerprint === viewIdentity.current.fingerprint && status.companion && mobileVersionIsNewer(status.companion.version, MOBILE_VERSION)) setMobileUpdate(status.companion.version); }).catch(() => undefined); }, [host?.fingerprint, preferences.updates, client.connection.phase]);
    const pendingOpen = useRef<{ fingerprint: string; sessionId: string; at: number } | undefined>(undefined);
    useEffect(() => {
        const target = pendingOpen.current;
        if (!target || target.fingerprint !== host?.fingerprint) return;
        if (target.sessionId.startsWith("image-") || client.sessions.some(s => s.id === target.sessionId)) { pendingOpen.current = undefined; openSession(target.sessionId); return; }
        if (client.sessions.length && Date.now() - target.at > 15000) { pendingOpen.current = undefined; setActivityFocus("inbox"); setTab("activity"); client.setNotice("通知对应的会话不在当前列表中，已打开待处理事项"); }
    }, [client.sessions, host?.fingerprint]);
    // Opening a bookmark: once its conversation has loaded, jump to the saved message.
    const pendingJump = useRef<{ sessionId: string; index: number } | undefined>(undefined);
    useEffect(() => {
        const target = pendingJump.current;
        if (!target || client.sessionId !== target.sessionId || !client.snapshot || client.snapshot.session.id !== target.sessionId) return;
        pendingJump.current = undefined;
        void client.loadAround(target.index).catch(() => client.setNotice("书签位置已变化，已打开会话"));
    }, [client.sessionId, client.snapshot?.session.id]);
    const initialNoticeHandled = useRef(false), deferredLink = useRef<string | null>(null);
    useEffect(() => {
        const navigate = (raw: string | null) => { if (!raw) return; if (appLock.locked) { deferredLink.current = raw; return; } try {
            const value = new URL(raw);
            if (value.protocol !== "grokremote:") return;
            // Launcher shortcuts only open screens; they never submit anything.
            if (value.hostname === "new") { client.selectSession(""); setTab("sessions"); openSheet("new"); return; }
            if (value.hostname === "inbox") { client.selectSession(""); setActivityFocus("inbox"); setTab("activity"); return; }
            if (value.hostname === "recent") { const last = (latestRecent.current || []).find(id => client.sessions.some(row => row.id === id && !row.archived)); if (last) openSession(last); else { client.selectSession(""); setTab("sessions"); } return; }
            if (value.hostname !== "conversation") return;
            const computer = computers.find(c => c.fingerprint === value.searchParams.get("computer"));
            if (!computer) { client.setError("通知所属电脑尚未配对，请先连接"); return; }
            const id = value.searchParams.get("session");
            if (computer.fingerprint !== host?.fingerprint) {
                if (client.busy || client.unknown || client.creationPending) { client.setNotice("通知来自另一电脑，请先核对当前提交后切换"); return; }
                // Open the notified conversation once the other computer's list has loaded (C03).
                void saveHost(computer).then(() => { if (id) pendingOpen.current = { fingerprint: computer.fingerprint, sessionId: id, at: Date.now() }; else { setActivityFocus("inbox"); setTab("activity"); } }).catch(e => latestClient.current.setError(String(e)));
                return;
            }
            if (id && (id.startsWith("image-") || client.sessions.some(s => s.id === id))) openSession(id);
            else { client.selectSession(""); setActivityFocus("inbox"); setTab("activity"); }
        } catch { } };
        const pushNotice = (response: Notifications.NotificationResponse | null) => { if (!response) return; const data = response.notification.request.content.data; if (typeof data.computer === "string") navigate("grokremote://conversation?computer=" + encodeURIComponent(data.computer) + "&session=" + encodeURIComponent(String(data.sessionId || ""))); };
        if (!initialNoticeHandled.current && host && client.recoveryReady && client.connection.phase === "online") {
            initialNoticeHandled.current = true;
            void Linking.getInitialURL().then(navigate);
            if (Platform.OS === "android") void Notifications.getLastNotificationResponseAsync().then(pushNotice);
        }
        if (!appLock.locked && deferredLink.current) { const raw = deferredLink.current; deferredLink.current = null; navigate(raw); }
        const subscription = Linking.addEventListener("url", event => navigate(event.url));
        const notices = Platform.OS === "android" ? Notifications.addNotificationResponseReceivedListener(pushNotice) : undefined;
        return () => { subscription.remove(); notices?.remove(); };
    }, [host?.id, computers, client.sessions, client.recoveryReady, client.connection.phase, client.busy, client.unknown, client.creationPending, appLock.locked]);
    const openSheet = useCallback((next: Sheet) => {
        Keyboard.dismiss();
        if (next === "new" || next === "config") void latestClient.current.loadOptions(next === "config").catch(() => undefined);
        setSheet(next);
    }, []);
    const hostChangeLock = useRef(false);
    const saveHost = async (next: HostConnection) => {
        const current = latestClient.current;
        if (hostChangeLock.current) throw Error("电脑连接正在切换，请稍候。");
        if (current.host && (!current.recoveryReady || current.busy || current.unknown || current.creationPending)) throw Error("先核对待确认的提交或等待当前请求结束，再修改电脑连接。");
        hostChangeLock.current = true;
        try {
        await current.preserveDrafts();
        if (host) await setMonitoring(host, false).catch(() => undefined);
        const known = [next, ...computers.filter(c => c.fingerprint !== next.fingerprint)].slice(0, 8);
        await SecureStore.setItemAsync("grok.remote.computers.v1", JSON.stringify(known));
        setComputers(known);
        await SecureStore.setItemAsync(STORAGE, JSON.stringify(next));
        setHost(next);
        setImageFocus(undefined);
        setAsset(undefined);
        setTab("sessions");
        setPairing(false);
        setSheet(null);
        setHistoryStack([]); setOverlay(undefined);
        } finally { hostChangeLock.current = false; }
    };
    const forget = () => {
        if (client.busy || client.unknown || client.creationPending) { client.setError("先核对待确认的提交或等待当前请求结束，再忘记电脑。"); return; }
        confirm("忘记这台电脑？", "手机草稿仍保留。电脑会话和任务不会删除；重新连接需要扫码配对。", () => {
            void client.preserveDrafts()
                .then(async () => { if (host) await setMonitoring(host, false).catch(() => undefined); const known = computers.filter(c => c.fingerprint !== host?.fingerprint); await SecureStore.setItemAsync("grok.remote.computers.v1", JSON.stringify(known)); setComputers(known); await SecureStore.deleteItemAsync(STORAGE); })
                .then(() => { setHost(undefined); setTab("sessions"); setHistoryStack([]); })
                .catch((e) => client.setError(String(e)));
        });
    };
    useEffect(() => {
        const receipt = client.receipt;
        if (!["create", "fork"].includes(receipt?.action || "") || receipt?.state !== "completed" || !receipt.resultSessionId) return;
        const intent = createIntent.current;
        if (!intent || intent.id !== receipt.operationId) return;
        createIntent.current = undefined;
        if (intent.revision === navigationRevision.current && tab === "sessions" && (!client.sessionId || client.sessionId === intent.source)) openSession(receipt.resultSessionId);
        else client.setNotice("新会话已创建，可从会话列表打开");
    }, [client.receipt?.resultSessionId, client.receipt?.state, sheet]);
    const online = client.connection.phase === "online";
    const openAsset = useCallback((source: string) => { const identity = viewIdentity.current.fingerprint, revision = navigationRevision.current; const current = () => identity === viewIdentity.current.fingerprint && revision === navigationRevision.current; void latestClient.current.query<RemoteAsset>("media", { source }).then(value => { if (current()) setAsset(value); }).catch(e => { if (current()) latestClient.current.setError(String(e)); }); }, []);
    const openFile = useCallback((path: string) => { const identity = { ...viewIdentity.current }, revision = navigationRevision.current; const current = () => identity.fingerprint === viewIdentity.current.fingerprint && identity.sessionId === viewIdentity.current.sessionId && revision === navigationRevision.current; void latestClient.current.query<RemoteAsset>("artifact", { sessionId: identity.sessionId, path }).then(value => { if (!current()) return; setAsset(value); setSheet(null); }).catch(e => { if (current()) latestClient.current.setError(String(e)); }); }, []);
    const openChild = useCallback((id: string) => {
        const current = latestClient.current;
        if (current.sessions.some((s) => s.id === id)) openSession(id, true);
        else {
            const origin = { ...viewIdentity.current }, revision = navigationRevision.current;
            const stillHere = () => origin.fingerprint === viewIdentity.current.fingerprint && origin.sessionId === viewIdentity.current.sessionId && revision === navigationRevision.current;
            void current.query("child", { sessionId: current.sessionId, childId: id }).then(async () => { if (!stillHere()) return; await latestClient.current.refresh(); if (stillHere()) openSession(id, true); }).catch(e => { if (stillHere()) latestClient.current.setError(String(e)); });
        }
    }, [openSession]);
    const closeNavigator = useCallback(() => setOverlay(undefined), []);
    const [topSignal, setTopSignal] = useState(0);
    const sessionActions: SessionListActions = {
        canSync: client.recoveryReady && !client.busy && !client.unknown && !client.creationPending && client.connection.phase === "online",
        capabilities: client.options?.capabilities ?? [],
        muted: preferences.mutedSessions,
        toggleFavorite: (id) => { const favorite = preferences.favorites.includes(id); if (!scopedReady) scopedOps.current.push({ list: "favorites", source: id, add: !favorite }); setPreferences((p) => ({ ...p, favorites: favorite ? p.favorites.filter((v) => v !== id) : [id, ...p.favorites.filter(v => v !== id)].slice(0, 500) })); return favorite; },
        toggleMuted: (id) => { const muted = preferences.mutedSessions.includes(id); if (!scopedReady) scopedOps.current.push({ list: "muted", source: id, add: !muted }); setPreferences((p) => ({ ...p, mutedSessions: muted ? p.mutedSessions.filter((v) => v !== id) : [...p.mutedSessions, id] })); },
        archive: (id, archived) => latestClient.current.perform("archive", { archived }, id),
        rename: (id, title) => latestClient.current.perform("rename", { title }, id),
        remove: (id, title) => confirm(`删除「${title}」？`, "使用电脑原删除流程，保留项目磁盘文件。删除后无法从手机恢复。", () => void latestClient.current.perform("delete", {}, id)),
        notice: (text) => latestClient.current.setNotice(text),
    };
    const phaseText = {
        connecting: "正在连接",
        online: client.connection.mode === "polling" ? "已连接 · 定期同步" : "已连接",
        reconnecting: "正在恢复连接",
        offline: "离线 · 草稿保留",
        blocked: "连接需处理",
        paused: "后台暂停同步",
    }[client.connection.phase];
    if (!ready)
        return (<SafeAreaView style={[styles.root, { backgroundColor: theme.bg, justifyContent: "center" }]}><ActivityIndicator color={theme.accent} /></SafeAreaView>);
    if (!host || pairing)
        return <View style={{ flex: 1, backgroundColor: theme.bg }}>{host ? <Button compact ghost title="‹ 返回已配对电脑" theme={theme} onPress={() => setPairing(false)} /> : null}<Pairing theme={theme} save={saveHost} />{appLock.locked ? <LockScreen theme={theme} onUnlock={appLock.unlock} /> : null}</View>;
    const actionsDisabled = !client.recoveryReady || client.busy || Boolean(client.unknown) || Boolean(client.creationPending) || !online;
    const failedSend = client.receipt?.state === "failed" && client.receipt.operationId !== dismissedSend && client.submitted?.command.action === "send" && client.submitted.command.sessionId === client.sessionId;
    const inSession = Boolean(client.sessionId);
    const status = inSession ? sessionStatusLabel(selected?.status || "", selected?.canSend) : "";
    const subtitle = inSession ? [selected?.projectName, status, online ? "" : phaseText].filter(Boolean).join(" · ") : `${host.name} · ${phaseText}`;
    const headerActions: HeaderAction[] = inSession
        ? [{ label: "跳转到提问", icon: "menu", onPress: () => { Keyboard.dismiss(); setOverlay("navigator"); } }, { label: "会话操作", icon: "⋯", onPress: () => openSheet("manage") }]
        : tab === "sessions" ? [{ label: "消息书签", icon: "bookmark", onPress: () => openSheet("bookmarks") }, { label: "新建会话", icon: "＋", onPress: () => openSheet("new") }]
            : tab === "gallery" ? [{ label: "新建图像会话", icon: "＋", disabled: client.busy || Boolean(client.unknown) || !online, onPress: () => { haptic("tap"); void client.mutate("image.create", "new"); } }] : [];
    return (<SafeAreaView edges={["top", "left", "right", "bottom"]} style={[styles.root, { backgroundColor: theme.bg }]}>
      <StatusBar style={theme === palettes.dark ? "light" : "dark"} />
      <AppHeader theme={theme} logoLabel={(host.name.trim()[0] || "G").toUpperCase()} onLogo={() => { haptic("tap"); setComputerMenu(true); }} title={inSession ? selected?.title || "读取会话" : tabTitles[tab]} subtitle={subtitle} subtitleTone={inSession ? "muted" : online ? "success" : "warning"} onBack={inSession ? goBack : undefined} actions={headerActions} />
      <StatusBanners theme={theme}
        input={{ phase: client.connection.phase, connectionDetail: client.connection.detail, error: client.error, notice: client.notice, creationPending: client.creationPending, failedSend, shareWaiting: Boolean(incoming && !showShare) }}
        onReconnect={client.reconnect}
        onDismissError={() => { if (failedSend) setDismissedSend(client.receipt!.operationId); client.setError(""); }}
        onNotice={() => { const target = client.noticeTarget; client.setNotice(""); if (target && client.sessions.some((s) => s.id === target)) openSession(target); }}
        onRestoreDraft={() => { client.setDraft(restoreFailedDraft(client.draft, client.submitted?.command.text || "")); client.restoreMaterials(); if (failedSend) setDismissedSend(client.receipt!.operationId); client.setError(""); }}
        onShowShare={() => setShowShare(true)}
        unknown={client.unknown && !client.busy ? { busy: client.busy, check: () => void client.checkUnknown(), retry: () => void client.checkUnknown(true), acknowledge: () => confirm("结束结果核对？", "先查看电脑会话，确认上次请求是否执行。此操作不会重新发送。", () => void client.acknowledgeUnknown()) } : undefined} />
      {inSession ? (<ReadingScale.Provider value={readingScales[preferences.reading]}><ConversationFrame key="conversation" mode={preferences.keyboard}>
          <Conversation key={host.fingerprint + ":" + client.sessionId} rows={rows} theme={theme} sessionId={client.sessionId} before={client.before} loading={client.loading} refreshing={client.refreshing} readError={client.readError} anchorIndex={client.anchorIndex} canSend={client.snapshot?.session.canSend !== false} navigator={navigatorSource} density={density} navigatorOpen={overlay === "navigator"} onNavigatorClose={closeNavigator} api={conversationApi} onAsset={openAsset} onFile={openFile} onChild={openChild} />
          {client.snapshot?.pending.length && selected?.canSend !== false ? <InlinePending pending={client.snapshot.pending} theme={theme} disabled={actionsDisabled} submit={(action, extra) => void client.perform(action, extra)} onAll={() => openSheet("pending")} /> : null}
          <Composer client={client} session={selected} theme={theme} disabled={actionsDisabled || !client.materialsReady} queueCount={queue.length} childrenCount={children.length}
            onStop={() => confirm("停止当前执行？", "历史会保留，电脑正在执行的本轮任务将停止。", () => void client.perform("cancel"))}
            onAttach={() => openSheet("attachments")} onTools={() => openSheet("actions")} onConfig={() => openSheet("config")} onPending={() => openSheet("pending")} onQueue={() => openSheet("queue")} onChildren={() => openSheet("children")} />
        </ConversationFrame></ReadingScale.Provider>) : (<>
          {tab === "sessions" ? <SessionList sessions={client.sessions} theme={theme} favorites={preferences.favorites} recent={preferences.recent || []} refreshing={client.refreshing} onOpen={(id) => openSession(id)} refresh={client.refresh} online={online} actions={sessionActions} scrollToTop={topSignal} />
            : tab === "activity" ? <TaskWorkspace key={host.fingerprint} client={client} theme={theme} initialTab={activityFocus} onOpen={id => openSession(id)} />
              : tab === "gallery" ? <ImageWorkspaceScreen key={host.fingerprint} client={client} theme={theme} initialConversation={imageFocus} onAsset={openAsset} />
                : <DeviceScreen key={host.fingerprint} client={client} theme={theme} host={host} computers={computers} preferences={preferences} setPreferences={setPreferences} connectionLabel={phaseText} forget={forget} onPair={() => setPairing(true)} onSelect={saveHost} density={density} setDensity={setDensity} updateVersion={mobileUpdate} />}
          <TabBar theme={theme} value={tab} badges={{ activity: attention, settings: mobileUpdate ? 1 : undefined }} onChange={(next) => { navigationRevision.current++; if (next === tab) setTopSignal(value => value + 1); setTab(next); }} />
        </>)}
      <SheetHost sheet={sheet} setSheet={setSheet} openSheet={openSheet} theme={theme} client={client} selected={selected} rows={rows} queue={queue} children={children} actionsDisabled={actionsDisabled} preferences={preferences} setPreferences={setPreferences} openSession={openSession} openFile={openFile} density={density} setDensity={setDensity}
        onCreated={(value) => {
            createIntent.current = { id: value.operationId, revision: creationOrigin };
            if (value.resultSessionId) {
                createIntent.current = undefined;
                if (creationOrigin === navigationRevision.current) openSession(value.resultSessionId);
                else client.setNotice("新会话已创建，可从会话列表打开");
            }
        }}
        onBookmark={bookmark => { pendingJump.current = { sessionId: bookmark.sessionId, index: bookmark.remoteIndex }; if (client.sessions.some(row => row.id === bookmark.sessionId)) openSession(bookmark.sessionId); else client.setNotice("书签所在的会话不在当前电脑的列表中"); }}
        onForked={value => { createIntent.current = { id: value.operationId, revision: navigationRevision.current, source: client.sessionId }; if (value.state === "completed" && value.resultSessionId) { createIntent.current = undefined; openSession(value.resultSessionId); } }} />
      {asset ? <AssetViewer key={asset.ticket} client={client} theme={theme} asset={asset} close={() => setAsset(undefined)} /> : null}
      <ToastHost theme={theme} bottom={inSession ? 132 : 76} />
      <ActionMenu visible={computerMenu} theme={theme} title="切换电脑" onClose={() => setComputerMenu(false)} items={[
          ...computers.map(computer => ({ icon: "computer" as const, label: computer.name, detail: computer.host.replace(/^https:\/\//, "") + (computer.fingerprint === host.fingerprint ? " · " + phaseText : ""), checked: computer.fingerprint === host.fingerprint,
            onPress: () => { if (computer.fingerprint !== host.fingerprint) void saveHost(computer).catch(e => client.setError(String(e))); } })),
          { icon: "add" as const, label: "添加另一台电脑", detail: "扫码配对；已配对的电脑保留", onPress: () => setPairing(true) },
          { icon: "settings" as const, label: "连接与诊断", onPress: () => { client.selectSession(""); setTab("settings"); } },
      ]} />
      {appLock.locked ? <LockScreen theme={theme} onUnlock={appLock.unlock} /> : null}
      {incoming && showShare && !appLock.locked ? <ShareInbox client={client} theme={theme} value={incoming} close={consumed => { setShowShare(false); if (consumed) { setIncoming(undefined); void savedWrite("incoming-share", { text: "", files: [] }); } }} /> : null}
    </SafeAreaView>);
}
const styles = StyleSheet.create({ root: { flex: 1 } });
