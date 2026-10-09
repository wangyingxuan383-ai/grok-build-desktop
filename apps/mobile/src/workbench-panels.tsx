import { MOBILE_VERSION, MATCHING_DESKTOP_VERSION } from "./version";
import React, { useEffect, useState } from "react";
import { Linking, Platform, ScrollView, Switch, Text, TextInput, View } from "react-native";
import * as FS from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Notifications from "expo-notifications";
import { Button, Card, ui, type Theme, SearchField } from "./ui";
import { clearCache, savedRead, savedWrite } from "./cache";
import { setMonitoring, monitoringStatus, discoverComputers, api, pushToken, cacheUsage, type HostConnection } from "./transport";
import { mobileVersionIsNewer } from "./experience-model";
import { useOverview } from "./task-workspace";
import { confirm } from "./forms";
import { selectComposerCommand } from "../../../src/shared/composer-capability";
import type { useRemote } from "./use-remote";
import type { PromptQueueEntry, SessionMcpToolSnapshot, SkillSummary, ComputerCapability, RewindPoint, CliSessionInfo, TokenActivityReport, GrokQuotaSnapshot, QuotaWindow, SessionCompactionPolicy, AutomaticUpdateCheckResult, AppReleaseStatus } from "../../../src/shared/types";
type Client = ReturnType<typeof useRemote>;
export function CapabilitiesPanel({ client, theme, close }: {
    client: Client;
    theme: Theme;
    close: () => void;
}) {
    const [value, setValue] = useState<{
        tools: SessionMcpToolSnapshot;
        skills: SkillSummary[];
        computer: ComputerCapability;
    }>(), [search, setSearch] = useState(""), [error, setError] = useState("");
    useEffect(() => { void client.query<typeof value>("tools", { sessionId: client.sessionId }).then(setValue).catch(e => setError(String(e))); }, [client.sessionId]);
    const commands = client.snapshot?.runtime?.commands ?? [];
    const select = (name: string) => { client.setDraft(selectComposerCommand(client.draft, name, commands.map(c => c.name))); close(); };
    return <View style={{ gap: 12 }}><TextInput accessibilityLabel="搜索命令与能力" placeholder="命令 / Skill / MCP 工具" placeholderTextColor={theme.muted} value={search} onChangeText={setSearch} style={[ui.field, { color: theme.text, borderColor: theme.border }]}/>{error ? <Text style={{ color: theme.danger }}>{error}</Text> : null}{client.composer.toolSelection ? <Button compact title="取消本条 MCP 选择" theme={theme} onPress={() => client.setComposer({ ...client.composer, toolSelection: undefined })}/> : null}<Text style={[ui.section, { color: theme.muted }]}>当前 CLI 命令</Text>{commands.filter(c => (c.name + " " + c.description).toLowerCase().includes(search.toLowerCase())).map(c => <Button key={c.name} title={`/${c.name} · ${c.description || "填写参数后发送"}`} theme={theme} onPress={() => select(c.name)}/>)}{!commands.length ? <Text style={[ui.hint, { color: theme.muted }]}>当前会话没有上报命令目录；重新连接原会话后可刷新。</Text> : null}<Text style={[ui.section, { color: theme.muted }]}>Skill</Text>{value?.skills.filter(s => (s.name + " " + s.description).toLowerCase().includes(search.toLowerCase())).map(skill => <Button key={skill.command} title={skill.name} theme={theme} onPress={() => select(skill.command)}/>)}<Text style={[ui.section, { color: theme.muted }]}>已连接 MCP 工具</Text>{value?.tools.tools.filter(t => (t.selection.toolName + " " + t.description).toLowerCase().includes(search.toLowerCase())).map(tool => <Button key={tool.selection.serverName + tool.selection.toolName} title={`${tool.selection.serverName} · ${tool.selection.toolName}`} theme={theme} onPress={() => { client.setComposer({ ...client.composer, toolSelection: tool.selection }); close(); }}/>)}{value?.tools.notice ? <Text style={[ui.hint, { color: theme.muted }]}>{value.tools.notice}</Text> : null}<Text style={[ui.hint, { color: theme.muted }]}>Computer {value?.computer.available ? "组件可用" : "当前不可用/待检查"}。选择能力不改变服务端权限；只有实际事件才能证明调用。</Text></View>;
}
export function ContextPanel({ client, theme, close, forked }: {
    client: Client;
    theme: Theme;
    close: () => void;
    forked: (receipt: import("../../../src/shared/remote").RemoteReceipt) => void;
}) {
    const [points, setPoints] = useState<RewindPoint[]>([]), [info, setInfo] = useState<CliSessionInfo & {compaction?:SessionCompactionPolicy}>(), [threshold, setThreshold] = useState("80"), [error, setError] = useState("");
    useEffect(() => { void client.query<RewindPoint[]>("rewind", { sessionId: client.sessionId }).then(setPoints).catch(e => setError(String(e))); void client.query<CliSessionInfo & {compaction?:SessionCompactionPolicy}>("context", { sessionId: client.sessionId }).then(value => { setInfo(value); setThreshold(String(value.compaction?.thresholdPercent ?? 80)); }).catch(() => undefined); }, [client.sessionId, client.receipt?.state]);
    const disabled = client.busy || !!client.unknown || client.connection.phase !== "online";
    return <View style={{ gap: 12 }}><Text style={[ui.title, { color: theme.text }]}>上下文与分支</Text>{info ? <Text selectable style={[ui.hint, { color: theme.muted }]}>上下文窗口 {info.contextWindowTokens?.toLocaleString() ?? "未知"}{"\n"}已占用 {info.contextUsedTokens?.toLocaleString() ?? "未知"} · {info.contextUsagePercent !== undefined ? info.contextUsagePercent.toFixed(1) + "%" : "占用率未知"}{"\n"}压缩次数 {info.compactionCount ?? "未知"}</Text> : null}<Button title="压缩当前上下文" theme={theme} disabled={disabled} onPress={() => confirm("压缩当前上下文？", "沿用 CLI 原生压缩合同，结果通过会话状态确认。", () => void client.perform("compact"))}/><Text style={[ui.hint, {color:theme.muted}]}>自动压缩策略：{info?.compaction?.mode === "custom" ? `${info.compaction.thresholdPercent}%` : "沿用 CLI"}。改动后以电脑配置为准。</Text><View style={[ui.row,{flexWrap:"wrap"}]}><Button compact title="沿用 CLI 自动压缩" theme={theme} disabled={disabled} onPress={() => void client.mutate("session.compaction", client.sessionId,{mode:"inherit"})}/><TextInput accessibilityLabel="自动压缩阈值百分比" value={threshold} onChangeText={setThreshold} keyboardType="numeric" style={[ui.field,{color:theme.text,borderColor:theme.border,width:90}]}/><Button compact title="设置阈值" theme={theme} disabled={disabled || !/^\d{2}$/.test(threshold) || Number(threshold)<60 || Number(threshold)>95} onPress={() => void client.mutate("session.compaction",client.sessionId,{mode:"custom",thresholdPercent:Number(threshold)})}/></View><Text style={[ui.hint,{color:theme.muted}]}>建立无旧上下文的任务请使用「新建会话」；旧历史不会删除。</Text><Button title="从当前上下文创建分支" theme={theme} disabled={disabled} onPress={() => void client.perform("fork").then(value => { if(value && value.state !== "failed") {forked(value); close();} })}/>{error ? <Text style={[ui.hint, { color: theme.muted }]}>{error}</Text> : null}{points.map(point => <Button key={point.id} title={`从此处建立分支 · ${point.label || point.id}`} theme={theme} disabled={disabled} onPress={() => void client.perform("fork", { pointId: point.id }).then(value => {if(value && value.state !== "failed") {forked(value); close();} })}/>)}<Text style={[ui.hint, { color: theme.muted }]}>分支保留原会话。对话上下文变化不等同于撤销磁盘文件。</Text></View>;
}
export function SearchPanel({ client, theme, close }: {
    client: Client;
    theme: Theme;
    close: () => void;
}) { const [q, setQ] = useState(""), [results, setResults] = useState<Array<{
    index: number;
    type: string;
    text: string;
}>>(), [loading, setLoading] = useState(false), [error, setError] = useState(""); const search = async () => { setLoading(true); setError(""); try {
    const value = await client.query<{
        matches: NonNullable<typeof results>;
    }>("search", { sessionId: client.sessionId, q });
    setResults(value.matches);
}
catch (e) {
    setError(String(e));
}
finally {
    setLoading(false);
} }; return <View style={{ gap: 12 }}><SearchField theme={theme} accessibilityLabel="搜索完整会话" value={q} onChangeText={setQ} placeholder="搜索电脑保存的完整历史" /><Button title={loading ? "搜索中…" : "搜索完整历史"} theme={theme} disabled={loading || !q.trim()} onPress={() => void search()}/>{error ? <Text style={{ color: theme.danger }}>{error}</Text> : null}{results?.length === 0 ? <Text style={{ color: theme.muted }}>未找到匹配内容。</Text> : null}{results?.map(result => <Card key={result.index} theme={theme}><Text selectable style={{ color: theme.text, lineHeight: 23 }}>{result.text}</Text><View style={ui.row}><Button compact title="定位到会话" theme={theme} onPress={() => void client.loadAround(result.index).then(close).catch(e => setError(String(e)))}/><Button compact title="引用到输入框" theme={theme} onPress={() => { client.setDraft(client.draft + `\n\n> ${result.text.replaceAll("\n", "\n> ")}\n`); close(); }}/></View></Card>)}</View>; }
export function UsagePanel({ client, theme }: {
    client: Client;
    theme: Theme;
}) { const [value, setValue] = useState<{
    history: TokenActivityReport;
    process?: Record<string, unknown>;
}>(), [error, setError] = useState(""); useEffect(() => { void client.query<typeof value>("usage", { sessionId: client.sessionId }).then(setValue).catch(e => setError(String(e))); }, [client.sessionId]); return <View style={{ gap: 12 }}><Text style={[ui.title, { color: theme.text }]}>用量与来源</Text>{error ? <Text style={{ color: theme.danger }}>{error}</Text> : null}{value ? <><Text style={[ui.hint, { color: theme.muted }]}>本电脑历史汇总 · {value.history.timeZone} · {new Date(value.history.generatedAt).toLocaleString()}</Text>{Object.entries(value.history.windows).map(([key, window]) => <Card key={key} theme={theme}><Text style={[ui.title, { color: theme.text }]}>{({ today: "今天", rolling24h: "最近 24 小时", rolling7d: "最近 7 天", rolling30d: "最近 30 天", all: "全部历史" } as Record<string, string>)[key] || key}</Text><Text style={[ui.hint, { color: theme.text }]}>总 Token {window.turnsWithTotal ? window.totalTokens.toLocaleString() : window.turns ? "未完整上报" : "0"}{"\n"}输入 {window.inputTokens.toLocaleString()} · 输出 {window.outputTokens.toLocaleString()}{"\n"}子智能体单列 {window.subagentTokens.toLocaleString()}{"\n"}用量覆盖 {window.turnsWithUsage}/{window.turns} 回合</Text></Card>)}<Text style={[ui.section, { color: theme.muted }]}>当前进程 / 会话原生上报</Text>{value.process ? Object.entries(value.process).filter(([, v]) => typeof v === "number" || typeof v === "string").map(([key, v]) => <Text key={key} style={[ui.hint, { color: theme.muted }]}>{key}：{String(v)}</Text>) : null}</> : null}<QuotaPanel client={client} theme={theme}/><Text style={[ui.hint, { color: theme.muted }]}>统计文件不保存提示词正文；输入 Token 按原上报计入。父子用量不自行相加，本机历史不等于账号额度。</Text></View>; }
export function QueueEditor({ client, theme, entry, count = 0 }: {
    client: Client;
    theme: Theme;
    entry: PromptQueueEntry;
    count?: number;
}) { const [text, setText] = useState(entry.text); const disabled = client.busy || !!client.unknown || entry.state !== "queued"; return <Card theme={theme}><Text style={[ui.hint, { color: theme.muted }]}>队列 {entry.position + 1} · 原会话配置</Text><TextInput multiline accessibilityLabel="编辑排队消息" value={text} onChangeText={setText} style={[ui.field, { minHeight: 90, color: theme.text, borderColor: theme.border }]}/><View style={[ui.row, { flexWrap: "wrap" }]}><Button compact title="保存修改" theme={theme} disabled={disabled || !text.trim()} onPress={() => void client.perform("queue-edit", { queueId: entry.id, text })}/><Button compact title="置顶" theme={theme} disabled={disabled || entry.position === 0} onPress={() => void client.perform("queue-move", { queueId: entry.id, position: 0 })}/><Button compact title="上移" theme={theme} disabled={disabled || entry.position === 0} onPress={() => void client.perform("queue-move", { queueId: entry.id, position: entry.position - 1 })}/><Button compact title="下移" theme={theme} disabled={disabled || entry.position >= count - 1} onPress={() => void client.perform("queue-move", { queueId: entry.id, position: entry.position + 1 })}/><Button compact title="移除" theme={theme} disabled={disabled} onPress={() => void client.perform("queue-remove", { queueId: entry.id })}/></View></Card>; }
function QuotaPanel({ client, theme }: {
    client: Client;
    theme: Theme;
}) { const [value, setValue] = useState<GrokQuotaSnapshot>(), [error, setError] = useState(""), [loading, setLoading] = useState(false); const refresh = async () => { setLoading(true); try {
    setValue(await client.query<GrokQuotaSnapshot>("quota", { refresh: "1" }));
    setError("");
}
catch (error) {
    setError(String(error));
}
finally {
    setLoading(false);
} }; const windows: QuotaWindow[] = [value?.rolling24h, value?.currentAllowance, value?.payAsYouGo].filter((window): window is QuotaWindow => !!window); return <Card theme={theme}><Text style={[ui.title, { color: theme.text }]}>电脑当前账号额度</Text><Button compact title={loading ? "查询中…" : "刷新官方用量"} theme={theme} disabled={loading} onPress={() => void refresh()}/>{error ? <Text style={[ui.hint, { color: theme.danger }]}>{error}</Text> : null}{value ? <Text style={[ui.hint, { color: theme.muted }]}>{value.subscriptionTier || "订阅等级未上报"} · {new Date(value.fetchedAt).toLocaleString()}{value.stale ? " · 旧缓存" : ""}{value.partial ? " · 部分数据" : ""}</Text> : null}{windows.map((window, index) => <Text key={index} style={[ui.hint, { color: theme.text }]}>{window.label}：已用 {window.used ?? "未知"} / {window.limit ?? "未知"} {window.unit} · 剩余 {window.remaining ?? "未知"}{window.resetAt ? "\n下次更新 " + new Date(window.resetAt).toLocaleString() : ""}</Text>)}<Text style={[ui.hint, { color: theme.muted }]}>账号额度与本机 Token 历史分别统计；没有确认的额度重置合同不提供执行按钮。</Text></Card>; }
