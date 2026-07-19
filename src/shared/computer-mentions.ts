import type { ComputerApp, ComputerWindow } from "./types";

export interface ComputerMentionTarget {
  app: ComputerApp;
  windows: ComputerWindow[];
}

export interface ComputerMentionResolution {
  command: string;
  app?: ComputerApp;
  window?: ComputerWindow;
}

/** Convert an explicit leading @Computer/@应用名 mention into the built-in Skill. */
export function resolveComputerMention(text: string, targets: ComputerMentionTarget[] = []): ComputerMentionResolution | undefined {
  const trimmed = text.trim();
  const generic = trimmed.match(/^@computer(?:\s*[:：]\s*|\s+|$)([\s\S]*)$/i);
  if (generic) return { command: `/computer ${(generic[1] || "请先列出可用的结构化工具和可控制应用，再继续当前任务。").trim()}` };
  if (!trimmed.startsWith("@")) return undefined;

  const lower = trimmed.toLocaleLowerCase();
  const candidates = targets.flatMap(({ app, windows }) => {
    if (!app.controllable) return [];
    const rows: Array<{ alias: string; app: ComputerApp; window?: ComputerWindow }> = [];
    for (const alias of new Set([app.name, app.processName, app.id].map((value) => value.trim()).filter(Boolean))) rows.push({ alias, app });
    for (const window of windows.filter((value) => value.controllable)) if (window.title.trim()) rows.push({ alias: window.title.trim(), app, window });
    return rows;
  }).filter(({ alias }) => {
    const prefix = `@${alias.toLocaleLowerCase()}`;
    if (!lower.startsWith(prefix)) return false;
    const next = trimmed.slice(prefix.length, prefix.length + 1);
    return !next || /[\s:：,，]/.test(next);
  }).sort((a, b) => b.alias.length - a.alias.length);
  const match = candidates[0];
  if (!match) return undefined;
  const prefixLength = match.alias.length + 1;
  const prompt = trimmed.slice(prefixLength).replace(/^[\s:：,，]+/, "").trim() || "请观察目标应用并完成任务。";
  const controllableWindows = targets.find((value) => value.app.id === match.app.id)?.windows.filter((value) => value.controllable) ?? [];
  const window = match.window || (controllableWindows.length === 1 ? controllableWindows[0] : undefined);
  const target = window
    ? `控制目标应用：${match.app.name}；精确窗口：${window.title}；窗口 ID：${window.id}`
    : `控制目标应用：${match.app.name}；应用 ID：${match.app.id}；如有多个窗口请先列出并选择精确窗口`;
  return { command: `/computer ${target}。\n\n${prompt}`, app: match.app, window };
}
