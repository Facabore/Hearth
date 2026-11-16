import type { ExchangeRateRepository, ExchangeRateSource, StoredRate } from "@/modules/rates/application";
import type { Logger } from "@/shared/http";
import { type Clock, type Scheduler } from "@/shared/kernel";

export interface ExchangeRateJobDeps {
  readonly sources: readonly ExchangeRateSource[];
  readonly repository: ExchangeRateRepository;
  readonly scheduler: Scheduler;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * D30 (ruling P20, like the recurrence job): the in-container job that fetches each source's latest daily rates and
 * stores them; no endpoint triggers it. Sources are independent — one that is unavailable or throws is logged and the
 * others still run — and a store is idempotent, so a re-run never duplicates a past rate. A run that throws as a whole
 * is its scheduler's to report and to run again.
 */
export const startExchangeRateJob = (deps: ExchangeRateJobDeps, intervalMs: number): (() => void) =>
  deps.scheduler.every(intervalMs, async () => {
    const fetchedAt = deps.clock.now();
    for (const source of deps.sources) {
      try {
        const result = await source.fetch();
        if (!result.ok) {
          // Expected and recoverable: the previous day's rate carries over via rateOn's on-or-before lookup.
          deps.logger.info("exchange_rate_source_unavailable", {
            source: source.key,
            code: result.error.code,
          });
          continue;
        }
        const { base, date, rates } = result.value;
        const stored: StoredRate[] = rates.map((r) => ({
          date,
          base,
          quote: r.quote,
          rate: r.rate,
          source: result.value.source,
          fetchedAt,
        }));
        await deps.repository.save(stored);
        deps.logger.info("exchange_rates_saved", { source: source.key, date, count: stored.length });
      } catch (error) {
        deps.logger.error("exchange_rate_job_failed", {
          source: source.key,
          name: error instanceof Error ? error.name : "Error",
        });
      }
    }
  });
