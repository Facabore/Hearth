import { NBSP, type NumberFormat } from "./formatters";

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** SPACE_COMMA groups with a non-breaking space when the app writes it; a person types a plain one. */
const GROUPS: Readonly<Record<NumberFormat, { group: string; point: string }>> = {
  DOT_COMMA: { group: escape("."), point: "," },
  COMMA_DOT: { group: escape(","), point: "." },
  SPACE_COMMA: { group: "[ \\u00a0]", point: "," },
};

/**
 * Ruling P138: what a person types in their number format, as a decimal with a "." point, or null. Group separators
 * are optional but group exactly three digits; there is at most one decimal separator; no sign, no exponent.
 */
export const parseDecimal = (text: string, numberFormat: NumberFormat): string | null => {
  const { group, point } = GROUPS[numberFormat];
  const pattern = new RegExp(`^(\\d+|\\d{1,3}(?:${group}\\d{3})+)(?:${escape(point)}(\\d+))?$`);
  const match = pattern.exec(text.trim());
  if (!match) return null;
  const whole = match[1]!.replace(/\D/g, "");
  return match[2] === undefined ? whole : `${whole}.${match[2]}`;
};

/** A decimal in minor units of a currency with `exponent` decimals ("85000", 2 → "8500000"); more decimals → null. */
export const minorOf = (decimal: string, exponent: number): string | null => {
  const [whole = "0", fraction = ""] = decimal.split(".");
  if (fraction.length > exponent) return null;
  const digits = `${whole}${fraction.padEnd(exponent, "0")}`.replace(/^0+(?=\d)/, "");
  return digits;
};

/** How each format writes a group and the decimal point. */
const WRITTEN: Readonly<Record<NumberFormat, { group: string; point: string }>> = {
  DOT_COMMA: { group: ".", point: "," },
  COMMA_DOT: { group: ",", point: "." },
  SPACE_COMMA: { group: NBSP, point: "," },
};

/**
 * U3: the text of an amount field with its digits grouped as the person's number format writes them ("6000" → "6.000"
 * for COP), regrouped on every keystroke. Group separators already in the text are dropped and written again, so a
 * digit typed or deleted inside a grouped number regroups it; the value it parses to is the digits typed. A currency
 * with no decimals (`exponent` 0) has no point to type, and a group separator typed before one or two digits ("12.50"
 * where the dot is the group, `text` longer than `previous`) is a point typed by habit: both are left as typed, so the
 * unreadable-amount message answers instead of a silent change of magnitude. Deleting a digit ("6.000" → "6.00") is
 * not that: it regroups.
 */
export const groupAmountInput = (
  text: string,
  numberFormat: NumberFormat,
  exponent: number,
  previous = "",
): string => {
  const { group, point } = WRITTEN[numberFormat];
  const groupPattern = numberFormat === "SPACE_COMMA" ? /[ \u00a0]/g : new RegExp(escape(group), "g");
  const at = text.indexOf(point);
  if (at >= 0 && exponent === 0) return text;
  const whole = at < 0 ? text : text.slice(0, at);
  const fraction = at < 0 ? null : text.slice(at + point.length);
  const lastGroup = Math.max(...[...whole.matchAll(groupPattern)].map((m) => m.index!), -1);
  if (
    text.length > previous.length &&
    exponent > 0 &&
    fraction === null &&
    lastGroup >= 0 &&
    whole.length - lastGroup - 1 < 3 &&
    whole.length - lastGroup - 1 > 0
  )
    return text;
  const digits = whole.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  if (fraction === null) return grouped;
  return `${grouped === "" ? "0" : grouped}${point}${fraction.replace(/\D/g, "")}`;
};

/** The digits and the decimal point before the caret: what must still be before it once the text is regrouped. */
export const significantBefore = (text: string, caret: number, numberFormat: NumberFormat): number =>
  [...text.slice(0, caret)].filter((c) => /\d/.test(c) || c === WRITTEN[numberFormat].point).length;

/** Where the caret goes in the regrouped text: right after the same number of digits (and point) as before. */
export const caretAfter = (text: string, significant: number, numberFormat: NumberFormat): number => {
  if (significant <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (/\d/.test(text[i]!) || text[i] === WRITTEN[numberFormat].point) seen += 1;
    if (seen === significant) return i + 1;
  }
  return text.length;
};
