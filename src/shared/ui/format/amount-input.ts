import type { NumberFormat } from "./formatters";

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
