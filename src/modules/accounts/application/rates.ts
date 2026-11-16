import type { ExchangeRate, LocalDate, Result } from "@/shared/kernel";

/**
 * D29, slice MC4 (design §4.1): the narrow port the accounts module converts a foreign account's balance with, bound
 * in composition to the rates module's dated read. `datedRateOn` answers `base`->`quote` from the latest stored rate
 * on or before `on`, the day of that stored rate (the oldest leg's for a cross rate) and whether it is more than a
 * week older than `on`; `NoExchangeRate` when the currencies are not connected by that day.
 */
export interface AccountRates {
  datedRateOn(
    base: string,
    quote: string,
    on: LocalDate,
  ): Promise<Result<{ readonly rate: ExchangeRate; readonly date: LocalDate; readonly stale: boolean }>>;
}
