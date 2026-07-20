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
  ChatTurnState,
  TurnActivityGroup,
  WorkspaceSummary,
  CodexSessionSummary,
  BuildInfo,
  OnboardingState,
  AppReleaseStatus,
  PromptQueueEntry,
} from "../../shared/types";

export type UiMessage =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "thought"; text: string }
  | { id: string; kind: "error"; text: string }
  | { id: string; kind: "tool"; tool: ToolCallState }
  | { id: string; kind: "permission"; request: PermissionRequest; resolved?: boolean }
  | { id: string; kind: "question"; requestId: string | number; questions: QuestionItem[]; resolved?: boolean }
  | { id: string; kind: "plan"; requestId?: string | number; text: string; resolved?: boolean }
  | { id: string; kind: "media"; media: "image" | "video"; source: string; isData?: boolean; mimeType?: string }
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
  queue: PromptQueueEntry[];
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
  setOnboarding(value: OnboardingState): void;
  setAppRelease(value: AppReleaseStatus): void;
  resolveMessage(sessionId: string, messageId: string): void;
  handleEvent(event: ChatEvent): void;
  handleEvents(events: ChatEvent[]): void;
}

export const emptyView = (): SessionView => ({ messages: [], models: [], currentModelId: "", effort: "", commands: [], mode: "agent", meta: {}, status: "idle", queue: [] });

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
      next = emptyView();
      break;
    case "session-ready":
      next.models = event.models;
      next.currentModelId = event.currentModelId || next.currentModelId;
      next.effort = event.effort ?? next.effort;
      break;
    case "user-message": {
      const last = next.messages.at(-1);
      if (last?.kind === "user" && last.text === event.text) break;
      next.messages.push({ id: event.id || crypto.randomUUID(), kind: "user", text: event.text });
      break;
    }
    case "message-chunk":
      next.messages = appendText(next.messages, "assistant", event.text);
      break;
    case "thought-chunk":
      next.messages = appendText(next.messages, "thought", event.text);
      break;
    case "tool-call": {
      const index = next.messages.findIndex((message) => message.kind === "tool" && message.tool.toolCallId === event.tool.toolCallId);
      if (index >= 0) next.messages[index] = { id: event.tool.toolCallId, kind: "tool", tool: { ...(next.messages[index] as Extract<UiMessage, { kind: "tool" }>).tool, ...event.tool } };
      else next.messages.push({ id: event.tool.toolCallId, kind: "tool", tool: event.tool });
      break;
    }
    case "prompt-queue":
      next.queue = event.entries;
      break;
    case "permission":
      next.messages.push({ id: `permission-${String(event.request.requestId)}`, kind: "permission", request: event.request });
      break;
    case "question":
      next.messages.push({ id: `question-${String(event.requestId)}`, kind: "question", requestId: event.requestId, questions: event.questions });
      break;
    case "plan": {
      const existing = next.messages.findIndex((message) => message.kind === "plan" && (message.requestId === event.requestId || !event.requestId));
      const value: UiMessage = { id: `plan-${String(event.requestId || crypto.randomUUID())}`, kind: "plan", requestId: event.requestId, text: event.text };
      if (existing >= 0) next.messages[existing] = value;
      else next.messages.push(value);
      break;
    }
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
        if (message.kind === "permission" || message.kind === "question" || message.kind === "plan") return { ...message, resolved: true };
        return message;
      });
      if (next.messages.at(-1)?.kind !== "turn-end") next.messages.push({ id: `turn-end-${crypto.randomUUID()}`, kind: "turn-end" });
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
      next.messages.push({ id: `error-${crypto.randomUUID()}`, kind: "error", text: event.message });
      if (next.messages.at(-1)?.kind !== "turn-end") next.messages.push({ id: `turn-end-${crypto.randomUUID()}`, kind: "turn-end" });
      break;
  }
  const sessions = state.sessions.map((session) => session.id === sessionId && event.type === "status" ? { ...session, status: event.status } : session);
  return { views: { ...state.views, [sessionId]: next }, sessions };
}

export function buildChatTurns(messages: UiMessage[], status = "idle"): UiChatTurn[] {
  const raw: Array<{ id: string; messages: UiMessage[]; completed: boolean }> = [];
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
  return raw.map((turn, index) => buildTurn(turn.id, turn.messages, turn.completed, !turn.completed && index === raw.length - 1 && (status === "working" || status === "needs-user")));
}

function buildTurn(id: string, messages: UiMessage[], completed: boolean, running: boolean): UiChatTurn {
  const user = messages.find((message): message is Extract<UiMessage, { kind: "user" }> => message.kind === "user");
  const assistants = messages.filter((message): message is Extract<UiMessage, { kind: "assistant" }> => message.kind === "assistant");
  const final = assistants.at(-1);
  const pending = messages.filter((message) => (message.kind === "permission" || message.kind === "question" || message.kind === "plan") && !message.resolved);
  const trailing = messages.filter((message) => message.kind === "media" || message.kind === "error");
  const pendingIds = new Set(pending.map((message) => message.id));
  const trailingIds = new Set(trailing.map((message) => message.id));
  const activity = messages.filter((message) => message !== user && message !== final && !pendingIds.has(message.id) && !trailingIds.has(message.id));
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
  const files = tools.filter((message) => classifyActivity(message) === "files").length;
  const commands = tools.filter((message) => classifyActivity(message) === "commands").length;
  const subagents = tools.filter((message) => classifyActivity(message) === "subagents").length;
  const failed = tools.filter(isFailed).length;
  return { id, completed, running, user, groups, activityGroups: groups.map(({ items: _items, ...group }) => group), final, pending, trailing, summary: { files, commands, tools: tools.length, subagents, failed } };
}

function classifyActivity(message: UiMessage): UiTurnActivityGroup["kind"] {
  if (message.kind === "thought" || message.kind === "assistant" || message.kind === "plan" || message.kind === "permission" || message.kind === "question") return "progress";
  if (message.kind !== "tool") return "other";
  const value = `${message.tool.kind || ""} ${message.tool.title}`.toLowerCase();
  if (/sub.?agent/.test(value)) return "subagents";
  if (/computer[_ -]?use/.test(value)) return "computer";
  if (/read|edit|write|delete|file|search|glob|grep|diff|patch/.test(value)) return "files";
  if (/command|terminal|execute|shell|bash|powershell|cmd|task|process/.test(value)) return "commands";
  return "other";
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
