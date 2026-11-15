import type { CSSProperties, HTMLAttributes } from "react";
import { AMOUNT } from "./amount";

/**
 * Ruling P335: a large figure (a hero's total, a card's balance) on one line that scales with the width of its
 * container, `clamp(1rem, (container width − inset) / length, design size)` in container query units: an amount of
 * usual length shows at its design size, and a longer one, or a narrower container, gets a smaller size instead of
 * wrapping or overflowing. Nothing is measured: the size divides the width by the amount's own length.
 *
 * Each character is counted at 0.68 em, the most an amount's characters take on average in the widest face the layout
 * checks run (Verdana bold: digits of 0.71 em, separators of half that).
 */
const SCALED =
  "block text-[length:clamp(1rem,calc((100cqi_-_var(--amount-inset,0px))/var(--amount-ems)),var(--amount-size))]";

export function HeroAmount({
  amount,
  size,
  inset,
  contained = true,
  className,
  ...rest
}: {
  /** The amount, as `src/shared/ui/format/` writes it. */
  readonly amount: string;
  /** The design size, which the figure never exceeds (for example "2.25rem"). */
  readonly size: string;
  /** The room between the container and the figure (a card's padding and border), when an ancestor is the container. */
  readonly inset?: string;
  /** False when an ancestor is the container (`@container`), so the figure's box can still size its parent. */
  readonly contained?: boolean;
} & Omit<HTMLAttributes<HTMLElement>, "children" | "style">) {
  const style = {
    "--amount-size": size,
    "--amount-inset": inset,
    "--amount-ems": (amount.length * 0.68).toFixed(2),
  } as CSSProperties;
  const figure = (
    <span data-amount="" style={style} className={`${SCALED} ${AMOUNT} ${className ?? ""}`} {...rest}>
      {amount}
    </span>
  );
  return contained ? <span className="block min-w-0 @container">{figure}</span> : figure;
}
