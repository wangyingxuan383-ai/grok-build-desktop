import type { ReactNode } from "react";

/** Structural shell only. Session/navigation behavior remains in controllers. */
export function AppShell({ className, sidebar, children }: { className: string; sidebar: ReactNode; children: ReactNode }): React.JSX.Element {
  return <div className={className}>
    {sidebar}
    <div className="workspace-shell">{children}</div>
  </div>;
}
