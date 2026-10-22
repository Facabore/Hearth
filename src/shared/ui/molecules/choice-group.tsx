"use client";

import { RadioGroup } from "radix-ui";
import type { ReactNode } from "react";
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

/** One choice among a few (radix RadioGroup): the arrow keys move and select, disabled choices are skipped. */
export function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onValueChange,
  disabled,
  layout = "segmented",
  describedBy,
}: ChoiceGroupProps<T>) {
  return (
    <RadioGroup.Root
      aria-label={label}
      aria-describedby={describedBy}
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      disabled={disabled}
      orientation="horizontal"
      className={ROOT[layout]}
    >
      {options.map((option) => (
        <RadioGroup.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className={cn(
            "min-h-11 text-sm font-medium text-ink disabled:cursor-not-allowed disabled:opacity-50",
            ITEM[layout],
          )}
        >
          {option.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
