import type { ReactNode } from "react";
import { Icon } from "@/shared/ui";

/**
 * Issue #171, the Main artboard: a 48 px row of the record form's details card. A 28 px tinted icon, the label in a
 * 72 px column on the left, the value, and a chevron; the card's dividers sit between the rows.
 */
export function FormRow({
  name,
  value,
  icon,
  onClick,
  errorId,
  ariaLabel,
  testId,
}: {
  readonly name: string;
  readonly value: string;
  readonly icon: ReactNode;
  readonly onClick: () => void;
  readonly errorId?: string | undefined;
  /** A name that says more than the label and the value read together (the date's "Cambiar"). */
  readonly ariaLabel?: string;
  readonly testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-describedby={errorId}
      data-testid={testId}
      className="flex min-h-12 w-full items-center gap-3 px-3 py-1 text-left"
    >
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"
      >
        {icon}
      </span>
      <span className="w-[72px] shrink-0 text-[13px] leading-tight text-muted">{name}</span>
      <span className="min-w-0 flex-1 text-[15px] font-medium break-words text-ink">{value}</span>
      <Icon name="chevronRight" size={20} className="shrink-0 text-muted" />
    </button>
  );
}

/** A row's error, under it inside the card, read as the row's description. */
export function RowError({ id, children }: { readonly id: string; readonly children: ReactNode }) {
  return (
    <p id={id} className="flex items-center gap-1.5 px-3 pb-2 text-sm text-danger">
      <Icon name="alert" size={16} />
      {children}
    </p>
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
