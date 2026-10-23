import { caretAfter, groupAmountInput, significantBefore } from "./amount-input";
import { formatNumber, type NumberFormat } from "./formatters";

/**
 * Issue #164: what a number field holds. `money` is an amount grouped as it is typed (U3); `decimal` a rate or a
 * percent; `integer` a count (days, terms, shares); `digits` a fixed-length code (an account's last four digits).
 */
export type NumberKind = "money" | "decimal" | "integer" | "digits";
export interface NumberRule {
  readonly kind: NumberKind;
  readonly numberFormat: NumberFormat;
  /** money: the currency's decimals (2 when omitted); decimal: the most decimals kept (any when omitted). */
  readonly decimals?: number;
  /** integer and digits: the most digits kept. */
  readonly maxLength?: number;
}

const POINT: Readonly<Record<NumberFormat, string>> = { DOT_COMMA: ",", COMMA_DOT: ".", SPACE_COMMA: "," };

/**
 * Left to right, so what is kept of a prefix is a prefix of what is kept of the whole: the caret's place. A decimal
 * takes either "." or "," as its one point and writes the person's (no rate or percent needs a group separator, and
 * dropping it would silently change 22.3 into 223).
 */
const kept = (text: string, rule: NumberRule): string => {
  if (rule.kind !== "decimal") return text.replace(/\D/g, "").slice(0, rule.maxLength);
  let out = "";
  let fraction: number | null = null;
  for (const c of text) {
    if (/\d/.test(c)) {
      if (fraction === null) out += c;
      else if (fraction < (rule.decimals ?? Infinity)) {
        out += c;
        fraction += 1;
      }
    } else if ((c === "." || c === ",") && fraction === null && rule.decimals !== 0) {
      out += `${out === "" ? "0" : ""}${POINT[rule.numberFormat]}`;
      fraction = 0;
    }
  }
  return out;
};

/**
 * The text a number field shows once what its kind cannot hold is dropped; `previous` is the text before the keystroke.
 * A digit typed into a full code is refused, as a `maxlength` would, rather than pushing the last digit out; a longer
 * paste keeps its first digits.
 */
export const filterNumber = (text: string, rule: NumberRule, previous = ""): string => {
  if (rule.kind === "money") return groupAmountInput(text, rule.numberFormat, rule.decimals ?? 2, previous);
  const next = kept(text, rule);
  const full = rule.maxLength !== undefined && previous.length >= rule.maxLength;
  return full && text.replace(/\D/g, "").length > rule.maxLength! ? previous : next;
};

/**
 * Where the caret goes in `next`, the filtered `raw`, so it stays after what it was after; a keystroke refused whole
 * (`next` is still `previous`) leaves it where it was before that keystroke.
 */
export const caretIn = (
  raw: string,
  caret: number,
  next: string,
  rule: NumberRule,
  previous?: string,
): number => {
  if (previous !== undefined && next === previous && raw.length > previous.length)
    return Math.max(0, caret - (raw.length - previous.length));
  return rule.kind === "money"
    ? caretAfter(next, significantBefore(raw, caret, rule.numberFormat), rule.numberFormat)
    : Math.min(kept(raw.slice(0, caret), rule).length, next.length);
};

/** The numeric keypad where no point can be typed, the decimal one where it can. */
export const inputModeOf = (rule: NumberRule): "decimal" | "numeric" =>
  (rule.kind === "money" || rule.kind === "decimal") && rule.decimals !== 0 ? "decimal" : "numeric";

/** An example of the kind in the person's format ("1.250,50", "12,5", "15"), or `decimal` written so; none for a code. */
export const exampleOf = (rule: NumberRule, decimal?: string): string | null => {
  if (decimal) return formatNumber(decimal, rule);
  if (rule.kind === "digits") return null;
  if (rule.kind === "integer") return "15";
  const decimals = rule.decimals ?? 2;
  if (rule.kind === "decimal") return formatNumber("12.5", rule);
  return formatNumber(decimals > 0 ? `1250.${"50".padEnd(decimals, "0").slice(0, decimals)}` : "1250", rule);
};
