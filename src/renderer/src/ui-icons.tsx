import type { SVGProps } from "react";

export type UiIconName =
  | "account" | "agents" | "archive" | "branch" | "chat" | "check" | "chevron-down" | "chevron-right" | "close"
  | "dashboard" | "download" | "edit" | "external" | "extensions" | "file" | "folder" | "git" | "history" | "memory"
  | "more" | "panel" | "plus" | "profiles" | "refresh" | "search" | "send" | "settings"
  | "pin" | "sparkles" | "stop" | "tasks" | "trash" | "workbench" | "worktree";

export function UiIcon({ name, size = 16, ...props }: { name: UiIconName; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">): React.JSX.Element {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const body = (() => {
    switch (name) {
      case "account": return <><circle cx="12" cy="8" r="3.2"/><path d="M5.8 19c.7-3.3 2.8-5 6.2-5s5.5 1.7 6.2 5"/></>;
      case "agents": return <><circle cx="9" cy="9" r="3"/><circle cx="17" cy="8" r="2.2"/><path d="M3.8 19c.6-3.2 2.3-4.8 5.2-4.8 3 0 4.7 1.6 5.2 4.8M14 14.2c2.8 0 4.6 1.3 5.2 3.8"/></>;
      case "archive": return <><path d="M4 7h16v13H4zM3 4h18v3H3z"/><path d="M9 11h6"/></>;
      case "branch": return <><circle cx="7" cy="5" r="2"/><circle cx="17" cy="7" r="2"/><circle cx="7" cy="19" r="2"/><path d="M7 7v10M9 12h3a5 5 0 0 0 5-3"/></>;
      case "chat": return <path d="M5 5.5h14v10H9l-4 3v-13Z"/>;
      case "check": return <path d="m5 12 4 4L19 6"/>;
      case "chevron-down": return <path d="m7 9.5 5 5 5-5"/>;
      case "chevron-right": return <path d="m9.5 7 5 5-5 5"/>;
      case "close": return <path d="M6 6l12 12M18 6 6 18"/>;
      case "dashboard": return <><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></>;
      case "download": return <><path d="M12 4v11M8 11l4 4 4-4"/><path d="M5 20h14"/></>;
      case "edit": return <><path d="m4 20 4.2-1 10-10a2 2 0 0 0-3-3l-10 10L4 20Z"/><path d="m13.8 7.2 3 3"/></>;
      case "external": return <><path d="M13 5h6v6M19 5l-9 9"/><path d="M17 14v5H5V7h5"/></>;
      case "extensions": return <path d="M9 4h6v5h5v6h-5v5H9v-5H4V9h5V4Z"/>;
      case "file": return <><path d="M6 3.5h8l4 4V20H6z"/><path d="M14 3.5V8h4"/></>;
      case "folder": return <path d="M3.5 6.5h6l2-2H20a1 1 0 0 1 1 1V19H3V7.5a1 1 0 0 1 .5-1Z"/>;
      case "git": return <><circle cx="7" cy="6" r="2"/><circle cx="17" cy="18" r="2"/><path d="M7 8v5a5 5 0 0 0 5 5h3M12 6h5M15 4l2 2-2 2"/></>;
      case "history": return <><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5"/><path d="M4 4v4.5h4.5M12 7.5V12l3 2"/></>;
      case "memory": return <><path d="M8 5a3 3 0 0 0-3 3v1a3 3 0 0 0 0 6v1a3 3 0 0 0 5 2.2V5.8A3 3 0 0 0 8 5ZM16 5a3 3 0 0 1 3 3v1a3 3 0 0 1 0 6v1a3 3 0 0 1-5 2.2V5.8A3 3 0 0 1 16 5Z"/><path d="M10 9H8M14 9h2M10 15H8M14 15h2"/></>;
      case "more": return <><circle cx="6" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1" fill="currentColor" stroke="none"/></>;
      case "panel": return <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></>;
      case "pin": return <><path d="m9 4 6 6M7 9l8 8M14 5l5 5-3 2-4 4-2 3-5-5 3-2 4-4 2-3Z"/><path d="m8 16-4 4"/></>;
      case "plus": return <path d="M12 5v14M5 12h14"/>;
      case "profiles": return <><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></>;
      case "refresh": return <><path d="M19 8a7.5 7.5 0 0 0-12.7-2L4 8.5"/><path d="M4 4v4.5h4.5M5 16a7.5 7.5 0 0 0 12.7 2l2.3-2.5M20 20v-4.5h-4.5"/></>;
      case "search": return <><circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/></>;
      case "send": return <><path d="m4 12 16-7-5.5 14-3-5.5L4 12Z"/><path d="m11.5 13.5 8.5-8.5"/></>;
      case "settings": return <><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7-.7-1.7.9-1.9-2.1-2.1-1.9.9-1.7-.7L10.5 2h-3l-.7 2-1.7.7-1.9-.9-2.1 2.1.9 1.9-.7 1.7-2 .7v3l2 .7.7 1.7-.9 1.9 2.1 2.1 1.9-.9 1.7.7.7 2h3l.7-2 1.7-.7 1.9.9 2.1-2.1-.9-1.9.7-1.7 2-.4Z" transform="scale(.8) translate(3 3)"/></>;
      case "sparkles": return <><path d="m9 3 1.2 3.8L14 8l-3.8 1.2L9 13l-1.2-3.8L4 8l3.8-1.2L9 3ZM17 12l.8 2.2L20 15l-2.2.8L17 18l-.8-2.2L14 15l2.2-.8L17 12Z"/></>;
      case "stop": return <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>;
      case "tasks": return <><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></>;
      case "trash": return <><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></>;
      case "workbench": return <><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 10v10"/></>;
      case "worktree": return <><circle cx="7" cy="5" r="2"/><circle cx="17" cy="7" r="2"/><circle cx="7" cy="19" r="2"/><path d="M7 7v10M9 12h3a5 5 0 0 0 5-3"/></>;
    }
  })();
  return <svg {...common} {...props}>{body}</svg>;
}
