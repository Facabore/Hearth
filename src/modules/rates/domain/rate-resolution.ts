import { addDays, ok, ExchangeRate, type LocalDate, type Result } from "@/shared/kernel";
import { crossRatePath } from "./cross-rate";

/** One stored rate row, as the repository reads it. */
export interface RateRow {
  readonly date: LocalDate;
  readonly base: string;
  readonly quote: string;
  readonly rate: string;
}

/** D29 (MC4): a rate older than this many days before the day asked for is flagged stale, never hidden. */
export const STALE_AFTER_DAYS = 7;

/** D29 (MC4): a resolved rate with the day of the stored rate it came from, and whether that day is stale. */
export interface DatedRate {
  readonly rate: ExchangeRate;
  /** The stored rate's own day; for a cross rate, the oldest day among the stored rates it went through. */
  readonly date: LocalDate;
  /** True when `date` is more than `STALE_AFTER_DAYS` days before the day asked for. */
  readonly stale: boolean;
}

/**
 * D30: `base`->`quote` as of `on`, from stored rows. Each directed pair keeps only its latest row on or before `on`
 * (ISO dates sort chronologically), those become the edges, and `crossRate` resolves the pair, directly or through a
 * pivot. A malformed row is ignored rather than failing the whole lookup. D29 (MC4): the answer carries the day of the
 * stored rate it rests on (the oldest leg's for a cross rate) and whether that day is stale.
 */
export const datedRateFromRows = (
  rows: readonly RateRow[],
  base: string,
  quote: string,
  on: LocalDate,
): Result<DatedRate> => {
  const latest = new Map<string, RateRow>();
  for (const row of rows) {
    if (row.date > on) continue;
    const key = `${row.base}>${row.quote}`;
    const kept = latest.get(key);
    if (!kept || row.date > kept.date) latest.set(key, row);
  }

  const edges: ExchangeRate[] = [];
  for (const row of latest.values()) {
    const edge = ExchangeRate.of(row.base, row.quote, row.rate);
    if (edge.ok) edges.push(edge.value);
  }

  const path = crossRatePath(edges, base, quote);
  if (!path.ok) return path;
  // A leg is a stored rate or its inverse; the forward row wins when both directions are stored, as `crossRate` does.
  const dayOf = (leg: ExchangeRate): LocalDate =>
    (latest.get(`${leg.base}>${leg.quote}`) ?? latest.get(`${leg.quote}>${leg.base}`))!.date;
  const date = path.value.legs.map(dayOf).reduce((oldest, day) => (day < oldest ? day : oldest));
  return ok({ rate: path.value.rate, date, stale: date < addDays(on, -STALE_AFTER_DAYS) });
};

/** D30: `base`->`quote` as of `on`, as `datedRateFromRows` resolves it, without its day. */
export const rateFromRows = (
  rows: readonly RateRow[],
  base: string,
  quote: string,
  on: LocalDate,
): Result<ExchangeRate> => {
  const dated = datedRateFromRows(rows, base, quote, on);
  return dated.ok ? ok(dated.value.rate) : dated;
};
