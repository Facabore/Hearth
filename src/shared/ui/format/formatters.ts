import { wallTimeIn } from "@/shared/kernel/time-zone";
import { currencyOf } from "./currencies";

export type NumberFormat = "DOT_COMMA" | "COMMA_DOT" | "SPACE_COMMA";
export type DateFormat = "DMY" | "MDY" | "YMD";
export type TimeFormat = "H24" | "H12";
export type WeekStart = "MONDAY" | "SUNDAY";
/** HU-E1-15: the effective preferences of `GET /api/v1/me`; the only input of every formatter (D23, ruling P121). */
export interface Formats {
  readonly numberFormat: NumberFormat;
  readonly dateFormat: DateFormat;
  readonly timeFormat: TimeFormat;
  readonly weekStart: WeekStart;
}
/** The installation's built-in rules (es-CO's formats), for screens without a signed-in person. */
export const BUILT_IN_FORMATS: Formats = {
  numberFormat: "DOT_COMMA",
  dateFormat: "DMY",
  timeFormat: "H24",
  weekStart: "MONDAY",
};
export interface Wall {
  readonly hour: number;
  readonly minute: number;
}

/** A non-breaking space keeps "$ 1.600.000" and "2:30 PM" on one line; U+2212 is the typographic minus. */
export const NBSP = " ";
export const MINUS = "−";
const SEPARATORS: Readonly<Record<NumberFormat, readonly [group: string, point: string]>> = {
  DOT_COMMA: [".", ","],
  COMMA_DOT: [",", "."],
  SPACE_COMMA: [NBSP, ","],
};
const pad = (n: number) => String(n).padStart(2, "0");

/** "-1234567.89" → "−1.234.567,89"; a fraction of zeros is dropped, any other is kept whole. */
export const formatNumber = (decimal: string, f: Pick<Formats, "numberFormat">): string => {
  const negative = decimal.startsWith("-");
  const [whole = "0", fraction = ""] = decimal.replace(/^-/, "").split(".");
  const [group, point] = SEPARATORS[f.numberFormat];
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return `${negative ? MINUS : ""}${grouped}${/^0*$/.test(fraction) ? "" : point + fraction}`;
};

/** Minor units as a decimal string, exactly (BigInt, never Number): ("5", 2) → "0.05". */
export const decimalOf = (minor: string, exponent: number): string => {
  const value = BigInt(minor);
  const digits = (value < 0n ? -value : value).toString().padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  return `${value < 0n ? "-" : ""}${whole}${exponent > 0 ? "." + digits.slice(digits.length - exponent) : ""}`;
};

/** "$ 1.600.000", "−$ 350.000": the currency's symbol, never the language's (P68). */
export const formatMoney = (
  money: { readonly amount: string; readonly currency: string },
  f: Pick<Formats, "numberFormat">,
): string => {
  const { symbol, exponent } = currencyOf(money.currency);
  const text = formatNumber(decimalOf(money.amount, exponent), f);
  return text.startsWith(MINUS) ? `${MINUS}${symbol}${NBSP}${text.slice(1)}` : `${symbol}${NBSP}${text}`;
};

/** Numeric, with "/" and no leading zeros: 5/10/2026, 10/5/2026 or 2026/10/5. */
export const formatDate = (isoDate: string, f: Pick<Formats, "dateFormat">): string => {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (f.dateFormat === "DMY") return `${day}/${month}/${year}`;
  return f.dateFormat === "MDY" ? `${month}/${day}/${year}` : `${year}/${month}/${day}`;
};

/** "14:30" or "2:30 PM"; 24-hour times keep two-digit hours. */
export const formatTime = (wall: Wall, f: Pick<Formats, "timeFormat">): string =>
  f.timeFormat === "H24"
    ? `${pad(wall.hour)}:${pad(wall.minute)}`
    : `${wall.hour % 12 || 12}:${pad(wall.minute)}${NBSP}${wall.hour < 12 ? "AM" : "PM"}`;

/** The wall-clock time of an instant in a zone (the record's own, HU-E9-03). */
export const formatTimeAt = (instantIso: string, timeZone: string, f: Pick<Formats, "timeFormat">): string =>
  formatTime(wallTimeIn(new Date(instantIso), timeZone), f);
