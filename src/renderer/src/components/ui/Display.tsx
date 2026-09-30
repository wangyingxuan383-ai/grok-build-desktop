import type { HTMLAttributes, ReactNode } from "react";
import { UiIcon, type UiIconName } from "../../ui-icons";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

export function Badge({ tone = "neutral", className, ...rest }: { tone?: BadgeTone } & HTMLAttributes<HTMLSpanElement>): React.JSX.Element {
  return <span className={`ui-badge ui-badge-${tone}${className ? ` ${className}` : ""}`} {...rest} />;
}

export function Kbd({ children }: { children: ReactNode }): React.JSX.Element {
  return <kbd className="ui-kbd">{children}</kbd>;
}

export function Spinner({ size = 16 }: { size?: number }): React.JSX.Element {
  return <UiIcon name="loader" size={size} className="ui-spin" role="status" aria-label="加载中" />;
}

/** Quiet placeholder for an empty list or page. `action` is rendered as-is. */
export function EmptyState({ icon, title, hint, action }: { icon?: UiIconName; title: string; hint?: string; action?: ReactNode }): React.JSX.Element {
  return (
    <div className="ui-empty">
      {icon && <UiIcon name={icon} size={22} />}
      <strong>{title}</strong>
      {hint && <p>{hint}</p>}
      {action}
    </div>
  );
}

export interface SegmentedItem<T extends string> {
  value: T;
  label: string;
  icon?: UiIconName;
}

/**
 * Single-choice switch (mode selector, filters). Buttons rather than radios so
 * a screen reader announces "pressed" and Tab moves between segments.
 */
export function Segmented<T extends string>({ items, value, onChange, label, size = "md", className }: {
  items: readonly SegmentedItem<T>[];
  value: T;
  onChange(value: T): void;
  label: string;
  size?: "sm" | "md";
  className?: string;
}): React.JSX.Element {
  return (
    <div role="group" aria-label={label} className={`ui-seg ui-seg-${size}${className ? ` ${className}` : ""}`}>
      {items.map((item) => (
        <button key={item.value} type="button" aria-pressed={item.value === value} onClick={() => { if (item.value !== value) onChange(item.value); }}>
          {item.icon && <UiIcon name={item.icon} size={14} />}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
