import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Linking, Platform, Pressable, ScrollView, Text, TextInput, View, } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { StatusBar } from "expo-status-bar";
import { Button, Card, font, radius, space, ui, palettes, type Theme, SearchField } from "./ui";
import { configSummary, orderWorkspaces } from "./app-model";
import { Markdown } from "./markdown";
import { api, type HostConnection } from "./transport";
import { MobileUpdate } from "./MobileUpdate";
import { parsePairingOffer } from "./remote-model";
import { permissionDescription } from "./experience-model";
import { ConfigurationPicker, type Configuration } from "./workbench";
import { savedRead, savedWrite } from "./cache";
import type { useRemote } from "./use-remote";
import type { RemoteCommand, RemoteReceipt } from "../../../src/shared/remote";
import type { ChatEvent, PromptQueueEntry, SessionMode } from "../../../src/shared/types";
type Client = ReturnType<typeof useRemote>;
function PermissionDetails({ raw, theme }: {
    raw: unknown;
    theme: Theme;
}) {
    const description = useMemo(() => permissionDescription(raw), [raw]);
    return (<View style={{ gap: 10 }}>
      <Text style={{ color: theme.text, fontSize: 15, lineHeight: 23 }}>
        {description.title}
      </Text>
      {description.detail && description.detail !== "{}" ? (<ScrollView style={{
                maxHeight: 170,
                backgroundColor: theme.raised,
                borderRadius: 10,
            }} nestedScrollEnabled>
          <Text selectable style={{
                color: theme.text,
                fontFamily: "monospace",
                fontSize: 13,
                lineHeight: 21,
                padding: 12,
            }}>
            {description.detail}
          </Text>
        </ScrollView>) : (<Text style={[ui.hint, { color: theme.muted }]}>
          当前请求未提供更详细参数，可先在电脑核对。
        </Text>)}
    </View>);
}
export function confirm(title: string, detail: string, action: () => void) {
    if (Platform.OS === "web") {
        if (window.confirm(`${title}\n${detail}`))
            action();
        return;
    }
    Alert.alert(title, detail, [
        { text: "取消", style: "cancel" },
        { text: "确认", onPress: action },
    ]);
}
export function Pairing({ theme, save, }: {
    theme: Theme;
    save: (host: HostConnection) => Promise<void>;
}) {
    const [link, setLink] = useState(""), [name, setName] = useState("安卓手机"), [camera, setCamera] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
    const [permission, requestCamera] = useCameraPermissions();
    const cancelled = useRef(false), locked = useRef(false), mounted = useRef(true);
    useEffect(() => () => {
        mounted.current = false;
        cancelled.current = true;
    }, []);
    useEffect(() => {
        const offer = (url: string | null) => {
            if (url?.startsWith("grokremote://pair")) {
                try {
                    parsePairingOffer(url);
                    setLink(url);
                }
                catch {
                    setError("配对链接无效");
                }
            }
        };
        void Linking.getInitialURL().then(offer);
        const listener = Linking.addEventListener("url", (event) => offer(event.url));
        return () => listener.remove();
    }, []);
    const address = useMemo(() => {
        try {
            return parsePairingOffer(link).host;
        }
        catch {
            return "";
        }
    }, [link]);
    async function pair(value = link) {
        if (locked.current)
            return;
        locked.current = true;
        cancelled.current = false;
        setBusy(true);
        setError("");
        setCamera(false);
        setLink(value);
        try {
            const offer = parsePairingOffer(value);
            setStatus("正在建立连接…");
            let connection = { ...offer, token: "" };
            let info: {
                protocol: number;
                hostName: string;
            } | undefined;
            const candidates = offer.hosts ?? [offer.host];
            let last: unknown;
            for (let start = 0; start < candidates.length; start += 2) {
                if (cancelled.current)
                    return;
                try {
                    const reachable = await Promise.any(candidates.slice(start, start + 2).map(async (host) => ({ host, info: await api<{
                            protocol: number;
                            hostName: string;
                        }>({ ...connection, host }, "/v1/info") })));
                    connection = { ...connection, host: reachable.host };
                    info = reachable.info;
                    break;
                }
                catch (error) {
                    last = error;
                }
            }
            if (!info)
                throw last ?? Error("没有可连接地址，请让手机与电脑连接同一局域网");
            if (cancelled.current)
                return;
            if (info.protocol !== 1)
                throw Error("协议版本不同，请更新配套版本");
            const pending = await api<{
                requestId: string;
            }>(connection, "/v1/pair", {
                code: offer.code,
                name: name.trim() || "安卓手机",
            });
            setStatus(`请在 ${info.hostName} 的手机连接页面允许配对`);
            for (let i = 0; i < 150 && !cancelled.current; i++) {
                await new Promise((resolve) => setTimeout(resolve, 1500));
                if (cancelled.current)
                    break;
                const result = await api<{
                    status: string;
                    deviceToken?: string;
                    deviceId?: string;
                    hostName: string;
                }>(connection, "/v1/pair/status", {
                    code: offer.code,
                    requestId: pending.requestId,
                });
                if (cancelled.current)
                    break;
                if (result.status === "denied")
                    throw Error("电脑拒绝了配对请求");
                if (result.status === "approved" &&
                    result.deviceToken &&
                    result.deviceId) {
                    await save({
                        host: connection.host,
                        fingerprint: offer.fingerprint,
                        token: result.deviceToken,
                        id: result.deviceId,
                        name: result.hostName,
                    });
                    return;
                }
            }
            if (!cancelled.current)
                throw Error("等待超时，请刷新电脑二维码后重试");
        }
        catch (e) {
            if (mounted.current)
                setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            locked.current = false;
            if (mounted.current) {
                setBusy(false);
                setStatus("");
            }
        }
    }
    return (<SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar style={theme === palettes.dark ? "light" : "dark"}/>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[
            ui.content,
            { paddingTop: 45, maxWidth: 600, alignSelf: "center", width: "100%" },
        ]}>
        <View style={{
            width: 60,
            height: 60,
            borderRadius: 18,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 10,
            backgroundColor: theme.primary,
        }}>
          <Text style={{ color: "#fff", fontSize: 28, fontWeight: "700" }}>
            G
          </Text>
        </View>
        <Text style={[
            ui.heading,
            { color: theme.text, fontSize: 29, lineHeight: 38 },
        ]}>
          在手机继续电脑上的工作
        </Text>
        <Text style={[
            ui.hint,
            { color: theme.muted, fontSize: 16, lineHeight: 26 },
        ]}>
          查看会话、跟进任务、继续对话。模型和项目始终在电脑运行。
        </Text>
        <Card theme={theme}>
          <Text style={[ui.title, { color: theme.text }]}>连接你的电脑</Text>
          <Text style={[ui.hint, { color: theme.muted }]}>
            电脑打开 设置 →
            手机连接，开启后生成二维码。两台设备使用同一局域网或已配置的私人
            VPN。
          </Text>
          {camera ? (<CameraView style={{ height: 280 }} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={({ data }) => void pair(data)}/>) : (<Button title="扫描电脑二维码" primary theme={theme} disabled={busy} onPress={() => {
                void (permission?.granted
                    ? Promise.resolve(permission)
                    : requestCamera()).then((p) => p.granted
                    ? setCamera(true)
                    : setError("相机权限未开启，也可以粘贴完整配对链接"));
            }}/>)}
          {camera ? (<Button title="取消扫码" theme={theme} onPress={() => setCamera(false)}/>) : null}
          <TextInput accessibilityLabel="手机名称" style={[ui.field, { borderColor: theme.border, color: theme.text }]} value={name} onChangeText={setName} placeholder="手机名称" placeholderTextColor={theme.muted} maxLength={64}/>
          <TextInput accessibilityLabel="配对链接" style={[
            ui.field,
            { borderColor: theme.border, color: theme.text, minHeight: 90 },
        ]} value={link} onChangeText={(value) => {
            if (busy)
                cancelled.current = true;
            setLink(value);
        }} placeholder="或粘贴完整配对链接" placeholderTextColor={theme.muted} multiline autoCapitalize="none" autoCorrect={false}/>
          {address ? (<Text selectable style={[ui.hint, { color: theme.muted }]}>
              将连接：{address}
            </Text>) : null}
          <Button title={busy ? "连接中 / 等待电脑确认" : "使用链接连接"} theme={theme} disabled={busy || !link.trim()} onPress={() => void pair()}/>
          {status ? (<Text style={[ui.hint, { color: theme.accent }]}>{status}</Text>) : null}
          {busy ? (<Button title="取消连接" theme={theme} onPress={() => {
                cancelled.current = true;
                setStatus("");
            }}/>) : null}
          {error ? (<Text selectable style={[ui.hint, { color: theme.danger }]}>
              {error}
            </Text>) : null}
        </Card>
        <Text style={[ui.hint, { color: theme.muted }]}>
          电脑需要保持开机、应用保持运行。配对需电脑确认，已配对设备可在电脑撤销。
        </Text>
        <Card theme={theme}><MobileUpdate theme={theme}/></Card>
      </ScrollView>
    </SafeAreaView>);
}
export function NewSession({ client, theme, disabled, close, created, }: {
    client: Client;
    theme: Theme;
    disabled: boolean;
    close: () => void;
    created: (receipt: RemoteReceipt) => void;
}) {
    const [workspace, setWorkspace] = useState(client.options?.workspaces[0]?.id || ""), [profile, setProfile] = useState(""), [configuration, setConfiguration] = useState<Configuration>({});
    const current = client.options?.workspaces.find((w) => w.id === workspace);
    const selectedProfile = current?.profiles.find(p => p.id === profile);
    const base: Configuration = { modelId: selectedProfile?.modelId || client.options?.defaults?.modelId, effort: selectedProfile?.effort || client.options?.defaults?.effort, mode: (selectedProfile?.mode || client.options?.defaults?.mode) as SessionMode | undefined };
    const effective: Configuration = { ...base, ...configuration };
    const ready = useRef(false), draftTouched = useRef(false);
    useEffect(() => { let disposed = false; const key = client.host?.fingerprint + ":new-task:code"; void savedRead<{
        workspace: string;
        profile: string;
        configuration: Configuration;
    }>(key).then(saved => { if (disposed)
        return; if (saved && !draftTouched.current) {
        setWorkspace(saved.workspace);
        setProfile(saved.profile);
        setConfiguration(saved.configuration);
    } ready.current = true; }); return () => { disposed = true; }; }, [client.host?.fingerprint]);
    useEffect(() => { if (!workspace && client.options?.workspaces[0])
        setWorkspace(client.options.workspaces[0].id); }, [client.options?.workspaces]);
    useEffect(() => { if (ready.current && client.host)
        void savedWrite(client.host.fingerprint + ":new-task:code", { workspace, profile, configuration }); }, [workspace, profile, configuration]);
    // One step open at a time: long project lists no longer push the profile, model and
    // create button far below the fold. A step with no choice yet starts open.
    const [step, setStep] = useState<"project" | "profile" | "model" | null>(workspace ? null : "project");
    const [query, setQuery] = useState(""), [showAll, setShowAll] = useState(false);
    useEffect(() => { if (!workspace && client.options?.workspaces.length) setStep("project"); }, [client.options?.workspaces.length]);
    const ordered = useMemo(() => orderWorkspaces(client.options?.workspaces ?? [], client.sessions, query, showAll ? Number.MAX_SAFE_INTEGER : 6), [client.options?.workspaces, client.sessions, query, showAll]);
    const modelName = client.options?.models?.find(m => m.modelId === effective.modelId)?.name || effective.modelId || "电脑默认模型";
    const summary = configSummary(modelName, effective.mode, effective.effort);
    const toggle = (next: "project" | "profile" | "model") => setStep(value => value === next ? null : next);
    const stepRow = (id: "project" | "profile" | "model", label: string, value: string, detail?: string) => <Pressable accessibilityRole="button" accessibilityLabel={`${label}：${value}`} accessibilityState={{ expanded: step === id }} onPress={() => toggle(id)} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 56, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: step === id ? theme.accent : theme.border, backgroundColor: pressed ? theme.raised : "transparent" })}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: theme.muted, fontSize: font.caption, fontWeight: "600" }}>{label}</Text>
          <Text numberOfLines={1} style={{ color: theme.text, fontSize: font.body, fontWeight: "600" }}>{value}</Text>
          {detail ? <Text numberOfLines={1} style={{ color: theme.muted, fontSize: font.caption }}>{detail}</Text> : null}
        </View>
        <Text style={{ color: theme.muted, fontSize: font.small }}>{step === id ? "收起 ⌃" : "更改 ⌄"}</Text>
      </Pressable>;
    const option = (key: string, selected: boolean, title: string, detail: string | undefined, onPress: () => void) => <Pressable key={key} accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => ({ paddingHorizontal: space.md, paddingVertical: space.sm + 2, borderRadius: radius.sm, backgroundColor: selected ? theme.accentSoft : pressed ? theme.raised : "transparent" })}>
        <Text numberOfLines={1} style={{ color: selected ? theme.accent : theme.text, fontSize: font.body, fontWeight: selected ? "700" : "500" }}>{selected ? "● " : "○ "}{title}</Text>
        {detail ? <Text numberOfLines={1} style={{ color: theme.muted, fontSize: font.caption, marginTop: 2, marginLeft: 18 }}>{detail}</Text> : null}
      </Pressable>;
    const canCreate = !disabled && !!workspace && !!client.options?.capabilities.includes("session.create");
    return (<View style={{ gap: space.sm }}>
      {stepRow("project", "项目", current?.name || "选择电脑上的项目", current?.path)}
      {step === "project" ? <View style={{ gap: 2, paddingBottom: space.xs }}>
          {(client.options?.workspaces.length ?? 0) > 6 ? <SearchField theme={theme} accessibilityLabel="搜索项目" value={query} onChangeText={setQuery} placeholder="搜索项目名称或路径" style={{ marginBottom: space.xs }} /> : null}
          {ordered.rows.map(w => option(w.id, workspace === w.id, w.name, w.path, () => { draftTouched.current = true; setWorkspace(w.id); setProfile(""); setStep(null); setQuery(""); }))}
          {ordered.hidden ? <Pressable accessibilityRole="button" onPress={() => setShowAll(true)} style={{ padding: space.md }}><Text style={{ color: theme.accent, fontWeight: "600" }}>显示全部项目（另有 {ordered.hidden} 个）⌄</Text></Pressable> : null}
          {query && !ordered.rows.length ? <Text style={[ui.hint, { color: theme.muted, padding: space.md }]}>没有匹配的项目。</Text> : null}
        </View> : null}
      {current ? stepRow("profile", "执行配置", selectedProfile ? selectedProfile.name : "电脑默认配置", selectedProfile ? `${selectedProfile.mode}${selectedProfile.worktree ? " · 新 Worktree" : ""}` : current.profiles.length ? `另有 ${current.profiles.length} 个已保存配置` : undefined) : null}
      {current && step === "profile" ? <View style={{ gap: 2, paddingBottom: space.xs }}>
          {option("default", !profile, "电脑默认配置", "沿用电脑上的默认模型、强度与模式", () => { draftTouched.current = true; setProfile(""); setStep(null); })}
          {current.profiles.map(p => option(p.id, profile === p.id, p.name, `${p.mode}${p.worktree ? " · 新 Worktree" : ""}`, () => { draftTouched.current = true; setProfile(p.id); setConfiguration({}); setStep(null); }))}
        </View> : null}
      {stepRow("model", "模型与强度", summary.model, summary.detail || undefined)}
      {step === "model" ? <ConfigurationPicker client={client} theme={theme} value={configuration} base={base} onChange={value => { draftTouched.current = true; setConfiguration(value); }}/> : null}
      <Button title={client.busy ? "正在创建…" : "创建会话"} theme={theme} primary disabled={!canCreate} onPress={() => {
            void client
                .perform("create", {
                workspaceId: workspace,
                ...(profile ? { profileId: profile } : {}), ...effective,
            })
                .then((result) => {
                if (result) {
                    created(result);
                    close();
                }
            });
        }}/>
      {!client.options?.workspaces.length ? (<Text style={[ui.hint, { color: theme.muted }]}>
          {client.optionsLoading ? "正在读取项目…" : "电脑尚无可用项目，请先在电脑打开或创建项目。"}
        </Text>) : <Text style={[ui.hint, { color: theme.muted }]}>新建不会切换电脑当前标签。</Text>}
    </View>);
}
export function QueueRow({ entry, theme, disabled, remove, }: {
    entry: PromptQueueEntry;
    theme: Theme;
    disabled: boolean;
    remove: () => void;
}) {
    return (<Card theme={theme} style={{ marginBottom: 10 }}>
      <Text style={[ui.hint, { color: theme.muted }]}>
        队列 {entry.position + 1} ·{" "}
        {entry.state === "queued" ? "等待执行" : "正在提交"}
      </Text>
      <Text selectable style={{ color: theme.text, lineHeight: 23 }}>
        {entry.text}
      </Text>
      {entry.state === "queued" ? (<Button compact title="移出队列" theme={theme} disabled={disabled} onPress={() => confirm("移出这条消息？", "正在执行的任务不受影响，未执行的队列消息会取消。", remove)}/>) : null}
    </Card>);
}
export function Interaction({ event, theme, disabled, submit, }: {
    event: ChatEvent;
    theme: Theme;
    disabled: boolean;
    submit: (action: RemoteCommand["action"], extra: Partial<RemoteCommand>) => void;
}) {
    const [answers, setAnswers] = useState<Record<string, string>>({});
    return (<Card theme={theme} style={{ marginBottom: 12 }}>
      <Text style={[ui.title, { color: theme.text }]}>
        {event.type === "permission"
            ? "操作授权"
            : event.type === "question"
                ? "需要你的回答"
                : "计划确认"}
      </Text>
      {event.type === "permission" ? (<>
          <PermissionDetails raw={event.request.toolCall} theme={theme}/>
          <View style={[ui.row, { flexWrap: "wrap" }]}>
            {event.request.options.map((option) => {
                const send = () => submit("permission", { requestId: event.request.requestId, optionId: option.optionId });
                // Options that widen permissions beyond this one call ask again, so they are never a slip of the thumb.
                const widening = /always|session/i.test(String(option.kind || "")) || /始终|总是|本会话/.test(option.name || "");
                const rejecting = /reject|deny/i.test(String(option.kind || ""));
                return <Button compact key={option.optionId} danger={rejecting} primary={!widening && !rejecting} title={option.name || option.kind || option.optionId} theme={theme} disabled={disabled}
                  onPress={() => widening ? confirm("扩大授权范围？", `「${option.name || option.kind}」之后同类操作将不再逐项询问。只想允许这一次，请选“允许”。`, send) : send()}/>;
            })}
          </View>
        </>) : null}
      {event.type === "plan" ? (<>
          <Markdown value={event.text} theme={theme}/>
          <View style={ui.row}>
            <Button title="批准计划" primary theme={theme} disabled={disabled} onPress={() => submit("plan", {
                requestId: event.requestId,
                verdict: "approved",
            })}/>
            <Button title="拒绝" theme={theme} disabled={disabled} onPress={() => submit("plan", {
                requestId: event.requestId,
                verdict: "rejected",
            })}/>
          </View>
        </>) : null}
      {(event.type === "computer-permission" || event.type === "computer-risk") ? <><Text selectable style={[ui.hint, { color: theme.text }]}>{event.type === "computer-risk" ? `${event.request.appName} · ${event.request.action}\n${event.request.summary}` : `访问应用：${event.request.app.name}`}</Text><View style={ui.row}><Button compact title="允许本次" theme={theme} disabled={disabled} onPress={() => submit("workbench", { mutation: { kind: event.type === "computer-risk" ? "computer.risk" : "computer.permission", target: event.request.requestId, data: event.type === "computer-risk" ? { approved: true } : { decision: "once" } } })}/><Button compact title="拒绝" theme={theme} disabled={disabled} onPress={() => submit("workbench", { mutation: { kind: event.type === "computer-risk" ? "computer.risk" : "computer.permission", target: event.request.requestId, data: event.type === "computer-risk" ? { approved: false } : { decision: "deny" } } })}/></View></> : null}
      {event.type === "question" ? (<>
          {event.questions.map((question, index) => (<View key={index} style={{ gap: 10 }}>
              <Text style={{ color: theme.text, fontSize: 15, lineHeight: 24 }}>
                {question.question}
              </Text>
              <View style={[ui.row, { flexWrap: "wrap" }]}>
                {question.options?.map((option) => (<Button compact key={option.label} title={option.label} theme={theme} primary={answers[question.question] === option.label} onPress={() => setAnswers((current) => ({
                        ...current,
                        [question.question]: option.label,
                    }))}/>))}
              </View>
              <TextInput accessibilityLabel={question.question} placeholder="选择选项或输入回答" placeholderTextColor={theme.muted} value={answers[question.question] || ""} onChangeText={(value) => setAnswers((current) => ({
                    ...current,
                    [question.question]: value,
                }))} style={[
                    ui.field,
                    { color: theme.text, borderColor: theme.border },
                ]}/>
            </View>))}
          <Button title="提交回答" theme={theme} primary disabled={disabled ||
                event.questions.some((q) => !answers[q.question]?.trim())} onPress={() => submit("question", { requestId: event.requestId, answers })}/>
        </>) : null}
    </Card>);
}
