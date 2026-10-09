import test from "node:test";
import assert from "node:assert/strict";
import { diagnosticPrompt, formatAgo, formatBytes, minutesLabel, pickSuggestion, searchSettings } from "./settings-model.ts";

test("search finds settings by natural words and names their place and scope", () => {
    const keyboard = searchSettings("输入法");
    assert.equal(keyboard[0]?.page, "about");
    assert.equal(keyboard[0]?.place, "这部手机 → 关于与诊断");
    assert.ok(searchSettings("指纹").some(r => r.page === "security"));
    assert.ok(searchSettings("后台 电池").every(r => r.page === "notifications"));
    assert.deepEqual(searchSettings("   "), []);
});

test("only the most important suggestion shows, and dismissed ones stay hidden", () => {
    const base = { following: true, batteryExempt: false, lockEnabled: false, autoMode: true, notificationsEnabled: false, dismissed: [] as string[] };
    assert.equal(pickSuggestion(base)?.id, "notifications-off");
    assert.equal(pickSuggestion({ ...base, dismissed: ["suggest:notifications-off"] })?.id, "battery");
    assert.equal(pickSuggestion({ ...base, notificationsEnabled: true, batteryExempt: true })?.id, "lock-auto");
    assert.equal(pickSuggestion({ ...base, notificationsEnabled: true, batteryExempt: true, lockEnabled: true, updateVersion: "0.4.1" })?.id, "update:0.4.1");
    assert.equal(pickSuggestion({ following: false, lockEnabled: true, autoMode: false, dismissed: [] }), undefined);
});

test("formatting helpers", () => {
    assert.equal(formatBytes(0), "0 KB");
    assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
    assert.equal(formatBytes(300 * 1024 * 1024), "300 MB");
    assert.equal(formatAgo(0), "尚未同步");
    assert.equal(formatAgo(1000, 1000 + 30_000), "30 秒前");
    assert.equal(minutesLabel(23 * 60 + 5), "23:05");
});

test("the diagnostic prompt carries no address or token", () => {
    const text = diagnosticPrompt({ phase: "离线", detail: "连接超时", mobileVersion: "0.4.0", desktopVersion: "0.12.0" });
    assert.match(text, /连接超时/);
    assert.doesNotMatch(text, /https?:\/\//);
});
