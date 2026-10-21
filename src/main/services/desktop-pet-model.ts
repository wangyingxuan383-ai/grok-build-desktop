import type { DesktopActivitySnapshot } from "../../shared/desktop-activity";
import type { NotificationInboxItem } from "../../shared/types";
import type { PetClipId, PetTarget } from "../../shared/desktop-pet";
import { notificationText } from "./desktop-notifications";
export function petTargets(activity: DesktopActivitySnapshot, inbox: NotificationInboxItem[]): PetTarget[] {
    const targets = new Map<string, PetTarget>();
    const known = new Map(activity.sessions.map(row => [row.sessionId, row]));
    const resolvedErrors = new Set(inbox.filter(row => row.read && row.kind === "failure").map(row => row.sessionId));
    const rank = (status: PetTarget["status"]) => ({ awaiting: 0, error: 1, completed: 2, running: 3 })[status];
    const add = (row: PetTarget) => { const key = `${row.kind}:${row.id}`, old = targets.get(key); if (!old || rank(row.status) < rank(old.status))
        targets.set(key, row); };
    for (const row of activity.sessions) {
        if(row.status==="running"&&row.activeTurn===false)continue;
        if (row.status === "error" && resolvedErrors.has(row.sessionId))
            continue;
        add({ kind: "session", id: row.sessionId, title: notificationText(row.title, 72), status: row.status });
    }
    for(const row of activity.tasks??[])add({...row,title:notificationText(row.title,72)});
    for (const row of inbox) {
        if (row.read || row.kind === "info")
            continue;
        const target = inboxTarget(row);
        if (!target)
            continue;
        // Live session confirmations come from the resolved interaction projection, not stale persisted records.
        if (row.kind === "confirmation" && target.kind === "session" && known.get(target.id)?.status !== "awaiting")
            continue;
        if (row.kind === "failure" && known.get(target.id)?.status === "running")
            continue;
        add({ ...target, title: notificationText(known.get(target.id)?.title || row.title, 72), status: row.kind === "confirmation" ? "awaiting" : row.kind === "failure" ? "error" : "completed" });
    }
    return [...targets.values()].sort((a, b) => rank(a.status) - rank(b.status) || a.title.localeCompare(b.title));
}
export function inboxTarget(row: NotificationInboxItem): Pick<PetTarget, "id" | "kind"> | undefined {
    if (row.automationRunId || row.taskId)
        return { kind: "automation", id: row.automationRunId || row.taskId! };
    if (row.sessionId)
        return { kind: row.sessionId.startsWith("image-") ? "image" : "session", id: row.sessionId };
    return undefined;
}
export function petActivity(targets: PetTarget[]): PetClipId {
    return targets.some(row => row.status === "awaiting") ? "waiting" : targets.some(row => row.status === "error") ? "error" : targets.some(row => row.status === "running") ? "working" : "idle";
}
export interface PetArea {
    x: number;
    y: number;
    width: number;
    height: number;
}
export function petWindowBounds(area: PetArea, size: number, position?: {
    x: number;
    y: number;
}): PetArea {
    const width = Math.min(360, area.width), height = Math.min(size + 230, area.height);
    const x = area.x + (position?.x ?? 1) * Math.max(0, area.width - width);
    const y = area.y + (position?.y ?? 1) * Math.max(0, area.height - height);
    return { x: Math.round(Math.max(area.x, Math.min(area.x + area.width - width, x))), y: Math.round(Math.max(area.y, Math.min(area.y + area.height - height, y))), width, height };
}
export function petPosition(bounds: PetArea, area: PetArea, displayId: number) {
    return { displayId, x: Math.max(0, Math.min(1, (bounds.x - area.x) / Math.max(1, area.width - bounds.width))), y: Math.max(0, Math.min(1, (bounds.y - area.y) / Math.max(1, area.height - bounds.height))) };
}
/** All asynchronous loads and retire callbacks must retain this identity. */
export class PetIntent {
    version = 0;
    enabled = true;
    manuallyHidden = false;
    readonly blockers = new Set<string>();
    get visible(): boolean { return this.enabled && !this.manuallyHidden && this.blockers.size === 0; }
    change(): number { return ++this.version; }
    current(version: number): boolean { return version === this.version; }
    setBlocker(reason: string, active: boolean): boolean {
        if (this.blockers.has(reason) === active)
            return false;
        if (active)
            this.blockers.add(reason);
        else
            this.blockers.delete(reason);
        this.change();
        return true;
    }
}
