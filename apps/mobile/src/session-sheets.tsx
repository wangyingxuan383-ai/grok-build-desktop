import React, { useEffect, useState } from "react";
import { BookmarksSheet, SnippetsSheet, type Bookmark } from "./library";
import { insertSnippet } from "./library-model";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { Button, Card, IconButton, ListRow, Section, Segmented, font, space, ui, type Theme } from "./ui";
import { ConfigurationPicker, AttachmentsPanel, QueryPanel } from "./workbench";
import { CapabilitiesPanel, ContextPanel, QueueEditor, SearchPanel, UsagePanel } from "./workbench-panels";
import { CodeImage } from "./code-image";
import { NewSession, Interaction, confirm } from "./forms";
import { SessionRow, type Preferences } from "./screens";
import { densityLabels, type Density } from "./conversation";
import type { ConversationRow } from "./remote-model";
import type { useRemote } from "./use-remote";
import type { RemoteReceipt, RemoteSession } from "../../../src/shared/remote";
import type { PromptQueueEntry } from "../../../src/shared/types";
type Client = ReturnType<typeof useRemote>;
export type Sheet = "snippets" | "bookmarks" | "new" | "manage" | "find" | "pending" | "queue" | "children" | "details" | "config" | "attachments" | "actions" | "tools" | "files" | "review" | "usage" | "context" | "code-image" | null;
const titles: Record<NonNullable<Sheet>, string> = { snippets: "提示词片段", bookmarks: "消息书签", new: "新建会话", manage: "会话操作", find: "搜索当前消息", pending: "待处理请求", queue: "消息队列", children: "子会话", details: "会话信息", config: "模型与配置", attachments: "材料与附件", actions: "会话工具", tools: "命令与能力", context: "上下文与分支", files: "项目文件", review: "代码改动", usage: "用量统计", "code-image": "编程时生成图片" };
export function SheetHost({ sheet, setSheet, openSheet, theme, client, selected, rows, queue, children, actionsDisabled, preferences, setPreferences, openSession, openFile, density, setDensity, onCreated, onForked, onBookmark }: {
    onBookmark: (bookmark: Bookmark) => void;
    sheet: Sheet;
    setSheet: (sheet: Sheet) => void;
    /** App-level open: dismisses the keyboard and prefetches options where needed. */
    openSheet: (sheet: Sheet) => void;
    theme: Theme;
    client: Client;
    selected?: RemoteSession;
    rows: ConversationRow[];
    queue: PromptQueueEntry[];
    children: RemoteSession[];
    actionsDisabled: boolean;
    preferences: Preferences;
    setPreferences: React.Dispatch<React.SetStateAction<Preferences>>;
    openSession: (id: string, child?: boolean) => void;
    openFile: (path: string) => void;
    density: Density;
    setDensity: (value: Density) => void;
    onCreated: (value: RemoteReceipt) => void;
    onForked: (value: RemoteReceipt) => void;
}) {
    const [directory, setDirectory] = useState("");
    useEffect(() => { setDirectory(""); }, [client.sessionId, client.host?.fingerprint]);
    // Sheets reached from another sheet show a back arrow to where the user came from.
    const [parent, setParent] = useState<Sheet>(null);
    useEffect(() => { if (!sheet) setParent(null); }, [sheet]);
    const close = () => setSheet(null);
    const go = (next: Sheet) => { setParent(sheet); openSheet(next); };
    const back = () => { const target = parent; setParent(null); setSheet(target); };
    return <Modal visible={sheet !== null} transparent animationType="slide" onRequestClose={() => parent ? back() : close()}>
      <View style={ui.modal}>
        <Pressable style={{ flex: 1 }} accessibilityLabel="关闭面板" onPress={close} />
        <SafeAreaView edges={["bottom"]} style={[ui.sheet, { backgroundColor: theme.surface }]}>
          <View style={{ alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border }} />
          <View style={[ui.row, { gap: 2 }]}>
            {parent ? <IconButton label="返回上一面板" icon="‹" theme={theme} onPress={back} /> : null}
            <Text style={[ui.title, { flex: 1, color: theme.text }]}>{sheet ? titles[sheet] : ""}</Text>
            <IconButton label="关闭面板" icon="×" theme={theme} onPress={close} />
          </View>
          {client.error ? <Text selectable style={[ui.hint, { color: theme.danger }]}>{client.error}</Text> : null}
          {client.notice ? <Text style={[ui.hint, { color: theme.accent }]}>{client.notice}</Text> : null}
          <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }} contentContainerStyle={{ gap: space.md, paddingBottom: space.sm }}>
            {sheet === "new" ? <NewSession client={client} theme={theme} disabled={actionsDisabled} close={close} created={onCreated} /> : null}
            {sheet === "config" ? <ConfigurationPicker client={client} theme={theme} /> : null}
            {sheet === "snippets" ? <SnippetsSheet theme={theme} onInsert={text => { client.setDraft(insertSnippet(client.draft, text)); close(); }} /> : null}
            {sheet === "bookmarks" ? <BookmarksSheet storageKey={client.host ? client.host.fingerprint + ":bookmarks" : undefined} theme={theme} onOpen={bookmark => { close(); onBookmark(bookmark); }} /> : null}
            {sheet === "actions" ? <ToolsMenu theme={theme} open={go} childCount={children.length} /> : null}
            {sheet === "code-image" ? <CodeImage client={client} theme={theme} /> : null}
            {sheet === "attachments" ? <AttachmentsPanel client={client} theme={theme} /> : null}
            {sheet === "tools" ? <CapabilitiesPanel client={client} theme={theme} close={close} /> : null}
            {sheet === "context" ? <ContextPanel client={client} theme={theme} close={close} forked={onForked} /> : null}
            {sheet === "usage" ? <UsagePanel client={client} theme={theme} /> : null}
            {sheet === "review" ? <QueryPanel client={client} theme={theme} kind="review" onFile={openFile} /> : null}
            {sheet === "files" ? <>{directory ? <Button compact title="‹ 项目根目录" theme={theme} onPress={() => setDirectory("")} /> : null}<QueryPanel client={client} theme={theme} kind="files" params={{ path: directory }} onFile={(path, kind) => kind === "directory" ? setDirectory(path) : openFile(path)} onReference={(path, kind) => { const workspace = client.options?.workspaces.find(w => w.path === selected?.cwd); if (!workspace) { client.setError("引用项目尚未同步，请刷新项目列表"); return; } client.setComposer({ ...client.composer, references: [...(client.composer.references || []), { workspaceId: workspace.id, path, kind }] }); client.setNotice("已加入本条消息的文件 / 文件夹引用"); }} /></> : null}
            {sheet === "manage" ? <ManageSheet theme={theme} client={client} selected={selected} rows={rows} actionsDisabled={actionsDisabled} preferences={preferences} setPreferences={setPreferences} open={go} close={close} density={density} setDensity={setDensity} /> : null}
            {sheet === "details" ? (<Card theme={theme}>
                <Text style={[ui.hint, { color: theme.muted }]}>电脑项目目录</Text>
                <Text selectable style={{ color: theme.text, lineHeight: 23 }}>{selected?.cwd}</Text>
                <Button compact title="复制项目路径" theme={theme} onPress={() => void Clipboard.setStringAsync(selected?.cwd || "").then(() => client.setNotice("项目路径已复制"))} />
                <Text style={[ui.hint, { color: theme.muted }]}>
                  模型：{selected?.modelId || "沿用电脑配置"}{"\n"}模式：{selected?.mode || "以实际执行配置为准"}{"\n"}{selected?.canSend === false ? "此会话只读，由原执行器管理" : "可在手机继续对话"}
                </Text>
              </Card>) : null}
            {sheet === "find" ? <SearchPanel client={client} theme={theme} close={close} /> : null}
            {sheet === "pending" ? (client.snapshot?.pending.length ? client.snapshot.pending.map((event) => <Interaction key={event.type === "permission" ? String(event.request.requestId) : "requestId" in event ? String(event.requestId) : event.type} event={event} theme={theme} disabled={actionsDisabled || selected?.canSend === false} submit={(action, extra) => void client.perform(action, extra)} />) : <Text style={{ color: theme.muted }}>目前没有待处理请求。</Text>) : null}
            {sheet === "queue" ? <>
                <Button compact danger title="清空未执行队列" theme={theme} disabled={actionsDisabled || !queue.length} onPress={() => confirm("清空队列？", "当前回合继续执行，仅移除未执行消息。", () => void client.perform("queue-clear"))} />
                {queue.map((entry) => <QueueEditor key={entry.id} entry={entry} theme={theme} client={client} count={queue.length} />)}
                {!queue.length ? <Text style={{ color: theme.muted }}>队列为空。</Text> : null}
              </> : null}
            {sheet === "children" ? (children.length ? children.map((child) => <SessionRow key={child.id} session={child} theme={theme} onOpen={() => openSession(child.id, true)} />) : <Text style={{ color: theme.muted }}>此会话还没有子会话。</Text>) : null}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>;
}
function ToolsMenu({ theme, open, childCount }: { theme: Theme; open: (sheet: Sheet) => void; childCount: number }) {
    return <Section theme={theme}>
      <ListRow theme={theme} title="提示词片段" detail="插入常用指令，编辑后再发送" onPress={() => open("snippets")} />
      <ListRow theme={theme} title="命令与能力" detail="斜杠命令、Skills 与 MCP 工具" onPress={() => open("tools")} />
      <ListRow theme={theme} title="项目文件" detail="浏览、预览并引用到本条消息" onPress={() => open("files")} />
      <ListRow theme={theme} title="生成项目图片" detail="在当前编程会话中生成图片" onPress={() => open("code-image")} />
      <ListRow theme={theme} title="代码改动" detail="查看本会话涉及的文件差异" onPress={() => open("review")} />
      <ListRow theme={theme} title="上下文与分支" detail="压缩上下文或从此处分叉" onPress={() => open("context")} />
      <ListRow theme={theme} title="子智能体" value={childCount ? String(childCount) : undefined} onPress={() => open("children")} />
      <ListRow theme={theme} title="用量统计" onPress={() => open("usage")} />
    </Section>;
}
function ManageSheet({ theme, client, selected, rows, actionsDisabled, preferences, setPreferences, open, close, density, setDensity }: {
    theme: Theme; client: Client; selected?: RemoteSession; rows: ConversationRow[]; actionsDisabled: boolean; preferences: Preferences; setPreferences: React.Dispatch<React.SetStateAction<Preferences>>; open: (sheet: Sheet) => void; close: () => void; density: Density; setDensity: (value: Density) => void;
}) {
    const [title, setTitle] = useState(selected?.title || "");
    const id = client.sessionId, favorite = preferences.favorites.includes(id), muted = preferences.mutedSessions.includes(id);
    const canRename = !actionsDisabled && !!title.trim() && title.trim() !== selected?.title && !!client.options?.capabilities.includes("session.rename");
    return <>
      <Section theme={theme} title="阅读">
        <View style={{ padding: space.md, gap: space.sm }}>
          <Text style={{ color: theme.muted, fontSize: font.caption }}>阅读密度</Text>
          <Segmented theme={theme} value={density} onChange={setDensity} items={(Object.keys(densityLabels) as Density[]).map(value => [value, densityLabels[value]] as const)} />
        </View>
        <ListRow theme={theme} title="搜索消息" onPress={() => open("find")} />
        <ListRow theme={theme} title="复制当前对话" detail="仅复制已加载到手机的内容" onPress={() => { const value = rows.filter((r) => r.message).map((r) => `${r.message!.role === "user" ? "你" : "Grok"}\n${r.message!.text}`).join("\n\n"); void Clipboard.setStringAsync(value).then(() => client.setNotice("已复制当前加载的对话")); close(); }} />
        <ListRow theme={theme} title="会话信息" onPress={() => open("details")} />
      </Section>
      <Section theme={theme} title="会话" footer="收藏和提醒只影响这台手机；改名、归档和删除同步到电脑。">
        <View style={{ padding: space.md, gap: space.sm }}>
          <TextInput accessibilityLabel="会话名称" value={title} onChangeText={setTitle} maxLength={100} style={[ui.field, { color: theme.text, borderColor: theme.border }]} />
          {title.trim() !== (selected?.title || "") ? <Button compact primary title="保存名称" theme={theme} disabled={!canRename} onPress={() => void client.perform("rename", { title }).then((result) => { if (result) close(); })} /> : null}
        </View>
        <ListRow theme={theme} title={favorite ? "取消收藏" : "收藏会话"} onPress={() => { setPreferences((p) => ({ ...p, favorites: favorite ? p.favorites.filter((v) => v !== id) : [id, ...p.favorites].slice(0, 500) })); close(); }} />
        <ListRow theme={theme} title={muted ? "恢复此会话提醒" : "静音此会话提醒"} onPress={() => setPreferences(p => ({ ...p, mutedSessions: muted ? p.mutedSessions.filter(v => v !== id) : [...p.mutedSessions, id] }))} />
        <ListRow theme={theme} title={selected?.archived ? "恢复归档" : "归档会话"} disabled={actionsDisabled || !client.options?.capabilities.includes("session.archive")} onPress={() => void client.perform("archive", { archived: !selected?.archived }).then((result) => { if (result) close(); })} />
      </Section>
      <Section theme={theme} title="执行">
        <ListRow theme={theme} title="模型与配置" onPress={() => open("config")} />
        <ListRow theme={theme} title="上下文 / 分支" onPress={() => open("context")} />
        <ListRow theme={theme} title="查看代码改动" onPress={() => open("review")} />
        <ListRow theme={theme} title="用量统计" onPress={() => open("usage")} />
      </Section>
      <Section theme={theme}>
        <ListRow theme={theme} danger title="删除会话" detail="使用电脑原删除流程，保留项目磁盘文件" disabled={actionsDisabled} onPress={() => confirm("删除这个会话？", "使用电脑原删除流程，保留项目磁盘文件。", () => void client.perform("delete").then(() => close()))} />
      </Section>
    </>;
}
