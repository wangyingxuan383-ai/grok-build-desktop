import test from "node:test";
import assert from "node:assert/strict";
import { addDays, buildSchedule, describeChanges, describeSchedule, initialWorkspace, rankSessions, shiftTime, splitInstant, workspaceForUpdate, type TaskFormValues } from "./task-form-model.ts";

const options = [{ id: "w1", name: "Other", path: "C:/Other" }, { id: "w2", name: "Mine", path: "C:/Mine" }];

test("editing a task whose project is unavailable keeps the original binding (R01)", () => {
    assert.deepEqual(initialWorkspace("C:/Original", options), { id: "", missingPath: "C:/Original" });
    assert.deepEqual(initialWorkspace("c:\\Mine\\", options), { id: "w2" });
    assert.deepEqual(initialWorkspace(undefined, options), { id: "w1" });
});

test("an update only carries workspaceId after an explicit project choice (R01)", () => {
    assert.deepEqual(workspaceForUpdate("w1", false), {});
    assert.deepEqual(workspaceForUpdate("w1", true), { workspaceId: "w1" });
    assert.deepEqual(workspaceForUpdate("", true), {});
});

test("schedules are validated instead of parsing free text", () => {
    const now = new Date(2026, 9, 9, 10, 0);
    assert.equal(buildSchedule({ kind: "once", date: "2026-10-09", time: "09:00", minutes: "", days: [] }, now).error, "执行时间已经过去");
    const once = buildSchedule({ kind: "once", date: "2026-10-10", time: "09:30", minutes: "", days: [] }, now).schedule;
    assert.equal(once?.kind, "once");
    assert.equal(new Date((once as { at: string }).at).getHours(), 9);
    assert.equal(buildSchedule({ kind: "weekly", date: "", time: "08:00", minutes: "", days: [] }).error, "至少选择一天");
    assert.deepEqual(buildSchedule({ kind: "weekly", date: "", time: "08:00", minutes: "", days: [5, 1, 1] }).schedule, { kind: "weekly", time: "08:00", days: [1, 5] });
    assert.ok(buildSchedule({ kind: "interval", date: "", time: "", minutes: "2", days: [] }).error);
    assert.ok(buildSchedule({ kind: "daily", date: "", time: "25:00", minutes: "", days: [] }).error);
});

test("date and time helpers wrap correctly", () => {
    assert.equal(addDays(new Date(2026, 11, 31), 1), "2027-01-01");
    assert.equal(shiftTime("23:45", 30), "00:15");
    assert.equal(shiftTime("00:10", -30), "23:40");
    const split = splitInstant(new Date(2026, 9, 12, 7, 5).toISOString());
    assert.deepEqual(split, { date: "2026-10-12", time: "07:05" });
});

test("schedule summaries read naturally", () => {
    assert.equal(describeSchedule({ kind: "daily", time: "09:00" }, "Asia/Shanghai"), "每天 09:00（Asia/Shanghai）");
    assert.equal(describeSchedule({ kind: "interval", minutes: 120 }, ""), "每 2 小时");
    assert.equal(describeSchedule({ kind: "weekly", time: "08:00", days: [1, 3] }, ""), "每周一、三 08:00");
});

test("the save summary lists only what changed", () => {
    const base: TaskFormValues = { name: "日报", prompt: "a", workspace: "w1", schedule: { kind: "daily", time: "09:00" }, zone: "Asia/Shanghai", modelId: "m", mode: "agent", effort: "", account: "", enabled: true, notify: true, wake: false, computer: false };
    const names = { workspace: (id: string) => id === "w1" ? "Other" : "Mine", account: (id: string) => id || "当前账号" };
    assert.deepEqual(describeChanges(base, { ...base, name: "周报" }, names), ["名称：日报 → 周报"]);
    assert.deepEqual(describeChanges(base, { ...base, workspace: "w2", wake: true }, names), ["项目：Other → Mine", "唤醒电脑：关 → 开"]);
});

test("target sessions are searchable with favourites and recent first, no fixed cut-off", () => {
    const sessions = Array.from({ length: 40 }, (_, i) => ({ id: "s" + i, title: "会话 " + i, updatedAt: new Date(2026, 0, 1, 0, i).toISOString() }));
    const ranked = rankSessions(sessions, "", ["s3"], ["s5"]);
    assert.equal(ranked.length, 40);
    assert.deepEqual(ranked.slice(0, 2).map(s => s.id), ["s3", "s5"]);
    assert.deepEqual(rankSessions(sessions, "会话 39", [], []).map(s => s.id), ["s39"]);
});


test("calendar input rejects normalized impossible dates", async () => {
 const {isDate}=await import("./task-form-model.ts");
 assert.equal(isDate("2026-02-30"),false);assert.equal(isDate("2028-02-29"),true);assert.equal(isDate("2026-13-01"),false);
});
