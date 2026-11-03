import { groupAmountInput } from "@/shared/ui/format/amount-input";
import type { NumberFormat } from "@/shared/ui/format/formatters";

/** A key of the record form's keypad: a digit, "000", the decimal point, or delete. */
export type KeypadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "000" | "point" | "back";

/** The decimal point each number format writes (P121): only COMMA_DOT writes a dot. */
export const pointOf = (numberFormat: NumberFormat): string => (numberFormat === "COMMA_DOT" ? "." : ",");

/**
 * Ruling P291 (board B1 · 01): the amount after a keypad key, regrouped as typing regroups it (U3, `groupAmountInput`).
 * A key the amount has no room for leaves it as it was: a point in a currency without decimals or after another, a
 * digit past the currency's decimals, and "000" before any digit.
 */
export const keypadInput = (
  value: string,
  key: KeypadKey,
  numberFormat: NumberFormat,
  exponent: number,
): string => {
  const point = pointOf(numberFormat);
  const at = value.indexOf(point);
  if (key === "back") return groupAmountInput(value.slice(0, -1), numberFormat, exponent, value);
  if (key === "point") return exponent === 0 || at >= 0 ? value : `${value === "" ? "0" : value}${point}`;
  if ((key === "000" && value === "") || (at >= 0 && value.length - at - 1 + key.length > exponent))
    return value;
  return groupAmountInput(`${value}${key}`, numberFormat, exponent, value);
};
