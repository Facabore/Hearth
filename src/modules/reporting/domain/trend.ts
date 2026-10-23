import { addDays, resolvePeriod, type Period, type PeriodPolicy, type StoredPeriod } from "@/shared/kernel";

/**
 * Spec 5.3: `count` periods ending with `end`, oldest first, each the previous period of the same policy (the
 * stored one covering the day before, else the policy's period around the stored ones, D10), never the calendar month.
 */
export const periodsEndingWith = (
  policy: PeriodPolicy,
  stored: readonly StoredPeriod[],
  end: Period,
  count: number,
): Period[] => {
  const periods = [end];
  while (periods.length < count)
    periods.unshift(resolvePeriod(policy, stored, addDays(periods[0]!.start, -1)));
  return periods;
};

/**
 * HU-E7-05 (ruling of #132): a window may hold two periods with one label, a stored period that runs past its month
 * (Oct 5 to Nov 4, labelled 2026-10) and the derived stub before it (Oct 1 to 4, also 2026-10, HU-E1-03). The stored
 * period, else the earliest, keeps the label, which names it in every other report; each other period sharing it is
 * written `<label> (<start>..<end>)`, so the labels of a window are unique, as the points aligned with it.
 */
export const distinctLabels = (periods: readonly Period[], stored: readonly StoredPeriod[]): Period[] => {
  const isStored = (p: Period): boolean => stored.some((s) => s.start === p.start && s.end === p.end);
  return periods.map((p, i) => {
    const sharing = periods.flatMap((q, j) => (q.label === p.label ? [j] : []));
    if (sharing.length === 1) return p;
    const keeper = sharing.find((j) => isStored(periods[j]!)) ?? sharing[0];
    return i === keeper ? p : { ...p, label: `${p.label} (${p.start}..${p.end})` };
  });
};

/** HU-E7-05: how a figure moved from the previous period. */
export const CHANGE_STATUSES = ["NEW", "INCREASED", "DECREASED", "UNCHANGED"] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

export interface Change {
  /** current − previous; null when NEW. */
  readonly amount: bigint | null;
  /** The change over the previous figure in basis points (−3.70 % is −370), half away from zero; null when NEW. */
  readonly basisPoints: number | null;
  readonly status: ChangeStatus;
}

const magnitude = (n: bigint): bigint => (n < 0n ? -n : n);

/** HU-E7-05 (ruling P38): NEW without a previous figure or when it is 0 (never a division by zero). */
export const changeFrom = (previous: bigint | null, current: bigint): Change => {
  if (previous === null || previous === 0n) return { amount: null, basisPoints: null, status: "NEW" };
  const amount = current - previous;
  const base = magnitude(previous);
  const rounded = (2n * magnitude(amount) * 10_000n + base) / (2n * base);
  return {
    amount,
    basisPoints: Number(amount < 0n ? -rounded : rounded),
    status: amount > 0n ? "INCREASED" : amount < 0n ? "DECREASED" : "UNCHANGED",
  };
};

/** What a trend follows of a line: its id, the line it was copied from and its name. */
export interface TrendLine {
  readonly id: string;
  readonly originLineId: string | null;
  readonly name: string;
}

/**
 * HU-E7-05 (rulings P38, P98, P99): the line of each plan that `line` continues, aligned with `plans` (oldest first,
 * null for a period without a plan; the last is `line`'s own plan). Walking back from the nearest later line found, a
 * line continues the one it was copied from (the origin link that carry-overs follow, P15), else the one with its name,
 * case ignored. A name match never takes a line that another line of the later plan (the one the trace came from)
 * continues by origin: a renamed line leaves a new line of the old name NEW (P99). A period without a plan is skipped
 * and the next earlier plan is matched against that same line (P98); only a plan that exists and holds no match
 * ends the chain, and the walk then falls back to the name of `line` itself.
 */
export const tracedLines = <L extends TrendLine>(
  plans: readonly (readonly L[] | null)[],
  line: L,
): (L | null)[] => {
  const traced: (L | null)[] = plans.map(() => null);
  traced[plans.length - 1] = line;
  let current: L | null = line;
  let from: readonly L[] = plans[plans.length - 1] ?? [];
  for (let i = plans.length - 2; i >= 0; i -= 1) {
    const lines = plans[i];
    if (!lines) continue;
    const origin: string | null = current?.originLineId ?? null;
    const byOrigin: L | undefined = origin === null ? undefined : lines.find((l) => l.id === origin);
    const name = (current ?? line).name.toLowerCase();
    const continuedByAnother = (candidate: L): boolean =>
      from.some((other) => other.originLineId === candidate.id);
    current = byOrigin ?? lines.find((l) => l.name.toLowerCase() === name && !continuedByAnother(l)) ?? null;
    traced[i] = current;
    from = lines;
  }
  return traced;
};
