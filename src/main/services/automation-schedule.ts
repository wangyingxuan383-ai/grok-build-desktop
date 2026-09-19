import type { AutomationSchedule } from "../../shared/types";

/** Native recurring UTC wakeups cover both DST offsets. The worker admits only
 * real occurrences in the saved IANA zone, so a missed wakeup cannot break the chain. */
export function calendarWakeups(schedule: Extract<AutomationSchedule, { kind: "daily" | "weekly" }>, now: Date, timeZone: string): Array<{ time: string; days: number[] }> {
  const groups = new Map<string, Set<number>>();
  // Include both sides of the current season and a full upcoming year.
  for (let day = -370; day <= 400; day += 7) {
    const sample = new Date(+now + day * 86_400_000);
    for (const rule of schedule.kind === "weekly" ? schedule.days.map(day => ({ ...schedule, days: [day] })) : [schedule]) {
      const due = nextScheduledRun(rule, sample, now.toISOString(), timeZone)!;
      const time = due.toISOString().slice(11, 16);
      const days = groups.get(time) ?? new Set<number>();
      for (const day of schedule.kind === "daily" ? [0, 1, 2, 3, 4, 5, 6] : [due.getUTCDay()]) days.add(day);
      groups.set(time, days);
    }
  }
  return [...groups].map(([time, days]) => ({ time, days: [...days].sort() }));
}

export function latestCalendarOccurrence(schedule: Extract<AutomationSchedule, { kind: "daily" | "weekly" }>, now: Date, timeZone: string): Date | undefined {
  let cursor = new Date(+now - 16 * 86_400_000);
  let latest: Date | undefined;
  for (;;) {
    const next = nextScheduledRun(schedule, cursor, now.toISOString(), timeZone);
    if (!next || +next > +now) return latest;
    latest = next; cursor = next;
  }
}

/** Calendar rules retain their IANA zone. DST gaps skip; folds fire once (earlier occurrence). */
export function nextScheduledRun(schedule: AutomationSchedule, now: Date, anchor: string, timeZone: string): Date | undefined {
  if (schedule.kind === "once") {
    const at = new Date(schedule.at);
    return Number.isFinite(+at) && +at >= +now ? at : undefined;
  }
  if (schedule.kind === "interval") {
    const origin = Date.parse(anchor);
    const period = schedule.minutes * 60_000;
    if (!Number.isFinite(origin) || period < 60_000) throw new Error("调度起点或间隔无效");
    return new Date(origin + Math.max(0, Math.floor((+now - origin) / period) + 1) * period);
  }
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = (at: number) => Object.fromEntries(formatter.formatToParts(at).filter(p => p.type !== "literal").map(p => [p.type, Number(p.value)]));
  const local = parts(+now);
  const [hour, minute] = schedule.time.split(":").map(Number);
  for (let day = 0; day <= 8; day++) {
    const date = new Date(Date.UTC(local.year!, local.month! - 1, local.day! + day, hour, minute));
    if (schedule.kind === "weekly" && !schedule.days.includes(date.getUTCDay())) continue;
    const offsets = new Set<number>();
    for (const delta of [-36, -12, 0, 12, 36]) {
      const sample = +date + delta * 3_600_000;
      const p = parts(sample);
      offsets.add(Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!) - sample);
    }
    const candidates = [...offsets].map(offset => +date - offset).filter(at => {
      const p = parts(at);
      return p.year === date.getUTCFullYear() && p.month === date.getUTCMonth() + 1 && p.day === date.getUTCDate() && p.hour === hour && p.minute === minute;
    }).sort((a, b) => a - b);
    if (candidates[0] !== undefined && candidates[0] > +now) return new Date(candidates[0]);
  }
  return undefined;
}
