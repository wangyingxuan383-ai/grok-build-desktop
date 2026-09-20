import { describe, expect, it } from "vitest";
import { calendarWakeups, latestCalendarOccurrence, nextScheduledRun } from "./automation-schedule";

describe("persistent schedule clock", () => {
  const anchor = "2026-01-01T00:00:00Z";
  it("keeps native weekly wakeups for both DST offsets and the correct UTC weekday", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(calendarWakeups({ kind: "weekly", time: "23:30", days: [0] }, now, "America/New_York")).toEqual(expect.arrayContaining([
      { time: "04:30", days: [1] }, { time: "03:30", days: [1] },
    ]));
    expect(calendarWakeups({ kind: "daily", time: "09:00" }, now, "Asia/Shanghai")).toEqual([{ time: "01:00", days: [0, 1, 2, 3, 4, 5, 6] }]);
  });
  it("admits only one real occurrence across the DST fold", () => {
    expect(latestCalendarOccurrence({ kind: "daily", time: "01:30" }, new Date("2026-11-01T06:30:00Z"), "America/New_York")?.toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });
  it("does not move an interval when queried repeatedly", () => {
    for (const now of ["2026-01-01T00:01:00Z", "2026-01-01T00:09:59Z"]) expect(nextScheduledRun({ kind: "interval", minutes: 10 }, new Date(now), anchor, "Asia/Shanghai")?.toISOString()).toBe("2026-01-01T00:10:00.000Z");
  });
  it("uses the saved zone across a UTC day boundary", () => {
    expect(nextScheduledRun({ kind: "daily", time: "00:30" }, new Date("2026-01-01T16:31:00Z"), anchor, "Asia/Shanghai")?.toISOString()).toBe("2026-01-02T16:30:00.000Z");
  });
  it("skips a nonexistent DST wall-clock time", () => {
    expect(nextScheduledRun({ kind: "daily", time: "02:30" }, new Date("2026-03-08T05:00:00Z"), anchor, "America/New_York")?.toISOString()).toBe("2026-03-09T06:30:00.000Z");
  });
  it("runs once during a DST fold, at the earlier occurrence", () => {
    const rule = { kind: "daily", time: "01:30" } as const;
    expect(nextScheduledRun(rule, new Date("2026-11-01T04:00:00Z"), anchor, "America/New_York")?.toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(nextScheduledRun(rule, new Date("2026-11-01T05:31:00Z"), anchor, "America/New_York")?.toISOString()).toBe("2026-11-02T06:30:00.000Z");
  });
  it("uses weekdays in the saved zone and a stable absolute one-off timestamp", () => {
    expect(nextScheduledRun({ kind: "weekly", days: [1], time: "09:00" }, new Date("2026-09-20T22:00:00Z"), anchor, "Asia/Shanghai")?.toISOString()).toBe("2026-09-21T01:00:00.000Z");
    expect(nextScheduledRun({ kind: "once", at: "2026-09-21T09:00:00+08:00" }, new Date("2026-09-20T22:00:00Z"), anchor, "America/New_York")?.toISOString()).toBe("2026-09-21T01:00:00.000Z");
  });
});
