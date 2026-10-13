import { domainError } from "./domain-error";
import { err, ok, type Result } from "./result";

/** Calendar date without time or zone, as ISO `YYYY-MM-DD`; ISO strings sort chronologically. */
export type LocalDate = string & { readonly __brand: "LocalDate" };

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
/** PostgreSQL has no year 0 and Date.UTC maps years 0-99 to 1900-1999, so earlier dates are rejected. */
export const MIN_YEAR = 1900;
const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

export const fromParts = (year: number, month: number, day: number): LocalDate =>
  `${pad(year, 4)}-${pad(month)}-${pad(day)}` as LocalDate;

export const partsOf = (date: LocalDate): { year: number; month: number; day: number } => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return { year: y, month: m, day: d };
};

export const localDate = (iso: string): Result<LocalDate> => {
  const match = iso.match(ISO);
  if (!match) return err(domainError("InvalidDate", { value: iso }));
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < MIN_YEAR || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return err(domainError("InvalidDate", { value: iso }));
  }
  return ok(iso as LocalDate);
};

export const addDays = (date: LocalDate, days: number): LocalDate => {
  const { year, month, day } = partsOf(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return fromParts(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
};

export const addMonths = (year: number, month: number, delta: number): { year: number; month: number } => {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
};
