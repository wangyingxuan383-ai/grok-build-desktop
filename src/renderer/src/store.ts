import { create } from "zustand";
import type {
  AccountProfile,
  AppSettings,
  Attachment,
  BootstrapData,
  ChatEvent,
  CliUpdateRecord,
  CliVersionStatus,
  CommandInfo,
  LoginState,
  ModelInfo,
  PermissionRequest,
  PromptMeta,
  QuestionItem,
  ReasoningEffort,
  SessionMode,
  SessionSummary,
  ToolCallState,
  TurnFailure,
  ChatTurnState,
  TurnActivityGroup,
  WorkspaceSummary,
  CodexSessionSummary,
  ClaudeSessionSummary,
  BuildInfo,
  OnboardingState,
  AppReleaseStatus,
  PromptQueueEntry,
  UserMessageAttachmentPreview,
  UserMessageDeliveryState,
  TurnPresentation,
  CliRuntimeUpdate,
} from "../../shared/types";

export type UiMessage =
  | { id: string; kind: "user"; text: string; clientMessageId?: string; attachments?: UserMessageAttachmentPreview[]; delivery?: UserMessageDeliveryState }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "thought"; text: string }
  | { id: string; kind: "retry"; attempt?: number; maxAttempts?: number; delayMs?: number; reason?: string }
  | { id: string; kind: "error"; text: string; failure?: TurnFailure }
  | { id: string; kind: "tool"; tool: ToolCallState }
  | { id: string; kind: "permission"; request: PermissionRequest; resolved?: boolean; resolution?: string }
  | { id: string; kind: "question"; requestId: string | number; questions: QuestionItem[]; resolved?: boolean; resolution?: string }
  | { id: string; kind: "plan"; requestId?: string | number; text: string; interactive: boolean; resolved?: boolean; resolution?: string }
  | { id: string; kind: "media"; media: "image" | "video"; source: string; isData?: boolean; mimeType?: string }
  | { id: string; kind: "recovery"; status: "recovered" | "unavailable"; text: string }
  | { id: string; kind: "recap"; text: string; contentHash: string }
  | { id: string; kind: "compact"; status: "started" | "completed" | "failed" | "cancelled"; text?: string }
  | { id: string; kind: "turn-end" };

export interface UiTurnActivityGroup extends TurnActivityGroup {
  items: UiMessage[];
}

export interface UiChatTurn extends ChatTurnState {
  user?: Extract<UiMessage, { kind: "user" }>;
  groups: UiTurnActivityGroup[];
  final?: Extract<UiMessage, { kind: "assistant" }>;
  pending: UiMessage[];
  trailing: UiMessage[];
  presentation?: TurnPresentation;
  legacySegments?: number;
}

export interface SessionView {
  messages: UiMessage[];
  models: ModelInfo[];
  currentModelId: string;
  effort: ReasoningEffort;
  commands: CommandInfo[];
  mode: SessionMode;
  meta: PromptMeta;
  status: string;
  compacting: boolean;
  queue: PromptQueueEntry[];
  turnPresentations: TurnPresentation[];
  followUps: Array<{ id: string; text: string }>;
  runtimeUpdates: CliRuntimeUpdate[];
}

interface AppState {
  loading: boolean;
  error: string;
  settings?: AppSettings;
  accounts: AccountProfile[];
  sessions: SessionSummary[];
  views: Record<string, SessionView>;
  activeSessionId: string;
  cli?: CliVersionStatus;
  login: LoginState;
  updateHistory: CliUpdateRecord[];
  appVersion: string;
  changelog: string;
  attachments: Attachment[];
  workspaces: WorkspaceSummary[];
  codexSessions: CodexSessionSummary[];
  claudeSessions: ClaudeSessionSummary[];
  buildInfo?: BuildInfo;
  onboarding?: OnboardingState;
  appRelease?: AppReleaseStatus;
  bootstrap(data: BootstrapData): void;
  setLoading(value: boolean): void;
  setError(message: string): void;
  setSettings(settings: AppSettings): void;
  setAccounts(accounts: AccountProfile[]): void;
  setSessions(sessions: SessionSummary[]): void;
  setActiveSession(id: string): void;
  setLogin(login: LoginState): void;
  setCli(cli: CliVersionStatus): void;
  setUpdateHistory(history: CliUpdateRecord[]): void;
  addAttachments(values: Attachment[]): void;
  removeAttachment(id: string): void;
  clearAttachments(): void;
  setWorkspaces(values: WorkspaceSummary[]): void;
  setCodexSessions(values: CodexSessionSummary[]): void;
  setClaudeSessions(values: ClaudeSessionSummary[]): void;
  setOnboarding(value: OnboardingState): void;
  setAppRelease(value: AppReleaseStatus): void;
  resolveMessage(sessionId: string, messageId: string): void;
  handleEvent(event: ChatEvent): void;
  handleEvents(events: ChatEvent[]): void;
}

export const emptyView = (): SessionView => ({ messages: [], models: [], currentModelId: "", effort: "", commands: [], mode: "agent", meta: {}, status: "idle", compacting: false, queue: [], turnPresentations: [], followUps: [], runtimeUpdates: [] });

export const useAppStore = create<AppState>((set) => ({
  loading: true,
  error: "",
  accounts: [],
  sessions: [],
  views: {},
  activeSessionId: "",
  login: { running: false },
  updateHistory: [],
  appVersion: "",
  changelog: "",
  attachments: [],
  workspaces: [],
  codexSessions: [],
  claudeSessions: [],
  appRelease: undefined,
  bootstrap: (data) => set({ ...data, loading: false, error: "" }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  setSettings: (settings) => set({ settings }),
  setAccounts: (accounts) => set({ accounts }),
  setSessions: (sessions) => set({ sessions }),
  setActiveSession: (activeSessionId) => set((state) => activeSessionId
    ? { activeSessionId, views: { ...state.views, [activeSessionId]: state.views[activeSessionId] ?? emptyView() } }
    : { activeSessionId }),
  setLogin: (login) => set({ login }),
  setCli: (cli) => set({ cli }),
  setUpdateHistory: (updateHistory) => set({ updateHistory }),
  addAttachments: (values) => set((state) => ({ attachments: [...state.attachments, ...values.filter((value) => !state.attachments.some((item) => item.path && item.path === value.path))] })),
  removeAttachment: (id) => set((state) => ({ attachments: state.attachments.filter((value) => value.id !== id) })),
  clearAttachments: () => set({ attachments: [] }),
  setWorkspaces: (workspaces) => set({ workspaces }),
  setCodexSessions: (codexSessions) => set({ codexSessions }),
  setClaudeSessions: (claudeSessions) => set({ claudeSessions }),
  setOnboarding: (onboarding) => set({ onboarding }),
  setAppRelease: (appRelease) => set({ appRelease }),
  resolveMessage: (sessionId, messageId) => set((state) => {
    const view = state.views[sessionId];
    if (!view) return state;
    return { views: { ...state.views, [sessionId]: { ...view, messages: view.messages.map((message) => message.id === messageId && (message.kind === "permission" || message.kind === "question" || message.kind === "plan") ? { ...message, resolved: true } : message) } } };
  }),
  handleEvent: (event) => set((state) => reduceEvent(state, event)),
  handleEvents: (events) => set((state) => {
    let next = state;
    for (const event of events) next = { ...next, ...reduceEvent(next, event) };
    return next;
  }),
}));

export function reduceEvent(state: AppState, event: ChatEvent): Partial<AppState> {
  if (event.type === "error" && !event.sessionId) return { error: event.message };
  const sessionId = event.sessionId;
  if (!sessionId) return {};
  const view = state.views[sessionId] ?? emptyView();
  let next = { ...view, messages: [...view.messages] };
  switch (event.type) {
    case "session-reset":
      // A transport reset replaces the ACP process, not the conversation.
      // Keep the locally projected body/runtime/queue visible while the main
      // process reloads and deterministically merges the fresh replay. Process
      // local action request ids cannot survive, so only those cards expire.
      next = {
        ...view,
        status: "cold",
        models: [],
        commands: [],
        messages: view.messages.map((message) => isActionMessage(message) && !message.resolved
          ? { ...message, resolved: true, resolution: "请求已随连接重建结束" }
          : message),
      };
      break;
    case "conversation-projection-restore": {
      let projectedState: AppState = {
        ...state,
        views: { ...state.views, [sessionId]: emptyView() },
      };
      for (const saved of event.projection.events) {
        if (!saved || saved.type === "conversation-projection-restore" || saved.sessionId !== sessionId) continue;
        projectedState = { ...projectedState, ...reduceEvent(projectedState, saved as unknown as ChatEvent) };
      }
      const projected = projectedState.views[sessionId];
      if (projected?.messages.length) {
        // JSON-RPC request ids are process-local. A permission/plan/question
        // restored from disk cannot be answered after the ACP transport was
        // rebuilt, so never resurrect it as a clickable stale card.
        next.messages = projected.messages.map((message) => isActionMessage(message) && !message.resolved
          ? { ...message, resolved: true, resolution: "请求已随上次连接结束" }
          : message);
      }
      if (projected) next.turnPresentations = mergeTurnPresentations(next.turnPresentations, projected.turnPresentations);
      if (event.projection.queue) next.queue = event.projection.queue.entries;
      if (event.projection.runtime) {
        next.currentModelId = event.projection.runtime.modelId ?? next.currentModelId;
        next.effort = event.projection.runtime.effort;
        next.mode = event.projection.runtime.mode;
      }
      break;
    }
    case "history-recovery":
      next.messages.push({ id: `history-recovery-${sessionId}`, kind: "recovery", status: event.status, text: event.message });
      break;
    case "session-ready":
      next.models = event.models;
      next.currentModelId = event.currentModelId || next.currentModelId;
      next.effort = event.effort ?? next.effort;
      break;
    case "user-message": {
      const key = event.clientMessageId || event.id;
      let index = key ? next.messages.findIndex((message) => message.kind === "user" && (message.clientMessageId === key || message.id === key)) : -1;
      if (index < 0 && !key) {
        for (let candidate = next.messages.length - 1; candidate >= 0; candidate--) {
          const message = next.messages[candidate];
          if (message?.kind !== "user") continue;
          if ((event.text && message.text === event.text) || (!event.text && event.attachments?.length)) index = candidate;
          break;
        }
      }
      if (index >= 0) {
        const current = next.messages[index] as Extract<UiMessage, { kind: "user" }>;
        const attachmentEcho = !key && !event.text && Boolean(current.attachments?.length);
        next.messages[index] = {
          ...current,
          text: event.text || current.text,
          clientMessageId: event.clientMessageId || current.clientMessageId,
          attachments: attachmentEcho ? current.attachments : mergeAttachmentPreviews(current.attachments, event.attachments),
          delivery: event.delivery || current.delivery,
        };
      } else if (event.text || event.attachments?.length) {
        next.messages.push({ id: event.id || event.clientMessageId || crypto.randomUUID(), kind: "user", clientMessageId: event.clientMessageId, text: event.text, attachments: event.attachments, delivery: event.delivery });
      }
      break;
    }
    case "user-message-status": {
      const index = next.messages.findIndex((message) => message.kind === "user" && (message.clientMessageId === event.clientMessageId || message.id === event.clientMessageId));
      if (index >= 0) next.messages[index] = { ...(next.messages[index] as Extract<UiMessage, { kind: "user" }>), delivery: event.delivery };
      break;
    }
    case "user-attachments-restore": {
      for (const entry of event.entries) {
        let index = next.messages.findIndex((message) => message.kind === "user" && (message.clientMessageId === entry.clientMessageId || message.id === entry.clientMessageId));
        if (index < 0) {
          for (let candidate = next.messages.length - 1; candidate >= 0; candidate--) {
            const message = next.messages[candidate];
            if (message?.kind === "user" && message.text === entry.text && !(message.attachments?.length)) { index = candidate; break; }
          }
        }
        if (index >= 0) {
          const current = next.messages[index] as Extract<UiMessage, { kind: "user" }>;
          next.messages[index] = { ...current, clientMessageId: entry.clientMessageId, attachments: mergeAttachmentPreviews(current.attachments, entry.attachments), delivery: entry.delivery };
        } else if (entry.text || !next.messages.some((message) => message.kind === "user")) {
          next.messages.push({ id: entry.clientMessageId, kind: "user", clientMessageId: entry.clientMessageId, text: entry.text, attachments: entry.attachments, delivery: entry.delivery });
        }
      }
      break;
    }
    case "message-chunk":
      next.messages = appendText(next.messages, "assistant", event.text);
      break;
    case "thought-chunk":
      next.messages = appendText(next.messages, "thought", event.text);
      break;
    case "turn-retry": {
      const id = `retry-${next.turnPresentations.at(-1)?.turnId ?? "active"}`;
      const value: UiMessage = { id, kind: "retry", attempt: event.attempt, maxAttempts: event.maxAttempts, delayMs: event.delayMs, reason: event.reason };
      const index = next.messages.findIndex((message) => message.kind === "retry" && message.id === id);
      if (index >= 0) next.messages[index] = value;
      else next.messages.push(value);
      break;
    }
    case "compact-status": {
      const id = `compact-${next.turnPresentations.at(-1)?.turnId ?? "session"}`;
      const value: UiMessage = { id, kind: "compact", status: event.status, text: event.message };
      const index = next.messages.findIndex((message) => message.id === id);
      if (index >= 0) next.messages[index] = value;
      else next.messages.push(value);
      next.compacting = event.status === "started";
      break;
    }
    case "session-recap": {
      if (!next.messages.some((message) => message.kind === "recap" && message.contentHash === event.contentHash)) {
        next.messages.push({ id: `recap-${event.contentHash}`, kind: "recap", text: event.text, contentHash: event.contentHash });
      }
      break;
    }
    case "follow-ups":
      next.followUps = event.suggestions;
      break;
    case "runtime-update":
      next.runtimeUpdates = [...next.runtimeUpdates.filter((item) => !(item.name === event.update.name && item.at === event.update.at)), event.update].slice(-100);
      break;
    case "tool-call": {
      const index = next.messages.findIndex((message) => message.kind === "tool" && message.tool.toolCallId === event.tool.toolCallId);
      if (index >= 0) {
        const previous = (next.messages[index] as Extract<UiMessage, { kind: "tool" }>).tool;
        const title = event.tool.title === "工具调用" && previous.title !== "工具调用" ? previous.title : event.tool.title;
        next.messages[index] = { id: event.tool.toolCallId, kind: "tool", tool: { ...previous, ...event.tool, title } };
      }
      else next.messages.push({ id: event.tool.toolCallId, kind: "tool", tool: event.tool });
      break;
    }
    case "prompt-queue":
      next.queue = event.entries;
      break;
    case "permission": {
      const id = `permission-${String(event.request.requestId)}`;
      const index = next.messages.findIndex((message) => message.id === id);
      const value: UiMessage = { id, kind: "permission", request: event.request };
      if (index >= 0) next.messages[index] = value;
      else next.messages.push(value);
      break;
    }
    case "question": {
      const id = `question-${String(event.requestId)}`;
      const index = next.messages.findIndex((message) => message.id === id);
      const value: UiMessage = { id, kind: "question", requestId: event.requestId, questions: event.questions };
      if (index >= 0) next.messages[index] = value;
      else next.messages.push(value);
      break;
    }
    case "plan": {
      const interactive = event.requestId !== undefined && event.requestId !== "";
      const id = interactive ? `plan-${String(event.requestId)}` : `plan-document-${next.turnPresentations.at(-1)?.turnId ?? "active"}`;
      const existing = next.messages.findIndex((message) => message.kind === "plan" && message.id === id);
      const value: UiMessage = { id, kind: "plan", requestId: event.requestId, text: event.text, interactive };
      if (existing >= 0) next.messages[existing] = value;
      else next.messages.push(value);
      break;
    }
    case "interaction-resolved":
      next.messages = next.messages.map((message) => isActionMessage(message)
        && message.kind === event.interaction
        && String(actionRequestId(message)) === String(event.requestId)
        ? { ...message, resolved: true, resolution: event.outcome }
        : message);
      break;
    case "media":
      next.messages.push({ id: crypto.randomUUID(), kind: "media", media: event.media, source: event.source, isData: event.isData, mimeType: event.mimeType });
      break;
    case "commands":
      next.commands = event.commands;
      break;
    case "mode":
      next.mode = event.mode === "plan" || event.mode === "auto" ? event.mode : "agent";
      break;
    case "meta":
      next.meta = { ...next.meta, ...event.meta };
      break;
    case "status":
      next.status = event.status;
      if (event.status === "error") {
        next.messages = next.messages.map((message) => message.kind === "tool" && (message.tool.status === "in_progress" || message.tool.status === "pending") ? { ...message, tool: { ...message.tool, status: "failed" as const, error: message.tool.error || event.text || "会话中断" } } : message);
        if (event.text) next.messages.push({ id: `error-${crypto.randomUUID()}`, kind: "error", text: event.text });
        if (next.messages.at(-1)?.kind !== "turn-end") next.messages.push({ id: `turn-end-${crypto.randomUUID()}`, kind: "turn-end" });
      }
      break;
    case "command-output": {
      const index = [...next.messages].reverse().findIndex((message) => message.kind === "tool" && message.tool.title.includes(event.command.slice(0, 20)));
      if (index >= 0) {
        const actual = next.messages.length - 1 - index;
        const value = next.messages[actual] as Extract<UiMessage, { kind: "tool" }>;
        next.messages[actual] = { ...value, tool: { ...value.tool, command: event.command, output: event.output, truncated: event.truncated, exitCode: event.exitCode, status: event.exitCode === 0 ? "completed" : "failed" } };
      }
      break;
    }
    case "turn-completed":
      // Some Grok CLI builds omit subagent_finished during replay or when a
      // subagent is folded into its parent turn. A completed parent turn is
      // authoritative: no child from that turn can still be running.
      next.messages = next.messages.map((message) => {
        if (message.kind === "tool" && (message.tool.status === "in_progress" || message.tool.status === "pending")) return { ...message, tool: { ...message.tool, status: "completed" as const } };
        if (message.kind === "permission" || message.kind === "question" || (message.kind === "plan" && message.interactive)) return { ...message, resolved: true };
        return message;
      });
      if (next.messages.at(-1)?.kind !== "turn-end") next.messages.push({ id: `turn-end-${crypto.randomUUID()}`, kind: "turn-end" });
      if (event.presentation) next.turnPresentations = mergeTurnPresentation(next.turnPresentations, event.presentation);
      break;
    case "turn-started":
      next.turnPresentations = mergeTurnPresentation(next.turnPresentations, event.presentation);
      next.followUps = [];
      break;
    case "turn-presentations-restore":
      next.turnPresentations = [...event.presentations].sort((a, b) => a.ordinal - b.ordinal);
      break;
    case "subagent": {
      if (event.update.sessionUpdate !== "subagent_spawned" && event.update.sessionUpdate !== "subagent_finished") break;
      const finished = event.update.sessionUpdate === "subagent_finished";
      let id = event.update.subagent_id ? `subagent-${event.update.subagent_id}` : "";
      let existing = id ? next.messages.findIndex((message) => message.kind === "tool" && message.tool.toolCallId === id) : -1;
      if (!id && finished) {
        for (let index = next.messages.length - 1; index >= 0; index--) {
          const message = next.messages[index];
          if (!message) continue;
          if (message.kind === "tool" && message.tool.kind === "subagent" && message.tool.status === "in_progress") {
            existing = index;
            id = message.tool.toolCallId;
            break;
          }
        }
      }
      // An id-less spawn cannot be paired reliably. Ignoring it is preferable
      // to creating a permanent "subagent-pending" card.
      if (!id) break;
      const output = [event.update.output, typeof event.update.duration_ms === "number" ? `耗时 ${Math.round(event.update.duration_ms)} ms` : ""].filter(Boolean).join("\n\n");
      const tool: ToolCallState = { toolCallId: id, title: "子 Agent", kind: "subagent", status: finished ? "completed" : "in_progress", output };
      if (existing >= 0) next.messages[existing] = { id, kind: "tool", tool: { ...(next.messages[existing] as Extract<UiMessage, { kind: "tool" }>).tool, ...tool } };
      else next.messages.push({ id, kind: "tool", tool });
      break;
    }
    case "computer-state": {
      // The picker emits an initial state before the prompt. Keep that state in
      // the dedicated chip, and only add the execution card once a chat turn exists.
      if (!next.messages.some((message) => message.kind === "user")) break;
      const id = `computer-${sessionId}`;
      const existing = next.messages.findIndex((message) => message.kind === "tool" && message.tool.toolCallId === id);
      const inProgress = ["running", "paused", "awaiting-app-permission", "awaiting-risk-confirmation"].includes(event.state.status);
      const failed = event.state.status === "error";
      const state = event.state.lastState;
      const tool: ToolCallState = {
        toolCallId: id,
        title: `Computer Use · ${event.state.appName || "Windows 应用"}`,
        kind: "computer_use",
        status: failed ? "failed" : inProgress ? "in_progress" : "completed",
        output: `${event.state.stepCount} 步 · ${event.state.message || event.state.status}`,
        error: failed ? event.state.message : undefined,
        rawInput: state ? { stateId: state.stateId, window: state.window.title, dpi: state.window.dpi, interactiveElements: state.elements.length, capturedAt: state.capturedAt } : undefined,
        content: state?.screenshot ? [{ type: "image", data: state.screenshot, mimeType: "image/png" }] : [],
      };
      if (existing >= 0) next.messages[existing] = { id, kind: "tool", tool };
      else next.messages.push({ id, kind: "tool", tool });
      break;
    }
    case "computer-permission":
    case "computer-risk":
      break;
    case "error":
      next.status = "error";
      next.messages = next.messages.map((message) => message.kind === "tool" && (message.tool.status === "in_progress" || message.tool.status === "pending") ? { ...message, tool: { ...message.tool, status: "failed" as const, error: message.tool.error || "会话在工具完成前中断" } } : message);
      next.messages.push({ id: `error-${crypto.randomUUID()}`, kind: "error", text: event.message, ...(event.failure ? { failure: event.failure } : {}) });
      if (next.messages.at(-1)?.kind !== "turn-end") next.messages.push({ id: `turn-end-${crypto.randomUUID()}`, kind: "turn-end" });
      break;
  }
  const sessions = state.sessions.map((session) => session.id === sessionId && event.type === "status" ? { ...session, status: event.status } : session);
  return { views: { ...state.views, [sessionId]: next }, sessions };
}

export function buildChatTurns(messages: UiMessage[], status = "idle", presentations: TurnPresentation[] = []): UiChatTurn[] {
  const raw: Array<{ id: string; messages: UiMessage[]; completed: boolean; legacySegments?: number }> = [];
  let current: { id: string; messages: UiMessage[]; completed: boolean } | undefined;
  const push = (): void => { if (current?.messages.length) raw.push(current); current = undefined; };
  for (const message of messages) {
    if (message.kind === "user") {
      if (current?.messages.length) { current.completed = true; push(); }
      current = { id: `turn-${message.id}`, messages: [message], completed: false };
    } else if (message.kind === "turn-end") {
      current ??= { id: `turn-${message.id}`, messages: [], completed: false };
      current.completed = true;
      push();
    } else {
      current ??= { id: `turn-${message.id}`, messages: [], completed: false };
      current.messages.push(message);
    }
  }
  push();
  const compact: typeof raw = [];
  for (const turn of raw) {
    const orphanProcess = turn.messages.length > 0 && turn.messages.every((message) => message.kind === "thought" || message.kind === "tool");
    const previous = compact.at(-1);
    if (orphanProcess && previous?.legacySegments) {
      previous.messages.push(...turn.messages);
      previous.completed = previous.completed || turn.completed;
      previous.legacySegments += 1;
    } else compact.push({ ...turn, ...(orphanProcess ? { legacySegments: 1 } : {}) });
  }
  let userOrdinal = 0;
  return compact.map((turn, index) => {
    const user = turn.messages.find((message): message is Extract<UiMessage, { kind: "user" }> => message.kind === "user");
    const ordinal = user ? userOrdinal++ : -1;
    const presentation = user ? presentations.find((value) => value.clientMessageId && value.clientMessageId === user.clientMessageId) ?? presentations.find((value) => value.ordinal === ordinal) : undefined;
    return buildTurn(turn.id, turn.messages, turn.completed, !turn.completed && index === compact.length - 1 && (status === "working" || status === "needs-user"), presentation, turn.legacySegments);
  });
}

function buildTurn(id: string, messages: UiMessage[], completed: boolean, running: boolean, presentation?: TurnPresentation, legacySegments?: number): UiChatTurn {
  const user = messages.find((message): message is Extract<UiMessage, { kind: "user" }> => message.kind === "user");
  const assistants = messages.filter((message): message is Extract<UiMessage, { kind: "assistant" }> => message.kind === "assistant");
  const final = assistants.at(-1);
  const pending = messages.filter((message) => isActionMessage(message) && (message.kind !== "plan" || message.interactive) && !message.resolved);
  const trailing = messages.filter((message) => message.kind === "media" || message.kind === "error");
  const pendingIds = new Set(pending.map((message) => message.id));
  const trailingIds = new Set(trailing.map((message) => message.id));
  const activity = messages.filter((message) => message !== user && message !== final && !pendingIds.has(message.id) && !trailingIds.has(message.id) && !(isActionMessage(message) && message.resolved));
  const groupOrder: UiTurnActivityGroup["kind"][] = ["progress", "files", "commands", "subagents", "computer", "other"];
  const labels: Record<UiTurnActivityGroup["kind"], string> = { progress: "思考与过程说明", files: "文件操作", commands: "命令与终端", subagents: "子 Agent", computer: "Computer Use", other: "其他工具" };
  const grouped = new Map<UiTurnActivityGroup["kind"], UiMessage[]>();
  for (const message of activity) {
    const kind = classifyActivity(message);
    grouped.set(kind, [...(grouped.get(kind) ?? []), message]);
  }
  const groups = groupOrder.flatMap((kind): UiTurnActivityGroup[] => {
    const items = grouped.get(kind) ?? [];
    if (!items.length) return [];
    return [{ kind, label: labels[kind], count: items.length, failed: items.filter(isFailed).length, items }];
  });
  const tools = messages.filter((message): message is Extract<UiMessage, { kind: "tool" }> => message.kind === "tool");
  const writes = tools.filter((message) => isFileWriteTool(message.tool));
  const files = new Set(writes.map((message) => message.tool.locations?.find((location) => location.path)?.path || message.tool.toolCallId)).size;
  const additions = writes.reduce((total, message) => total + (message.tool.additions ?? 0), 0);
  const deletions = writes.reduce((total, message) => total + (message.tool.deletions ?? 0), 0);
  const commands = tools.filter((message) => classifyActivity(message) === "commands").length;
  const subagents = tools.filter((message) => classifyActivity(message) === "subagents").length;
  const failed = tools.filter(isFailed).length;
  return { id, completed, running, user, groups, activityGroups: groups.map(({ items: _items, ...group }) => group), final, pending, trailing, presentation, legacySegments, summary: { files, additions, deletions, commands, tools: tools.length, subagents, failed } };
}

function isActionMessage(message: UiMessage): message is Extract<UiMessage, { kind: "permission" | "question" | "plan" }> {
  return message.kind === "permission" || message.kind === "question" || message.kind === "plan";
}

function actionRequestId(message: Extract<UiMessage, { kind: "permission" | "question" | "plan" }>): string | number | undefined {
  return message.kind === "permission" ? message.request.requestId : message.requestId;
}

function classifyActivity(message: UiMessage): UiTurnActivityGroup["kind"] {
  if (message.kind === "thought" || message.kind === "retry" || message.kind === "assistant" || message.kind === "plan" || message.kind === "permission" || message.kind === "question") return "progress";
  if (message.kind !== "tool") return "other";
  const value = `${message.tool.kind || ""} ${message.tool.title}`.toLowerCase();
  if (/sub.?agent/.test(value)) return "subagents";
  if (/computer[_ -]?use/.test(value)) return "computer";
  if (/read|edit|write|delete|file|search|glob|grep|diff|patch/.test(value)) return "files";
  if (/command|terminal|execute|shell|bash|powershell|cmd|task|process/.test(value)) return "commands";
  return "other";
}

function isFileWriteTool(tool: ToolCallState): boolean {
  const value = `${tool.kind || ""} ${tool.title}`.toLowerCase();
  return tool.oldText !== undefined || tool.newText !== undefined || /\b(?:edit|write|create|delete|patch|apply_patch)(?:_file)?\b/.test(value);
}

function isFailed(message: UiMessage): boolean {
  return message.kind === "tool" && message.tool.status === "failed";
}

function appendText(messages: UiMessage[], kind: "assistant" | "thought", text: string): UiMessage[] {
  const last = messages.at(-1);
  if (last?.kind === kind) {
    messages[messages.length - 1] = { ...last, text: last.text + text };
  } else messages.push({ id: crypto.randomUUID(), kind, text });
  return messages;
}

function mergeAttachmentPreviews(current: UserMessageAttachmentPreview[] | undefined, incoming: UserMessageAttachmentPreview[] | undefined): UserMessageAttachmentPreview[] | undefined {
  if (!incoming?.length) return current;
  const merged = [...(current ?? [])];
  for (const attachment of incoming) {
    const index = merged.findIndex((value) => value.id === attachment.id || (value.name === attachment.name && value.source === attachment.source));
    if (index >= 0) merged[index] = { ...merged[index], ...attachment };
    else merged.push(attachment);
  }
  return merged;
}

function mergeTurnPresentation(current: TurnPresentation[], incoming: TurnPresentation): TurnPresentation[] {
  const next = [...current];
  const index = next.findIndex((value) => value.turnId === incoming.turnId);
  if (index >= 0) next[index] = { ...next[index], ...incoming };
  else next.push(incoming);
  return next.sort((a, b) => a.ordinal - b.ordinal);
}

function mergeTurnPresentations(current: TurnPresentation[], incoming: TurnPresentation[]): TurnPresentation[] {
  let next = [...current];
  for (const value of incoming) next = mergeTurnPresentation(next, value);
  return next;
}
