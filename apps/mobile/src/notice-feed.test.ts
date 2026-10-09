import test from "node:test";
import assert from "node:assert/strict";
import { freshNotices, newlyWaiting, noticeDecision, noticeLabel, rememberIds, type InboxItem } from "./notice-feed.ts";

const prefs = { completion: true, failure: true, attention: true, muted: [] as string[] };
const item = (id: string, kind: InboxItem["kind"] = "completion", sessionId = "s1", minute = 0): InboxItem => ({ id, kind, title: "任务 " + id, sessionId, createdAt: new Date(2026, 9, 9, 10, minute).toISOString() });

test("the first read after launch only records existing entries", () => {
    const result = freshNotices([item("a"), item("b")], new Set(), false);
    assert.deepEqual(result.fresh, []);
    assert.deepEqual(result.ids, ["a", "b"]);
});

test("later reads report each unseen entry once, oldest first (R02)", () => {
    const seen = new Set(["a"]);
    const first = freshNotices([item("c", "completion", "s1", 5), item("b", "failure", "s2", 1), item("a")], seen, true);
    assert.deepEqual(first.fresh.map(n => n.id), ["b", "c"]);
    rememberIds(seen, first.ids);
    assert.deepEqual(freshNotices([item("c"), item("b"), item("a")], seen, true).fresh, []);
});

test("no session status change can create a completion reminder by itself (R02)", () => {
    // Switching effort makes the desktop report working → idle; that writes no inbox entry,
    // so the feed has nothing new to announce.
    const seen = new Set(["a"]);
    assert.deepEqual(freshNotices([item("a")], seen, true).fresh, []);
});

test("in the foreground a reminder is a banner only, and none for the open conversation (C02)", () => {
    assert.deepEqual(noticeDecision(item("a"), prefs, { currentSessionId: "s2", appActive: true }), { inApp: true, system: false });
    assert.deepEqual(noticeDecision(item("a"), prefs, { currentSessionId: "s1", appActive: true }), { inApp: false, system: false });
    assert.deepEqual(noticeDecision(item("a"), prefs, { currentSessionId: "", appActive: false }), { inApp: false, system: true });
});

test("preferences, muted sessions and info entries are respected", () => {
    assert.deepEqual(noticeDecision(item("a"), { ...prefs, completion: false }, { currentSessionId: "", appActive: true }), { inApp: false, system: false });
    assert.deepEqual(noticeDecision(item("a", "failure"), { ...prefs, muted: ["s1"] }, { currentSessionId: "", appActive: true }), { inApp: false, system: false });
    assert.deepEqual(noticeDecision(item("a", "info"), prefs, { currentSessionId: "", appActive: true }), { inApp: false, system: false });
    assert.equal(noticeLabel(item("x", "failure")), "执行失败 · 任务 x");
});

test("waiting is reported only on the transition into needs-user", () => {
    const previous = new Map([["s1", "working"], ["s2", "needs-user"]]);
    assert.deepEqual(newlyWaiting(previous, [{ id: "s1", status: "needs-user" }, { id: "s2", status: "needs-user" }, { id: "s3", status: "needs-user" }]), ["s1"]);
});

test("system-only foreground rules notify other sessions once, without a second banner", () => {
    const inApp = { ...prefs, completion: false };
    assert.deepEqual(noticeDecision(item("a"), inApp, { currentSessionId: "s2", appActive: true, systemPrefs: prefs }), { inApp: false, system: true });
    assert.deepEqual(noticeDecision(item("a"), inApp, { currentSessionId: "s1", appActive: true, systemPrefs: prefs }), { inApp: false, system: false });
    assert.deepEqual(noticeDecision(item("a"), prefs, { currentSessionId: "s2", appActive: true, systemPrefs: prefs }), { inApp: true, system: false });
});

test("remembered ids stay bounded", () => {
    const seen = rememberIds(new Set(), Array.from({ length: 310 }, (_, i) => "n" + i));
    assert.equal(seen.size, 300);
    assert.equal(seen.has("n0"), false);
    assert.equal(seen.has("n309"), true);
});
