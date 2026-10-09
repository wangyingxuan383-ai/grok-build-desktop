import { pickDate, pickTime } from "./transport";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Banner, Button, Card, Chip, EmptyState, ListRow, Segmented, font, space, ui, type Theme, Toggle as AccentSwitch, SubpageHeader, SearchField } from "./ui";
import { savedDelete, savedRead, savedWrite } from "./cache";
import { haptic } from "./haptics";
import { useBackLayer } from "./back-layers";
import { Icon } from "./icons";
import { addDays, buildSchedule, describeChanges, describeSchedule, initialWorkspace, isDate, isTime, rankSessions, samePath, shiftTime, splitInstant, workspaceForUpdate, type ScheduleKind } from "./task-form-model";
import { ConfigurationPicker, type Configuration } from "./workbench";
import { confirm } from "./forms";
import type { useRemote } from "./use-remote";
import type { AutomationTask, AccountProfile } from "../../../src/shared/types";
type Client = ReturnType<typeof useRemote>;
export { useOverview, type Overview } from "./use-overview";
import { useOverview } from "./use-overview";
const labels: Record<string, string> = { queued: "排队", running: "执行中", working: "执行中", awaiting: "等待", "awaiting-confirmation": "待确认", "needs-user": "待回应", completed: "完成", failed: "失败", cancelled: "取消", skipped: "跳过" };
export function TaskWorkspace({ client, theme, onOpen, initialTab }: {
    client: Client;
    theme: Theme;
    onOpen: (id: string) => void;
    initialTab?: string;
}) {
    const overview = useOverview(client), [refreshing, setRefreshing] = useState(false), [tab, setTab] = useState(initialTab || "active"), [editing, setEditing] = useState<AutomationTask | "new">(), [detail, setDetail] = useState<AutomationTask>(), [search,setSearch]=useState("");
    const disabled = client.busy || !!client.unknown || client.connection.phase !== "online";
    if (editing)
        return <AutomationEditor key={typeof editing === "string" ? editing : editing.id} client={client} theme={theme} task={typeof editing === "string" ? undefined : editing} accounts={overview.value?.accounts || []} close={() => { setEditing(undefined); void overview.refresh(); }} onSaved={id => { void overview.refresh().then(() => { const saved = overview.value?.automations?.find(t => t.id === id); if (saved?.nextRunAt) client.setNotice(`任务已注册，下次运行 ${new Date(saved.nextRunAt).toLocaleString()}`); else client.setNotice("任务已保存，电脑已确认调度注册。"); }); }}/>;
    const unread = (overview.value?.inbox ?? []).filter(item => !item.read).length, running = client.sessions.filter(session => ["working", "queued", "needs-user"].includes(session.status)).length + (overview.value?.tasks?.length ?? 0);
    return <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void overview.refresh().finally(() => setRefreshing(false)); }}/>}><Segmented theme={theme} value={tab} onChange={id => { setTab(id); setDetail(undefined); }} items={[["active", running ? `运行 ${running}` : "运行"], ["inbox", unread ? `待回应 ${unread}` : "待回应"], ["scheduled", "定时"], ["history", "结果"]] as const}/>
  {overview.error ? <Text style={[ui.hint, { color: theme.muted }]}>上次状态保留 · {overview.error}</Text> : null}{overview.value?.errors?.map(e => <Text key={e} style={[ui.hint, { color: theme.muted }]}>{e}</Text>)}
  {tab === "active" ? <>{client.sessions.filter(session => ["working", "queued", "needs-user"].includes(session.status)).map(session => <Card key={"session:" + session.id} theme={theme}><Text style={[ui.title, { color: theme.text }]}>{session.title}</Text><Text style={[ui.hint, { color: theme.muted }]}>{labels[session.status] || session.status} · {session.parentSessionId ? "子会话" : "会话任务"} · {session.projectName}</Text><View style={ui.row}><Button compact title="打开会话" theme={theme} onPress={() => onOpen(session.id)}/>{session.canSend ? <Button compact title="停止本轮" theme={theme} disabled={disabled} onPress={() => confirm("停止本轮？", "保留会话历史。", () => void client.perform("cancel", {}, session.id))}/> : null}</View></Card>)}{(overview.value?.tasks ?? []).map(task => <Card key={task.id} theme={theme}><Text style={[ui.title, { color: theme.text }]}>{task.title}</Text><Text style={[ui.hint, { color: theme.muted }]}>{labels[task.status] || task.status} · {task.kind}</Text>{task.sessionId ? <Button compact title="打开关联会话" theme={theme} onPress={() => onOpen(task.sessionId!)}/> : null}<Button compact title="停止此任务" theme={theme} disabled={disabled || !["running", "queued", "needs-user"].includes(task.status)} onPress={() => confirm("停止此任务？", "保留已产生的结果，停止操作由原执行器处理。", () => void client.mutate("task.cancel", task.id))}/></Card>)}{!overview.value?.tasks?.length && !client.sessions.some(session => ["working", "queued", "needs-user"].includes(session.status)) ? <EmptyState theme={theme} title={overview.loading ? "正在同步任务…" : "没有正在运行的任务"} hint="会话执行、后台任务和排队工作会显示在这里。下拉可刷新。"/> : null}</> : null}
  {tab === "inbox" && !unread ? <EmptyState theme={theme} title="没有待回应事项" hint="需要确认的定时运行和未读结果会出现在这里。"/> : null}{tab === "inbox" ? (overview.value?.inbox ?? []).filter(item => !item.read).map(item => <Card key={item.id} theme={theme}><Text style={[ui.title, { color: theme.text }]}>{item.title}</Text><Text style={[ui.hint, { color: theme.muted }]}>{item.detail} · {new Date(item.createdAt).toLocaleString()}</Text><View style={[ui.row, { flexWrap: "wrap" }]}>{item.id.startsWith("pending:") ? <><Button compact title="允许本次" theme={theme} disabled={disabled} onPress={() => void client.mutate("automation.confirm", item.id, { approved: true })}/><Button compact title="拒绝" theme={theme} disabled={disabled} onPress={() => void client.mutate("automation.confirm", item.id, { approved: false })}/></> : <Button compact title="标记已读" theme={theme} disabled={disabled} onPress={() => void client.mutate("inbox.read", item.id, { read: true })}/>}{item.sessionId ? <Button compact title="查看会话" theme={theme} onPress={() => onOpen(item.sessionId!)}/> : null}</View></Card>) : null}
  {tab === "scheduled" ? <><SearchField theme={theme} accessibilityLabel="筛选定时任务" value={search} onChangeText={setSearch} placeholder="搜索任务名称或项目" /><Button title="新建定时任务" primary theme={theme} disabled={disabled} onPress={() => { void client.loadOptions().catch(()=>undefined); setEditing("new"); }}/>{(overview.value?.automations ?? []).filter(task=>(task.name+" "+task.workspace).toLowerCase().includes(search.toLowerCase())).map(task => <Card key={task.id} theme={theme}><Pressable onPress={() => setDetail(detail?.id === task.id ? undefined : task)}><Text style={[ui.title, { color: theme.text }]}>{task.name}</Text><Text style={[ui.hint, { color: theme.muted }]}>{task.enabled ? "已启用" : "已暂停"} · {task.nextRunAt ? "下次 " + new Date(task.nextRunAt).toLocaleString() : "无下次运行"}{"\n"}{task.timeZone || "电脑时区"} · {task.registrationStatus}{task.registrationError ? " · " + task.registrationError : ""}</Text></Pressable><View style={[ui.row, { flexWrap: "wrap" }]}><Button compact title="编辑" theme={theme} disabled={disabled} onPress={() => setEditing(task)}/><Button compact title={task.enabled ? "暂停" : "恢复"} theme={theme} disabled={disabled} onPress={() => void client.mutate("automation.pause", task.id, { paused: task.enabled })}/><Button compact title="立即运行" theme={theme} disabled={disabled} onPress={() => void client.mutate("automation.run", task.id)}/><Button compact title="删除" theme={theme} danger disabled={disabled} onPress={() => confirm("删除定时任务？", "注销之后的触发，保留已有运行记录；运行中任务由原服务处理。", () => void client.mutate("automation.delete", task.id))}/></View>{detail?.id === task.id ? <AutomationDetails client={client} theme={theme} task={task}/> : null}</Card>)}</> : null}
  {tab === "history" && !overview.value?.runs?.length ? <EmptyState theme={theme} title="还没有运行结果" hint="定时任务运行后，结果和失败原因会保留在这里。"/> : null}{tab === "history" ? (overview.value?.runs ?? []).slice(0, 150).map(run => <Card key={run.id} theme={theme}><Text style={[ui.title, { color: theme.text }]}>{overview.value?.automations?.find(t => t.id === run.taskId)?.name || "定时运行"} · {labels[run.status] || run.status}</Text><Text style={[ui.hint, { color: run.error ? theme.danger : theme.muted }]}>{new Date(run.scheduledAt).toLocaleString()}{"\n"}{run.error || run.warning || ""}</Text>{run.sessionId ? <Button compact title="查看结果会话" theme={theme} onPress={() => onOpen(run.sessionId!)}/> : null}{["queued", "running", "awaiting-confirmation"].includes(run.status) ? <Button compact title="取消这次运行" theme={theme} disabled={disabled} onPress={() => void client.mutate("automation.cancel", run.id)}/> : null}</Card>) : null}
 </ScrollView>;
}
function AutomationDetails({ client, theme, task }: {
    client: Client;
    theme: Theme;
    task: AutomationTask;
}) { const [prompt, setPrompt] = useState(""); useEffect(() => { void client.query<{
    prompt: string;
}>("automation", { target: task.id }).then(value => setPrompt(value.prompt)).catch(e => setPrompt(String(e))); }, [task.id]); return <><Text selectable style={{ color: theme.text, lineHeight: 22 }}>{prompt}</Text><Text style={[ui.hint, { color: theme.muted }]}>模型 {task.profile.modelId} · {task.profile.mode} · 推理 {task.profile.effort || "默认"}{"\n"}上下文 {task.contextPolicy} · 错过触发 {task.missedRunPolicy}{"\n"}Computer {task.profile.computerEnabled ? "允许" : "禁用"} · 电脑需满足执行条件</Text></>; }
type EditorForm = {
    name: string; prompt: string; kind: ScheduleKind; date: string; time: string; minutes: string; days: number[]; zone: string;
    destination: "standalone" | "current-session"; targetSession: string; profileId: string; configuration: Configuration; account: string;
    context: "fresh" | "reuse"; computer: boolean; notify: boolean; wake: boolean; enabled: boolean;
};
const STEPS = ["做什么", "在哪里", "何时", "检查"] as const;

function initialForm(task?: AutomationTask): EditorForm {
    const once = task?.schedule.kind === "once" ? splitInstant(task.schedule.at) : splitInstant(undefined);
    return {
        name: task?.name || "", prompt: "", kind: (task?.schedule.kind as ScheduleKind) || "daily",
        date: once.date, time: task?.schedule.kind === "daily" || task?.schedule.kind === "weekly" ? task.schedule.time : once.time,
        minutes: task?.schedule.kind === "interval" ? String(task.schedule.minutes) : "60",
        days: task?.schedule.kind === "weekly" ? task.schedule.days : [1, 2, 3, 4, 5],
        zone: task?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        destination: (task?.destination as EditorForm["destination"]) || "standalone", targetSession: task?.targetSessionId || "",
        profileId: task?.executionProfileId || "", configuration: task ? { modelId: task.profile.modelId, effort: task.profile.effort, mode: task.profile.mode } : {},
        account: task?.profile.accountId || "", context: (task?.contextPolicy as EditorForm["context"]) || "fresh",
        computer: task?.profile.computerEnabled || false, notify: task?.notify ?? true, wake: task?.wakeToRun || false, enabled: task?.enabled ?? true,
    };
}

function DateStepper({ value, onChange, theme }: { value: string; onChange: (value: string) => void; theme: Theme }) {
    const base = isDate(value) ? new Date(value + "T00:00:00") : new Date();
    const weekday = ["日", "一", "二", "三", "四", "五", "六"][base.getDay()];
    const today = new Date();
    return <View style={{ gap: space.sm }}>
      <View style={[ui.row, { gap: space.sm }]}>
        <Button compact ghost title="‹" label="前一天" theme={theme} onPress={() => onChange(addDays(base, -1))} />
        <Text accessibilityLiveRegion="polite" style={{ flex: 1, textAlign: "center", color: theme.text, fontSize: font.title, fontWeight: "600" }}>{value} 周{weekday}</Text>
        <Button compact ghost title="›" label="后一天" theme={theme} onPress={() => onChange(addDays(base, 1))} />
      </View>
      <View style={[ui.row, { gap: space.sm, flexWrap: "wrap" }]}>{[["今天", 0], ["明天", 1], ["后天", 2], ["一周后", 7]].map(([label, offset]) => <Chip key={label} label={String(label)} theme={theme} selected={value === addDays(today, Number(offset))} onPress={() => onChange(addDays(today, Number(offset)))} />)}</View>
    </View>;
}

function TimeStepper({ value, onChange, theme }: { value: string; onChange: (value: string) => void; theme: Theme }) {
    return <View style={{ gap: space.sm }}>
      <View style={[ui.row, { gap: space.xs }]}>
        <Button compact ghost title="−1h" label="提前一小时" theme={theme} onPress={() => onChange(shiftTime(value, -60))} />
        <Button compact ghost title="−5′" label="提前五分钟" theme={theme} onPress={() => onChange(shiftTime(value, -5))} />
        <Text accessibilityLiveRegion="polite" style={{ flex: 1, textAlign: "center", color: theme.text, fontSize: font.heading, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{isTime(value) ? value : "--:--"}</Text>
        <Button compact ghost title="+5′" label="推后五分钟" theme={theme} onPress={() => onChange(shiftTime(value, 5))} />
        <Button compact ghost title="+1h" label="推后一小时" theme={theme} onPress={() => onChange(shiftTime(value, 60))} />
      </View>
      <View style={[ui.row, { gap: space.sm, flexWrap: "wrap" }]}>{["08:00", "09:00", "12:00", "18:00", "21:00"].map(preset => <Chip key={preset} label={preset} theme={theme} selected={value === preset} onPress={() => onChange(preset)} />)}</View>
    </View>;
}

function Toggle({ label, detail, value, onChange, disabled, theme }: { label: string; detail?: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean; theme: Theme }) {
    return <View style={[ui.row, { gap: space.md, minHeight: 48 }]}>
      <View style={{ flex: 1 }}><Text style={{ color: disabled ? theme.muted : theme.text, fontSize: font.body }}>{label}</Text>{detail ? <Text style={[ui.hint, { color: theme.muted }]}>{detail}</Text> : null}</View>
      <AccentSwitch theme={theme} accessibilityLabel={label} disabled={disabled} value={value} onValueChange={next => { haptic("toggle"); onChange(next); }} />
    </View>;
}

function AutomationEditor({ client, theme, task, close, accounts, onSaved }: {
    client: Client;
    theme: Theme;
    task?: AutomationTask;
    accounts: AccountProfile[];
    close: () => void;
    onSaved: (id: string) => void;
}) {
    const draftKey = (client.host?.fingerprint || "") + ":task-draft:" + (task?.id || "new");
    const [form, setForm] = useState<EditorForm>(() => initialForm(task));
    const [baseline, setBaseline] = useState<EditorForm>(() => initialForm(task));
    const edited = useRef(false), promptEdited = useRef(false);
    const set = (patch: Partial<EditorForm>) => { edited.current = true; if (patch.prompt !== undefined) promptEdited.current = true; setForm(previous => ({ ...previous, ...patch })); };
    const [step, setStep] = useState(task ? 3 : 0), [saving, setSaving] = useState(false), [sessionQuery, setSessionQuery] = useState("");
    const workspaces = client.options?.workspaces ?? [];
    const [workspace, setWorkspace] = useState(""), [workspaceTouched, setWorkspaceTouched] = useState(false), [missingPath, setMissingPath] = useState<string>();
    const promptLoaded = useRef(!task), restored = useRef(false);
    const [operation, setOperation] = useState<string>(), [savedId, setSavedId] = useState<string>();
    const submitting = saving || (!!operation && client.receipt?.operationId === operation && ["accepted", "queued", "running", "unknown"].includes(client.receipt.state));
    // Bind the project once options arrive; an unavailable original project stays bound and is shown as such.
    useEffect(() => {
        if (!client.options || workspaceTouched || workspace || missingPath) return;
        const initial = initialWorkspace(task?.workspace, workspaces);
        setWorkspace(initial.id); setMissingPath(initial.missingPath);
    }, [client.options]);
    useEffect(() => { const receipt = client.receipt; if (!operation || receipt?.operationId !== operation) return;
        if (receipt.resultSessionId) setSavedId(receipt.resultSessionId);
        if (receipt.state === "completed") { haptic("success"); void savedDelete(draftKey); onSaved(receipt.resultSessionId || task?.id || ""); close(); }
        if (receipt.state === "failed") haptic("error");
    }, [operation, client.receipt?.state, client.receipt?.resultSessionId]);
    useEffect(() => {
        let active = true; void client.loadOptions().catch(() => undefined);
        // A kept draft wins over the stored prompt; otherwise load the saved instructions.
        void savedRead<{ form: EditorForm; workspace: string; touched: boolean }>(draftKey).then(draft => {
            if (!active) return;
            if (draft?.form && !edited.current) { restored.current = true; promptLoaded.current = true; setForm(draft.form); if (draft.touched && draft.workspace) { setWorkspace(draft.workspace); setWorkspaceTouched(true); } client.setNotice("已恢复上次未保存的修改"); return; }
            if (task) void client.query<{ prompt: string }>("automation", { target: task.id }).then(v => { if (!active || restored.current) return; promptLoaded.current = true; if (!promptEdited.current) setForm(previous => ({ ...previous, prompt: v.prompt })); setBaseline(previous => ({ ...previous, prompt: v.prompt })); }).catch(e => { if (active) client.setError(String(e)); });
        }).catch(() => undefined);
        return () => { active = false; };
    }, []);
    const dirty = workspaceTouched || JSON.stringify(form) !== JSON.stringify(baseline);
    const leave = () => {
        if (!dirty || savedId) { close(); return; }
        Alert.alert("有未保存的修改", "可以保留为草稿，下次打开这个任务时恢复。", [
            { text: "继续编辑", style: "cancel" },
            { text: "放弃修改", style: "destructive", onPress: () => { void savedDelete(draftKey); close(); } },
            { text: "保留草稿", onPress: () => { void savedWrite(draftKey, { form, workspace, touched: workspaceTouched }); close(); } },
        ]);
    };
    useBackLayer(true, leave);
    const built = buildSchedule(form);
    const profiles = workspaces.find(w => w.id === workspace)?.profiles ?? [];
    const workspaceName = (id: string) => workspaces.find(w => w.id === id)?.name || (id ? id : missingPath ? `原项目（${missingPath}）` : "未选择");
    const accountName = (id: string) => accounts.find(a => a.id === id)?.label || "电脑当前账号";
    const stepError = [
        !form.name.trim() ? "填写任务名称" : !form.prompt.trim() ? (promptLoaded.current ? "填写完整指令" : "正在读取原指令…") : "",
        !client.options ? "正在读取电脑项目…" : form.destination === "current-session" ? (!form.targetSession ? "选择要继续的会话" : "") : !workspace && !missingPath ? "选择执行项目" : missingPath && !workspaceTouched && !task ? "选择执行项目" : "",
        built.error || (!form.zone.trim() ? "填写任务时区" : ""),
        "",
    ];
    const firstError = stepError.findIndex(Boolean);
    const save = async () => {
        if (firstError >= 0) { setStep(firstError); haptic("error"); return; }
        setSaving(true);
        try {
            const schedule = built.schedule!;
            const values = { name: form.name, prompt: form.prompt, schedule, timeZone: form.zone, destination: form.destination, targetSessionId: form.targetSession || undefined, executionProfileId: form.profileId, profile: { ...(task?.profile ?? {}), accountId: form.account || undefined, providerId: form.configuration.providerId, modelId: form.configuration.modelId || client.options?.defaults?.modelId || "", effort: form.configuration.effort ?? "", mode: form.configuration.mode || "agent", permissionPolicy: form.configuration.mode === "auto" ? "auto" : "agent", computerEnabled: form.computer }, enabled: form.enabled, wakeToRun: form.wake, notify: form.notify, missedRunPolicy: task?.missedRunPolicy || "skip", contextPolicy: form.destination === "current-session" ? "reuse" : form.context };
            const receipt = task
                ? await client.mutate("automation.update", task.id, { revision: task.revision ?? 0, ...workspaceForUpdate(workspace, workspaceTouched), patch: task.destination === "current-session" ? { name: form.name, prompt: form.prompt, schedule, timeZone: form.zone, enabled: form.enabled, wakeToRun: form.wake, notify: form.notify, missedRunPolicy: task.missedRunPolicy } : values })
                : await client.mutate("automation.create", "new", { workspaceId: workspace, input: values, ...(form.profileId ? { configuration: form.configuration } : {}) });
            if (receipt) { setOperation(receipt.operationId); if (receipt.resultSessionId) setSavedId(receipt.resultSessionId); client.setNotice("电脑已接收，正在等待调度注册结果。"); }
        } catch (e) { haptic("error"); client.setError(String(e)); }
        finally { setSaving(false); }
    };
    const field = (label: string, value: string, onChange: (v: string) => void, multi = false, placeholder?: string) => <View style={{ gap: 6 }}><Text style={[ui.hint, { color: theme.muted }]}>{label}</Text><TextInput accessibilityLabel={label} value={value} placeholder={placeholder} placeholderTextColor={theme.muted} onChangeText={onChange} multiline={multi} style={[ui.field, { color: theme.text, borderColor: theme.border }, multi && { minHeight: 150, textAlignVertical: "top" }]} /></View>;
    const changes = task ? describeChanges(
        { name: baseline.name, prompt: baseline.prompt, workspace: initialWorkspace(task.workspace, workspaces).id, schedule: buildSchedule(baseline).schedule, zone: baseline.zone, modelId: baseline.configuration.modelId, mode: baseline.configuration.mode, effort: baseline.configuration.effort, account: baseline.account, enabled: baseline.enabled, notify: baseline.notify, wake: baseline.wake, computer: baseline.computer },
        { name: form.name, prompt: form.prompt, workspace: workspaceTouched ? workspace : initialWorkspace(task.workspace, workspaces).id, schedule: built.schedule, zone: form.zone, modelId: form.configuration.modelId, mode: form.configuration.mode, effort: form.configuration.effort, account: form.account, enabled: form.enabled, notify: form.notify, wake: form.wake, computer: form.computer },
        { workspace: workspaceName, account: accountName }) : [];
    const sessions = rankSessions(client.sessions.filter(s => s.canSend && !s.archived), sessionQuery, [], []);
    const offline = client.busy || !!client.unknown || client.connection.phase !== "online";
    return <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm }}><SubpageHeader theme={theme} title={task ? "编辑定时任务" : "新建定时任务"} backLabel="返回任务" onBack={leave} /></View>
      <View accessibilityRole="tablist" style={[ui.row, { paddingHorizontal: space.lg, paddingVertical: space.sm, gap: space.xs }]}>
        {STEPS.map((label, index) => <Pressable key={label} accessibilityRole="tab" accessibilityState={{ selected: step === index }} accessibilityLabel={`第 ${index + 1} 步 ${label}${stepError[index] ? "，未完成" : ""}`} onPress={() => { haptic("selection"); setStep(index); }}
          style={{ flex: 1, alignItems: "center", gap: 4, paddingVertical: 6 }}>
          <View style={{ height: 3, alignSelf: "stretch", borderRadius: 2, backgroundColor: index <= step ? theme.accent : theme.border }} />
          <Text style={{ fontSize: font.caption, fontWeight: step === index ? "700" : "500", color: step === index ? theme.accent : stepError[index] && index < step ? theme.warning : theme.muted }}>{index + 1} {label}</Text>
        </Pressable>)}
      </View>
      <ScrollView contentContainerStyle={[ui.content, { paddingBottom: 120 }]} keyboardShouldPersistTaps="handled">
        {step === 0 ? <>
          {!task ? <View style={[ui.row, { flexWrap: "wrap", gap: space.sm }]}>{[["项目检查", "检查项目最近的改动、失败检查和待处理问题，汇总结果。"], ["待办跟进", "检查当前任务的进度与剩余项，给出需要我回应的问题。"], ["每日总结", "总结今天项目内的改动、未完成事项和风险，按优先级列出。"]].map(([title, instructions]) => <Chip key={title} label={title + "模板"} theme={theme} onPress={() => set({ name: form.name || title!, prompt: instructions! })} />)}</View> : null}
          {field("任务名称", form.name, name => set({ name }), false, "例如：每日项目检查")}
          {field("完整指令", form.prompt, prompt => set({ prompt }), true, promptLoaded.current ? "电脑执行时发送给 Grok 的完整内容" : "正在读取原指令…")}
        </> : null}
        {step === 1 ? <>
          {!task ? <Segmented theme={theme} value={form.destination} onChange={destination => set({ destination })} items={[["standalone", "独立运行"], ["current-session", "继续已有会话"]] as const} /> : null}
          {form.destination === "current-session" ? <>
            {task ? <Text style={[ui.hint, { color: theme.muted }]}>继续原会话，电脑保存并使用绑定时的实际模型、模式、推理和账号。更改执行配置需另建任务。</Text> : <>
              <SearchField theme={theme} accessibilityLabel="搜索会话" value={sessionQuery} onChangeText={setSessionQuery} placeholder="搜索会话或项目" />
              {sessions.slice(0, 60).map(session => <ListRow key={session.id} theme={theme} title={session.title} detail={session.projectName} right={form.targetSession === session.id ? <Icon name="checkCircle" size={20} color={theme.accent} /> : undefined}
                onPress={() => { set({ targetSession: session.id, context: "reuse" }); const target = workspaces.find(w => w.path && samePath(w.path, session.cwd || "")); if (target) { setWorkspace(target.id); setWorkspaceTouched(true); } }} />)}
              {sessions.length > 60 ? <Text style={[ui.hint, { color: theme.muted }]}>还有 {sessions.length - 60} 个会话，输入关键词缩小范围。</Text> : null}
            </>}
          </> : <>
            <Text style={[ui.section, { color: theme.muted }]}>执行项目</Text>
            {missingPath && !workspaceTouched ? <Banner theme={theme} tone="warning" text={`原项目当前不在电脑项目列表中：${missingPath}。保存时继续使用原项目；如需更换，请在下面明确选择。`} /> : null}
            {workspaces.map(w => <ListRow key={w.id} theme={theme} title={w.name} detail={w.path || undefined} right={workspace === w.id && (workspaceTouched || !missingPath) ? <Icon name="checkCircle" size={20} color={theme.accent} /> : undefined} onPress={() => { haptic("selection"); setWorkspace(w.id); setWorkspaceTouched(true); set({ profileId: "" }); }} />)}
            <Text style={[ui.section, { color: theme.muted }]}>执行配置</Text>
            <View style={[ui.row, { flexWrap: "wrap", gap: space.sm }]}>
              <Chip label="使用下面的字段" theme={theme} selected={!form.profileId} onPress={() => set({ profileId: "" })} />
              {profiles.map(profile => <Chip key={profile.id} label={profile.name} theme={theme} selected={form.profileId === profile.id} onPress={() => set({ profileId: profile.id, configuration: { modelId: profile.modelId, effort: profile.effort, mode: profile.mode as Configuration["mode"] } })} />)}
            </View>
            <ConfigurationPicker client={client} theme={theme} value={form.configuration} onChange={configuration => set({ configuration })} />
            <Text style={[ui.section, { color: theme.muted }]}>任务账号</Text>
            <View style={[ui.row, { flexWrap: "wrap", gap: space.sm }]}>
              <Chip label="执行时使用电脑当前账号" theme={theme} selected={!form.account} onPress={() => set({ account: "" })} />
              {accounts.map(account => <Chip key={account.id} label={account.label} theme={theme} selected={form.account === account.id} onPress={() => set({ account: account.id })} />)}
            </View>
            <Segmented theme={theme} value={form.context} onChange={context => set({ context })} items={[["fresh", "每次独立上下文"], ["reuse", "复用任务上下文"]] as const} />
            <Toggle theme={theme} label="允许 Computer" detail="允许任务操作电脑界面" value={form.computer} onChange={computer => set({ computer })} />
          </>}
        </> : null}
        {step === 2 ? <>
          <Segmented theme={theme} value={form.kind} onChange={kind => set({ kind })} items={[["once", "一次"], ["daily", "每天"], ["weekly", "每周"], ["interval", "间隔"]] as const} />
          {form.kind === "once" ? <View style={{gap:8}}>{Platform.OS !== "android" ? <DateStepper theme={theme} value={form.date} onChange={date => set({ date })} /> : null}{Platform.OS === "android" ? <Button compact theme={theme} title={`选择日期 · ${form.date}`} onPress={() => void pickDate(form.date).then(date => { if(date) set({date}); }).catch(e => client.setError(String(e)))} /> : null}</View> : null}
          {form.kind === "weekly" ? <View style={[ui.row, { flexWrap: "wrap", gap: space.sm }]}>{[1, 2, 3, 4, 5, 6, 0].map(day => <Chip key={day} label={"周" + ["日", "一", "二", "三", "四", "五", "六"][day]} theme={theme} selected={form.days.includes(day)} onPress={() => set({ days: form.days.includes(day) ? form.days.filter(d => d !== day) : [...form.days, day] })} />)}</View> : null}
          {form.kind === "interval" ? <View style={{ gap: space.sm }}>
              {field("间隔分钟", form.minutes, minutes => set({ minutes: minutes.replace(/[^\d]/g, "") }))}
              <View style={[ui.row, { flexWrap: "wrap", gap: space.sm }]}>{[["30 分钟", "30"], ["1 小时", "60"], ["2 小时", "120"], ["6 小时", "360"]].map(([label, value]) => <Chip key={value} label={label!} theme={theme} selected={form.minutes === value} onPress={() => set({ minutes: value! })} />)}</View>
            </View> : <View style={{gap:8}}>{Platform.OS !== "android" ? <TimeStepper theme={theme} value={form.time} onChange={time => set({ time })} /> : null}{Platform.OS === "android" ? <Button compact theme={theme} title={`选择时间 · ${form.time}`} onPress={() => void pickTime(form.time).then(time => { if(time) set({time}); }).catch(e => client.setError(String(e)))} /> : null}</View>}
          {field("任务时区", form.zone, zone => set({ zone }))}
          <Text style={[ui.hint, { color: theme.muted }]}>手机与电脑可能处于不同时区，每天 / 每周任务按此时区计算；“一次”使用手机当前时间。</Text>
          {built.error ? <Text style={{ color: theme.warning }}>{built.error}</Text> : <Text style={{ color: theme.text, fontWeight: "600" }}>{describeSchedule(built.schedule, form.zone)}</Text>}
          <Toggle theme={theme} label="启用任务" value={form.enabled} onChange={enabled => set({ enabled })} />
          <Toggle theme={theme} label="结果通知" value={form.notify} onChange={notify => set({ notify })} />
          <Toggle theme={theme} label="允许唤醒电脑" detail="电脑睡眠时由 Windows 计划任务唤醒执行" value={form.wake} onChange={wake => set({ wake })} />
        </> : null}
        {step === 3 ? <>
          <Card theme={theme}>
            {[["名称", form.name || "—"], ["指令", form.prompt ? form.prompt.slice(0, 120) + (form.prompt.length > 120 ? "…" : "") : "—"], ["电脑", client.host?.name || "当前电脑"],
              ["执行位置", form.destination === "current-session" ? "继续会话：" + (client.sessions.find(s => s.id === form.targetSession)?.title || "未选择") : workspaceTouched || !missingPath ? workspaceName(workspace) : `原项目（${missingPath}）`],
              ["模型", form.configuration.modelId || client.options?.defaults?.modelId || "电脑默认"], ["模式 / 推理", `${form.configuration.mode || "agent"} / ${form.configuration.effort || "默认"}`],
              ["账号", accountName(form.account)], ["时间", built.error || describeSchedule(built.schedule, form.zone)], ["时区", form.zone],
              ["状态", [form.enabled ? "启用" : "暂停", form.notify ? "通知" : "", form.wake ? "可唤醒" : "", form.computer ? "Computer" : ""].filter(Boolean).join(" · ")]]
              .map(([label, value]) => <View key={label} style={[ui.row, { alignItems: "flex-start", gap: space.md, paddingVertical: 4 }]}><Text style={{ width: 72, color: theme.muted, fontSize: font.small }}>{label}</Text><Text selectable style={{ flex: 1, color: theme.text, fontSize: font.small, lineHeight: 20 }}>{value}</Text></View>)}
          </Card>
          {task ? <Card theme={theme}><Text style={[ui.title, { color: theme.text }]}>本次修改</Text>{changes.length ? changes.map(change => <Text key={change} style={{ color: theme.text, lineHeight: 22 }}>• {change}</Text>) : <Text style={[ui.hint, { color: theme.muted }]}>还没有修改。</Text>}</Card> : null}
          {firstError >= 0 ? <Banner theme={theme} tone="warning" text={`第 ${firstError + 1} 步未完成：${stepError[firstError]}`} action="前往" onAction={() => setStep(firstError)} /> : null}
          <Text style={[ui.hint, { color: theme.muted }]}>保存后由电脑注册到 Windows 计划任务，并返回实际的下次运行时间。</Text>
          {savedId ? <Text selectable style={[ui.hint, { color: theme.muted }]}>已保存任务 {savedId}。注册失败请返回任务编辑此记录，避免重复新建。</Text> : null}
        </> : null}
      </ScrollView>
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", gap: space.sm, padding: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border, backgroundColor: theme.bg }}>
        {step > 0 ? <View style={{ flex: 1 }}><Button title="上一步" theme={theme} onPress={() => setStep(step - 1)} /></View> : null}
        <View style={{ flex: 2 }}>{step < 3
          ? <Button title="下一步" primary theme={theme} disabled={Boolean(stepError[step]) && !(step === 0 && !promptLoaded.current)} onPress={() => { haptic("tap"); setStep(step + 1); }} />
          : <Button title={submitting ? "等待电脑注册结果…" : task ? (changes.length ? "保存修改" : "没有修改") : "保存并注册"} primary theme={theme} disabled={submitting || !!savedId || offline || firstError >= 0 || (Boolean(task) && !changes.length)} onPress={() => void save()} />}</View>
      </View>
    </View>;
}
