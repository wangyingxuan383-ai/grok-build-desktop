import type { AppMenuCommand } from "./types";
import type { DesktopProductivitySettings } from "./productivity";

export const APP_SHORTCUTS = [
  { command: "new-session", label: "新建会话", accelerator: "Control+N" },
  { command: "search-sessions", label: "搜索会话", accelerator: "Control+F" },
  { command: "search-conversation", label: "搜索当前会话", accelerator: "Control+Shift+F" },
  { command: "focus-composer", label: "聚焦输入框", accelerator: "Control+L" },
  { command: "command-search", label: "命令面板", accelerator: "Control+K" },
  { command: "toggle-sidebar", label: "显示或隐藏侧栏", accelerator: "" },
  { command: "open-task-center", label: "任务中心", accelerator: "" },
  { command: "open-settings", label: "设置", accelerator: "" },
] as const satisfies ReadonlyArray<{ command: AppMenuCommand; label: string; accelerator: string }>;

const aliases: Record<string, string> = { ctrl: "Control", control: "Control", cmdorctrl: "Control", commandorcontrol: "Control", shift: "Shift", alt: "Alt", option: "Alt", meta: "Super", super: "Super", win: "Super" };
const modifiers = ["Control", "Alt", "Shift", "Super"];
export function normalizeAccelerator(value: string): string {
  if (!value.trim()) return "";
  if (value.length > 100) throw new Error("快捷键过长");
  const parts = value.trim().split("+").map(s => s.trim());
  const key = parts.pop()!;
  const mods = parts.map(part => aliases[part.toLowerCase()]);
  if (mods.some(mod => !mod) || new Set(mods).size !== mods.length) throw new Error("快捷键修饰键无效");
  let normalizedKey = key.length === 1 && /^[a-z0-9]$/i.test(key) ? key.toUpperCase() : /^(Space|Enter|Tab|Backspace|Delete|Home|End|PageUp|PageDown|Up|Down|Left|Right|F(?:[1-9]|1\d|2[0-4]))$/i.test(key) ? key.toLowerCase() === "space" ? "Space" : key[0]!.toUpperCase() + key.slice(1) : "";
  if (/^f\d+$/i.test(normalizedKey)) normalizedKey = normalizedKey.toUpperCase();
  if (!normalizedKey || (!mods.length && !/^F\d+$/.test(normalizedKey))) throw new Error("请使用 Ctrl / Alt 等修饰键，或功能键，例如 Control+Shift+Space");
  return [...modifiers.filter(mod => mods.includes(mod)), normalizedKey].join("+");
}

export function shortcutFor(command: AppMenuCommand, settings?: Partial<DesktopProductivitySettings>): string {
  const custom = settings?.shortcuts?.[command];
  return custom !== undefined ? custom : APP_SHORTCUTS.find(item => item.command === command)?.accelerator ?? "";
}

export function validateShortcutBindings(settings: Partial<DesktopProductivitySettings>): void {
  const used = new Map<string, string>();
  // Standard editing, application-window and the Computer Use emergency keys stay available.
  for (const key of ["Control+C", "Control+V", "Control+X", "Control+A", "Control+Z", "Control+Shift+Z", "Control+Y", "Control+Alt+Escape", "Alt+F4", "F5", "F11", "F12", "Control+R", "Control+Shift+I", "Super+L", "Super+D"]) used.set(key.toLowerCase(), "系统或编辑操作");
  for (const key of Object.keys(settings.shortcuts ?? {})) if (!APP_SHORTCUTS.some(item => item.command === key)) throw new Error("不支持的自定义快捷键");
  const entries = [
    ...APP_SHORTCUTS.map(item => ({ label: item.label, value: shortcutFor(item.command, settings) })),
    { label: "快速提问", value: settings.quickAskShortcut ?? "" },
    { label: "截图提问", value: settings.screenshotShortcut ?? "" },
  ];
  for (const { label, value } of entries) {
    if (typeof value !== "string") throw new Error(`“${label}”的快捷键必须是文字`);
    const key = normalizeAccelerator(value).toLowerCase();
    if (!key) continue;
    const previous = used.get(key);
    if (previous) throw new Error(`“${label}”与“${previous}”的快捷键冲突`);
    used.set(key, label);
  }
}

export function matchesShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "isComposing">, accelerator: string): boolean {
  if (event.isComposing || !accelerator) return false;
  const parts = normalizeAccelerator(accelerator).split("+");
  const key = parts.pop()!.toLowerCase();
  const eventKey = event.key === " " ? "space" : event.key.toLowerCase().replace(/^arrow/, "");
  return eventKey === key && event.ctrlKey === parts.includes("Control") && event.metaKey === parts.includes("Super") && event.altKey === parts.includes("Alt") && event.shiftKey === parts.includes("Shift");
}
