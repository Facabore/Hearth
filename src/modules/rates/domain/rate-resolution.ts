import { ExchangeRate, type LocalDate, type Result } from "@/shared/kernel";
import { crossRate } from "./cross-rate";

/** One stored rate row, as the repository reads it. */
export interface RateRow {
  readonly date: LocalDate;
  readonly base: string;
  readonly quote: string;
  readonly rate: string;
}

/**
 * D30: `base`->`quote` as of `on`, from stored rows. Each directed pair keeps only its latest row on or before `on`
 * (ISO dates sort chronologically), those become the edges, and `crossRate` resolves the pair, directly or through a
 * pivot. A malformed row is ignored rather than failing the whole lookup.
 */
export const rateFromRows = (
  rows: readonly RateRow[],
  base: string,
  quote: string,
  on: LocalDate,
): Result<ExchangeRate> => {
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

  return crossRate(edges, base, quote);
};
