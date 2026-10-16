import {
  addDays,
  addMonths,
  daysInMonth,
  fromParts,
  monthly,
  partsOf,
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

/**
 * The first day of the slot after the one holding `date` (final review I1). A slot holds one date of the schedule: a
 * calendar month for MONTHLY; for SEMI_MONTHLY a half of one, the second half starting on the second anchor, clamped
 * to the month, and a whole month when both anchors clamp to the same day (SEMI_MONTHLY(30, 31) in February).
 */
export const nextSlotStart = (schedule: Schedule, date: LocalDate): LocalDate => {
  const { year, month, day } = partsOf(date);
  if (schedule.kind === "SEMI_MONTHLY") {
    const last = daysInMonth(year, month);
    const secondHalf = Math.min(schedule.day2, last);
    if (Math.min(schedule.day1, last) < secondHalf && day < secondHalf)
      return fromParts(year, month, secondHalf);
  }
  const next = addMonths(year, month, 1);
  return fromParts(next.year, next.month, 1);
};

/** Whether two schedules have the same kind and anchors. */
export const sameSchedule = (a: Schedule, b: Schedule): boolean =>
  a.kind === "MONTHLY"
    ? b.kind === "MONTHLY" && a.day === b.day
    : b.kind === "SEMI_MONTHLY" && a.day1 === b.day1 && a.day2 === b.day2;

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
