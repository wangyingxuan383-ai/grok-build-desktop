import React, { useEffect, useState, useRef } from "react";
import { ActivityIndicator, FlatList, Image, Modal, Platform, Pressable, ScrollView, Text, TextInput, View, PanResponder } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as FS from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { NativeHtmlPreview } from "./native-preview";
import { Button, Card, ui, type Theme } from "./ui";
import { Markdown } from "./markdown";
import { api, downloadAsset, pdfPages, saveDownload, normalizeImage, cachePin } from "./transport";
import { savedRead, savedWrite, savedDelete } from "./cache";
import { MediaPlayer } from "./media-player";
import { confirm } from "./forms";
import type { GitRepositoryStatus, GitDiffResult } from "../../../src/shared/workbench-types";
import type { useRemote } from "./use-remote";
import type { RemoteCommand } from "../../../src/shared/remote";
import type { ReasoningEffort, SessionMode, ModelInfo } from "../../../src/shared/types";
type Client = ReturnType<typeof useRemote>;
export type Configuration = Pick<RemoteCommand, "modelId" | "providerId" | "effort" | "mode">;
export function ConfigurationPicker({ client, theme, value, onChange, base, modelOnly = false, filter }: {
    client: Client;
    theme: Theme;
    value?: Configuration;
    onChange?: (value: Configuration) => void;
    base?: Configuration;
    modelOnly?: boolean;
    filter?: (model: ModelInfo) => boolean;
}) {
    const [search, setSearch] = useState(""), [favorites, setFavorites] = useState<string[]>([]), [recent, setRecent] = useState<string[]>([]);
    const prefix = client.host?.fingerprint ?? "";
    useEffect(()=>{void client.loadOptions(true).catch(()=>undefined)},[prefix]);
    useEffect(() => { void savedRead<{
        favorites: string[];
        recent: string[];
    }>(prefix + ":models").then(v => { if (v) {
        setFavorites(v.favorites);
        setRecent(v.recent);
    } }); }, [prefix]);
    const runtime = client.snapshot?.runtime, selected = onChange ? { ...client.options?.defaults, ...base, ...value } : runtime ?? {}, models = (runtime?.models.length && !onChange ? runtime.models : client.options?.models ?? []).filter(model => !filter || filter(model));
    const current = models.find(m => m.modelId === selected.modelId && (m.providerId || "") === (selected.providerId || "")), disabled = !onChange && (client.busy || client.connection.phase !== "online" || !runtime?.mutable || client.snapshot?.session.canSend === false);
    const choose = (patch: Configuration) => { if (onChange)
        onChange({ ...value, ...patch });
    else if (runtime)
        void client.perform("configure", { ...patch, revision: runtime.revision }); };
    return <View style={{ gap: 12 }}><Text style={[ui.title, { color: theme.text }]}>模型与执行配置</Text>
  <Text style={[ui.hint, { color: theme.muted }]}>{onChange ? "用于当前表单的任务 / 消息，不修改电脑全局默认。" : runtime?.reason || "空闲时切换，实际生效结果从电脑同步。"}</Text>
  {client.options?.notices?.map(notice=><Text key={notice} style={[ui.hint,{color:theme.danger}]}>{notice}</Text>)}<Text style={[ui.hint, { color: theme.accent }]}>{current?.name || selected.modelId || "电脑默认模型"}{modelOnly ? "" : ` · ${selected.mode || "agent"} · 推理 ${selected.effort || "默认"}`}</Text>
  {client.optionsLoading || client.options?.modelCatalog?.refreshing ? <Text style={[ui.hint, { color: theme.muted }]}>正在刷新实际模型目录…已有选择与草稿保留。</Text> : null}
  {client.options?.modelCatalog?.reason?<Text style={[ui.hint,{color:theme.danger}]}>{client.options.modelCatalog.reason}</Text>:null}
  {!!selected.modelId&&models.length>0&&!current?<Text style={[ui.hint,{color:theme.danger}]}>原选择 {selected.modelId} 当前不可用，请选择目录中的模型。</Text>:null}
  <TextInput accessibilityLabel="搜索模型" placeholder="搜索模型 / Provider" placeholderTextColor={theme.muted} value={search} onChangeText={setSearch} style={[ui.field, { color: theme.text, borderColor: theme.border }]}/>
  {client.optionsError?<Text accessibilityRole="alert" style={[ui.hint,{color:theme.danger}]}>{client.optionsError}。已有选项和草稿保留，可重试刷新。</Text>:null}
  <View style={ui.row}><Button compact title="刷新模型" theme={theme} disabled={client.optionsLoading} onPress={() => void client.loadOptions(true).catch(()=>undefined)}/>{onChange ? <Button compact title="沿用默认" theme={theme} onPress={() => onChange({})}/> : null}</View>
  {!models.length ? <Text style={[ui.hint, { color: theme.muted }]}>尚未取得模型目录。可沿用电脑配置，也可刷新；登录问题需在电脑处理。</Text> : null}
  <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{ maxHeight: 280 }}>{[...models].filter(m => (m.name + " " + m.modelId + " " + (m.providerId || "官方 CLI")).toLowerCase().includes(search.toLowerCase())).sort((a, b) => Number(favorites.includes(b.modelId)) - Number(favorites.includes(a.modelId)) || ((recent.indexOf(a.modelId) + 1) || 999) - ((recent.indexOf(b.modelId) + 1) || 999)).map(model => <View key={(model.providerId||"cli")+":"+model.modelId} style={[ui.row, { borderBottomWidth: 1, borderColor: theme.border, paddingVertical: 8 }]}>
   <Pressable accessibilityRole="button" accessibilityLabel={model.name} disabled={disabled} onPress={() => { choose({ modelId: model.modelId, providerId: model.providerId, ...(onChange ? { effort: "" as ReasoningEffort } : {}) }); const next = [model.modelId, ...recent.filter(id => id !== model.modelId)].slice(0, 12); setRecent(next); void savedWrite(prefix + ":models", { favorites, recent: next }); }} style={{ flex: 1, padding: 8, opacity: disabled ? .45 : 1 }}><Text style={{ color: selected.modelId === model.modelId ? theme.accent : theme.text, fontWeight: "600" }}>{selected.modelId === model.modelId ? "● " : ""}{model.name}</Text><Text style={[ui.hint, { color: theme.muted }]}>{model.providerId ? "已配置 Provider" : "官方 CLI"}{model.acceptsImages === true ? " · 图片输入" : ""}{model.totalContextTokens ? ` · 上下文 ${model.totalContextTokens.toLocaleString()}` : ""}</Text></Pressable>
   <Button compact title={favorites.includes(model.modelId) ? "★" : "☆"} theme={theme} onPress={() => { const next = favorites.includes(model.modelId) ? favorites.filter(id => id !== model.modelId) : [...favorites, model.modelId]; setFavorites(next); void savedWrite(prefix + ":models", { favorites: next, recent }); }}/>
  </View>)}</ScrollView>
  {!modelOnly ? <><Text style={[ui.section, { color: theme.muted }]}>推理强度</Text><View style={[ui.row, { flexWrap: "wrap" }]}>{[{ value: "", label: "默认" }, ...(current?.reasoningEfforts ?? [])].map(e => <Button compact key={e.value} title={(selected.effort === e.value ? "● " : "") + e.label} theme={theme} disabled={disabled || (!onChange && !current?.supportsReasoningEffort)} onPress={() => choose({ effort: e.value as ReasoningEffort })}/>)}</View>
  <Text style={[ui.section, { color: theme.muted }]}>执行模式</Text><View style={[ui.row, { flexWrap: "wrap" }]}>{[["agent", "Agent · 询问"], ["plan", "Plan"], ["auto", "Auto · 自动批准"]].map(([mode, label]) => <Button key={mode} compact title={(selected.mode === mode ? "● " : "") + label} theme={theme} disabled={disabled} onPress={() => choose({ mode: mode as SessionMode })}/>)}</View></> : null}
 </View>;
}
export function ConfigBar({ client, theme, onPress }: {
    client: Client;
    theme: Theme;
    onPress: () => void;
}) { const runtime = client.snapshot?.runtime; const model = (runtime?.models.length ? runtime.models : client.options?.models)?.find(m => m.modelId === runtime?.modelId); return <Pressable accessibilityRole="button" accessibilityLabel="模型与执行配置" onPress={onPress} style={[ui.row, { paddingHorizontal: 16, paddingVertical: 9, borderTopWidth: 1, borderColor: theme.border }]}><Text numberOfLines={1} style={{ color: theme.accent, flex: 1, fontSize: 13 }}>{model?.name || runtime?.modelId || "模型待同步"} ▾</Text><Text style={{ color: theme.muted, fontSize: 12 }}>{({ agent: "询问", auto: "自动", plan: "计划" } as Record<string, string>)[runtime?.mode || ""] || "—"} · 推理 {({ low: "低", medium: "中", high: "高", xhigh: "更高", max: "最高", minimal: "最少", none: "关闭", auto: "自动" } as Record<string, string>)[runtime?.effort || ""] || runtime?.effort || "默认"}</Text></Pressable>; }
interface Picked {
    name: string;
    uri: string;
    size?: number;
    mimeType?: string;
}
export async function uploadPicked(client: Client, picked: Picked, sessionId: string, onProgress: (text: string) => void, cancelled: () => boolean = () => false) {
    if (Platform.OS === "android" && picked.mimeType?.startsWith("image/") && (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(picked.mimeType) || (picked.size ?? 0) > 20 * 1024 * 1024)) {
        picked = await normalizeImage(picked.uri, picked.name);
        onProgress("图片已转换为兼容 JPEG；原件保留。");
    }
    if (!client.host)
        throw Error("请先连接电脑");
    const info = await FS.getInfoAsync(picked.uri);
    const size = picked.size ?? ("size" in info ? info.size : 0);
    if (!size || size > 50 * 1024 * 1024)
        throw Error("请选择不超过 50 MB 的文件");
    const localKey = `${client.host.fingerprint}:transfer:${sessionId}:${picked.uri}:${size}`;
    let upload = await savedRead<{
        id: string;
    }>(localKey);
    if (!upload) {
        upload = await api(client.host, "/v1/uploads", { name: picked.name, size, sessionId, mimeType: picked.mimeType });
        await savedWrite(localKey, upload);
    }
    let state = await api<{
        id: string;
        offset: number;
    }>(client.host, "/v1/uploads", { id: upload!.id });
    while (state.offset < size) {
        if (cancelled()) {
            await api(client.host, "/v1/uploads", { id: upload!.id, cancel: true });
            await savedDelete(localKey);
            throw Error("上传已取消，草稿保持");
        }
        onProgress(`${picked.name} · ${Math.round(state.offset / size * 100)}%`);
        const base64 = await FS.readAsStringAsync(picked.uri, { encoding: FS.EncodingType.Base64, position: state.offset, length: Math.min(256 * 1024, size - state.offset) });
        state = await api(client.host, "/v1/uploads", { id: upload!.id, offset: state.offset, data: base64 });
    }
    return { id: upload!.id, name: picked.name, size };
}
export function AttachmentsPanel({ client, theme, sessionId }: {
    client: Client;
    theme: Theme;
    sessionId?: string;
}) {
    const [progress, setProgress] = useState(""), [busy, setBusy] = useState(false);
    const cancelled = useRef(false);
    const target = sessionId || client.sessionId;
    const add = async (camera = false) => { if (!target || busy)
        return; cancelled.current = false; setBusy(true); try {
        let picked: Picked[] = [], next = client.composer;
        if (camera) {
            const permission = await ImagePicker.requestCameraPermissionsAsync();
            if (!permission.granted)
                throw Error("拍照需要相机许可");
            const result = await ImagePicker.launchCameraAsync({ quality: 1 });
            if (!result.canceled)
                picked = result.assets.map(a => ({ name: a.fileName || "参考图.jpg", uri: a.uri, size: a.fileSize, mimeType: a.mimeType || "image/jpeg" }));
        }
        else {
            const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
            if (!result.canceled)
                picked = result.assets;
        }
        for (const item of picked) {
            if (next.attachmentIds.length >= 12)
                throw Error("每条消息最多 12 个附件");
            const uploaded = await uploadPicked(client, item, target, setProgress, () => cancelled.current);
            next = { ...next, attachmentIds: [...next.attachmentIds, uploaded.id], attachments: [...next.attachments, uploaded] };
            client.setComposer(next, { fingerprint: client.host!.fingerprint, sessionId: target });
        }
        setProgress("");
    }
    catch (e) {
        client.setError(String(e));
    }
    finally {
        setBusy(false);
    } };
    return <View style={{ gap: 10 }}><View style={ui.row}><Button compact title="选择文件 / 图片" theme={theme} disabled={busy || client.connection.phase !== "online"} onPress={() => void add()}/><Button compact title="拍照" theme={theme} disabled={busy || Platform.OS === "web"} onPress={() => void add(true)}/></View>{busy ? <><Text style={[ui.hint, { color: theme.accent }]}>{progress || "准备上传…"}</Text><Button compact title="取消上传" theme={theme} onPress={() => { cancelled.current = true; }}/></> : null}{client.composer.attachments.map(a => <View key={a.id} style={ui.row}><Text style={{ color: theme.text, flex: 1 }}>{a.name} · {Math.ceil(a.size / 1024)} KB</Text><Button compact title="移除" theme={theme} onPress={() => client.setComposer({ ...client.composer, attachmentIds: client.composer.attachmentIds.filter(id => id !== a.id), attachments: client.composer.attachments.filter(v => v.id !== a.id) })}/></View>)}{client.composer.references?.map((reference, index) => <Button compact key={reference.workspaceId + reference.path} title={`移除引用 ${reference.path.split(/[\\\\/]/).at(-1) || reference.path}`} theme={theme} onPress={() => client.setComposer({ ...client.composer, references: client.composer.references?.filter((_, i) => i !== index) })}/>)}<Text style={[ui.hint, { color: theme.muted }]}>材料绑定当前会话。上传可以恢复，发送任务由独立回执确认。</Text></View>;
}
export function QueryPanel({ client, theme, kind, params = {}, onFile, onReference }: {
    client: Client;
    theme: Theme;
    kind: string;
    params?: Record<string, string>;
    onFile?: (path: string, kind: string) => void;
    onReference?: (path: string, kind: "file" | "folder") => void;
}) {
    const [value, setValue] = useState<unknown>(), [error, setError] = useState(""), [loading, setLoading] = useState(true);
    const key = JSON.stringify(params);
    useEffect(() => { let disposed = false; setLoading(true); void client.query(kind, { sessionId: client.sessionId, ...params }).then(value => { if (!disposed) {
        setValue(value);
        setError("");
    } }).catch(e => { if (!disposed)
        setError(String(e)); }).finally(() => { if (!disposed)
        setLoading(false); }); return () => { disposed = true; }; }, [kind, key, client.sessionId]);
    if (loading)
        return <ActivityIndicator color={theme.accent}/>;
    if (error)
        return <Text selectable style={[ui.hint, { color: theme.danger }]}>{error}</Text>;
    if (kind === "files" && Array.isArray(value))
        return <View style={{ gap: 8 }}>{value.map((node: {
            id: string;
            name: string;
            path: string;
            kind: string;
        }) => <View key={node.id} style={ui.row}><View style={{ flex: 1 }}><Button title={(node.kind === "directory" ? "▸ " : "▧ ") + node.name} theme={theme} onPress={() => onFile?.(node.path, node.kind)}/></View>{onReference ? <Button compact title="引用" theme={theme} onPress={() => onReference(node.path, node.kind === "directory" ? "folder" : "file")}/> : null}</View>)}</View>;
    if (kind === "review") {
        const review = value as {diff?:GitDiffResult;status?:GitRepositoryStatus};
        return <View style={{gap:10}}><Text selectable style={[ui.hint,{color:theme.muted}]}>{review.status?.branch?.name || "Git 工作区"} · {review.status?.clean ? "无改动" : `${review.status?.changes?.length ?? 0} 个文件改动`}{"\n"}{review.status?.checkedAt ? "读取于 " + new Date(review.status.checkedAt).toLocaleTimeString() : ""}</Text>{review.status?.changes?.map(change => <Button compact key={change.path} title={`${change.conflict ? "冲突" : change.staged ? "已暂存" : "工作区"} · ${change.path}`} theme={theme} onPress={() => onFile?.(change.path,"file")}/>)}<Button compact title="将检查要求加入对话草稿" theme={theme} onPress={() => {client.setDraft(client.draft + "\n请检查当前代码差异并说明需要修改的地方。\n" + (review.status?.changes?.map(c => c.path).join("\n") || ""));client.setNotice("已加入草稿，发送前可编辑。未批准或提交代码。");}}/><Text selectable style={{ color: theme.text, fontFamily: "monospace", fontSize: 12, lineHeight: 19 }}>{review.diff?.binary ? "二进制文件差异请打开原文件检查。" : review.diff?.patch || "没有此范围的差异"}</Text></View>;
    }
    return <Text selectable style={{ color: theme.text, fontSize: 13, lineHeight: 21 }}>{JSON.stringify(value, null, 2)}</Text>;
}
export interface RemoteAsset {
    ticket: string;
    name: string;
    mimeType: string;
    sessionId: string;
    size: number;
    kind?: string;
    content?: string;
}
export function AssetViewer({ client, theme, asset, close }: {
    client: Client;
    theme: Theme;
    asset: RemoteAsset;
    close: () => void;
}) {
    const [uri, setUri] = useState(""), [progress, setProgress] = useState(""), [error, setError] = useState(""), [pages, setPages] = useState<Array<{
        index: number;
        uri: string;
        width: number;
        height: number;
    }>>([]), [total, setTotal] = useState(0), [pageBusy, setPageBusy] = useState(false), [saving, setSaving] = useState(false), [saved, setSaved] = useState(false);
    const flight = useRef<Promise<string> | undefined>(undefined), saveLock = useRef(false);
    const save = async () => { if(saveLock.current || saved) return; saveLock.current = true; setSaving(true); setError(""); try { const path = await download(); await saveDownload(path, asset.name, asset.mimeType); setSaved(true); setProgress("已保存到系统图片 / 下载目录"); } catch(e) { setError(String(e)); } finally { saveLock.current = false; setSaving(false); } };
    const download = () => { if (flight.current)
        return flight.current; const operation = (async () => { if (uri)
        return uri; if (!FS.cacheDirectory || !client.host)
        throw Error("本机缓存或电脑连接不可用"); const path = FS.cacheDirectory + "grok-download-" + asset.ticket + "-" + asset.name.replace(/[\\/:*?"<>|]/g, "_"); setProgress("正在下载…"); const result = await downloadAsset(client.host, `/v1/preview/${asset.ticket}/file`, path); setUri(result); setProgress(""); return result; })(); flight.current = operation; void operation.catch(() => { flight.current = undefined; setProgress(""); }); return operation; };
    useEffect(() => { if(!uri || Platform.OS !== "android") return; void cachePin(uri,true).catch(() => undefined); return () => {void cachePin(uri,false).catch(() => undefined);}; }, [uri]);
    const morePdf = async () => { if (pageBusy)
        return; setPageBusy(true); try {
        const path = await download();
        const result = await pdfPages(path, pages.length);
        setPages(old => [...old, ...result.pages]);
        setTotal(result.total);
    }
    catch (e) {
        setError(String(e));
    }
    finally {
        setPageBusy(false);
    } };
    useEffect(() => { if (["image/", "audio/", "video/"].some(prefix => asset.mimeType.startsWith(prefix)))
        void download().catch(e => setError(String(e))); if (asset.mimeType === "application/pdf")
        void morePdf(); }, [asset.ticket]);
    return <Modal animationType="slide" onRequestClose={close}><View style={{ flex: 1, backgroundColor: theme.bg, padding: 18, paddingTop: 42, gap: 12 }}><View style={ui.row}><Text numberOfLines={2} style={[ui.title, { color: theme.text, flex: 1 }]}>{asset.name}</Text><Button compact title="返回" theme={theme} onPress={close}/></View>{progress ? <Text style={{ color: theme.accent }}>{progress}</Text> : null}{error ? <Text selectable style={{ color: theme.danger }}>{error}</Text> : null}
 {asset.kind === "html" && client.host ? <NativeHtmlPreview source={{ ...client.host, ticket: asset.ticket }} style={{ flex: 1 }}/> : uri && asset.mimeType.startsWith("image/") ? <ZoomImage uri={uri} theme={theme}/> : asset.mimeType === "application/pdf" ? <ScrollView style={{ flex: 1 }}>{pages.map(page => <View key={page.index} style={{ marginBottom: 15 }}><Text style={[ui.hint, { color: theme.muted }]}>第 {page.index + 1}/{total} 页</Text><Image source={{ uri: page.uri }} resizeMode="contain" style={{ width: "100%", aspectRatio: page.width / page.height, backgroundColor: "white" }}/></View>)}{pages.length < total ? <Button title={pageBusy ? "读取页面…" : "更多页面"} theme={theme} disabled={pageBusy} onPress={() => void morePdf()}/> : null}</ScrollView> : (asset.mimeType.startsWith("video/") || asset.mimeType.startsWith("audio/")) && uri ? <MediaPlayer uri={uri} mimeType={asset.mimeType} theme={theme}/> : <ScrollView style={{ flex: 1 }}>{asset.kind === "office" ? <Text style={[ui.hint, { color: theme.muted }]}>Office 文本提取；下载后可查看原排版。</Text> : null}<Text selectable style={{ color: theme.text, lineHeight: 23 }}>{asset.content || "下载后可用系统应用查看。"}</Text></ScrollView>}
 <View style={[ui.row, { flexWrap: "wrap" }]}><Button compact title={saving ? "正在保存…" : saved ? "已保存到手机" : "保存到手机"} theme={theme} disabled={saving || saved || asset.size > 50 * 1024 * 1024} onPress={() => void save()}/><Button compact title="分享 / 其他应用打开" theme={theme} disabled={asset.size > 50 * 1024 * 1024} onPress={() => void download().then(async (path) => { if (await Sharing.isAvailableAsync())
        await Sharing.shareAsync(path, { mimeType: asset.mimeType });
    else
        throw Error("当前系统不支持分享"); }).catch(e => setError(String(e)))}/></View><Text style={[ui.hint, { color: theme.muted }]}>来源：当前电脑 · {asset.sessionId}。本地副本与电脑原文件分别管理。</Text></View></Modal>;
}
function ZoomImage({ uri, theme }: {
    uri: string;
    theme: Theme;
}) {
    const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
    const current = useRef(transform);
    current.current = transform;
    const initial = useRef({ distance: 0, scale: 1, x: 0, y: 0 });
    const handlers = useRef(PanResponder.create({ onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true, onPanResponderGrant: event => { const touches = event.nativeEvent.touches; initial.current = { ...current.current, distance: touches.length > 1 ? Math.hypot(touches[0]!.pageX - touches[1]!.pageX, touches[0]!.pageY - touches[1]!.pageY) : 0 }; }, onPanResponderMove: (event, gesture) => { const touches = event.nativeEvent.touches; if (touches.length > 1) {
            const distance = Math.hypot(touches[0]!.pageX - touches[1]!.pageX, touches[0]!.pageY - touches[1]!.pageY);
            if (!initial.current.distance)
                initial.current.distance = distance;
            setTransform({ ...current.current, scale: Math.max(1, Math.min(6, initial.current.scale * distance / initial.current.distance)) });
        }
        else if (current.current.scale > 1)
            setTransform({ ...current.current, x: initial.current.x + gesture.dx, y: initial.current.y + gesture.dy }); } })).current;
    return <View style={{ flex: 1, overflow: "hidden" }}><View {...handlers.panHandlers} style={{ flex: 1 }}><Image source={{ uri }} resizeMode="contain" style={{ width: "100%", height: "100%", transform: [{ translateX: transform.x }, { translateY: transform.y }, { scale: transform.scale }] }}/></View><Button compact title="还原缩放" theme={theme} onPress={() => setTransform({ scale: 1, x: 0, y: 0 })}/></View>;
}
