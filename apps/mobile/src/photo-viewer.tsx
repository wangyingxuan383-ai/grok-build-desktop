import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, PixelRatio, Pressable, StatusBar, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { FlatList, Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { Image } from "expo-image";
import * as Sharing from "expo-sharing";
import { cachePin, saveDownload } from "./transport";
import { cachedFile, invalidateCached, PRIORITY, useCachedImage, useThumbnail } from "./media-cache";
import { haptic } from "./haptics";
import { Icon, type IconName } from "./icons";
import { font, radius, space } from "./ui";
import type { useRemote } from "./use-remote";
type Client = ReturnType<typeof useRemote>;

export { useThumbnail, cachedFile };

/** Grid cell. `enabled` is false for cells far outside the viewport so they never request a file. */
export function PhotoTile({ client, source, size, favorite, selected, enabled = true, onPress, onLongPress }: {
    client: Client; source: string; size: number; favorite?: boolean; selected?: boolean; enabled?: boolean;
    onPress: () => void; onLongPress?: () => void;
}) {
    const [retry, setRetry] = useState(0), [broken, setBroken] = useState(false);
    useEffect(() => { setRetry(0); setBroken(false); }, [source]);
    const { uri, error } = useThumbnail(client, source, retry, enabled);
    return <Pressable accessibilityRole="imagebutton" accessibilityLabel={selected ? "已选择图片" : "查看图片"} accessibilityState={selected === undefined ? undefined : { selected }}
      onPress={error || broken ? () => { setBroken(false); setRetry(v => v + 1); } : onPress} onLongPress={onLongPress} delayLongPress={380}
      style={{ width: size, height: size, backgroundColor: "#00000022", alignItems: "center", justifyContent: "center" }}>
      {uri && !broken ? <Image source={{ uri }} style={{ width: size, height: size }} contentFit="cover" recyclingKey={source} transition={120}
          onError={() => { setBroken(true); void invalidateCached(uri); }} />
        : error || broken ? <Text style={{ color: "#999", fontSize: font.caption }}>点按重试</Text> : enabled ? <ActivityIndicator /> : null}
      {favorite ? <View style={{ position: "absolute", right: 4, top: 4 }}><Icon name="star" size={15} color="#ffd54a" /></View> : null}
      {selected !== undefined ? <View style={{ position: "absolute", left: 5, top: 5, width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#fff", backgroundColor: selected ? "#4776d8" : "#00000044", alignItems: "center", justifyContent: "center" }}>
          {selected ? <Icon name="check" size={14} color="#fff" /> : null}
        </View> : null}
    </Pressable>;
}

export interface Photo { source: string; name?: string; prompt?: string; detail?: string }

/**
 * Album-style viewer. Gestures run on the native UI thread (Gesture Handler + Reanimated),
 * so paging, pinch and drag stay smooth while the JS thread renders the rest of the app.
 *
 * Priority between gestures: swipe-down dismiss, then pinch + pan together, then double tap,
 * then single tap. Paging is disabled while zoomed. Double tap zooms around the tapped point
 * to fill the black bars, but never beyond twice the picture's real resolution, where it
 * would only look blurry. A fast flick down closes even when it is short.
 */
export function PhotoViewer({ client, photos, index, onClose, favorites, onFavorite, onNotice, onReuse }: {
    client: Client; photos: Photo[]; index: number; onClose: () => void;
    favorites: string[]; onFavorite: (source: string) => void; onNotice: (text: string) => void;
    /** Optional "use as reference" hand-off back to the image workspace. */
    onReuse?: (photo: Photo) => void;
}) {
    const { width, height } = useWindowDimensions();
    const [current, setCurrent] = useState(Math.min(index, Math.max(0, photos.length - 1))), [chrome, setChrome] = useState(true), [zoomed, setZoomed] = useState(false), [expanded, setExpanded] = useState(false), [busy, setBusy] = useState("");
    const drag = useSharedValue(0);
    const backdrop = useAnimatedStyle(() => ({ opacity: interpolate(drag.value, [0, height / 2], [1, 0.15], "clamp") }));
    const chromeFade = useAnimatedStyle(() => ({ opacity: interpolate(drag.value, [0, 40], [1, 0], "clamp") }));
    const photo = photos[current];
    useEffect(() => { if (!photos.length) onClose(); }, [photos.length]);
    const run = async (label: string, action: (file: { uri: string; asset?: { name?: string; mimeType?: string } }) => Promise<unknown>) => {
        if (!photo || busy) return; setBusy(label);
        try { await action(await cachedFile(client, photo.source, "original")); haptic("success"); } catch (e) { haptic("error"); onNotice(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); }
    };
    const name = (photo?.name || "grok-image").replace(/[\\/:*?"<>|]/g, "_");
    const actions: Array<{ icon: IconName; label: string; onPress: () => void }> = photo ? [
        { icon: favorites.includes(photo.source) ? "star" : "starOutline", label: favorites.includes(photo.source) ? "已收藏" : "收藏", onPress: () => { haptic("toggle"); onFavorite(photo.source); } },
        { icon: "download", label: busy === "save" ? "保存中…" : "保存", onPress: () => void run("save", async file => { await saveDownload(file.uri, file.asset?.name || name + ".png", file.asset?.mimeType || "image/png"); onNotice("已保存到手机相册 / 下载目录"); }) },
        { icon: "share", label: busy === "share" ? "准备中…" : "分享", onPress: () => void run("share", async file => { if (!(await Sharing.isAvailableAsync())) throw Error("当前系统不支持分享"); await Sharing.shareAsync(file.uri, { mimeType: file.asset?.mimeType || "image/png" }); }) },
        ...(onReuse ? [{ icon: "edit" as IconName, label: "再创作", onPress: () => onReuse(photo) }] : []),
    ] : [];
    return <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StatusBar hidden={!chrome || zoomed} />
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: "#000" }, backdrop]} />
        <FlatList key={`${width}:${height}`} data={photos} horizontal pagingEnabled scrollEnabled={!zoomed} initialScrollIndex={current} keyExtractor={(item, i) => item.source + ":" + i}
          getItemLayout={(_d, i) => ({ length: width, offset: width * i, index: i })} windowSize={3} initialNumToRender={1} maxToRenderPerBatch={2} showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={e => { const next = Math.max(0, Math.min(photos.length - 1, Math.round(e.nativeEvent.contentOffset.x / width))); if (next !== current) { setCurrent(next); setExpanded(false); haptic("selection"); } }}
          renderItem={({ item, index: i }) => <PhotoPage client={client} photo={item} width={width} height={height} active={Math.abs(i - current) <= 1} focused={i === current} drag={drag}
            onTap={() => setChrome(v => !v)} onZoom={setZoomed} onDismiss={onClose} />} />
        {chrome && !zoomed ? <Animated.View pointerEvents="box-none" style={[{ position: "absolute", left: 0, right: 0, top: 0, paddingTop: 36, paddingHorizontal: space.sm, flexDirection: "row", alignItems: "center", backgroundColor: "#00000066" }, chromeFade]}>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭" hitSlop={10} onPress={onClose} style={{ padding: space.md }}><Icon name="close" size={24} color="#fff" /></Pressable>
            <Text accessibilityLiveRegion="polite" style={{ flex: 1, textAlign: "center", color: "#fff", fontSize: font.body, fontWeight: "600" }}>{current + 1} / {photos.length}</Text>
            <View style={{ width: 48 }} />
          </Animated.View> : null}
        {chrome && !zoomed && photo ? <Animated.View style={[{ position: "absolute", left: 0, right: 0, bottom: 0, paddingBottom: 28, paddingTop: space.sm, paddingHorizontal: space.md, backgroundColor: "#000000aa", gap: space.sm }, chromeFade]}>
            {photo.prompt || photo.detail ? <Pressable accessibilityRole="button" accessibilityLabel={expanded ? "收起提示词" : "展开提示词"} onPress={() => setExpanded(v => !v)}>
                <Text selectable={expanded} numberOfLines={expanded ? 12 : 2} style={{ color: "#e8e8e8", fontSize: font.small, lineHeight: 20 }}>{photo.prompt}{photo.detail ? `\n${photo.detail}` : ""}</Text>
              </Pressable> : null}
            <View style={{ flexDirection: "row", justifyContent: "space-around" }}>
              {actions.map(action => <Pressable key={action.label} accessibilityRole="button" accessibilityLabel={action.label} onPress={action.onPress} style={{ paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.md, alignItems: "center", gap: 3, minWidth: 56 }}>
                <Icon name={action.icon} size={22} color={action.icon === "star" ? "#ffd54a" : "#fff"} />
                <Text style={{ color: "#fff", fontSize: font.caption, fontWeight: "600" }}>{action.label}</Text>
              </Pressable>)}
            </View>
          </Animated.View> : null}
      </GestureHandlerRootView>
    </Modal>;
}

function PhotoPage({ client, photo, width, height, active, focused, drag, onTap, onZoom, onDismiss }: {
    client: Client; photo: Photo; width: number; height: number; active: boolean; focused: boolean; drag: SharedValue<number>;
    onTap: () => void; onZoom: (zoomed: boolean) => void; onDismiss: () => void;
}) {
    const [retry, setRetry] = useState(0), [broken, setBroken] = useState(false);
    const thumb = useCachedImage(client, photo.source, "thumbnail", { enabled: active });
    const full = useCachedImage(client, photo.source, "original", { enabled: active, retry, priority: focused ? PRIORITY.user : PRIORITY.prefetch });
    const [natural, setNatural] = useState<{ w: number; h: number }>(), [isZoomed, setIsZoomed] = useState(false);
    useEffect(() => {
        if (!full.uri || !full.uri.startsWith("file:")) return;
        void cachePin(full.uri, true).catch(() => undefined);
        return () => { void cachePin(full.uri, false).catch(() => undefined); };
    }, [full.uri]);
    const scale = useSharedValue(1), tx = useSharedValue(0), ty = useSharedValue(0);
    const start = useSharedValue({ scale: 1, x: 0, y: 0 });
    // Displayed size at scale 1 ("contain"), and the zoom limits that follow from it.
    const geometry = useMemo(() => {
        const fit = natural ? Math.min(width / natural.w, height / natural.h) : 1;
        const shownW = natural ? natural.w * fit : width, shownH = natural ? natural.h * fit : height;
        const max = natural ? Math.min(8, Math.max(1, (2 * natural.w) / (shownW * PixelRatio.get()))) : 3;
        const fill = Math.max(width / shownW, height / shownH);
        return { shownW, shownH, max, fill };
    }, [natural, width, height]);
    const setZoom = (value: boolean) => { setIsZoomed(value); onZoom(value); };
    const reset = (animate: boolean) => {
        "worklet";
        scale.value = animate ? withSpring(1, { damping: 20 }) : 1;
        tx.value = animate ? withSpring(0, { damping: 20 }) : 0;
        ty.value = animate ? withSpring(0, { damping: 20 }) : 0;
    };
    useEffect(() => { if (!focused) { reset(false); setIsZoomed(false); } else onZoom(false); }, [focused]);
    const { shownW, shownH, max, fill } = geometry;
    const clamp = (value: number, s: number, shown: number, screen: number) => {
        "worklet";
        const limit = Math.max(0, (shown * s - screen) / 2);
        return Math.min(limit, Math.max(-limit, value));
    };
    const gesture = useMemo(() => {
        const pinch = Gesture.Pinch()
            .onStart(() => { runOnJS(setZoom)(true); start.value = { scale: scale.value, x: tx.value, y: ty.value }; })
            .onUpdate(e => {
                const next = Math.max(1, Math.min(max, start.value.scale * e.scale));
                scale.value = next;
                tx.value = clamp(tx.value, next, shownW, width);
                ty.value = clamp(ty.value, next, shownH, height);
            })
            .onEnd(() => {
                if (scale.value <= 1.02) { reset(true); runOnJS(setZoom)(false); }
                else runOnJS(setZoom)(true);
            });
        const pan = Gesture.Pan().enabled(isZoomed).averageTouches(true)
            .onStart(() => { start.value = { scale: scale.value, x: tx.value, y: ty.value }; })
            .onUpdate(e => {
                tx.value = clamp(start.value.x + e.translationX, scale.value, shownW, width);
                ty.value = clamp(start.value.y + e.translationY, scale.value, shownH, height);
            });
        // Only a downward drag starts this; any clear sideways movement hands over to paging.
        const dismiss = Gesture.Pan().maxPointers(1).enabled(!isZoomed).activeOffsetY(14).failOffsetX([-14, 14])
            .onUpdate(e => { const y = Math.max(0, e.translationY); ty.value = y; drag.value = y; })
            .onEnd(e => {
                if (e.translationY > 140 || e.velocityY > 900) {
                    ty.value = withTiming(height, { duration: 160 }, () => runOnJS(onDismiss)());
                    drag.value = withTiming(height, { duration: 160 });
                } else { ty.value = withSpring(0, { damping: 20 }); drag.value = withTiming(0, { duration: 160 }); }
            });
        const doubleTap = Gesture.Tap().numberOfTaps(2).maxDelay(260)
            .onEnd(e => {
                if (scale.value > 1.02) { reset(true); runOnJS(setZoom)(false); return; }
                const target = Math.min(max, Math.max(2, fill));
                scale.value = withSpring(target, { damping: 20 });
                tx.value = withSpring(clamp((width / 2 - e.x) * (target - 1), target, shownW, width), { damping: 20 });
                ty.value = withSpring(clamp((height / 2 - e.y) * (target - 1), target, shownH, height), { damping: 20 });
                runOnJS(setZoom)(true);
            });
        const singleTap = Gesture.Tap().onEnd(() => { runOnJS(onTap)(); });
        return Gesture.Race(dismiss, Gesture.Simultaneous(pinch, pan), Gesture.Exclusive(doubleTap, singleTap));
    }, [isZoomed, max, fill, shownW, shownH, width, height, onTap, onDismiss]);
    const style = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }] }));
    const uri = broken ? thumb.uri : full.uri || thumb.uri;
    // Screen readers cannot pinch: expose zoom as accessibility actions instead.
    const accessibilityActions = [{ name: "activate", label: "显示或隐藏按钮" }, { name: "increment", label: "放大" }, { name: "decrement", label: "还原" }];
    const onAccessibilityAction = (event: { nativeEvent: { actionName: string } }) => {
        const action = event.nativeEvent.actionName;
        if (action === "activate") onTap();
        else if (action === "increment") { scale.value = withSpring(Math.min(max, Math.max(2, fill))); setZoom(true); }
        else if (action === "decrement") { reset(true); setZoom(false); }
    };
    return <GestureDetector gesture={gesture}>
      <View collapsable={false} accessible accessibilityRole="image" accessibilityLabel={photo.prompt || "图片"} accessibilityHint="双击放大，下滑关闭，左右滑动切换" accessibilityActions={accessibilityActions} onAccessibilityAction={onAccessibilityAction}
        style={{ width, height, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        {uri ? <Animated.View style={[{ width, height }, style]}>
            <Image source={{ uri }} contentFit="contain" style={{ width, height }} recyclingKey={photo.source} placeholder={full.uri && thumb.uri ? { uri: thumb.uri } : undefined}
              onLoad={e => { if (e.source.width && e.source.height && uri === full.uri) setNatural({ w: e.source.width, h: e.source.height }); }}
              onError={() => { setBroken(true); if (full.uri) void invalidateCached(full.uri); }} />
          </Animated.View> : full.error && !thumb.uri ? <Text style={{ color: "#f99", padding: space.xl, textAlign: "center" }}>{full.error}</Text> : <ActivityIndicator color="#fff" />}
        {(broken || full.error) ? <Pressable accessibilityRole="button" accessibilityLabel="重新下载原图" onPress={() => { setBroken(false); setRetry(v => v + 1); }} style={{ position:"absolute", bottom:160, padding:12, borderRadius:12, backgroundColor:"#333" }}><Text style={{color:"#fff"}}>原图未能显示 · 点按重试</Text></Pressable> : null}
        {!full.uri && uri && !full.error ? <View style={{ position: "absolute", bottom: 130, alignSelf: "center", paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: "#00000088" }}><Text style={{ color: "#ddd", fontSize: font.caption }}>正在载入原图…</Text></View> : null}
      </View>
    </GestureDetector>;
}
