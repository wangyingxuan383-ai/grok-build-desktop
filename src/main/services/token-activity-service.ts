import { join } from "node:path";
import type { TokenActivityQuery, TokenActivityReport, TokenActivityWindow, TokenDayBucket, TurnPresentation } from "../../shared/types";
import { JsonStore } from "./json-store";

/** Anonymous daily rollups are kept this long; per-turn detail dies with its session. */
const ROLLUP_RETENTION_DAYS = 400;

interface TurnRecord {
  at: string;
  sessionId: string;
  turnId: string;
  modelId?: string;
  providerId?: string;
  workspace?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  /** A turn with no reported usage still counts toward coverage. */
  hasUsage: boolean;
}

interface DayRollup {
  day: string;
  turns: number;
  turnsWithUsage: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface ActivityData {
  turns: TurnRecord[];
  days: Record<string, DayRollup>;
}

/**
 * Records exactly what the CLI or provider reported per turn — nothing is
 * estimated or extrapolated. The app never computes usage itself; it only
 * relays `turn_completed.usage`, and failed or cancelled turns carry none.
 * Coverage is therefore tracked explicitly so the UI can say how much of the
 * period is actually measured instead of drawing a chart full of silent gaps.
 *
 * Prompt text is never stored.
 */
export class TokenActivityService {
  private readonly store: JsonStore<ActivityData>;

  constructor(userDataPath: string, private readonly now: () => Date = () => new Date()) {
    this.store = new JsonStore(join(userDataPath, "token-activity.json"), { turns: [], days: {} });
  }

  async record(sessionId: string, presentation: TurnPresentation, context: { workspace?: string } = {}): Promise<void> {
    const usage = presentation.usage;
    const at = presentation.completedAt ?? this.now().toISOString();
    const day = at.slice(0, 10);
    await this.store.mutate((data) => {
      if (data.turns.some((turn) => turn.turnId === presentation.turnId && turn.sessionId === sessionId)) return data;

      const record: TurnRecord = {
        at, sessionId, turnId: presentation.turnId,
        hasUsage: Boolean(usage),
        ...(usage?.modelId ? { modelId: usage.modelId } : {}),
        ...(usage?.providerId ? { providerId: usage.providerId } : {}),
        ...(context.workspace ? { workspace: context.workspace } : {}),
        ...(usage?.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
        ...(usage?.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
        ...(usage?.cachedReadTokens === undefined ? {} : { cachedReadTokens: usage.cachedReadTokens }),
        ...(usage?.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens }),
        ...(usage?.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
      };
      data.turns.push(record);

      const rollup = data.days[day] ?? { day, turns: 0, turnsWithUsage: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
      rollup.turns += 1;
      if (record.hasUsage) rollup.turnsWithUsage += 1;
      rollup.inputTokens += record.inputTokens ?? 0;
      rollup.outputTokens += record.outputTokens ?? 0;
      rollup.totalTokens += record.totalTokens ?? sumParts(record);
      data.days[day] = rollup;
      return prune(data, this.now());
    });
  }

  /** Per-turn detail is deleted with its session; the anonymous daily rollup survives. */
  async forgetSession(sessionId: string): Promise<void> {
    await this.forgetSessions([sessionId]);
  }

  /** Batch form prevents concurrent clear operations from overwriting each other. */
  async forgetSessions(sessionIds: Iterable<string>): Promise<void> {
    const removed = new Set(sessionIds);
    if (!removed.size) return;
    await this.store.mutate((data) => {
      data.turns = data.turns.filter((turn) => !removed.has(turn.sessionId));
    });
  }

  async report(query: TokenActivityQuery = {}): Promise<TokenActivityReport> {
    const data = await this.store.get();
    const now = this.now();
    const turns = data.turns.filter((turn) =>
      (!query.modelId || turn.modelId === query.modelId)
      && (!query.providerId || turn.providerId === query.providerId)
      && (!query.workspace || turn.workspace === query.workspace));

    return {
      generatedAt: now.toISOString(),
      windows: {
        rolling24h: windowFor(turns, since(now, 1)),
        today: windowFor(turns, startOfDay(now)),
        rolling7d: windowFor(turns, since(now, 7)),
        rolling30d: windowFor(turns, since(now, 30)),
        month: windowFor(turns, startOfMonth(now)),
      },
      days: dayBuckets(data.days, now),
      models: [...new Set(turns.map((turn) => turn.modelId).filter((value): value is string => Boolean(value)))].sort(),
      workspaces: [...new Set(turns.map((turn) => turn.workspace).filter((value): value is string => Boolean(value)))].sort(),
    };
  }
}

function sumParts(record: TurnRecord): number {
  return (record.inputTokens ?? 0) + (record.outputTokens ?? 0) + (record.reasoningTokens ?? 0);
}

function windowFor(turns: TurnRecord[], from: Date): TokenActivityWindow {
  const selected = turns.filter((turn) => Date.parse(turn.at) >= from.getTime());
  const measured = selected.filter((turn) => turn.hasUsage);
  return {
    from: from.toISOString(),
    turns: selected.length,
    turnsWithUsage: measured.length,
    inputTokens: sum(measured, "inputTokens"),
    outputTokens: sum(measured, "outputTokens"),
    cachedReadTokens: sum(measured, "cachedReadTokens"),
    reasoningTokens: sum(measured, "reasoningTokens"),
    totalTokens: measured.reduce((total, turn) => total + (turn.totalTokens ?? sumParts(turn)), 0),
  };
}

function sum(turns: TurnRecord[], field: "inputTokens" | "outputTokens" | "cachedReadTokens" | "reasoningTokens"): number {
  return turns.reduce((total, turn) => total + (turn[field] ?? 0), 0);
}

/** 53 weeks of days, oldest first, including days with no activity. */
function dayBuckets(days: Record<string, DayRollup>, now: Date): TokenDayBucket[] {
  const buckets: TokenDayBucket[] = [];
  const cursor = startOfDay(now);
  cursor.setUTCDate(cursor.getUTCDate() - 370);
  for (let index = 0; index < 371; index += 1) {
    const day = cursor.toISOString().slice(0, 10);
    const rollup = days[day];
    buckets.push({
      day,
      turns: rollup?.turns ?? 0,
      turnsWithUsage: rollup?.turnsWithUsage ?? 0,
      totalTokens: rollup?.totalTokens ?? 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return buckets;
}

function prune(data: ActivityData, now: Date): ActivityData {
  const cutoff = since(now, ROLLUP_RETENTION_DAYS).getTime();
  const days = Object.fromEntries(Object.entries(data.days).filter(([day]) => Date.parse(`${day}T00:00:00.000Z`) >= cutoff));
  // Per-turn detail is bounded independently; the rollup is the durable record.
  const turns = data.turns.slice(-20_000).filter((turn) => Date.parse(turn.at) >= cutoff);
  return { turns, days };
}

function since(now: Date, days: number): Date {
  const value = new Date(now.getTime());
  value.setUTCDate(value.getUTCDate() - days);
  return value;
}

function startOfDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function startOfMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
