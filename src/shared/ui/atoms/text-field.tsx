import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "../cn";
import { Icon } from "./icon";

export type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly error?: ReactNode;
  readonly trailing?: ReactNode;
  readonly ref?: Ref<HTMLInputElement>;
};

/** A labelled input (52 px); its hint and error describe it, and an error marks it invalid. */
export function TextField({ id, label, hint, error, trailing, className, ref, ...props }: TextFieldProps) {
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
            "h-[52px] w-full rounded-xl border border-field bg-surface px-4 text-base text-ink",
            error && "border-danger",
            trailing && "pr-14",
            className,
          )}
          {...props}
        />
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
