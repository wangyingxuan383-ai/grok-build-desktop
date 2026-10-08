import { MobileUpdate } from "./MobileUpdate";
import { MOBILE_VERSION, MATCHING_DESKTOP_VERSION } from "./version";
import React, { useEffect, useRef, useState } from "react";
import { Platform, RefreshControl, ScrollView, Switch, Text, TextInput, View } from "react-native";
import * as FS from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Notifications from "expo-notifications";
import { Badge, Button, ListRow, Section, Segmented, font, space, ui, type Theme } from "./ui";
import { clearCache, savedWrite } from "./cache";
import { setMonitoring, monitoringStatus, discoverComputers, api, pushToken, cacheUsage, type HostConnection } from "./transport";
import { useOverview } from "./task-workspace";
import { confirm } from "./forms";
import type { Preferences } from "./screens";
import type { useRemote } from "./use-remote";
import type { AutomaticUpdateCheckResult } from "../../../src/shared/types";
type Client = ReturnType<typeof useRemote>;
/**
 * The 设备 tab: this computer's connection, other paired computers, notifications,
 * appearance, desktop accounts, updates and maintenance — one grouped list instead of
 * a column of unrelated buttons.
 */
export function DeviceScreen({ client, theme, host, computers, preferences, setPreferences, onSelect, onPair, forget, connectionLabel }: {
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
}) {
    const overview = useOverview(client), [monitor, setMonitor] = useState(false), [changing, setChanging] = useState(false), [details, setDetails] = useState(false), [updates, setUpdates] = useState<AutomaticUpdateCheckResult>(), [updateBusy, setUpdateBusy] = useState(false), [discovering, setDiscovering] = useState(false);
    const [address, setAddress] = useState(host.host), [addressOpen, setAddressOpen] = useState(false), [addressError, setAddressError] = useState("");
    useEffect(() => { setAddress(host.host); }, [host.host]);
    const [push, setPush] = useState<{ configured: boolean; registered: boolean; publicConfig?: Record<string, string>; lastError?: string; }>(), [pushBusy, setPushBusy] = useState(false);
    const blocked = !client.recoveryReady || client.busy || !!client.unknown || client.creationPending;
    const alive = useRef(true), identity = useRef(host.fingerprint);
    identity.current = host.fingerprint;
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const current = () => alive.current && identity.current === host.fingerprint;

    useEffect(() => { let disposed = false; setPush(undefined); void client.query<typeof push>("push-status").then(value => { if (!disposed) setPush(value); }).catch(() => undefined); return () => { disposed = true; }; }, [client.host?.id, client.receipt?.state]);
    useEffect(() => { if (Platform.OS === "android") void monitoringStatus().then(setMonitor).catch(() => undefined); }, [client.host?.id]);
    const enablePush = async () => { setPushBusy(true); try {
        const permission = await Notifications.requestPermissionsAsync();
        if (!current()) return;
        if (!permission.granted) throw Error("请允许系统通知");
        if (!push?.publicConfig) throw Error("请先在电脑高级连接设置配置推送");
        const token = await pushToken(push.publicConfig);
        if (!current()) return;
        await client.mutate("notification.register", "device", { token });
        client.setNotice("电脑已接收推送注册，结果以刷新状态为准");
    } catch (e) { client.setError(String(e)); } finally { setPushBusy(false); } };
    const discover = async () => { setDiscovering(true); try {
        const found = await discoverComputers();
        if (!current()) return;
        const candidate = found.find(c => c.fingerprint === client.host?.fingerprint);
        if (!candidate) throw Error("未发现当前电脑。可扫码刷新地址；访客网络可能不允许设备互访。");
        await api({ ...client.host!, host: candidate.host }, "/v1/info");
        if (!current()) return;
        await onSelect({ ...client.host!, host: candidate.host });
        client.setNotice("已核验原电脑身份并更新连接地址");
    } catch (e) { client.setError(String(e)); } finally { setDiscovering(false); } };
    const toggleMonitor = async (value: boolean) => { if (!client.host || changing) return; setChanging(true); try {
        if (value) { const permission = await Notifications.requestPermissionsAsync(); if (!permission.granted) throw Error("系统未允许通知，请在系统设置允许后开启持续跟进"); }
        await setMonitoring(client.host, value);
        setMonitor(value);
        await savedWrite(client.host.fingerprint + ":monitor", value);
    } catch (e) { client.setError(String(e)); } finally { setChanging(false); } };
    const saveAddress = async () => { try {
        const url = new URL(address);
        if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw Error("请输入有效的电脑 HTTPS 地址");
        await onSelect({ ...host, host: url.origin });
        setAddressError(""); setAddressOpen(false);
    } catch (e) { setAddressError(e instanceof Error ? e.message : String(e)); } };
    const exportDiagnostics = () => void (async () => { if (!FS.cacheDirectory || !(await Sharing.isAvailableAsync())) throw Error("当前系统不支持文件分享"); const file = FS.cacheDirectory + "grok-remote-diagnostics.json"; await FS.writeAsStringAsync(file, JSON.stringify({ product: "Grok Remote", version: MOBILE_VERSION, matchingDesktop: MATCHING_DESKTOP_VERSION, platform: Platform.OS, systemVersion: Platform.Version, connection: client.connection.phase, capabilities: client.options?.capabilities || [], uncertainSubmission: !!client.unknown, cachedHistory: !!client.cachedAt, generatedAt: new Date().toISOString(), excluded: ["network addresses", "account credentials", "session identity", "conversation bodies"] }, null, 2)); await Sharing.shareAsync(file, { mimeType: "application/json" }); })().catch(e => client.setError(String(e)));
    const switchRow = (label: string, value: boolean, onChange: (value: boolean) => void, detail?: string, disabled = false) => <ListRow theme={theme} title={label} detail={detail} right={<Switch accessibilityLabel={label} value={value} disabled={disabled} onValueChange={onChange} />} />;
    const desktopState = updates ? (updates.reason === "disabled" ? "电脑已关闭自动更新检查，可到电脑更新中心手动检查。" : `Desktop ${updates.app?.currentVersion || "未知"} · ${updates.app?.error || (updates.app?.updateAvailable ? "有新版本 " + updates.app.latestVersion : "未发现新版本")}\nCLI ${updates.cli?.currentVersion || "未知"} · ${updates.cli?.error || (updates.cli?.updateAvailable ? "有新版本 " + updates.cli.latestVersion : "未发现新版本")}`) : undefined;
    const others = computers.filter(c => c.fingerprint !== host.fingerprint);
    return <ScrollView contentContainerStyle={[ui.content, { gap: space.xl }]} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={client.refreshing} onRefresh={client.refresh} />}>
      <Section theme={theme} title="当前电脑" footer="证书身份始终校验；更换电脑或证书时需重新扫码配对。">
        <ListRow theme={theme} title={host.name} detail={client.connection.detail} right={<Badge text={connectionLabel} theme={theme} tone={client.connection.phase === "online" ? "success" : client.connection.phase === "blocked" ? "danger" : "warning"} />} />
        <ListRow theme={theme} title="重新连接" onPress={client.reconnect} />
        <ListRow theme={theme} title={discovering ? "正在查找…" : "重新发现电脑地址"} detail="地址变化后在局域网内自动查找并核验原电脑" disabled={blocked || discovering || Platform.OS !== "android"} onPress={() => void discover()} />
        <ListRow theme={theme} title="连接地址" value={host.host.replace(/^https:\/\//, "")} onPress={() => setAddressOpen(!addressOpen)} chevron={false} />
        {addressOpen ? <View style={{ padding: space.md, gap: space.sm }}>
            <TextInput accessibilityLabel="电脑地址" value={address} onChangeText={setAddress} autoCapitalize="none" autoCorrect={false} style={[ui.field, { borderColor: theme.border, color: theme.text }]} />
            {addressError ? <Text style={[ui.hint, { color: theme.danger }]}>{addressError}</Text> : null}
            <Button compact primary title="保存地址" theme={theme} disabled={blocked} onPress={() => void saveAddress()} />
          </View> : null}
      </Section>
      <Section theme={theme} title="其他电脑">
        {others.map(computer => <ListRow key={computer.fingerprint} theme={theme} title={computer.name} detail={computer.host} disabled={blocked} onPress={() => void onSelect(computer).catch(e => client.setError(String(e)))} accessibilityLabel={`切换到 ${computer.name}`} />)}
        <ListRow theme={theme} title="添加另一台电脑" detail="扫码配对；已配对的电脑保留" disabled={blocked} onPress={onPair} />
      </Section>
      <Section theme={theme} title="提醒与后台" footer="系统通知隐藏对话正文；免打扰和锁屏显示由 Android 通知设置控制。停止跟进不会停止电脑任务。">
        {switchRow("后台持续跟进", monitor, value => void toggleMonitor(value), "开启后显示常驻通知，在局域网 / 已有 VPN 内跟进任务", changing || Platform.OS !== "android")}
        {switchRow("任务完成提醒", preferences.completion, value => setPreferences(p => ({ ...p, completion: value })))}
        {switchRow("任务失败提醒", preferences.failure, value => setPreferences(p => ({ ...p, failure: value })))}
        {switchRow("需要回应提醒", preferences.attention, value => setPreferences(p => ({ ...p, attention: value })))}
        <ListRow theme={theme} title={pushBusy ? "注册中…" : push?.registered ? "关闭云端推送" : "启用云端推送"} detail={(push?.configured ? (push.registered ? "此手机已注册" : "电脑已配置，此手机尚未注册") : "可选；电脑未配置，局域网连接不受影响") + (push?.lastError ? " · " + push.lastError : "")} disabled={pushBusy || !push?.configured || Platform.OS !== "android" || client.busy} onPress={() => push?.registered ? void client.mutate("notification.unregister", "device") : void enablePush()} />
      </Section>
      <Section theme={theme} title="外观">
        <View style={{ padding: space.md }}>
          <Segmented theme={theme} value={preferences.theme} onChange={mode => setPreferences(p => ({ ...p, theme: mode }))} items={[["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]] as const} />
        </View>
      </Section>
      <Section theme={theme} title="电脑账号" footer="账号登录、凭据添加和退出在电脑处理，手机不复制密钥。">
        {overview.value?.accounts?.length ? overview.value.accounts.map(account => <ListRow key={account.id} theme={theme} title={account.label} detail={account.kind} value={account.active ? "当前" : undefined} disabled={account.active || blocked} onPress={account.active ? undefined : () => confirm("切换电脑账号？", "这是电脑级操作。运行任务或等待确认时，电脑原服务会阻止切换。", () => void client.mutate("account.switch", account.id))} accessibilityLabel={account.active ? account.label : `切换到账号 ${account.label}`} />) : <ListRow theme={theme} title={overview.loading ? "正在读取账号…" : "暂无账号信息"} />}
      </Section>
      <Section theme={theme} title="更新" footer="手机可直接下载并校验 APK，再由系统确认覆盖安装；电脑更新在电脑端执行。">
        {switchRow("打开后检查配套更新", preferences.updates, value => setPreferences(p => ({ ...p, updates: value })))}
        <MobileUpdate theme={theme} automatic={preferences.updates} />
        <ListRow theme={theme} title={updateBusy ? "正在检查…" : "电脑 Desktop / CLI"} detail={desktopState} value="检查" chevron={false} disabled={updateBusy || client.connection.phase !== "online"} onPress={() => { setUpdateBusy(true); void client.query<AutomaticUpdateCheckResult>("updates").then(setUpdates).catch(e => client.setError(String(e))).finally(() => setUpdateBusy(false)); }} accessibilityLabel="检查配套 Desktop / CLI 更新" />
      </Section>
      <Section theme={theme} title="维护">
        <ListRow theme={theme} title="导出脱敏诊断" detail="不含网络地址、凭据、会话身份和对话正文" onPress={exportDiagnostics} />
        <ListRow theme={theme} title="清理离线缓存" detail="草稿、提交回执和电脑原文件保留" onPress={() => confirm("清理离线缓存？", "草稿、提交回执和电脑原文件保留。", () => void clearCache().then(async () => { if (Platform.OS === "android") await cacheUsage(true); }).then(() => client.setNotice("离线历史与预览缓存已清理；草稿和回执保留")))} />
        <ListRow theme={theme} title="版本与能力" onPress={() => setDetails(!details)} chevron={false} value={details ? "收起" : "展开"} />
        {details ? <Text selectable style={[ui.hint, { color: theme.muted, padding: space.md }]}>Grok Remote {MOBILE_VERSION} · 配套 Desktop {MATCHING_DESKTOP_VERSION}{"\n"}{client.options?.capabilities.join(" · ") || "尚未取得能力"}{"\n"}缓存时间 {client.cachedAt ? new Date(client.cachedAt).toLocaleString() : "已连接时查看最新状态"}</Text> : null}
      </Section>
      <Section theme={theme} footer="手机草稿仍保留；电脑会话和任务不会删除。重新连接需要扫码配对。">
        <ListRow theme={theme} danger title="忘记这台电脑" onPress={forget} />
      </Section>
      <Text style={{ color: theme.muted, fontSize: font.caption, textAlign: "center" }}>Grok Remote {MOBILE_VERSION} · 电脑负责执行，手机通过局域网或已有 VPN 连接</Text>
    </ScrollView>;
}
