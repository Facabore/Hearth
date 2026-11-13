import type { ReactNode } from "react";
import { Icon } from "@/shared/ui";

/**
 * Ruling P291 (board B1 · 01): a compact chip of the record form (the space being recorded into, since ruling P324 drew
 * the account and the date as summary rows): an icon and the value, its name read out before it. Without `onClick` it
 * only shows the value.
 */
export function FormChip({
  name,
  value,
  icon,
  onClick,
  errorId,
  ariaLabel,
  testId,
  opens,
  showName = false,
}: {
  readonly name: string;
  readonly value: string;
  readonly icon: ReactNode;
  readonly onClick?: (() => void) | undefined;
  readonly errorId?: string | undefined;
  /** A name that says more than the name and the value read together (the date's "Cambiar"). */
  readonly ariaLabel?: string;
  readonly testId?: string;
  /** Ruling P308: a chevron says the chip opens a choice (the space at the top of Registrar). */
  readonly opens?: boolean;
  /** #286 (audit pass 3, A13): the name shows before the value, as a transfer's "Desde" and "Hacia" must. */
  readonly showName?: boolean;
}) {
  const content = (
    <>
      <span aria-hidden="true" className="flex shrink-0 text-muted">
        {icon}
      </span>
      <span className={showName ? "shrink-0 font-normal text-muted" : "sr-only"}>{`${name} `}</span>
      <span className="min-w-0 truncate">{value}</span>
      {opens ? <Icon name="chevronDown" size={16} className="shrink-0 text-muted" /> : null}
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

/**
 * Ruling P324 (medium density, board "Registrar gasto"): a flat summary row of Registrar, at most two lines: the value
 * (16 px) over what it is (`meta`), a chevron when it opens a sheet, a divider under it unless it is the last.
 *
 * What a screen reader hears first: `label` when it is given (read before the value, the visible `meta` then repeating it
 * is hidden from it; an empty `label` reads the value alone, for a value that says what it is, such as "Pagó Ana"), or
 * else the visible `meta` itself, read before the value though it is drawn under it ("Desde Bancolombia").
 */
export function SummaryRow({
  value,
  meta,
  label,
  onClick,
  errorId,
  ariaLabel,
  testId,
  last = false,
}: {
  readonly value: ReactNode;
  readonly meta: string;
  readonly label?: string | undefined;
  readonly onClick?: (() => void) | undefined;
  readonly errorId?: string | undefined;
  /** A name that says more than the label and the value read together (the date's "Cambiar"). */
  readonly ariaLabel?: string | undefined;
  readonly testId?: string | undefined;
  /** The last row of the list draws no divider under it. */
  readonly last?: boolean;
}) {
  const content = (
    <>
      <span className="flex min-w-0 flex-1 flex-col">
        {label === undefined ? (
          <span className="order-last text-sm text-muted">{`${meta} `}</span>
        ) : label ? (
          <span className="sr-only">{`${label} `}</span>
        ) : null}
        <span className="truncate text-base text-ink">{value}</span>
        {label === undefined ? null : (
          <span aria-hidden="true" className="text-sm text-muted">
            {meta}
          </span>
        )}
      </span>
      {onClick ? <Icon name="chevronRight" size={20} className="shrink-0 text-muted" /> : null}
    </>
  );
  const box = `flex min-h-11 w-full items-center gap-3 py-2 text-left${last ? "" : " border-b border-line"}`;
  if (!onClick)
    return (
      <div aria-describedby={errorId} data-testid={testId} className={box}>
        {content}
      </div>
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
