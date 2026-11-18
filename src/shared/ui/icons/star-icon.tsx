import { SymbolIcon } from "../atoms/icon";
import { cn } from "../cn";

/**
 * P342 (board 6): the favorite star, the Hearth symbol's own path in the interface set's stroke and, when `filled`,
 * filled with the same color; the control around it carries the name. It draws through `SymbolIcon` rather than a new
 * `UI_ICONS` entry, so the icon chunk every sheet loads stays as it was (ADR 0004).
 */
export function StarIcon({
  filled,
  size = 24,
  className,
}: {
  readonly filled: boolean;
  readonly size?: number;
  readonly className?: string;
}) {
  return <SymbolIcon name="star" size={size} className={cn(filled && "fill-current", className)} />;
}
