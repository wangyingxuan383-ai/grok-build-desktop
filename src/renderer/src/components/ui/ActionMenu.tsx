import { Fragment, useRef, useState, type ReactElement, type ReactNode } from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import * as Context from "@radix-ui/react-context-menu";

/** One action model for toolbar, context menu and command search. */
export interface UiAction {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  reason?: string;
  danger?: boolean;
  checked?: boolean;
  children?: UiAction[];
  /** Renders a divider before this action (ignored on the first entry). */
  separatorBefore?: boolean;
  run?(): void | Promise<unknown>;
}
function Items({ actions, context, onError }: { actions: UiAction[]; context: boolean; onError?(message: string): void }) {
  const P = context ? Context : Dropdown;
  const execute = (action: UiAction) => {
    if (action.disabled || !action.run) return;
    try { Promise.resolve(action.run()).catch(error => onError?.(error instanceof Error ? error.message : String(error))); }
    catch (error) { onError?.(error instanceof Error ? error.message : String(error)); }
  };
  return <>{actions.map((action, index) => <Fragment key={action.id}>{action.separatorBefore && index > 0 && <P.Separator className="ui-menu-sep"/>}{action.children?.length ? <Submenu key={action.id} action={action} context={context} onError={onError}/> : <P.Item key={action.id} className={`ui-menu-item ${action.danger ? "ui-danger" : ""}`} disabled={action.disabled} title={action.reason} onSelect={() => execute(action)}>
    {action.icon}<span>{action.label}{action.reason && <small>{action.reason}</small>}</span><span className="ui-menu-tail">{action.checked ? "✓" : action.shortcut}</span>
  </P.Item>}</Fragment>)}</>;
}
function Submenu({action,context,onError}:{action:UiAction;context:boolean;onError?(message:string):void}) {
  const P=context?Context:Dropdown;const [open,setOpen]=useState(false);const trigger=useRef<HTMLDivElement>(null);
  return <P.Sub open={open} onOpenChange={setOpen}><P.SubTrigger ref={trigger} className="ui-menu-item" disabled={action.disabled} title={action.reason}>{action.icon}<span>{action.label}</span><span className="ui-menu-tail">›</span></P.SubTrigger><P.Portal><P.SubContent className="ui-menu" collisionPadding={8} sideOffset={4} onEscapeKeyDown={event=>{event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus()}}><Items actions={action.children!} context={context} onError={onError}/></P.SubContent></P.Portal></P.Sub>;
}
export function ActionMenu({ trigger, actions, open, onOpenChange, onError, align = "end" }: { trigger: ReactElement; actions: UiAction[]; open?: boolean; onOpenChange?(open: boolean): void; onError?(message: string): void; align?: "start" | "center" | "end" }) {
  return <Dropdown.Root open={open} onOpenChange={onOpenChange} modal={false}><Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger><Dropdown.Portal><Dropdown.Content className="ui-menu" align={align} sideOffset={6} collisionPadding={8}><Items actions={actions} context={false} onError={onError}/></Dropdown.Content></Dropdown.Portal></Dropdown.Root>;
}
export function ActionContextMenu({ children, actions, onError }: { children: ReactElement; actions: UiAction[]; onError?(message: string): void }) {
  return <Context.Root><Context.Trigger asChild>{children}</Context.Trigger><Context.Portal><Context.Content className="ui-menu" collisionPadding={8}><Items actions={actions} context onError={onError}/></Context.Content></Context.Portal></Context.Root>;
}
