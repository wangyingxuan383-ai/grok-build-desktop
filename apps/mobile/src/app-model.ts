/**
 * Framework-free rules for the mobile shell: what the Android back gesture does,
 * which status banners are visible, and small text clean-ups for reading.
 * Kept pure so the behaviour is covered by node tests without React Native.
 */
export type Tab = "sessions" | "activity" | "gallery" | "settings";

export interface NavigationState {
  tab: Tab;
  sheet: string | null;
  sessionId: string;
  /** Parent sessions entered before opening a child (sub-agent) session. */
  stack: string[];
  /** A secondary overlay owned by the conversation, e.g. the jump navigator. */
  overlay?: string;
}

export type BackAction =
  | { kind: "close-overlay" }
  | { kind: "close-sheet" }
  | { kind: "open-parent"; sessionId: string }
  | { kind: "close-session" }
  | { kind: "home-tab" }
  | { kind: "exit" };

/** Android back: innermost layer first, never leaves the app while something is open. */
export function backAction(state: NavigationState): BackAction {
  if (state.overlay) return { kind: "close-overlay" };
  if (state.sheet) return { kind: "close-sheet" };
  if (state.sessionId) {
    const parent = state.stack.at(-1);
    return parent ? { kind: "open-parent", sessionId: parent } : { kind: "close-session" };
  }
  if (state.tab !== "sessions") return { kind: "home-tab" };
  return { kind: "exit" };
}

/** Child sessions push the current one; any other open resets the trail. */
export function nextStack(stack: string[], current: string, child: boolean): string[] {
  if (!child || !current) return [];
  return [...stack.filter((id) => id !== current), current].slice(-12);
}

export type BannerKind = "connection" | "failed-send" | "error" | "creating" | "notice" | "share";
export interface BannerInput {
  phase: string;
  connectionDetail?: string;
  error: string;
  notice: string;
  creationPending: boolean;
  failedSend: boolean;
  shareWaiting: boolean;
}
export interface BannerSpec { kind: BannerKind; text: string; tone: "info" | "warning" | "danger" | "success" }

/**
 * At most two strips: connection health (it changes what every action means)
 * plus the single most actionable message. Older code stacked up to five.
 */
export function pickBanners(input: BannerInput): BannerSpec[] {
  const result: BannerSpec[] = [];
  if (input.phase === "blocked") result.push({ kind: "connection", tone: "danger", text: input.connectionDetail || "连接需要处理" });
  else if (input.phase === "offline") result.push({ kind: "connection", tone: "warning", text: "电脑暂时离线，正在自动恢复。已有消息和草稿保留。" });
  const message: BannerSpec | undefined = input.failedSend
    ? { kind: "failed-send", tone: "danger", text: input.error || "发送未完成，可恢复内容后再处理。" }
    : input.error
      ? { kind: "error", tone: "danger", text: input.error }
      : input.creationPending
        ? { kind: "creating", tone: "info", text: "正在电脑建立新会话，请稍候…" }
        : input.notice
          ? { kind: "notice", tone: "info", text: input.notice }
          : input.shareWaiting
            ? { kind: "share", tone: "info", text: "有待加入的分享材料" }
            : undefined;
  if (message) result.push(message);
  return result;
}

/** Plans and similar cards already show their title; drop a first-line heading that repeats it. */
export function stripLeadingTitle(text: string, title?: string): string {
  if (!title) return text;
  const match = /^\s*#{1,6}\s+(.+?)\s*#*\s*(?:\r?\n|$)/.exec(text);
  if (!match || match[1]!.trim() !== title.trim()) return text;
  return text.slice(match[0].length).replace(/^\s*\n/, "");
}

/** Markdown source reads badly in one- or two-line previews; keep only the words. */
export function plainPreview(text: string): string {
  return text
    .replace(/```[a-zA-Z0-9_+-]*\s*/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

const modeLabels: Record<string, string> = { agent: "询问", auto: "自动", plan: "计划" };
const effortLabels: Record<string, string> = { low: "低", medium: "中", high: "高", xhigh: "更高", max: "最高", minimal: "最少", none: "关闭", auto: "自动" };
/** One-line summary used by the composer's configuration chip. */
export function configSummary(model: string | undefined, mode?: string, effort?: string): { model: string; detail: string } {
  const parts = [mode ? modeLabels[mode] || mode : "", effort ? `推理${effortLabels[effort] || effort}` : ""].filter(Boolean);
  return { model: model || "模型待同步", detail: parts.join(" · ") };
}

export interface WorkspaceChoice { id: string; name: string; path?: string }
/**
 * Project picker order for "new session": search across name and path, most recently used
 * project first (from the phone's session list), then the computer's own order. Only the
 * first `limit` rows are shown until the user asks for all of them.
 */
export function orderWorkspaces<T extends WorkspaceChoice>(workspaces: T[], sessions: Array<{ cwd: string; updatedAt: string }>, query = "", limit = 6): { rows: T[]; hidden: number } {
    const key = (value: string) => value.replace(/[\\/]+$/, "").replaceAll("\\", "/").toLowerCase();
    const lastUsed = new Map<string, string>();
    for (const session of sessions) { const k = key(session.cwd); if ((lastUsed.get(k) || "") < session.updatedAt) lastUsed.set(k, session.updatedAt); }
    const needle = query.trim().toLowerCase();
    const matched = workspaces.filter(w => !needle || `${w.name} ${w.path || ""}`.toLowerCase().includes(needle));
    const ranked = matched.map((w, index) => ({ w, index, used: w.path ? lastUsed.get(key(w.path)) || "" : "" }))
        .sort((a, b) => b.used.localeCompare(a.used) || a.index - b.index).map(row => row.w);
    if (needle || ranked.length <= limit + 1) return { rows: ranked, hidden: 0 };
    return { rows: ranked.slice(0, limit), hidden: ranked.length - limit };
}
