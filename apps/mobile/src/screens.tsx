import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, SectionList, Pressable, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { ActionMenu, SwipeRow, swipeInProgress, useMenuTarget, type MenuItem } from "./gestures";
import type { RemoteSession } from "../../../src/shared/remote";
import { Chip, EmptyState, font, radius, space, ui, type Theme } from "./ui";
import { sessionStatusLabel } from "./remote-model";
import { projectLabel } from "./experience-model";
export interface Preferences {
    theme: "system" | "light" | "dark";
    completion: boolean;
    failure: boolean;
    attention: boolean;
    updates: boolean;
    mutedSessions: string[];
    favorites: string[];
    recent: string[];
}
export const defaultPrefs: Preferences = {
    theme: "system",
    completion: true,
    failure: true,
    attention: true,
    updates: true,
    mutedSessions: [],
    favorites: [],
    recent: [],
};
const relativeDate = (value: string) => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()))
        return "历史记录";
    return new Date().toDateString() === date.toDateString()
        ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
        : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const ACTIVE = ["working", "needs-user", "queued"];
function statusColor(theme: Theme, status: string) {
    return status === "needs-user" ? theme.warning : status === "working" || status === "queued" ? theme.accent : status === "error" ? theme.danger : undefined;
}
export function SessionRow({ session, theme, onOpen, onLongPress, favorite = false }: {
    session: RemoteSession;
    theme: Theme;
    onOpen: () => void;
    onLongPress?: () => void;
    favorite?: boolean;
}) {
    const label = session.projectMissing ? "项目文件夹已移动或删除" : sessionStatusLabel(session.status, session.canSend), dot = session.projectMissing ? theme.warning : statusColor(theme, session.status);
    return (<Pressable accessibilityRole="button" accessibilityLabel={session.title} accessibilityHint={onLongPress ? "长按显示更多操作，左右滑动可快速收藏或归档" : undefined} accessibilityActions={onLongPress ? [{ name: "longpress", label: "会话操作" }] : undefined} onAccessibilityAction={onLongPress ? (e) => { if (e.nativeEvent.actionName === "longpress") onLongPress(); } : undefined} onPress={onOpen} onLongPress={onLongPress} delayLongPress={380} style={({ pressed }) => ({ flexDirection: "row", paddingHorizontal: space.lg, paddingVertical: 14, gap: space.md, alignItems: "flex-start", backgroundColor: pressed ? theme.raised : theme.bg })}>
      <View style={{ width: 8, paddingTop: 9 }}>{dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} /> : null}</View>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={[ui.row, { gap: space.sm }]}>
          <Text numberOfLines={1} style={{ flex: 1, color: session.projectMissing ? theme.muted : theme.text, fontSize: font.body + 1, fontWeight: "600" }}>{favorite ? "★ " : ""}{session.title}</Text>
          <Text style={{ color: theme.muted, fontSize: font.caption }}>{relativeDate(session.updatedAt)}</Text>
        </View>
        {session.preview ? <Text numberOfLines={2} style={{ color: theme.muted, fontSize: font.small, lineHeight: 19 }}>{session.preview}</Text> : null}
        {label ? <Text style={{ color: dot || theme.muted, fontSize: font.caption, fontWeight: "600" }}>{label}</Text> : null}
      </View>
    </Pressable>);
}
export interface SessionListActions {
    /** False while offline or a submission is pending: synced actions are greyed out, phone-only ones still work. */
    canSync: boolean;
    capabilities: string[];
    muted: string[];
    toggleFavorite: (id: string) => void;
    toggleMuted: (id: string) => void;
    archive: (id: string, archived: boolean) => Promise<unknown>;
    rename: (id: string, title: string) => Promise<unknown>;
    remove: (id: string, title: string) => void;
    notice: (text: string) => void;
}
type Filter = "recent" | "active" | "favorite" | "archived";
export function SessionList({ sessions, theme, favorites, recent, onOpen, refresh, refreshing, online, actions, scrollToTop }: {
    sessions: RemoteSession[];
    theme: Theme;
    favorites: string[];
    recent: string[];
    onOpen: (id: string) => void;
    refresh: () => void;
    refreshing: boolean;
    online: boolean;
    actions: SessionListActions;
    /** Incremented when the user taps the already-selected 会话 tab. */
    scrollToTop?: number;
}) {
    const [search, setSearch] = useState(""), [filter, setFilter] = useState<Filter>("recent");
    const menu = useMenuTarget<RemoteSession>(), [renaming, setRenaming] = useState<string>();
    const [undo, setUndo] = useState<{ id: string; title: string }>();
    const listRef = React.useRef<SectionList<RemoteSession, { key: string; title: string; data: RemoteSession[] }>>(null);
    useEffect(() => { if (!undo) return; const timer = setTimeout(() => setUndo(undefined), 6000); return () => clearTimeout(timer); }, [undo]);
    useEffect(() => { if (!scrollToTop) return; try { listRef.current?.scrollToLocation({ sectionIndex: 0, itemIndex: 0, viewOffset: 60, animated: true }); } catch { } }, [scrollToTop]);
    const can = (capability: string) => actions.canSync && actions.capabilities.includes(capability);
    const archive = (session: RemoteSession) => void actions.archive(session.id, !session.archived).then(result => { if (result && !session.archived) setUndo({ id: session.id, title: session.title }); });
    const menuItems = (session: RemoteSession): MenuItem[] => {
        const favorite = favorites.includes(session.id), muted = actions.muted.includes(session.id);
        return [
            { label: "打开", onPress: () => onOpen(session.id) },
            { label: favorite ? "取消收藏" : "收藏", detail: "只保存在这台手机", onPress: () => actions.toggleFavorite(session.id) },
            { label: "重命名", disabled: !can("session.rename"), keepOpen: true, onPress: () => setRenaming(session.title) },
            { label: muted ? "恢复提醒" : "静音提醒", onPress: () => actions.toggleMuted(session.id) },
            { label: "复制标题", onPress: () => void Clipboard.setStringAsync(session.title).then(() => actions.notice("标题已复制")) },
            { label: "复制项目路径", detail: session.cwd, onPress: () => void Clipboard.setStringAsync(session.cwd).then(() => actions.notice("项目路径已复制")) },
            { label: session.archived ? "恢复归档" : session.projectMissing ? "隐藏（归档）" : "归档", disabled: !can("session.archive"), onPress: () => archive(session) },
            { label: "删除会话", danger: true, detail: "使用电脑原删除流程，保留项目磁盘文件", disabled: !actions.canSync, onPress: () => actions.remove(session.id, session.title) },
        ];
    };
    const base = useMemo(() => sessions.filter((s) => !s.parentSessionId), [sessions]);
    const activeCount = base.filter(s => !s.archived && ACTIVE.includes(s.status)).length;
    const sections = useMemo(() => {
        const query = search.trim().toLowerCase();
        const filtered = base.filter((s) => (filter === "archived" ? s.archived : !s.archived) &&
            (filter !== "active" || ACTIVE.includes(s.status)) &&
            (filter !== "favorite" || favorites.includes(s.id)) &&
            (!query || `${s.title} ${s.projectName} ${s.preview || ""}`.toLowerCase().includes(query)));
        const groups = new Map<string, RemoteSession[]>();
        for (const row of filtered)
            groups.set(row.cwd, [...(groups.get(row.cwd) ?? []), row]);
        return [...groups].map(([key, data]) => ({ key, title: projectLabel(data[0]!, base), data }));
    }, [base, search, filter, favorites]);
    const resume = filter === "recent" && !search ? base.find(row => row.id === recent.find(id => base.some(s => s.id === id && !s.archived))) : undefined;
    const filters: ReadonlyArray<readonly [Filter, string]> = [["recent", "最近"], ["active", activeCount ? `进行中 ${activeCount}` : "进行中"], ["favorite", "收藏"], ["archived", `归档 ${base.filter((s) => s.archived).length}`]];
    return (<View style={ui.page}>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, gap: space.sm }}>
        <TextInput accessibilityLabel="搜索会话" value={search} onChangeText={setSearch} placeholder="搜索会话、项目或摘要" placeholderTextColor={theme.muted} style={[ui.field, { minHeight: 42, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: theme.surface, borderColor: theme.border, color: theme.text }]} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm, paddingVertical: space.sm + 2 }}>
        {filters.map(([id, label]) => <Chip key={id} label={label} accessibilityLabel={id === "recent" ? "最近" : id === "active" ? "进行中" : id === "favorite" ? "收藏" : label} theme={theme} selected={filter === id} onPress={() => setFilter(id)} />)}
      </ScrollView>
      <SectionList ref={listRef} sections={sections} keyExtractor={(s) => s.id} stickySectionHeadersEnabled keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 30 }} onRefresh={refresh} refreshing={refreshing}
        ListHeaderComponent={resume ? <Pressable accessibilityRole="button" accessibilityLabel={`继续上次会话：${resume.title}`} onPress={() => onOpen(resume.id)} style={({ pressed }) => ({ marginHorizontal: space.lg, marginBottom: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: pressed ? theme.raised : theme.accentSoft, gap: 2 })}>
            <Text style={{ color: theme.accent, fontSize: font.caption, fontWeight: "700" }}>继续上次会话</Text>
            <Text numberOfLines={1} style={{ color: theme.text, fontSize: font.body, fontWeight: "600" }}>{resume.title}</Text>
          </Pressable> : null}
        renderSectionHeader={({ section }) => (<View style={{ backgroundColor: theme.bg, paddingHorizontal: space.lg + 2, paddingTop: space.md, paddingBottom: space.xs }}>
            <Text style={{ color: theme.muted, fontSize: font.caption, fontWeight: "700" }}>{section.title} · {section.data.length}</Text>
          </View>)}
        ItemSeparatorComponent={() => <View style={{ height: 1, marginLeft: space.lg + 20, backgroundColor: theme.border, opacity: .6 }} />}
        renderItem={({ item }) => {
            const favorite = favorites.includes(item.id);
            return <SwipeRow theme={theme}
              leading={{ label: favorite ? "☆ 取消收藏" : "★ 收藏", color: theme.primary, onPress: () => actions.toggleFavorite(item.id) }}
              trailing={[
                  ...(can("session.archive") ? [{ label: item.archived ? "恢复" : "归档", color: "#6b7280", onPress: () => archive(item) }] : []),
                  ...(actions.canSync ? [{ label: "删除", color: theme.danger, onPress: () => actions.remove(item.id, item.title) }] : []),
              ]}>
              <SessionRow session={item} theme={theme} favorite={favorite} onOpen={() => { if (!swipeInProgress()) onOpen(item.id); }} onLongPress={() => { if (!swipeInProgress()) menu.open(item); }} />
            </SwipeRow>;
        }}
        ListEmptyComponent={<EmptyState theme={theme} title={search ? "没有匹配的会话" : filter === "archived" ? "没有归档会话" : filter === "favorite" ? "还没有收藏" : filter === "active" ? "目前没有进行中的会话" : "这里还没有会话"} hint={online ? "点右上角 ＋ 选择电脑项目并新建会话。" : "恢复电脑连接后会同步已有会话。"} />} />
      {undo ? <View style={{ position: "absolute", left: space.lg, right: space.lg, bottom: space.lg, flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: theme.raised, borderWidth: 1, borderColor: theme.border }}>
          <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: font.small }}>已归档「{undo.title}」</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="撤销归档" hitSlop={10} onPress={() => { const target = undo; setUndo(undefined); void actions.archive(target.id, false); }}><Text style={{ color: theme.accent, fontWeight: "700" }}>撤销</Text></Pressable>
        </View> : null}
      <ActionMenu visible={Boolean(menu.target)} theme={theme} title={menu.target?.title} subtitle={menu.target ? `${menu.target.projectName}${menu.target.projectMissing ? " · 项目文件夹已移动或删除" : ""}` : undefined} onClose={() => { menu.close(); setRenaming(undefined); }}
        items={menu.target && renaming === undefined ? menuItems(menu.target) : []}>
        {menu.target && renaming !== undefined ? <View style={{ gap: space.sm }}>
            <TextInput autoFocus accessibilityLabel="新的会话名称" value={renaming} onChangeText={setRenaming} maxLength={100} style={[ui.field, { color: theme.text, borderColor: theme.border }]} />
            <View style={[ui.row, { gap: space.sm, justifyContent: "flex-end" }]}>
              <Pressable accessibilityRole="button" onPress={() => setRenaming(undefined)} style={{ padding: space.md }}><Text style={{ color: theme.muted, fontWeight: "600" }}>取消</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={!renaming.trim() || renaming.trim() === menu.target.title} onPress={() => { const target = menu.target!; void actions.rename(target.id, renaming.trim()).then(result => { if (result) { menu.close(); setRenaming(undefined); } }); }} style={{ padding: space.md, opacity: !renaming.trim() || renaming.trim() === menu.target.title ? 0.4 : 1 }}><Text style={{ color: theme.accent, fontWeight: "700" }}>保存名称</Text></Pressable>
            </View>
          </View> : null}
      </ActionMenu>
    </View>);
}
