import type { ReactNode } from "react";
import { Icon } from "@/shared/ui";

/**
 * Decision U8 (#224): one row of Settings, its title over its current values, which opens the sheet that changes them.
 * The values wrap instead of being cut, so a long zone or a wide number format stays readable at 320 px.
 */
export function SummaryRow({
  title,
  value,
  onOpen,
  disabled = false,
  describedBy,
}: {
  readonly title: string;
  readonly value: ReactNode;
  readonly onOpen: () => void;
  readonly disabled?: boolean;
  readonly describedBy?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onOpen}
      aria-describedby={describedBy}
      className="flex min-h-14 w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-2 text-left disabled:opacity-50"
    >
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium text-ink">{title}</span>
        <span className="[overflow-wrap:anywhere] text-muted">{value}</span>
      </span>
      <Icon name="chevronRight" size={20} />
    </button>
  );
}
