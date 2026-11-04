import type { NumberFormat } from "./formatters";

/** The digit group separator of each number format, as `formatNumber` writes it (U+00A0 for SPACE_COMMA). */
const GROUP: Readonly<Record<NumberFormat, string>> = { DOT_COMMA: ".", COMMA_DOT: ",", SPACE_COMMA: " " };

/**
 * A whole count in the person's number format (D23, ruling P121): 1204 → "1.204". It imports nothing but a type, so a
 * screen that shows only counts (Categorías' usage, P297) leaves the dates' and zones' code out of its chunk (ADR 0004);
 * its test holds it to `formatNumber`, so the two never write a number differently.
 */
export const formatCount = (count: number, f: { readonly numberFormat: NumberFormat }): string =>
  String(Math.trunc(count)).replace(/\B(?=(\d{3})+(?!\d))/g, GROUP[f.numberFormat]);
