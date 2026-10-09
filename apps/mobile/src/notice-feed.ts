/**
 * Which computer events deserve a reminder, and where to show it.
 *
 * The only source of "finished / failed / needs confirmation" reminders is the computer's own
 * notification record: each entry has a stable id and is written only for a real turn or task
 * outcome, so switching model, effort or mode can never look like a completed answer. The same
 * id set is shared with the background follow service, so one event reminds at most once.
 * Kept free of React Native so it runs under Node tests.
 */
export interface InboxItem { id: string; kind: "completion" | "failure" | "confirmation" | "info"; title: string; detail?: string; sessionId?: string; createdAt?: string }
export interface NoticePrefs { completion: boolean; failure: boolean; attention: boolean; muted: string[] }
export type NoticeCategory = "completed" | "failed" | "attention";

export function noticeCategory(kind: InboxItem["kind"]): NoticeCategory | undefined {
    return kind === "completion" ? "completed" : kind === "failure" ? "failed" : kind === "confirmation" ? "attention" : undefined;
}

/**
 * New entries since the last read. The first read for a computer only records what already
 * exists (no burst of old reminders after launch); later reads report unseen ids in time order.
 */
export function freshNotices(items: InboxItem[], seen: ReadonlySet<string>, baselined: boolean): { fresh: InboxItem[]; ids: string[] } {
    const ids = items.map(item => item.id).filter(Boolean);
    if (!baselined) return { fresh: [], ids };
    const fresh = items.filter(item => item.id && !seen.has(item.id))
        .sort((a, b) => Date.parse(a.createdAt || "") - Date.parse(b.createdAt || "") || 0);
    return { fresh, ids };
}

/**
 * Prefer a foreground banner when enabled; system-only rules still work in the foreground.
 * Nothing is shown for the conversation already on screen, and no event uses both surfaces.
 */
export function noticeDecision(item: InboxItem, prefs: NoticePrefs, context: { currentSessionId: string; appActive: boolean; systemPrefs?: NoticePrefs }): { inApp: boolean; system: boolean } {
    const none = { inApp: false, system: false };
    const category = noticeCategory(item.kind);
    if (!category) return none;
    const enabled = category === "completed" ? prefs.completion : category === "failed" ? prefs.failure : prefs.attention;
    if (item.sessionId && prefs.muted.includes(item.sessionId)) return none;
    if (context.appActive && item.sessionId && item.sessionId === context.currentSessionId) return none;
    const system = context.systemPrefs ?? prefs;
    const systemEnabled = category === "completed" ? system.completion : category === "failed" ? system.failure : system.attention;
    if (context.appActive && enabled) return { inApp: true, system: false };
    return { inApp: false, system: systemEnabled && !(item.sessionId && system.muted.includes(item.sessionId)) };
}

export function noticeLabel(item: InboxItem) {
    const prefix = item.kind === "failure" ? "执行失败" : item.kind === "confirmation" ? "需要确认" : "已完成";
    return `${prefix} · ${item.title}`.slice(0, 120);
}

/**
 * Sessions that just started waiting for the user (a permission, question or plan). This is a
 * real event on its own, unlike working → idle, which also happens when settings change.
 */
export function newlyWaiting(previous: ReadonlyMap<string, string>, sessions: Array<{ id: string; status: string; archived?: boolean }>): string[] {
    return sessions.filter(s => !s.archived && s.status === "needs-user" && previous.has(s.id) && previous.get(s.id) !== "needs-user").map(s => s.id);
}

/** Bounded, insertion-ordered id memory. */
export function rememberIds(seen: Set<string>, ids: string[], limit = 300) {
    for (const id of ids) if (id) { seen.delete(id); seen.add(id); }
    while (seen.size > limit) seen.delete(seen.values().next().value as string);
    return seen;
}
