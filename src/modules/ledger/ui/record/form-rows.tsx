import type { ReactNode } from "react";
import { Icon } from "@/shared/ui";

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
