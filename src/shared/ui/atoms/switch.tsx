"use client";

import { Switch as RadixSwitch } from "radix-ui";

export interface SwitchProps {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly disabled?: boolean;
}

/** An on/off setting, named by its label (radix Switch: Space and Enter toggle it). */
export function Switch({ id, label, description, checked, onCheckedChange, disabled }: SwitchProps) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4">
      <div className="flex flex-col">
        <label htmlFor={id} className="text-base text-ink">
          {label}
        </label>
        {description ? (
          <p id={`${id}-description`} className="text-sm text-muted">
            {description}
          </p>
        ) : null}
      </div>
      <RadixSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-describedby={description ? `${id}-description` : undefined}
        className="group flex h-11 w-12 shrink-0 items-center rounded-xl disabled:opacity-50"
      >
        {/* The control is a 44 px target; the 28 px track inside it is only what is drawn. */}
        <span className="relative h-7 w-12 rounded-full bg-track transition-colors group-data-[state=checked]:bg-accent">
          <RadixSwitch.Thumb className="absolute top-0.5 left-0.5 block size-6 rounded-full bg-surface shadow transition-transform data-[state=checked]:translate-x-5" />
        </span>
      </RadixSwitch.Root>
    </div>
  );
}
