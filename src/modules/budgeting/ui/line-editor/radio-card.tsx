import { useId } from "react";

/**
 * HU-E9-08, board 05: one choice among a few as a list of radios in one card, each option's label over the line that
 * explains it. Native radios sharing a name give the radio group's keyboard (the arrow keys move and choose).
 */
export function RadioCard<T extends string>({
  labelledBy,
  value,
  options,
  onValueChange,
}: {
  /** The visible heading that names the group. */
  readonly labelledBy: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string; readonly description: string }[];
  readonly onValueChange: (value: T) => void;
}) {
  const ids = useId();
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface"
    >
      {options.map((option) => {
        const id = `${ids}-${option.value}`;
        return (
          <label
            key={option.value}
            htmlFor={id}
            className="flex min-h-11 cursor-pointer items-start gap-3 px-4 py-3 has-[:checked]:bg-accent-soft"
          >
            <input
              id={id}
              type="radio"
              name={ids}
              value={option.value}
              checked={value === option.value}
              onChange={() => onValueChange(option.value)}
              aria-labelledby={`${id}-label`}
              aria-describedby={`${id}-description`}
              className="mt-0.5 size-5 shrink-0 accent-accent"
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span id={`${id}-label`} className="font-semibold [overflow-wrap:anywhere] text-ink">
                {option.label}
              </span>
              <span id={`${id}-description`} className="text-sm [overflow-wrap:anywhere] text-muted">
                {option.description}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
