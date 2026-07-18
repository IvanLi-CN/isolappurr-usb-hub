import type { ButtonHTMLAttributes, ReactNode } from "react";
import { forwardRef } from "react";

export type ActionTone =
  | "primary"
  | "secondary"
  | "quiet"
  | "warning"
  | "danger";

export type ActionSize = "xs" | "sm" | "md";
export type ActionEmphasis = "soft" | "solid";
export type ActionAlignment = "center" | "start" | "between";

type ActionButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  children: ReactNode;
  align?: ActionAlignment;
  emphasis?: ActionEmphasis;
  fullWidth?: boolean;
  loading?: boolean;
  size?: ActionSize;
  tone?: ActionTone;
};

type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "children"
> & {
  children: ReactNode;
  label: string;
  loading?: boolean;
  size?: ActionSize;
  tone?: ActionTone;
};

function joinClasses(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(" ");
}

export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(
  function ActionButton(
    {
      children,
      className,
      align = "center",
      disabled = false,
      emphasis = "soft",
      fullWidth = false,
      loading = false,
      size = "md",
      tone = "secondary",
      type = "button",
      ...props
    },
    ref,
  ) {
    const unavailable = disabled || loading;

    return (
      <button
        {...props}
        ref={ref}
        aria-busy={loading || undefined}
        className={joinClasses(
          "iso-action",
          fullWidth && "iso-action--full-width",
          className,
        )}
        data-loading={loading || undefined}
        data-emphasis={emphasis}
        data-align={align}
        data-size={size}
        data-tone={tone}
        disabled={unavailable}
        type={type}
      >
        <span className="iso-action__label">{children}</span>
        {loading ? <span aria-hidden className="iso-action__spinner" /> : null}
      </button>
    );
  },
);

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      children,
      className,
      disabled = false,
      label,
      loading = false,
      size = "md",
      title,
      tone = "quiet",
      type = "button",
      ...props
    },
    ref,
  ) {
    const unavailable = disabled || loading;

    return (
      <button
        {...props}
        ref={ref}
        aria-busy={loading || undefined}
        aria-label={label}
        className={joinClasses("iso-icon-action", className)}
        data-loading={loading || undefined}
        data-size={size}
        data-tone={tone}
        disabled={unavailable}
        title={title ?? label}
        type={type}
      >
        <span aria-hidden className="iso-icon-action__glyph">
          {children}
        </span>
        {loading ? <span aria-hidden className="iso-action__spinner" /> : null}
      </button>
    );
  },
);

export function ActionGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={joinClasses("iso-action-group", className)}>{children}</div>
  );
}
