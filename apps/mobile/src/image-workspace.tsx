import { GalleryToolbar } from "./GalleryToolbar";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { FlashList } from "@shopify/flash-list";
import { cachedFile, invalidateCached, useThumbnail } from "./media-cache";
import { haptic } from "./haptics";
import { useBackLayer } from "./back-layers";
import { applyToggles, galleryPhotos, galleryRecords, tileSize, toggleSelection, type GalleryFilter, type GalleryPhoto, type GalleryView } from "./gallery-model";
import { PhotoTile, PhotoViewer, type Photo } from "./photo-viewer";
import { ActionMenu, useMenuTarget } from "./gestures";
import * as DocumentPicker from "expo-document-picker";
import { Button, Card, Chip, EmptyState, Segmented, space, ui, type Theme } from "./ui";
import { ConfigurationPicker, uploadPicked, type Configuration, type RemoteAsset } from "./workbench";
import { useOverview } from "./task-workspace";
import { savedRead, savedWrite } from "./cache";
import { saveDownload } from "./transport";
import { confirm } from "./forms";
import type { useRemote } from "./use-remote";
import type { ImageConversation, ImageComposerDraft } from "../../../src/shared/image-workspace";
import type { MediaArtifact, MediaAspectRatio } from "../../../src/shared/types";
type Client = ReturnType<typeof useRemote>;
export function RemotePicture({ client, source, theme, onPress }: {
    client: Client;
    source: string;
    theme: Theme;
    onPress?: () => void;
}) {
    const [retry, setRetry] = useState(0), [broken, setBroken] = useState(false);
    useEffect(() => { setRetry(0); setBroken(false); }, [source]);
    const { uri, error } = useThumbnail(client, source, retry);
    return <View style={{ gap: 6 }}><Pressable onPress={onPress} accessibilityLabel="打开图片产物" style={{ height: 210, borderRadius: 12, overflow: "hidden", backgroundColor: theme.raised, justifyContent: "center", alignItems: "center" }}>
      {uri && !broken ? <Image source={{ uri }} style={{ width: "100%", height: "100%" }} contentFit="contain" recyclingKey={source} onError={() => { setBroken(true); void invalidateCached(uri); }} />
        : error || broken ? <Text style={{ color: theme.muted, padding: 12, textAlign: "center" }}>{error || "图片无法显示，请重试"}</Text> : <ActivityIndicator color={theme.accent} />}
    </Pressable>{error || broken ? <Button compact title="重试缩略图" theme={theme} onPress={() => { setBroken(false); setRetry(v => v + 1); }} /> : null}</View>;
}

type GalleryItem = { kind: "photo"; photo: GalleryPhoto; index: number } | { kind: "record"; key: string; row: ImageConversation; record: ImageConversation["jobs"][number] } | { kind: "conversation"; row: ImageConversation } | { kind: "code"; artifact: MediaArtifact & { sessionId: string } };

export function ImageWorkspaceScreen({ client, theme, onAsset, initialConversation }: {
    client: Client;
    theme: Theme;
    onAsset: (source: string) => void;
    initialConversation?: string;
}) {
    const overview = useOverview(client), [refreshing, setRefreshing] = useState(false), [selected, setSelected] = useState<string | undefined>(initialConversation), [filter, setFilter] = useState<GalleryFilter>("pictures"), [scope, setScope] = useState<"images" | "code">("images"), [code, setCode] = useState<Array<MediaArtifact & { sessionId: string }>>([]);
    useEffect(() => { if (initialConversation) setSelected(initialConversation); }, [initialConversation]);
    const [favorites, setFavorites] = useState<string[]>([]), [comparison, setComparison] = useState<string[]>([]);
    const [view, setView] = useState<GalleryView>({ layout: "grid", sort: "newest", columns: 3 }), [viewer, setViewer] = useState<{ photos: Photo[]; index: number }>();
    const [selection, setSelection] = useState<string[] | undefined>(), [busy, setBusy] = useState("");
    const photoMenu = useMenuTarget<GalleryPhoto>();
    const { width: screen } = useWindowDimensions(), tile = tileSize(screen, view.columns, space.lg, 3);
    const viewTouched = useRef(false);
    useEffect(() => { let active = true; void savedRead<GalleryView | "grid" | "cards">("image-layout").then(value => { if (!active || !value || viewTouched.current) return; setView(typeof value === "string" ? { layout: value, sort: "newest", columns: 3 } : { layout: value.layout || "grid", sort: value.sort || "newest", columns: [3, 4, 5].includes(value.columns) ? value.columns : 3 }); }); return () => { active = false; }; }, []);
    const changeView = (patch: Partial<GalleryView>) => { viewTouched.current = true; setView(previous => { const next = { ...previous, ...patch }; void savedWrite("image-layout", next); return next; }); };
    const favoriteKey = client.host?.fingerprint + ":image-favorites";
    // Favorites restore once per computer; changes made before it lands are merged, never overwritten.
    const favoriteOps = useRef<Array<{ source: string; add: boolean }> | undefined>([]);
    useEffect(() => { let active = true; setFavorites([]); setComparison([]); favoriteOps.current = []; void savedRead<string[]>(favoriteKey).then(value => { if (!active) return; const ops = favoriteOps.current || []; favoriteOps.current = undefined; const merged=applyToggles(value || [], ops); setFavorites(merged); if(ops.length) void savedWrite(favoriteKey,merged); }).catch(() => { if(active) { favoriteOps.current=undefined; client.setError("收藏恢复失败，请重试打开作品页"); } }); return () => { active = false; }; }, [favoriteKey]);
    const setFavorite = (source: string, add: boolean) => {
        favoriteOps.current?.push({ source, add });
        setFavorites(previous => { const next = add ? (previous.includes(source) ? previous : [...previous, source]) : previous.filter(item => item !== source); if (!favoriteOps.current) void savedWrite(favoriteKey, next); return next; });
    };
    const favorite = (source: string) => setFavorite(source, !favorites.includes(source));
    const images = overview.value?.images?.conversations ?? [], current = images.find(row => row.id === selected), disabled = client.busy || !!client.unknown || client.connection.phase !== "online";
    useEffect(() => {
        let active = true; void client.loadOptions().catch(() => undefined);
        if (scope === "code") void client.query<typeof code>("code-images").then(value => { if (active) setCode(value); }).catch(e => { if (active) client.setError(String(e)); });
        return () => { active = false; };
    }, [scope, client.host?.fingerprint]);
    useEffect(() => { if (client.receipt?.action === "workbench" && client.receipt.resultSessionId?.startsWith("image-") && client.receipt.state === "completed") {
        setSelected(client.receipt.resultSessionId);
        void overview.refresh();
    } }, [client.receipt?.operationId, client.receipt?.state]);
    const showsPhotos = scope === "images" && (filter === "pictures" || filter === "favorites");
    const photos = useMemo(() => galleryPhotos(images, { filter, favorites, sort: view.sort }), [images, filter, favorites, view.sort]);
    const openPhoto = (source: string) => { const index = photos.findIndex(photo => photo.source === source); if (index >= 0) setViewer({ photos: [...photos], index }); };
    useEffect(() => { if (!showsPhotos || view.layout !== "grid") setSelection(undefined); }, [showsPhotos, view.layout]);
    useBackLayer(Boolean(selection), () => { setSelection(undefined); });
    const failedCount = images.reduce((count, row) => count + row.jobs.filter(record => record.job.status === "failed").length, 0);
    const items = useMemo<GalleryItem[]>(() => scope === "code" ? code.map(artifact => ({ kind: "code" as const, artifact }))
        : filter === "conversations" ? images.map(row => ({ kind: "conversation" as const, row }))
            : showsPhotos && view.layout === "grid" ? photos.map((photo, index) => ({ kind: "photo" as const, photo, index }))
                : galleryRecords(images, filter, favorites, view.sort).map(({ row, record }) => ({ kind: "record" as const, key: row.id + record.requestId, row: row as ImageConversation, record: record as ImageConversation["jobs"][number] })),
        [scope, code, filter, images, showsPhotos, view.layout, photos, favorites, view.sort]);
    const grid = showsPhotos && view.layout === "grid" && scope === "images";
    const bulk = async (label: string, action: (source: string) => Promise<unknown>) => {
        if (!selection?.length || busy) return; setBusy(label);
        let failed = 0;
        for (const source of selection) { try { await action(source); } catch { failed++; } }
        setBusy(""); haptic(failed ? "error" : "success");
        client.setNotice(failed ? `${selection.length - failed} 张完成，${failed} 张失败（可在传输中心重试）` : `已处理 ${selection.length} 张`);
        setSelection(undefined);
    };
    if (current)
        return <ImageConversationView key={current.id} row={current} client={client} theme={theme} back={() => setSelected(undefined)} onAsset={onAsset} refresh={overview.refresh} />;
    const header = <View style={{ gap: space.md, paddingBottom: space.sm }}>
      <Segmented theme={theme} value={scope} onChange={setScope} items={[["images", "图像作品"], ["code", "代码产物"]] as const} />
      {scope === "images" ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>{([["pictures", "图片"], ["favorites", favorites.length ? `收藏 ${favorites.length}` : "收藏"], ["conversations", "创作会话"], ["all", "全部记录"], ["failed", failedCount ? `失败 ${failedCount}` : "失败记录"]] as const).map(([id, label]) => <Chip key={id} label={label} selected={filter === id} theme={theme} onPress={() => setFilter(id)} />)}</ScrollView> : null}
      {showsPhotos ? <GalleryToolbar count={photos.length} theme={theme} view={view} onChange={changeView} selecting={Boolean(selection)} onSelect={() => { haptic("selection"); setSelection(selection ? undefined : []); }} /> : null}
      {selection ? <View style={[ui.row, { gap: space.sm, flexWrap: "wrap", padding: space.sm, borderRadius: 12, backgroundColor: theme.accentSoft }]}>
          <Text style={{ color: theme.text, fontWeight: "600", flexGrow: 1 }}>{busy || `已选 ${selection.length} 张`}</Text>
          <Chip label="全选" theme={theme} onPress={() => setSelection(photos.map(photo => photo.source))} />
          <Chip label="收藏" theme={theme} disabled={!selection.length || Boolean(busy)} onPress={() => { for (const source of selection) setFavorite(source, true); haptic("success"); client.setNotice(`已收藏 ${selection.length} 张`); setSelection(undefined); }} />
          <Chip label="保存" theme={theme} disabled={!selection.length || Boolean(busy)} onPress={() => void bulk("正在保存…", async source => { const file = await cachedFile(client, source, "original"); await saveDownload(file.uri, file.asset?.name || "grok-image.png", file.asset?.mimeType || "image/png"); })} />
          <Chip label="对照" theme={theme} disabled={selection.length !== 2} onPress={() => { setComparison(selection.slice(0, 2)); setSelection(undefined); }} />
        </View> : null}
      {overview.error ? <Text style={[ui.hint, { color: theme.muted }]}>{overview.error}</Text> : null}
      {comparison.length ? <Card theme={theme}><Text style={[ui.title, { color: theme.text }]}>作品对照 {comparison.length}/2</Text><Text style={[ui.hint, { color: theme.muted }]}>点击预览原图。这里只比较已生成作品，不产生新请求。</Text>{comparison.map(source => <RemotePicture key={source} source={source} client={client} theme={theme} onPress={() => onAsset(source)} />)}<Button compact title="清空对照" theme={theme} onPress={() => setComparison([])} /></Card> : null}
    </View>;
    const empty = scope === "code" ? <EmptyState theme={theme} title="没有代码会话产物" hint="编程会话中生成的图片会出现在这里。" />
        : !images.length ? <EmptyState theme={theme} title={overview.loading ? "正在读取作品…" : "开始一次图像创作"} hint="无需选择代码项目。默认通过电脑 CLI 生成，作品保存到电脑配置的图片目录。" action={overview.loading ? undefined : <Button title="新建图像会话" primary theme={theme} disabled={disabled} onPress={() => void client.mutate("image.create", "new")} />} />
            : filter === "favorites" ? <EmptyState theme={theme} title="还没有收藏图片" hint="长按图片或在全屏查看时点收藏。" /> : <EmptyState theme={theme} title="这里没有内容" />;
    const renderItem = ({ item }: { item: GalleryItem }) => {
        if (item.kind === "photo") return <View style={{ padding: 1.5 }}><PhotoTile client={client} source={item.photo.source} size={tile} favorite={favorites.includes(item.photo.source)} selected={selection ? selection.includes(item.photo.source) : undefined}
          onPress={() => { if (selection) { haptic("selection"); setSelection(toggleSelection(selection, item.photo.source)); } else openPhoto(item.photo.source); }}
          onLongPress={() => { haptic("longPress"); if (selection) setSelection(toggleSelection(selection, item.photo.source)); else photoMenu.open(item.photo); }} /></View>;
        if (item.kind === "code") return <Card theme={theme} style={{ marginBottom: space.md }}><RemotePicture client={client} theme={theme} source={item.artifact.source} onPress={() => onAsset(item.artifact.source)} /><Text style={[ui.hint, { color: theme.muted }]}>{item.artifact.name || "代码产物"} · {item.artifact.sessionId}</Text></Card>;
        if (item.kind === "conversation") return <Card theme={theme} style={{ marginBottom: space.md }}><Button title={item.row.title} theme={theme} onPress={() => setSelected(item.row.id)} /><Text style={[ui.hint, { color: theme.muted }]}>{item.row.jobs.length} 条创作记录 · {new Date(item.row.updatedAt).toLocaleString()}</Text><Button compact title="删除会话记录" theme={theme} danger disabled={disabled} onPress={() => confirm("删除图像会话记录？", "电脑原文件保留，可另行选择删除原文件。", () => void client.mutate("image.delete", item.row.id, { deleteFiles: false }))} /></Card>;
        const { row, record } = item;
        return <Card theme={theme} style={{ marginBottom: space.md }}><Pressable onPress={() => setSelected(row.id)}><Text style={[ui.title, { color: theme.text }]}>{record.prompt}</Text><Text style={[ui.hint, { color: theme.muted }]}>{row.title} · {record.job.status}</Text></Pressable>
          {record.job.artifacts.filter(a => a.media === "image" && (filter !== "favorites" || favorites.includes(a.source))).map(artifact => <View key={artifact.id} style={{ gap: 8 }}><RemotePicture client={client} theme={theme} source={artifact.source} onPress={() => openPhoto(artifact.source)} /><View style={[ui.row, { gap: space.sm }]}><Chip label={favorites.includes(artifact.source) ? "★ 已收藏" : "☆ 收藏"} selected={favorites.includes(artifact.source)} theme={theme} onPress={() => favorite(artifact.source)} /><Chip label={comparison.includes(artifact.source) ? "移出对照" : "加入对照"} selected={comparison.includes(artifact.source)} theme={theme} disabled={comparison.length >= 2 && !comparison.includes(artifact.source)} onPress={() => setComparison(comparison.includes(artifact.source) ? comparison.filter(source => source !== artifact.source) : [...comparison, artifact.source])} /></View></View>)}
          {record.job.error ? <Text style={[ui.hint, { color: theme.danger }]}>{record.job.error}</Text> : null}
          <View style={[ui.row, { flexWrap: "wrap" }]}><Button compact ghost title="进入创作会话 ›" theme={theme} onPress={() => setSelected(row.id)} /><View style={{ flex: 1 }} /><Button compact ghost title="删除记录" theme={theme} danger disabled={disabled} onPress={() => confirm("删除这条记录？", "保留电脑原文件。运行中的任务需先取消。", () => void client.mutate("image.record.delete", row.id, { jobId: record.job.jobId, deleteFiles: false }))} /></View></Card>;
    };
    return <View style={{ flex: 1 }}>
      <FlashList key={grid ? "grid-" + view.columns : "list"} data={items} numColumns={grid ? view.columns : 1} renderItem={renderItem}
        keyExtractor={item => item.kind === "photo" ? "p:" + item.photo.source : item.kind === "record" ? "r:" + item.key : item.kind === "conversation" ? "c:" + item.row.id : "a:" + item.artifact.id}
        getItemType={item => item.kind} ListHeaderComponent={header} ListEmptyComponent={empty} drawDistance={grid ? tile * 2 : 600}
        contentContainerStyle={{ paddingHorizontal: grid ? space.lg - 1.5 : space.lg, paddingTop: space.lg, paddingBottom: space.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void overview.refresh().finally(() => setRefreshing(false)); }} />} />
      {viewer ? <PhotoViewer client={client} photos={viewer.photos} index={viewer.index} onClose={() => setViewer(undefined)} favorites={favorites} onFavorite={favorite} onNotice={text => client.setNotice(text)}
        onReuse={photo => { const target = photos.find(p => p.source === photo.source); setViewer(undefined); if (target) { void savedWrite(client.host!.fingerprint + ":image-reuse", photo.source); setSelected(target.conversation); } }} /> : null}
      <ActionMenu visible={Boolean(photoMenu.target)} theme={theme} title={photoMenu.target?.prompt || "图片"} subtitle={photoMenu.target?.detail} onClose={photoMenu.close} items={photoMenu.target ? [
          { label: "全屏查看", onPress: () => openPhoto(photoMenu.target!.source) },
          { label: favorites.includes(photoMenu.target.source) ? "取消收藏" : "收藏", onPress: () => favorite(photoMenu.target!.source) },
          { label: "多选", detail: "批量收藏、保存或对照", onPress: () => setSelection([photoMenu.target!.source]) },
          { label: comparison.includes(photoMenu.target.source) ? "移出对照" : "加入对照", disabled: comparison.length >= 2 && !comparison.includes(photoMenu.target.source), onPress: () => { const source = photoMenu.target!.source; setComparison(comparison.includes(source) ? comparison.filter(item => item !== source) : [...comparison, source]); } },
          { label: "进入创作会话", detail: "继续修改或基于这张图再创作", onPress: () => setSelected(photoMenu.target!.conversation) },
          { label: "原图详情 / 保存 / 分享", onPress: () => onAsset(photoMenu.target!.source) },
      ] : []} />
    </View>;
}
function ImageConversationView({ row, client, theme, back, onAsset, refresh }: {
    row: ImageConversation;
    client: Client;
    theme: Theme;
    back: () => void;
    onAsset: (source: string) => void;
    refresh: () => Promise<void>;
}) {
    const [draft, setDraft] = useState(""), [ratio, setRatio] = useState<MediaAspectRatio>("1:1"), [config, setConfig] = useState<Configuration>({}), [route, setRoute] = useState<"cli" | "provider">("cli"), [attachments, setAttachments] = useState<Array<{
        id: string;
        name: string;
        size: number;
    }>>([]), [sources, setSources] = useState<string[]>([]), [title, setTitle] = useState(row.title), [showConfig, setShowConfig] = useState(false), [busy, setBusy] = useState(false), [progress, setProgress] = useState("");
    const key = client.host!.fingerprint + ":image-draft:" + row.id, hydrated = useRef(false), touched=useRef(false), latest = useRef({ draft, ratio, config, route, attachments, sources });
    latest.current = { draft, ratio, config, route, attachments, sources };
    useEffect(() => { let disposed = false; void savedRead<typeof latest.current>(key).then(value => { if (!disposed && value && !touched.current) {
        setDraft(value.draft);
        setRatio(value.ratio);
        setConfig(value.config);
        setRoute(value.route);
        setAttachments(value.attachments);
        setSources(value.sources);
    } hydrated.current = true; }); return () => { disposed = true; if (hydrated.current)
        void savedWrite(key, latest.current); }; }, [key]);
    useEffect(() => { if (!hydrated.current)
        return; const timer = setTimeout(() => void savedWrite(key, latest.current), 250); return () => clearTimeout(timer); }, [draft, ratio, config, route, attachments, sources]);
    // Android back returns to the gallery (not the conversation home), keeping the draft.
    useBackLayer(true, () => { void savedWrite(key, latest.current); back(); });
    // "Use as reference" from the full-screen viewer hands the picture over through storage.
    useEffect(() => { const reuseKey = client.host!.fingerprint + ":image-reuse"; let active = true; void savedRead<string>(reuseKey).then(source => { if (!active || !source) return; void savedWrite(reuseKey, ""); touched.current = true; setSources(previous => [...new Set([...previous, source])]); setDraft(previous => previous || "修改这张图片："); }); return () => { active = false; }; }, []);
    const [pendingOperation,setPendingOperation]=useState<string>();
    useEffect(()=>{if(!pendingOperation||client.receipt?.operationId!==pendingOperation)return;const state=client.receipt.state;if(state==="failed"||state==="cancelled"){setBusy(false);return;}if(state==="completed"){let active=true;void refresh().finally(()=>{if(active)setBusy(false);});return()=>{active=false;};}},[pendingOperation,client.receipt?.state]);
    const disabled = client.busy || !!client.unknown || client.connection.phase !== "online" || busy;
    const generating=row.jobs.some(record=>["queued","running","cancelling"].includes(record.job.status));
    const add = async () => {touched.current=true; setBusy(true); try {
        const picked = await DocumentPicker.getDocumentAsync({ type: "image/*", multiple: true, copyToCacheDirectory: true });
        let next = [...attachments];
        if (!picked.canceled)
            for (const item of picked.assets) {
                next.push(await uploadPicked(client, item, row.id, setProgress));
                setAttachments([...next]);
            }
    }
    catch (e) {
        client.setError(String(e));
    }
    finally {
        setBusy(false);
        setProgress("");
    } };
    const selectedModel=config.modelId||row.execution?.modelId||client.options?.defaults?.modelId;
    const invalidModel=route==="cli"&&!client.options?.models?.some(model=>model.modelId===selectedModel);
    useEffect(()=>{if(invalidModel&&client.options?.models?.length)setShowConfig(true)},[invalidModel,client.options?.models]);
    const send = async () => {
      if(invalidModel){setShowConfig(true);client.setError("请先选择当前可用的调度模型。");return}
      setBusy(true);let accepted=false;
      try{await savedWrite(key, latest.current);const receipt=await client.mutate("image.submit",row.id,{request:{kind:"image",prompt:draft,aspectRatio:ratio,route,modelId:selectedModel,providerId:config.providerId},attachmentIds:attachments.map(a=>a.id),referenceSources:sources});if(receipt){accepted=true;setPendingOperation(receipt.operationId);client.setNotice("电脑已接收生成请求，结果在当前图像会话同步。")}}
      catch(error){client.setError(error instanceof Error?error.message:String(error))}
      finally{if(!accepted)setBusy(false)}
    };
    return <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled"><Button compact title="返回图库" theme={theme} onPress={() => { void savedWrite(key, latest.current); back(); }}/><View style={ui.row}><TextInput accessibilityLabel="图像会话名称" value={title} onChangeText={setTitle} style={[ui.field, { flex: 1, color: theme.text, borderColor: theme.border }]}/><Button compact title="改名" theme={theme} disabled={disabled} onPress={() => void client.mutate("image.rename", row.id, { title })}/></View>
  {row.jobs.map(record => <Card key={record.requestId} theme={theme}><Text selectable style={{ color: theme.text, lineHeight: 23 }}>{record.prompt}</Text><Text style={[ui.hint, { color: record.job.error ? theme.danger : theme.muted }]}>{record.job.status} · {record.job.message || ""}{record.job.error ? "\n" + record.job.error : ""}</Text>{record.job.artifacts.filter(a => a.media === "image").map(artifact => <View key={artifact.id} style={{ gap: 8 }}><RemotePicture client={client} source={artifact.source} theme={theme} onPress={() => onAsset(artifact.source)}/><Button compact title="作为参考继续修改" theme={theme} onPress={() => {touched.current=true; setSources([...new Set([...sources, artifact.source])]); setDraft("修改这张图片："); }}/></View>)}<View style={[ui.row, { flexWrap: "wrap" }]}><Button compact title="复用这次描述和参数" theme={theme} onPress={() => {touched.current=true; setDraft(record.prompt); setRatio((record.request?.aspectRatio as MediaAspectRatio) || "1:1"); if (record.request)
        setConfig({ modelId: record.request.modelId, providerId: record.request.providerId }); setRoute(record.request?.route === "provider" ? "provider" : "cli"); }}/>{!["completed", "failed", "cancelled"].includes(record.job.status) ? <Button compact title="取消生成" theme={theme} disabled={disabled} onPress={() => void client.mutate("image.cancel", record.job.jobId)}/> : null}<Button compact title="删除记录" theme={theme} danger disabled={disabled} onPress={() => confirm("删除记录？", "保留电脑原文件。", () => void client.mutate("image.record.delete", row.id, { jobId: record.job.jobId, deleteFiles: false }))}/><Button compact title="连同原文件删除" theme={theme} danger disabled={disabled} onPress={() => confirm("删除记录与所属原文件？", "其他记录引用的文件与无法证明归属的文件由原服务保留。", () => void client.mutate("image.record.delete", row.id, { jobId: record.job.jobId, deleteFiles: true }))}/></View></Card>)}
  <Card theme={theme}><Button compact title={`${config.modelId || client.options?.defaults?.modelId || "电脑默认模型"} · ${route === "cli" ? "CLI" : "Provider"} ▾`} theme={theme} onPress={() => setShowConfig(!showConfig)}/>{showConfig ? <><ConfigurationPicker client={client} theme={theme} value={config} onChange={value=>{touched.current=true;setConfig(value);}} modelOnly filter={model => route === "cli" || !!client.options?.imageModels?.some(m => m.image && m.modelId === model.modelId)}/><View style={ui.row}><Button compact title="CLI 路由" primary={route === "cli"} theme={theme} onPress={() => { touched.current = true; setRoute("cli"); }}/><Button compact title="直接 Provider 路由" primary={route === "provider"} theme={theme} onPress={() => { touched.current = true; setRoute("provider"); }}/></View><Text style={[ui.hint, { color: theme.muted }]}>路由由你明确选择，不会自动切到另一服务。CLI 参考图和各模型能力以电脑实际合同为准。</Text></> : null}
  <TextInput accessibilityLabel="图像描述" multiline placeholder="描述图片，或继续修改已有结果" placeholderTextColor={theme.muted} value={draft} onChangeText={value => { latest.current = { ...latest.current, draft: value }; setDraft(value); }} style={[ui.field, { minHeight: 130, color: theme.text, borderColor: theme.border }]}/><View style={[ui.row, { flexWrap: "wrap" }]}>{["1:1", "16:9", "9:16", "4:3", "3:4", "auto"].map(value => <Button compact key={value} title={value} primary={ratio === value} theme={theme} onPress={() => {touched.current=true;setRatio(value as MediaAspectRatio);}}/>)}</View><Button compact title="添加参考图" theme={theme} disabled={disabled} onPress={() => void add()}/>{progress ? <Text style={{ color: theme.accent }}>{progress}</Text> : null}{attachments.map(a => <Button compact key={a.id} title={`移除 ${a.name}`} theme={theme} onPress={() => { touched.current = true; setAttachments(attachments.filter(v => v.id !== a.id)); }}/>)}{sources.map((source, index) => <Button compact key={source} title={`移除作品引用 ${index + 1}`} theme={theme} onPress={() => { touched.current = true; setSources(sources.filter(v => v !== source)); }}/>)}{route === "provider" ? <Text style={[ui.hint, { color: theme.muted }]}>直接 Provider 需选择已声明生图能力的模型。参考图编辑目前使用 CLI 路由。</Text> : null}<Button title="生成 / 继续修改" primary theme={theme} disabled={disabled || generating || !draft.trim() || (route === "provider" && (!config.providerId || attachments.length > 0 || sources.length > 0 || !client.options?.imageModels?.some(m => m.image && m.modelId === config.modelId))) || ["accepted", "queued", "running"].includes(client.receipt?.state || "")} onPress={() => void send().catch(e => {setBusy(false);client.setError(String(e));})}/></Card>
 </ScrollView>;
}
