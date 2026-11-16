import type {
  ExchangeRateRepository,
  ExchangeRateSource,
  SourceRates,
  StoredRate,
} from "@/modules/rates/application";
import type { Logger } from "@/shared/http";
import {
  addDays,
  ExchangeRate,
  failureOf,
  type Clock,
  type LocalDate,
  type Scheduler,
} from "@/shared/kernel";

/**
 * D30: how far back each source's history is filled in, so a past movement (an import, a back-dated record) converts
 * at its own date's rate. Before this day the earliest stored rate carries back no further: there is none.
 */
export const RATES_HISTORY_FROM = "2015-01-01" as LocalDate;

/**
 * Sources publish nothing on weekends and holidays (the ECB's first day of 2015 is 2 January), so a history counts as
 * filled in when its earliest day falls within a week of `historyFrom`.
 */
const HISTORY_SLACK_DAYS = 7;
const historyDeadline = (from: LocalDate): LocalDate => addDays(from, HISTORY_SLACK_DAYS);

export interface ExchangeRateJobDeps {
  readonly sources: readonly ExchangeRateSource[];
  readonly repository: ExchangeRateRepository;
  readonly scheduler: Scheduler;
  readonly clock: Clock;
  readonly logger: Logger;
  /** The first day of history each source should have; see `RATES_HISTORY_FROM`. */
  readonly historyFrom: LocalDate;
}

/** Only exact positive decimals between known currencies are stored, written as ExchangeRate renders them. */
const storable = (
  days: readonly SourceRates[],
  fetchedAt: Date,
): { stored: StoredRate[]; skipped: number } => {
  const stored: StoredRate[] = [];
  let skipped = 0;
  for (const { source, base, date, rates } of days) {
    for (const r of rates) {
      const parsed = ExchangeRate.of(base, r.quote, r.rate);
      if (parsed.ok) stored.push({ date, base, quote: r.quote, rate: parsed.value.value, source, fetchedAt });
      else skipped += 1;
    }
  }
  return { stored, skipped };
};

/**
 * D30 (ruling P20, like the recurrence job): the in-container job that stores each source's daily rates; no endpoint
 * triggers it. A source with no rate as old as `historyFrom` first gets its history filled in, in the same run, and
 * once it has one that step is skipped, so the large read happens once (and again only if it failed). Sources are
 * independent — one that is unavailable or throws is logged and the others still run — and a store is idempotent, so
 * a re-run never duplicates a past rate. A run that throws as a whole is its scheduler's to report and to run again.
 */
export const startExchangeRateJob = (deps: ExchangeRateJobDeps, intervalMs: number): (() => void) =>
  deps.scheduler.every(intervalMs, async () => {
    const fetchedAt = deps.clock.now();
    for (const source of deps.sources) {
      try {
        const earliest = await deps.repository.earliestDate(source.key);
        if (earliest === null || earliest > historyDeadline(deps.historyFrom)) {
          const history = await source.history(deps.historyFrom);
          if (history.ok) {
            const { stored, skipped } = storable(history.value, fetchedAt);
            await deps.repository.save(stored);
            deps.logger.info("exchange_rates_backfilled", {
              source: source.key,
              from: deps.historyFrom,
              days: history.value.length,
              count: stored.length,
              skipped,
            });
          } else {
            deps.logger.info("exchange_rate_history_unavailable", {
              source: source.key,
              code: history.error.code,
            });
          }
        }

        const result = await source.fetch();
        if (!result.ok) {
          // Expected and recoverable: the previous day's rate carries over via rateOn's on-or-before lookup.
          deps.logger.info("exchange_rate_source_unavailable", {
            source: source.key,
            code: result.error.code,
          });
          continue;
        }
        const { stored, skipped } = storable([result.value], fetchedAt);
        await deps.repository.save(stored);
        deps.logger.info("exchange_rates_saved", {
          source: source.key,
          date: result.value.date,
          count: stored.length,
          skipped,
        });
      } catch (error) {
        const { error: name, ...database } = failureOf(error);
        deps.logger.error("exchange_rate_source_failed", { source: source.key, name, ...database });
      }
    }
  });

/** The whole-run failure handler for the exchange-rate job's scheduler, logged like the recurrence job's (`failureOf`). */
export const logExchangeRateJobFailure =
  (logger: Logger) =>
  (error: unknown): void => {
    const { error: name, ...database } = failureOf(error);
    logger.error("exchange_rate_job_failed", { name, ...database });
  };
