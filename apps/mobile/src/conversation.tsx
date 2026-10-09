import React, { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, View, Pressable, ScrollView, Text, StyleSheet, TextInput, Keyboard, KeyboardAvoidingView, Platform } from "react-native";
import Animated, { interpolate, runOnJS, useAnimatedKeyboard, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Icon } from "./icons";
import { haptic as hapticIntent } from "./haptics";
import { useBackLayer } from "./back-layers";
import { primaryAction } from "./app-model";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { Button, Chip, IconButton, font, radius, space, ui, type Theme } from "./ui";
import { Markdown } from "./markdown";
import { operationStateLabel, type ConversationRow, type MobileMessage } from "./remote-model";
import { stripLeadingTitle, configSummary } from "./app-model";
import type { useRemote } from "./use-remote";
import type { RemoteSession } from "../../../src/shared/remote";
import { savedRead, savedWrite } from "./cache";
import { ConversationNavigator } from "./conversation-navigator";
import { ActionMenu, haptic, type MenuItem } from "./gestures";
type Client = ReturnType<typeof useRemote>;
export type Density = "compact" | "standard" | "full";
export const densityLabels: Record<Density, string> = { compact: "简约", standard: "标准", full: "详细" };
/** Reading density is a phone-wide preference, persisted outside any computer scope. */
export function useReadingDensity(): [Density, (value: Density) => void] {
    const [density, setDensity] = useState<Density>("compact");
    const edited = useRef(false);
    useEffect(() => { let active = true; void savedRead<string>("conversation-density-v1").then(value => { if (active && !edited.current && (value === "standard" || value === "full")) setDensity(value); }).catch(() => undefined); return () => { active = false; }; }, []);
    const update = useCallback((value: Density) => { edited.current = true; setDensity(value); void savedWrite("conversation-density-v1", value).catch(() => undefined); }, []);
    return [density, update];
}
/** Stable callbacks the list needs. Passing these instead of the whole client keeps typing from re-rendering history. */
export interface ConversationApi {
    refresh(): Promise<void>;
    loadEarlier(): Promise<void>;
    loadAround(index: number): Promise<void>;
    setNotice(text: string): void;
    setError(text: string): void;
    setDraft(text: string): void;
    getDraft(): string;
    /** Adds or removes a bookmark for a message on this computer. */
    bookmark(message: MobileMessage): void;
    /** Shows a one-time teaching hint (ignored once seen). */
    hint(id: string, text: string): void;
}
export type NavigatorSource = Pick<Client, "host" | "query" | "sessionId">;
const COMPACT_LIMIT = 420;
export const Conversation = React.memo(function Conversation({ rows, theme, sessionId, before, loading, refreshing, readError, anchorIndex, canSend, navigator, density, navigatorOpen, onNavigatorClose, api, onChild, onAsset, onFile }: {
    rows: ConversationRow[];
    theme: Theme;
    sessionId: string;
    before?: number;
    loading: boolean;
    refreshing: boolean;
    readError: string;
    anchorIndex?: number;
    canSend: boolean;
    navigator: NavigatorSource;
    density: Density;
    navigatorOpen: boolean;
    onNavigatorClose: () => void;
    api: ConversationApi;
    onChild: (id: string) => void;
    onAsset?: (source: string) => void;
    onFile?: (path: string) => void;
}) {
    const list = useRef<FlatList<ConversationRow>>(null), atBottom = useRef(true);
    const [visibleIndex, setVisibleIndex] = useState<number>();
    const visibleItems = useRef(({ viewableItems }: { viewableItems: Array<{ item: ConversationRow }> }) => { const item = viewableItems[0]?.item; const index = item?.message?.remoteIndex ?? item?.activity?.find(event => event.remoteIndex !== undefined)?.remoteIndex; setVisibleIndex(index); }).current;
    const [openedMessages, setOpenedMessages] = useState(new Set<string>()), [messageMenu, setMessageMenu] = useState<{ message: MobileMessage; selecting?: boolean }>();
    const userScrolling = useRef(false), initialPosition = useRef(true), followTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const [scrolled, setScrolled] = useState(false), [expanded, setExpanded] = useState(new Set<string>()), [shown, setShown] = useState<Record<string, number>>({});
    const [selection, setSelection] = useState<string[]>(), [fresh, setFresh] = useState(false);
    useBackLayer(Boolean(selection), () => { setSelection(undefined); });
    const lastSignature = useRef("");
    const anchor = useRef<number | undefined>(undefined), jumpRetry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), jumpAttempts = useRef(0);
    const detach = () => { atBottom.current = false; initialPosition.current = false; };
    const latest = useCallback(() => {
        atBottom.current = true; userScrolling.current = false; initialPosition.current = true; setScrolled(false); setFresh(false);
        list.current?.scrollToEnd({ animated: false });
        if (followTimer.current) clearTimeout(followTimer.current);
        followTimer.current = setTimeout(() => { if (atBottom.current) list.current?.scrollToEnd({ animated: false }); }, 180);
    }, []);
    const jump = (index: number) => { detach(); setScrolled(true); jumpAttempts.current = 0; list.current?.scrollToIndex({ index, animated: false, viewPosition: .12 }); };
    const selectTurn = async (index: number) => { detach(); setScrolled(true); const local = rows.findIndex(row => row.message?.role === "user" && row.message.remoteIndex === index); if (local >= 0) { jump(local); return; } await api.loadAround(index); };
    useEffect(() => () => { if (jumpRetry.current) clearTimeout(jumpRetry.current); if (followTimer.current) clearTimeout(followTimer.current); }, [sessionId]);
    useEffect(() => {
        if (anchorIndex === undefined) { anchor.current = undefined; return; }
        if (anchor.current === anchorIndex) return;
        const index = rows.findIndex(row => [...(row.message ? [row.message] : []), ...(row.activity || [])].some(message => message.remoteIndex !== undefined && message.remoteIndex <= anchorIndex && (message.remoteEnd ?? message.remoteIndex) >= anchorIndex));
        if (index < 0) return;
        if (rows[index]?.activity) { setExpanded(old => new Set([...old, rows[index]!.id])); setShown(old => ({ ...old, [rows[index]!.id]: rows[index]!.activity!.length })); }
        jumpAttempts.current = 0; anchor.current = anchorIndex; atBottom.current = false; setScrolled(true);
        list.current?.scrollToIndex({ index, animated: false, viewPosition: 0.15 });
    }, [anchorIndex, rows]);
    useEffect(() => {
        atBottom.current = true; initialPosition.current = true; userScrolling.current = false;
        setScrolled(false); setExpanded(new Set()); setShown({}); setOpenedMessages(new Set()); setMessageMenu(undefined); setSelection(undefined); setFresh(false);
    }, [sessionId]);
    // While reading history, new output does not move the list; a pill offers to jump instead.
    useEffect(() => {
        const last = rows.at(-1), signature = last ? last.id + ":" + (last.message?.text.length ?? last.activity?.length ?? 0) : "";
        if (lastSignature.current && signature !== lastSignature.current && !atBottom.current) setFresh(true);
        lastSignature.current = signature;
    }, [rows]);
    const toggleSelected = (id: string) => { hapticIntent("selection"); setSelection(old => old ? (old.includes(id) ? old.filter(v => v !== id) : [...old, id]) : [id]); };
    const toggleOpened = (id: string) => { detach(); setOpenedMessages(old => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; }); };
    const renderMessage = (item: ConversationRow, message: MobileMessage) => {
        const user = message.role === "user";
        const title = message.role === "error" ? "执行失败" : message.title || (message.role === "media" ? "实际产物" : "Grok");
        const text = user ? message.text : stripLeadingTitle(message.text, message.title);
        const long = density === "compact" && text.length > COMPACT_LIMIT, opened = openedMessages.has(item.id);
        const toggleActions = () => { if (selection) { toggleSelected(message.id); return; } haptic(); setMessageMenu({ message }); };
        const selected = selection?.includes(message.id);
        const body = <>
            {!user ? <View style={[ui.row, { gap: 4, marginBottom: 2 }]}>
                <Text style={{ flex: 1, fontSize: font.caption, fontWeight: "600", color: message.role === "error" ? theme.danger : theme.muted }}>{title}{message.status ? ` · ${message.status}` : ""}</Text>
                {selection ? <Icon name={selected ? "checkCircle" : "selectCircle"} size={18} color={selected ? theme.accent : theme.muted} /> : <Pressable accessibilityRole="button" accessibilityLabel="消息操作" onPress={toggleActions} hitSlop={8} style={styles.more}><Icon name="more" size={18} color={theme.muted} /></Pressable>}
            </View> : null}
            <Markdown value={long && !opened ? text.slice(0, COMPACT_LIMIT) + "\n\n…" : text} theme={theme} onLink={url => url.startsWith("grok-media:") ? onAsset?.(url) : onFile?.(url)} />
            {long ? <Pressable accessibilityRole="button" accessibilityLabel={opened ? "收起长内容" : "展开完整内容"} onPress={() => toggleOpened(item.id)} hitSlop={6} style={{ paddingVertical: 6 }}><Text style={{ color: theme.accent, fontSize: font.small, fontWeight: "600" }}>{opened ? "收起 ↑" : `展开全文 · 共 ${text.length.toLocaleString()} 字 ↓`}</Text></Pressable> : null}
            {user && ["sending", "failed"].includes(message.status || "") ? <Text style={[ui.hint, { color: message.status === "failed" ? theme.danger : theme.muted }]}>{message.status === "failed" ? "发送失败" : "正在提交"}</Text> : null}
            {message.source ? <Button compact title="打开产物" theme={theme} onPress={() => onAsset?.(message.source!)} /> : null}
            {item.id.startsWith("gap:") && message.remoteIndex !== undefined ? <Button compact title="加载中间记录" theme={theme} onPress={() => void api.loadAround(message.remoteIndex!).catch(e => api.setError(String(e)))} /> : null}
        </>;
        const press = selection ? () => toggleSelected(message.id) : undefined;
        if (user) return <Pressable accessibilityLabel={selection ? (selected ? "已选择的消息" : "选择这条消息") : "你的消息，长按显示操作"} accessibilityActions={[{ name: "longpress", label: "消息操作" }]} onAccessibilityAction={toggleActions} onPress={press} onLongPress={toggleActions} delayLongPress={350} style={[styles.message, styles.user, { backgroundColor: selected ? theme.accentSoft : theme.raised }]}>{selection ? <View style={{ position: "absolute", left: -26, top: 10 }}><Icon name={selected ? "checkCircle" : "selectCircle"} size={18} color={selected ? theme.accent : theme.muted} /></View> : null}{body}</Pressable>;
        const bubble = <Pressable accessibilityActions={[{ name: "longpress", label: "消息操作" }, ...(canSend && !selection ? [{ name: "quote", label: "引用到输入框" }] : [])]} onAccessibilityAction={event => event.nativeEvent.actionName === "quote" ? quote(message.text) : toggleActions()} onPress={press} onLongPress={toggleActions} delayLongPress={400} style={[styles.message, { paddingVertical: 6, borderRadius: radius.md, backgroundColor: selected ? theme.accentSoft : "transparent" }]}>{body}</Pressable>;
        // Code blocks and tables scroll sideways themselves, so they keep the long-press quote only.
        const swipeable = canSend && !selection && message.role !== "error" && !/```|\n\|[ :-]*-{3}/.test(text);
        return swipeable ? <QuoteSwipe theme={theme} onQuote={() => { quote(message.text); api.hint("quote-swipe-done", ""); }}>{bubble}</QuoteSwipe> : bubble;
    };
    const quote = (text: string) => { const current = api.getDraft(); api.setDraft(`${current}${current.trim() ? "\n\n" : ""}> ${text.slice(0, 8000).trim().replaceAll("\n", "\n> ")}\n\n`); hapticIntent("confirm"); api.setNotice("已引用到输入框"); };
    const selectedText = () => (selection ?? []).map(id => rows.find(row => row.message?.id === id)?.message).filter((m): m is MobileMessage => Boolean(m)).map(m => (m.role === "user" ? "我：" : "Grok：") + "\n" + m.text).join("\n\n---\n\n");
    const messageMenuItems = (message: MobileMessage): MenuItem[] => [
        { icon: "copy", label: "复制全文", onPress: () => void Clipboard.setStringAsync(message.text).then(() => api.setNotice("消息已复制")) },
        { icon: "quote", label: "引用到输入框", detail: "以引用块加入草稿，可继续补充问题", disabled: !canSend, onPress: () => { quote(message.text); if (message.role !== "user") api.hint("quote-swipe", "提示：把回答向右滑，也可以直接引用"); } },
        { icon: "text", label: "选择文字…", detail: "只复制或引用其中一段", keepOpen: true, onPress: () => setMessageMenu({ message, selecting: true }) },
        { icon: "select", label: "多选", detail: "一次复制或引用多条消息", onPress: () => setSelection([message.id]) },
        ...(message.remoteIndex !== undefined ? [{ icon: "bookmark" as const, label: "书签", detail: "加入或移除书签，之后从会话列表右上角打开", onPress: () => api.bookmark(message) }] : []),
        ...(message.role === "user" && canSend ? [{ label: "编辑到输入框", detail: "替换当前草稿，修改后重新发送", onPress: () => api.setDraft(message.text) }] : []),
        ...(message.source ? [{ label: "打开产物", onPress: () => onAsset?.(message.source!) }] : []),
    ];
    const renderActivity = (item: ConversationRow, activity: MobileMessage[]) => {
        const open = expanded.has(item.id) || density === "full", tools = activity.filter(a => a.role === "tool").length, agents = activity.filter(a => a.role === "agent"), rest = activity.filter(a => a.role !== "agent"), limit = shown[item.id] ?? 12;
        const failed = activity.some(a => a.status === "failed");
        return <View style={[styles.activity, { borderColor: failed ? theme.danger : theme.border, backgroundColor: theme.surface }]}>
            <Pressable accessibilityRole="button" accessibilityLabel="展开任务进度" accessibilityState={{ expanded: open }} onPress={() => { detach(); setScrolled(true); setExpanded(value => { const next = new Set(value); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; }); }} style={[ui.row, { minHeight: 40 }]}>
                <Text style={{ color: theme.muted, fontSize: font.small, flex: 1 }}>任务进度 · {tools} 次工具调用{agents.length ? ` · ${agents.length} 个子智能体` : ""}{failed ? " · 含失败" : ""}</Text>
                <Text style={{ color: theme.muted, fontSize: font.small }}>{open ? "收起 ⌃" : "展开 ⌄"}</Text>
            </Pressable>
            {open ? [...agents, ...rest.slice(-limit)].map(event => <ActivityMessage key={event.id} message={event} theme={theme} onChild={onChild} />) : null}
            {open && rest.length > limit ? <Button compact title="查看更多较早进度" theme={theme} onPress={() => setShown(value => ({ ...value, [item.id]: limit + 20 }))} /> : null}
        </View>;
    };
    return (<View style={[ui.page, { minHeight: 0 }]}>
      {readError ? <View style={[ui.row, { paddingHorizontal: space.md }]}><Text style={[ui.hint, { flex: 1, color: theme.muted }]}>历史同步暂未完成：{readError}。已显示的内容保留。</Text><Button compact ghost title="重试" theme={theme} disabled={refreshing} onPress={() => void api.refresh()} /></View> : null}
      <FlatList style={{ flex: 1, minHeight: 0 }} ref={list} data={rows} refreshing={refreshing} onRefresh={() => void api.refresh()} onViewableItemsChanged={visibleItems} keyExtractor={(row) => row.id} keyboardShouldPersistTaps="handled" keyboardDismissMode="none" removeClippedSubviews={false} showsVerticalScrollIndicator persistentScrollbar={Platform.OS === "android"} maintainVisibleContentPosition={!atBottom.current ? { minIndexForVisible: 0 } : undefined} onLayout={() => { if (atBottom.current) latest(); }} onScrollBeginDrag={() => { userScrolling.current = true; detach(); if (followTimer.current) clearTimeout(followTimer.current); }} contentContainerStyle={{ paddingHorizontal: density === "compact" ? space.md : space.lg + 2, paddingTop: space.sm, paddingBottom: space.xxl, maxWidth: 880, width: "100%", alignSelf: "center" }} initialNumToRender={14} windowSize={7} onScroll={(event) => {
            const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
            const reachedEnd = layoutMeasurement.height + contentOffset.y >= contentSize.height - 100;
            if (userScrolling.current || !initialPosition.current) { atBottom.current = reachedEnd; setScrolled(!reachedEnd); }
        }} scrollEventThrottle={120} onScrollToIndexFailed={info => { list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false }); if (jumpRetry.current) clearTimeout(jumpRetry.current); if (jumpAttempts.current++ < 3) jumpRetry.current = setTimeout(() => list.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: .15 }), 180); }} onContentSizeChange={() => { if (atBottom.current) latest(); }} ListHeaderComponent={before !== undefined ? <Button ghost compact title={loading ? "加载中…" : "加载更早消息"} theme={theme} disabled={loading} onPress={() => { detach(); void api.loadEarlier(); }} /> : null} ListEmptyComponent={<View style={ui.empty}><Text style={[ui.hint, { color: theme.muted }]}>{loading ? "正在读取会话" : "发送第一条消息，开始会话。"}</Text></View>} renderItem={({ item }) => item.activity ? renderActivity(item, item.activity) : item.message ? renderMessage(item, item.message) : null} />
      {scrolled && !selection ? (<View style={{ position: "absolute", bottom: space.md, alignSelf: "center" }}>
          <Button compact primary={fresh} title={fresh ? "有新内容 ↓" : "回到最新 ↓"} theme={theme} onPress={latest} />
        </View>) : null}
      {selection ? <View style={{ position: "absolute", left: space.md, right: space.md, bottom: space.md, flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.sm, paddingLeft: space.md, borderRadius: radius.md, backgroundColor: theme.raised, borderWidth: 1, borderColor: theme.border, elevation: 4 }}>
          <Text style={{ flex: 1, color: theme.text, fontWeight: "700", fontSize: font.small }}>已选 {selection.length} 条</Text>
          <Button compact title="复制" theme={theme} disabled={!selection.length} onPress={() => void Clipboard.setStringAsync(selectedText()).then(() => { api.setNotice(`已复制 ${selection.length} 条消息`); setSelection(undefined); })} />
          <Button compact title="引用" theme={theme} disabled={!selection.length || !canSend} onPress={() => { quote(selectedText()); setSelection(undefined); }} />
          <Button compact primary title="完成" theme={theme} onPress={() => setSelection(undefined)} />
        </View> : null}
      <ActionMenu visible={Boolean(messageMenu)} theme={theme} title={messageMenu?.selecting ? "选择文字" : messageMenu?.message.role === "user" ? "你的消息" : messageMenu?.message.title || "Grok"}
        subtitle={messageMenu?.selecting ? "长按文字并拖动选择范围，再用系统菜单复制。" : messageMenu ? `${messageMenu.message.text.length.toLocaleString()} 字` : undefined}
        onClose={() => setMessageMenu(undefined)} items={messageMenu && !messageMenu.selecting ? messageMenuItems(messageMenu.message) : []}>
        {messageMenu?.selecting ? <ScrollView style={{ maxHeight: 420 }}><Text selectable style={{ color: theme.text, fontSize: font.body, lineHeight: 24 }}>{messageMenu.message.text}</Text></ScrollView> : null}
      </ActionMenu>
      <ConversationNavigator visible={navigatorOpen} client={navigator as Client} theme={theme} currentIndex={visibleIndex} onSelect={selectTurn} onClose={onNavigatorClose} onLatest={latest} />
    </View>);
});
/**
 * Swipe an answer to the right to quote it into the composer. Arms at 56 pt with a haptic tick,
 * resists beyond, fires only on release past the threshold, and fails on vertical movement so
 * the list keeps scrolling normally.
 */
function QuoteSwipe({ theme, onQuote, children }: { theme: Theme; onQuote: () => void; children: React.ReactNode }) {
    const x = useSharedValue(0), armed = useSharedValue(false);
    const tick = () => hapticIntent("threshold");
    const pan = Gesture.Pan().activeOffsetX([-1000, 18]).failOffsetY([-10, 10])
        .onUpdate(e => {
            const raw = Math.max(0, e.translationX);
            x.value = Math.min(raw > 56 ? 56 + (raw - 56) * 0.25 : raw, 90);
            const now = raw > 56;
            if (now !== armed.value) { armed.value = now; if (now) runOnJS(tick)(); }
        })
        .onEnd(() => { if (armed.value) runOnJS(onQuote)(); })
        .onFinalize(() => { armed.value = false; x.value = withSpring(0, { damping: 20, stiffness: 240 }); });
    const bubble = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
    const icon = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [0, 36, 56], [0, 0.45, 1], "clamp"), transform: [{ scale: interpolate(x.value, [36, 60], [0.7, 1.12], "clamp") }] }));
    return <View>
      <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 0, bottom: 0, justifyContent: "center" }, icon]}><Icon name="quote" size={20} color={theme.accent} /></Animated.View>
      <GestureDetector gesture={pan}><Animated.View style={bubble}>{children}</Animated.View></GestureDetector>
    </View>;
}
function ActivityMessage({ message, theme, onChild }: { message: MobileMessage; theme: Theme; onChild: (id: string) => void; }) {
    const [open, setOpen] = useState(false);
    const status = message.status ? toolStatus(message.status) : "";
    return (<View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border, paddingTop: 10, marginTop: 10, gap: 6 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((v) => !v)} style={[ui.row, { minHeight: 36 }]}>
        <Text style={{ flex: 1, color: theme.text, fontSize: font.small, fontWeight: "600" }} numberOfLines={2}>
          {message.role === "thought" ? "思考过程" : message.role === "agent" ? `子智能体 · ${message.title}` : message.title}
        </Text>
        <Text style={{ color: message.status === "failed" ? theme.danger : theme.muted, fontSize: 11 }}>{status ? `${status} · ` : ""}{open ? "收起" : "查看"}</Text>
      </Pressable>
      {message.childTokens !== undefined ? <Text style={[ui.hint, { color: theme.muted }]}>子智能体上报 {message.childTokens.toLocaleString()} Token · 单独展示，不推断父统计包含关系。</Text> : null}{message.childSessionId ? (<Button compact title="打开子会话" theme={theme} onPress={() => onChild(message.childSessionId!)} />) : null}
      {open ? (<Markdown value={message.text || "暂无更多内容"} theme={theme} />) : null}
    </View>);
}
function toolStatus(value: string) {
    return (({ completed: "已完成", in_progress: "执行中", pending: "待执行", failed: "失败", running: "执行中", working: "执行中" } as Record<string, string>)[value] || "状态已更新");
}
/**
 * Input first, then one toolbar row: materials, execution configuration, tools, send.
 * Status that needs attention (pending requests, queue, sub-sessions, receipts) appears
 * as chips above the input only when present, instead of permanent rows.
 */
export function Composer({ client, session, theme, disabled, onStop, onAttach, onTools, onConfig, onPending, onQueue, onChildren, queueCount, childrenCount }: {
    client: Client;
    session?: RemoteSession;
    theme: Theme;
    disabled: boolean;
    onStop: () => void;
    onAttach: () => void;
    onTools: () => void;
    onConfig: () => void;
    onPending: () => void;
    onQueue: () => void;
    onChildren: () => void;
    queueCount: number;
    childrenCount: number;
}) {
    const readOnly = session?.canSend === false, working = session?.status === "working";
    const pending = client.snapshot?.pending.length ?? 0;
    const runtime = client.snapshot?.runtime;
    const model = (runtime?.models.length ? runtime.models : client.options?.models)?.find(m => m.modelId === runtime?.modelId);
    const summary = configSummary(model?.name || runtime?.modelId || session?.modelId, runtime?.mode || session?.mode, runtime?.effort);
    const receipt = client.receipt?.sessionId === client.sessionId ? client.receipt : undefined;
    const materials = client.composer.attachments.length + (client.composer.references?.length ?? 0);
    const chips: React.ReactNode[] = [];
    if (pending) chips.push(<Chip key="pending" tone="warning" label={`${pending} 项待确认`} theme={theme} onPress={onPending} />);
    if (queueCount) chips.push(<Chip key="queue" label={`队列 ${queueCount}`} theme={theme} onPress={onQueue} />);
    if (childrenCount) chips.push(<Chip key="children" label={`子会话 ${childrenCount}`} theme={theme} onPress={onChildren} />);
    if (client.composer.attachments.length) chips.push(<Chip key="files" selected label={`附件 ${client.composer.attachments.length}`} theme={theme} onPress={onAttach} />);
    if (client.composer.references?.length) chips.push(<Chip key="refs" selected label={`引用 ${client.composer.references.length}`} theme={theme} onPress={onAttach} />);
    if (client.composer.toolSelection) chips.push(<Chip key="tool" selected label={client.composer.toolSelection.toolName} theme={theme} onPress={onTools} />);
    if (client.snapshot?.runtime?.interjectSupported && working) chips.push(<Chip key="interject" label="立即补充" theme={theme} disabled={disabled || !client.draft.trim()} onPress={() => void client.perform("interject")} />);
    if (receipt && receipt.state !== "completed") chips.push(<Text key="receipt" style={{ alignSelf: "center", fontSize: 11, color: receipt.state === "failed" ? theme.danger : theme.muted }}>{operationStateLabel(receipt.state)}</Text>);
    return (<View style={[styles.composer, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
      {chips.length ? <View style={[ui.row, { flexWrap: "wrap", gap: 6 }]}>{chips}</View> : null}
      <TextInput testID="conversation-composer" accessibilityLabel="会话消息" value={client.draft} onChangeText={client.setDraft} multiline placeholder={readOnly ? "只读子会话，可返回父会话继续" : working ? "补充消息会加入队列…" : "发送消息，继续工作…"} placeholderTextColor={theme.muted} editable={!readOnly} maxLength={65000} style={[styles.input, { color: theme.text, backgroundColor: theme.bg, borderColor: theme.border }]} blurOnSubmit={false} />
      <View style={[ui.row, { gap: 4 }]}>
        <IconButton label="＋ 材料" icon="＋" theme={theme} disabled={readOnly} badge={materials || undefined} onPress={onAttach} />
        <Pressable accessibilityRole="button" accessibilityLabel="模型与执行配置" onPress={onConfig} hitSlop={4} style={({ pressed }) => [styles.config, { backgroundColor: theme.raised, opacity: pressed ? .7 : 1 }]}>
          <Text numberOfLines={1} style={{ color: theme.text, fontSize: font.small, fontWeight: "600", flexShrink: 1 }}>{summary.model}</Text>
          {summary.detail ? <Text numberOfLines={1} style={{ color: theme.muted, fontSize: font.caption, flexShrink: 2 }}>{summary.detail}</Text> : null}
          <Text style={{ color: theme.muted, fontSize: 11 }}>▾</Text>
        </Pressable>
        <IconButton label="更多工具" icon="⋯" theme={theme} onPress={onTools} />
        <View style={{ flex: 1 }} />
        {(() => {
            const main = primaryAction({ draft: client.draft, working, readOnly, pending, busy: client.busy, disabled });
            if (main.action === "none") return null;
            if (main.action === "stop") return <Button compact danger title="停止" theme={theme} disabled={!main.enabled} onPress={() => { hapticIntent("longPress"); onStop(); }} />;
            return <Button compact title={client.busy ? "提交中" : main.action === "queue" ? "加入队列" : "发送"} theme={theme} primary disabled={!main.enabled} onPress={() => { hapticIntent("tap"); void client.perform("send"); }} />;
        })()}
      </View>
      {readOnly ? <Text style={[ui.hint, { color: theme.muted }]}>由子智能体或独立任务执行器管理。</Text> : null}
    </View>);
}
/**
 * Keeps the composer above the IME. The app draws edge-to-edge (required on Android 15+),
 * which disables the window resize that adjustResize used to provide, so the keyboard
 * covered the input. The overlap is measured against this frame's real bottom edge: if a
 * device still resizes the window, the overlap is already zero and nothing moves twice.
 */
export function keyboardOverlap(frameBottom: number, keyboardTop: number): number {
    return Math.max(0, Math.round(frameBottom - keyboardTop));
}
/**
 * Default on Android: Reanimated tracks the real IME height on the UI thread (including the
 * candidate bar growing or shrinking while typing, and floating keyboards) and lifts the
 * composer with the keyboard's own animation. "legacy" keeps the measured fallback above,
 * selectable in Diagnostics in case a phone's keyboard misbehaves.
 */
export function ConversationFrame({ children, mode = "native" }: { children: React.ReactNode; mode?: "native" | "legacy" }) {
    if (Platform.OS === "ios") return (<KeyboardAvoidingView style={[ui.page, { minHeight: 0 }]} behavior="padding">{children}</KeyboardAvoidingView>);
    if (Platform.OS === "android" && mode === "native") return <AnimatedKeyboardFrame>{children}</AnimatedKeyboardFrame>;
    return <MeasuredKeyboardFrame>{children}</MeasuredKeyboardFrame>;
}
function AnimatedKeyboardFrame({ children }: { children: React.ReactNode }) {
    const keyboard = useAnimatedKeyboard({ isStatusBarTranslucentAndroid: true, isNavigationBarTranslucentAndroid: true });
    const bottom = useSafeAreaInsets().bottom;
    // The shell already pads for the navigation bar; only the part of the IME above it is added.
    const lift = useAnimatedStyle(() => ({ paddingBottom: Math.max(0, keyboard.height.value - bottom) }));
    return <Animated.View style={[ui.page, { minHeight: 0 }, lift]}>{children}</Animated.View>;
}
function MeasuredKeyboardFrame({ children }: { children: React.ReactNode }) {
    const frame = useRef<View>(null), [inset, setInset] = useState(0);
    useEffect(() => {
        if (Platform.OS !== "android") return;
        const show = Keyboard.addListener("keyboardDidShow", (event) => {
            const top = event.endCoordinates.screenY;
            frame.current?.measureInWindow((_x, y, _w, height) => setInset(keyboardOverlap(y + height, top)));
        });
        const hide = Keyboard.addListener("keyboardDidHide", () => setInset(0));
        return () => { show.remove(); hide.remove(); };
    }, []);
    return (<View ref={frame} style={[ui.page, { minHeight: 0, paddingBottom: inset }]}>{children}</View>);
}
const styles = StyleSheet.create({
    message: { marginBottom: space.md },
    user: { alignSelf: "flex-end", padding: space.md + 1, borderRadius: radius.lg, maxWidth: "90%" },
    more: { width: 32, height: 24, alignItems: "center", justifyContent: "center" },
    activity: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.xs, marginVertical: space.sm },
    composer: { paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: space.xs, borderTopWidth: 1, gap: 6 },
    input: { minHeight: 46, maxHeight: 150, fontSize: font.input, lineHeight: 23, paddingHorizontal: space.md, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, textAlignVertical: "top" },
    config: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 36, maxWidth: "52%", paddingHorizontal: space.md, borderRadius: radius.pill, flexShrink: 1 },
});
