import type { HTMLAttributes } from "react";

/**
 * Ruling P335 (owner: "No se trata de letra más chica, es que sea totalmente responsive"): an amount never breaks
 * across lines and never overflows, at any width, font size or number of digits; the layout around it adapts. Every
 * amount on a screen is drawn by one of these, so no screen tunes its own sizes or wrapping:
 *
 * - `Amount`: an amount in a row or a figure, whole on one line in tabular figures.
 * - `AMOUNT_ROW` and its parts: a label and an amount side by side; when they do not fit, the amount moves whole to
 *   its own line under the label, and the label wraps its own words.
 * - `AmountText`: a sentence whose words wrap while each amount in it stays whole.
 * - `HeroAmount` (`./hero-amount`): a large figure that scales with the width of its container (container query
 *   units), between a minimum and its design size, so it fills the room it has instead of wrapping.
 *
 * The text itself comes from `src/shared/ui/format/` (D23); these only lay it out.
 */
export const AMOUNT = "whitespace-nowrap tabular-nums";

/**
 * A row of a label and an amount: side by side while they fit, the amount whole on its own line when they do not. It
 * leaves the cross-axis alignment to the row (`items-center` or `items-baseline`).
 */
export const AMOUNT_ROW = "flex flex-wrap gap-x-3";
/** The label of an `AMOUNT_ROW`: it takes the room left and wraps its words; below 8 rem the amount moves under it. */
export const AMOUNT_ROW_LABEL = "min-w-0 flex-[1_1_8rem]";
/** Where an `Amount` sits in an `AMOUNT_ROW`: at the row's end, on whichever line it lands. */
export const AMOUNT_ROW_AMOUNT = "ml-auto text-right";

type AmountTag = "span" | "p" | "dd" | "strong";

export function Amount({
  as: Tag = "span",
  className,
  ...rest
}: { readonly as?: AmountTag } & HTMLAttributes<HTMLElement>) {
  return <Tag data-amount="" className={className ? `${AMOUNT} ${className}` : AMOUNT} {...rest} />;
}

/**
 * A formatted amount inside a sentence, as `src/shared/ui/format/` writes it: an optional sign and the currency's
 * symbol, a no-break space, then the digits with their group and decimal separators (a no-break space in SPACE_COMMA).
 * A separator counts only before another digit, so a sentence's own period or comma stays outside.
 */
const MONEY = /([\u2212+]?[^\s\d]+\u00a0\d(?:[.,\u00a0]?\d)*)/;

/** A sentence whose words wrap as they may while each amount in it stays whole (P335). */
export function AmountText({ text }: { readonly text: string }) {
  return (
    <>
      {text.split(MONEY).map((part, index) =>
        // `split` with one capturing group puts the amounts at the odd indexes.
        index % 2 === 1 ? <Amount key={index}>{part}</Amount> : part,
      )}
    </>
  );
}
