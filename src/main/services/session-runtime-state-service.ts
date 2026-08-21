import { join } from "node:path";
import type { PersistedPromptQueue, PromptQueueEntry, SessionCompactionPolicy, SessionRuntimePreferences } from "../../shared/types";
import { JsonStore } from "./json-store";

interface RuntimeStateFile {
  version: 1;
  sessions: Record<string, SessionRuntimePreferences>;
  queues: Record<string, PersistedPromptQueue>;
}

const DEFAULTS: RuntimeStateFile = { version: 1, sessions: {}, queues: {} };

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

  async save(input: Omit<SessionRuntimePreferences, "updatedAt"> & { updatedAt?: string }): Promise<SessionRuntimePreferences> {
    const value: SessionRuntimePreferences = { ...input, updatedAt: input.updatedAt ?? new Date().toISOString() };
    await this.store.mutate((current) => {
      current.version = 1;
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

  async delete(sessionId: string): Promise<void> {
    await this.store.mutate((current) => {
      delete current.sessions[sessionId];
      delete current.queues[sessionId];
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
