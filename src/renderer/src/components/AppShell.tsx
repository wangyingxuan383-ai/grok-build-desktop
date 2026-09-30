import { useEffect, useState, type ReactNode } from "react";

const KEY = "grok.ui-layout.v1";
const DEFAULT_WIDTH = 264;
const MIN_WIDTH = 220;
const MAX_WIDTH = 420;
const clampWidth = (value: number): number => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, value));

export function AppShell({ className, sidebar, children }: { className: string; sidebar: ReactNode; children: ReactNode }): React.JSX.Element {
  const [width, setWidth] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(KEY) || "null");
      return stored?.version === 1 && Number.isFinite(stored.sidebarWidth) ? clampWidth(stored.sidebarWidth) : DEFAULT_WIDTH;
    } catch { return DEFAULT_WIDTH; }
  });
  useEffect(() => {
    const timer = window.setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify({ version: 1, sidebarWidth: width })); } catch { /* layout simply isn't remembered */ } }, 150);
    return () => window.clearTimeout(timer);
  }, [width]);
  useEffect(() => {
    const reset = () => setWidth(DEFAULT_WIDTH);
    window.addEventListener("grok:reset-layout", reset);
    return () => window.removeEventListener("grok:reset-layout", reset);
  }, []);
  return (
    <div className={className} style={{ "--sidebar-width": `${width}px` } as React.CSSProperties}>
      {sidebar}
      {!className.includes("sidebar-collapsed") && (
        <div
          className="sidebar-resizer"
          role="separator"
          aria-label="调整侧栏宽度"
          aria-orientation="vertical"
          aria-valuenow={width}
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          tabIndex={0}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
            event.preventDefault();
            setWidth((value) => clampWidth(value + (event.key === "ArrowRight" ? 16 : -16)));
          }}
          onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
          onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setWidth(clampWidth(event.clientX)); }}
          onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
        />
      )}
      <div className="workspace-shell">{children}</div>
    </div>
  );
}
