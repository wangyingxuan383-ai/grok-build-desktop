import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { savedRead, savedWrite } from "./cache";
import { confirm } from "./forms";
import { haptic } from "./haptics";
import { Icon } from "./icons";
import { showToast } from "./toast";
import { Button, Chip, EmptyState, ListRow, Section, Segmented, font, radius, space, ui, type Theme, SearchField } from "./ui";
import { fillPromptSnippet, promptSnippetVariables, type PromptSnippet } from "../../../src/shared/prompt-snippets";
import type { useRemote } from "./use-remote";
import { rememberRecipe, removeById, snippetMatches, type Bookmark, type Recipe, type Snippet } from "./library-model";

export type { Bookmark, Recipe, Snippet };

/** Small shared stores: recipes and bookmarks per computer, snippets for the whole phone. */
export function useStored<T>(key: string | undefined, initial: T): [T, (next: T) => void, boolean, { error: string; retry(): void }] {
    const [value, setValue] = useState<T>(initial), [loaded, setLoaded] = useState<{ key?: string }>();
    const [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
    const writable = useRef<{ key?: string } | undefined>(undefined);
    const currentKey = useRef(key); currentKey.current = key;
    useEffect(() => {
        let active = true; writable.current = undefined; setLoaded(undefined); setError(""); setValue(initial);
        const accept = (stored: T | undefined) => {
            if (!active || currentKey.current !== key) return;
            if (stored !== undefined && stored !== null) setValue(stored);
            writable.current = { key }; setLoaded({ key });
        };
        if (!key) accept(undefined);
        else void savedRead<T>(key).then(accept).catch(() => { if (active && currentKey.current === key) setError("本机资料读取失败，重新读取成功后才能编辑。"); });
        return () => { active = false; writable.current = undefined; };
    }, [key, attempt]);
    const save = (next: T) => {
        // Never replace a whole library with its loading/error fallback, even from a stale callback.
        if (!writable.current || writable.current.key !== key || currentKey.current !== key) return;
        setValue(next); if (key) void savedWrite(key, next).catch(() => undefined);
    };
    return [value, save, Boolean(loaded && loaded.key === key), { error, retry: () => setAttempt(value => value + 1) }];
}

function StoredReadStatus({ theme, name, state }: { theme: Theme; name: string; state: { error: string; retry(): void } }) {
    return <View style={{ gap: space.sm }}><Text accessibilityRole={state.error ? "alert" : undefined} style={{ color: state.error ? theme.danger : theme.muted, fontSize: font.small }}>{state.error || `正在读取${name}…`}</Text>{state.error ? <Button compact title="重新读取" theme={theme} onPress={state.retry}/> : null}</View>;
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
    const [recipes, setRecipes, ready, readState] = useStored<Recipe[]>(storageKey, []);
    const [naming, setNaming] = useState(false), [name, setName] = useState("");
    const save = () => {
        if (!ready) return;
        const next = rememberRecipe(recipes, { name: name.trim(), modelId: current.modelId, providerId: current.providerId, effort: current.effort, mode: current.mode });
        setRecipes(next); setNaming(false); setName(""); haptic("success"); showToast("已保存配方");
    };
    if (!ready) return <StoredReadStatus theme={theme} name="本机配方" state={readState}/>;
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
function LocalSnippetsSheet({ theme, onInsert }: { theme: Theme; onInsert: (text: string) => void }) {
    const [snippets, setSnippets, ready, readState] = useStored<Snippet[] | undefined>("prompt-snippets", undefined);
    const list = snippets ?? STARTER;
    const [query, setQuery] = useState(""), [editing, setEditing] = useState<Snippet>();
    const save = (next: Snippet[]) => setSnippets(next);
    if (!ready) return <StoredReadStatus theme={theme} name="本机片段" state={readState}/>;
    if (editing) return <View style={{ gap: space.sm }}>
      <TextInput accessibilityLabel="片段名称" value={editing.title} onChangeText={title => setEditing({ ...editing, title })} placeholder="名称" placeholderTextColor={theme.muted} style={[ui.field, { color: theme.text, borderColor: theme.border }]} />
      <TextInput accessibilityLabel="片段内容" value={editing.text} onChangeText={text => setEditing({ ...editing, text })} multiline placeholder="插入到输入框的内容" placeholderTextColor={theme.muted} style={[ui.field, { minHeight: 140, textAlignVertical: "top", color: theme.text, borderColor: theme.border }]} />
      <View style={[ui.row, { flexWrap: "wrap", gap: space.sm }]}>
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

type SnippetClient = Pick<ReturnType<typeof useRemote>, "query" | "host">;
type ComputerSnippet = Pick<PromptSnippet, "id" | "title" | "body">;
const snippetOwner = (client?: SnippetClient) => JSON.stringify([client?.host?.id, client?.host?.fingerprint, client?.host?.host]);

function withinSnippetLimit(text: string): boolean {
    if (text.length > 65_536) return false;
    let bytes = 0;
    for (const point of text) {
        const code = point.codePointAt(0)!;
        bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
        if (bytes > 65_536) return false;
    }
    return true;
}

function readComputerSnippets(result: unknown): ComputerSnippet[] {
    const unavailable = () => new Error("当前电脑的片段库暂不可用，请更新电脑端后重试。");
    if (!result || typeof result !== "object" || !("supported" in result) || result.supported !== true || !("items" in result) || !Array.isArray(result.items) || result.items.length > 200) throw unavailable();
    const ids = new Set<string>();
    return result.items.map((item: unknown) => {
        if (!item || typeof item !== "object" || !("id" in item) || typeof item.id !== "string" || !item.id.trim() || item.id.length > 128 || ids.has(item.id) ||
            !("title" in item) || typeof item.title !== "string" || !item.title.trim() || item.title.length > 400 || [...item.title.trim()].length > 100 ||
            !("body" in item) || typeof item.body !== "string" || !item.body.trim() || !withinSnippetLimit(item.body) || /\0/.test(item.id + item.title + item.body)) throw unavailable();
        ids.add(item.id);
        return { id: item.id, title: item.title, body: item.body };
    });
}

/** Computer snippets are explicitly opened and never overwrite or upload the phone's library. */
export function SnippetsSheet(props: { theme: Theme; onInsert(text: string): void; client?: SnippetClient }) {
    // Remount before rendering a different owner: effects must not briefly read the new host
    // just because the previous host's computer tab was selected.
    return <SnippetPicker key={snippetOwner(props.client)} {...props}/>;
}

function SnippetPicker({ theme, onInsert, client }: { theme: Theme; onInsert(text: string): void; client?: SnippetClient }) {
    const [scope, setScope] = useState("phone");
    const [template, setTemplate] = useState<string>();
    const [values, setValues] = useState<Record<string, string>>({});
    const active = useRef(true);
    useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
    const insert = (text: string) => { if (active.current) onInsert(text); };
    const choose = (text: string) => {
        if (!active.current) return;
        if (promptSnippetVariables(text).length) { setTemplate(text); setValues({}); }
        else insert(text);
    };
    if (template !== undefined) {
        // Bound expansion before building the result, including templates that repeat a variable.
        let length = template.length;
        for (const match of template.matchAll(/\{\{([^{}\r\n]+)\}\}/gu)) {
            const name = match[1]!.trim(), value = Object.hasOwn(values, name) ? values[name] : undefined;
            if (name && value?.trim()) length += value.length - match[0].length;
        }
        const filled = length <= 65_536 ? fillPromptSnippet(template, values) : { text: "", missing: [] };
        const tooLarge = length > 65_536 || !withinSnippetLimit(filled.text);
        return <View style={{ gap: space.sm }}>
          {promptSnippetVariables(template).map(name => <View key={name} style={{ gap: space.xs }}><Text style={{ color: theme.text, fontSize: font.body }}>{name}</Text><TextInput accessibilityLabel={`填写 ${name}`} value={Object.hasOwn(values, name) ? values[name] : ""} maxLength={8192} onChangeText={value => setValues(current => ({ ...current, [name]: value }))} style={[ui.field, { color: theme.text, borderColor: theme.border }]}/></View>)}
          <Text style={{ color: theme.muted, fontSize: font.small }}>填写后插入草稿，可编辑后再发送。</Text>
          {tooLarge ? <Text accessibilityRole="alert" style={{ color: theme.danger, fontSize: font.small }}>填写后的片段超过 64 KiB，请缩短变量内容。</Text> : <Text selectable style={{ color: theme.muted, fontSize: font.small }} numberOfLines={8}>{filled.text}</Text>}
          <View style={[ui.row, { flexWrap: "wrap", gap: space.sm }]}><Button compact title="返回" theme={theme} onPress={() => setTemplate(undefined)}/><Button compact primary title="插入草稿" theme={theme} disabled={tooLarge || filled.missing.length > 0} onPress={() => { if (!tooLarge && !filled.missing.length) insert(filled.text); }}/></View>
        </View>;
    }
    return <View style={{ gap: space.md }}>
      {client?.host ? <Segmented theme={theme} value={scope} onChange={setScope} items={[["phone", "这部手机"], ["computer", "当前电脑"]]}/> : null}
      {scope === "computer" && client?.host ? <ComputerSnippets client={client} theme={theme} onInsert={choose}/> : <LocalSnippetsSheet theme={theme} onInsert={choose}/>}
    </View>;
}

function ComputerSnippets({ client, theme, onInsert }: { client: SnippetClient; theme: Theme; onInsert(text: string): void }) {
    const [items, setItems] = useState<ComputerSnippet[]>([]), [error, setError] = useState("");
    const available = useRef<ComputerSnippet[]>([]);
    const [loading, setLoading] = useState(true), [retry, setRetry] = useState(0), [query, setQuery] = useState("");
    useEffect(() => {
        let alive = true; setLoading(true); setError(""); setItems([]); available.current = [];
        void client.query<unknown>("prompt-snippets").then(result => {
            if (!alive) return;
            const next = readComputerSnippets(result);
            available.current = next; setItems(next);
        }).catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : String(reason)); }).finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; available.current = []; };
    }, [client.query, retry]);
    const shown = items.filter(item => snippetMatches({ ...item, text: item.body }, query));
    return <View style={{ gap: space.sm }}>
      <Text style={{ color: theme.muted, fontSize: font.small }}>读取当前电脑的片段，选择后只插入草稿。手机本地片段不会上传。</Text>
      <SearchField theme={theme} value={query} onChangeText={setQuery} placeholder="搜索电脑片段" accessibilityLabel="搜索电脑片段"/>
      {error ? <Text accessibilityRole="alert" style={{ color: theme.muted }}>{error}</Text> : null}
      {loading ? <Text style={{ color: theme.muted, fontSize: font.small }}>正在读取…</Text> : <Section theme={theme}>
        {shown.map(item => <ListRow key={item.id} theme={theme} title={item.title} detail={item.body.slice(0, 100)} chevron={false} accessibilityLabel={`插入电脑片段：${item.title}`} onPress={() => { if (available.current.includes(item)) onInsert(item.body); }}/>) }
        {!shown.length && !error ? <ListRow theme={theme} title={items.length ? "没有匹配的电脑片段" : "还没有电脑片段"} detail={items.length ? "试试其他搜索词。" : "在电脑输入框的片段库中保存后，这里即可使用。"}/> : null}
      </Section>}
      <Button compact title="刷新电脑片段" theme={theme} disabled={loading} onPress={() => setRetry(value => value + 1)}/>
    </View>;
}

/** Bookmarked messages for the current computer; opening one jumps to the message. */
export function BookmarksSheet({ storageKey, theme, onOpen }: { storageKey?: string; theme: Theme; onOpen: (bookmark: Bookmark) => void }) {
    const [bookmarks, setBookmarks, ready, readState] = useStored<Bookmark[]>(storageKey, []);
    if (!ready) return <StoredReadStatus theme={theme} name="本机书签" state={readState}/>;
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
