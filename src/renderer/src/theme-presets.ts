import type { ThemeBase, ThemeColors } from "../../shared/types";

export type ThemePresetId =
  | "t3-dark"
  | "t3-light"
  | "tokyo-night"
  | "catppuccin-mocha"
  | "catppuccin-latte"
  | "github-dark"
  | "github-light"
  | "rose-pine"
  | "nord"
  | "mirasim-dusk";

export type AnsiPalette = readonly [
  string, string, string, string,
  string, string, string, string,
  string, string, string, string,
  string, string, string, string,
];

export interface MonacoTokenRule {
  token: string;
  foreground?: string;
  fontStyle?: string;
}

export interface MonacoThemeDefinition {
  base: "vs-dark" | "vs";
  inherit: boolean;
  rules: MonacoTokenRule[];
  colors: Record<string, string>;
}

export interface ThemePreset {
  id: ThemePresetId;
  name: string;
  subtitle: string;
  base: ThemeBase;
  colors: ThemeColors;
  ansiPalette: AnsiPalette;
  monacoTheme: MonacoThemeDefinition;
}

export const DEFAULT_DARK_ANSI_PALETTE: AnsiPalette = [
  "#18181b", "#f87171", "#4ade80", "#facc15",
  "#60a5fa", "#c084fc", "#22d3ee", "#e4e4e7",
  "#52525b", "#fca5a5", "#86efac", "#fde047",
  "#93c5fd", "#d8b4fe", "#67e8f9", "#fafafa",
];

export const DEFAULT_LIGHT_ANSI_PALETTE: AnsiPalette = [
  "#18181b", "#dc2626", "#16a34a", "#ca8a04",
  "#2563eb", "#9333ea", "#0891b2", "#d4d4d8",
  "#52525b", "#ef4444", "#22c55e", "#eab308",
  "#3b82f6", "#a855f7", "#06b6d4", "#fafafa",
];

function stripHash(hex: string): string {
  return hex.replace(/^#/, "");
}

function buildMonacoTheme(
  base: "vs-dark" | "vs",
  colors: ThemeColors,
  syntax: {
    comment: string;
    keyword: string;
    string: string;
    number: string;
    type: string;
    func: string;
    variable: string;
    operator: string;
    selection: string;
    lineHighlight: string;
  },
): MonacoThemeDefinition {
  return {
    base,
    inherit: true,
    rules: [
      { token: "comment", foreground: stripHash(syntax.comment), fontStyle: "italic" },
      { token: "keyword", foreground: stripHash(syntax.keyword) },
      { token: "storage", foreground: stripHash(syntax.keyword) },
      { token: "string", foreground: stripHash(syntax.string) },
      { token: "number", foreground: stripHash(syntax.number) },
      { token: "constant", foreground: stripHash(syntax.number) },
      { token: "type", foreground: stripHash(syntax.type) },
      { token: "class", foreground: stripHash(syntax.type) },
      { token: "interface", foreground: stripHash(syntax.type) },
      { token: "function", foreground: stripHash(syntax.func) },
      { token: "identifier", foreground: stripHash(syntax.variable) },
      { token: "variable", foreground: stripHash(syntax.variable) },
      { token: "delimiter", foreground: stripHash(syntax.operator) },
      { token: "operator", foreground: stripHash(syntax.operator) },
    ],
    colors: {
      "editor.background": colors.surface,
      "editor.foreground": colors.text,
      "editorLineNumber.foreground": colors.muted,
      "editorLineNumber.activeForeground": colors.text,
      "editorCursor.foreground": colors.accent,
      "editor.selectionBackground": syntax.selection,
      "editor.inactiveSelectionBackground": `${syntax.selection}99`,
      "editor.lineHighlightBackground": syntax.lineHighlight,
      "editorIndentGuide.background1": colors.border,
      "editorWidget.background": colors.background,
      "editorWidget.border": colors.border,
    },
  };
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: "t3-dark",
    name: "T3 Dark · 曜石黑",
    subtitle: "高对比 Zinc/Obsidian 极简暗色工作台",
    base: "dark",
    colors: {
      background: "#09090b",
      surface: "#111114",
      text: "#f4f4f5",
      muted: "#a1a1aa",
      accent: "#a78bfa",
      border: "#27272a",
    },
    ansiPalette: [
      "#18181b", "#f87171", "#4ade80", "#fbbf24",
      "#818cf8", "#c084fc", "#22d3ee", "#e4e4e7",
      "#52525b", "#fca5a5", "#86efac", "#fde68a",
      "#a5b4fc", "#d8b4fe", "#67e8f9", "#fafafa",
    ],
    monacoTheme: buildMonacoTheme(
      "vs-dark",
      { background: "#09090b", surface: "#111114", text: "#f4f4f5", muted: "#a1a1aa", accent: "#a78bfa", border: "#27272a" },
      {
        comment: "#71717a",
        keyword: "#c084fc",
        string: "#86efac",
        number: "#fbbf24",
        type: "#67e8f9",
        func: "#93c5fd",
        variable: "#f4f4f5",
        operator: "#a1a1aa",
        selection: "#a78bfa33",
        lineHighlight: "#27272a66",
      },
    ),
  },
  {
    id: "t3-light",
    name: "T3 Light · 宣纸白",
    subtitle: "清爽纸感浅色阅读与代码视图",
    base: "light",
    colors: {
      background: "#f8f8f7",
      surface: "#ffffff",
      text: "#18181b",
      muted: "#52525b",
      accent: "#7c3aed",
      border: "#e4e4e7",
    },
    ansiPalette: [
      "#18181b", "#dc2626", "#15803d", "#b45309",
      "#4f46e5", "#7c3aed", "#0e7490", "#d4d4d8",
      "#71717a", "#ef4444", "#16a34a", "#d97706",
      "#6366f1", "#9333ea", "#0891b2", "#27272a",
    ],
    monacoTheme: buildMonacoTheme(
      "vs",
      { background: "#f8f8f7", surface: "#ffffff", text: "#18181b", muted: "#52525b", accent: "#7c3aed", border: "#e4e4e7" },
      {
        comment: "#71717a",
        keyword: "#7c3aed",
        string: "#15803d",
        number: "#b45309",
        type: "#0e7490",
        func: "#2563eb",
        variable: "#18181b",
        operator: "#52525b",
        selection: "#7c3aed24",
        lineHighlight: "#f4f4f5",
      },
    ),
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night · 东京夜色",
    subtitle: "深邃靛蓝夜幕与霓虹青蓝强调色",
    base: "dark",
    colors: {
      background: "#16161e",
      surface: "#1a1b26",
      text: "#c0caf5",
      muted: "#7982a9",
      accent: "#7aa2f7",
      border: "#292e42",
    },
    ansiPalette: [
      "#15161e", "#f7768e", "#9ece6a", "#e0af68",
      "#7aa2f7", "#bb9af7", "#7dcfff", "#a9b1d6",
      "#414868", "#ff899d", "#b9f27c", "#ff9e64",
      "#8db0ff", "#c7a9ff", "#a4daff", "#c0caf5",
    ],
    monacoTheme: buildMonacoTheme(
      "vs-dark",
      { background: "#16161e", surface: "#1a1b26", text: "#c0caf5", muted: "#7982a9", accent: "#7aa2f7", border: "#292e42" },
      {
        comment: "#565f89",
        keyword: "#bb9af7",
        string: "#9ece6a",
        number: "#ff9e64",
        type: "#2ac3de",
        func: "#7aa2f7",
        variable: "#c0caf5",
        operator: "#89ddff",
        selection: "#7aa2f733",
        lineHighlight: "#292e4280",
      },
    ),
  },
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha · 摩卡暗色",
    subtitle: "柔和粉彩与温润深色对比度",
    base: "dark",
    colors: {
      background: "#181825",
      surface: "#1e1e2e",
      text: "#cdd6f4",
      muted: "#a6adc8",
      accent: "#cba6f7",
      border: "#313244",
    },
    ansiPalette: [
      "#45475a", "#f38ba8", "#a6e3a1", "#f9e2af",
      "#89b4fa", "#f5c2e7", "#94e2d5", "#bac2de",
      "#585b70", "#f38ba8", "#a6e3a1", "#f9e2af",
      "#89b4fa", "#cba6f7", "#89dceb", "#cdd6f4",
    ],
    monacoTheme: buildMonacoTheme(
      "vs-dark",
      { background: "#181825", surface: "#1e1e2e", text: "#cdd6f4", muted: "#a6adc8", accent: "#cba6f7", border: "#313244" },
      {
        comment: "#6c7086",
        keyword: "#cba6f7",
        string: "#a6e3a1",
        number: "#fab387",
        type: "#f9e2af",
        func: "#89b4fa",
        variable: "#cdd6f4",
        operator: "#94e2d5",
        selection: "#cba6f730",
        lineHighlight: "#31324470",
      },
    ),
  },
  {
    id: "catppuccin-latte",
    name: "Catppuccin Latte · 拿铁浅色",
    subtitle: "温暖奶油底色与柔和语法高亮",
    base: "light",
    colors: {
      background: "#e6e9ef",
      surface: "#eff1f5",
      text: "#4c4f69",
      muted: "#6c6f85",
      accent: "#8839ef",
      border: "#ccd0da",
    },
    ansiPalette: [
      "#5c5f77", "#d20f39", "#40a02b", "#df8e1d",
      "#1e66f5", "#ea76cb", "#179299", "#acb0be",
      "#6c6f85", "#d20f39", "#40a02b", "#df8e1d",
      "#1e66f5", "#8839ef", "#04a5e5", "#4c4f69",
    ],
    monacoTheme: buildMonacoTheme(
      "vs",
      { background: "#e6e9ef", surface: "#eff1f5", text: "#4c4f69", muted: "#6c6f85", accent: "#8839ef", border: "#ccd0da" },
      {
        comment: "#8c8fa1",
        keyword: "#8839ef",
        string: "#40a02b",
        number: "#fe640b",
        type: "#df8e1d",
        func: "#1e66f5",
        variable: "#4c4f69",
        operator: "#179299",
        selection: "#8839ef24",
        lineHighlight: "#dce0e8",
      },
    ),
  },
  {
    id: "github-dark",
    name: "GitHub Dark · 极客深色",
    subtitle: "熟悉的 GitHub Default Dark 代码审查配色",
    base: "dark",
    colors: {
      background: "#0d1117",
      surface: "#161b22",
      text: "#e6edf3",
      muted: "#8b949e",
      accent: "#58a6ff",
      border: "#30363d",
    },
    ansiPalette: [
      "#484f58", "#ff7b72", "#3fb950", "#d29922",
      "#58a6ff", "#bc8cff", "#39c5cf", "#b1bac4",
      "#6e7681", "#ffa198", "#56d364", "#e3b341",
      "#79c0ff", "#d2a8ff", "#56d4dd", "#f0f6fc",
    ],
    monacoTheme: buildMonacoTheme(
      "vs-dark",
      { background: "#0d1117", surface: "#161b22", text: "#e6edf3", muted: "#8b949e", accent: "#58a6ff", border: "#30363d" },
      {
        comment: "#8b949e",
        keyword: "#ff7b72",
        string: "#a5d6ff",
        number: "#79c0ff",
        type: "#ffa657",
        func: "#d2a8ff",
        variable: "#e6edf3",
        operator: "#ff7b72",
        selection: "#58a6ff33",
        lineHighlight: "#21262d",
      },
    ),
  },
  {
    id: "github-light",
    name: "GitHub Light · 极客浅色",
    subtitle: "高清晰度 GitHub Default Light 审查视图",
    base: "light",
    colors: {
      background: "#f6f8fa",
      surface: "#ffffff",
      text: "#1f2328",
      muted: "#59636e",
      accent: "#0969da",
      border: "#d0d7de",
    },
    ansiPalette: [
      "#24292f", "#cf222e", "#116329", "#4d2d00",
      "#0969da", "#8250df", "#1b7c83", "#6e7781",
      "#57606a", "#a40e26", "#1a7f37", "#633c01",
      "#218bff", "#a475f9", "#3192aa", "#1f2328",
    ],
    monacoTheme: buildMonacoTheme(
      "vs",
      { background: "#f6f8fa", surface: "#ffffff", text: "#1f2328", muted: "#59636e", accent: "#0969da", border: "#d0d7de" },
      {
        comment: "#6e7781",
        keyword: "#cf222e",
        string: "#0a3069",
        number: "#0550ae",
        type: "#953800",
        func: "#8250df",
        variable: "#1f2328",
        operator: "#cf222e",
        selection: "#0969da24",
        lineHighlight: "#f6f8fa",
      },
    ),
  },
  {
    id: "rose-pine",
    name: "Rosé Pine · 松烟紫",
    subtitle: "静谧松林暗紫与玫瑰金低眩光层次",
    base: "dark",
    colors: {
      background: "#191724",
      surface: "#1f1d2e",
      text: "#e0def4",
      muted: "#908caa",
      accent: "#ebbcba",
      border: "#26233a",
    },
    ansiPalette: [
      "#26233a", "#eb6f92", "#31748f", "#f6c177",
      "#9ccfd8", "#c4a7e7", "#ebbcba", "#e0def4",
      "#6e6a86", "#eb6f92", "#31748f", "#f6c177",
      "#9ccfd8", "#c4a7e7", "#ebbcba", "#e0def4",
    ],
    monacoTheme: buildMonacoTheme(
      "vs-dark",
      { background: "#191724", surface: "#1f1d2e", text: "#e0def4", muted: "#908caa", accent: "#ebbcba", border: "#26233a" },
      {
        comment: "#6e6a86",
        keyword: "#31748f",
        string: "#f6c177",
        number: "#ebbcba",
        type: "#9ccfd8",
        func: "#c4a7e7",
        variable: "#e0def4",
        operator: "#908caa",
        selection: "#ebbcba2b",
        lineHighlight: "#26233a88",
      },
    ),
  },
  {
    id: "nord",
    name: "Nord · 极地冰蓝",
    subtitle: "冷静北极灰蓝与冰霜青色视觉秩序",
    base: "dark",
    colors: {
      background: "#242933",
      surface: "#2e3440",
      text: "#eceff4",
      muted: "#9aa5b8",
      accent: "#88c0d0",
      border: "#3b4252",
    },
    ansiPalette: [
      "#3b4252", "#bf616a", "#a3be8c", "#ebcb8b",
      "#81a1c1", "#b48ead", "#88c0d0", "#e5e9f0",
      "#4c566a", "#bf616a", "#a3be8c", "#ebcb8b",
      "#81a1c1", "#b48ead", "#8fbcbb", "#eceff4",
    ],
    monacoTheme: buildMonacoTheme(
      "vs-dark",
      { background: "#242933", surface: "#2e3440", text: "#eceff4", muted: "#9aa5b8", accent: "#88c0d0", border: "#3b4252" },
      {
        comment: "#616e88",
        keyword: "#81a1c1",
        string: "#a3be8c",
        number: "#b48ead",
        type: "#8fbcbb",
        func: "#88c0d0",
        variable: "#d8dee9",
        operator: "#81a1c1",
        selection: "#88c0d030",
        lineHighlight: "#3b425280",
      },
    ),
  },
  {
    id: "mirasim-dusk",
    name: "Mirasim Dusk · 暮光靛",
    subtitle: "多任务注意力面板专属暮色珊瑚与石墨蓝",
    base: "dark",
    colors: {
      background: "#11131a",
      surface: "#171a24",
      text: "#edf0f7",
      muted: "#949db3",
      accent: "#f59e6c",
      border: "#262b3b",
    },
    ansiPalette: [
      "#1b1f2b", "#f2777a", "#66d9a0", "#f5c06c",
      "#6ca6f5", "#c792ea", "#5ad4e6", "#dce2f0",
      "#4d556b", "#ff9497", "#88e8b8", "#ffd48a",
      "#8fbcff", "#dbb2ff", "#82e3f2", "#f7f9fc",
    ],
    monacoTheme: buildMonacoTheme(
      "vs-dark",
      { background: "#11131a", surface: "#171a24", text: "#edf0f7", muted: "#949db3", accent: "#f59e6c", border: "#262b3b" },
      {
        comment: "#5e677d",
        keyword: "#c792ea",
        string: "#66d9a0",
        number: "#f59e6c",
        type: "#5ad4e6",
        func: "#6ca6f5",
        variable: "#edf0f7",
        operator: "#949db3",
        selection: "#f59e6c2e",
        lineHighlight: "#262b3b80",
      },
    ),
  },
];

export function normalizeThemePresetId(id: string | undefined | null): string | undefined {
  if (typeof id !== "string") return undefined;
  const normalized = id.trim().toLowerCase().replace(/\s+/g, "");
  return normalized || undefined;
}

export function getThemePresetById(id: string | undefined | null): ThemePreset | undefined {
  const normalized = normalizeThemePresetId(id);
  if (!normalized) return undefined;
  return THEME_PRESETS.find((preset) => preset.id === normalized);
}
