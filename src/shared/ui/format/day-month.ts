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
