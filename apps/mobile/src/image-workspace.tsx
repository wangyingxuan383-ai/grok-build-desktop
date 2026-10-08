import { GalleryToolbar } from "./GalleryToolbar";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { PhotoTile, PhotoViewer, type Photo } from "./photo-viewer";
import { ActionMenu, useMenuTarget } from "./gestures";
import * as DocumentPicker from "expo-document-picker";
import * as Crypto from "expo-crypto";
import * as FS from "expo-file-system/legacy";
import { Button, Card, Chip, EmptyState, Segmented, space, ui, type Theme } from "./ui";
import { ConfigurationPicker, uploadPicked, type Configuration, type RemoteAsset } from "./workbench";
import { useOverview } from "./task-workspace";
import { savedRead, savedWrite } from "./cache";
import { downloadAsset } from "./transport";
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
    const [uri,setUri]=useState(""),[error,setError]=useState(""),[retry,setRetry]=useState(0);
    useEffect(()=>{
        let disposed=false;setUri("");setError("");
        if(!client.host)return;const host=client.host;
        void(async()=>{
            const thumb=new URL(source);thumb.searchParams.set("variant","thumbnail");
            const identity=await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,host.fingerprint+":"+thumb.href);
            const path=FS.cacheDirectory+"grok-thumb-"+identity+".jpg";
            if(retry)await FS.deleteAsync(path,{idempotent:true});
            const cached=await FS.getInfoAsync(path);
            if(cached.exists&&"size" in cached&&cached.size>0){if(!disposed)setUri(path);return}
            const asset=await client.query<RemoteAsset>("media",{source:thumb.href});
            const result=await downloadAsset(host,`/v1/preview/${asset.ticket}/file`,path);
            if(!disposed)setUri(result);
        })().catch(e=>{if(!disposed)setError(e instanceof Error?e.message:String(e))});
        return()=>{disposed=true};
    },[client.host?.fingerprint,client.host?.host,source,retry]);
    return <View style={{gap:6}}><Pressable onPress={onPress} accessibilityLabel="打开图片产物" style={{height:210,borderRadius:12,overflow:"hidden",backgroundColor:theme.raised,justifyContent:"center",alignItems:"center"}}>{uri?<Image source={{uri}} style={{width:"100%",height:"100%"}} resizeMode="contain" onError={()=>{setUri("");setError("缩略图文件无法显示，请重试读取。")}}/>:error?<Text numberOfLines={3} style={{color:theme.muted,padding:12}}>{error}</Text>:<ActivityIndicator color={theme.accent}/>}</Pressable>{error?<Button compact title="重试缩略图" theme={theme} onPress={()=>setRetry(value=>value+1)}/>:null}</View>;
}
export function ImageWorkspaceScreen({ client, theme, onAsset, initialConversation }: {
    client: Client;
    theme: Theme;
    onAsset: (source: string) => void;
    initialConversation?: string;
}) {
    const overview = useOverview(client), [refreshing, setRefreshing] = useState(false), [selected, setSelected] = useState<string | undefined>(initialConversation), [filter, setFilter] = useState("pictures"), [scope, setScope] = useState<"images" | "code">("images"), [code, setCode] = useState<Array<MediaArtifact & {
        sessionId: string;
    }>>([]);
    useEffect(() => { if (initialConversation)
        setSelected(initialConversation); }, [initialConversation]);
    const [favorites,setFavorites]=useState<string[]>([]),[comparison,setComparison]=useState<string[]>([]);
    const [layout, setLayout] = useState<"grid" | "cards">("grid"), [viewer, setViewer] = useState<{ photos: Photo[]; index: number }>();
    const photoMenu = useMenuTarget<Photo & { conversation: string }>();
    const { width: screen } = useWindowDimensions(), tile = Math.floor((screen - space.lg * 2 + space.xs * 2 - 6) / 3);
    const layoutTouched = useRef(false);
    useEffect(() => { let active = true; void savedRead<"grid" | "cards">("image-layout").then(value => { if (active && value && !layoutTouched.current) setLayout(value); }); return () => { active = false; }; }, []);const favoriteKey=client.host?.fingerprint+":image-favorites";
    useEffect(()=>{let active=true;setFavorites([]);setComparison([]);void savedRead<string[]>(favoriteKey).then(value=>{if(active)setFavorites(value||[]);});return()=>{active=false;};},[favoriteKey]);
    const favorite=(source:string)=>{const next=favorites.includes(source)?favorites.filter(item=>item!==source):[...favorites,source];setFavorites(next);void savedWrite(favoriteKey,next);};
    const images = overview.value?.images?.conversations ?? [], current = images.find(row => row.id === selected), disabled = client.busy || !!client.unknown || client.connection.phase !== "online";
    useEffect(() => {
        let active = true; void client.loadOptions().catch(() => undefined);
        if (scope === "code") void client.query<typeof code>("code-images").then(value => { if (active) setCode(value); }).catch(e => { if (active) client.setError(String(e)); });
        return () => { active = false; };
    }, [scope, client.host?.host]);
    useEffect(() => { if (client.receipt?.action === "workbench" && client.receipt.resultSessionId?.startsWith("image-") && client.receipt.state === "completed") {
        setSelected(client.receipt.resultSessionId);
        void overview.refresh();
    } }, [client.receipt?.operationId, client.receipt?.state]);
    const photos = useMemo<Array<Photo & { conversation: string }>>(() => images.flatMap(row => row.jobs.flatMap(record => record.job.artifacts.filter(a => a.media === "image" && (filter !== "favorites" || favorites.includes(a.source))).map(a => ({ source: a.source, name: a.name, prompt: record.prompt, detail: row.title, conversation: row.id })))), [images, filter, favorites]);
    const openPhoto = (index: number) => { if (index >= 0 && index < photos.length) setViewer({ photos: [...photos], index }); };
    if (current)
        return <ImageConversationView key={current.id} row={current} client={client} theme={theme} back={() => setSelected(undefined)} onAsset={onAsset} refresh={overview.refresh}/>;
    const failedCount = images.reduce((count, row) => count + row.jobs.filter(record => record.job.status === "failed").length, 0);
    return <ScrollView contentContainerStyle={ui.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void overview.refresh().finally(() => setRefreshing(false)); }}/>}><Button title="新建图像会话" primary theme={theme} disabled={disabled} onPress={() => void client.mutate("image.create", "new")}/><Segmented theme={theme} value={scope} onChange={setScope} items={[["images", "图像作品"], ["code", "代码产物"]] as const}/>{scope === "images" ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>{[["pictures", "图片"], ["favorites", favorites.length ? `收藏 ${favorites.length}` : "收藏"], ["conversations", "创作会话"], ["all", "全部记录"], ["failed", failedCount ? `失败 ${failedCount}` : "失败记录"]].map(([id, label]) => <Chip key={id} label={label!} selected={filter === id} theme={theme} onPress={() => setFilter(id!)}/>)}</ScrollView> : null}{scope === "images" && (filter === "pictures" || filter === "favorites") ? <GalleryToolbar count={photos.length} theme={theme} layout={layout} onChange={value => { layoutTouched.current = true; setLayout(value); void savedWrite("image-layout", value); }}/> : null}{overview.error ? <Text style={[ui.hint, { color: theme.muted }]}>{overview.error}</Text> : null}
  {comparison.length ? <Card theme={theme}><Text style={[ui.title,{color:theme.text}]}>作品对照 {comparison.length}/2</Text><Text style={[ui.hint,{color:theme.muted}]}>点击预览原图。这里只比较已生成作品，不产生新请求。</Text>{comparison.map(source=><RemotePicture key={source} source={source} client={client} theme={theme} onPress={()=>onAsset(source)}/>)}<Button compact title="清空对照" theme={theme} onPress={()=>setComparison([])}/></Card> : null}
  {scope === "code" ? code.map(artifact => <Card key={artifact.id} theme={theme}><RemotePicture client={client} theme={theme} source={artifact.source} onPress={() => onAsset(artifact.source)}/><Text style={[ui.hint, { color: theme.muted }]}>{artifact.name || "代码产物"} · {artifact.sessionId}</Text></Card>) : filter === "conversations" ? images.map(row => <Card key={row.id} theme={theme}><Button title={row.title} theme={theme} onPress={() => setSelected(row.id)}/><Text style={[ui.hint, { color: theme.muted }]}>{row.jobs.length} 条创作记录 · {new Date(row.updatedAt).toLocaleString()}</Text><Button compact title="删除会话记录" theme={theme} danger disabled={disabled} onPress={() => confirm("删除图像会话记录？", "电脑原文件保留，可另行选择删除原文件。", () => void client.mutate("image.delete", row.id, { deleteFiles: false }))}/></Card>) : layout === "grid" && (filter === "pictures" || filter === "favorites") ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 3, marginHorizontal: -space.xs }}>{photos.map((photo, i) => <PhotoTile key={photo.source + ":" + i} client={client} source={photo.source} size={tile} favorite={favorites.includes(photo.source)} onPress={() => openPhoto(i)} onLongPress={() => photoMenu.open(photo)}/>)}</View> : images.flatMap(row => row.jobs.filter(record => filter === "failed" ? record.job.status === "failed" : filter === "pictures" ? record.job.artifacts.some(a => a.media === "image") : filter === "favorites" ? record.job.artifacts.some(a=>favorites.includes(a.source)) : true).map(record => <Card key={row.id + record.requestId} theme={theme}><Pressable onPress={() => setSelected(row.id)}><Text style={[ui.title, { color: theme.text }]}>{record.prompt}</Text><Text style={[ui.hint, { color: theme.muted }]}>{row.title} · {record.job.status}</Text></Pressable>{record.job.artifacts.filter(a => a.media === "image" && (filter!=="favorites" || favorites.includes(a.source))).map(artifact => <View key={artifact.id} style={{gap:8}}><RemotePicture client={client} theme={theme} source={artifact.source} onPress={() => openPhoto(photos.findIndex(photo => photo.source === artifact.source))}/><View style={[ui.row,{gap:space.sm}]}><Chip label={favorites.includes(artifact.source)?"★ 已收藏":"☆ 收藏"} selected={favorites.includes(artifact.source)} theme={theme} onPress={()=>favorite(artifact.source)}/><Chip label={comparison.includes(artifact.source)?"移出对照":"加入对照"} selected={comparison.includes(artifact.source)} theme={theme} disabled={comparison.length>=2&&!comparison.includes(artifact.source)} onPress={()=>setComparison(comparison.includes(artifact.source)?comparison.filter(source=>source!==artifact.source):[...comparison,artifact.source])}/></View></View>)}{record.job.error ? <Text style={[ui.hint, { color: theme.danger }]}>{record.job.error}</Text> : null}<View style={[ui.row, { flexWrap: "wrap" }]}><Button compact ghost title="进入创作会话 ›" theme={theme} onPress={() => setSelected(row.id)}/><View style={{ flex: 1 }}/><Button compact ghost title="删除记录" theme={theme} danger disabled={disabled} onPress={() => confirm("删除这条记录？", "保留电脑原文件。运行中的任务需先取消。", () => void client.mutate("image.record.delete", row.id, { jobId: record.job.jobId, deleteFiles: false }))}/></View></Card>))}
  {scope === "images" && filter === "favorites" && !photos.length ? <EmptyState theme={theme} title="还没有收藏图片" hint="长按图片或在全屏查看时点收藏。"/> : null}
  {!images.length && scope === "images" ? <EmptyState theme={theme} title={overview.loading ? "正在读取作品…" : "开始一次图像创作"} hint="无需选择代码项目。默认通过电脑 CLI 生成，作品保存到电脑配置的图片目录。"/> : null}{scope === "code" && !code.length ? <EmptyState theme={theme} title="没有代码会话产物" hint="编程会话中生成的图片会出现在这里。"/> : null}
  {viewer ? <PhotoViewer client={client} photos={viewer.photos} index={viewer.index} onClose={() => setViewer(undefined)} favorites={favorites} onFavorite={favorite} onNotice={text => client.setNotice(text)}/> : null}
  <ActionMenu visible={Boolean(photoMenu.target)} theme={theme} title={photoMenu.target?.prompt || "图片"} subtitle={photoMenu.target?.detail} onClose={photoMenu.close} items={photoMenu.target ? [
      { label: "全屏查看", onPress: () => openPhoto(photos.findIndex(p => p.source === photoMenu.target!.source)) },
      { label: favorites.includes(photoMenu.target.source) ? "取消收藏" : "收藏", onPress: () => favorite(photoMenu.target!.source) },
      { label: comparison.includes(photoMenu.target.source) ? "移出对照" : "加入对照", disabled: comparison.length >= 2 && !comparison.includes(photoMenu.target.source), onPress: () => { const source = photoMenu.target!.source; setComparison(comparison.includes(source) ? comparison.filter(item => item !== source) : [...comparison, source]); } },
      { label: "进入创作会话", detail: "继续修改或基于这张图再创作", onPress: () => setSelected(photoMenu.target!.conversation) },
      { label: "原图详情 / 保存 / 分享", onPress: () => onAsset(photoMenu.target!.source) },
  ] : []}/>
 </ScrollView>;
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
