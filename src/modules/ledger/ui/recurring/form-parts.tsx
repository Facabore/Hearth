"use client";

import { useId, type ReactNode } from "react";
import type { PaletteKey } from "@/shared/kernel/style";
import { Icon, paletteVars } from "@/shared/ui";
import { cn } from "@/shared/ui/cn";

/** A 40 px tinted tile for a row's icon, in one of the palette's colors (board E9-09 02's Pagó, 03's dates). */
export function Tile({ palette, children }: { readonly palette: PaletteKey; readonly children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      style={paletteVars(palette)}
      className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--tint)] text-[var(--ink)]"
    >
      {children}
    </span>
  );
}

/**
 * A row of one of the recurrence form's cards, as boards E9-09 02 and 03 draw it: the tile, a small muted label above
 * its value, and a chevron. The space between label and value keeps the button's name "Categoría Servicios".
 */
export function CardRow({
  name,
  value,
  icon,
  onClick,
  errorId,
}: {
  readonly name: string;
  readonly value: string;
  readonly icon: ReactNode;
  /** Without one it is a fact the form cannot change (an edit's start), drawn the same with no chevron. */
  readonly onClick?: () => void;
  readonly errorId?: string | undefined;
}) {
  const body = (
    <>
      {icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] leading-tight text-muted">{name}</span>{" "}
        <span className="text-base font-medium break-words text-ink">{value}</span>
      </span>
    </>
  );
  const box = "flex min-h-[60px] w-full items-center gap-3 px-3 py-2 text-left";
  return onClick ? (
    <button type="button" onClick={onClick} aria-describedby={errorId} className={box}>
      {body}
      <Icon name="chevronRight" size={20} className="shrink-0 text-ink" />
    </button>
  ) : (
    <div className={box}>{body}</div>
  );
}

/**
 * Board E9-09 03's "Cómo se registra": one card of radio rows, each its name over the line that explains it, the
 * chosen one tinted. Native radios, so the arrow keys move between them and the row is the 44 px target.
 */
export function RadioCard<T extends string>({
  labelledBy,
  name,
  value,
  options,
  onChange,
}: {
  readonly labelledBy: string;
  readonly name: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string; readonly description: string }[];
  readonly onChange: (value: T) => void;
}) {
  const ids = useId();
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface"
    >
      {options.map((option) => {
        const checked = option.value === value;
        const id = `${ids}-${option.value}`;
        return (
          <label
            key={option.value}
            className={cn(
              "flex min-h-14 cursor-pointer items-start gap-3 px-3 py-3",
              checked ? "bg-accent-soft" : undefined,
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              onChange={() => onChange(option.value)}
              aria-labelledby={`${id}-label`}
              aria-describedby={`${id}-description`}
              className="mt-0.5 size-5 shrink-0 accent-accent"
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span id={`${id}-label`} className="text-base font-semibold text-ink">
                {option.label}
              </span>
              <span id={`${id}-description`} className="text-sm text-muted">
                {option.description}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
