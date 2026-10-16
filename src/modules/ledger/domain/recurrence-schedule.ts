import {
  addDays,
  monthly,
  periodFor,
  semiMonthly,
  type LocalDate,
  type PeriodPolicy,
  type Result,
} from "@/shared/kernel";

/**
 * Spec 5.2 Recurrence: a schedule follows the anchor rules of PeriodPolicy, MONTHLY(day) or SEMI_MONTHLY(day1, day2),
 * clamped to short months, and its dates are the days its periods would start on. WEEKLY and BIWEEKLY follow
 * HU-E8-09.
 */
export type Schedule = PeriodPolicy;

/** The schedule a request names; invalid anchors answer InvalidPeriodPolicy, as for a space's policy (HU-E1-03). */
export const scheduleOf = (input: PeriodPolicy): Result<Schedule> =>
  input.kind === "MONTHLY" ? monthly(input.day) : semiMonthly(input.day1, input.day2);

/** The first schedule date on or after `from`. */
export const firstDateFrom = (schedule: Schedule, from: LocalDate): LocalDate => {
  const period = periodFor(schedule, from);
  return period.start === from ? from : addDays(period.end, 1);
};

/**
 * The schedule dates from `from` through `through` (inclusive; open-ended when null), in order, at most `limit`.
 * `limit` must be a finite positive integer: a recurrence without an end date has endless dates, so callers bound
 * it, and an `Infinity` limit with an open end never returns.
 */
export const scheduleDates = (
  schedule: Schedule,
  window: { readonly from: LocalDate; readonly through: LocalDate | null },
  limit: number,
): LocalDate[] => {
  const dates: LocalDate[] = [];
  let date = firstDateFrom(schedule, window.from);
  while (dates.length < limit && (window.through === null || date <= window.through)) {
    dates.push(date);
    date = addDays(periodFor(schedule, date).end, 1);
  }
  return dates;
};
