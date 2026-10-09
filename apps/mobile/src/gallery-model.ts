/**
 * Pure rules for the image gallery: which pictures a filter shows and in what order.
 * Kept free of React Native so it runs under Node tests.
 */
export interface GalleryArtifact { id: string; source: string; name?: string; media: string }
export interface GalleryRecord { requestId: string; prompt: string; job: { status: string; startedAt?: string; artifacts: GalleryArtifact[] } }
export interface GalleryConversation { id: string; title: string; jobs: GalleryRecord[] }
export interface GalleryPhoto { source: string; name?: string; prompt: string; detail: string; conversation: string; at: number }

export type GalleryFilter = "pictures" | "favorites" | "conversations" | "all" | "failed";
export type GallerySort = "newest" | "oldest";

const time = (value?: string) => { const t = value ? Date.parse(value) : NaN; return Number.isFinite(t) ? t : 0; };

/** Every generated picture once, newest first by default, optionally limited to one conversation. */
export function galleryPhotos(conversations: GalleryConversation[], options: { filter: GalleryFilter; favorites: string[]; sort: GallerySort; conversation?: string }): GalleryPhoto[] {
    const seen = new Set<string>(), result: GalleryPhoto[] = [];
    const favorites = new Set(options.favorites);
    for (const row of conversations) {
        if (options.conversation && row.id !== options.conversation) continue;
        for (const record of row.jobs) for (const artifact of record.job.artifacts) {
            if (artifact.media !== "image" || seen.has(artifact.source)) continue;
            if (options.filter === "favorites" && !favorites.has(artifact.source)) continue;
            seen.add(artifact.source);
            result.push({ source: artifact.source, name: artifact.name, prompt: record.prompt, detail: row.title, conversation: row.id, at: time(record.job.startedAt) });
        }
    }
    // Stable: equal times keep their original order.
    return result.map((photo, index) => ({ photo, index }))
        .sort((a, b) => (options.sort === "oldest" ? a.photo.at - b.photo.at : b.photo.at - a.photo.at) || a.index - b.index)
        .map(item => item.photo);
}

/** Records shown in the card layout for a filter. */
export function galleryRecords(conversations: GalleryConversation[], filter: GalleryFilter, favorites: string[], sort: GallerySort) {
    const favored = new Set(favorites);
    const rows = conversations.flatMap(row => row.jobs.map(record => ({ row, record })))
        .filter(({ record }) => filter === "failed" ? record.job.status === "failed"
            : filter === "pictures" ? record.job.artifacts.some(a => a.media === "image")
                : filter === "favorites" ? record.job.artifacts.some(a => favored.has(a.source)) : true);
    return rows.sort((a, b) => sort === "oldest" ? time(a.record.job.startedAt) - time(b.record.job.startedAt) : time(b.record.job.startedAt) - time(a.record.job.startedAt));
}

/** Grid cell size for a column count, leaving `gap` between cells. */
export function tileSize(width: number, columns: number, padding: number, gap: number) {
    return Math.max(48, Math.floor((width - padding * 2 - gap * (columns - 1)) / columns));
}

/** Toggle one source in a selection, preserving order of first selection. */
export function toggleSelection(selection: string[], source: string) {
    return selection.includes(source) ? selection.filter(item => item !== source) : [...selection, source];
}

/** Applies add/remove operations made before a stored list finished loading, so a late restore never discards them. */
export function applyToggles(restored: string[], ops: Array<{ source: string; add: boolean }>) {
    let next = [...restored];
    for (const op of ops) next = op.add ? (next.includes(op.source) ? next : [...next, op.source]) : next.filter(item => item !== op.source);
    return next;
}

export interface GalleryView { layout: "grid" | "cards"; sort: GallerySort; columns: 3 | 4 | 5 }
