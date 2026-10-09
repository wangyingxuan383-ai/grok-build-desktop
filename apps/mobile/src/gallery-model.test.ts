import test from "node:test";
import assert from "node:assert/strict";
import { galleryPhotos, galleryRecords, tileSize, toggleSelection, type GalleryConversation } from "./gallery-model.ts";
import { createBackStack } from "./back-layers.ts";

const image = (source: string) => ({ id: source, source, media: "image" });
const conversations: GalleryConversation[] = [
    { id: "a", title: "海报", jobs: [
        { requestId: "1", prompt: "旧图", job: { status: "completed", startedAt: "2026-10-01T00:00:00Z", artifacts: [image("s1"), { id: "v", source: "v1", media: "video" }] } },
        { requestId: "2", prompt: "新图", job: { status: "completed", startedAt: "2026-10-05T00:00:00Z", artifacts: [image("s2")] } },
    ] },
    { id: "b", title: "图标", jobs: [
        { requestId: "3", prompt: "中间", job: { status: "failed", startedAt: "2026-10-03T00:00:00Z", artifacts: [image("s3"), image("s1")] } },
    ] },
];

test("pictures are newest first, images only, each source once", () => {
    assert.deepEqual(galleryPhotos(conversations, { filter: "pictures", favorites: [], sort: "newest" }).map(p => p.source), ["s2", "s3", "s1"]);
    assert.deepEqual(galleryPhotos(conversations, { filter: "pictures", favorites: [], sort: "oldest" }).map(p => p.source), ["s1", "s3", "s2"]);
});

test("favorites and conversation filters narrow the pictures", () => {
    assert.deepEqual(galleryPhotos(conversations, { filter: "favorites", favorites: ["s3"], sort: "newest" }).map(p => p.source), ["s3"]);
    assert.deepEqual(galleryPhotos(conversations, { filter: "pictures", favorites: [], sort: "newest", conversation: "b" }).map(p => p.source), ["s3", "s1"]);
});

test("card records follow the filter and sort", () => {
    assert.deepEqual(galleryRecords(conversations, "failed", [], "newest").map(r => r.record.requestId), ["3"]);
    assert.deepEqual(galleryRecords(conversations, "all", [], "newest").map(r => r.record.requestId), ["2", "3", "1"]);
});

test("tile size fits the requested columns", () => {
    assert.equal(tileSize(393, 3, 12, 3), 121);
    assert.equal(tileSize(393, 5, 12, 3), 71);
});

test("selection toggles keep first-selected order", () => {
    assert.deepEqual(toggleSelection(toggleSelection(["a"], "b"), "a"), ["b"]);
});

test("back layers close the innermost page first and can decline", () => {
    const stack = createBackStack(), calls: string[] = [];
    const outer = stack.push({ current: () => { calls.push("editor"); return true; } });
    const inner = stack.push({ current: () => { calls.push("selection"); return false; } });
    assert.equal(stack.handle(), true);
    assert.deepEqual(calls, ["selection", "editor"]);
    inner(); outer();
    assert.equal(stack.handle(), false);
});

test("favorite changes made before the stored list loads are merged, not lost", async () => {
    const { applyToggles } = await import("./gallery-model.ts");
    assert.deepEqual(applyToggles(["old"], [{ source: "new", add: true }, { source: "old", add: false }]), ["new"]);
});
