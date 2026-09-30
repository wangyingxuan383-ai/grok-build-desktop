import { Children, cloneElement, createContext, isValidElement, useContext, type HTMLAttributes, type ReactElement } from "react";
export const PagePresentation = createContext(false);
/** Existing panels share one business component in both page and dialog hosts. */
export function PanelSurface({ children, className, onMouseDown, ...props }: HTMLAttributes<HTMLDivElement>) {
  const page = useContext(PagePresentation);
  return <div {...props} className={page ? "workbench-page-surface" : className} onMouseDown={page ? undefined : onMouseDown}>{page ? Children.map(children, child => isValidElement(child) && child.type === "section" ? cloneElement(child as ReactElement<HTMLAttributes<HTMLElement>>, { role: "region", "aria-modal": undefined }) : child) : children}</div>;
}
