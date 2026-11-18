import type { ReactNode } from "react";
import { Icon, numberInputProps } from "@/shared/ui";
import type { NumberFormat } from "@/shared/ui/format/formatters";

/** A field's error, read as its description. */
export function RowError({ id, children }: { readonly id: string; readonly children: ReactNode }) {
  return (
    <p id={id} className="flex items-center gap-1.5 px-3 pb-2 text-sm text-danger">
      <Icon name="alert" size={16} />
      {children}
    </p>
  );
}

/**
 * D29, boards 9 and 10: a secondary money field (the bank's converted base amount, or what arrives at a cross-currency
 * transfer's destination), in its own currency's decimals, its ISO code after what is typed (P342). It reuses the record route's own number input
 * props (`numberInputProps`, already loaded by the amount field), so it adds no new chunk to the route (ADR 0004).
 */
export function MoneyField({
  id,
  label,
  hint,
  currency,
  numberFormat,
  exponent,
  value,
  onChange,
  error,
}: {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly currency: string;
  readonly numberFormat: NumberFormat;
  readonly exponent: number;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error?: string | undefined;
}) {
  const described = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          {...numberInputProps({ kind: "money", numberFormat, decimals: exponent }, { value, onChange })}
          aria-invalid={error ? true : undefined}
          aria-describedby={described || undefined}
          style={{ paddingRight: `calc(1.5rem + ${currency.length}ch)` }}
          className={
            error
              ? "h-11 w-full rounded-xl border border-danger bg-surface px-3 text-base text-ink"
              : "h-11 w-full rounded-xl border border-field bg-surface px-3 text-base text-ink"
          }
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-base text-muted"
        >
          {currency}
        </span>
      </div>
      {error ? (
        <p id={`${id}-error`} className="flex items-center gap-1.5 text-sm text-danger">
          <Icon name="alert" size={16} />
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Issue #171: the description as a 44 px field. Its placeholder says it is optional; its label is still there for
 * screen readers, so it is never named by the placeholder alone.
 */
export function DescriptionField({
  value,
  onChange,
  label,
  placeholder,
  error,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly label: string;
  readonly placeholder: string;
  readonly error?: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="record-description" className="sr-only">
        {label}
      </label>
      <input
        id="record-description"
        type="text"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "record-description-error" : undefined}
        className={
          error
            ? "h-11 w-full rounded-xl border border-danger bg-surface px-3 text-base text-ink placeholder:text-muted"
            : "h-11 w-full rounded-xl border border-field bg-surface px-3 text-base text-ink placeholder:text-muted"
        }
      />
      {error ? (
        <p id="record-description-error" className="flex items-center gap-1.5 text-sm text-danger">
          <Icon name="alert" size={16} />
          {error}
        </p>
      ) : null}
    </div>
  );
}
