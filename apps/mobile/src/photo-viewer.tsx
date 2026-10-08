import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, FlatList, Image, Modal, PanResponder, Pressable, StatusBar, Text, View, useWindowDimensions } from "react-native";
import * as Crypto from "expo-crypto";
import * as FS from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { cachePin, downloadAsset, saveDownload } from "./transport";
import { font, radius, space } from "./ui";
import type { RemoteAsset } from "./workbench";
import type { useRemote } from "./use-remote";
type Client = ReturnType<typeof useRemote>;

async function cachedFile(client: Client, source: string, variant: "thumbnail" | "original", retry = false): Promise<{ uri: string; asset?: RemoteAsset }> {
    const host = client.host;
    if (!host || !FS.cacheDirectory) throw Error("本机缓存或电脑连接不可用");
    const target = new URL(source);
    if (variant === "thumbnail") target.searchParams.set("variant", "thumbnail");
    const identity = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, host.fingerprint + ":" + target.href);
    const path = FS.cacheDirectory + (variant === "thumbnail" ? "grok-thumb-" : "grok-full-") + identity + (variant === "thumbnail" ? ".jpg" : "");
    if (retry) await FS.deleteAsync(path, { idempotent: true });
    const cached = await FS.getInfoAsync(path);
    if (cached.exists && "size" in cached && cached.size > 0) {
        const asset = await FS.readAsStringAsync(path + ".json").then(text => JSON.parse(text) as RemoteAsset).catch(() => undefined);
        return { uri: path, asset };
    }
    const asset = await client.query<RemoteAsset>("media", { source: target.href });
    const uri = await downloadAsset(host, `/v1/preview/${asset.ticket}/file`, path);
    await FS.writeAsStringAsync(path + ".json", JSON.stringify(asset));
    return { uri, asset };
}

/** Thumbnail from the computer, cached per computer identity so lists scroll without refetching. */
export function useThumbnail(client: Client, source: string, retry = 0) {
    const [uri, setUri] = useState(""), [error, setError] = useState("");
    useEffect(() => {
        let disposed = false; setUri(""); setError("");
        if (!client.host) return;
        void cachedFile(client, source, "thumbnail", retry > 0).then(value => { if (!disposed) setUri(value.uri); }).catch(e => { if (!disposed) setError(e instanceof Error ? e.message : String(e)); });
        return () => { disposed = true; };
    }, [client.host?.fingerprint, client.host?.host, source, retry]);
    return { uri, error, setUri, setError };
}

/** Square tile for the photo grid. */
export function PhotoTile({ client, source, size, favorite, onPress, onLongPress }: { client: Client; source: string; size: number; favorite?: boolean; onPress: () => void; onLongPress?: () => void }) {
    const [retry, setRetry] = useState(0); const { uri, error } = useThumbnail(client, source, retry);
    return <Pressable accessibilityRole="imagebutton" accessibilityLabel="查看图片" onPress={error ? () => setRetry(v => v + 1) : onPress} onLongPress={onLongPress} delayLongPress={380} style={{ width: size, height: size, backgroundColor: "#00000022", alignItems: "center", justifyContent: "center" }}>
      {uri ? <Image source={{ uri }} style={{ width: size, height: size }} resizeMode="cover" /> : error ? <Text style={{ color: "#999", fontSize: font.caption }}>点按重试</Text> : <ActivityIndicator />}
      {favorite ? <Text style={{ position: "absolute", right: 5, top: 3, color: "#ffd54a", fontSize: 15, textShadowColor: "#000", textShadowRadius: 3 }}>★</Text> : null}
    </Pressable>;
}

export interface Photo { source: string; name?: string; prompt?: string; detail?: string }

/**
 * Album-style viewer: swipe left/right between photos, tap to hide controls, double-tap or
 * pinch to zoom, drag to pan while zoomed, swipe down to close. Pure RN responders, no
 * native gesture module.
 */
export function PhotoViewer({ client, photos, index, onClose, favorites, onFavorite, onNotice }: {
    client: Client; photos: Photo[]; index: number; onClose: () => void;
    favorites: string[]; onFavorite: (source: string) => void; onNotice: (text: string) => void;
}) {
    const { width, height } = useWindowDimensions();
    const [current, setCurrent] = useState(index), [chrome, setChrome] = useState(true), [zoomed, setZoomed] = useState(false), [info, setInfo] = useState(false), [busy, setBusy] = useState("");
    const list = useRef<FlatList<Photo>>(null);
    const photo = photos[current];
    useEffect(() => { list.current?.scrollToOffset({ offset: current * width, animated: false }); }, [width]);
    const run = async (label: string, action: (file: { uri: string; asset?: RemoteAsset }) => Promise<unknown>) => {
        if (!photo || busy) return; setBusy(label);
        try { await action(await cachedFile(client, photo.source, "original")); } catch (e) { onNotice(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); }
    };
    const name = (photo?.name || "grok-image").replace(/[\\/:*?"<>|]/g, "_");
    return <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <StatusBar hidden={!chrome} />
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <FlatList ref={list} data={photos} horizontal pagingEnabled scrollEnabled={!zoomed} initialScrollIndex={index} keyExtractor={(item, i) => item.source + ":" + i}
          getItemLayout={(_d, i) => ({ length: width, offset: width * i, index: i })} windowSize={3} initialNumToRender={1} maxToRenderPerBatch={2} showsHorizontalScrollIndicator={false}
          scrollEventThrottle={32} onScroll={e => { const next = Math.max(0, Math.min(photos.length - 1, Math.round(e.nativeEvent.contentOffset.x / width))); if (next !== current) { setCurrent(next); setInfo(false); } }}
          renderItem={({ item, index: i }) => <PhotoPage client={client} photo={item} width={width} height={height} active={Math.abs(i - current) <= 1} focused={i === current}
            onTap={() => setChrome(v => !v)} onZoom={setZoomed} onDismiss={onClose} />} />
        {chrome ? <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, top: 0, paddingTop: 36, paddingHorizontal: space.md, flexDirection: "row", alignItems: "center", backgroundColor: "#00000066" }}>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭" hitSlop={10} onPress={onClose} style={{ padding: space.md }}><Text style={{ color: "#fff", fontSize: 22 }}>×</Text></Pressable>
            <Text style={{ flex: 1, textAlign: "center", color: "#fff", fontSize: font.body, fontWeight: "600" }}>{current + 1} / {photos.length}</Text>
            <View style={{ width: 46 }} />
          </View> : null}
        {chrome && photo ? <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingBottom: 28, paddingTop: space.sm, paddingHorizontal: space.md, backgroundColor: "#000000aa", gap: space.sm }}>
            {info && (photo.prompt || photo.detail) ? <Text selectable numberOfLines={8} style={{ color: "#e8e8e8", fontSize: font.small, lineHeight: 20 }}>{photo.prompt}{photo.detail ? `\n${photo.detail}` : ""}</Text> : null}
            <View style={{ flexDirection: "row", justifyContent: "space-around" }}>
              {[
                  { label: favorites.includes(photo.source) ? "★ 已收藏" : "☆ 收藏", onPress: () => onFavorite(photo.source) },
                  { label: busy === "save" ? "保存中…" : "保存", onPress: () => void run("save", async file => { await saveDownload(file.uri, file.asset?.name || name + ".png", file.asset?.mimeType || "image/png"); onNotice("已保存到手机相册 / 下载目录"); }) },
                  { label: busy === "share" ? "准备中…" : "分享", onPress: () => void run("share", async file => { if (!(await Sharing.isAvailableAsync())) throw Error("当前系统不支持分享"); await Sharing.shareAsync(file.uri, { mimeType: file.asset?.mimeType || "image/png" }); }) },
                  ...(photo.prompt || photo.detail ? [{ label: info ? "隐藏说明" : "提示词", onPress: () => setInfo(v => !v) }] : []),
              ].map(action => <Pressable key={action.label} accessibilityRole="button" onPress={action.onPress} style={{ paddingVertical: space.md, paddingHorizontal: space.md, borderRadius: radius.md }}><Text style={{ color: "#fff", fontSize: font.small, fontWeight: "600" }}>{action.label}</Text></Pressable>)}
            </View>
          </View> : null}
      </View>
    </Modal>;
}

function PhotoPage({ client, photo, width, height, active, focused, onTap, onZoom, onDismiss }: {
    client: Client; photo: Photo; width: number; height: number; active: boolean; focused: boolean;
    onTap: () => void; onZoom: (zoomed: boolean) => void; onDismiss: () => void;
}) {
    const thumb = useThumbnail(client, photo.source);
    const [full, setFull] = useState(""), [error, setError] = useState("");
    useEffect(() => {
        if (!active || full) return; let disposed = false;
        void cachedFile(client, photo.source, "original").then(value => { if (!disposed) setFull(value.uri); }).catch(e => { if (!disposed) setError(e instanceof Error ? e.message : String(e)); });
        return () => { disposed = true; };
    }, [active, photo.source, client.host?.fingerprint]);
    useEffect(() => {
        if (!full || !full.startsWith("file:")) return;
        void cachePin(full, true).catch(() => undefined);
        return () => { void cachePin(full, false).catch(() => undefined); };
    }, [full]);
    const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => { clearTimeout(tapTimer.current); }, []);
    const scale = useRef(new Animated.Value(1)).current, tx = useRef(new Animated.Value(0)).current, ty = useRef(new Animated.Value(0)).current;
    const state = useRef({ scale: 1, x: 0, y: 0, startScale: 1, startX: 0, startY: 0, pinch: 0, lastTap: 0 });
    const apply = (next: { scale: number; x: number; y: number }, animate = false) => {
        const s = state.current; s.scale = next.scale; s.x = next.x; s.y = next.y;
        if (animate) Animated.parallel([Animated.spring(scale, { toValue: next.scale, useNativeDriver: true, bounciness: 0 }), Animated.spring(tx, { toValue: next.x, useNativeDriver: true, bounciness: 0 }), Animated.spring(ty, { toValue: next.y, useNativeDriver: true, bounciness: 0 })]).start();
        else { scale.setValue(next.scale); tx.setValue(next.x); ty.setValue(next.y); }
    };
    const clamp = (value: number, s: number, size: number) => { const limit = (size * (s - 1)) / 2; return Math.max(-limit, Math.min(limit, value)); };
    useEffect(() => {
        clearTimeout(tapTimer.current);
        apply({ scale: 1, x: 0, y: 0 });
        if (focused) onZoom(false);
    }, [focused]);
    // Single/double tap go through a Pressable so the pager keeps native horizontal swipes.
    // The page only claims a gesture for pinch, panning while zoomed, or a downward drag.
    const tap = () => {
        const s = state.current, now = Date.now();
        if (now - s.lastTap < 280) {
            s.lastTap = 0;
            if (s.scale > 1) { apply({ scale: 1, x: 0, y: 0 }, true); onZoom(false); }
            else { apply({ scale: 2.5, x: 0, y: 0 }, true); onZoom(true); }
            return;
        }
        s.lastTap = now;
        clearTimeout(tapTimer.current);
        tapTimer.current = setTimeout(() => { if (state.current.lastTap === now) onTap(); }, 290);
    };
    const responder = useMemo(() => {
        const wants = (e: { nativeEvent: { touches: ArrayLike<unknown> } }, g: { dx: number; dy: number }) =>
            e.nativeEvent.touches.length > 1 || state.current.scale > 1 || (g.dy > 12 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5);
        return PanResponder.create({
            onMoveShouldSetPanResponderCapture: wants,
            onMoveShouldSetPanResponder: wants,
            onPanResponderGrant: () => { const s = state.current; s.startScale = s.scale; s.startX = s.x; s.startY = s.y; s.pinch = 0; },
            onPanResponderMove: (e, g) => {
                const s = state.current, touches = e.nativeEvent.touches;
                if (touches.length > 1) {
                    const distance = Math.hypot(touches[0]!.pageX - touches[1]!.pageX, touches[0]!.pageY - touches[1]!.pageY);
                    if (!s.pinch) { s.pinch = distance; s.startScale = s.scale; return; }
                    const next = Math.max(1, Math.min(5, s.startScale * distance / s.pinch));
                    apply({ scale: next, x: clamp(s.x, next, width), y: clamp(s.y, next, height) });
                    return;
                }
                if (s.scale > 1) apply({ scale: s.scale, x: clamp(s.startX + g.dx, s.scale, width), y: clamp(s.startY + g.dy, s.scale, height) });
                else ty.setValue(Math.max(0, g.dy));
            },
            onPanResponderRelease: (_e, g) => {
                const s = state.current;
                if (s.scale <= 1.02) {
                    if (s.scale !== 1) apply({ scale: 1, x: 0, y: 0 }, true);
                    onZoom(false);
                    if (!s.pinch && g.dy > 120) { onDismiss(); return; }
                    Animated.spring(ty, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
                } else onZoom(true);
            },
            onPanResponderTerminationRequest: () => state.current.scale <= 1,
            onPanResponderTerminate: () => { if (state.current.scale <= 1) Animated.spring(ty, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start(); },
        });
    }, [width, height]);
    const uri = full || thumb.uri;
    return <View style={{ width, height, alignItems: "center", justifyContent: "center", overflow: "hidden" }} {...responder.panHandlers}>
      <Pressable accessibilityRole="image" accessibilityLabel={photo.prompt || "图片"} accessibilityHint="单击显示或隐藏按钮，双击放大" onPress={tap} style={{ width, height, alignItems: "center", justifyContent: "center" }}>
        {uri ? <Animated.Image source={{ uri }} resizeMode="contain" style={{ width, height, transform: [{ translateX: tx }, { translateY: ty }, { scale }] }} /> : <ActivityIndicator color="#fff" />}
      </Pressable>
      {!full && uri && !error ? <View style={{ position: "absolute", bottom: 110, alignSelf: "center", paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: "#00000088" }}><Text style={{ color: "#ddd", fontSize: font.caption }}>正在载入原图…</Text></View> : null}
      {error && !uri ? <Text style={{ color: "#f99", padding: space.xl, textAlign: "center" }}>{error}</Text> : null}
    </View>;
}
