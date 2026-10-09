import { MobileUpdate } from "./MobileUpdate";
import { MOBILE_VERSION, MATCHING_DESKTOP_VERSION } from "./version";
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppState, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import * as FS from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Clipboard from "expo-clipboard";
import * as Notifications from "expo-notifications";
import { Badge, Banner, Button, Card, Chip, ListRow, Section, Segmented, font, radius, space, ui, type Theme, Toggle, SubpageHeader, SearchField } from "./ui";
import { clearCache, rebuildStorage, savedWrite, storageStatus } from "./cache";
import {
    setMonitoring, monitoringStatus, monitoringDetail, discoverComputers, api, pushToken, cacheUsage, notificationHealth, openNotificationSettings,
    requestBatteryExemption, testNotice, cacheSummary, type CacheSummary, type HostConnection, type MonitorDetail, type NotificationHealth,
} from "./transport";
import { useOverview } from "./task-workspace";
import { confirm } from "./forms";
import { Icon, type IconName } from "./icons";
import { haptic } from "./haptics";
import { showToast } from "./toast";
import { useBackLayer } from "./back-layers";
import { authenticate, lockAvailability } from "./app-lock";
import { Markdown, ReadingScale, readingScales } from "./markdown";
import { densityLabels, type Density } from "./conversation";
import { canRetry, canCancel, cancelTransfer, clearFinishedTransfers, retryTransfer, subscribeTransfers, transfersSnapshot } from "./transfers";
import { diagnosticPrompt, formatAgo, formatBytes, minutesLabel, pickSuggestion, searchSettings, settingsPages, type SettingsPage } from "./settings-model";
import type { Preferences } from "./screens";
import type { useRemote } from "./use-remote";
import type { AutomaticUpdateCheckResult } from "../../../src/shared/types";
type Client = ReturnType<typeof useRemote>;

const pageIcons: Record<Exclude<SettingsPage, "root">, IconName> = {
    connection: "pulse", accounts: "computer", desktop: "refresh", notifications: "bell", reading: "text",
    gestures: "hand", security: "lock", storage: "storage", updates: "cloud", about: "info",
};

/**
 * The 设备 tab as a short entry page: one suggestion, the current computer, settings search,
 * and two clearly scoped groups — 这台电脑 (stored on the computer) and 这部手机 (stored here).
 * Each entry opens a focused sub-page; Android back returns to this page first.
 */
export function DeviceScreen({ client, theme, host, computers, preferences, setPreferences, onSelect, onPair, forget, connectionLabel, density, setDensity, updateVersion }: {
    client: Client;
    theme: Theme;
    host: HostConnection;
    computers: HostConnection[];
    preferences: Preferences;
    setPreferences: React.Dispatch<React.SetStateAction<Preferences>>;
    onSelect: (host: HostConnection) => Promise<void>;
    onPair: () => void;
    forget: () => void;
    connectionLabel: string;
    density: Density;
    setDensity: (value: Density) => void;
    updateVersion?: string;
}) {
    const [page, setPage] = useState<SettingsPage>("root"), [query, setQuery] = useState("");
    const scroll = useRef<ScrollView>(null);
    useBackLayer(page !== "root", () => { setPage("root"); });
    useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [page]);
    const open = (next: SettingsPage) => { haptic("tap"); setQuery(""); setPage(next); };
    const [health, setHealth] = useState<NotificationHealth>(), [monitor, setMonitor] = useState<MonitorDetail>();
    const readHealth = () => {
        if (Platform.OS !== "android") return;
        void notificationHealth().then(setHealth).catch(() => undefined);
        void monitoringDetail().then(setMonitor).catch(() => undefined);
    };
    useEffect(() => { readHealth(); const sub = AppState.addEventListener("change", state => { if (state === "active") readHealth(); }); return () => sub.remove(); }, []);
    // The follow service changes on its own; poll it only while a page that shows it is open.
    useEffect(() => { if (page !== "notifications" && page !== "root") return; const timer = setInterval(readHealth, 3000); return () => clearInterval(timer); }, [page]);
    const autoMode = client.options?.defaults?.mode === "auto" || client.sessions.some(s => s.mode === "auto");
    const suggestion = pickSuggestion({ notificationsEnabled: health?.enabled, following: Boolean(monitor?.following), batteryExempt: health?.batteryExempt, lockEnabled: preferences.lock.enabled, autoMode, updateVersion, dismissed: preferences.hints });
    const dismiss = (id: string) => setPreferences(p => ({ ...p, hints: [...p.hints, "suggest:" + id] }));
    const act = (id: string) => {
        if (id === "notifications-off") void openNotificationSettings().catch(e => client.setError(String(e)));
        else if (id === "battery") void requestBatteryExemption().catch(e => client.setError(String(e)));
        else if (id.startsWith("lock")) open("security");
        else if (id.startsWith("update:")) open("updates");
    };
    const results = searchSettings(query);
    const title = page === "root" ? undefined : settingsPages[page].title;
    const common = { client, theme, host, preferences, setPreferences };
    return <ScrollView ref={scroll} contentContainerStyle={[ui.content, { gap: space.xl }]} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={client.refreshing} onRefresh={() => { readHealth(); client.refresh(); }} />}>
      {title ? <View style={{ marginBottom: -space.sm }}><SubpageHeader theme={theme} title={title} backLabel="返回设备" onBack={() => setPage("root")} tag={settingsPages[page as Exclude<SettingsPage, "root">].scope} /></View> : null}
      {page === "root" ? <>
        {suggestion ? <View style={{ borderRadius: radius.lg, padding: space.lg, gap: space.sm, backgroundColor: suggestion.tone === "warning" ? theme.warning + "22" : theme.accentSoft }}>
            <View style={[ui.row, { gap: space.sm }]}>
              <Icon name={suggestion.tone === "warning" ? "warning" : "info"} size={18} color={suggestion.tone === "warning" ? theme.warning : theme.accent} />
              <Text style={{ flex: 1, color: theme.text, fontSize: font.body, fontWeight: "700" }}>{suggestion.title}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="不再提示" hitSlop={10} onPress={() => dismiss(suggestion.id)}><Icon name="close" size={18} color={theme.muted} /></Pressable>
            </View>
            <Text style={{ color: theme.muted, fontSize: font.small, lineHeight: 20 }}>{suggestion.detail}</Text>
            <View style={{ alignSelf: "flex-start" }}><Button compact primary title={suggestion.action} theme={theme} onPress={() => act(suggestion.id)} /></View>
          </View> : null}
        <Pressable accessibilityRole="button" accessibilityLabel={`${host.name}，${connectionLabel}，打开连接与诊断`} onPress={() => open("connection")}
          style={({ pressed }) => ({ borderRadius: radius.lg, padding: space.lg, gap: space.xs, backgroundColor: pressed ? theme.raised : theme.surface, borderWidth: 1, borderColor: theme.border })}>
          <View style={[ui.row, { gap: space.md }]}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.accentSoft, alignItems: "center", justifyContent: "center" }}><Icon name="computer" size={20} color={theme.accent} /></View>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: theme.text, fontSize: font.title, fontWeight: "700" }}>{host.name}</Text>
              <Text numberOfLines={1} style={{ color: theme.muted, fontSize: font.small }}>{client.connection.phase === "online" ? (client.connection.mode === "polling" ? "定期同步" : "实时连接") : client.connection.detail || connectionLabel}</Text>
            </View>
            <Badge text={connectionLabel} theme={theme} tone={client.connection.phase === "online" ? "success" : client.connection.phase === "blocked" ? "danger" : "warning"} />
          </View>
          {monitor?.following ? <Text style={{ color: theme.muted, fontSize: font.caption }}>后台跟进：{monitorLabel(monitor)}</Text> : null}
        </Pressable>
        <SearchField theme={theme} accessibilityLabel="搜索设置" value={query} onChangeText={setQuery} placeholder="搜索设置，如 键盘、缓存、免打扰" />
        {query.trim() ? <Section theme={theme} title={`搜索结果 ${results.length}`}>
            {results.length ? results.map(result => <ListRow key={result.title} theme={theme} title={result.title} detail={result.place} onPress={() => open(result.page)} />) : <ListRow theme={theme} title="没有找到相关设置" detail="试试 通知、后台、缓存、键盘" />}
          </Section> : <>
          <Section theme={theme} title="这台电脑" footer="保存在电脑上，影响这台电脑。">
            {(["connection", "accounts", "desktop"] as const).map(id => <EntryRow key={id} id={id} theme={theme} onPress={() => open(id)}
              value={id === "connection" ? (computers.length > 1 ? `${computers.length} 台电脑` : undefined) : undefined} />)}
          </Section>
          <Section theme={theme} title="这部手机" footer="只保存在这部手机上。">
            {(["notifications", "reading", "gestures", "security", "storage", "updates", "about"] as const).map(id => <EntryRow key={id} id={id} theme={theme} onPress={() => open(id)}
              value={id === "security" ? (preferences.lock.enabled ? "已开启应用锁" : undefined) : id === "updates" && updateVersion ? `${updateVersion} 可用` : undefined} />)}
          </Section>
          <Text style={{ color: theme.muted, fontSize: font.caption, textAlign: "center" }}>Grok Remote {MOBILE_VERSION} · 电脑负责执行，手机通过局域网或已有 VPN 连接</Text>
        </>}
      </> : null}
      {page === "connection" ? <ConnectionPage {...common} computers={computers} connectionLabel={connectionLabel} onSelect={onSelect} onPair={onPair} forget={forget} /> : null}
      {page === "accounts" ? <AccountsPage client={client} theme={theme} /> : null}
      {page === "desktop" ? <DesktopPage client={client} theme={theme} /> : null}
      {page === "notifications" ? <NotificationsPage {...common} health={health} monitor={monitor} refresh={readHealth} /> : null}
      {page === "reading" ? <ReadingPage {...common} density={density} setDensity={setDensity} /> : null}
      {page === "gestures" ? <GesturesPage {...common} /> : null}
      {page === "security" ? <SecurityPage {...common} /> : null}
      {page === "storage" ? <StoragePage {...common} /> : null}
      {page === "updates" ? <Section theme={theme} footer="手机可直接下载并校验 APK，再由系统确认覆盖安装；电脑更新在电脑端执行。">
          <SwitchRow theme={theme} label="自动检查手机更新" detail="最多每 6 小时检查一次" value={preferences.updates} onChange={value => setPreferences(p => ({ ...p, updates: value }))} />
          <MobileUpdate theme={theme} automatic={preferences.updates} />
        </Section> : null}
      {page === "about" ? <AboutPage {...common} /> : null}
    </ScrollView>;
}

function EntryRow({ id, theme, onPress, value }: { id: Exclude<SettingsPage, "root">; theme: Theme; onPress: () => void; value?: string }) {
    const page = settingsPages[id];
    return <Pressable accessibilityRole="button" accessibilityLabel={page.title} accessibilityHint={page.detail} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 56, paddingHorizontal: space.lg, paddingVertical: space.sm, backgroundColor: pressed ? theme.raised : "transparent" })}>
      <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: theme.raised, alignItems: "center", justifyContent: "center" }}><Icon name={pageIcons[id]} size={18} color={theme.accent} /></View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.text, fontSize: font.body, fontWeight: "600" }}>{page.title}</Text>
        <Text numberOfLines={1} style={{ color: theme.muted, fontSize: font.caption }}>{value || page.detail}</Text>
      </View>
      <Icon name="forward" size={16} color={theme.muted} />
    </Pressable>;
}

function SwitchRow({ theme, label, detail, value, onChange, disabled = false }: { theme: Theme; label: string; detail?: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
    return <ListRow theme={theme} title={label} detail={detail} right={<Toggle theme={theme} accessibilityLabel={label} value={value} disabled={disabled} onValueChange={next => { haptic("toggle"); onChange(next); }} />} />;
}

function monitorLabel(monitor?: MonitorDetail) {
    if (!monitor?.following) return monitor?.stopReason ? `已停止：${monitor.stopReason}` : "未开启";
    if (monitor.phase === "online") return `已连接 · 上次同步 ${formatAgo(monitor.lastSync)}`;
    if (monitor.phase === "retrying") return `连接中断，正在重连（第 ${monitor.attempts} 次）`;
    if (monitor.phase === "paused") return "已暂停（不满足后台跟进条件）";
    return "正在连接电脑…";
}

type PageProps = { client: Client; theme: Theme; host: HostConnection; preferences: Preferences; setPreferences: React.Dispatch<React.SetStateAction<Preferences>> };

function ConnectionPage({ client, theme, host, computers, connectionLabel, onSelect, onPair, forget }: PageProps & {
    computers: HostConnection[]; connectionLabel: string; onSelect: (host: HostConnection) => Promise<void>; onPair: () => void; forget: () => void;
}) {
    const [address, setAddress] = useState(host.host), [addressOpen, setAddressOpen] = useState(false), [addressError, setAddressError] = useState("");
    const [discovering, setDiscovering] = useState(false), [probe, setProbe] = useState<{ latency?: number; skew?: number; error?: string; at: number }>(), [probing, setProbing] = useState(false);
    useEffect(() => { setAddress(host.host); }, [host.host]);
    const blocked = !client.recoveryReady || client.busy || !!client.unknown || client.creationPending;
    // A late discovery or probe result applies only if the computer AND its address are unchanged.
    const alive = useRef(true), endpoint = useRef(host.fingerprint + "|" + host.host);
    endpoint.current = host.fingerprint + "|" + host.host;
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const stillCurrent = (started: string) => alive.current && endpoint.current === started;
    const test = async () => {
        const started = endpoint.current; setProbing(true);
        try {
            const sent = Date.now();
            const info = await api<{ serverTime?: number }>(host, "/v1/info");
            const received = Date.now();
            if (!stillCurrent(started)) return;
            setProbe({ latency: received - sent, skew: info.serverTime ? Math.round(info.serverTime - (sent + received) / 2) : undefined, at: received });
            haptic("success");
        } catch (e) { if (stillCurrent(started)) { setProbe({ error: e instanceof Error ? e.message : String(e), at: Date.now() }); haptic("error"); } }
        finally { if (alive.current) setProbing(false); }
    };
    useEffect(() => { if (client.connection.phase === "online") void test(); }, []);
    const discover = async () => {
        const started = endpoint.current; setDiscovering(true);
        try {
            const found = await discoverComputers();
            if (!stillCurrent(started)) return;
            const candidate = found.find(c => c.fingerprint === host.fingerprint);
            if (!candidate) throw Error("未发现当前电脑。可扫码刷新地址；访客网络可能不允许设备互访。");
            await api({ ...host, host: candidate.host }, "/v1/info");
            if (!stillCurrent(started)) return;
            await onSelect({ ...host, host: candidate.host });
            showToast("已核验原电脑身份并更新连接地址");
        } catch (e) { if (stillCurrent(started)) client.setError(String(e)); } finally { if (alive.current) setDiscovering(false); }
    };
    const saveAddress = async () => { try {
        const url = new URL(address);
        if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw Error("请输入有效的电脑 HTTPS 地址");
        await onSelect({ ...host, host: url.origin });
        setAddressError(""); setAddressOpen(false);
    } catch (e) { setAddressError(e instanceof Error ? e.message : String(e)); } };
    const online = client.connection.phase === "online";
    const others = computers.filter(c => c.fingerprint !== host.fingerprint);
    const fingerprint = host.fingerprint.replace(/[^0-9a-f]/gi, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
    return <>
      {online ? null : <Card theme={theme}>
          <Text style={[ui.title, { color: theme.text }]}>连不上电脑时，按顺序检查</Text>
          {["电脑已开机、没有睡眠", "Grok Build Desktop 正在运行，并开启了远程连接", "手机和电脑在同一局域网，或都连着同一个 VPN"].map((item, index) => <Text key={item} style={{ color: theme.text, lineHeight: 22 }}>{index + 1}. {item}</Text>)}
          <Text style={{ color: theme.text, lineHeight: 22 }}>4. 电脑地址可能变了：</Text>
          <View style={[ui.row, { flexWrap: "wrap", gap: space.sm }]}>
            <Chip label={discovering ? "正在查找…" : "重新发现地址"} theme={theme} disabled={blocked || discovering || Platform.OS !== "android"} onPress={() => void discover()} />
            <Chip label="重新连接" theme={theme} onPress={client.reconnect} />
            <Chip label="复制诊断提示词" theme={theme} onPress={() => void Clipboard.setStringAsync(diagnosticPrompt({ phase: connectionLabel, detail: client.connection.detail, mobileVersion: MOBILE_VERSION, desktopVersion: MATCHING_DESKTOP_VERSION })).then(() => showToast("已复制，可粘贴给电脑上的 Grok 排查"))} />
          </View>
          <Text style={[ui.hint, { color: theme.muted }]}>证书变化（电脑重装或重置远程连接）时需要重新扫码配对。</Text>
        </Card>}
      <Section theme={theme} title="状态" footer="证书身份始终校验；测试连接不调用模型。">
        <ListRow theme={theme} title="连接" value={online ? (client.connection.mode === "polling" ? "已连接 · 定期同步" : "已连接 · 实时") : connectionLabel} />
        {client.connection.detail && !online ? <ListRow theme={theme} title="原因" detail={client.connection.detail} /> : null}
        <ListRow theme={theme} title="延迟" value={probe?.error ? "失败" : probe?.latency !== undefined ? `${probe.latency} ms` : "—"} detail={probe?.error} />
        {probe?.skew !== undefined && Math.abs(probe.skew) > 60_000 ? <ListRow theme={theme} title="时钟差异" detail="手机与电脑时间不一致，定时任务时间可能看起来不对" value={`${Math.round(probe.skew / 1000)} 秒`} /> : null}
        <ListRow theme={theme} title="证书指纹" value={fingerprint} />
        <ListRow theme={theme} action title={probing ? "正在测试…" : "测试连接"} disabled={probing} onPress={() => void test()} />
        {online ? <ListRow theme={theme} action title="重新连接" onPress={client.reconnect} /> : null}
      </Section>
      <Section theme={theme} title="地址">
        <ListRow theme={theme} title="连接地址" value={host.host.replace(/^https:\/\//, "")} onPress={() => setAddressOpen(!addressOpen)} chevron={false} />
        {addressOpen ? <View style={{ padding: space.md, gap: space.sm }}>
            <TextInput accessibilityLabel="电脑地址" value={address} onChangeText={setAddress} autoCapitalize="none" autoCorrect={false} style={[ui.field, { borderColor: theme.border, color: theme.text }]} />
            {addressError ? <Text style={[ui.hint, { color: theme.danger }]}>{addressError}</Text> : null}
            <Button compact primary title="保存地址" theme={theme} disabled={blocked} onPress={() => void saveAddress()} />
          </View> : null}
        {<ListRow theme={theme} action title={discovering ? "正在查找…" : "重新发现电脑地址"} detail="地址变化后在局域网内自动查找并核验原电脑" disabled={blocked || discovering || Platform.OS !== "android"} onPress={() => void discover()} />}
      </Section>
      <Section theme={theme} title="其他电脑">
        {others.map(computer => <ListRow key={computer.fingerprint} theme={theme} title={computer.name} detail={computer.host.replace(/^https:\/\//, "")} disabled={blocked} onPress={() => void onSelect(computer).catch(e => client.setError(String(e)))} accessibilityLabel={`切换到 ${computer.name}`} />)}
        <ListRow theme={theme} title="添加另一台电脑" detail="扫码配对；已配对的电脑保留" disabled={blocked} onPress={onPair} />
      </Section>
      <Section theme={theme} footer="手机草稿仍保留；电脑会话和任务不会删除。重新连接需要扫码配对。">
        <ListRow theme={theme} danger title="忘记这台电脑" onPress={forget} />
      </Section>
    </>;
}

function AccountsPage({ client, theme }: { client: Client; theme: Theme }) {
    const overview = useOverview(client);
    const blocked = !client.recoveryReady || client.busy || !!client.unknown || client.creationPending;
    return <Section theme={theme} footer="账号登录、凭据添加和退出在电脑处理，手机不复制密钥。运行任务或等待确认时，电脑会阻止切换。">
      {overview.value?.accounts?.length ? overview.value.accounts.map(account => <ListRow key={account.id} theme={theme} title={account.label} detail={account.kind} value={account.active ? "当前" : undefined} disabled={account.active || blocked}
        onPress={account.active ? undefined : () => confirm("切换电脑账号？", "这是电脑级操作，会影响电脑上之后的所有任务。", () => void client.mutate("account.switch", account.id))} accessibilityLabel={account.active ? account.label : `切换到账号 ${account.label}`} />)
        : <ListRow theme={theme} title={overview.loading ? "正在读取账号…" : "暂无账号信息"} />}
    </Section>;
}

function DesktopPage({ client, theme }: { client: Client; theme: Theme }) {
    const [updates, setUpdates] = useState<AutomaticUpdateCheckResult>(), [busy, setBusy] = useState(false);
    const check = () => { setBusy(true); void client.query<AutomaticUpdateCheckResult>("updates").then(setUpdates).catch(e => client.setError(String(e))).finally(() => setBusy(false)); };
    useEffect(() => { if (client.connection.phase === "online") check(); }, []);
    return <Section theme={theme} footer={`这部手机配套电脑版本 ${MATCHING_DESKTOP_VERSION}。电脑与 CLI 的安装在电脑端执行。`}>
      {updates?.reason === "disabled" ? <ListRow theme={theme} title="电脑已关闭自动更新检查" detail="可到电脑更新中心手动检查" /> : <>
        <ListRow theme={theme} title="Grok Build Desktop" value={updates?.app?.currentVersion || "—"} detail={updates?.app ? (updates.app.error || (updates.app.updateAvailable ? `有新版本 ${updates.app.latestVersion}` : "已是最新")) : undefined} />
        <ListRow theme={theme} title="Grok CLI" value={updates?.cli?.currentVersion || "—"} detail={updates?.cli ? (updates.cli.error || (updates.cli.updateAvailable ? `有新版本 ${updates.cli.latestVersion}` : "已是最新")) : undefined} />
      </>}
      <ListRow theme={theme} title={busy ? "正在检查…" : "检查电脑端更新"} disabled={busy || client.connection.phase !== "online"} onPress={check} />
    </Section>;
}

function NotificationsPage({ client, theme, host, preferences, setPreferences, health, monitor, refresh }: PageProps & { health?: NotificationHealth; monitor?: MonitorDetail; refresh: () => void }) {
    const [push, setPush] = useState<{ configured: boolean; registered: boolean; deliveryVersion?: number; publicConfig?: Record<string, string>; lastError?: string }>(), [pushBusy, setPushBusy] = useState(false), [changing, setChanging] = useState(false);
    const [following, setFollowing] = useState(false);
    useEffect(() => { let disposed = false; void client.query<typeof push>("push-status").then(value => { if (!disposed) setPush(value); }).catch(() => undefined); return () => { disposed = true; }; }, [client.host?.id, client.receipt?.state]);
    useEffect(() => { if (Platform.OS === "android") void monitoringStatus().then(setFollowing).catch(() => undefined); }, [monitor?.following]);
    const android = Platform.OS === "android";
    const toggleMonitor = async (value: boolean) => { if (changing) return; setChanging(true); try {
        if (value) { const permission = await Notifications.requestPermissionsAsync(); if (!permission.granted) throw Error("系统未允许通知，请在系统设置允许后开启后台跟进"); }
        await setMonitoring(host, value);
        setFollowing(value);
        await savedWrite(host.fingerprint + ":monitor", value);
        setTimeout(refresh, 800);
    } catch (e) { client.setError(String(e)); } finally { setChanging(false); } };
    const enablePush = async () => { setPushBusy(true); try {
        const permission = await Notifications.requestPermissionsAsync();
        if (!permission.granted) throw Error("请允许系统通知");
        if (!push?.publicConfig) throw Error("请先在电脑高级连接设置配置推送");
        const token = await pushToken(push.publicConfig);
        await client.mutate("notification.register", "device", { token, deliveryVersion: 2 });
        client.setNotice("电脑已接收推送注册，结果以刷新状态为准");
    } catch (e) { client.setError(String(e)); } finally { setPushBusy(false); } };
    const quiet = preferences.quiet;
    const setQuiet = (patch: Partial<typeof quiet>) => setPreferences(p => ({ ...p, quiet: { ...p.quiet, ...patch } }));
    const step = (value: number, delta: number) => ((value + delta) % 1440 + 1440) % 1440;
    const channel = (id: string) => health?.channels.find(c => c.id === id);
    const systemRow = (label: string, key: "completion" | "failure" | "attention", channelId: string) => {
        const blocked = channel(channelId)?.enabled === false;
        return <ListRow key={key} theme={theme} title={label} detail={blocked ? "此类通知在系统设置中被关闭，点击前往开启" : undefined} onPress={blocked ? () => void openNotificationSettings(channelId) : undefined}
          right={<Toggle theme={theme} accessibilityLabel={label + "系统通知"} value={preferences[key] && !blocked} disabled={blocked} onValueChange={value => { haptic("toggle"); setPreferences(p => ({ ...p, [key]: value })); }} />} />;
    };
    return <>
      {health && !health.enabled ? <Banner theme={theme} tone="danger" text="系统通知已关闭。App 内仍会提示，但手机在后台时收不到通知。" action="去开启" onAction={() => void openNotificationSettings()} /> : null}
      <Section theme={theme} title="后台跟进" footer="开启后显示常驻通知，在局域网 / 已有 VPN 内跟进任务。停止跟进不会停止电脑上的任务。">
        <SwitchRow theme={theme} label="后台持续跟进" detail={android ? monitorLabel(monitor) : "仅 Android 支持"} value={following} disabled={changing || !android} onChange={value => void toggleMonitor(value)} />
        <View style={{ padding: space.md, gap: space.sm }}>
          <Text style={[ui.hint, { color: theme.muted }]}>跟进条件</Text>
          <Segmented theme={theme} value={preferences.monitorMode} onChange={mode => setPreferences(p => ({ ...p, monitorMode: mode }))} items={[["always", "始终"], ["wifi", "仅 Wi-Fi"], ["screen", "仅亮屏时"]] as const} />
        </View>
        {android ? <ListRow theme={theme} title="电池优化" detail={health?.batteryExempt ? "已允许后台运行" : "系统可能在后台停止跟进；点击允许忽略电池优化"} value={health?.batteryExempt ? "已允许" : "去允许"} onPress={health?.batteryExempt ? undefined : () => void requestBatteryExemption().catch(e => client.setError(String(e)))} /> : null}
      </Section>
      <Section theme={theme} title="系统通知（手机在后台时）" footer="这些规则仅影响当前电脑。通知不显示对话正文。点击被关闭的项目可直达系统设置。">
        {systemRow("完成", "completion", "grok-completed")}
        {systemRow("失败", "failure", "grok-failed")}
        {systemRow("需要确认", "attention", "grok-attention")}
        {android ? <ListRow theme={theme} title="系统通知设置" onPress={() => void openNotificationSettings()} /> : null}
      </Section>
      <Section theme={theme} title="应用内提示（正在使用 App 时）" footer="只在 App 顶部显示一条提示；正在查看的会话不再重复提醒。">
        {([["完成", "completion"], ["失败", "failure"], ["需要确认", "attention"]] as const).map(([label, key]) => <SwitchRow key={key} theme={theme} label={label} value={preferences.inApp[key]} onChange={value => setPreferences(p => ({ ...p, inApp: { ...p.inApp, [key]: value } }))} />)}
      </Section>
      <Section theme={theme} title="免打扰时段" footer="时段内不发系统通知；跨午夜自动处理。">
        <SwitchRow theme={theme} label="开启免打扰" value={quiet.enabled} onChange={enabled => setQuiet({ enabled })} />
        {quiet.enabled ? <>
          {([["开始", "start"], ["结束", "end"]] as const).map(([label, key]) => <ListRow key={key} theme={theme} title={label} right={<View style={[ui.row, { gap: space.xs }]}>
              <Chip label="−30′" theme={theme} onPress={() => setQuiet({ [key]: step(quiet[key], -30) })} />
              <Text style={{ color: theme.text, fontSize: font.body, fontWeight: "700", minWidth: 52, textAlign: "center", fontVariant: ["tabular-nums"] }}>{minutesLabel(quiet[key])}</Text>
              <Chip label="+30′" theme={theme} onPress={() => setQuiet({ [key]: step(quiet[key], 30) })} />
            </View>} />)}
          <SwitchRow theme={theme} label="审批请求仍然提醒" detail="需要你确认的事项不受免打扰影响" value={quiet.allowAttention} onChange={allowAttention => setQuiet({ allowAttention })} />
        </> : null}
      </Section>
      <Section theme={theme} title="检查">
        <ListRow theme={theme} title="发送测试通知" detail="只在本机显示一条通知，不联系电脑、不调用模型" onPress={() => { if (android) void testNotice(host.fingerprint).then(() => showToast("已发送测试通知")).catch(e => client.setError(String(e))); else showToast("当前平台不支持系统通知"); }} />
        <ListRow theme={theme} title={pushBusy ? "注册中…" : push?.registered ? ((push.deliveryVersion ?? 1) < 2 ? "升级推送去重" : "关闭云端推送") : "启用云端推送"} detail={(push?.configured ? (push.registered ? "此手机已注册" : "电脑已配置，此手机尚未注册") : "可选；电脑未配置时，局域网后台跟进不受影响") + (push?.lastError ? " · " + push.lastError : "")}
          disabled={pushBusy || !push?.configured || !android || client.busy} onPress={() => push?.registered && (push.deliveryVersion ?? 1) >= 2 ? void client.mutate("notification.unregister", "device") : void enablePush()} />
      </Section>
    </>;
}

const SAMPLE = "**示例回答**：已检查 `src/app.ts`，发现两处问题。\n\n1. 登录状态没有在刷新后恢复。\n2. 列表在空数据时报错。\n\n```ts\nconst user = await restore();\n```";
function ReadingPage({ theme, preferences, setPreferences, density, setDensity }: PageProps & { density: Density; setDensity: (value: Density) => void }) {
    return <>
      <Section theme={theme} title="主题">
        <View style={{ padding: space.md }}>
          <Segmented theme={theme} value={preferences.theme} onChange={mode => setPreferences(p => ({ ...p, theme: mode }))} items={[["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]] as const} />
        </View>
      </Section>
      <Section theme={theme} title="字号" footer="只影响回答正文和代码，界面其他文字跟随系统字体大小。">
        <View style={{ padding: space.md, gap: space.md }}>
          <Segmented theme={theme} value={preferences.reading} onChange={reading => setPreferences(p => ({ ...p, reading }))} items={[["compact", "紧凑"], ["standard", "标准"], ["comfortable", "易读"]] as const} />
          <View accessibilityLabel="字号预览" style={{ borderRadius: radius.md, padding: space.md, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border }}>
            <ReadingScale.Provider value={readingScales[preferences.reading]}><Markdown value={SAMPLE} theme={theme} /></ReadingScale.Provider>
          </View>
        </View>
      </Section>
      <Section theme={theme} title="回答详细程度" footer="控制工具调用和过程信息显示多少，不影响电脑执行。">
        <View style={{ padding: space.md }}>
          <Segmented theme={theme} value={density} onChange={setDensity} items={(Object.keys(densityLabels) as Density[]).map(id => [id, densityLabels[id]] as const)} />
        </View>
      </Section>
    </>;
}

function GesturesPage({ theme, preferences, setPreferences }: PageProps) {
    const guide: Array<[IconName, string, string]> = [
        ["star", "会话向右滑", "收藏或取消收藏，松手生效"],
        ["archive", "会话向左滑", "露出归档 / 删除；删除仍会再确认"],
        ["more", "长按会话、消息或图片", "打开操作菜单，相当于电脑右键"],
        ["quote", "回答向右滑", "把这条回答作为引用加入输入框"],
        ["select", "菜单中的“多选”", "批量收藏、归档、复制或保存"],
        ["images", "看图", "左右滑切换，双击或双指放大，下滑关闭"],
    ];
    return <>
      <Section theme={theme}>
        <SwitchRow theme={theme} label="触感反馈" detail="滑动越过阈值、切换开关、操作成功或失败时轻微振动" value={preferences.haptics} onChange={haptics => setPreferences(p => ({ ...p, haptics }))} />
      </Section>
      <Section theme={theme} title="常用手势">
        {guide.map(([icon, title, detail]) => <ListRow key={title} theme={theme} title={title} detail={detail} right={<Icon name={icon} size={18} color={theme.muted} />} />)}
      </Section>
      <Section theme={theme} footer="重新显示首次使用时的操作提示。">
        <ListRow theme={theme} action title="重置操作提示" onPress={() => { setPreferences(p => ({ ...p, hints: p.hints.filter(h => h.startsWith("suggest:")) })); showToast("操作提示已重置"); }} />
      </Section>
    </>;
}

function SecurityPage({ client, theme, preferences, setPreferences }: PageProps) {
    const lock = preferences.lock, [busy, setBusy] = useState(false);
    const setLock = (patch: Partial<typeof lock>) => setPreferences(p => ({ ...p, lock: { ...p.lock, ...patch } }));
    const toggle = async (enabled: boolean) => {
        if (busy) return; setBusy(true);
        try {
            if (enabled) { const available = await lockAvailability(); if (!available.ok) throw Error(available.reason); }
            // Turning the lock on or off both require the owner: a borrower cannot just switch it off.
            const result = await authenticate(enabled ? "确认开启应用锁" : "确认关闭应用锁");
            if (!result.ok) { if (result.error) throw Error(result.error); return; }
            setLock({ enabled });
            haptic("success");
            showToast(enabled ? "应用锁已开启" : "应用锁已关闭");
        } catch (e) { haptic("error"); client.setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
    };
    return <>
      <Section theme={theme} title="应用锁" footer="打开 Grok Remote 时验证指纹、面容或手机锁屏密码。电脑上的任务不受影响。">
        <SwitchRow theme={theme} label="开启应用锁" value={lock.enabled} disabled={busy || Platform.OS === "web"} onChange={value => void toggle(value)} />
        {lock.enabled ? <View style={{ padding: space.md, gap: space.sm }}>
            <Text style={[ui.hint, { color: theme.muted }]}>离开多久后需要重新验证</Text>
            <Segmented theme={theme} value={String(lock.timeout)} onChange={value => setLock({ timeout: Number(value) })} items={[["0", "立即"], ["1", "1 分钟"], ["5", "5 分钟"], ["15", "15 分钟"]] as const} />
          </View> : null}
      </Section>
      <Section theme={theme} title="隐私" footer="开启后，截屏和录屏得到黑屏，最近任务里也看不到 App 内容。">
        <SwitchRow theme={theme} label="防截屏与最近任务遮罩" value={lock.secure} disabled={Platform.OS !== "android"} onChange={secure => setLock({ secure })} />
      </Section>
    </>;
}

function StoragePage({ client, theme, preferences, setPreferences }: PageProps) {
    const [usage, setUsage] = useState<number>(), [storage, setStorage] = useState(storageStatus());
    const [summary, setSummary] = useState<CacheSummary>(), [largest, setLargest] = useState(false);
    const transfers = useSyncExternalStore(subscribeTransfers, transfersSnapshot);
    const read = () => { setStorage(storageStatus()); if (Platform.OS === "android") { void cacheUsage(false).then(setUsage).catch(() => undefined); void cacheSummary().then(setSummary).catch(() => undefined); } };
    useEffect(read, []);
    const clear = () => confirm("清理离线缓存？", `将清理：离线历史和图片缓存${usage ? `（约 ${formatBytes(usage)}）` : ""}。\n保留：草稿、待上传材料、提交回执，以及电脑上的所有原文件。`,
        () => void clearCache().then(async () => { if (Platform.OS === "android") await cacheUsage(true); }).then(() => { read(); showToast("缓存已清理；草稿和回执保留"); }).catch(e => client.setError(String(e))));
    const running = transfers.filter(t => t.state === "running" || t.state === "queued"), failed = transfers.filter(t => t.state === "failed"), done = transfers.filter(t => t.state === "done" || t.state === "cancelled");
    const label = (state: string) => ({ queued: "等待中", running: "进行中", done: "完成", failed: "失败", cancelled: "已取消" } as Record<string, string>)[state] || state;
    return <>
      <Section theme={theme} title="缓存" footer="图片缓存按需下载；清理后再次查看会重新下载。">
        <ListRow theme={theme} title="图片与预览缓存" value={usage === undefined ? "—" : formatBytes(usage)} />
        {summary ? <>{([["缩略图", summary.thumbnails], ["原图", summary.originals], ["文件预览", summary.previews], ["安装包（单独管理）", summary.updates]] as const).map(([title, size]) => <ListRow key={title} theme={theme} title={title} value={formatBytes(size)} />)}</> : null}
        <SwitchRow theme={theme} label="仅 Wi-Fi 预取相邻原图" value={preferences.prefetchWifiOnly} detail="不影响手动打开、保存或分享图片" onChange={value => setPreferences(p => ({...p,prefetchWifiOnly:value}))} />
        {summary?.largest.length ? <ListRow theme={theme} title="最大的缓存文件" value={largest ? "收起" : "查看"} onPress={() => setLargest(!largest)} /> : null}
        {largest ? summary?.largest.map((file, index) => <ListRow key={index} theme={theme} title={file.name} value={formatBytes(file.size)} />) : null}
        <ListRow theme={theme} title="本机数据库" value={storage.ok ? "正常" : "打开失败"} detail={storage.ok ? undefined : storage.error} />
        <ListRow theme={theme} action title="清理缓存" detail="草稿、待上传材料、回执和电脑原文件保留" onPress={clear} />
        {!storage.ok ? <ListRow theme={theme} danger title="重建本机数据库" detail="会清除本机保存的草稿和缓存，仅在数据库无法打开时使用" onPress={() => confirm("重建本机数据库？", "本机保存的草稿和缓存会被清除；电脑上的会话和文件不受影响。", () => void rebuildStorage().then(() => { read(); showToast("本机数据库已重建"); }).catch(e => client.setError(String(e))))} /> : null}
      </Section>
      <Section theme={theme} title={`传输中心${running.length ? ` · 进行中 ${running.length}` : ""}${failed.length ? ` · 失败 ${failed.length}` : ""}`} footer="取消或重试只影响文件传输，不会停止、重复或重新发送电脑上的任务。">
        {!transfers.length ? <ListRow theme={theme} title="暂无传输" detail="原图下载、上传材料和安装包下载会显示在这里" /> : null}
        {[...running, ...failed, ...done].slice(0, 40).map(item => <ListRow key={item.id} theme={theme} title={item.label} detail={item.error || (item.total ? `${formatBytes(item.received || 0)} / ${formatBytes(item.total)}` : formatAgo(item.updatedAt))} value={item.total && item.state === "running" ? `${Math.min(100, Math.round((item.received || 0) / item.total * 100))}%` : label(item.state)}
          right={canCancel(item.id) ? <Button compact theme={theme} title="取消" onPress={() => cancelTransfer(item.id)} /> : undefined}
          onPress={item.state === "failed" && canRetry(item.id) ? () => { haptic("tap"); retryTransfer(item.id); } : undefined} accessibilityLabel={item.state === "failed" ? `重试 ${item.label}` : undefined} />)}
        {done.length ? <ListRow theme={theme} action title="清除已完成记录" onPress={clearFinishedTransfers} /> : null}
      </Section>
    </>;
}

function AboutPage({ client, theme, preferences, setPreferences }: PageProps) {
    const [details, setDetails] = useState(false);
    const exportDiagnostics = () => void (async () => {
        if (!FS.cacheDirectory || !(await Sharing.isAvailableAsync())) throw Error("当前系统不支持文件分享");
        const file = FS.cacheDirectory + "grok-remote-diagnostics.json";
        await FS.writeAsStringAsync(file, JSON.stringify({ product: "Grok Remote", version: MOBILE_VERSION, matchingDesktop: MATCHING_DESKTOP_VERSION, platform: Platform.OS, systemVersion: Platform.Version, connection: client.connection.phase, capabilities: client.options?.capabilities || [], uncertainSubmission: !!client.unknown, cachedHistory: !!client.cachedAt, storage: storageStatus(), keyboard: preferences.keyboard, generatedAt: new Date().toISOString(), excluded: ["network addresses", "account credentials", "session identity", "conversation bodies"] }, null, 2));
        await Sharing.shareAsync(file, { mimeType: "application/json" });
    })().catch(e => client.setError(String(e)));
    return <>
      <Section theme={theme} title="键盘" footer="如果输入法弹出时输入框位置不对，可切换到兼容模式。">
        <View style={{ padding: space.md }}>
          <Segmented theme={theme} value={preferences.keyboard} onChange={keyboard => setPreferences(p => ({ ...p, keyboard }))} items={[["native", "跟随键盘（推荐）"], ["legacy", "兼容模式"]] as const} />
        </View>
      </Section>
      <Section theme={theme} title="诊断">
        <ListRow theme={theme} title="导出脱敏诊断" detail="不含网络地址、凭据、会话身份和对话正文" onPress={exportDiagnostics} />
        <ListRow theme={theme} title="版本与能力" onPress={() => setDetails(!details)} chevron={false} value={details ? "收起" : "展开"} />
        {details ? <Text selectable style={[ui.hint, { color: theme.muted, padding: space.md }]}>Grok Remote {MOBILE_VERSION} · 配套 Desktop {MATCHING_DESKTOP_VERSION}{"\n"}{client.options?.capabilities.join(" · ") || "尚未取得能力"}{"\n"}缓存时间 {client.cachedAt ? new Date(client.cachedAt).toLocaleString() : "已连接时查看最新状态"}</Text> : null}
      </Section>
    </>;
}
