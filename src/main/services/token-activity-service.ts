import { join } from "node:path";
import type { TokenActivityQuery, TokenActivityReport, TokenActivityWindow, TokenDayBucket, TurnPresentation, TurnUsage } from "../../shared/types";
import { mergeTurnUsage } from "../../shared/turn-usage";
import { JsonStore } from "./json-store";

/** Keep local history for 400 days; deleted-session totals become anonymous aggregates. */
const ROLLUP_RETENTION_DAYS = 400;
const REPORT_DAYS = 371;

export interface TokenRecordContext {workspace?:string; relatedTurnIds?:string[]}

export interface TurnRecord {
  at: string;
  sessionId: string;
  turnId: string;
  modelId?: string;
  providerId?: string;
  workspace?: string;
  source?: TurnUsage["source"];
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  reasoningTokens?: number;
  /** Only an explicitly returned total is counted. Component fields are never added to manufacture it. */
  totalTokens?: number;
  hasUsage: boolean;
  fieldSources?: TurnUsage["fieldSources"];
  mixedSources?: boolean;
  usageIsIncomplete?: boolean;
}

export interface DayRollup {
  day: string;
  turns: number;
  turnsWithUsage: number;
  /** Old UTC aggregates cannot recover whether every total was explicitly returned. */
  turnsWithTotal?: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Child-agent tokens kept out of totalTokens; see windowFor(). */
  subagentTokens?: number;
  subagentTurns?: number;
  sources?: Record<string, number>;
}

export interface ActivityData {
  schemaVersion?: number;
  turns: TurnRecord[];
  /** v1 UTC all-session aggregate; migration leaves only its unrecoverable anonymous remainder here. */
  days: Record<string, DayRollup>;
  legacyUtcDays?: Record<string, DayRollup>;
  /** v2 local-date aggregates created only when detailed session records are deleted. */
  anonymousDays?: Record<string, DayRollup>;
}

/**
 * Stores raw per-turn provider/CLI usage and anonymous deletion rollups.
 * Session quota and account allowance are provided by their own services.
 * Prompt text is never stored.
 */
export class TokenActivityService {
  private readonly store: JsonStore<ActivityData>;
  private readonly timeZone: string;

  constructor(userDataPath: string, private readonly now: () => Date = () => new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC") {
    this.timeZone = validTimeZone(timeZone);
    // No schemaVersion default: JsonStore merges defaults into legacy files, and
    // an absent version is the signal that their UTC aggregate needs migration.
    this.store = new JsonStore(join(userDataPath, "token-activity.json"), { turns: [], days: {}, anonymousDays: {}, legacyUtcDays: {} });
  }

  async record(sessionId: string, presentation: TurnPresentation, context: TokenRecordContext = {}): Promise<void> {
    await this.store.mutate((raw) => {
      const data = migrate(raw);
      const related=relatedUsageIds(presentation,context);
      const oldRows=data.turns.filter(turn=>turn.sessionId===sessionId&&related.includes(turn.turnId)).sort((a,b)=>a.at.localeCompare(b.at));
      const previous=oldRows.at(-1);
      data.turns=data.turns.filter(turn=>turn.sessionId!==sessionId||!related.includes(turn.turnId)||turn.turnId===presentation.turnId);
      const existingIndex = data.turns.findIndex((turn) => turn.turnId === presentation.turnId && turn.sessionId === sessionId);
      const record = mergeTokenTurn(previous ?? data.turns[existingIndex], sessionId, presentation, context, this.now());
      if (existingIndex >= 0) {
        // A normal prompt result can precede the authoritative end-of-turn usage.
        // Replace the same row instead of counting both notifications.
        if (!presentation.usage) return data;
        data.turns[existingIndex] = record;
      } else data.turns.push(record);
      return prune(data, this.now());
    });
  }

  async forgetSession(sessionId: string): Promise<void> { await this.forgetSessions([sessionId]); }

  /** Detail is deleted, but exact totals move to a local-day anonymous bucket. */
  async forgetSessions(sessionIds: Iterable<string>): Promise<void> {
    const removed = new Set(sessionIds);
    if (!removed.size) return;
    await this.store.mutate((raw) => {
      const data = migrate(raw);
      const keep: TurnRecord[] = [];
      for (const turn of data.turns) {
        if (!removed.has(turn.sessionId)) { keep.push(turn); continue; }
        const day = localDateKey(turn.at, this.timeZone);
        const bucket = data.anonymousDays![day] ?? emptyRollup(day);
        addTurnToRollup(bucket, turn);
        data.anonymousDays![day] = bucket;
      }
      data.turns = keep;
      return prune(data, this.now());
    });
  }

  async rebindSession(sourceSessionId: string, targetSessionId: string, workspace: string): Promise<void> {
    await this.store.mutate((raw) => {
      const data = migrate(raw);
      for (const turn of data.turns) {
        if (turn.sessionId !== sourceSessionId) continue;
        turn.sessionId = targetSessionId;
        turn.workspace = workspace;
      }
      return data;
    });
  }

  async report(query: TokenActivityQuery = {}): Promise<TokenActivityReport> {
    let data = await this.store.get();
    if (data.schemaVersion !== 2) data = await this.store.mutate((raw) => migrate(raw));
    const now = this.now();
    return buildTokenReport(data,query,now,this.timeZone);
  }
}

/** Shared by JSON migration/fallback and the SQLite Worker. */
export function mergeTokenTurn(previous: TurnRecord | undefined, sessionId: string, presentation: TurnPresentation, context: TokenRecordContext, now: Date): TurnRecord {
  const keys = ["source", "modelId", "providerId", "inputTokens", "outputTokens", "cachedReadTokens", "reasoningTokens", "totalTokens", "fieldSources", "mixedSources", "usageIsIncomplete"] as const;
  const previousUsage = previous?.hasUsage
    ? Object.fromEntries([...keys.map(key => [key, previous[key]]), ["source", previous.source ?? "history"], ["exact", true]]) as unknown as TurnUsage
    : undefined;
  const usage = mergeTurnUsage(previousUsage, presentation.usage);
  const record: TurnRecord = {
    ...previous, at: presentation.completedAt ?? previous?.at ?? now.toISOString(),
    sessionId, turnId: presentation.turnId, hasUsage: Boolean(usage),
    ...(context.workspace === undefined ? {} : { workspace: context.workspace }),
  };
  if (usage) for (const key of keys) if (usage[key] !== undefined) Object.assign(record, { [key]: usage[key] });
  return record;
}

function matches(turn: TurnRecord, query: TokenActivityQuery): boolean {
  return (!query.modelId || turn.modelId === query.modelId)
    && (!query.providerId || turn.providerId === query.providerId)
    && (!query.workspace || turn.workspace === query.workspace);
}

function windowFor(turns: TurnRecord[], from: Date): TokenActivityWindow {
  const selected = turns.filter((turn) => Date.parse(turn.at) >= from.getTime());
  // Child-agent usage is reported by the CLI on its own event and may already be
  // billed inside the parent turn's total, so it is summed separately instead of
  // being added to the parent figures.
  const parents = selected.filter((turn) => turn.source !== "subagent");
  const children = selected.filter((turn) => turn.source === "subagent");
  const measured = parents.filter((turn) => turn.hasUsage);
  const totals = measured.filter((turn) => turn.totalTokens !== undefined);
  return {
    from: from.toISOString(),
    turns: parents.length,
    turnsWithUsage: measured.length,
    turnsWithTotal: totals.length,
    inputTokens: sum(measured, "inputTokens"),
    outputTokens: sum(measured, "outputTokens"),
    cachedReadTokens: sum(measured, "cachedReadTokens"),
    reasoningTokens: sum(measured, "reasoningTokens"),
    totalTokens: totals.reduce((total, turn) => total + turn.totalTokens!, 0),
    subagentTokens: children.reduce((total, turn) => total + (turn.totalTokens ?? 0), 0),
    subagentTurns: children.length,
  };
}

function sum(turns: TurnRecord[], field: "inputTokens" | "outputTokens" | "cachedReadTokens" | "reasoningTokens"): number {
  return turns.reduce((total, turn) => total + (turn[field] ?? 0), 0);
}

function dayBuckets(input: { turns: TurnRecord[]; anonymous: Record<string, DayRollup>; legacy: Record<string, DayRollup>; now: Date; timeZone: string }): TokenDayBucket[] {
  const newest = localDateKey(input.now.toISOString(), input.timeZone);
  const first = shiftDay(newest, -(REPORT_DAYS - 1));
  const buckets = new Map<string, TokenDayBucket>();
  for (let index = 0; index < REPORT_DAYS; index += 1) buckets.set(shiftDay(first, index), emptyDayBucket(shiftDay(first, index)));

  for (const turn of input.turns) {
    const day = localDateKey(turn.at, input.timeZone);
    const bucket = buckets.get(day);
    if (!bucket) continue;
    // Child-agent rows are visible in the report but excluded from the day totals,
    // for the same reason described in windowFor().
    if (turn.source === "subagent") {
      bucket.source = bucket.source === "none" ? "turn-details" : bucket.source;
      bucket.subagentTokens += turn.totalTokens ?? 0;
      bucket.subagentTurns += 1;
      continue;
    }
    bucket.turns += 1;
    if (turn.hasUsage) bucket.turnsWithUsage += 1;
    if (turn.totalTokens !== undefined) { bucket.turnsWithTotal += 1; bucket.totalTokens += turn.totalTokens; }
    bucket.source = "turn-details";
  }
  for (const [day, rollup] of Object.entries(input.anonymous)) {
    const bucket = buckets.get(day);
    if (!bucket) continue;
    mergeRollup(bucket, rollup, "anonymous-local");
  }
  for (const [day, rollup] of Object.entries(input.legacy)) {
    const bucket = buckets.get(day);
    if (!bucket) continue;
    mergeRollup(bucket, rollup, "legacy-utc");
  }
  return [...buckets.values()];
}

function mergeRollup(bucket: TokenDayBucket, rollup: DayRollup, source: "anonymous-local" | "legacy-utc"): void {
  bucket.turns += finiteNonNegative(rollup.turns);
  bucket.turnsWithUsage += finiteNonNegative(rollup.turnsWithUsage);
  bucket.turnsWithTotal += finiteNonNegative(rollup.turnsWithTotal);
  bucket.totalTokens += finiteNonNegative(rollup.totalTokens);
  bucket.subagentTokens += finiteNonNegative(rollup.subagentTokens);
  bucket.subagentTurns += finiteNonNegative(rollup.subagentTurns);
  bucket.source = bucket.source === "none" || bucket.source === source ? source : "mixed";
}

function emptyDayBucket(day: string): TokenDayBucket {
  return { day, turns: 0, turnsWithUsage: 0, turnsWithTotal: 0, totalTokens: 0, subagentTokens: 0, subagentTurns: 0, source: "none" };
}

export function emptyRollup(day: string): DayRollup {
  return { day, turns: 0, turnsWithUsage: 0, turnsWithTotal: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, subagentTokens: 0, subagentTurns: 0, sources: {} };
}

export function addTurnToRollup(rollup: DayRollup, turn: TurnRecord): void {
  // Child-agent usage is tracked alongside, never inside, the parent totals.
  if (turn.source === "subagent") {
    rollup.subagentTurns = (rollup.subagentTurns ?? 0) + 1;
    rollup.subagentTokens = (rollup.subagentTokens ?? 0) + (turn.totalTokens ?? 0);
    return;
  }
  rollup.turns += 1;
  if (turn.hasUsage) rollup.turnsWithUsage += 1;
  if (turn.totalTokens !== undefined) { rollup.turnsWithTotal = (rollup.turnsWithTotal ?? 0) + 1; rollup.totalTokens += turn.totalTokens; }
  rollup.inputTokens += turn.inputTokens ?? 0;
  rollup.outputTokens += turn.outputTokens ?? 0;
  const source = turn.source ?? "unknown";
  rollup.sources ??= {};
  rollup.sources[source] = (rollup.sources[source] ?? 0) + 1;
}

function sourceList(turns: TurnRecord[], anonymous: Record<string, DayRollup>, legacy: Record<string, DayRollup>): string[] {
  const sources = new Set<string>(turns.flatMap((turn) => turn.source ? [turn.source] : []));
  for (const rollup of Object.values(anonymous)) if (rollup.turns > 0 || (rollup.subagentTurns ?? 0)>0) for (const source of Object.keys(rollup.sources ?? {})) sources.add(source);
  if (Object.values(legacy).some((rollup) => rollup.turns > 0)) sources.add("legacy-utc-aggregate");
  return [...sources].sort();
}

function hasAnonymousData(data: ActivityData, now: Date, timeZone: string): boolean {
  const today = localDateKey(now.toISOString(), timeZone);
  const first = shiftDay(today, -(REPORT_DAYS - 1));
  const inRange = (day: string) => day >= first && day <= today;
  return Object.entries(data.anonymousDays ?? {}).some(([day, row]) => inRange(day) && (row.turns > 0 || (row.subagentTurns ?? 0)>0))
    || Object.entries(data.legacyUtcDays ?? {}).some(([day, row]) => inRange(day) && (row.turns > 0 || (row.subagentTurns ?? 0)>0));
}

/** Convert existing all-session UTC aggregates into an explicitly legacy anonymous remainder. */
export function migrate(raw: ActivityData): ActivityData {
  const data: ActivityData = {
    schemaVersion: raw.schemaVersion,
    turns: Array.isArray(raw.turns) ? raw.turns : [],
    days: raw.days && typeof raw.days === "object" ? raw.days : {},
    legacyUtcDays: raw.legacyUtcDays && typeof raw.legacyUtcDays === "object" ? raw.legacyUtcDays : {},
    anonymousDays: raw.anonymousDays && typeof raw.anonymousDays === "object" ? raw.anonymousDays : {},
  };
  if (data.schemaVersion === 2) return data;
  const legacy = data.legacyUtcDays!;
  for (const [day, rollup] of Object.entries(data.days)) {
    const detailed = data.turns.filter((turn) => utcDateKey(turn.at) === day);
    const remainder: DayRollup = {
      day,
      turns: Math.max(0, finiteNonNegative(rollup.turns) - detailed.length),
      turnsWithUsage: Math.max(0, finiteNonNegative(rollup.turnsWithUsage) - detailed.filter((turn) => turn.hasUsage).length),
      // v1 did not retain whether a total was reported or derived from parts.
      turnsWithTotal: 0,
      inputTokens: Math.max(0, finiteNonNegative(rollup.inputTokens) - detailed.reduce((sum, turn) => sum + (turn.inputTokens ?? 0), 0)),
      outputTokens: Math.max(0, finiteNonNegative(rollup.outputTokens) - detailed.reduce((sum, turn) => sum + (turn.outputTokens ?? 0), 0)),
      // Subtract exactly the legacy contribution to avoid counting the current details twice.
      totalTokens: Math.max(0, finiteNonNegative(rollup.totalTokens) - detailed.reduce((sum, turn) => sum + legacyV1Total(turn), 0)),
      sources: { "legacy-utc-aggregate": Math.max(0, finiteNonNegative(rollup.turns) - detailed.length) },
    };
    if (remainder.turns || remainder.turnsWithUsage || remainder.inputTokens || remainder.outputTokens || remainder.totalTokens) legacy[day] = remainder;
  }
  data.days = {};
  data.schemaVersion = 2;
  return data;
}

/** Mirrors the old aggregate only while removing already represented details; never used for new totals. */
function legacyV1Total(turn: TurnRecord): number {
  return turn.totalTokens ?? ((turn.inputTokens ?? 0) + (turn.outputTokens ?? 0) + (turn.reasoningTokens ?? 0));
}

export function prune(data: ActivityData, now: Date): ActivityData {
  const cutoff = since(now, ROLLUP_RETENTION_DAYS).getTime();
  const inRange = (day: string) => {
    // Date-only keys from legacy UTC data and local anonymous rows can differ by
    // at most one day; retention is long enough that this does not lose live rows.
    const timestamp = Date.parse(`${day}T00:00:00Z`);
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  };
  // Retain every detail within the documented 400-day window. A count cap
  // silently lost totals and broke deduplication when older turns replayed.
  data.turns = data.turns.filter((turn) => Date.parse(turn.at) >= cutoff);
  data.legacyUtcDays = Object.fromEntries(Object.entries(data.legacyUtcDays ?? {}).filter(([day]) => inRange(day)));
  data.anonymousDays = Object.fromEntries(Object.entries(data.anonymousDays ?? {}).filter(([day]) => inRange(day)));
  data.days = {};
  data.schemaVersion = 2;
  return data;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function utcDateKey(value: string): string { return value.slice(0, 10); }

export function localDateKey(value: string, timeZone: string): string {
  const parts = dateParts(new Date(value), timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
function dateParts(date: Date, timeZone: string): { year: string; month: string; day: string; hour: string; minute: string; second: string } {
  let formatter = dateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    dateFormatters.set(timeZone, formatter);
  }
  const values = formatter.formatToParts(date);
  const get = (type: string, fallback: string) => values.find((part) => part.type === type)?.value ?? fallback;
  return { year: get("year", "1970"), month: get("month", "01").padStart(2, "0"), day: get("day", "01").padStart(2, "0"), hour: get("hour", "00").padStart(2, "0"), minute: get("minute", "00").padStart(2, "0"), second: get("second", "00").padStart(2, "0") };
}

function zonedMidnight(day: string, timeZone: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  const target = Date.UTC(year!, month! - 1, date!);
  let candidate = target;
  for (let index = 0; index < 4; index += 1) {
    const part = dateParts(new Date(candidate), timeZone);
    const represented = Date.UTC(Number(part.year), Number(part.month) - 1, Number(part.day), Number(part.hour), Number(part.minute), Number(part.second));
    const delta = represented - target;
    if (delta === 0) break;
    candidate -= delta;
  }
  return new Date(candidate);
}

function shiftDay(day: string, count: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, date!));
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}

function since(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1_000);
}

export function validTimeZone(value: string): string {
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return value; }
  catch { return "UTC"; }
}

export function buildTokenReport(data:ActivityData,query:TokenActivityQuery,now:Date,timeZone:string):TokenActivityReport {
    const filtered = data.turns.filter((turn) => matches(turn, query));
    const today = localDateKey(now.toISOString(), timeZone);
    const dayStart = zonedMidnight(today, timeZone);
    const monthStart = zonedMidnight(`${localDateKey(now.toISOString(), timeZone).slice(0, 7)}-01`, timeZone);
    const hasFilters = Boolean(query.modelId || query.providerId || query.workspace);

    return {
      generatedAt: now.toISOString(),
      timeZone: timeZone,
      anonymousExcludedByFilter: hasFilters && hasAnonymousData(data, now, timeZone),
      windows: {
        rolling24h: windowFor(filtered, since(now, 1)),
        today: windowFor(filtered.filter((turn) => localDateKey(turn.at, timeZone) === today), dayStart),
        rolling7d: windowFor(filtered, since(now, 7)),
        rolling30d: windowFor(filtered, since(now, 30)),
        month: windowFor(filtered.filter((turn) => Date.parse(turn.at) >= monthStart.getTime()), monthStart),
      },
      days: dayBuckets({
        turns: filtered,
        anonymous: hasFilters ? {} : data.anonymousDays ?? {},
        legacy: hasFilters ? {} : data.legacyUtcDays ?? {},
        now,
        timeZone: timeZone,
      }),
      sources: sourceList(filtered, hasFilters ? {} : data.anonymousDays ?? {}, hasFilters ? {} : data.legacyUtcDays ?? {}),
      models: unique(data.turns.map((turn) => turn.modelId)),
      providers: unique(data.turns.map((turn) => turn.providerId)),
      workspaces: unique(data.turns.map((turn) => turn.workspace)),
    };
}

/** Alias reconciliation applies only to authenticated native child reports, never to parent rows. */
export function relatedUsageIds(presentation:TurnPresentation,context:TokenRecordContext):string[]{
 return [...new Set([presentation.turnId,...(presentation.usage?.source==="subagent"&&presentation.turnId.startsWith("subagent:")?(context.relatedTurnIds??[]).filter(id=>id.startsWith("subagent:")):[])])].slice(0,12);
}
