/**
 * Pure rules for the scheduled-task editor: where a task runs, when it runs, and what an edit
 * would change. Kept free of React Native so it runs under Node tests.
 */
export interface WorkspaceOption { id: string; name: string; path?: string }
export type ScheduleKind = "once" | "daily" | "weekly" | "interval";
export type Schedule = { kind: "once"; at: string } | { kind: "daily"; time: string } | { kind: "weekly"; time: string; days: number[] } | { kind: "interval"; minutes: number };

/**
 * The project a task is bound to. When editing a task whose project is not in the current
 * options, the original binding is kept and reported as missing; it is never silently replaced
 * by the first project in the list.
 */
export function initialWorkspace(taskPath: string | undefined, options: WorkspaceOption[]): { id: string; missingPath?: string } {
    if (taskPath) {
        const match = options.find(w => w.path && samePath(w.path, taskPath));
        return match ? { id: match.id } : { id: "", missingPath: taskPath };
    }
    return { id: options[0]?.id || "" };
}

export function samePath(a: string, b: string) {
    const normal = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    return normal(a) === normal(b);
}

/** `workspaceId` is sent on update only when the user explicitly picked a project. */
export function workspaceForUpdate(chosen: string, touched: boolean): { workspaceId?: string } {
    return touched && chosen ? { workspaceId: chosen } : {};
}

const pad = (value: number) => String(value).padStart(2, "0");
export function isTime(value: string) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }
export function isDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + "T00:00:00Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Local calendar date `days` after `from`, as YYYY-MM-DD. */
export function addDays(from: Date, days: number) {
    const next = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
    return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
}

export function shiftTime(value: string, minutes: number) {
    const [h, m] = isTime(value) ? value.split(":").map(Number) : [9, 0];
    const total = (((h! * 60 + m! + minutes) % 1440) + 1440) % 1440;
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** Splits a stored one-off instant into the phone's local date and time fields. */
export function splitInstant(iso: string | undefined, now = new Date()): { date: string; time: string } {
    const at = iso ? new Date(iso) : undefined;
    if (!at || !Number.isFinite(at.getTime())) return { date: addDays(now, 1), time: "09:00" };
    return { date: addDays(at, 0), time: `${pad(at.getHours())}:${pad(at.getMinutes())}` };
}

export function buildSchedule(input: { kind: ScheduleKind; date: string; time: string; minutes: string; days: number[] }, now = new Date()): { schedule?: Schedule; error?: string } {
    if (input.kind === "interval") {
        const minutes = Number(input.minutes);
        if (!Number.isInteger(minutes) || minutes < 5 || minutes > 10080) return { error: "间隔需为 5 到 10080 分钟的整数" };
        return { schedule: { kind: "interval", minutes } };
    }
    if (!isTime(input.time)) return { error: "请选择有效时间" };
    if (input.kind === "once") {
        if (!isDate(input.date)) return { error: "请选择执行日期" };
        const [y, mo, d] = input.date.split("-").map(Number), [h, mi] = input.time.split(":").map(Number);
        const at = new Date(y!, mo! - 1, d!, h!, mi!);
        if (at.getTime() <= now.getTime()) return { error: "执行时间已经过去" };
        return { schedule: { kind: "once", at: at.toISOString() } };
    }
    if (input.kind === "weekly") {
        if (!input.days.length) return { error: "至少选择一天" };
        return { schedule: { kind: "weekly", time: input.time, days: [...new Set(input.days)].sort() } };
    }
    return { schedule: { kind: "daily", time: input.time } };
}

const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
export function describeSchedule(schedule: Schedule | undefined, zone: string) {
    if (!schedule) return "未设置";
    const suffix = zone ? `（${zone}）` : "";
    if (schedule.kind === "interval") return schedule.minutes % 60 === 0 ? `每 ${schedule.minutes / 60} 小时` : `每 ${schedule.minutes} 分钟`;
    if (schedule.kind === "once") { const at = new Date(schedule.at); return `${at.getMonth() + 1} 月 ${at.getDate()} 日 ${pad(at.getHours())}:${pad(at.getMinutes())} 执行一次（手机时间）`; }
    if (schedule.kind === "weekly") return `每周${schedule.days.map(d => weekdays[d]).join("、")} ${schedule.time}${suffix}`;
    return `每天 ${schedule.time}${suffix}`;
}

export interface TaskFormValues { name: string; prompt: string; workspace: string; schedule?: Schedule; zone: string; modelId?: string; mode?: string; effort?: string; account: string; enabled: boolean; notify: boolean; wake: boolean; computer: boolean }

/** Human-readable list of what an edit changes, shown before saving. */
export function describeChanges(before: TaskFormValues, after: TaskFormValues, names: { workspace: (id: string) => string; account: (id: string) => string }) {
    const changes: string[] = [];
    const add = (label: string, a: unknown, b: unknown, show: (v: unknown) => string = v => String(v ?? "默认")) => { if (JSON.stringify(a) !== JSON.stringify(b)) changes.push(`${label}：${show(a)} → ${show(b)}`); };
    add("名称", before.name, after.name);
    if (before.prompt !== after.prompt) changes.push("指令内容已修改");
    add("项目", before.workspace, after.workspace, v => names.workspace(String(v ?? "")));
    add("时间", before.schedule, after.schedule, v => describeSchedule(v as Schedule, ""));
    add("时区", before.zone, after.zone);
    add("模型", before.modelId, after.modelId);
    add("模式", before.mode, after.mode);
    add("推理强度", before.effort, after.effort);
    add("账号", before.account, after.account, v => names.account(String(v ?? "")));
    const flags: Array<[string, keyof TaskFormValues]> = [["启用", "enabled"], ["结果通知", "notify"], ["唤醒电脑", "wake"], ["允许 Computer", "computer"]];
    for (const [label, key] of flags) add(label, before[key], after[key], v => v ? "开" : "关");
    return changes;
}

/** Sessions to offer as a target: matching the query, recent and favourite first, no fixed cut-off. */
export function rankSessions<T extends { id: string; title: string; projectName?: string; updatedAt?: string }>(sessions: T[], query: string, favorites: string[], recent: string[]) {
    const q = query.trim().toLowerCase();
    const score = (s: T) => (favorites.includes(s.id) ? 2 : 0) + (recent.includes(s.id) ? 1 : 0);
    return sessions
        .filter(s => !q || s.title.toLowerCase().includes(q) || (s.projectName || "").toLowerCase().includes(q))
        .sort((a, b) => score(b) - score(a) || Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || "") || 0);
}
