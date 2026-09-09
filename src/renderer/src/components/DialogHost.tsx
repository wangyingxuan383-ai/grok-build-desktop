import { Suspense, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** One portal owner keeps modal stacking and loading behavior deterministic. */
export function DialogHost({ children }: { children: ReactNode }): React.JSX.Element {
  return createPortal(<Suspense fallback={<div className="modal-backdrop"><section className="control-panel"><div className="panel-body workbench-loading"><div className="spinner"/><span>正在加载…</span></div></section></div>}>
    {children}
  </Suspense>, document.getElementById("overlay-root")!);
}
