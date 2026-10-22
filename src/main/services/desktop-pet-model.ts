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
}, characterWidth = size): PetArea {
    const width = Math.min(360, area.width), height = Math.min(size + 230, area.height);
    const relativeX = position?.x ?? 1, spanX = Math.max(0, area.width - width), side = petSideInset(width, characterWidth);
    const x = area.x + (relativeX < 0 ? relativeX * side : relativeX > 1 ? spanX + (relativeX - 1) * side : relativeX * spanX);
    // Existing non-negative positions retain their exact meaning. Negative
    // values use the transparent header, allowing the character to reach the top.
    const relativeY = position?.y ?? 1;
    const y = area.y + relativeY * (relativeY < 0 ? petTopInset(height, size) : Math.max(0, area.height - height));
    return clampPetBounds({ x, y, width, height }, area, size, characterWidth);
}
export function petTopInset(height: number, size: number): number { return Math.max(0, height - 14 - size - 8); }
export function petSideInset(width: number, size: number): number { return Math.max(0, (width - size) / 2 - 8); }
export function clampPetBounds(bounds: PetArea, area: PetArea, size: number, characterWidth = size): PetArea {
    return { ...bounds,
        x: Math.round(Math.max(area.x - petSideInset(bounds.width, characterWidth), Math.min(area.x + area.width - bounds.width + petSideInset(bounds.width, characterWidth), bounds.x))),
        y: Math.round(Math.max(area.y - petTopInset(bounds.height, size), Math.min(area.y + area.height - bounds.height, bounds.y))),
    };
}
export function petPosition(bounds: PetArea, area: PetArea, displayId: number, size = bounds.height - 230, characterWidth = size) {
    const dy = bounds.y - area.y, dx = bounds.x - area.x, spanX = Math.max(0, area.width - bounds.width), side = Math.max(1, petSideInset(bounds.width, characterWidth));
    return { displayId, x: Math.max(-1, Math.min(2, dx < 0 ? dx / side : dx > spanX ? 1 + (dx - spanX) / side : dx / Math.max(1, spanX))),
        y: Math.max(-1, Math.min(1, dy / Math.max(1, dy < 0 ? petTopInset(bounds.height, size) : area.height - bounds.height))) };
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
