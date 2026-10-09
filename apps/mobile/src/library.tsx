import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { savedRead, savedWrite } from "./cache";
import { confirm } from "./forms";
import { haptic } from "./haptics";
import { Icon } from "./icons";
import { showToast } from "./toast";
import { Button, Chip, EmptyState, ListRow, Section, font, radius, space, ui, type Theme, SearchField } from "./ui";
import { rememberRecipe, removeById, snippetMatches, type Bookmark, type Recipe, type Snippet } from "./library-model";

export type { Bookmark, Recipe, Snippet };

/** Small shared stores: recipes and bookmarks per computer, snippets for the whole phone. */
export function useStored<T>(key: string | undefined, initial: T): [T, (next: T) => void, boolean] {
    const [value, setValue] = useState<T>(initial), [ready, setReady] = useState(false);
    const revision = useRef(0);
    useEffect(() => {
        let active = true; setReady(false); setValue(initial);
        if (!key) { setReady(true); return; }
        const started = revision.current;
        void savedRead<T>(key).then(stored => { if (active) { if (revision.current === started && stored !== undefined && stored !== null) setValue(stored); setReady(true); } }).catch(() => { if (active) setReady(true); });
        return () => { active = false; };
    }, [key]);
    const save = (next: T) => { revision.current++; setValue(next); if (key) void savedWrite(key, next).catch(() => undefined); };
    return [value, save, ready];
}

/**
 * Saved execution recipes (model + effort + mode) for forms that create work. Applying one
 * checks the model is still offered by the computer; a retired model asks for a new choice
 * instead of silently switching to a different (possibly paid) route.
 */
export function RecipeBar({ storageKey, theme, current, available, apply }: {
    storageKey?: string; theme: Theme;
    current: { modelId?: string; providerId?: string; effort?: string; mode?: string };
    available: (modelId?: string, providerId?: string) => boolean;
    apply: (recipe: Recipe) => void;
}) {
    const [recipes, setRecipes] = useStored<Recipe[]>(storageKey, []);
    const [naming, setNaming] = useState(false), [name, setName] = useState("");
    const save = () => {
        const next = rememberRecipe(recipes, { name: name.trim(), modelId: current.modelId, providerId: current.providerId, effort: current.effort, mode: current.mode });
        setRecipes(next); setNaming(false); setName(""); haptic("success"); showToast("已保存配方");
    };
    return <View style={{ gap: space.sm }}>
      <View style={[ui.row, { flexWrap: "wrap", gap: space.sm }]}>
        {recipes.map(recipe => {
            const ok = available(recipe.modelId, recipe.providerId);
            return <Pressable key={recipe.id} accessibilityRole="button" accessibilityLabel={`应用配方 ${recipe.name}`} accessibilityHint="长按删除"
              onPress={() => { if (!ok) { haptic("error"); showToast(`配方「${recipe.name}」的模型 ${recipe.modelId} 当前不可用，请先选择模型后重新保存`); return; } haptic("selection"); apply(recipe); }}
              onLongPress={() => confirm(`删除配方「${recipe.name}」？`, "只删除这部手机上保存的配方。", () => setRecipes(removeById(recipes, recipe.id)))}
              style={{ paddingHorizontal: space.md, minHeight: 34, justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: ok ? theme.accent : theme.border, opacity: ok ? 1 : 0.55 }}>
              <Text style={{ color: ok ? theme.accent : theme.muted, fontSize: font.small, fontWeight: "600" }}>{recipe.name}</Text>
            </Pressable>;
        })}
        <Chip label={naming ? "取消" : "＋ 存为配方"} theme={theme} onPress={() => setNaming(!naming)} />
      </View>
      {naming ? <View style={[ui.row, { gap: space.sm }]}>
          <TextInput accessibilityLabel="配方名称" autoFocus value={name} onChangeText={setName} placeholder="例如：快速问答、深入审查" placeholderTextColor={theme.muted} style={[ui.field, { flex: 1, color: theme.text, borderColor: theme.border }]} />
          <Button compact primary title="保存" theme={theme} disabled={!name.trim()} onPress={save} />
        </View> : null}
    </View>;
}

const STARTER: Snippet[] = [
    { id: "review", title: "代码审查", text: "请审查最近的改动：指出正确性问题、边界情况和可简化的地方，按严重程度排序，并给出具体修改建议。" },
    { id: "summary", title: "总结进度", text: "用要点总结目前完成了什么、还剩什么、有哪些风险或需要我决定的事项。" },
    { id: "tests", title: "补充测试", text: "为刚才的改动补充测试，覆盖正常路径和至少两个边界情况，然后运行并汇报结果。" },
];

/** Reusable prompt fragments inserted into the draft; nothing is sent until the user sends. */
export function SnippetsSheet({ theme, onInsert }: { theme: Theme; onInsert: (text: string) => void }) {
    const [snippets, setSnippets, ready] = useStored<Snippet[] | undefined>("prompt-snippets", undefined);
    const list = snippets ?? STARTER;
    const [query, setQuery] = useState(""), [editing, setEditing] = useState<Snippet>();
    const save = (next: Snippet[]) => setSnippets(next);
    if (editing) return <View style={{ gap: space.sm }}>
      <TextInput accessibilityLabel="片段名称" value={editing.title} onChangeText={title => setEditing({ ...editing, title })} placeholder="名称" placeholderTextColor={theme.muted} style={[ui.field, { color: theme.text, borderColor: theme.border }]} />
      <TextInput accessibilityLabel="片段内容" value={editing.text} onChangeText={text => setEditing({ ...editing, text })} multiline placeholder="插入到输入框的内容" placeholderTextColor={theme.muted} style={[ui.field, { minHeight: 140, textAlignVertical: "top", color: theme.text, borderColor: theme.border }]} />
      <View style={[ui.row, { gap: space.sm }]}>
        <Button compact title="取消" theme={theme} onPress={() => setEditing(undefined)} />
        {list.some(s => s.id === editing.id) ? <Button compact danger title="删除" theme={theme} onPress={() => { save(removeById(list, editing.id)); setEditing(undefined); }} /> : null}
        <View style={{ flex: 1 }} />
        <Button compact primary title="保存" theme={theme} disabled={!editing.title.trim() || !editing.text.trim()} onPress={() => { save(list.some(s => s.id === editing.id) ? list.map(s => s.id === editing.id ? editing : s) : [...list, editing]); setEditing(undefined); haptic("success"); }} />
      </View>
    </View>;
    const shown = list.filter(s => snippetMatches(s, query));
    return <View style={{ gap: space.sm }}>
      <SearchField theme={theme} accessibilityLabel="搜索片段" value={query} onChangeText={setQuery} placeholder="搜索片段" />
      <Section theme={theme} footer="点按插入到输入框，可编辑后再发送；点右侧铅笔编辑或删除。">
        {shown.map(snippet => <View key={snippet.id} style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={{ flex: 1 }}><ListRow theme={theme} chevron={false} title={snippet.title} detail={snippet.text.slice(0, 80)} onPress={() => { haptic("tap"); onInsert(snippet.text); }} /></View>
          <Pressable accessibilityRole="button" accessibilityLabel={`编辑 ${snippet.title}`} hitSlop={6} onPress={() => setEditing(snippet)} style={({ pressed }) => ({ width: 44, alignSelf: "stretch", alignItems: "center", justifyContent: "center", opacity: pressed ? .5 : 1 })}><Icon name="edit" size={18} color={theme.muted} /></Pressable>
        </View>)}
        {ready && !shown.length ? <ListRow theme={theme} title="没有匹配的片段" /> : null}
      </Section>
      <Button compact title="新建片段" theme={theme} onPress={() => setEditing({ id: "s" + Date.now().toString(36), title: "", text: "" })} />
    </View>;
}

/** Bookmarked messages for the current computer; opening one jumps to the message. */
export function BookmarksSheet({ storageKey, theme, onOpen }: { storageKey?: string; theme: Theme; onOpen: (bookmark: Bookmark) => void }) {
    const [bookmarks, setBookmarks] = useStored<Bookmark[]>(storageKey, []);
    if (!bookmarks.length) return <EmptyState theme={theme} title="还没有书签" hint="长按会话中的消息，选择“加入书签”。" />;
    return <Section theme={theme} footer="书签只保存在这部手机上。长按删除。">
      {bookmarks.map(bookmark => <Pressable key={bookmark.id} accessibilityRole="button" accessibilityLabel={`打开书签：${bookmark.sessionTitle}`} onPress={() => onOpen(bookmark)}
        onLongPress={() => confirm("删除书签？", bookmark.excerpt.slice(0, 60), () => setBookmarks(removeById(bookmarks, bookmark.id)))}
        style={({ pressed }) => ({ padding: space.md, gap: 4, backgroundColor: pressed ? theme.raised : "transparent" })}>
        <View style={[ui.row, { gap: space.sm }]}>
          <Icon name="bookmarkFilled" size={14} color={theme.accent} />
          <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontWeight: "700", fontSize: font.small }}>{bookmark.sessionTitle}</Text>
          <Text style={{ color: theme.muted, fontSize: font.caption }}>{new Date(bookmark.at).toLocaleDateString()}</Text>
        </View>
        <Text numberOfLines={3} style={{ color: theme.muted, fontSize: font.small, lineHeight: 19 }}>{bookmark.excerpt}</Text>
      </Pressable>)}
    </Section>;
}
