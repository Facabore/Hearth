"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../cn";

export interface ChoiceGroupProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly options: readonly { value: T; label: ReactNode; disabled?: boolean }[];
  readonly onValueChange: (value: T) => void;
  readonly disabled?: boolean;
  readonly layout?: "segmented" | "chips" | "grid";
  readonly describedBy?: string;
}

const ROOT = {
  segmented: "flex rounded-[14px] bg-track p-1",
  chips: "flex flex-wrap gap-2",
  grid: "grid grid-cols-4 gap-2",
} as const;

const ITEM = {
  segmented: "flex-1 rounded-[10px] data-[state=checked]:bg-surface data-[state=checked]:shadow",
  chips:
    "rounded-full border border-line px-4 data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft",
  grid: "rounded-[14px] border border-line px-2 data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft",
} as const;

const NEXT = new Set(["ArrowRight", "ArrowDown"]);
const PREVIOUS = new Set(["ArrowLeft", "ArrowUp"]);

/**
 * One choice among a few, as the WAI-ARIA radio group pattern: one tab stop on the chosen option, and the arrow keys
 * move and choose, skipping disabled options and wrapping. Issue #182: written without Radix's RadioGroup, whose
 * collection and roving-focus code was the largest shared chunk of the form routes.
 */
export function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onValueChange,
  disabled,
  layout = "segmented",
  describedBy,
}: ChoiceGroupProps<T>) {
  const items = useRef(new Map<T, HTMLButtonElement>());
  const enabled = options.filter((option) => !disabled && !option.disabled);
  // The chosen option is the tab stop; with none chosen (or it disabled), the first enabled one.
  const tabStop = enabled.some((option) => option.value === value) ? value : enabled[0]?.value;

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = NEXT.has(event.key) ? 1 : PREVIOUS.has(event.key) ? -1 : 0;
    if (step === 0 || enabled.length === 0) return;
    event.preventDefault();
    const current = enabled.findIndex((option) => option.value === value);
    const next = enabled[(current + step + enabled.length) % enabled.length]!.value;
    onValueChange(next);
    items.current.get(next)?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-describedby={describedBy}
      aria-disabled={disabled || undefined}
      onKeyDown={move}
      className={ROOT[layout]}
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              if (node) items.current.set(option.value, node);
              else items.current.delete(option.value);
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            data-state={checked ? "checked" : "unchecked"}
            value={option.value}
            disabled={disabled || option.disabled}
            tabIndex={option.value === tabStop ? 0 : -1}
            onClick={() => {
              if (!checked) onValueChange(option.value);
            }}
            className={cn(
              "min-h-11 text-sm font-medium text-ink disabled:cursor-not-allowed disabled:opacity-50",
              ITEM[layout],
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
