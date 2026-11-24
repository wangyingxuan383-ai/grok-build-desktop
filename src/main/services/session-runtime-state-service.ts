import { join } from "node:path";
import type { PersistedPromptQueue, PromptQueueEntry, SessionCompactionPolicy, SessionRuntimePreferences } from "../../shared/types";
import type { StagedMergeBackRecord } from "../../shared/workbench-types";
import { JsonStore } from "./json-store";

interface RuntimeStateFile {
  version: 1;
  sessions: Record<string, SessionRuntimePreferences>;
  queues: Record<string, PersistedPromptQueue>;
  stagedMergeBacks?: Record<string, StagedMergeBackRecord[]>;
}

const DEFAULTS: RuntimeStateFile = { version: 1, sessions: {}, queues: {}, stagedMergeBacks: {} };

/**
 * Local execution metadata that the Grok CLI history does not reliably retain.
 * It never stores prompt/response bodies; queue text already belongs to a user
 * message and remains local beside the conversation projection.
 */
export class SessionRuntimeStateService {
  private readonly store: JsonStore<RuntimeStateFile>;

  constructor(userDataPath: string) {
    this.store = new JsonStore(join(userDataPath, "session-runtime.json"), DEFAULTS);
  }

  async get(sessionId: string): Promise<SessionRuntimePreferences | undefined> {
    return (await this.store.get()).sessions[sessionId];
  }

  async nativeRunSummaries(): Promise<import("../../shared/native-runs").NativeRunSnapshot[]> {
    return Object.values((await this.store.get()).sessions).flatMap(session => session.nativeRuns ?? []);
  }

  async save(input: Omit<SessionRuntimePreferences, "updatedAt"> & { updatedAt?: string }): Promise<SessionRuntimePreferences> {
    let value!: SessionRuntimePreferences;
    await this.store.mutate((current) => {
      current.version = 1;
      const previous = current.sessions[input.sessionId];
      const mapStaged = current.stagedMergeBacks?.[input.sessionId];
      const mergedStaged = input.stagedMergeBacks !== undefined
        ? input.stagedMergeBacks
        : (mapStaged?.length ? structuredClone(mapStaged) : previous?.stagedMergeBacks);
      const mergedSettle = input.settleOnTurnEnd !== undefined ? input.settleOnTurnEnd : previous?.settleOnTurnEnd;
      const mergedNativeRuns = input.nativeRuns !== undefined ? input.nativeRuns : previous?.nativeRuns;
      value = {
        ...input,
        ...(mergedStaged?.length ? { stagedMergeBacks: structuredClone(mergedStaged) } : {}),
        ...(mergedSettle !== undefined ? { settleOnTurnEnd: mergedSettle } : {}),
        ...(mergedNativeRuns !== undefined ? { nativeRuns: structuredClone(mergedNativeRuns) } : {}),
        updatedAt: input.updatedAt ?? new Date().toISOString(),
      };
      current.sessions[value.sessionId] = value;
    });
    return value;
  }

  async patch(sessionId: string, patch: Partial<Omit<SessionRuntimePreferences, "sessionId" | "updatedAt">>): Promise<SessionRuntimePreferences | undefined> {
    let output: SessionRuntimePreferences | undefined;
    await this.store.mutate((current) => {
      const previous = current.sessions[sessionId];
      if (!previous) return;
      output = { ...previous, ...patch, sessionId, updatedAt: new Date().toISOString() };
      current.sessions[sessionId] = output;
    });
    return output;
  }

  async setCompactionPolicy(sessionId: string, policy: SessionCompactionPolicy): Promise<SessionRuntimePreferences> {
    const normalized = normalizeSessionCompactionPolicy(policy);
    let output: SessionRuntimePreferences | undefined;
    await this.store.mutate((current) => {
      const previous = current.sessions[sessionId];
      if (!previous) throw new Error("会话运行配置尚未建立，请先打开会话");
      output = {
        ...previous,
        compaction: normalized,
        updatedAt: new Date().toISOString(),
      };
      current.sessions[sessionId] = output;
    });
    return output!;
  }

  /**
   * Reconcile the model reported by ACP without allowing an upstream alias to
   * replace a provider-scoped Desktop model id.  Explicit model switches write
   * their complete identity separately; session-ready is only authoritative
   * for sessions that are not already bound to a managed Provider.
   */
  async reconcileSessionReady(sessionId: string, reportedModelId: string, providerId?: string): Promise<SessionRuntimePreferences | undefined> {
    let output: SessionRuntimePreferences | undefined;
    await this.store.mutate((current) => {
      const previous = current.sessions[sessionId];
      if (!previous) return;
      if (previous.providerId) {
        output = structuredClone(previous);
        return;
      }
      output = {
        ...previous,
        modelId: reportedModelId,
        providerId,
        updatedAt: new Date().toISOString(),
      };
      current.sessions[sessionId] = output;
    });
    return output;
  }

  /** Remove only launch preferences while retaining the independently durable prompt queue. */
  async deletePreferences(sessionId: string): Promise<void> {
    await this.store.mutate((current) => {
      delete current.sessions[sessionId];
    });
  }

  async getQueue(sessionId: string): Promise<PromptQueueEntry[]> {
    return structuredClone((await this.store.get()).queues[sessionId]?.entries ?? []);
  }

  async getTerminalQueue(sessionId: string): Promise<PromptQueueEntry[]> {
    return structuredClone((await this.store.get()).queues[sessionId]?.terminalEntries ?? []);
  }

  async saveQueue(sessionId: string, entries: PromptQueueEntry[]): Promise<void> {
    const normalized = entries
      .filter((entry) => entry.sessionId === sessionId && !["completed", "failed", "cancelled"].includes(entry.state))
      .slice(0, 128)
      .map((entry, position) => ({ ...entry, position }));
    await this.store.mutate((current) => {
      const terminalEntries = current.queues[sessionId]?.terminalEntries;
      if (!normalized.length && !terminalEntries?.length) delete current.queues[sessionId];
      else current.queues[sessionId] = { version: 1, sessionId, updatedAt: new Date().toISOString(), entries: normalized, ...(terminalEntries?.length ? { terminalEntries } : {}) };
    });
  }

  async recordQueueTerminal(sessionId: string, entry: PromptQueueEntry): Promise<void> {
    await this.store.mutate((current) => {
      const previous = current.queues[sessionId] ?? { version: 1 as const, sessionId, updatedAt: new Date().toISOString(), entries: [] };
      const terminalEntries = [...(previous.terminalEntries ?? []).filter((value) => value.id !== entry.id), structuredClone(entry)].slice(-256);
      current.queues[sessionId] = { ...previous, updatedAt: new Date().toISOString(), entries: previous.entries.filter((value) => value.id !== entry.id), terminalEntries };
    });
  }

  /**
   * A Desktop host restart cannot safely replay a prompt that was already
   * accepted by the previous ACP child: doing so can execute the same user
   * request twice. Keep unsent queued entries, but settle in-flight ownership
   * as failed so the user can explicitly restore it to the composer.
   */
  async interruptInflightQueue(sessionId: string): Promise<PromptQueueEntry[]> {
    let interrupted: PromptQueueEntry[] = [];
    await this.store.mutate((current) => {
      const previous = current.queues[sessionId];
      if (!previous) return;
      interrupted = previous.entries
        .filter((entry) => ["sending", "accepted", "send-now", "interjecting", "interjected"].includes(entry.state))
        .map((entry) => ({ ...entry, state: "failed" as const }));
      if (!interrupted.length) return;
      const ids = new Set(interrupted.map((entry) => entry.id));
      const entries = previous.entries.filter((entry) => !ids.has(entry.id)).map((entry, position) => ({ ...entry, position }));
      const terminalEntries = [
        ...(previous.terminalEntries ?? []).filter((entry) => !ids.has(entry.id)),
        ...interrupted,
      ].slice(-256);
      current.queues[sessionId] = { ...previous, updatedAt: new Date().toISOString(), entries, terminalEntries };
    });
    return structuredClone(interrupted);
  }

  async setSettleOnTurnEnd(sessionId: string, cwd: string, enabled: boolean): Promise<void> {
    await this.store.mutate((current) => {
      const existing = current.sessions[sessionId];
      if (!existing && !enabled) return;
      const base: SessionRuntimePreferences = existing ?? {
        sessionId,
        cwd,
        effort: "",
        mode: "agent",
        updatedAt: new Date().toISOString(),
      };
      const next: SessionRuntimePreferences = { ...base, updatedAt: new Date().toISOString() };
      if (enabled) next.settleOnTurnEnd = true;
      else delete next.settleOnTurnEnd;
      current.sessions[sessionId] = next;
    });
  }

  async getStagedMergeBacks(parentSessionId: string): Promise<StagedMergeBackRecord[]> {
    const state = await this.store.get();
    return structuredClone(state.stagedMergeBacks?.[parentSessionId] ?? []);
  }

  async allStagedMergeBackCounts(): Promise<Map<string, number>> {
    const state = await this.store.get();
    return new Map(
      Object.entries(state.stagedMergeBacks ?? {})
        .filter(([, list]) => list.length > 0)
        .map(([sessionId, list]) => [sessionId, list.length]),
    );
  }

  /** Idempotent per-child overwrite: staging from the same `childSessionId` replaces its prior record. */
  async upsertStagedMergeBack(parentSessionId: string, record: StagedMergeBackRecord): Promise<StagedMergeBackRecord[]> {
    let updated: StagedMergeBackRecord[] = [];
    await this.store.mutate((current) => {
      current.stagedMergeBacks ??= {};
      const existing = current.stagedMergeBacks[parentSessionId] ?? [];
      const idx = existing.findIndex((item) => item.childSessionId === record.childSessionId);
      const next = [...existing];
      if (idx >= 0) next[idx] = structuredClone(record);
      else next.push(structuredClone(record));
      updated = next.slice(-32);
      current.stagedMergeBacks[parentSessionId] = updated;
      if (current.sessions[parentSessionId]) {
        current.sessions[parentSessionId] = {
          ...current.sessions[parentSessionId]!,
          stagedMergeBacks: structuredClone(updated),
          updatedAt: new Date().toISOString(),
        };
      }
    });
    return structuredClone(updated);
  }

  async removeStagedMergeBack(parentSessionId: string, childSessionId: string): Promise<void> {
    await this.store.mutate((current) => {
      const existing = current.stagedMergeBacks?.[parentSessionId];
      if (!existing) return;
      const filtered = existing.filter((item) => item.childSessionId !== childSessionId);
      if (filtered.length) current.stagedMergeBacks![parentSessionId] = filtered;
      else delete current.stagedMergeBacks![parentSessionId];
      if (current.sessions[parentSessionId]) {
        const nextSession = { ...current.sessions[parentSessionId]!, updatedAt: new Date().toISOString() };
        if (filtered.length) nextSession.stagedMergeBacks = structuredClone(filtered);
        else delete nextSession.stagedMergeBacks;
        current.sessions[parentSessionId] = nextSession;
      }
    });
  }

  async consumeStagedMergeBacks(parentSessionId: string): Promise<StagedMergeBackRecord[]> {
    let consumed: StagedMergeBackRecord[] = [];
    await this.store.mutate((current) => {
      consumed = structuredClone(current.stagedMergeBacks?.[parentSessionId] ?? []);
      if (current.stagedMergeBacks) delete current.stagedMergeBacks[parentSessionId];
      if (current.sessions[parentSessionId]) {
        const nextSession = { ...current.sessions[parentSessionId]!, updatedAt: new Date().toISOString() };
        delete nextSession.stagedMergeBacks;
        current.sessions[parentSessionId] = nextSession;
      }
    });
    return consumed;
  }

  async restoreStagedMergeBacks(parentSessionId: string, records: StagedMergeBackRecord[]): Promise<void> {
    if (!records.length) return;
    await this.store.mutate((current) => {
      current.stagedMergeBacks ??= {};
      const next = [...(current.stagedMergeBacks[parentSessionId] ?? [])];
      for (const record of records) {
        const idx = next.findIndex((item) => item.childSessionId === record.childSessionId);
        if (idx >= 0) {
          const existingTime = Date.parse(next[idx]!.stagedAt);
          const candidateTime = Date.parse(record.stagedAt);
          if (Number.isFinite(existingTime) && Number.isFinite(candidateTime) && existingTime > candidateTime) {
            continue;
          }
          next[idx] = structuredClone(record);
        } else {
          next.push(structuredClone(record));
        }
      }
      const bounded = next.slice(-32);
      if (bounded.length) current.stagedMergeBacks[parentSessionId] = bounded;
      else delete current.stagedMergeBacks[parentSessionId];
      if (current.sessions[parentSessionId]) {
        const updatedSession = { ...current.sessions[parentSessionId]!, updatedAt: new Date().toISOString() };
        if (bounded.length) updatedSession.stagedMergeBacks = structuredClone(bounded);
        else delete updatedSession.stagedMergeBacks;
        current.sessions[parentSessionId] = updatedSession;
      }
    });
  }

  async delete(sessionId: string): Promise<void> {
    await this.store.mutate((current) => {
      delete current.sessions[sessionId];
      delete current.queues[sessionId];
      if (current.stagedMergeBacks) delete current.stagedMergeBacks[sessionId];
    });
  }
}

export function normalizeSessionCompactionPolicy(policy: SessionCompactionPolicy): SessionCompactionPolicy {
  if (policy.mode === "inherit") return { mode: "inherit" };
  const threshold = Number(policy.thresholdPercent);
  if (!Number.isInteger(threshold) || threshold < 60 || threshold > 95) {
    throw new Error("会话压缩阈值必须是 60% 到 95% 之间的整数");
  }
  return { mode: "custom", thresholdPercent: threshold };
}

/** Build the launch preferences for a fork without consulting global defaults. */
export function buildForkRuntimePreferences(
  parent: SessionRuntimePreferences | undefined,
  fallback: Omit<SessionRuntimePreferences, "updatedAt">,
): Omit<SessionRuntimePreferences, "updatedAt"> {
  return {
    ...fallback,
    modelId: parent?.modelId ?? fallback.modelId,
    providerId: parent?.providerId ?? fallback.providerId,
    effort: parent?.effort ?? fallback.effort,
    mode: parent?.mode ?? fallback.mode,
    profileId: parent?.profileId ?? fallback.profileId,
    compaction: parent?.compaction ?? fallback.compaction,
  };
}
