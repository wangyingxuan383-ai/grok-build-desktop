import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { UiIcon, type UiIconName } from "../../ui-icons";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: UiIconName;
  iconEnd?: UiIconName;
  /** Replaces the leading icon with a spinner and disables the button. */
  loading?: boolean;
  children?: ReactNode;
}

/** The only text button. Variants express emphasis; do not restyle per call site. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, iconEnd, loading, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`ui-btn ui-btn-${variant} ui-btn-${size}${className ? ` ${className}` : ""}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <UiIcon name="loader" size={14} className="ui-spin" /> : icon ? <UiIcon name={icon} size={size === "sm" ? 13 : 15} /> : null}
      {children != null && <span className="ui-btn-label">{children}</span>}
      {iconEnd && <UiIcon name={iconEnd} size={size === "sm" ? 12 : 14} />}
    </button>
  );
});

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> {
  icon: UiIconName;
  /** Required: an icon-only control must have an accessible name (also used as the tooltip). */
  label: string;
  size?: ButtonSize;
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = "md", active, className, type = "button", title, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={title ?? label}
      aria-pressed={active}
      className={`ui-icon-btn ui-icon-btn-${size}${active ? " is-active" : ""}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      <UiIcon name={icon} size={size === "sm" ? 14 : 16} />
    </button>
  );
});
