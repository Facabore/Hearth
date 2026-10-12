import { domainError } from "./domain-error";
import { addDays, addMonths, daysInMonth, fromParts, type LocalDate } from "./local-date";
import { periodFor, type Period, type PeriodPolicy } from "./period-policy";
import { err, ok, type Result } from "./result";

/** A period whose boundaries were stored when its plan was created (spec D10). Stored periods never overlap. */
export type StoredPeriod = Period;

const covers = (period: Period, date: LocalDate): boolean => period.start <= date && date <= period.end;
const overlaps = (a: Period, b: Period): boolean => a.start <= b.end && b.start <= a.end;

/**
 * HU-E1-03 overlap rule: a derived period that overlaps stored periods shrinks to the gap around
 * `date` (it starts the day after an earlier stored period ends, or ends the day before a later
 * one starts) and keeps its natural label.
 */
const clip = (natural: Period, stored: readonly StoredPeriod[], date: LocalDate): Period => {
  let { start, end } = natural;
  for (const s of stored.filter((p) => overlaps(p, natural))) {
    if (s.end < date && addDays(s.end, 1) > start) start = addDays(s.end, 1);
    if (s.start > date && addDays(s.start, -1) < end) end = addDays(s.start, -1);
  }
  return { start, end, label: natural.label };
};

/** HU-E4-04: the stored period covering `date`, otherwise the policy period clipped around stored ones. */
export const resolvePeriod = (
  policy: PeriodPolicy,
  stored: readonly StoredPeriod[],
  date: LocalDate,
): Period => stored.find((s) => covers(s, date)) ?? clip(periodFor(policy, date), stored, date);

/** `count` consecutive periods, starting with the one that contains `from`. */
export const listPeriods = (
  policy: PeriodPolicy,
  stored: readonly StoredPeriod[],
  from: LocalDate,
  count: number,
): Period[] => {
  const periods: Period[] = [];
  let date = from;
  while (periods.length < count) {
    const period = resolvePeriod(policy, stored, date);
    periods.push(period);
    date = addDays(period.end, 1);
  }
  return periods;
};

const LABEL = /^(\d{4})-(\d{2})(?: (H1|H2))?$/;
const invalidLabel = (label: string) => err(domainError("InvalidPeriodLabel", { label }));

/** The date on which the period named `label` would start under `policy` (spec 5.3 naming rules). */
const startOf = (policy: PeriodPolicy, year: number, month: number, half: string | undefined): LocalDate => {
  // MONTHLY with an anchor after the 15th is named after the following month, so it starts a month earlier.
  const at = policy.kind === "MONTHLY" && policy.day > 15 ? addMonths(year, month, -1) : { year, month };
  const day = policy.kind === "MONTHLY" ? policy.day : half === "H1" ? policy.day1 : policy.day2;
  return fromParts(at.year, at.month, Math.min(day, daysInMonth(at.year, at.month)));
};

/** HU-E4-04: resolves `2026-10` (monthly) or `2026-11 H1` (semi-monthly) to its dates. */
export const periodByLabel = (
  policy: PeriodPolicy,
  stored: readonly StoredPeriod[],
  label: string,
): Result<Period> => {
  const storedPeriod = stored.find((s) => s.label === label);
  if (storedPeriod) return ok(storedPeriod);
  const match = label.match(LABEL);
  if (!match) return invalidLabel(label);
  const [, year, month, half] = match;
  const monthNumber = Number(month);
  if (monthNumber < 1 || monthNumber > 12) return invalidLabel(label);
  if ((policy.kind === "SEMI_MONTHLY") !== (half !== undefined)) return invalidLabel(label);
  const natural = periodFor(policy, startOf(policy, Number(year), monthNumber, half));
  // Clamped anchors can collapse (SEMI_MONTHLY(29, 31) has no February H2): the label must round-trip.
  if (natural.label !== label) return invalidLabel(label);
  for (let date = natural.start; date <= natural.end; date = addDays(date, 1)) {
    if (!stored.some((s) => covers(s, date))) return ok(clip(natural, stored, date));
  }
  return invalidLabel(label);
};
