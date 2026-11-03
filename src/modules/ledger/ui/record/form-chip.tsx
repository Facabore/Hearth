import type { ReactNode } from "react";

/**
 * Ruling P291 (board B1 · 01): a compact chip of the record form (the account, the date and time, the space): an icon
 * and the value, its name read out before it. Without `onClick` it only shows the value: a part the movement cannot
 * change (P188), or the space being recorded into.
 */
export function FormChip({
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
  readonly onClick?: (() => void) | undefined;
  readonly errorId?: string | undefined;
  /** A name that says more than the name and the value read together (the date's "Cambiar"). */
  readonly ariaLabel?: string;
  readonly testId?: string;
}) {
  const content = (
    <>
      <span aria-hidden="true" className="flex shrink-0 text-muted">
        {icon}
      </span>
      <span className="sr-only">{`${name} `}</span>
      <span className="min-w-0 truncate">{value}</span>
    </>
  );
  const box =
    "flex min-h-11 max-w-full items-center gap-1.5 rounded-xl bg-track px-3 text-sm font-medium text-ink";
  if (!onClick)
    return (
      <span aria-describedby={errorId} data-testid={testId} className={box}>
        {content}
      </span>
    );
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-describedby={errorId}
      data-testid={testId}
      className={box}
    >
      {content}
    </button>
  );
}

/** A clock face: the chip of the record's date and time. */
export function ClockIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 7.5V12l3 2"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
