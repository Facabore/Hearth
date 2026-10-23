import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "../cn";
import { Icon } from "./icon";

export type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  readonly id: string;
  readonly label: string;
  readonly hint?: ReactNode;
  readonly error?: ReactNode;
  readonly trailing?: ReactNode;
  /** A short unit written inside the field, before what is typed (a currency's symbol); screen readers skip it. */
  readonly leading?: string;
  /** A figure the screen is about (an amount): 24 px and semibold instead of 16 px. */
  readonly large?: boolean;
  readonly ref?: Ref<HTMLInputElement>;
};

/** A labelled input (52 px); its hint and error describe it, and an error marks it invalid. */
export function TextField({
  id,
  label,
  hint,
  error,
  trailing,
  leading,
  large,
  className,
  style,
  ref,
  ...props
}: TextFieldProps) {
  const described = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={described || undefined}
          className={cn(
            "h-[52px] w-full rounded-xl border bg-surface px-4 text-ink",
            error ? "border-danger" : "border-field",
            large ? "text-2xl font-semibold" : "text-base",
            trailing && "pr-14",
            className,
          )}
          style={leading ? { paddingLeft: `calc(1.5rem + ${leading.length}ch)`, ...style } : style}
          {...props}
        />
        {leading ? (
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-y-0 left-4 flex items-center text-muted",
              large ? "text-2xl font-semibold" : "text-base",
            )}
          >
            {leading}
          </span>
        ) : null}
        {trailing ? <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div> : null}
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="flex items-center gap-1.5 text-sm text-danger">
          <Icon name="alert" size={16} />
          {error}
        </p>
      ) : null}
    </div>
  );
}
