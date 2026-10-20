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
        className="relative h-7 w-12 shrink-0 rounded-full bg-track transition-colors data-[state=checked]:bg-accent disabled:opacity-50"
      >
        <RadixSwitch.Thumb className="block size-6 translate-x-0.5 rounded-full bg-surface shadow transition-transform data-[state=checked]:translate-x-[22px]" />
      </RadixSwitch.Root>
    </div>
  );
}
