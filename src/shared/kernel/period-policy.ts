import { domainError } from "./domain-error";
import { addDays, addMonths, daysInMonth, fromParts, partsOf, type LocalDate } from "./local-date";
import { err, ok, type Result } from "./result";

export type PeriodPolicy =
  | { readonly kind: "MONTHLY"; readonly day: number }
  | { readonly kind: "SEMI_MONTHLY"; readonly day1: number; readonly day2: number };

export interface Period {
  readonly start: LocalDate;
  readonly end: LocalDate;
  readonly label: string;
}

const isAnchorDay = (day: number) => Number.isInteger(day) && day >= 1 && day <= 31;
const invalid = (details: Record<string, unknown>) => err(domainError("InvalidPeriodPolicy", details));

export const monthly = (day: number): Result<PeriodPolicy> =>
  isAnchorDay(day) ? ok({ kind: "MONTHLY", day }) : invalid({ day });

export const semiMonthly = (day1: number, day2: number): Result<PeriodPolicy> =>
  isAnchorDay(day1) && isAnchorDay(day2) && day1 < day2
    ? ok({ kind: "SEMI_MONTHLY", day1, day2 })
    : invalid({ day1, day2 });

export const DEFAULT_PERIOD_POLICY: PeriodPolicy = { kind: "MONTHLY", day: 1 };

interface Anchor {
  readonly date: LocalDate;
  /** Index of the anchor day within the policy (0 = day / day1, 1 = day2). */
  readonly slot: number;
}

const anchorDays = (policy: PeriodPolicy): number[] =>
  policy.kind === "MONTHLY" ? [policy.day] : [policy.day1, policy.day2];

/** Anchors of one month, clamped to its length, duplicates collapsed (first slot wins). */
const anchorsOf = (policy: PeriodPolicy, year: number, month: number): Anchor[] => {
  const last = daysInMonth(year, month);
  const anchors: Anchor[] = [];
  anchorDays(policy).forEach((day, slot) => {
    const date = fromParts(year, month, Math.min(day, last));
    if (!anchors.some((a) => a.date === date)) anchors.push({ date, slot });
  });
  return anchors;
};

const yearMonth = (year: number, month: number): string => fromParts(year, month, 1).slice(0, 7);

/** Spec 5.3: MONTHLY is named after the month holding most of its days; SEMI_MONTHLY after its start half. */
const label = (policy: PeriodPolicy, start: Anchor): string => {
  const { year, month } = partsOf(start.date);
  if (policy.kind === "SEMI_MONTHLY") return `${yearMonth(year, month)} ${start.slot === 0 ? "H1" : "H2"}`;
  const labelled = policy.day <= 15 ? { year, month } : addMonths(year, month, 1);
  return yearMonth(labelled.year, labelled.month);
};

/**
 * The period containing `date`. The start anchor lies in the current or previous month and the
 * following anchor in the current or next month, so three months of candidates always suffice.
 * ISO date strings compare chronologically with `<=`.
 */
export const periodFor = (policy: PeriodPolicy, date: LocalDate): Period => {
  const { year, month } = partsOf(date);
  const prev = addMonths(year, month, -1);
  const next = addMonths(year, month, 1);
  const candidates = [
    ...anchorsOf(policy, prev.year, prev.month),
    ...anchorsOf(policy, year, month),
    ...anchorsOf(policy, next.year, next.month),
  ];
  const startIndex = candidates.findLastIndex((a) => a.date <= date);
  const start = candidates[startIndex]!;
  const following = candidates[startIndex + 1]!;
  return { start: start.date, end: addDays(following.date, -1), label: label(policy, start) };
};
