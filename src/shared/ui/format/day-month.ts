import type { DateFormat } from "./formatters";

/** U+00A0, as `NBSP` in formatters.ts; written here so a screen showing only this leaves the formatters' code out. */
const NBSP = "\u00a0";

/**
 * A day and its short month without the year (D23, ruling P121): "12 nov" for DMY, "nov 12" for MDY and YMD, which
 * put the month before the day. The month's name is the language's copy (`common.monthShort`); its place is the
 * person's date format, never the language. Imports nothing but a type, as `formatCount` does (ADR 0004).
 */
export const formatDayMonth = (
  isoDate: string,
  monthName: string,
  f: { readonly dateFormat: DateFormat },
): string => {
  const day = Number(isoDate.slice(8, 10));
  return f.dateFormat === "DMY" ? `${day}${NBSP}${monthName}` : `${monthName}${NBSP}${day}`;
};

/**
 * Ruling P327 (the P324 boards' day labels): `formatDayMonth` in today's year ("10 nov"), and with the year in any other,
 * in the same order: "10 nov 2025" for DMY, "nov 10, 2025" for MDY and "2025 nov 10" for YMD. `today` is the person's
 * own date (`todayIn`), never a UTC one.
 */
export const formatDayMonthYear = (
  isoDate: string,
  monthName: string,
  f: { readonly dateFormat: DateFormat },
  today: string,
): string => {
  const dayMonth = formatDayMonth(isoDate, monthName, f);
  const year = isoDate.slice(0, 4);
  if (year === today.slice(0, 4)) return dayMonth;
  if (f.dateFormat === "DMY") return `${dayMonth}${NBSP}${year}`;
  return f.dateFormat === "MDY" ? `${dayMonth},${NBSP}${year}` : `${year}${NBSP}${dayMonth}`;
};
