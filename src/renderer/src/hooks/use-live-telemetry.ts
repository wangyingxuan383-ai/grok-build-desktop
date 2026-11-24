import { useSyncExternalStore } from "react";
import type { SessionSummary, ToolCallState } from "../../../shared/types";
import { useAppStore, type SessionView, type UiMessage } from "../store";

export const STALL_THRESHOLD_MS = 25_000;

export interface SessionTimingRecord {
  startedAtMs: number;
  lastEventAtMs: number;
  signature: string;
}

export interface SessionLiveTelemetry {
  sessionId: string;
  isWorking: boolean;
  isCompacting: boolean;
  elapsedMs: number;
  quietMs: number;
  isStalled: boolean;
  stalledReason: string;
  summary: string;
  activeToolTitle?: string;
  activeFilePath?: string;
  filesTouched: number;
  toolsRun: number;
  isSnoozed: boolean;
  snoozedUntilMs?: number;
}

const timings = new Map<string, SessionTimingRecord>();
const snoozes = new Map<string, number>();
const listeners = new Set<() => void>();
let intervalId: ReturnType<typeof globalThis.setInterval> | undefined;
let storeUnsubscribe: (() => void) | undefined;
let currentNow = Date.now();

function viewActivitySignature(view: SessionView | undefined, summaryStatus?: string): string {
  if (!view) return `summary:${summaryStatus ?? "idle"}`;
  const last = view.messages.at(-1);
  let tail = "empty";
  if (last) {
    if ("text" in last) tail = `${last.kind}:${last.id}:${last.text?.length ?? 0}`;
    else if (last.kind === "tool") tail = `tool:${last.id}:${last.tool.status}:${last.tool.output?.length ?? 0}:${last.tool.additions ?? 0}`;
    else if ("resolved" in last) tail = `${last.kind}:${last.id}:${last.resolved ? 1 : 0}`;
    else tail = `${last.kind}:${last.id}`;
  }
  return `${view.status}|${summaryStatus ?? ""}|${view.compacting ? 1 : 0}|${view.messages.length}|${tail}|${view.runtimeUpdates.length}`;
}

function syncFromAppStore(now = Date.now()): boolean {
  const state = useAppStore.getState();
  const seenIds = new Set<string>();
  let changed = false;

  for (const session of state.sessions) {
    seenIds.add(session.id);
  }
  for (const id of Object.keys(state.views)) {
    seenIds.add(id);
  }

  for (const id of seenIds) {
    const view = state.views[id];
    const summary = state.sessions.find((s) => s.id === id);
    const effectiveStatus = view?.status && view.status !== "idle" ? view.status : summary?.status ?? "idle";
    const working = effectiveStatus === "working" || view?.compacting === true;
    const sig = viewActivitySignature(view, summary?.status);
    const prev = timings.get(id);

    if (!working) {
      if (prev) {
        timings.delete(id);
        changed = true;
      }
      continue;
    }

    const presentationStart = Date.parse(view?.turnPresentations.at(-1)?.startedAt ?? "");
    if (!prev) {
      timings.set(id, {
        startedAtMs: Number.isFinite(presentationStart) ? presentationStart : now,
        lastEventAtMs: now,
        signature: sig,
      });
      changed = true;
    } else if (prev.signature !== sig) {
      prev.lastEventAtMs = now;
      prev.signature = sig;
      if (Number.isFinite(presentationStart) && presentationStart > 0) {
        prev.startedAtMs = presentationStart;
      }
      changed = true;
    }
  }

  for (const id of [...timings.keys()]) {
    if (!seenIds.has(id)) {
      timings.delete(id);
      changed = true;
    }
  }

  for (const [id, until] of snoozes) {
    if (until <= now || !seenIds.has(id)) {
      snoozes.delete(id);
      changed = true;
    }
  }

  return changed;
}

function needsClock(now = Date.now()): boolean {
  if (listeners.size === 0) return false;
  if (timings.size > 0) return true;
  for (const until of snoozes.values()) {
    if (until > now) return true;
  }
  return false;
}

function reconcileClock(): void {
  const shouldRun = needsClock(Date.now());
  if (shouldRun && intervalId === undefined) {
    intervalId = globalThis.setInterval(() => {
      currentNow = Date.now();
      syncFromAppStore(currentNow);
      if (!needsClock(currentNow)) {
        reconcileClock();
      }
      notifyListeners();
    }, 1000);
  } else if (!shouldRun && intervalId !== undefined) {
    globalThis.clearInterval(intervalId);
    intervalId = undefined;
  }
}

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

function ensureStoreSubscription(): void {
  if (storeUnsubscribe) return;
  syncFromAppStore(Date.now());
  storeUnsubscribe = useAppStore.subscribe(() => {
    currentNow = Date.now();
    const changed = syncFromAppStore(currentNow);
    reconcileClock();
    if (changed) notifyListeners();
  });
}

function subscribe(listener: () => void): () => void {
  ensureStoreSubscription();
  listeners.add(listener);
  currentNow = Date.now();
  syncFromAppStore(currentNow);
  reconcileClock();
  return () => {
    listeners.delete(listener);
    reconcileClock();
  };
}

export function getSessionTiming(sessionId: string): SessionTimingRecord | undefined {
  return timings.get(sessionId);
}

export function snoozeSessionTelemetry(sessionId: string, durationMs = 15 * 60_000): void {
  if (!sessionId) return;
  ensureStoreSubscription();
  currentNow = Date.now();
  const untilMs = currentNow + Math.max(1_000, durationMs);
  snoozes.set(sessionId, untilMs);
  if (typeof window !== "undefined" && typeof window.grokDesktop?.snoozeSession === "function") {
    void window.grokDesktop.snoozeSession(sessionId, new Date(untilMs).toISOString()).catch(() => undefined);
  }
  reconcileClock();
  notifyListeners();
}

export function clearSessionTelemetrySnooze(sessionId: string): void {
  const removed = snoozes.delete(sessionId);
  if (typeof window !== "undefined" && typeof window.grokDesktop?.snoozeSession === "function") {
    void window.grokDesktop.snoozeSession(sessionId, null).catch(() => undefined);
  }
  const state = useAppStore.getState();
  if (state.sessions.some((s) => s.id === sessionId && s.snoozedUntil)) {
    state.setSessions(state.sessions.map((s) => (s.id === sessionId ? { ...s, snoozedUntil: undefined } : s)));
  }
  if (removed) {
    currentNow = Date.now();
    reconcileClock();
    notifyListeners();
  }
}

export function isSessionTelemetrySnoozed(sessionId: string, now = Date.now()): boolean {
  const until = snoozes.get(sessionId);
  if (until !== undefined && until > now) return true;
  const persisted = useAppStore.getState().sessions.find((s) => s.id === sessionId)?.snoozedUntil;
  const parsed = persisted ? Date.parse(persisted) : Number.NaN;
  return Number.isFinite(parsed) && parsed > now;
}

function basenameOf(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) || filePath;
}

function truncateLabel(value: string, max = 26): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}…` : compact;
}

function extractToolFilePath(tool: ToolCallState): string | undefined {
  const loc = tool.locations?.find((item) => item.path)?.path;
  if (loc) return loc;
  if (tool.rawInput && typeof tool.rawInput === "object") {
    const raw = tool.rawInput as Record<string, unknown>;
    const candidate = [raw.path, raw.filePath, raw.file_path].find(
      (item): item is string => typeof item === "string" && Boolean(item.trim()),
    );
    if (candidate) return candidate.trim();
  }
  return undefined;
}

function currentTurnMessages(messages: readonly UiMessage[]): UiMessage[] {
  for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
    const msg = messages[idx];
    if (msg?.kind === "user") {
      return messages.slice(idx + 1);
    }
  }
  return [...messages];
}

function buildStalledReason(
  quietMs: number,
  view: SessionView | undefined,
  turnItems: readonly UiMessage[],
  activeTool: ToolCallState | undefined,
): string {
  const quietSec = Math.max(25, Math.floor(quietMs / 1000));
  if (view?.compacting || turnItems.at(-1)?.kind === "compact") {
    return `已静默 ${quietSec}s · 等待上下文压缩完成`;
  }
  if (activeTool) {
    if (activeTool.kind === "subagent" || activeTool.source === "subagent-lifecycle") {
      return `已静默 ${quietSec}s · 等待子 Agent（${truncateLabel(activeTool.title, 20)}）返回`;
    }
    if (activeTool.source === "computer-host" || activeTool.serverName?.toLowerCase() === "grok_desktop_computer") {
      return `已静默 ${quietSec}s · 等待桌面控制操作响应`;
    }
    if (activeTool.source === "mcp" || activeTool.serverName) {
      const mcpLabel = activeTool.serverName
        ? `${activeTool.serverName}/${activeTool.toolName || activeTool.title}`
        : activeTool.title;
      return `已静默 ${quietSec}s · 等待 MCP 工具（${truncateLabel(mcpLabel, 22)}）响应`;
    }
    const signature = `${activeTool.kind ?? ""} ${activeTool.toolName ?? ""} ${activeTool.title}`.toLowerCase();
    if (activeTool.command || /\b(?:command|terminal|execute|shell|bash|powershell|cmd)\b/.test(signature)) {
      return `已静默 ${quietSec}s · 等待终端命令完成（${truncateLabel(activeTool.command || activeTool.title, 22)}）`;
    }
    return `已静默 ${quietSec}s · 等待工具（${truncateLabel(activeTool.title, 20)}）执行结果`;
  }

  const last = turnItems.at(-1);
  if (last?.kind === "retry") {
    return `已静默 ${quietSec}s · 等待上游重试恢复${last.attempt ? `（第 ${last.attempt} 次）` : ""}`;
  }
  if (last?.kind === "thought") {
    return `已静默 ${quietSec}s · 等待模型深度推理输出`;
  }
  if (turnItems.length === 0) {
    return `已静默 ${quietSec}s · 等待上游模型首字节响应`;
  }
  return `已静默 ${quietSec}s · 等待上游模型继续生成`;
}

export function computeSessionTelemetry(
  sessionId: string,
  view: SessionView | undefined,
  summary: SessionSummary | undefined,
  timing: { startedAtMs: number; lastEventAtMs: number } | undefined,
  now: number,
  snoozedUntilMs?: number,
): SessionLiveTelemetry {
  const effectiveStatus = view?.status && view.status !== "idle" ? view.status : summary?.status ?? "idle";
  const isCompacting = view?.compacting === true;
  const isWorking = effectiveStatus === "working" || isCompacting;
  const persistedSnooze = summary?.snoozedUntil ? Date.parse(summary.snoozedUntil) : undefined;
  const effectiveSnooze = Math.max(
    snoozedUntilMs ?? 0,
    Number.isFinite(persistedSnooze) ? (persistedSnooze as number) : 0,
  );
  const isSnoozed = effectiveSnooze > now;

  const turnItems = view ? currentTurnMessages(view.messages) : [];
  const tools = turnItems.filter((m): m is Extract<UiMessage, { kind: "tool" }> => m.kind === "tool");
  const filesSet = new Set<string>();
  for (const item of tools) {
    const file = extractToolFilePath(item.tool);
    if (file) filesSet.add(file.toLowerCase());
  }

  const activeToolMsg = [...tools]
    .reverse()
    .find((m) => m.tool.status === "in_progress" || m.tool.status === "pending");
  const activeTool = activeToolMsg?.tool;
  const activeFile = activeTool ? extractToolFilePath(activeTool) : undefined;

  let summaryText = "";
  if (isCompacting) {
    summaryText = "正在压缩上下文";
  } else if (activeTool) {
    if (activeFile) {
      const verb = /\b(?:edit|write|patch|create|delete)\b/i.test(`${activeTool.kind ?? ""} ${activeTool.toolName ?? ""} ${activeTool.title}`)
        ? "编辑"
        : "读取";
      summaryText = `${verb} ${basenameOf(activeFile)}`;
    } else if (activeTool.command) {
      summaryText = `运行 ${truncateLabel(activeTool.command, 22)}`;
    } else if (activeTool.kind === "subagent" || activeTool.source === "subagent-lifecycle") {
      summaryText = `子 Agent · ${truncateLabel(activeTool.title, 18)}`;
    } else {
      summaryText = truncateLabel(activeTool.title, 24);
    }
  } else if (isWorking) {
    const last = turnItems.at(-1);
    if (last?.kind === "assistant") summaryText = "正在输出回答";
    else if (last?.kind === "thought") summaryText = "正在思考推理";
    else if (last?.kind === "retry") summaryText = "正在重试上游连接";
    else summaryText = "等待模型响应";
  }

  const elapsedMs = isWorking && timing ? Math.max(0, now - timing.startedAtMs) : 0;
  const quietMs = isWorking && timing ? Math.max(0, now - timing.lastEventAtMs) : 0;
  const isStalled = isWorking && effectiveStatus !== "needs-user" && quietMs >= STALL_THRESHOLD_MS;
  const stalledReason = isStalled ? buildStalledReason(quietMs, view, turnItems, activeTool) : "";

  return {
    sessionId,
    isWorking,
    isCompacting,
    elapsedMs,
    quietMs,
    isStalled,
    stalledReason,
    summary: summaryText,
    activeToolTitle: activeTool?.title,
    activeFilePath: activeFile,
    filesTouched: filesSet.size,
    toolsRun: tools.length,
    isSnoozed,
    ...(isSnoozed ? { snoozedUntilMs: effectiveSnooze } : {}),
  };
}

export function formatTelemetryElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m${rem}s` : `${min}m`;
}

export function useLiveTelemetryClock(): number {
  return useSyncExternalStore(
    subscribe,
    () => (needsClock(currentNow) ? currentNow : 0),
    () => 0,
  );
}

export function useSessionLiveTelemetry(sessionId: string | undefined): SessionLiveTelemetry | null {
  const tick = useLiveTelemetryClock();
  const view = useAppStore((state) => (sessionId ? state.views[sessionId] : undefined));
  const summary = useAppStore((state) => (sessionId ? state.sessions.find((s) => s.id === sessionId) : undefined));
  if (!sessionId) return null;
  const timing = timings.get(sessionId);
  const snoozeUntil = snoozes.get(sessionId);
  const now = tick || Date.now();
  const result = computeSessionTelemetry(sessionId, view, summary, timing, now, snoozeUntil);
  if (!result.isWorking && !result.isSnoozed) return null;
  return result;
}
