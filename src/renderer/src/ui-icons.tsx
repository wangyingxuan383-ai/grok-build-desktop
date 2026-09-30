import type { ComponentType, SVGProps } from "react";
import {
  Archive, Bot, Brain, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Code, Copy, Download,
  Ellipsis, ExternalLink, File, Folder, GitBranch, Globe, History, ImageIcon, Images, LayoutDashboard, LayoutGrid, LoaderCircle, MessageSquare, PanelLeft, PanelRight, Pencil, Pin, Plus,
  RefreshCw, RotateCcw, Search, Send, Settings, SlidersHorizontal, Sparkles, Square, SquarePen, Terminal, Trash2, User,
  Users, WandSparkles, X, CircleAlert, Puzzle, ListTree, type LucideProps,
} from "lucide-react";

/**
 * One icon vocabulary for the whole app, backed by lucide-react (ISC/MIT).
 * Names are semantic so a call site never depends on the glyph that happens
 * to implement it. Unlisted glyphs must be added here, not imported ad hoc.
 */
const ICONS = {
  account: User,
  agents: Users,
  alert: CircleAlert,
  archive: Archive,
  bot: Bot,
  branch: GitBranch,
  chat: MessageSquare,
  check: Check,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  clock: Clock,
  close: X,
  code: Code,
  copy: Copy,
  dashboard: LayoutDashboard,
  download: Download,
  edit: Pencil,
  external: ExternalLink,
  extensions: Puzzle,
  file: File,
  folder: Folder,
  git: GitBranch,
  globe: Globe,
  grid: LayoutGrid,
  history: History,
  image: ImageIcon,
  images: Images,
  loader: LoaderCircle,
  memory: Brain,
  more: Ellipsis,
  "new-chat": SquarePen,
  panel: PanelRight,
  "panel-left": PanelLeft,
  pin: Pin,
  plus: Plus,
  profiles: SlidersHorizontal,
  refresh: RefreshCw,
  retry: RotateCcw,
  search: Search,
  send: Send,
  settings: Settings,
  sparkles: Sparkles,
  stop: Square,
  tasks: Clock,
  terminal: Terminal,
  tree: ListTree,
  trash: Trash2,
  wand: WandSparkles,
  workbench: LayoutGrid,
  worktree: GitBranch,
} as const satisfies Record<string, ComponentType<LucideProps>>;

export type UiIconName = keyof typeof ICONS;

export function UiIcon({ name, size = 16, ...props }: { name: UiIconName; size?: number } & Omit<SVGProps<SVGSVGElement>, "name" | "ref">): React.JSX.Element {
  const Glyph = ICONS[name];
  return <Glyph width={size} height={size} strokeWidth={1.75} aria-hidden {...props} />;
}
